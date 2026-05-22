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
    const { name, email, phone, password, specialization, belt_level, experience_years, bio } = req.body;
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

    // Step 2: Create trainer profile
    const trainerResult = await client.query(
      `INSERT INTO trainers (user_id, institution_id, specialization, belt_level, experience_years, bio)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.id, institutionId, specialization, belt_level, experience_years || 0, bio]
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