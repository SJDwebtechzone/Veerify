const bcrypt = require('bcrypt');
const pool = require('../config/db');

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

    res.status(201).json({
      message: 'Trainer created successfully',
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
exports.updateTrainer = async (req, res) => {
  try {
    const { id } = req.params;
    const { specialization, belt_level, experience_years, bio } = req.body;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    // Verify ownership
    const check = await pool.query(
      'SELECT institution_id FROM trainers WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer not found' });
    }

    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'You can only update trainers in your own institution' });
    }

    const result = await pool.query(
      `UPDATE trainers 
       SET specialization = COALESCE($1, specialization),
           belt_level = COALESCE($2, belt_level),
           experience_years = COALESCE($3, experience_years),
           bio = COALESCE($4, bio)
       WHERE id = $5
       RETURNING *`,
      [specialization, belt_level, experience_years, bio, id]
    );

    res.json({
      message: 'Trainer updated successfully',
      trainer: result.rows[0]
    });
  } catch (err) {
    console.error('Update trainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
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