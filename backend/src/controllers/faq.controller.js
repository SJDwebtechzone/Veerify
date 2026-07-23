// backend/src/controllers/faq.controller.js
//
// FAQ module — dynamic content managed from the super-admin web panel
// and consumed by the mobile app filtered on the caller's role.
//
// Endpoints:
//   GET    /api/faqs                       — role-scoped, active-only,
//                                            grouped-ready. Public
//                                            (guest counts as 'guest').
//   GET    /api/faqs/admin                 — super-admin only. Returns
//                                            every row (active + inactive)
//                                            for the web manager grid.
//   POST   /api/faqs                       — super-admin creates.
//   PUT    /api/faqs/:id                   — super-admin updates.
//   DELETE /api/faqs/:id                   — super-admin deletes.
//   PATCH  /api/faqs/:id/active            — super-admin flips is_active.
//   PATCH  /api/faqs/reorder               — super-admin bulk reorder
//                                            (accepts [{id, display_order}]).

const pool = require('../config/db');

// Canonical audience labels. The admin web multi-select should offer
// exactly this set so the value round-trips cleanly.
const AUDIENCE_VALUES = new Set([
  'guest', 'student', 'trainer', 'admin', 'branch', 'parent',
]);

// Optional JWT decode — mobile / web callers hitting the public list
// may or may not send a token. If they do we honour their role; if
// they don't we render the 'guest' bucket.
function readCallerRole(req) {
  // verifyTokenOptional attaches req.user when present; but this
  // endpoint uses no auth middleware, so we peek at the header
  // ourselves and swallow any decode error.
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return 'guest';
  const token = auth.split(' ')[1];
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = String(decoded?.role || '').toLowerCase();
    if (AUDIENCE_VALUES.has(role)) return role;
    return 'guest';
  } catch {
    return 'guest';
  }
}

function sanitiseAudience(list) {
  const arr = Array.isArray(list) ? list : [];
  const clean = arr
    .map((x) => String(x || '').trim().toLowerCase())
    .filter((x) => AUDIENCE_VALUES.has(x));
  // De-dupe while preserving order.
  return Array.from(new Set(clean));
}

// GET /api/faqs
// Public — no auth middleware. Filters by the caller's role via JWT
// (if they sent one) or falls back to 'guest'.
exports.listPublic = async (req, res) => {
  try {
    const role = readCallerRole(req);
    const r = await pool.query(
      `SELECT id, question, answer, category, audience, display_order
         FROM faqs
        WHERE is_active = TRUE
          AND $1 = ANY (audience)
        ORDER BY category ASC, display_order ASC, id ASC`,
      [role],
    );
    res.json({ count: r.rows.length, role, faqs: r.rows });
  } catch (err) {
    console.error('FAQ list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/faqs/admin
// Super-admin only. Returns every row for the manager grid.
exports.listAdmin = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const r = await pool.query(
      `SELECT * FROM faqs
        ORDER BY category ASC, display_order ASC, id DESC`,
    );
    res.json({ count: r.rows.length, faqs: r.rows });
  } catch (err) {
    console.error('FAQ admin list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/faqs
// Body: { question, answer, category, audience[], display_order, is_active }
exports.create = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const b = req.body || {};
    if (!b.question || !String(b.question).trim()) {
      return res.status(400).json({ message: 'Question is required' });
    }
    if (!b.answer || !String(b.answer).trim()) {
      return res.status(400).json({ message: 'Answer is required' });
    }
    const audience = sanitiseAudience(b.audience);
    if (audience.length === 0) {
      return res.status(400).json({ message: 'Pick at least one audience' });
    }
    const r = await pool.query(
      `INSERT INTO faqs
         (question, answer, category, audience, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4::text[], $5, $6, $7)
       RETURNING *`,
      [
        String(b.question).slice(0, 500),
        String(b.answer),
        String(b.category || 'General').slice(0, 80),
        audience,
        Number.isFinite(b.display_order) ? Number(b.display_order) : 100,
        b.is_active === false ? false : true,
        req.user.id,
      ],
    );
    res.status(201).json({ faq: r.rows[0] });
  } catch (err) {
    console.error('FAQ create error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/faqs/:id
exports.update = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

    const b = req.body || {};
    // Audience is only touched when the payload actually carries it;
    // sending [] with the field present clears every audience → we
    // reject that instead of hiding the FAQ from everyone by accident.
    let audience = null;
    if (Object.prototype.hasOwnProperty.call(b, 'audience')) {
      audience = sanitiseAudience(b.audience);
      if (audience.length === 0) {
        return res.status(400).json({ message: 'Pick at least one audience' });
      }
    }
    const r = await pool.query(
      `UPDATE faqs SET
         question       = COALESCE($2, question),
         answer         = COALESCE($3, answer),
         category       = COALESCE($4, category),
         audience       = COALESCE($5::text[], audience),
         display_order  = COALESCE($6, display_order),
         is_active      = COALESCE($7, is_active),
         updated_at     = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        b.question != null ? String(b.question).slice(0, 500)     : null,
        b.answer   != null ? String(b.answer)                     : null,
        b.category != null ? String(b.category).slice(0, 80)      : null,
        audience,
        Number.isFinite(b.display_order) ? Number(b.display_order) : null,
        typeof b.is_active === 'boolean' ? b.is_active            : null,
      ],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ faq: r.rows[0] });
  } catch (err) {
    console.error('FAQ update error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/faqs/:id
exports.remove = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const r = await pool.query(
      `DELETE FROM faqs WHERE id = $1 RETURNING id`,
      [id],
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('FAQ delete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PATCH /api/faqs/:id/active
// Body: { is_active: boolean }
exports.setActive = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const active = !!req.body?.is_active;
    const r = await pool.query(
      `UPDATE faqs SET is_active = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, active],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ faq: r.rows[0] });
  } catch (err) {
    console.error('FAQ setActive error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = exports;
