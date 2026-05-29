const pool = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────
// Mobile inbox + admin announce/broadcast.
//
// Categories:
//   class_cancelled, leave, attendance, announcement, emergency, system
//
// All endpoints below require auth; user_id is taken from the JWT.

const VALID_CATEGORIES = new Set([
  'class_cancelled', 'leave', 'attendance', 'announcement', 'emergency', 'system',
]);

// Shared insert helper — used both from the HTTP layer and from other
// controllers that need to "fan out" a notification (e.g. when a leave
// request gets submitted, we drop one in the trainer's inbox).
async function insertNotification({
  user_id, institution_id = null, category = 'system',
  title, message = null, data = {}, created_by = null,
}, client = pool) {
  if (!user_id || !title) throw new Error('user_id and title are required');
  if (!VALID_CATEGORIES.has(category)) category = 'system';

  const res = await client.query(
    `INSERT INTO notifications
       (user_id, institution_id, category, title, message, data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING *`,
    [user_id, institution_id, category, title, message, JSON.stringify(data || {}), created_by],
  );
  return res.rows[0];
}
// Exported for cross-controller use.
exports.insertNotification = insertNotification;

// GET /api/notifications?category=&unread=true&limit=50
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const { category, unread, limit } = req.query;

    const where = ['user_id = $1'];
    const params = [userId];
    if (category && category !== 'all' && VALID_CATEGORIES.has(category)) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (unread === 'true') {
      where.push(`read_at IS NULL`);
    }
    const cap = Math.min(parseInt(limit, 10) || 100, 200);
    params.push(cap);

    const result = await pool.query(
      `SELECT * FROM notifications
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    // Counts for the category-tab badges on the mobile screen.
    const summary = await pool.query(
      `SELECT
         COUNT(*)                                                AS total,
         COUNT(*) FILTER (WHERE read_at IS NULL)                 AS unread,
         COUNT(*) FILTER (WHERE category = 'class_cancelled')    AS class_cancelled,
         COUNT(*) FILTER (WHERE category = 'leave')              AS leave,
         COUNT(*) FILTER (WHERE category = 'attendance')         AS attendance,
         COUNT(*) FILTER (WHERE category = 'announcement')       AS announcement,
         COUNT(*) FILTER (WHERE category = 'emergency')          AS emergency,
         COUNT(*) FILTER (WHERE category = 'system')             AS system
       FROM notifications WHERE user_id = $1`,
      [userId],
    );
    const c = summary.rows[0] || {};

    res.json({
      count: result.rows.length,
      counts: {
        total:           Number(c.total           || 0),
        unread:          Number(c.unread          || 0),
        class_cancelled: Number(c.class_cancelled || 0),
        leave:           Number(c.leave           || 0),
        attendance:      Number(c.attendance      || 0),
        announcement:    Number(c.announcement    || 0),
        emergency:       Number(c.emergency       || 0),
        system:          Number(c.system          || 0),
      },
      notifications: result.rows,
    });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL
        RETURNING *`,
      [id, userId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found or already read' });
    }
    res.json({ message: 'Marked read', notification: r.rows[0] });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id],
    );
    res.json({ message: 'All notifications marked read', updated: r.rowCount });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/notifications/:id
exports.remove = async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted', id: r.rows[0].id });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/notifications/announce   (trainer or admin)
// body: { batch_id?, audience: 'batch' | 'institution' | 'students', title, message, category, data }
// Fan-out: inserts one row per recipient. Returns the count.
exports.announce = async (req, res) => {
  try {
    const senderId = req.user.id;
    const role = req.user.role;
    const { batch_id, audience = 'batch', title, message, category = 'announcement', data = {} } = req.body || {};

    if (!title) return res.status(400).json({ message: 'title is required' });

    let recipientQuery;
    let queryParams;
    let institutionId = null;

    if (audience === 'batch') {
      if (!batch_id) return res.status(400).json({ message: 'batch_id is required for batch announcements' });
      // Auth: trainer must own this batch, or admin must own the institution.
      const b = await pool.query('SELECT trainer_id, institution_id FROM batches WHERE id = $1', [batch_id]);
      if (b.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
      institutionId = b.rows[0].institution_id;

      if (role === 'trainer') {
        const t = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [senderId]);
        if (t.rows.length === 0 || t.rows[0].id !== b.rows[0].trainer_id) {
          return res.status(403).json({ message: 'Not your batch' });
        }
      } else if (role === 'admin') {
        const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [senderId]);
        if (u.rows[0]?.institution_id !== institutionId) {
          return res.status(403).json({ message: 'Not your institution\'s batch' });
        }
      } else {
        return res.status(403).json({ message: 'Access denied' });
      }

      recipientQuery = 'SELECT DISTINCT student_id AS user_id FROM enrollments WHERE batch_id = $1';
      queryParams = [batch_id];
    } else if (audience === 'institution') {
      if (role !== 'admin') return res.status(403).json({ message: 'Only admins can broadcast to the whole institution' });
      const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [senderId]);
      institutionId = u.rows[0]?.institution_id;
      if (!institutionId) return res.status(400).json({ message: 'No institution for this admin' });

      // Everyone in this institution except the admin themselves.
      recipientQuery = 'SELECT id AS user_id FROM users WHERE institution_id = $1 AND id <> $2';
      queryParams = [institutionId, senderId];
    } else {
      return res.status(400).json({ message: 'audience must be "batch" or "institution"' });
    }

    const recipients = await pool.query(recipientQuery, queryParams);
    if (recipients.rows.length === 0) {
      return res.json({ message: 'No recipients found', sent: 0 });
    }

    // Single-statement bulk insert with VALUES.
    const valueRows = recipients.rows.map((_r, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6})`;
    }).join(', ');
    const flatParams = [];
    recipients.rows.forEach((r) => {
      flatParams.push(
        r.user_id, institutionId, category, title, JSON.stringify(data || {}), senderId,
      );
    });

    // We need to include message too — fold it into the VALUES.
    // Rewrite to include message column properly.
    const valueRows2 = recipients.rows.map((_r, i) => {
      const base = i * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7})`;
    }).join(', ');
    const flatParams2 = [];
    recipients.rows.forEach((r) => {
      flatParams2.push(
        r.user_id, institutionId, category, title, message || null, JSON.stringify(data || {}), senderId,
      );
    });

    await pool.query(
      `INSERT INTO notifications (user_id, institution_id, category, title, message, data, created_by)
       VALUES ${valueRows2}`,
      flatParams2,
    );

    res.status(201).json({ message: `Announcement sent`, sent: recipients.rows.length });
  } catch (err) {
    console.error('Announce error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
