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
  // belt_from / belt_to — draggable pins that render the student's
  // belt PROGRESSION (previous belt → current belt) as read from
  // their most recent belt_promotion row. They complement the
  // existing `belt_name` pin (which is the current belt only) so
  // an institution can show either "Blue Belt" or the full
  // "White Belt → Yellow Belt" transition anywhere on the artwork.
  'belt_from', 'belt_to',
  'certificate_no', 'issue_date', 'completion_date',
  'instructor_name', 'institution_name', 'branch_name',
  'venue', 'duration',
  'verification_url',
  'seal', 'digital_signature',
];

// Placeholders whose rendered form is an image (backed by the
// template's signature_url / seal_url).
const IMAGE_KEYS = new Set(['digital_signature', 'seal']);

// Canonical belt-rank order used to gate certificate dispatch by the
// template's [from_belt, to_belt] range. Must stay in sync with the
// mobile pickers (EditStudentScreen / EnrollmentFormScreen /
// CertificateTemplateEditorScreen). "New student" sits before White
// so pre-enrolment rows can still be filtered.
const BELT_ORDER = [
  'New student',
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue I',
  'Blue II',
  'Gray',
  'Brown I',
  'Brown II',
  'Brown III',
  'Black',
];
const BELT_INDEX = new Map(BELT_ORDER.map((b, i) => [b.toLowerCase(), i]));

// Normalise a raw belt label ("Grey Belt", "blue-i", "BLACK") down to
// its canonical form for the order lookup. Anything unknown returns
// -1 so the range check falls through to a soft-fail (never dispatch
// a certificate against an unrecognised belt when the gate is on).
function beltRankIndex(raw) {
  if (!raw) return -1;
  let s = String(raw).trim().toLowerCase();
  // Strip trailing "belt" so "White Belt" and "White" collide.
  s = s.replace(/\s+belt$/i, '').trim();
  // British / American spelling — treat grey as gray.
  if (s === 'grey') s = 'gray';
  if (BELT_INDEX.has(s)) return BELT_INDEX.get(s);
  // Roman numeral quirks — the mobile stores "Blue I" but some older
  // rows use "Blue 1". Normalise digits to numerals.
  s = s.replace(/\b1\b/g, 'i').replace(/\b2\b/g, 'ii').replace(/\b3\b/g, 'iii');
  if (BELT_INDEX.has(s)) return BELT_INDEX.get(s);
  return -1;
}

// Exported so the course-completion controller can enforce the same
// belt-range gate at dispatch time.
exports.beltRankIndex = beltRankIndex;
exports.BELT_ORDER = BELT_ORDER;

