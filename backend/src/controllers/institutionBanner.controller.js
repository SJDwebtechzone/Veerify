// backend/src/controllers/institutionBanner.controller.js
//
// Per-institution promotional banners shown on the student & trainer
// mobile dashboards. Schema in migration 039_institution_banners.sql.
//
// Endpoints:
//   GET    /api/institution-banners            — admin lists their own
//   POST   /api/institution-banners            — admin creates one
//   PUT    /api/institution-banners/:id        — admin edits one
//   DELETE /api/institution-banners/:id        — admin deletes one
//   GET    /api/institution-banners/for-me     — student / trainer fetches
//                                                 active banners targeted
//                                                 at their role, scoped
//                                                 to their institution.

const pool = require('../config/db');

const VALID_AUDIENCES = new Set(['student', 'trainer', 'both']);

// Helper — pulls the caller's institution_id from the users row. Used
// for every admin-scoped operation so the row stays bound to their org.
async function getMyInstitutionId(userId) {
  const r = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// GET /api/institution-banners  (admin)
// Returns every banner the calling admin's institution owns, newest first.
exports.listMine = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }
    const r = await pool.query(
      `SELECT * FROM institution_banners
        WHERE institution_id = $1
        ORDER BY sort_order ASC, created_at DESC`,
      [institutionId],
    );
    res.json({ count: r.rows.length, banners: r.rows });
  } catch (err) {
    console.error('[institutionBanner.listMine]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/institution-banners  (admin)
// Body: { image_url, title?, subtitle?, link_url?, audience, is_active?, sort_order? }
exports.create = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }

    const b = req.body || {};
    const imageUrl = String(b.image_url || '').trim();
    if (!imageUrl) {
      return res.status(400).json({ message: 'Banner image is required.' });
    }
    const audience = VALID_AUDIENCES.has(b.audience) ? b.audience : 'both';

    const r = await pool.query(
      `INSERT INTO institution_banners
         (institution_id, image_url, title, subtitle, link_url,
          audience, is_active, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        institutionId,
        imageUrl,
        b.title    ? String(b.title).trim().slice(0, 150)    : null,
        b.subtitle ? String(b.subtitle).trim().slice(0, 300) : null,
        b.link_url ? String(b.link_url).trim().slice(0, 500) : null,
        audience,
        b.is_active !== false,
        Number.isInteger(b.sort_order) ? b.sort_order : 0,
        req.user.id,
      ],
    );
    res.status(201).json({ banner: r.rows[0] });
  } catch (err) {
    console.error('[institutionBanner.create]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/institution-banners/:id  (admin)
// Partial update — any field left out keeps its current value.
exports.update = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid banner id' });
    }
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }
    // Ownership check — banner must belong to caller's institution.
    const check = await pool.query(
      `SELECT institution_id FROM institution_banners WHERE id = $1`, [id],
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Banner not found' });
    }
    if (check.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Not your banner' });
    }

    const b = req.body || {};
    const audience = b.audience !== undefined
      ? (VALID_AUDIENCES.has(b.audience) ? b.audience : null)
      : null;
    if (b.audience !== undefined && audience === null) {
      return res.status(400).json({ message: 'audience must be student, trainer, or both' });
    }

    const r = await pool.query(
      `UPDATE institution_banners SET
         image_url   = COALESCE(NULLIF($2, ''), image_url),
         title       = COALESCE($3, title),
         subtitle    = COALESCE($4, subtitle),
         link_url    = COALESCE($5, link_url),
         audience    = COALESCE($6, audience),
         is_active   = COALESCE($7, is_active),
         sort_order  = COALESCE($8, sort_order),
         updated_at  = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        b.image_url  != null ? String(b.image_url).trim()  : '',
        b.title      != null ? String(b.title).trim().slice(0, 150)    : null,
        b.subtitle   != null ? String(b.subtitle).trim().slice(0, 300) : null,
        b.link_url   != null ? String(b.link_url).trim().slice(0, 500) : null,
        audience,
        b.is_active  != null ? !!b.is_active : null,
        Number.isInteger(b.sort_order) ? b.sort_order : null,
      ],
    );
    res.json({ banner: r.rows[0] });
  } catch (err) {
    console.error('[institutionBanner.update]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/institution-banners/:id  (admin)
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid banner id' });
    }
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }
    const r = await pool.query(
      `DELETE FROM institution_banners
        WHERE id = $1 AND institution_id = $2
        RETURNING id`,
      [id, institutionId],
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ message: 'Banner not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[institutionBanner.remove]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institution-banners/for-me  (student / trainer / parent)
// Optional ?institution_id=N for students whose home isn't bound yet
// (they may be browsing a picked academy as a guest with an explicit
// institution id). For trainers / parents we always use their linked
// institution from the users row.
exports.forMe = async (req, res) => {
  try {
    const role = req.user.role;
    let institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId && req.query.institution_id) {
      institutionId = parseInt(req.query.institution_id, 10) || null;
    }
    if (!institutionId) {
      return res.json({ count: 0, banners: [] });
    }

    // 'student' & 'parent' see student-targeted banners; 'trainer' sees
    // trainer-targeted. 'both' is always visible to whichever role asks.
    const audienceTag = role === 'trainer' ? 'trainer' : 'student';
    const r = await pool.query(
      `SELECT id, image_url, title, subtitle, link_url, audience, sort_order
         FROM institution_banners
        WHERE institution_id = $1
          AND is_active = TRUE
          AND (audience = $2 OR audience = 'both')
        ORDER BY sort_order ASC, created_at DESC`,
      [institutionId, audienceTag],
    );
    res.json({ count: r.rows.length, banners: r.rows });
  } catch (err) {
    console.error('[institutionBanner.forMe]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
