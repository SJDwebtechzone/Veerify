const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');
const { sendTrainerCredentialsEmail } = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
const {
  validateEmailFormat, validatePhoneFormat,
  ensureEmailUnique, ensurePhoneUnique,
} = require('../utils/contactValidation');

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
// Normalise the multi-skill array. Accepts an array of
//   { name, belt_level, experience_years, certificate_url }
// and cleans each entry. Returns `null` when the input isn't a usable
// array so the caller can decide what to do (fall back to legacy fields).
function normaliseSkills(raw) {
  if (!Array.isArray(raw)) return null;
  const cleaned = raw
    .map((s) => ({
      name:             s?.name ? String(s.name).trim() : '',
      belt_level:       s?.belt_level ? String(s.belt_level).trim() : null,
      experience_years: (() => {
        const n = Number(s?.experience_years);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      })(),
      certificate_url:  s?.certificate_url ? String(s.certificate_url).trim() : null,
    }))
    .filter((s) => s.name);   // drop rows without a skill name
  return cleaned;
}

// Derive legacy single-value columns from the skills array so existing
// consumers (student list, trainer cards, etc.) that read
// specialization / belt_level / experience_years / certificate_url
// keep rendering something sensible.
function legacyFromSkills(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return {};
  const first = skills[0];
  return {
    specialization:   skills.map((s) => s.name).filter(Boolean).join(', '),
    belt_level:       first.belt_level || null,
    experience_years: Math.max(0, ...skills.map((s) => Number(s.experience_years) || 0)),
    certificate_url:  first.certificate_url || null,
  };
}

