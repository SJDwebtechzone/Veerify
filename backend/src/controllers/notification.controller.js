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

    // ── Trainer approval gate ────────────────────────────────────────
    // When a trainer composes a notification, it must be approved by
    // the institution admin before going out. We park it in
    // pending_announcements and notify the institution's admin(s) to
    // review. Admins themselves keep sending directly without gating.
    if (role === 'trainer') {
      const draft = await pool.query(
        `INSERT INTO pending_announcements
           (sender_id, institution_id, audience, batch_id, title, message, category, data, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending')
         RETURNING *`,
        [senderId, institutionId, audience, audience === 'batch' ? batch_id : null,
          title, message || null, category, JSON.stringify(data || {})],
      );

      // Nudge every institution admin so they see "X pending review" on
      // their own inbox / dashboard.
      try {
        const admins = await pool.query(
          `SELECT id, name FROM users
            WHERE institution_id = $1 AND role = 'admin' AND COALESCE(is_deleted, false) = false`,
          [institutionId],
        );
        for (const a of admins.rows) {
          await insertNotification({
            user_id: a.id,
            institution_id: institutionId,
            category: 'system',
            title: 'Trainer announcement awaiting approval',
            message: `A trainer has submitted "${title}" for your review.`,
            // `screen` deep-links the inbox tap straight to the detail
            // screen; `id` is the param the screen reads to fetch the
            // draft. `draft_id` kept for backward compatibility.
            data: {
              kind: 'pending_announcement',
              draft_id: draft.rows[0].id,
              screen: 'PendingAnnouncementDetail',
              id: draft.rows[0].id,
            },
            created_by: senderId,
          });
        }
      } catch (e) {
        // Don't break the trainer's submit if the nudge fan-out fails.
        console.warn('[announce] admin-nudge failed:', e?.message);
      }

      return res.status(202).json({
        message: 'Submitted for approval. The institution admin will review it shortly.',
        status: 'pending',
        draft_id: draft.rows[0].id,
      });
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/sent
//
// Returns the current user's sent-notification history grouped per "send
// event". Because the announce endpoint fans out one row per recipient
// inside a single bulk INSERT, every row in the same send share an exact
// created_at timestamp (and title + message + category). We group on
// those columns to surface a single row per send + count the recipients
// and break them down by role so the sender can see *who* they messaged.
//
// Response shape:
//   {
//     sent: [
//       {
//         title, message, category, created_at,
//         recipient_count: 47,
//         role_breakdown: { student: 40, trainer: 5, admin: 2 },
//         sample_names: ['Arun K.', 'Priya R.', ... up to 3]
//       },
//       ...
//     ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
exports.sent = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { limit = 100 } = req.query;
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

    // Pull the raw rows the sender created; join users to derive role
    // breakdown and pick a few sample recipient names.
    const result = await pool.query(
      `SELECT
         n.title,
         n.message,
         n.category,
         n.created_at,
         n.user_id      AS recipient_id,
         u.role         AS recipient_role,
         u.name         AS recipient_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.created_by = $1
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT $2`,
      [senderId, lim * 100], // pull more so each send event gets all its rows
    );

    // Bucket rows into send events keyed by (title, message, category, created_at).
    const byKey = new Map();
    for (const r of result.rows) {
      const key = [
        r.title || '',
        r.message || '',
        r.category || '',
        r.created_at?.toISOString?.() || String(r.created_at),
      ].join('||');

      if (!byKey.has(key)) {
        byKey.set(key, {
          title: r.title,
          message: r.message,
          category: r.category,
          created_at: r.created_at,
          recipient_count: 0,
          role_breakdown: {},
          sample_names: [],
        });
      }
      const evt = byKey.get(key);
      evt.recipient_count += 1;
      if (r.recipient_role) {
        evt.role_breakdown[r.recipient_role] = (evt.role_breakdown[r.recipient_role] || 0) + 1;
      }
      if (evt.sample_names.length < 3 && r.recipient_name) {
        evt.sample_names.push(r.recipient_name);
      }
    }

    // Stable order: newest first (Maps preserve insertion order, our SELECT
    // already sorted DESC).
    const sent = Array.from(byKey.values()).slice(0, lim);

    res.json({ sent });
  } catch (err) {
    console.error('Sent notifications error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Trainer announcement approvals
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/notifications/pending-approval
// Admin view: every trainer-submitted draft awaiting approval at this
// institution, plus the sender's name and the target batch's name for context.
exports.pendingApproval = async (req, res) => {
  try {
    const adminId = req.user.id;
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only institution admins can review approvals' });
    }
    const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [adminId]);
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) return res.status(400).json({ message: 'No institution for this admin' });

    const status = (req.query.status || 'pending').toLowerCase();
    const allowed = new Set(['pending', 'approved', 'rejected', 'all']);
    if (!allowed.has(status)) {
      return res.status(400).json({ message: 'status must be pending / approved / rejected / all' });
    }

    const params = [institutionId];
    let where = 'p.institution_id = $1';
    if (status !== 'all') {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }

    const r = await pool.query(
      `SELECT p.*, u.name AS sender_name, b.name AS batch_name
         FROM pending_announcements p
         JOIN users u ON u.id = p.sender_id
         LEFT JOIN batches b ON b.id = p.batch_id
        WHERE ${where}
        ORDER BY p.created_at DESC
        LIMIT 200`,
      params,
    );
    res.json({ drafts: r.rows });
  } catch (err) {
    console.error('Pending approvals error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/notifications/my-pending
// Trainer view: drafts the current user has submitted (any status).
exports.myPending = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, b.name AS batch_name
         FROM pending_announcements p
         LEFT JOIN batches b ON b.id = p.batch_id
        WHERE p.sender_id = $1
        ORDER BY p.created_at DESC
        LIMIT 200`,
      [req.user.id],
    );
    res.json({ drafts: r.rows });
  } catch (err) {
    console.error('My pending error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/notifications/pending/:id
// Fetch one pending-announcement draft with sender + audience details.
// Used by the admin's "Trainer announcement awaiting approval" tap deep
// link as well as the trainer's own draft history detail view.
// Admins can read drafts in their own institution; the trainer who
// submitted the draft can read it themselves.
exports.getPendingOne = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    const r = await pool.query(
      `SELECT p.*,
              u.name  AS sender_name,
              u.email AS sender_email,
              b.name  AS batch_name,
              rev.name AS reviewer_name
         FROM pending_announcements p
         JOIN users u ON u.id = p.sender_id
         LEFT JOIN batches b ON b.id = p.batch_id
         LEFT JOIN users rev ON rev.id = p.reviewed_by
        WHERE p.id = $1`,
      [req.params.id],
    );
    const draft = r.rows[0];
    if (!draft) return res.status(404).json({ message: 'Draft not found' });

    if (role === 'admin') {
      const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
      if (u.rows[0]?.institution_id !== draft.institution_id) {
        return res.status(403).json({ message: 'Not your institution' });
      }
    } else if (role === 'trainer') {
      if (draft.sender_id !== userId) {
        return res.status(403).json({ message: 'Not your draft' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Count of recipients the fan-out would reach (helps the admin
    // see "this will reach N students" before approving).
    let recipientCount = 0;
    try {
      if (draft.audience === 'batch' && draft.batch_id) {
        const c = await pool.query(
          'SELECT COUNT(DISTINCT student_id)::int AS n FROM enrollments WHERE batch_id = $1',
          [draft.batch_id],
        );
        recipientCount = c.rows[0]?.n || 0;
      } else if (draft.audience === 'institution') {
        const c = await pool.query(
          'SELECT COUNT(*)::int AS n FROM users WHERE institution_id = $1 AND id <> $2 AND COALESCE(is_deleted, false) = false',
          [draft.institution_id, draft.sender_id],
        );
        recipientCount = c.rows[0]?.n || 0;
      }
    } catch (_) { /* count is best-effort */ }

    res.json({ draft: { ...draft, recipient_count: recipientCount } });
  } catch (err) {
    console.error('Get pending one error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/notifications/pending/:id/approve
// Admin approves a draft → mark as approved AND fan out to recipients.
exports.approvePending = async (req, res) => {
  try {
    const adminId = req.user.id;
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only institution admins can approve' });
    }

    const adminInst = await pool.query('SELECT institution_id FROM users WHERE id = $1', [adminId]);
    const adminInstitutionId = adminInst.rows[0]?.institution_id;
    if (!adminInstitutionId) return res.status(400).json({ message: 'No institution for this admin' });

    const draftRes = await pool.query(
      'SELECT * FROM pending_announcements WHERE id = $1',
      [req.params.id],
    );
    const draft = draftRes.rows[0];
    if (!draft) return res.status(404).json({ message: 'Draft not found' });
    if (draft.institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'Not your institution' });
    }
    if (draft.status !== 'pending') {
      return res.status(409).json({ message: `Already ${draft.status}` });
    }

    // Resolve recipients exactly like the announce endpoint does.
    let recipients;
    if (draft.audience === 'batch') {
      recipients = await pool.query(
        'SELECT DISTINCT student_id AS user_id FROM enrollments WHERE batch_id = $1',
        [draft.batch_id],
      );
    } else if (draft.audience === 'institution') {
      recipients = await pool.query(
        'SELECT id AS user_id FROM users WHERE institution_id = $1 AND id <> $2',
        [draft.institution_id, draft.sender_id],
      );
    } else {
      return res.status(400).json({ message: 'Unknown audience on draft' });
    }

    if (recipients.rows.length > 0) {
      // Bulk insert one notification row per recipient. `created_by` is
      // the original trainer so the Sent History card credits them.
      const valueRows = recipients.rows.map((_r, i) => {
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb, $${b + 7})`;
      }).join(', ');
      const flat = [];
      recipients.rows.forEach((r) => {
        flat.push(
          r.user_id, draft.institution_id, draft.category, draft.title,
          draft.message || null, JSON.stringify(draft.data || {}), draft.sender_id,
        );
      });
      await pool.query(
        `INSERT INTO notifications (user_id, institution_id, category, title, message, data, created_by)
         VALUES ${valueRows}`,
        flat,
      );
    }

    // Flip the draft to approved.
    await pool.query(
      `UPDATE pending_announcements
          SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2`,
      [adminId, draft.id],
    );

    // Nudge the trainer that their submission was approved + sent.
    try {
      await insertNotification({
        user_id: draft.sender_id,
        institution_id: draft.institution_id,
        category: 'system',
        title: 'Announcement approved',
        message: `Your announcement "${draft.title}" was approved and sent to ${recipients.rows.length} recipient${recipients.rows.length === 1 ? '' : 's'}.`,
        data: {
          kind: 'announcement_approved',
          draft_id: draft.id,
          screen: 'PendingAnnouncementDetail',
          id: draft.id,
        },
        created_by: adminId,
      });
    } catch (_) { /* noop */ }

    res.json({
      message: 'Approved and dispatched',
      sent: recipients.rows.length,
    });
  } catch (err) {
    console.error('Approve pending error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/notifications/pending/:id/reject
// Admin rejects a draft with an optional reason. No fan-out.
exports.rejectPending = async (req, res) => {
  try {
    const adminId = req.user.id;
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only institution admins can reject' });
    }
    const { reason } = req.body || {};

    const adminInst = await pool.query('SELECT institution_id FROM users WHERE id = $1', [adminId]);
    const adminInstitutionId = adminInst.rows[0]?.institution_id;
    if (!adminInstitutionId) return res.status(400).json({ message: 'No institution for this admin' });

    const draftRes = await pool.query(
      'SELECT * FROM pending_announcements WHERE id = $1',
      [req.params.id],
    );
    const draft = draftRes.rows[0];
    if (!draft) return res.status(404).json({ message: 'Draft not found' });
    if (draft.institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'Not your institution' });
    }
    if (draft.status !== 'pending') {
      return res.status(409).json({ message: `Already ${draft.status}` });
    }

    await pool.query(
      `UPDATE pending_announcements
          SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
              rejection_reason = $2
        WHERE id = $3`,
      [adminId, (reason || '').trim() || null, draft.id],
    );

    // Tell the trainer why.
    try {
      await insertNotification({
        user_id: draft.sender_id,
        institution_id: draft.institution_id,
        category: 'system',
        title: 'Announcement rejected',
        message: reason
          ? `Your announcement "${draft.title}" was not approved. Reason: ${reason}`
          : `Your announcement "${draft.title}" was not approved.`,
        data: {
          kind: 'announcement_rejected',
          draft_id: draft.id,
          reason: reason || null,
          screen: 'PendingAnnouncementDetail',
          id: draft.id,
        },
        created_by: adminId,
      });
    } catch (_) { /* noop */ }

    res.json({ message: 'Rejected' });
  } catch (err) {
    console.error('Reject pending error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
