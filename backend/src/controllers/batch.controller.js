const pool = require('../config/db');

const getAdminInstitutionId = async (userId) => {
  const result = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.institution_id;
};

// CREATE batch
exports.createBatch = async (req, res) => {
  try {
    const { course_id, trainer_id, name, days_of_week, start_time, end_time, capacity, mode } = req.body;
    const adminId = req.user.id;

    if (!course_id || !name) {
      return res.status(400).json({ message: 'course_id and name are required' });
    }

    const institutionId = await getAdminInstitutionId(adminId);
    if (!institutionId) {
      return res.status(400).json({ message: 'You must create an institution first' });
    }

    // Verify the course belongs to this institution
    const courseCheck = await pool.query(
      'SELECT institution_id FROM courses WHERE id = $1',
      [course_id]
    );

    if (courseCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (courseCheck.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Course does not belong to your institution' });
    }

    // If trainer_id provided, verify trainer is in this institution
    if (trainer_id) {
      const trainerCheck = await pool.query(
        'SELECT institution_id FROM trainers WHERE id = $1',
        [trainer_id]
      );
      if (trainerCheck.rows.length === 0 || trainerCheck.rows[0].institution_id !== institutionId) {
        return res.status(403).json({ message: 'Trainer does not belong to your institution' });
      }
    }

    const result = await pool.query(
      `INSERT INTO batches (course_id, institution_id, trainer_id, name, days_of_week, start_time, end_time, capacity, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [course_id, institutionId, trainer_id, name, days_of_week, start_time, end_time, capacity || 20, mode || 'offline']
    );

    res.status(201).json({
      message: 'Batch created successfully',
      batch: result.rows[0]
    });
  } catch (err) {
    console.error('Create batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my institution's batches
exports.getMyBatches = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);

    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, u.name AS trainer_name
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE b.institution_id = $1
       ORDER BY b.created_at DESC`,
      [institutionId]
    );

    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('Get batches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET batches by course (public)
exports.getBatchesByCourse = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, u.name AS trainer_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE b.course_id = $1
       ORDER BY b.created_at DESC`,
      [id]
    );

    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('Get batches by course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET single batch (public)
exports.getBatchById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, c.price AS course_price, 
              u.name AS trainer_name, i.name AS institution_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON b.institution_id = i.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE b.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.json({ batch: result.rows[0] });
  } catch (err) {
    console.error('Get batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE batch
exports.updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { trainer_id, name, days_of_week, start_time, end_time, capacity, mode } = req.body;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    const check = await pool.query('SELECT institution_id FROM batches WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'Not your batch' });
    }

    const result = await pool.query(
      `UPDATE batches SET 
         trainer_id = COALESCE($1, trainer_id),
         name = COALESCE($2, name),
         days_of_week = COALESCE($3, days_of_week),
         start_time = COALESCE($4, start_time),
         end_time = COALESCE($5, end_time),
         capacity = COALESCE($6, capacity),
         mode = COALESCE($7, mode)
       WHERE id = $8 RETURNING *`,
      [trainer_id, name, days_of_week, start_time, end_time, capacity, mode, id]
    );

    res.json({ message: 'Batch updated', batch: result.rows[0] });
  } catch (err) {
    console.error('Update batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE batch
exports.deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    const check = await pool.query('SELECT institution_id FROM batches WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'Not your batch' });
    }

    await pool.query('DELETE FROM batches WHERE id = $1', [id]);
    res.json({ message: 'Batch deleted successfully' });
  } catch (err) {
    console.error('Delete batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET batches assigned to a trainer (trainer logs in)
exports.getMyTrainerBatches = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the trainer record for this user
    const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [userId]);
    if (trainerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer profile not found' });
    }

    const trainerId = trainerResult.rows[0].id;

    const result = await pool.query(
      `SELECT b.*, c.name AS course_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       WHERE b.trainer_id = $1
       ORDER BY b.created_at DESC`,
      [trainerId]
    );

    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('Get trainer batches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};