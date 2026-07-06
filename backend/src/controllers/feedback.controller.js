// backend/src/controllers/feedback.controller.js
//
// Feedback capture from every mobile role + the super-admin read view.
//
// Endpoints:
//   POST   /api/feedback              — mobile submit (JWT required)
//   GET    /api/feedback              — super-admin list with filters
//                                       (role, rating, from, to, q)
//   GET    /api/feedback/:id          — super-admin detail
//   GET    /api/feedback/summary      — small aggregate for the sidebar
//                                       badge (counts by role + avg)

const pool = require('../config/db');

// Resolve the effective role_snapshot from the caller's users row.
// Admins split into main-branch vs branch based on their institution's
// parent_institution_id. Everyone else uses their users.role verbatim.
async function resolveRoleSnapshot(userId) {
  const r = await pool.query(
    `SELECT u.role, i.parent_institution_id
       FROM users u
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.role === 'admin') {
    return row.parent_institution_id ? 'branch_admin' : 'institution_admin';
  }
  if (['trainer', 'student', 'parent'].includes(row.role)) return row.role;
  return null; // super_admin etc. don't submit through this
}

// POST /api/feedback
// Body: { rating: 1..5, message?: string }
exports.submit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rating, message } = req.body || {};

    const rInt = parseInt(rating, 10);
    if (!Number.isInteger(rInt) || rInt < 1 || rInt > 5) {
      return res.status(400).json({ field: 'rating', message: 'Rating must be between 1 and 5.' });
    }

    const role = await resolveRoleSnapshot(userId);
    if (!role) {
      return res.status(403).json({ message: 'Your role cannot submit feedback here.' });
    }

    const u = await pool.query(
      `SELECT u.institution_id, i.parent_institution_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1`,
      [userId],
    );
    const uRow = u.rows[0] || {};
    const instId = uRow.institution_id || null;
    const parentId = uRow.parent_institution_id || null;

    // For a branch_admin, the "branch" is the caller's own institution
    // and the "institution" is its parent. For everyone else, the
    // caller sits at whichever institution they belong to (no branch).
    const branchId      = role === 'branch_admin' ? instId : null;
    const institutionId = role === 'branch_admin' ? parentId : instId;

    const trimmedMsg = message ? String(message).trim() : '';
    const result = await pool.query(
      `INSERT INTO feedback
         (user_id, role_snapshot, institution_id, branch_id, rating, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        role,
        institutionId,
        branchId,
        rInt,
        trimmedMsg || null,
      ],
    );

    res.status(201).json({
      message:  'Thanks for the feedback!',
      feedback: result.rows[0],
    });
  } catch (err) {
    console.error('feedback.submit error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/feedback?role=&rating=&from=&to=&q=&limit=&offset=
// Super-admin only. Returns joined user + institution details so the
// admin web can render the table without a second round-trip per row.
exports.list = async (req, res) => {
  try {
    const {
      role, rating, from, to, q,
      limit  = 100,
      offset = 0,
    } = req.query;

    const where  = [];
    const params = [];

    if (role) {
      params.push(role);
      where.push(`f.role_snapshot = $${params.length}`);
    }
    if (rating) {
      const r = parseInt(rating, 10);
      if (Number.isInteger(r) && r >= 1 && r <= 5) {
        params.push(r);
        where.push(`f.rating = $${params.length}`);
      }
    }
    if (from) {
      params.push(from);
      where.push(`f.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      // inclusive end-of-day
      params.push(to);
      where.push(`f.created_at <= ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      const p = `$${params.length}`;
      where.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR f.message ILIKE ${p} OR i.name ILIKE ${p} OR b.name ILIKE ${p})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(Math.min(parseInt(limit, 10) || 100, 500));
    const limitIdx  = params.length;
    params.push(parseInt(offset, 10) || 0);
    const offsetIdx = params.length;

    const rows = await pool.query(
      `SELECT
         f.id, f.role_snapshot, f.rating, f.message, f.created_at,
         u.id    AS user_id,
         u.name  AS user_name,
         u.email AS user_email,
         u.phone AS user_phone,
         i.id    AS institution_id,
         i.name  AS institution_name,
         b.id    AS branch_id,
         b.name  AS branch_name
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       LEFT JOIN institutions i ON i.id = f.institution_id
       LEFT JOIN institutions b ON b.id = f.branch_id
       ${whereSql}
       ORDER BY f.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    // Simple total count for pagination — safe to run in parallel since
    // pg pool handles it. Not doing a full window function so filters
    // stay index-friendly.
    const totalParams = params.slice(0, params.length - 2);
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM feedback f
         JOIN users u ON u.id = f.user_id
         LEFT JOIN institutions i ON i.id = f.institution_id
         LEFT JOIN institutions b ON b.id = f.branch_id
         ${whereSql}`,
      totalParams,
    );

    res.json({
      count: rows.rowCount,
      total: totalRes.rows[0].n,
      items: rows.rows,
    });
  } catch (err) {
    console.error('feedback.list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/feedback/:id — super-admin detail (currently same shape as list rows
// but sits behind a separate endpoint so we can enrich later without a bulk-query cost).
exports.get = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Bad id.' });
    const r = await pool.query(
      `SELECT
         f.id, f.role_snapshot, f.rating, f.message, f.created_at,
         u.id    AS user_id,
         u.name  AS user_name,
         u.email AS user_email,
         u.phone AS user_phone,
         i.id    AS institution_id,
         i.name  AS institution_name,
         b.id    AS branch_id,
         b.name  AS branch_name
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       LEFT JOIN institutions i ON i.id = f.institution_id
       LEFT JOIN institutions b ON b.id = f.branch_id
       WHERE f.id = $1`,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found.' });
    res.json({ feedback: r.rows[0] });
  } catch (err) {
    console.error('feedback.get error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/feedback/summary — small counts by role + overall avg rating.
// Powers the sidebar badge and the top-of-page stat cards on the admin web.
exports.summary = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int                                                     AS total,
         COALESCE(AVG(rating), 0)::numeric(3,2)                            AS avg_rating,
         COUNT(*) FILTER (WHERE role_snapshot = 'institution_admin')::int  AS institution_admin,
         COUNT(*) FILTER (WHERE role_snapshot = 'branch_admin')::int       AS branch_admin,
         COUNT(*) FILTER (WHERE role_snapshot = 'trainer')::int            AS trainer,
         COUNT(*) FILTER (WHERE role_snapshot = 'student')::int            AS student,
         COUNT(*) FILTER (WHERE role_snapshot = 'parent')::int             AS parent,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days
       FROM feedback`,
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('feedback.summary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
