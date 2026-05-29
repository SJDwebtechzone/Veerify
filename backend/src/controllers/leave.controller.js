const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Leave requests
// ─────────────────────────────────────────────────────────────────────────────
// Workflow:
//   - Student / parent  → POST /api/leave-requests          (create)
//   - Student           → GET  /api/leave-requests/my       (own history)
//   - Trainer           → GET  /api/leave-requests/trainer/my?status=pending
//                         POST /api/leave-requests/:id/approve
//                         POST /api/leave-requests/:id/reject
//   - Admin             → GET  /api/leave-requests          (institution scope)
//
// Authorisation rules:
//   Only the trainer assigned to a leave's batch (via trainers.user_id) or an
//   admin of the institution can approve/reject. Cross-batch trainers cannot
//   peek at each other's requests.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Helpers ────────────────────────────────────────────────────────────────
async function getTrainerId(userId) {
  const r = await pool.query('SELECT id, institution_id FROM trainers WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}

async function getAdminInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

// CREATE — student or parent submits a leave request.
//
// Auth rules:
//   - Student role: can only submit for themselves (student_id must match the
//     authenticated user).
//   - Parent role: can submit only for children actually linked to them in
//     parent_child_links with status='active'. This stops a random parent
//     account from submitting leave for someone else's kid.
exports.create = async (req, res) => {
  try {
    const { student_id, batch_id, start_date, end_date, reason } = req.body;
    const requestedBy = req.user.id;
    const role = req.user.role;

    if (!student_id || !start_date || !end_date) {
      return res.status(400).json({ message: 'student_id, start_date, end_date are required' });
    }

    if (role === 'student' && Number(student_id) !== Number(requestedBy)) {
      return res.status(403).json({ message: 'Students can only submit leave for themselves.' });
    }
    if (role === 'parent') {
      const link = await pool.query(
        `SELECT id FROM parent_child_links
          WHERE parent_id = $1 AND child_id = $2 AND status = 'active'`,
        [requestedBy, student_id],
      );
      if (link.rows.length === 0) {
        return res.status(403).json({ message: 'This child is not linked to your parent account.' });
      }
    }

    // Pull institution_id (from the student's user record or, preferably, the
    // batch row when provided).
    let institutionId;
    if (batch_id) {
      const b = await pool.query('SELECT institution_id FROM batches WHERE id = $1', [batch_id]);
      if (b.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
      institutionId = b.rows[0].institution_id;
    } else {
      const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [student_id]);
      institutionId = u.rows[0]?.institution_id;
    }
    if (!institutionId) {
      return res.status(400).json({ message: 'Could not determine the student\'s institution.' });
    }

    const result = await pool.query(
      `INSERT INTO leave_requests
         (student_id, batch_id, institution_id, start_date, end_date, reason, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [student_id, batch_id || null, institutionId, start_date, end_date, reason || null, requestedBy],
    );
    const lr = result.rows[0];

    // Fan out a "leave" category notification to the batch trainer (when
    // batch_id is present). Best-effort — don't fail the create on a
    // notification write error.
    try {
      if (lr.batch_id) {
        const t = await pool.query(
          `SELECT t.user_id, b.name AS batch_name, u.name AS student_name
             FROM batches b
             JOIN trainers t ON b.trainer_id = t.id
             JOIN users u ON u.id = $1
            WHERE b.id = $2`,
          [lr.student_id, lr.batch_id],
        );
        const trainerUserId = t.rows[0]?.user_id;
        if (trainerUserId) {
          await insertNotification({
            user_id:        trainerUserId,
            institution_id: lr.institution_id,
            category:       'leave',
            title:          'New leave request',
            message:        `${t.rows[0].student_name} requested leave from ${start_date} to ${end_date}` + (reason ? ` — ${reason}` : ''),
            data:           { screen: 'StaffLeaveRequests', leave_request_id: lr.id, batch_id: lr.batch_id },
            created_by:     requestedBy,
          });
        }
      }
    } catch (err) {
      console.warn('[leave.create] notify trainer failed:', err.message);
    }

    res.status(201).json({ message: 'Leave request submitted', leave_request: lr });
  } catch (err) {
    console.error('Create leave request error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET — leave requests visible to the calling trainer.
// Query param ?status=pending|approved|rejected|all  (default: all)
exports.getForTrainer = async (req, res) => {
  try {
    const trainer = await getTrainerId(req.user.id);
    if (!trainer) return res.status(403).json({ message: 'You are not registered as a trainer' });

    const { status } = req.query;

    // Only requests for batches this trainer is assigned to.
    const params = [trainer.id];
    let where = `b.trainer_id = $1`;
    if (status && status !== 'all') {
      params.push(status);
      where += ` AND lr.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT lr.*,
              u.name  AS student_name,
              u.email AS student_email,
              b.name  AS batch_name,
              req.name  AS requested_by_name,
              rev.name  AS reviewed_by_name
         FROM leave_requests lr
         JOIN users u ON lr.student_id = u.id
         LEFT JOIN batches b ON lr.batch_id = b.id
         LEFT JOIN users req ON lr.requested_by = req.id
         LEFT JOIN users rev ON lr.reviewed_by = rev.id
        WHERE ${where}
        ORDER BY
          CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,
          lr.created_at DESC`,
      params,
    );

    res.json({
      count: result.rows.length,
      counts: await trainerCounts(trainer.id),
      leave_requests: result.rows,
    });
  } catch (err) {
    console.error('Get trainer leave requests error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Helper for the trainer counts strip on mobile.
async function trainerCounts(trainerId) {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE lr.status = 'pending')  AS pending,
       COUNT(*) FILTER (WHERE lr.status = 'approved') AS approved,
       COUNT(*) FILTER (WHERE lr.status = 'rejected') AS rejected,
       COUNT(*)                                        AS total
       FROM leave_requests lr
       JOIN batches b ON lr.batch_id = b.id
      WHERE b.trainer_id = $1`,
    [trainerId],
  );
  const c = r.rows[0] || {};
  return {
    pending:  Number(c.pending  || 0),
    approved: Number(c.approved || 0),
    rejected: Number(c.rejected || 0),
    total:    Number(c.total    || 0),
  };
}

// GET — parent's leave-request history across ALL linked children.
//   ?child_id=<id>  to scope to one child
//   ?status=pending|approved|rejected|cancelled
exports.getForParent = async (req, res) => {
  try {
    const parentId = req.user.id;
    const { child_id, status } = req.query;

    const where = [];
    const params = [parentId];
    where.push(`pcl.parent_id = $1 AND pcl.status = 'active'`);
    if (child_id) {
      params.push(child_id);
      where.push(`lr.student_id = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      where.push(`lr.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT lr.*,
              u.name  AS student_name,
              b.name  AS batch_name,
              rev.name AS reviewed_by_name
         FROM leave_requests lr
         JOIN parent_child_links pcl ON pcl.child_id = lr.student_id
         JOIN users u ON lr.student_id = u.id
         LEFT JOIN batches b ON lr.batch_id = b.id
         LEFT JOIN users rev ON lr.reviewed_by = rev.id
        WHERE ${where.join(' AND ')}
        ORDER BY lr.created_at DESC`,
      params,
    );
    res.json({ count: result.rows.length, leave_requests: result.rows });
  } catch (err) {
    console.error('Get parent leave requests error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET — student's own leave history.
exports.getMy = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lr.*, b.name AS batch_name,
              rev.name AS reviewed_by_name
         FROM leave_requests lr
         LEFT JOIN batches b ON lr.batch_id = b.id
         LEFT JOIN users rev ON lr.reviewed_by = rev.id
        WHERE lr.student_id = $1
        ORDER BY lr.created_at DESC`,
      [req.user.id],
    );
    res.json({ count: result.rows.length, leave_requests: result.rows });
  } catch (err) {
    console.error('Get my leave requests error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// APPROVE — sets status, stamps reviewer. Also writes leave attendance rows
// for every date in the range so the trainer's history reflects it.
exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { note } = req.body || {};

    const auth = await canReview(id, req.user);
    if (!auth.ok) return res.status(403).json({ message: auth.message });

    const updated = await pool.query(
      `UPDATE leave_requests SET
         status      = 'approved',
         reviewed_by = $1,
         reviewed_at = NOW(),
         review_note = $2
       WHERE id = $3
       RETURNING *`,
      [reviewerId, note || null, id],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Leave request not found' });
    }

    // Best-effort: stamp attendance.status = 'leave' for each covered date
    // (only when batch_id is present — the leave attendance rows are
    // per-batch). If a record already exists for that date, ON CONFLICT
    // updates it.
    const lr = updated.rows[0];
    if (lr.batch_id) {
      try {
        await pool.query(
          `INSERT INTO attendance (student_id, batch_id, institution_id, date, status, marked_by)
           SELECT $1, $2, $3, gs::date, 'leave', $4
             FROM generate_series($5::date, $6::date, '1 day') gs
           ON CONFLICT (student_id, batch_id, date)
           DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by`,
          [lr.student_id, lr.batch_id, lr.institution_id, reviewerId, lr.start_date, lr.end_date],
        );
      } catch (err) {
        // Don't fail the approve call on attendance write errors — they're
        // best-effort and the request itself is already approved.
        console.warn('[leave.approve] attendance write failed:', err.message);
      }
    }

    res.json({ message: 'Leave request approved', leave_request: lr });
  } catch (err) {
    console.error('Approve leave error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// REJECT.
exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;
    const { note } = req.body || {};

    const auth = await canReview(id, req.user);
    if (!auth.ok) return res.status(403).json({ message: auth.message });

    const updated = await pool.query(
      `UPDATE leave_requests SET
         status      = 'rejected',
         reviewed_by = $1,
         reviewed_at = NOW(),
         review_note = $2
       WHERE id = $3
       RETURNING *`,
      [reviewerId, note || null, id],
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Leave request not found' });
    }
    res.json({ message: 'Leave request rejected', leave_request: updated.rows[0] });
  } catch (err) {
    console.error('Reject leave error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Authorisation helper ──────────────────────────────────────────────────
// Returns { ok: true } when the calling user is the trainer of the batch the
// leave covers, or an admin of the institution. Otherwise { ok:false, message }.
async function canReview(leaveId, user) {
  const r = await pool.query(
    `SELECT lr.*, b.trainer_id, b.institution_id AS batch_institution_id
       FROM leave_requests lr
       LEFT JOIN batches b ON lr.batch_id = b.id
      WHERE lr.id = $1`,
    [leaveId],
  );
  if (r.rows.length === 0) return { ok: false, message: 'Leave request not found' };
  const lr = r.rows[0];

  if (user.role === 'admin') {
    const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [user.id]);
    if (u.rows[0]?.institution_id !== lr.institution_id) {
      return { ok: false, message: 'Not your institution\'s leave request' };
    }
    return { ok: true };
  }

  if (user.role === 'trainer') {
    const t = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [user.id]);
    if (t.rows.length === 0) return { ok: false, message: 'You are not registered as a trainer' };
    if (lr.batch_id && t.rows[0].id !== lr.trainer_id) {
      return { ok: false, message: 'Not your batch\'s leave request' };
    }
    return { ok: true };
  }

  return { ok: false, message: 'Access denied' };
}
