const pool = require('../config/db');

// Helper: verify the trainer owns this batch
const verifyTrainerOwnsBatch = async (userId, batchId) => {
  const result = await pool.query(
    `SELECT b.id 
     FROM batches b 
     JOIN trainers t ON b.trainer_id = t.id 
     WHERE b.id = $1 AND t.user_id = $2`,
    [batchId, userId]
  );
  return result.rows.length > 0;
};

// MARK attendance (single student)
exports.markAttendance = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: 'Request body is required with student_id, batch_id, and date' });
    }
    const { student_id, batch_id, date, status } = req.body;
    const trainerId = req.user.id;

    if (!student_id || !batch_id || !date) {
      return res.status(400).json({ message: 'student_id, batch_id, and date are required' });
    }

    // Verify trainer owns this batch
    const ownsBatch = await verifyTrainerOwnsBatch(trainerId, batch_id);
    if (!ownsBatch) {
      return res.status(403).json({ message: 'You are not assigned to this batch' });
    }

    // Verify student is enrolled in this batch
    const enrollCheck = await pool.query(
      'SELECT id, institution_id FROM enrollments WHERE student_id = $1 AND batch_id = $2',
      [student_id, batch_id]
    );
    if (enrollCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Student is not enrolled in this batch' });
    }

    const institutionId = enrollCheck.rows[0].institution_id;

    // Insert or update (UPSERT)
    const result = await pool.query(
      `INSERT INTO attendance (student_id, batch_id, institution_id, date, status, marked_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, batch_id, date) 
       DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by
       RETURNING *`,
      [student_id, batch_id, institutionId, date, status || 'present', trainerId]
    );

    res.status(201).json({
      message: 'Attendance marked',
      attendance: result.rows[0]
    });
  } catch (err) {
    console.error('Mark attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// BULK mark attendance (for the whole batch in one go)
exports.markBulkAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    const { batch_id, date, records } = req.body;
    // records = [{ student_id: 1, status: 'present' }, { student_id: 2, status: 'absent' }, ...]
    const trainerId = req.user.id;

    if (!batch_id || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: 'batch_id, date, and records array are required' });
    }

    const ownsBatch = await verifyTrainerOwnsBatch(trainerId, batch_id);
    if (!ownsBatch) {
      return res.status(403).json({ message: 'You are not assigned to this batch' });
    }

    // Get institution_id from batch
    const batchResult = await pool.query('SELECT institution_id FROM batches WHERE id = $1', [batch_id]);
    const institutionId = batchResult.rows[0].institution_id;

    await client.query('BEGIN');

    const inserted = [];
    for (const record of records) {
      const result = await client.query(
        `INSERT INTO attendance (student_id, batch_id, institution_id, date, status, marked_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, batch_id, date) 
         DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by
         RETURNING *`,
        [record.student_id, batch_id, institutionId, date, record.status || 'present', trainerId]
      );
      inserted.push(result.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `Attendance marked for ${inserted.length} students`,
      attendance: inserted
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// GET attendance for a batch (trainer/admin)
exports.getAttendanceByBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;  // optional ?date=2026-05-08
    const userId = req.user.id;
    const userRole = req.user.role;

    // Auth check
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id FROM batches WHERE id = $1',
      [id]
    );
    if (batchResult.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    const batch = batchResult.rows[0];

    if (userRole === 'admin') {
      const userResult = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
      if (userResult.rows[0].institution_id !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
    } else if (userRole === 'trainer') {
      const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [userId]);
      if (trainerResult.rows.length === 0 || trainerResult.rows[0].id !== batch.trainer_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Build query (with optional date filter)
    let query = `
      SELECT a.*, u.name AS student_name, u.email AS student_email
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      WHERE a.batch_id = $1`;
    const params = [id];

    if (date) {
      query += ' AND a.date = $2';
      params.push(date);
    }

    query += ' ORDER BY a.date DESC, u.name';

    const result = await pool.query(query, params);

    res.json({ count: result.rows.length, attendance: result.rows });
  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my attendance (student)
exports.getMyAttendance = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT a.*, b.name AS batch_name, c.name AS course_name
       FROM attendance a
       JOIN batches b ON a.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       WHERE a.student_id = $1
       ORDER BY a.date DESC`,
      [studentId]
    );

    // Calculate summary stats
    const total = result.rows.length;
    const present = result.rows.filter(r => r.status === 'present').length;
    const absent = result.rows.filter(r => r.status === 'absent').length;
    const late = result.rows.filter(r => r.status === 'late').length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

    res.json({
      summary: { total, present, absent, late, percentage },
      attendance: result.rows
    });
  } catch (err) {
    console.error('Get my attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};