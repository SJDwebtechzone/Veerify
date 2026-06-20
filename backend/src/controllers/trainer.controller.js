const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');
const { sendTrainerCredentialsEmail } = require('../utils/mailer');

// Helper: get admin's institution_id
const getAdminInstitutionId = async (userId) => {
  const result = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.institution_id;
};

// CREATE trainer (admin only)
// This creates BOTH a user account AND a trainer profile in one transaction
exports.createTrainer = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      // Account
      name, email, phone, password,
      // Profile (legacy fields)
      specialization, belt_level, experience_years, bio,
      // Personal (migration 016)
      gender, date_of_birth,
      // Identity + documents (migration 016)
      govt_proof_type, govt_proof_number, photo_url, certificate_url,
    } = req.body;
    const adminId = req.user.id;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    const institutionId = await getAdminInstitutionId(adminId);
    if (!institutionId) {
      return res.status(400).json({ message: 'You must create an institution first' });
    }

    // Plan-limit gate: refuse to create when the institution is at its
    // trainer cap. Returns a 402 payload the mobile knows how to show as
    // an "Upgrade plan" modal.
    const overLimit = await ensureCapacity(institutionId, 'trainers');
    if (overLimit) {
      return res.status(402).json(limitResponse('trainers', overLimit));
    }

    // Check email uniqueness
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    // Use a transaction so both INSERTs succeed or both fail
    await client.query('BEGIN');

    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 1: Create user
    const userResult = await client.query(
      `INSERT INTO users (name, email, phone, password, role, institution_id)
       VALUES ($1, $2, $3, $4, 'trainer', $5)
       RETURNING id, name, email, phone, role`,
      [name, email, phone, hashedPassword, institutionId]
    );
    const user = userResult.rows[0];

    // Step 2: Create trainer profile with all the extended-enrollment fields
    const trainerResult = await client.query(
      `INSERT INTO trainers (
         user_id, institution_id,
         specialization, belt_level, experience_years, bio,
         gender, date_of_birth,
         govt_proof_type, govt_proof_number,
         photo_url, certificate_url
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        user.id, institutionId,
        specialization || null, belt_level || null, experience_years || 0, bio || null,
        gender || null, date_of_birth || null,
        govt_proof_type || null, govt_proof_number || null,
        photo_url || null, certificate_url || null,
      ]
    );

    await client.query('COMMIT');

    // ── Email the new trainer their login credentials so they can sign
    // into the Veerify mobile app. Best-effort: if SMTP isn't configured
    // or the send fails, we still return 201 — the admin can verify the
    // trainer exists in the list and re-share credentials manually.
    try {
      const instRow = await pool.query(
        'SELECT name FROM institutions WHERE id = $1',
        [institutionId],
      );
      const institutionName = instRow.rows[0]?.name || 'your academy';
      const mailResult = await sendTrainerCredentialsEmail({
        to: email,
        name,
        institutionName,
        loginEmail: email,
        password,                   // plaintext, only ever sent in this one mail
      });
      if (!mailResult.ok) {
        // Don't fail the request — surface a warning for the admin.
        console.warn('[createTrainer] credentials email failed:', mailResult.error);
      }
    } catch (mailErr) {
      console.warn('[createTrainer] credentials email threw:', mailErr.message);
    }

    res.status(201).json({
      message: 'Trainer created successfully. Login details emailed to the trainer.',
      trainer: {
        ...trainerResult.rows[0],
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// GET /api/trainers/me — the calling trainer's own joined profile.
// Returns trainer-row fields + user fields + a few aggregates (assigned
// batch count, student count across those batches) so the Staff Profile
// screen has everything it needs in one round-trip.
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const profile = await pool.query(
      `SELECT
         t.id             AS trainer_id,
         t.user_id,
         t.institution_id,
         t.specialization,
         t.belt_level,
         t.experience_years,
         t.bio,
         t.gender,
         t.date_of_birth,
         t.govt_proof_type,
         t.govt_proof_number,
         t.photo_url,
         t.certificate_url,
         t.created_at     AS joined_at,
         u.name,
         u.email,
         u.phone,
         u.role,
         i.name           AS institution_name,
         i.logo_url       AS institution_logo,
         (SELECT COUNT(*) FROM batches b WHERE b.trainer_id = t.id)
                          AS assigned_batches,
         (SELECT COUNT(DISTINCT e.student_id)
            FROM enrollments e
            JOIN batches b ON e.batch_id = b.id
           WHERE b.trainer_id = t.id)
                          AS total_students
       FROM trainers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN institutions i ON t.institution_id = i.id
       WHERE t.user_id = $1`,
      [userId],
    );

    if (profile.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer profile not found' });
    }

    res.json({ trainer: profile.rows[0] });
  } catch (err) {
    console.error('Get my trainer profile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET all trainers in my institution
// SUPER ADMIN: every trainer across every institution, joined with the
// owning institution + user. Used by the platform admin trainers page in
// veerify_admin_web. Query params allow optional filters so the page can
// fall back to server-side filtering once the dataset grows:
//   ?institution_id=42
//   ?skill=Karate
//   ?belt=Black%20Belt
exports.getAllTrainers = async (req, res) => {
  try {
    const { institution_id, skill, belt } = req.query;

    const where = ['COALESCE(u.is_deleted, false) = false'];
    const params = [];

    if (institution_id) {
      params.push(Number(institution_id));
      where.push(`t.institution_id = $${params.length}`);
    }
    if (skill) {
      params.push(`%${skill}%`);
      where.push(`t.specialization ILIKE $${params.length}`);
    }
    if (belt) {
      params.push(`%${belt}%`);
      where.push(`t.belt_level ILIKE $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         t.id,
         t.user_id,
         t.institution_id,
         t.specialization,
         t.belt_level,
         t.experience_years,
         t.bio,
         t.gender,
         t.date_of_birth,
         t.govt_proof_type,
         t.govt_proof_number,
         t.photo_url,
         t.certificate_url,
         t.created_at,
         u.name,
         u.email,
         u.phone,
         u.status AS user_status,
         i.id     AS institution_id,
         i.name   AS institution_name,
         i.city   AS institution_city,
         i.logo_url AS institution_logo,
         -- All batches this trainer is assigned to, with the parent course
         -- name + schedule for context. Lets the admin web table show a
         -- "Batches" column with no extra round-trip.
         (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id',             b.id,
             'name',           b.name,
             'days_of_week',   b.days_of_week,
             'start_time',     b.start_time,
             'end_time',       b.end_time,
             'course_id',      c.id,
             'course_name',    c.name,
             'enrolled_count', (
               SELECT COUNT(*)::int FROM enrollments e
               WHERE e.batch_id = b.id
             )
           ) ORDER BY b.name), '[]'::jsonb)
           FROM batches b
           LEFT JOIN courses c ON b.course_id = c.id
           WHERE b.trainer_id = t.id
         ) AS batches
       FROM trainers t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN institutions i ON t.institution_id = i.id
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params,
    );

    res.json({
      count: result.rows.length,
      trainers: result.rows,
    });
  } catch (err) {
    console.error('Get all trainers error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getMyTrainers = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);

    const result = await pool.query(
      `SELECT t.*, u.name, u.email, u.phone
       FROM trainers t
       JOIN users u ON t.user_id = u.id
       WHERE t.institution_id = $1
       ORDER BY t.created_at DESC`,
      [institutionId]
    );

    res.json({
      count: result.rows.length,
      trainers: result.rows
    });
  } catch (err) {
    console.error('Get trainers error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET single trainer
exports.getTrainerById = async (req, res) => {
  try {
    const { id } = req.params;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    const result = await pool.query(
      `SELECT t.*, u.name, u.email, u.phone
       FROM trainers t
       JOIN users u ON t.user_id = u.id
       WHERE t.id = $1 AND t.institution_id = $2`,
      [id, adminInstitutionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer not found in your institution' });
    }

    res.json({ trainer: result.rows[0] });
  } catch (err) {
    console.error('Get trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE trainer
//
// Updates BOTH the trainer profile row AND the underlying users row so
// edits to name/phone propagate to login + admin lists. Email is left
// alone here (changing the login id mid-session is brittle - if you need
// that, expose a dedicated "Change Email" flow). Password isn't touched.
//
// Every field is OPTIONAL; we COALESCE so a partial PATCH only overwrites
// what the client sent.
exports.updateTrainer = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      // Identity (users table)
      name, phone,
      // Profile (legacy)
      specialization, belt_level, experience_years, bio,
      // Personal (migration 016)
      gender, date_of_birth,
      // Identity + documents (migration 016)
      govt_proof_type, govt_proof_number, photo_url, certificate_url,
    } = req.body;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    // Verify ownership
    const check = await pool.query(
      'SELECT institution_id, user_id FROM trainers WHERE id = $1',
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer not found' });
    }
    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'You can only update trainers in your own institution' });
    }

    await client.query('BEGIN');

    // Trainer profile fields
    await client.query(
      `UPDATE trainers SET
         specialization    = COALESCE($1, specialization),
         belt_level        = COALESCE($2, belt_level),
         experience_years  = COALESCE($3, experience_years),
         bio               = COALESCE($4, bio),
         gender            = COALESCE($5, gender),
         date_of_birth     = COALESCE($6, date_of_birth),
         govt_proof_type   = COALESCE($7, govt_proof_type),
         govt_proof_number = COALESCE($8, govt_proof_number),
         photo_url         = COALESCE($9, photo_url),
         certificate_url   = COALESCE($10, certificate_url)
       WHERE id = $11`,
      [
        specialization || null, belt_level || null,
        experience_years != null ? Number(experience_years) : null,
        bio || null,
        gender || null, date_of_birth || null,
        govt_proof_type || null, govt_proof_number || null,
        photo_url || null, certificate_url || null,
        id,
      ]
    );

    // User identity fields (kept in users table so admin lists + login work)
    if (name || phone) {
      await client.query(
        `UPDATE users SET
           name  = COALESCE($1, name),
           phone = COALESCE($2, phone)
         WHERE id = $3`,
        [name || null, phone || null, check.rows[0].user_id]
      );
    }

    await client.query('COMMIT');

    // Return the joined fresh row so the mobile list can replace its
    // cached copy in one shot without an extra GET.
    const fresh = await pool.query(
      `SELECT t.*, u.name, u.email, u.phone
       FROM trainers t
       JOIN users u ON t.user_id = u.id
       WHERE t.id = $1`,
      [id]
    );

    res.json({
      message: 'Trainer updated successfully',
      trainer: fresh.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// DELETE trainer (also deletes their user account)
exports.deleteTrainer = async (req, res) => {
  try {
    const { id } = req.params;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    const check = await pool.query(
      'SELECT institution_id, user_id FROM trainers WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer not found' });
    }

    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'You can only delete trainers in your own institution' });
    }

    // Delete the user — trainer row will cascade-delete (because of ON DELETE CASCADE)
    await pool.query('DELETE FROM users WHERE id = $1', [check.rows[0].user_id]);

    res.json({ message: 'Trainer deleted successfully' });
  } catch (err) {
    console.error('Delete trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};