// Given a template row and a candidate belt label, decide whether the
// certificate should be dispatched. When belt_range_active is FALSE we
// return { ok: true } — the gate is off. When it's TRUE we require
// both bounds to resolve AND the candidate to sit inside the closed
// interval. Missing bounds fail-closed with a clear message so the
// admin knows what to fix.
exports.checkBeltRange = function checkBeltRange(template, candidateBelt) {
  if (!template) return { ok: true };
  if (!template.belt_range_active) return { ok: true };
  const from = beltRankIndex(template.from_belt);
  const to   = beltRankIndex(template.to_belt);
  if (from < 0 || to < 0) {
    return {
      ok: false,
      message: 'This template has an active belt range but From / To are not set. Open the template and pick both belts, or turn the range Off.',
    };
  }
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const idx = beltRankIndex(candidateBelt);
  if (idx < 0) {
    return {
      ok: false,
      message: `Student's belt ("${candidateBelt || '—'}") is not on the standard list, so it can't be checked against the template's belt range. Turn the range Off on this template or update the student's belt.`,
    };
  }
  if (idx < lo || idx > hi) {
    return {
      ok: false,
      message: `Student's belt (${candidateBelt}) is outside this template's active range (${template.from_belt} → ${template.to_belt}). Pick another template or widen / disable the range.`,
    };
  }
  return { ok: true };
};

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
    // My Certificates only — sample rows live in a separate list
    // (see exports.listSamples) so the mobile UI can render them in
    // their own section without accidentally letting the institution
    // edit / delete a shared platform sample.
    const r = await pool.query(
      `SELECT * FROM certificate_templates
        WHERE institution_id = $1
          AND is_sample = FALSE
        ORDER BY is_default DESC, created_at DESC`,
      [institutionId],
    );
    res.json({ count: r.rows.length, templates: r.rows });
  } catch (err) {
    console.error('list templates error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/certificate-templates/samples
//
// Global sample certificate templates published by the super-admin
// web panel. Any authenticated institution admin (or super admin)
// can read this list. Rows are read-only from the mobile side; the
// only mutating action available is "Use as Template" (a copy into
// the caller's own institution templates — see exports.copySample).
exports.listSamples = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM certificate_templates
        WHERE is_sample = TRUE
        ORDER BY is_default DESC, created_at DESC`,
    );
    res.json({ count: r.rows.length, templates: r.rows });
  } catch (err) {
    console.error('list samples error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/certificate-templates/samples
// Super-admin only. Creates a sample row that lives platform-wide.
exports.createSample = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const b = req.body || {};
    if (!b.name || !b.background_url) {
      return res.status(400).json({ message: 'name and background_url are required' });
    }
    // A sample can also be marked default — enforced platform-wide by
    // the partial unique index from migration 071.
    const wantDefault = !!b.is_default;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (wantDefault) {
        await client.query(
          `UPDATE certificate_templates SET is_default = FALSE
            WHERE is_sample = TRUE AND is_default = TRUE`,
        );
      }
      const r = await client.query(
        `INSERT INTO certificate_templates
           (institution_id, name, background_url, background_kind,
            canvas_width, canvas_height, placeholders,
            signature_url, seal_url,
            from_belt, to_belt, belt_range_active,
            is_default, is_sample, created_by)
         VALUES (NULL, $1, $2, $3, $4, $5, $6::jsonb, $7, $8,
                 $9, $10, $11, $12, TRUE, $13)
         RETURNING *`,
        [
          String(b.name).slice(0, 120),
          String(b.background_url).slice(0, 500),
          b.background_kind === 'pdf' ? 'pdf' : 'image',
          Number.isFinite(b.canvas_width)  ? b.canvas_width  : 1000,
          Number.isFinite(b.canvas_height) ? b.canvas_height : 700,
          JSON.stringify(sanitisePlaceholders(b.placeholders)),
          b.signature_url ? String(b.signature_url).slice(0, 500) : null,
          b.seal_url      ? String(b.seal_url).slice(0, 500)      : null,
          b.from_belt ? String(b.from_belt).slice(0, 40) : null,
          b.to_belt   ? String(b.to_belt).slice(0, 40)   : null,
          !!b.belt_range_active,
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
    console.error('create sample error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/certificate-templates/samples/:id
// Super-admin only. Updates a sample row.
exports.updateSample = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

    const check = await pool.query(
      `SELECT is_sample FROM certificate_templates WHERE id = $1`, [id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (!check.rows[0].is_sample) {
      return res.status(400).json({ message: 'Row is an institution template, not a sample' });
    }

    const b = req.body || {};
    const sigProvided  = Object.prototype.hasOwnProperty.call(b, 'signature_url');
    const sealProvided = Object.prototype.hasOwnProperty.call(b, 'seal_url');
    const sigValue     = sigProvided  ? (b.signature_url ? String(b.signature_url).slice(0, 500) : null) : undefined;
    const sealValue    = sealProvided ? (b.seal_url      ? String(b.seal_url).slice(0, 500)      : null) : undefined;

    const fromProvided  = Object.prototype.hasOwnProperty.call(b, 'from_belt');
    const toProvided    = Object.prototype.hasOwnProperty.call(b, 'to_belt');
    const activeProvided = Object.prototype.hasOwnProperty.call(b, 'belt_range_active');
    const fromValue     = fromProvided ? (b.from_belt ? String(b.from_belt).slice(0, 40) : null) : undefined;
    const toValue       = toProvided   ? (b.to_belt   ? String(b.to_belt).slice(0, 40)   : null) : undefined;
    const activeValue   = activeProvided ? !!b.belt_range_active : null;

    const r = await pool.query(
      `UPDATE certificate_templates SET
         name              = COALESCE($2, name),
         background_url    = COALESCE(NULLIF($3, ''), background_url),
         background_kind   = COALESCE($4, background_kind),
         canvas_width      = COALESCE($5, canvas_width),
         canvas_height     = COALESCE($6, canvas_height),
         placeholders      = COALESCE($7::jsonb, placeholders),
         signature_url     = CASE WHEN $9::boolean  THEN $8  ELSE signature_url     END,
         seal_url          = CASE WHEN $11::boolean THEN $10 ELSE seal_url          END,
         from_belt         = CASE WHEN $13::boolean THEN $12 ELSE from_belt         END,
         to_belt           = CASE WHEN $15::boolean THEN $14 ELSE to_belt           END,
         belt_range_active = CASE WHEN $17::boolean THEN $16 ELSE belt_range_active END,
         updated_at        = NOW()
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
        fromValue ?? null, fromProvided,
        toValue   ?? null, toProvided,
        activeValue, activeProvided,
      ],
    );
    res.json({ template: r.rows[0] });
  } catch (err) {
    console.error('update sample error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/certificate-templates/samples/:id — super-admin only.
exports.removeSample = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const r = await pool.query(
      `DELETE FROM certificate_templates
        WHERE id = $1 AND is_sample = TRUE
        RETURNING id`,
      [id],
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Not found or not a sample' });
    res.json({ ok: true });
  } catch (err) {
    console.error('remove sample error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PATCH /api/certificate-templates/samples/:id/default — super-admin.
exports.setSampleDefault = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Super admin only' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await client.query(
        `SELECT id FROM certificate_templates
          WHERE id = $1 AND is_sample = TRUE FOR UPDATE`,
        [id],
      );
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Not found' });
      }
      await client.query(
        `UPDATE certificate_templates SET is_default = FALSE
          WHERE is_sample = TRUE AND is_default = TRUE`,
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
    console.error('set sample default error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/certificate-templates/samples/:id/copy
// Institution admin "Use as Template" — deep-copies a sample row
// into the caller's own institution templates. The clone starts
// with is_sample = FALSE, institution_id = caller's institution,
// is_default = FALSE, and sample_id = the source sample so the UI
// can badge "Based on sample X" and the source stays untouched.
exports.copySample = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

    const src = await pool.query(
      `SELECT * FROM certificate_templates
        WHERE id = $1 AND is_sample = TRUE`,
      [id],
    );
    if (src.rows.length === 0) {
      return res.status(404).json({ message: 'Sample not found' });
    }
    const s = src.rows[0];

    const r = await pool.query(
      `INSERT INTO certificate_templates
         (institution_id, name, background_url, background_kind,
          canvas_width, canvas_height, placeholders,
          signature_url, seal_url,
          from_belt, to_belt, belt_range_active,
          is_default, is_sample, sample_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
               $10, $11, $12, FALSE, FALSE, $13, $14)
       RETURNING *`,
      [
        institutionId,
        `${s.name} (Copy)`.slice(0, 120),
        s.background_url,
        s.background_kind,
        s.canvas_width,
        s.canvas_height,
        JSON.stringify(s.placeholders || []),
        s.signature_url,
        s.seal_url,
        s.from_belt,
        s.to_belt,
        !!s.belt_range_active,
        s.id,
        req.user.id,
      ],
    );
    res.status(201).json({ template: r.rows[0] });
  } catch (err) {
    console.error('copy sample error:', err);
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
            from_belt, to_belt, belt_range_active,
            is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
                 $10, $11, $12, $13, $14)
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
          // Belt-range gate — persisted so we can enforce it at
          // dispatch time. Defaults keep the gate off so a fresh
          // template accepts any belt.
          b.from_belt ? String(b.from_belt).slice(0, 40) : null,
          b.to_belt   ? String(b.to_belt).slice(0, 40)   : null,
          !!b.belt_range_active,
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

    // Belt-range fields — same tri-state pattern as signature/seal so
    // the frontend can send '' to clear a bound and undefined to leave
    // it untouched. The boolean flag flips independently.
    const fromProvided  = Object.prototype.hasOwnProperty.call(b, 'from_belt');
    const toProvided    = Object.prototype.hasOwnProperty.call(b, 'to_belt');
    const activeProvided = Object.prototype.hasOwnProperty.call(b, 'belt_range_active');
    const fromValue     = fromProvided ? (b.from_belt ? String(b.from_belt).slice(0, 40) : null) : undefined;
    const toValue       = toProvided   ? (b.to_belt   ? String(b.to_belt).slice(0, 40)   : null) : undefined;
    const activeValue   = activeProvided ? !!b.belt_range_active : null;

    const r = await pool.query(
      `UPDATE certificate_templates SET
         name              = COALESCE($2, name),
         background_url    = COALESCE(NULLIF($3, ''), background_url),
         background_kind   = COALESCE($4, background_kind),
         canvas_width      = COALESCE($5, canvas_width),
         canvas_height     = COALESCE($6, canvas_height),
         placeholders      = COALESCE($7::jsonb, placeholders),
         signature_url     = CASE WHEN $9::boolean  THEN $8  ELSE signature_url     END,
         seal_url          = CASE WHEN $11::boolean THEN $10 ELSE seal_url          END,
         from_belt         = CASE WHEN $13::boolean THEN $12 ELSE from_belt         END,
         to_belt           = CASE WHEN $15::boolean THEN $14 ELSE to_belt           END,
         belt_range_active = CASE WHEN $17::boolean THEN $16 ELSE belt_range_active END,
         updated_at        = NOW()
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
        fromValue ?? null, fromProvided,
        toValue   ?? null, toProvided,
        activeValue, activeProvided,
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
    // Pull the student's current belt for the belt-range gate below.
    // Preview flows (no completion_id) skip the gate — the admin is
    // just eyeballing the layout.
    let candidateBelt = null;
    if (Number.isInteger(completionId)) {
      // Extended query — pulls the branch name (from institutions.name
      // when a batch pinned the enrolment to a sub-branch), course
      // duration, and the trainer's name so the new placeholders have
      // real values to merge against.
      const dRes = await pool.query(
        `SELECT
           cc.id, cc.student_id, cc.certificate_sent_at, cc.course_completed_at,
           cc.belt_test_completed_at, cc.test_remarks,
           u.name  AS student_name,
           sp.belt_category AS student_belt,
           c.name  AS course_name,
           c.duration_months     AS course_duration_months,
           i.name  AS institution_name,
           i.city  AS institution_city,
           br.name AS branch_name,
           trainer.name AS trainer_name
         FROM course_completions cc
         JOIN users u    ON u.id = cc.student_id
         LEFT JOIN student_profiles sp ON sp.user_id = cc.student_id
         JOIN courses c  ON c.id = cc.course_id
         LEFT JOIN institutions i ON i.id = cc.institution_id
         LEFT JOIN batches       b ON b.id = cc.batch_id
         LEFT JOIN institutions br ON br.id = b.branch_id
         LEFT JOIN users trainer  ON trainer.id = cc.trainer_id
        WHERE cc.id = $1`,
        [completionId],
      );
      data = dRes.rows[0] || null;
      candidateBelt = req.body?.belt_name || data?.student_belt || null;

      // Belt PROGRESSION (belt_from → belt_to) for the new
      // draggable pins. Reads the student's most recent
      // belt_promotions row. If no promotion exists (e.g. the
      // certificate isn't tied to a grading event) both fields
      // resolve to empty strings and the pins render blank —
      // matching the spec: "If a certificate is not associated
      // with a belt promotion, the fields should remain blank
      // or be hidden."
      try {
        const bp = await pool.query(
          `SELECT previous_belt, new_belt
             FROM belt_promotions
            WHERE student_id = $1
            ORDER BY promoted_at DESC
            LIMIT 1`,
          [dRes.rows[0]?.student_id || 0],
        );
        if (bp.rows.length > 0) {
          data.belt_from = bp.rows[0].previous_belt || '';
          data.belt_to   = bp.rows[0].new_belt      || '';
        }
      } catch (_) {
        // belt_promotions table optional / older schema — leave the
        // fields empty so the pins render blank per spec.
      }

      // Belt-range gate — reject preview when the student's belt sits
      // outside the template's active range. The admin sees the
      // message immediately and can pick a different template.
      const gate = exports.checkBeltRange(template, candidateBelt);
      if (!gate.ok) {
        return res.status(422).json({
          message: gate.message,
          code: 'BELT_RANGE_BLOCKED',
        });
      }
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
      belt_name:        candidateBelt          || req.body?.belt_name || 'White Belt',
      // Belt progression — resolved from belt_promotions.previous_belt
      // → belt_promotions.new_belt above. Empty strings when no
      // promotion exists so the pin renders blank on the certificate
      // per spec.
      belt_from:        data?.belt_from || '',
      belt_to:          data?.belt_to   || '',
      certificate_no:   generateCertificateNo(institutionId),
      issue_date:       formatDate(new Date()),                    // NEW — today
      completion_date:  formatDate(data?.belt_test_completed_at || data?.course_completed_at),
      instructor_name:  data?.trainer_name     || '—',
      institution_name: data?.institution_name || 'Sample Academy',
      branch_name:      data?.branch_name      || '',              // NEW — sub-branch
      venue:            data?.institution_city  || 'Chennai',
      duration:         durationLabel,                             // NEW — course duration
      verification_url: verifyUrl,   // printed as text on the certificate
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
