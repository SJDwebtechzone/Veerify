const pool = require('../config/db');

// CREATE enrollment (student enrolls in a batch)
exports.enrollInBatch = async (req, res) => {
  try {
    const { batch_id } = req.body;
    const studentId = req.user.id;

    if (!batch_id) {
      return res.status(400).json({ message: 'batch_id is required' });
    }

    // Get batch details + capacity check
    const batchResult = await pool.query(
      `SELECT b.*, 
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b WHERE b.id = $1`,
      [batch_id]
    );

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Capacity check
    if (parseInt(batch.enrolled_count) >= batch.capacity) {
      return res.status(409).json({ message: 'Batch is full. No seats available.' });
    }

    // Check duplicate enrollment
    const existing = await pool.query(
      'SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2',
      [studentId, batch_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'You are already enrolled in this batch' });
    }

    // Create enrollment
    const result = await pool.query(
      `INSERT INTO enrollments (student_id, batch_id, institution_id, payment_status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [studentId, batch_id, batch.institution_id]
    );

    // Update student's institution_id (if not set)
    await pool.query(
      `UPDATE users SET institution_id = $1 
       WHERE id = $2 AND institution_id IS NULL`,
      [batch.institution_id, studentId]
    );

    res.status(201).json({
      message: 'Enrolled successfully. Please complete payment.',
      enrollment: result.rows[0]
    });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my enrollments (student)
exports.getMyEnrollments = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT e.*, 
              b.name AS batch_name, b.days_of_week, b.start_time, b.end_time, b.mode,
              c.name AS course_name, c.price AS course_price,
              i.name AS institution_name, i.city AS institution_city,
              u.name AS trainer_name
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON e.institution_id = i.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE e.student_id = $1
       ORDER BY e.enrolled_at DESC`,
      [studentId]
    );

    res.json({ count: result.rows.length, enrollments: result.rows });
  } catch (err) {
    console.error('Get my enrollments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET students enrolled in a batch (admin/trainer view)
exports.getEnrollmentsByBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get batch info
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id FROM batches WHERE id = $1',
      [id]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Authorization check
    if (userRole === 'admin') {
      // Admin must own this batch's institution
      const userResult = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
      if (userResult.rows[0].institution_id !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
    } else if (userRole === 'trainer') {
      // Trainer must be assigned to this batch
      const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [userId]);
      if (trainerResult.rows.length === 0 || trainerResult.rows[0].id !== batch.trainer_id) {
        return res.status(403).json({ message: 'You are not assigned to this batch' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get enrollments
    const result = await pool.query(
      `SELECT e.*, u.name AS student_name, u.email AS student_email, u.phone AS student_phone
       FROM enrollments e
       JOIN users u ON e.student_id = u.id
       WHERE e.batch_id = $1
       ORDER BY e.enrolled_at`,
      [id]
    );

    res.json({ count: result.rows.length, enrollments: result.rows });
  } catch (err) {
    console.error('Get enrollments by batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CANCEL enrollment (student deletes their own)
exports.cancelEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      'SELECT student_id FROM enrollments WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    if (check.rows[0].student_id !== studentId) {
      return res.status(403).json({ message: 'You can only cancel your own enrollments' });
    }

    await pool.query('DELETE FROM enrollments WHERE id = $1', [id]);
    res.json({ message: 'Enrollment cancelled' });
  } catch (err) {
    console.error('Cancel enrollment error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// MARK as paid (fake payment for demo)
exports.markPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      'SELECT student_id FROM enrollments WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    if (check.rows[0].student_id !== studentId) {
      return res.status(403).json({ message: 'Not your enrollment' });
    }

    const result = await pool.query(
      `UPDATE enrollments SET payment_status = 'paid' 
       WHERE id = $1 RETURNING *`,
      [id]
    );

    res.json({
      message: 'Payment successful',
      enrollment: result.rows[0]
    });
  } catch (err) {
    console.error('Mark paid error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};