// backend/src/controllers/certificateTemplate.controller.js
//
// Institution-owned certificate templates. CRUD + set-default + a
// generate endpoint that merges a template with a course-completion
// row's data and returns a signed payload the mobile can render.
//
// Endpoints:
//   GET    /api/certificate-templates            — list caller's templates
//   POST   /api/certificate-templates            — create
//   PUT    /api/certificate-templates/:id        — update layout / name
//   DELETE /api/certificate-templates/:id        — remove
//   POST   /api/certificate-templates/:id/default — set as default
//   POST   /api/certificate-templates/:id/preview — merge with sample data,
//                                                    return placeholder-with-value
//                                                    payload (no student needed)

const pool = require('../config/db');

const PLACEHOLDER_KEYS = [
  'student_name', 'course_name', 'belt_name', 'institution_name',
  'venue', 'completion_date', 'certificate_no',
  'instructor_name', 'digital_signature', 'qr_code',
];

async function getMyInstitutionId(userId) {
  const r = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// Normalise a placeholder pin — drops unknown keys, clamps x/y to
// [0, 1], enforces sane font size range. Silent about invalid values
// so callers with older mobile builds don't crash the save.
function sanitisePin(raw = {}) {
  if (!PLACEHOLDER_KEYS.includes(raw.key)) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  return {
    key:       raw.key,
    label:     String(raw.label || raw.key).slice(0, 60),
    x:         clamp(raw.x, 0, 1),
    y:         clamp(raw.y, 0, 1),
    font_size: clamp(raw.font_size ?? 20, 8, 96),
    color:     /^#[0-9a-fA-F]{3,8}$/.test(raw.color || '') ? raw.color : '#111827',
    align:     ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'center',
    bold:      !!raw.bold,
    italic:    !!raw.italic,
  };
}
function sanitisePlaceholders(list) {
  return (Array.isArray(list) ? list : [])
    .map(sanitisePin)
    .filter(Boolean);
}

// GET /api/certificate-templates
exports.list = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
    const r = await pool.query(
      `SELECT * FROM certificate_templates
        WHERE institution_id = $1
        ORDER BY is_default DESC, created_at DESC`,
      [institutionId],
    );
    res.json({ count: r.rows.length, templates: r.rows });
  } catch (err) {
    console.error('list templates error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/certificate-templates
// Body: { name, background_url, background_kind, canvas_width,
//         canvas_height, placeholders, is_default? }
exports.create = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
    const b = req.body || {};
    if (!b.name || !b.background_url) {
      return res.status(400).json({ message: 'name and background_url are required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // First template auto-defaults to true so a fresh admin always
      // has one dispatch target.
      const existing = await client.query(
        `SELECT COUNT(*)::int AS n FROM certificate_templates WHERE institution_id = $1`,
        [institutionId],
      );
      const wantDefault = !!b.is_default || existing.rows[0].n === 0;
      if (wantDefault) {
        await client.query(
          `UPDATE certificate_templates SET is_default = FALSE
            WHERE institution_id = $1 AND is_default = TRUE`,
          [institutionId],
        );
      }
      const r = await client.query(
        `INSERT INTO certificate_templates
           (institution_id, name, background_url, background_kind,
            canvas_width, canvas_height, placeholders,
            is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         RETURNING *`,
        [
          institutionId,
          String(b.name).slice(0, 120),
          String(b.background_url).slice(0, 500),
          b.background_kind === 'pdf' ? 'pdf' : 'image',
          Number.isFinite(b.canvas_width)  ? b.canvas_width  : 1000,
          Number.isFinite(b.canvas_height) ? b.canvas_height : 700,
          JSON.stringify(sanitisePlaceholders(b.placeholders)),
          wantDefault,
          req.user.id,
        ],
      );
      await client.query('COMMIT');
      res.status(201).json({ template: r.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('create template error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/certificate-templates/:id
// Partial update — only the fields present in the body are touched.
exports.update = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const check = await pool.query(
      `SELECT institution_id FROM certificate_templates WHERE id = $1`, [id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (check.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Not your template' });
    }

    const b = req.body || {};
    const r = await pool.query(
      `UPDATE certificate_templates SET
         name             = COALESCE($2, name),
         background_url   = COALESCE(NULLIF($3, ''), background_url),
         background_kind  = COALESCE($4, background_kind),
         canvas_width     = COALESCE($5, canvas_width),
         canvas_height    = COALESCE($6, canvas_height),
         placeholders     = COALESCE($7::jsonb, placeholders),
         updated_at       = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        b.name != null ? String(b.name).slice(0, 120) : null,
        b.background_url != null ? String(b.background_url).slice(0, 500) : '',
        b.background_kind === 'pdf' ? 'pdf' :
          b.background_kind === 'image' ? 'image' : null,
        Number.isFinite(b.canvas_width)  ? b.canvas_width  : null,
        Number.isFinite(b.canvas_height) ? b.canvas_height : null,
        Array.isArray(b.placeholders)
          ? JSON.stringify(sanitisePlaceholders(b.placeholders)) : null,
      ],
    );
    res.json({ template: r.rows[0] });
  } catch (err) {
    console.error('update template error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/certificate-templates/:id
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
    const r = await pool.query(
      `DELETE FROM certificate_templates
        WHERE id = $1 AND institution_id = $2
        RETURNING id`,
      [id, institutionId],
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('remove template error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/certificate-templates/:id/default
exports.setDefault = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await client.query(
        `SELECT id FROM certificate_templates
          WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
        [id, institutionId],
      );
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Not found' });
      }
      await client.query(
        `UPDATE certificate_templates SET is_default = FALSE
          WHERE institution_id = $1 AND is_default = TRUE`,
        [institutionId],
      );
      const r = await client.query(
        `UPDATE certificate_templates SET is_default = TRUE, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id],
      );
      await client.query('COMMIT');
      res.json({ template: r.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('set default error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/certificate-templates/:id/prepare
// Body: { completion_id? }
//
// Merges a template's placeholders with either the given completion's
// real data OR a sample data set (when no completion_id is passed —
// used for the "Preview" button on the templates screen). Returns a
// payload the mobile can render straight to canvas.
exports.prepare = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const tplRes = await pool.query(
      `SELECT * FROM certificate_templates
        WHERE id = $1 AND institution_id = $2`,
      [id, institutionId],
    );
    if (tplRes.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const template = tplRes.rows[0];

    const completionId = parseInt(req.body?.completion_id, 10);
    let data = null;
    if (Number.isInteger(completionId)) {
      const dRes = await pool.query(
        `SELECT
           cc.id, cc.certificate_sent_at, cc.course_completed_at,
           cc.belt_test_completed_at, cc.test_remarks,
           u.name  AS student_name,
           c.name  AS course_name,
           i.name  AS institution_name,
           i.city  AS institution_city,
           trainer.name AS trainer_name
         FROM course_completions cc
         JOIN users u    ON u.id = cc.student_id
         JOIN courses c  ON c.id = cc.course_id
         LEFT JOIN institutions i ON i.id = cc.institution_id
         LEFT JOIN users trainer  ON trainer.id = cc.trainer_id
        WHERE cc.id = $1`,
        [completionId],
      );
      data = dRes.rows[0] || null;
    }

    // Build the map of {key: value}. Defaults keep the preview useful.
    const sample = {
      student_name:     data?.student_name     || 'Sample Student',
      course_name:      data?.course_name      || 'Sample Course',
      belt_name:        req.body?.belt_name     || 'White Belt',
      institution_name: data?.institution_name || 'Sample Academy',
      venue:            data?.institution_city  || 'Chennai',
      completion_date:  formatDate(data?.belt_test_completed_at || data?.course_completed_at),
      certificate_no:   generateCertificateNo(institutionId),
      instructor_name:  data?.trainer_name     || '—',
      digital_signature:'',   // rendered as a scripty text or image on mobile
      qr_code:          '',   // mobile renders a QR from the completion id
    };

    const merged = (template.placeholders || []).map((pin) => ({
      ...pin,
      value: sample[pin.key] ?? '',
    }));

    res.json({
      template: {
        id: template.id, name: template.name,
        background_url: template.background_url,
        background_kind: template.background_kind,
        canvas_width:  template.canvas_width,
        canvas_height: template.canvas_height,
      },
      placeholders: merged,
      completion:   data,
    });
  } catch (err) {
    console.error('prepare template error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

function formatDate(iso) {
  if (!iso) return new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function generateCertificateNo(institutionId) {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `VRF-${institutionId}-${y}-${rand}`;
}

module.exports = exports;