exports.createTrainer = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      // Account
      name, email, phone, password,
      // Profile (legacy fields — still accepted for backward compat)
      specialization, belt_level, experience_years, bio,
      // Personal (migration 016)
      gender, date_of_birth,
      // Identity + documents (migration 016)
      govt_proof_type, govt_proof_number, photo_url, certificate_url,
      // NEW: structured multi-skill array (migration 046). When present,
      // it drives the row and derives the legacy columns; when absent,
      // the legacy columns are used as-is and skills is empty.
      skills: rawSkills,
    } = req.body;
    const adminId = req.user.id;

    if (!name || !password) {
      return res.status(400).json({ message: 'Name and password are required' });
    }

    // ── Email + phone validation (format + uniqueness) ────────────────
    const eFmt = validateEmailFormat(email, { required: true });
    if (!eFmt.ok) return res.status(eFmt.status).json(eFmt.body);
    const pFmt = validatePhoneFormat(phone, { required: false });
    if (!pFmt.ok) return res.status(pFmt.status).json(pFmt.body);

    const emailUnique = await ensureEmailUnique(eFmt.value);
    if (!emailUnique.ok) return res.status(emailUnique.status).json(emailUnique.body);
    if (pFmt.value) {
      const phoneUnique = await ensurePhoneUnique(pFmt.value);
      if (!phoneUnique.ok) return res.status(phoneUnique.status).json(phoneUnique.body);
    }

    // Use the cleaned/normalised values everywhere below.
    const cleanEmail = eFmt.value;
    const cleanPhone = pFmt.value;

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

    // Use a transaction so both INSERTs succeed or both fail
    await client.query('BEGIN');

    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 1: Create user.
    // must_change_password=TRUE — the trainer was provisioned by the
    // institution admin with a temp password emailed to them, so the
    // mobile login flow pops a "set a new password / I'll do it later"
    // dialog on their first sign-in.
    const userResult = await client.query(
      `INSERT INTO users (name, email, phone, password, role, institution_id,
                          must_change_password)
       VALUES ($1, $2, $3, $4, 'trainer', $5, TRUE)
       RETURNING id, name, email, phone, role`,
      [name, cleanEmail, cleanPhone, hashedPassword, institutionId]
    );
    const user = userResult.rows[0];

    // Step 2: Create trainer profile with all the extended-enrollment fields.
    // If the client sent the structured skills array, that becomes the
    // source of truth and we back-fill the legacy singletons from it. If
    // it didn't, we use whatever legacy singletons were on req.body (old
    // clients / API tests).
    const skillsArr = normaliseSkills(rawSkills);
    const legacy = skillsArr && skillsArr.length > 0
      ? legacyFromSkills(skillsArr)
      : {
          specialization:   specialization || null,
          belt_level:       belt_level || null,
          experience_years: experience_years || 0,
          certificate_url:  certificate_url || null,
        };
    const trainerResult = await client.query(
      `INSERT INTO trainers (
         user_id, institution_id,
         specialization, belt_level, experience_years, bio,
         gender, date_of_birth,
         govt_proof_type, govt_proof_number,
         photo_url, certificate_url,
         skills
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING *`,
      [
        user.id, institutionId,
        legacy.specialization, legacy.belt_level, legacy.experience_years, bio || null,
        gender || null, date_of_birth || null,
        govt_proof_type || null, govt_proof_number || null,
        photo_url || null, legacy.certificate_url,
        JSON.stringify(skillsArr || []),
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

    // ── Welcome SMS (fire-and-forget) ─────────────────────────────
    // Trainer was provisioned by the admin with a temp password, so we
    // pass it along in the SMS just like the credentials email does.
    // dispatchWelcomeSms swallows errors internally — SMS provider
    // outages never affect the 201 response.
    dispatchWelcomeSms({
      phone:        cleanPhone,
      name:         user.name,
      role:         'trainer',
      loginId:      user.email,
      tempPassword: password,
    });

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
         AND COALESCE(u.is_deleted, false) = false
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
       WHERE t.id = $1
         AND t.institution_id = $2
         AND COALESCE(u.is_deleted, false) = false`,
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
      name, email, phone,
      // Profile (legacy)
      specialization, belt_level, experience_years, bio,
      // Personal (migration 016)
      gender, date_of_birth,
      // Identity + documents (migration 016)
      govt_proof_type, govt_proof_number, photo_url, certificate_url,
      // NEW: structured multi-skill array (migration 046).
      skills: rawSkills,
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

    // ── Email validation on edit ──────────────────────────────────────
    // Optional in the request. When present:
    //   • Must pass the shared email format check.
    //   • Must be unique across users (excluding the trainer's own row so
    //     leaving it unchanged doesn't self-collide).
    // Note: changing the email here is a real rename of the trainer's
    // login id. They'll sign in with the new address on their next
    // session; existing JWTs stay valid until expiry.
    let cleanEmail = null;
    if (email !== undefined && email !== null && String(email).trim() !== '') {
      const eFmt = validateEmailFormat(email, { required: true });
      if (!eFmt.ok) return res.status(eFmt.status).json(eFmt.body);
      const eUnique = await ensureEmailUnique(eFmt.value, {
        excludeUserId: check.rows[0].user_id,
      });
      if (!eUnique.ok) return res.status(eUnique.status).json(eUnique.body);
      cleanEmail = eFmt.value;
    }

    // ── Phone validation on edit ──────────────────────────────────────
    // The trainer's own row is excluded so they can keep their existing
    // phone. Empty/undefined phone passes (no change to the row below).
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
      const pFmt = validatePhoneFormat(phone, { required: false });
      if (!pFmt.ok) return res.status(pFmt.status).json(pFmt.body);
      if (pFmt.value) {
        const pUnique = await ensurePhoneUnique(pFmt.value, {
          excludeUserId: check.rows[0].user_id,
        });
        if (!pUnique.ok) return res.status(pUnique.status).json(pUnique.body);
      }
    }

    await client.query('BEGIN');

    // When the client sends a structured skills array, that becomes the
    // source of truth: we replace the JSONB and derive legacy singletons
    // from it (specialization / belt_level / experience_years /
    // certificate_url). When it doesn't, the individual legacy fields
    // pass through the normal COALESCE-based partial update below.
    const skillsArr = normaliseSkills(rawSkills);
    const useSkillsArr = skillsArr !== null;
    const legacy = useSkillsArr && skillsArr.length > 0
      ? legacyFromSkills(skillsArr)
      : {
          specialization,
          belt_level,
          experience_years: experience_years != null ? Number(experience_years) : null,
          certificate_url,
        };

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
         certificate_url   = COALESCE($10, certificate_url),
         skills            = COALESCE($11::jsonb, skills)
       WHERE id = $12`,
      [
        legacy.specialization || null, legacy.belt_level || null,
        legacy.experience_years != null ? Number(legacy.experience_years) : null,
        bio || null,
        gender || null, date_of_birth || null,
        govt_proof_type || null, govt_proof_number || null,
        photo_url || null, legacy.certificate_url || null,
        useSkillsArr ? JSON.stringify(skillsArr) : null,
        id,
      ]
    );

    // User identity fields (kept in users table so admin lists + login work).
    // Email is now editable too — cleanEmail is set only when a valid
    // non-empty value was supplied and passed the uniqueness gate.
    if (name || phone || cleanEmail) {
      await client.query(
        `UPDATE users SET
           name  = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone)
         WHERE id = $4`,
        [name || null, cleanEmail, phone || null, check.rows[0].user_id]
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

// DELETE trainer — SOFT delete so email/phone can be reused later.
//
// We flip users.is_deleted = TRUE and stamp deleted_at / deleted_by
// instead of running a hard DELETE. That preserves audit history
// (batches / attendance / feedback rows that FK to the user stay
// intact) AND — combined with the partial-unique indexes from
// migration 050 — clears the email/phone from the "live" uniqueness
// pool so a new user can register with them immediately.
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Soft-delete the user row. Also mark them 'inactive' so future
      // sign-in attempts are rejected cleanly.
      await client.query(
        `UPDATE users
            SET is_deleted = TRUE,
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by = $2,
                status     = 'inactive'
          WHERE id = $1`,
        [check.rows[0].user_id, req.user.id],
      );
      // Also flag the trainer row so lists filter it out. `trainers.is_deleted`
      // is optional (older DBs don't have the column). We wrap the update in
      // a SAVEPOINT so if the column doesn't exist, ONLY this statement is
      // rolled back — otherwise the failed statement would abort the whole
      // transaction and silently roll back the users soft-delete too.
      try {
        await client.query('SAVEPOINT trainer_flag');
        await client.query(
          `UPDATE trainers SET is_deleted = TRUE WHERE id = $1`,
          [id],
        );
        await client.query('RELEASE SAVEPOINT trainer_flag');
      } catch (flagErr) {
        await client.query('ROLLBACK TO SAVEPOINT trainer_flag');
        // Column doesn't exist on older DBs — safe to ignore, the users
        // filter alone excludes them from listings.
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ message: 'Trainer removed. Their email and phone are now free for reuse.' });
  } catch (err) {
    console.error('Delete trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};