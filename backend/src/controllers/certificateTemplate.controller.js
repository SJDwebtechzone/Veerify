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

// ── Placeholder catalogue ────────────────────────────────────────────
// Full list of certificate fields the admin can toggle on/off per
// template. Each pin the mobile draws MUST use a key from this list.
// New keys (introduced with the field-visibility work):
//   • issue_date       — when the cert was minted (defaults to today)
//   • branch_name      — sub-branch of the institution
//   • duration         — length of the course in months / weeks
//   • verification_url — link the public verify page shows
//   • seal             — academy seal / stamp (image-driven)
//
// digital_signature and seal are IMAGE placeholders — the renderer
// swaps their text for template.signature_url / template.seal_url when
// present AND the pin is active. Everything else is text.
const PLACEHOLDER_KEYS = [
  'student_name', 'course_name', 'belt_name',
  'certificate_no', 'issue_date', 'completion_date',
  'instructor_name', 'institution_name', 'branch_name',
  'venue', 'duration',
  'qr_code', 'verification_url',
  'seal', 'digital_signature',
];

// Placeholders whose rendered form is an image (backed by the
// template's signature_url / seal_url).
const IMAGE_KEYS = new Set(['digital_signature', 'seal']);

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
//
// `active` — persisted per pin so the admin can hide a field on the
// generated cert without removing the pin from the canvas. Defaults to
// TRUE when the flag is omitted (older mobile builds don't send it).
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
    // Explicit false means "hide on the generated cert"; every other
    // value (undefined / null / true) reads as active so pre-existing
    // pins keep rendering after the migration.
    active:    raw.active === false ? false : true,
    // Only meaningful for IMAGE_KEYS. width/height are relative to the
    // canvas so the layout survives DPI changes.
    width:     clamp(raw.width  ?? 0.20, 0.05, 1),
    height:    clamp(raw.height ?? 0.10, 0.02, 1),
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
            signature_url, seal_url,
            is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
         RETURNING *`,
        [
          institutionId,
          String(b.name).slice(0, 120),
          String(b.background_url).slice(0, 500),
          b.background_kind === 'pdf' ? 'pdf' : 'image',
          Number.isFinite(b.canvas_width)  ? b.canvas_width  : 1000,
          Number.isFinite(b.canvas_height) ? b.canvas_height : 700,
          JSON.stringify(sanitisePlaceholders(b.placeholders)),
          // Signature + seal uploads land here. Blank strings collapse
          // to NULL so the frontend can send '' to clear them.
          b.signature_url ? String(b.signature_url).slice(0, 500) : null,
          b.seal_url      ? String(b.seal_url).slice(0, 500)      : null,
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
    // Signature / seal handling — three states:
    //   • field absent         → keep existing
    //   • field === ''         → clear (admin removed the upload)
    //   • field === 'xxx'      → replace with new path
    // We encode those into COALESCE-friendly nulls below by sending a
    // sentinel for "clear" and letting the SQL blend it in via CASE.
    const sigProvided  = Object.prototype.hasOwnProperty.call(b, 'signature_url');
    const sealProvided = Object.prototype.hasOwnProperty.call(b, 'seal_url');
    const sigValue     = sigProvided  ? (b.signature_url ? String(b.signature_url).slice(0, 500) : null) : undefined;
    const sealValue    = sealProvided ? (b.seal_url      ? String(b.seal_url).slice(0, 500)      : null) : undefined;

    const r = await pool.query(
      `UPDATE certificate_templates SET
         name             = COALESCE($2, name),
         background_url   = COALESCE(NULLIF($3, ''), background_url),
         background_kind  = COALESCE($4, background_kind),
         canvas_width     = COALESCE($5, canvas_width),
         canvas_height    = COALESCE($6, canvas_height),
         placeholders     = COALESCE($7::jsonb, placeholders),
         signature_url    = CASE WHEN $9::boolean THEN $8 ELSE signature_url END,
         seal_url         = CASE WHEN $11::boolean THEN $10 ELSE seal_url    END,
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
        sigValue  ?? null, sigProvided,
        sealValue ?? null, sealProvided,
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
      // Extended query — pulls the branch name (from institutions.name
      // when a batch pinned the enrolment to a sub-branch), course
      // duration, and the trainer's name so the new placeholders have
      // real values to merge against.
      const dRes = await pool.query(
        `SELECT
           cc.id, cc.certificate_sent_at, cc.course_completed_at,
           cc.belt_test_completed_at, cc.test_remarks,
           u.name  AS student_name,
           c.name  AS course_name,
           c.duration_months     AS course_duration_months,
           i.name  AS institution_name,
           i.city  AS institution_city,
           br.name AS branch_name,
           trainer.name AS trainer_name
         FROM course_completions cc
         JOIN users u    ON u.id = cc.student_id
         JOIN courses c  ON c.id = cc.course_id
         LEFT JOIN institutions i ON i.id = cc.institution_id
         LEFT JOIN batches       b ON b.id = cc.batch_id
         LEFT JOIN institutions br ON br.id = b.branch_id
         LEFT JOIN users trainer  ON trainer.id = cc.trainer_id
        WHERE cc.id = $1`,
        [completionId],
      );
      data = dRes.rows[0] || null;
    }

    // Public verify page — the QR / verification_url placeholders point
    // here. process.env.APP_PUBLIC_URL is used when set (production) so
    // the printed link is a real reachable URL, not localhost.
    const verifyBase = process.env.APP_PUBLIC_URL
      || process.env.APP_BASE_URL
      || 'https://veerify.app';
    const verifyUrl = Number.isInteger(completionId)
      ? `${verifyBase.replace(/\/$/, '')}/verify/${completionId}`
      : `${verifyBase.replace(/\/$/, '')}/verify`;

    const durationMonths = data?.course_duration_months;
    const durationLabel = durationMonths
      ? `${durationMonths} ${durationMonths === 1 ? 'month' : 'months'}`
      : '';

    // Build the map of {key: value}. Defaults keep the preview useful.
    // Every placeholder key defined in PLACEHOLDER_KEYS must resolve to
    // a value here — even if that value is an empty string — so the
    // renderer never has to reach for `pin.key` that isn't present.
    const sample = {
      student_name:     data?.student_name     || 'Sample Student',
      course_name:      data?.course_name      || 'Sample Course',
      belt_name:        req.body?.belt_name     || 'White Belt',
      certificate_no:   generateCertificateNo(institutionId),
      issue_date:       formatDate(new Date()),                    // NEW — today
      completion_date:  formatDate(data?.belt_test_completed_at || data?.course_completed_at),
      instructor_name:  data?.trainer_name     || '—',
      institution_name: data?.institution_name || 'Sample Academy',
      branch_name:      data?.branch_name      || '',              // NEW — sub-branch
      venue:            data?.institution_city  || 'Chennai',
      duration:         durationLabel,                             // NEW — course duration
      qr_code:          verifyUrl,   // mobile renders a QR from this URL
      verification_url: verifyUrl,   // NEW — printed as text alongside the QR
      digital_signature:'',           // image-driven; renderer looks at template.signature_url
      seal:             '',           // image-driven; renderer looks at template.seal_url
    };

    // Drop inactive pins BEFORE merging so the mobile renderer never
    // sees a hidden field. This is the enforcement point for the spec:
    // "Only fields marked Active should appear on generated certificates."
    const active = (template.placeholders || []).filter(
      (pin) => pin.active !== false,
    );
    const merged = active.map((pin) => ({
      ...pin,
      value: sample[pin.key] ?? '',
      // Convenience — surface signature/seal URLs on the pin so the
      // mobile renderer doesn't have to cross-reference the template
      // payload for image placeholders.
      image_url: pin.key === 'digital_signature'
        ? (template.signature_url || null)
        : pin.key === 'seal'
          ? (template.seal_url || null)
          : null,
    }));

    res.json({
      template: {
        id: template.id, name: template.name,
        background_url: template.background_url,
        background_kind: template.background_kind,
        canvas_width:  template.canvas_width,
        canvas_height: template.canvas_height,
        signature_url: template.signature_url || null,
        seal_url:      template.seal_url      || null,
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
