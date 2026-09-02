// src/controllers/intraEventApproval.controller.js
//
// Super-admin approval queue for Intra-Level (cross-institution)
// events. When an institution admin creates an event with
// event_type='intra' on the mobile app, the event lands in
// mobile_events with approval_status='pending' and awaits action
// here. Once approved, getMyEvents fans it out to every
// institution's feed via the OR-in on e.event_type='intra'.
//
// Endpoints (mounted at /api/intra-events under super_admin auth):
//   GET    /pending          list every pending intra event
//   GET    /                  list every intra event (any status)
//   POST   /:id/approve      flip status → 'approved', stamp approver
//   POST   /:id/reject       flip status → 'rejected', stamp rejecter

const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

// Clamp helpers — pagination inputs are always clamped so a malformed
// query string can never crash the list query or return unbounded rows.
const clampLimit  = (raw, def = 10, max = 50) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
};
const clampOffset = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

/**
 * List intra events awaiting super-admin action. Ordered oldest-
 * first so the queue behaves like a FIFO tray. Joins institutions
 * so the UI can display the submitting academy's name + logo.
 *
 * Supports pagination via ?limit / ?offset. Returns { total, count,
 * events } so the Web Admin can render "Page N of M" without a
 * second query.
 */
exports.listPending = async (req, res) => {
  try {
    const limit  = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

    // Two queries in parallel — one for the page slice, one for the
    // total count. Faster than SELECT ... COUNT(*) OVER () on large
    // tables and semantically equivalent for our use case.
    // Full column set including the extended fields (event_time,
    // categories, publish_at, registration_closing_date, payment_link).
    // If migration 096 (event_time + categories) hasn't run on this
    // environment the SELECT gets a 42703 undefined-column error — we
    // catch that and re-run without the extra columns so the endpoint
    // still works on older DBs.
    const fullPageSql = `
      SELECT e.id, e.title, e.subtitle, e.description, e.image_url,
             e.event_date, e.event_time, e.location, e.link,
             e.registration_closing_date,
             e.categories,
             e.payment_required, e.payment_amount, e.payment_link,
             e.publish_at,
             e.approval_status, e.event_type,
             e.submitted_at, e.created_at,
             e.institution_id,
             i.name AS institution_name, i.logo_url AS institution_logo,
             u.name AS submitter_name, u.email AS submitter_email
        FROM mobile_events e
        LEFT JOIN institutions i ON i.id = e.institution_id
        LEFT JOIN users        u ON u.id = e.created_by
       WHERE e.event_type = 'intra'
         AND e.approval_status = 'pending'
       ORDER BY COALESCE(e.submitted_at, e.created_at) ASC
       LIMIT $1 OFFSET $2`;

    const basicPageSql = `
      SELECT e.id, e.title, e.subtitle, e.description, e.image_url,
             e.event_date, e.location, e.link,
             e.payment_required, e.payment_amount,
             e.approval_status,
             e.submitted_at, e.created_at,
             e.institution_id,
             i.name AS institution_name, i.logo_url AS institution_logo,
             u.name AS submitter_name, u.email AS submitter_email
        FROM mobile_events e
        LEFT JOIN institutions i ON i.id = e.institution_id
        LEFT JOIN users        u ON u.id = e.created_by
       WHERE e.event_type = 'intra'
         AND e.approval_status = 'pending'
       ORDER BY COALESCE(e.submitted_at, e.created_at) ASC
       LIMIT $1 OFFSET $2`;

    const runPage = async () => {
      try {
        return await pool.query(fullPageSql, [limit, offset]);
      } catch (err) {
        if (err?.code === '42703') {
          return await pool.query(basicPageSql, [limit, offset]);
        }
        throw err;
      }
    };

    const [totalRes, pageRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
           FROM mobile_events
          WHERE event_type = 'intra'
            AND approval_status = 'pending'`,
      ),
      runPage(),
    ]);

    res.json({
      total:  totalRes.rows[0]?.total || 0,
      count:  pageRes.rows.length,
      limit,
      offset,
      events: pageRes.rows,
    });
  } catch (err) {
    console.error('intra listPending error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Cheap "just the number" endpoint for the sidebar badge + bell
 * count. Skips the row payload entirely so the Web Admin can poll
 * this on every page without hurting the DB.
 */
exports.pendingCount = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM mobile_events
        WHERE event_type = 'intra'
          AND approval_status = 'pending'`,
    );
    res.json({ total: r.rows[0]?.total || 0 });
  } catch (err) {
    console.error('intra pendingCount error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Full intra-event list with paging and status filter. Powers both
 * the Approved tab (?status=approved) and the History view
 * (?status=all — every status). Returns { total, count, events } so
 * the client can render "Page N of M".
 */
exports.listAll = async (req, res) => {
  try {
    const limit  = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const status = req.query.status;

    const params = [];
    let where = `e.event_type = 'intra'`;
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      params.push(status);
      where += ` AND e.approval_status = $${params.length}`;
    }

    // Pagination binds sit at the end so the status filter (if any)
    // keeps its lower indices stable.
    const totalSql = `
      SELECT COUNT(*)::int AS total
        FROM mobile_events e
       WHERE ${where}`;

    params.push(limit);   const limitIdx  = params.length;
    params.push(offset);  const offsetIdx = params.length;

    const fullPageSql = `
      SELECT e.id, e.title, e.subtitle, e.description, e.image_url,
             e.event_date, e.event_time, e.location, e.link,
             e.registration_closing_date,
             e.categories,
             e.payment_required, e.payment_amount, e.payment_link,
             e.publish_at,
             e.approval_status, e.event_type,
             e.submitted_at, e.approved_at, e.rejected_at,
             e.created_at,
             e.institution_id,
             i.name AS institution_name, i.logo_url AS institution_logo,
             u.name AS submitter_name, u.email AS submitter_email
        FROM mobile_events e
        LEFT JOIN institutions i ON i.id = e.institution_id
        LEFT JOIN users        u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY COALESCE(e.submitted_at, e.created_at) DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    // Basic fallback for environments that predate migration 096
    // (event_time + categories) — same shape as before that migration.
    const basicPageSql = `
      SELECT e.id, e.title, e.subtitle, e.description, e.image_url,
             e.event_date, e.location, e.link,
             e.payment_required, e.payment_amount,
             e.approval_status, e.event_type,
             e.submitted_at, e.approved_at, e.rejected_at,
             e.created_at,
             e.institution_id,
             i.name AS institution_name, i.logo_url AS institution_logo,
             u.name AS submitter_name, u.email AS submitter_email
        FROM mobile_events e
        LEFT JOIN institutions i ON i.id = e.institution_id
        LEFT JOIN users        u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY COALESCE(e.submitted_at, e.created_at) DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    // totalSql only uses the leading status param (if any) — slice
    // it off the tail-appended limit/offset binds.
    const totalParams = params.slice(0, params.length - 2);

    const runPage = async () => {
      try {
        return await pool.query(fullPageSql, params);
      } catch (err) {
        if (err?.code === '42703') {
          return await pool.query(basicPageSql, params);
        }
        throw err;
      }
    };

    const [totalRes, pageRes] = await Promise.all([
      pool.query(totalSql, totalParams),
      runPage(),
    ]);

    res.json({
      total:  totalRes.rows[0]?.total || 0,
      count:  pageRes.rows.length,
      limit,
      offset,
      events: pageRes.rows,
    });
  } catch (err) {
    console.error('intra listAll error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/intra-events/:id
 *
 * Full detail fetch for the super-admin "View full details" modal.
 * Returns every column persisted on the event row (event_time,
 * categories, publish_at, payment_link, registration_closing_date,
 * scheduling + approval timestamps) so the modal renders the actual
 * submitted values regardless of what the list endpoint returned.
 *
 * SELECT * is used deliberately here — the modal renders every field
 * that comes back, and any future column added by a migration should
 * flow through without a controller edit.
 */
exports.getOne = async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const r = await pool.query(
      `SELECT e.*,
              i.name    AS institution_name,
              i.logo_url AS institution_logo,
              u.name    AS submitter_name,
              u.email   AS submitter_email
         FROM mobile_events e
         LEFT JOIN institutions i ON i.id = e.institution_id
         LEFT JOIN users        u ON u.id = e.created_by
        WHERE e.id = $1
          AND e.event_type = 'intra'`,
      [eventId],
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found.' });
    }
    res.json({ event: r.rows[0] });
  } catch (err) {
    console.error('intra getOne error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Approve an intra event. Flips approval_status to 'approved' and
 * stamps approved_at / approved_by. From that moment on
 * getMyEvents returns this event to every institution's feed via
 * the OR-in on e.event_type='intra'.
 */
exports.approve = async (req, res) => {
  try {
    const eventId    = Number(req.params.id);
    const approverId = req.user.id;
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }

    const upd = await pool.query(
      `UPDATE mobile_events
          SET approval_status = 'approved',
              approved_at     = NOW(),
              approved_by     = $2,
              rejected_at     = NULL,
              rejected_by     = NULL
        WHERE id = $1
          AND event_type = 'intra'
          AND approval_status <> 'approved'
        RETURNING id, title, institution_id, created_by`,
      [eventId, approverId],
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found or already approved.' });
    }
    const row = upd.rows[0];

    // Best-effort: tell the submitting institution admin the event
    // is live. Never fail the approval on a notification blip.
    try {
      if (row.created_by) {
        await insertNotification({
          user_id:        row.created_by,
          institution_id: row.institution_id,
          category:       'system',
          title:          'Event approved',
          message:        `Your event "${row.title}" has been approved and is now visible to all institutions.`,
          data: {
            screen:   'EventsList',
            kind:     'intra_event_approved',
            event_id: row.id,
          },
          created_by: approverId,
        });
      }
    } catch (err) {
      console.warn('[intra/approve] notify submitter failed:', err?.message);
    }

    // ── Fan-out to every OTHER institution admin ─────────────
    // The intra event is now cross-institution — every institution
    // admin who isn't the organiser should see a notification with
    // a deep-link to the event's detail screen. Best-effort: any
    // notification failure is logged but doesn't affect approval.
    try {
      const otherAdmins = await pool.query(
        `SELECT id, institution_id
           FROM users
          WHERE role = 'admin'
            AND COALESCE(is_deleted, false) = false
            AND institution_id IS NOT NULL
            AND institution_id <> $1`,
        [row.institution_id],
      );
      for (const u of otherAdmins.rows) {
        await insertNotification({
          user_id:        u.id,
          institution_id: u.institution_id,
          category:       'events',
          title:          'New cross-institution event',
          message:        `"${row.title}" is now open across institutions. Tap to see details and register your students.`,
          data: {
            screen:   'EventDetail',
            kind:     'intra_event_approved_admin',
            event_id: row.id,
          },
          created_by: approverId,
        });
      }
    } catch (err) {
      console.warn('[intra/approve] notify other admins failed:', err?.message);
    }

    // ── Fan-out to every student ─────────────────────────────
    // Students see the event details but can't register themselves
    // (their institution handles that). The notification opens the
    // shared EventDetailScreen; its Register button is already
    // hidden for students via the role gate on the mobile side.
    try {
      const students = await pool.query(
        `SELECT id, institution_id
           FROM users
          WHERE role = 'student'
            AND COALESCE(is_deleted, false) = false`,
      );
      for (const u of students.rows) {
        await insertNotification({
          user_id:        u.id,
          institution_id: u.institution_id,
          category:       'events',
          title:          'New event announcement',
          message:        `"${row.title}" — a new cross-institution event has been announced. Tap to view details. Registration is handled through your academy.`,
          data: {
            screen:   'EventDetail',
            kind:     'intra_event_approved_student',
            event_id: row.id,
            // Hint the mobile can honour to render a view-only
            // banner beside the CTA if it wants extra clarity —
            // the role-based gate already hides Register for
            // students, so this is a soft belt-and-braces flag.
            view_only: true,
          },
          created_by: approverId,
        });
      }
    } catch (err) {
      console.warn('[intra/approve] notify students failed:', err?.message);
    }

    res.json({ ok: true, event_id: row.id, status: 'approved' });
  } catch (err) {
    console.error('intra approve error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Reject an intra event. Flips approval_status to 'rejected' and
 * stamps rejected_at / rejected_by. Preserves the event row + all
 * its data so the submitter can see WHAT was rejected. Rejected
 * events never appear in any institution's feed.
 */
exports.reject = async (req, res) => {
  try {
    const eventId   = Number(req.params.id);
    const rejecterId = req.user.id;
    const { reason } = req.body || {};
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }

    const upd = await pool.query(
      `UPDATE mobile_events
          SET approval_status = 'rejected',
              rejected_at     = NOW(),
              rejected_by     = $2,
              approved_at     = NULL,
              approved_by     = NULL
        WHERE id = $1
          AND event_type = 'intra'
          AND approval_status <> 'rejected'
        RETURNING id, title, institution_id, created_by`,
      [eventId, rejecterId],
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found or already rejected.' });
    }
    const row = upd.rows[0];

    try {
      if (row.created_by) {
        await insertNotification({
          user_id:        row.created_by,
          institution_id: row.institution_id,
          category:       'system',
          title:          'Event rejected',
          message:        reason
            ? `Your event "${row.title}" was not approved. Reason: ${String(reason).slice(0, 200)}`
            : `Your event "${row.title}" was not approved by the platform review team.`,
          data: {
            screen:   'EventsList',
            kind:     'intra_event_rejected',
            event_id: row.id,
          },
          created_by: rejecterId,
        });
      }
    } catch (err) {
      console.warn('[intra/reject] notify failed:', err?.message);
    }

    res.json({ ok: true, event_id: row.id, status: 'rejected' });
  } catch (err) {
    console.error('intra reject error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
