// backend/src/controllers/announcement.controller.js
//
// Institution admin broadcasts. The admin composes a title + message,
// picks an audience, and we fan out one notifications row per recipient
// inside a transaction so partial deliveries don't happen.
//
// Audiences supported today:
//   - 'staff'    : every trainer in the calling admin's institution
//
// Designed to grow: adding 'students' / 'batch' / 'course' is a new case
// in resolveAudience() returning an array of user IDs. The fan-out and
// HTTP shape stay identical.

const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

async function getAdminInstitutionId(userId) {
  const r = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// Returns an array of user IDs to notify for a given audience string.
async function resolveAudience(audience, institutionId) {
  switch (audience) {
    case 'staff': {
      const r = await pool.query(
        `SELECT u.id
         FROM trainers t
         JOIN users u ON t.user_id = u.id
         WHERE t.institution_id = $1
           AND COALESCE(u.is_deleted, false) = false`,
        [institutionId],
      );
      return r.rows.map((row) => row.id);
    }
    case 'students': {
      const r = await pool.query(
        `SELECT DISTINCT e.student_id AS id
         FROM enrollments e
         JOIN batches b ON e.batch_id = b.id
         JOIN users u ON e.student_id = u.id
         WHERE b.institution_id = $1
           AND COALESCE(u.is_deleted, false) = false`,
        [institutionId],
      );
      return r.rows.map((row) => row.id);
    }
    case 'parents': {
      // Every parent whose actively-linked child is enrolled in at least
      // one batch of this institution. Only includes active links so
      // pending / rejected link requests don't spam parents.
      const r = await pool.query(
        `SELECT DISTINCT pcl.parent_id AS id
         FROM parent_child_links pcl
         JOIN enrollments e ON e.student_id = pcl.child_id
         JOIN batches b ON e.batch_id = b.id
         JOIN users u ON pcl.parent_id = u.id
         WHERE b.institution_id = $1
           AND pcl.status = 'active'
           AND COALESCE(u.is_deleted, false) = false`,
        [institutionId],
      );
      return r.rows.map((row) => row.id);
    }
    case 'all': {
      const staff    = await resolveAudience('staff',    institutionId);
      const students = await resolveAudience('students', institutionId);
      const parents  = await resolveAudience('parents',  institutionId);
      // De-dup just in case someone has multiple roles (rare).
      return [...new Set([...staff, ...students, ...parents])];
    }
    default:
      return [];
  }
}

// GET /api/announcements/audience-counts
// Lightweight count endpoint the composer uses to show "Will reach N people"
// before the admin hits Send.
exports.audienceCounts = async (req, res) => {
  try {
    const adminId = req.user.id;
    const institutionId = await getAdminInstitutionId(adminId);
    if (!institutionId) {
      return res.status(400).json({ message: 'No institution linked to your account' });
    }

    const [staff, students, parents] = await Promise.all([
      resolveAudience('staff',    institutionId),
      resolveAudience('students', institutionId),
      resolveAudience('parents',  institutionId),
    ]);

    res.json({
      counts: {
        staff:    staff.length,
        students: students.length,
        parents:  parents.length,
        all:      new Set([...staff, ...students, ...parents]).size,
      },
    });
  } catch (err) {
    console.error('audienceCounts error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/announcements
// Body: { audience: 'staff'|'students'|'all', title, message, category? }
exports.send = async (req, res) => {
  const client = await pool.connect();
  try {
    const adminId = req.user.id;
    const {
      audience = 'staff',
      title,
      message = null,
      category = 'announcement',
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const institutionId = await getAdminInstitutionId(adminId);
    if (!institutionId) {
      return res.status(400).json({ message: 'No institution linked to your account' });
    }

    const recipientIds = await resolveAudience(audience, institutionId);
    if (recipientIds.length === 0) {
      return res.status(400).json({
        message: 'No recipients found for that audience',
      });
    }

    // Fan out inside a single transaction. If one insert fails we roll back
    // the whole batch so the admin can retry without duplicate deliveries.
    await client.query('BEGIN');
    for (const userId of recipientIds) {
      await insertNotification({
        user_id:        userId,
        institution_id: institutionId,
        category,
        title:          String(title).trim(),
        message:        message ? String(message).trim() : null,
        data:           { source: 'announcement', audience },
        created_by:     adminId,
      }, client);
    }
    await client.query('COMMIT');

    res.status(201).json({
      message: `Announcement sent to ${recipientIds.length} ${recipientIds.length === 1 ? 'person' : 'people'}.`,
      delivered_count: recipientIds.length,
      audience,
      category,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('announcement send error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
