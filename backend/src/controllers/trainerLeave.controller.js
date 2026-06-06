const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Trainer leave requests
// ─────────────────────────────────────────────────────────────────────────────
// Flow:
//   trainer        → POST /api/trainer-leave-requests
//                  → GET  /api/trainer-leave-requests/my
//   institution    → GET  /api/trainer-leave-requests
//   admin (owner)  → POST /api/trainer-leave-requests/:id/approve
//                  → POST /api/trainer-leave-requests/:id/reject
//
// Auth:
//   - Only trainers can create.
//   - Only the institution admin (users.role='admin' whose institution_id
//     matches the trainer's) can approve/reject.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: pull the trainers row for the logged-in user. Returns null if the
// caller isn't actually a trainer (e.g. signed in as admin).
async function getTrainerForUser(userId) {
  const r = await pool.query(
    `SELECT id, institution_id FROM trainers WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] || null;
}

// Helper: pull the calling admin's institution_id.
async function getAdminInstitutionId(userId) {
  const r = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// CREATE — trainer submits a leave request.
exports.create = async (req, res) => {
  try {
    const { start_date, end_date, reason } = req.body;
    if (!start_date || !end_date) {
      return res.status(400).json({ message: 'start_date and end_date are required' });
    }
    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ message: 'end_date cannot be before start_date' });
    }

    const trainer = await getTrainerForUser(req.user.id);
    if (!trainer) {
      return res.status(403).json({ message: 'Only trainers can submit leave requests via this endpoint.' });
    }
    if (!trainer.institution_id) {
      return res.status(400).json({ message: 'Trainer is not linked to an institution.' });
    }

    const result = await pool.query(
      `INSERT INTO trainer_leave_requests
         (trainer_id, institution_id, start_date, end_date, reason, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [trainer.id, trainer.institution_id, start_date, end_date, reason || null, req.user.id],
    );
    const lr = result.rows[0];

    // Notify the institution owner (admin). Best-effort — don't fail the
    // create on a notification write error.
    try {
      const owner = await pool.query(
        `SELECT owner_user_id, name AS institution_name
           FROM institutions
          WHERE id = $1`,
        [trainer.institution_id],
      );
      const trainerName = await pool.query(
        `SELECT name FROM users WHERE id = $1`, [req.user.id],
      );
      const adminId = owner.rows[0]?.owner_user_id;
      if (adminId) {
        await insertNotification({
          user_id:        adminId,
          institution_id: trainer.institution_id,
          category:       'leave',
          title:          'Trainer leave request',
          message:        `${trainerName.rows[0]?.name || 'A trainer'} requested leave from ${start_date} to ${end_date}` + (reason ? ` — ${reason}` : ''),
          data:           { screen: 'AdminTrainerLeaves', trainer_leave_request_id: lr.id },
          created_by:     req.user.id,
        });
      }
    } catch (err) {
      console.warn('[trainerLeave.create] notify admin failed:', err.message);
    }

    res.status(201).json({ message: 'Leave request submitted', leave_request: lr });
  } catch (err) {
    console.error('Trainer leave create error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET — calling trainer's own history (all statuses).
exports.getMy = async (req, res) => {
  try {
    const trainer = await getTrainerForUser(req.user.id);
    if (!trainer) {
      return res.status(403).json({ message: 'You are not registered as a trainer.' });
    }
    const result = await pool.query(
      `SELECT lr.*,
              rev.name AS reviewed_by_name
         FROM trainer_leave_requests lr
         LEFT JOIN users rev ON lr.reviewed_by = rev.id
        WHERE lr.trainer_id = $1
        ORDER BY lr.created_at DESC`,
      [trainer.id],
    );
    res.json({
      count:           result.rows.length,
      counts:          await trainerCounts(trainer.id),
      leave_requests:  result.rows,
    });
  } catch (err) {
    console.error('Trainer leave my error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Counts strip for the trainer-side history screen.
async function trainerCounts(trainerId) {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')  AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected,
       COUNT(*)                                     AS total
       FROM trainer_leave_requests
      WHERE trainer_id = $1`,
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

// GET — institution admin scope. ?status=pending|approved|rejected|all
exports.getForAdmin = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'You are not linked to an institution.' });
    }
    const { status } = req.query;
    const params = [institutionId];
    let where = `lr.institution_id = $1`;
    if (status && status !== 'all') {
      params.push(status);
      where += ` AND lr.status = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT lr.*,
              u.name           AS trainer_name,
              u.email          AS trainer_email,
              u.phone          AS trainer_phone,
              t.specialization AS trainer_skills,
              t.belt_level     AS trainer_belt,
              t.photo_url      AS trainer_photo_url,
              req.name         AS requested_by_name,
              rev.name         AS reviewed_by_name
         FROM trainer_leave_requests lr
         JOIN trainers t ON lr.trainer_id = t.id
         JOIN users u    ON t.user_id = u.id
         LEFT JOIN users req ON lr.requested_by = req.id
         LEFT JOIN users rev ON lr.reviewed_by = rev.id
        WHERE ${where}
        ORDER BY
          CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,
          lr.created_at DESC`,
      params,
    );
    res.json({
      count:          result.rows.length,
      counts:         await adminCounts(institutionId),
      leave_requests: result.rows,
    });
  } catch (err) {
    console.error('Trainer leave admin list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

async function adminCounts(institutionId) {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')  AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected')  AS rejected,
       COUNT(*)                                     AS total
       FROM trainer_leave_requests
      WHERE institution_id = $1`,
    [institutionId],
  );
  const c = r.rows[0] || {};
  return {
    pending:  Number(c.pending  || 0),
    approved: Number(c.approved || 0),
    rejected: Number(c.rejected || 0),
    total:    Number(c.total    || 0),
  };
}

// APPROVE.
exports.approve = async (req, res) => {
  return decide(req, res, 'approved');
};

// REJECT.
exports.reject = async (req, res) => {
  return decide(req, res, 'rejected');
};

// Safe ISO-day formatter — accepts JS Date, Postgres-string, or null without
// throwing. Returns 'unknown' on bad input so the notification body never
// crashes the response path.
function safeIsoDay(value) {
  if (!value) return 'unknown';
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return 'unknown';
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  // Already looks like 'YYYY-MM-DD...' — slice and run.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

// Shared approve/reject implementation. The two endpoints differ only in the
// status they write and the notification message they fan out.
async function decide(req, res, decision) {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    const reviewerId = req.user.id;

    // Caller must be an admin of the institution that owns the request.
    const adminInstId = await getAdminInstitutionId(reviewerId);
    if (!adminInstId) {
      return res.status(403).json({
        message: 'You are not linked to an institution. Re-login as the academy owner.',
      });
    }

    const existing = await pool.query(
      `SELECT lr.*, t.user_id AS trainer_user_id, u.name AS trainer_name
         FROM trainer_leave_requests lr
         JOIN trainers t ON lr.trainer_id = t.id
         JOIN users u    ON t.user_id = u.id
        WHERE lr.id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Leave request not found' });
    }
    const lr = existing.rows[0];

    // Number() on both sides — PG normally returns INTEGER as JS number, but
    // some configs (or stringified JWT claims) can yield a string. Strict ===
    // would falsely fail in that case, so we coerce both first.
    if (Number(lr.institution_id) !== Number(adminInstId)) {
      console.warn('[trainerLeave.decide] institution mismatch — lr.institution_id=',
        lr.institution_id, 'adminInstId=', adminInstId);
      return res.status(403).json({
        message: `This leave belongs to a different institution (#${lr.institution_id}). Your account is on institution #${adminInstId}.`,
      });
    }
    if (lr.status !== 'pending') {
      return res.status(409).json({
        message: `This request is already ${lr.status}.`,
      });
    }

    const updated = await pool.query(
      `UPDATE trainer_leave_requests SET
         status      = $1,
         reviewed_by = $2,
         reviewed_at = NOW(),
         review_note = $3
       WHERE id = $4
       RETURNING *`,
      [decision, reviewerId, note || null, id],
    );

    // Notify the trainer about the decision. Best-effort — wrapped so a date
    // format issue can't make the API call appear to fail.
    try {
      await insertNotification({
        user_id:        lr.trainer_user_id,
        institution_id: lr.institution_id,
        category:       'leave',
        title:          decision === 'approved' ? 'Leave approved' : 'Leave rejected',
        message:        `Your leave request from ${safeIsoDay(lr.start_date)} to ${safeIsoDay(lr.end_date)} was ${decision}` + (note ? ` — ${note}` : ''),
        data:           { screen: 'TrainerRequestLeave', trainer_leave_request_id: lr.id },
        created_by:     reviewerId,
      });
    } catch (err) {
      console.warn('[trainerLeave.decide] notify trainer failed:', err.message);
    }

    res.json({
      message: decision === 'approved' ? 'Leave request approved' : 'Leave request rejected',
      leave_request: updated.rows[0],
    });
  } catch (err) {
    console.error('Trainer leave decide error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}
