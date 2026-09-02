// src/controllers/eventRegistrationForm.controller.js
//
// MODULE 1: Registration-form definition CRUD for a single event.
//
// Every endpoint here works on the *definition* of the form the
// organizing institution wants participating institutions to fill
// when they later register students. The actual submission flow
// (Module 2) is intentionally NOT implemented here.
//
// Endpoints mounted at /api/events/:eventId/registration-form :
//
//   GET  ...                → Any authenticated user can read the
//                             definition (participating institutions
//                             need to know what to fill later).
//   PUT  ...                → Full replace. Only the event's owning
//                             institution admin can write. Body:
//                               { enabled: boolean, fields: [ ... ] }
//                             The controller normalises field_key,
//                             validates options for enum types, and
//                             wipes-and-inserts inside a transaction
//                             so a partial failure never leaves the
//                             form in a half-saved state.

const pool = require('../config/db');

// Canonical set of student profile fields the organizer can pull in
// as "please supply this at registration". source_key is the column
// name on students the Module 2 registration flow will later
// auto-populate from. Extending this list is safe — nothing else
// hard-codes it.
// Keep this array in lockstep with DEFAULT_STUDENT_CATALOG in
// veerify_mobile/src/components/RegistrationFormBuilder.js — the
// mobile side is the design surface, this is the write-side gate.
// Any new source_key added on the mobile must exist here too, or
// PUT /registration-form will reject it.
const STUDENT_FIELD_CATALOG = [
  { source_key: 'name',         label: 'Student Name' },
  { source_key: 'dob',          label: 'Date of Birth' },
  { source_key: 'gender',       label: 'Gender' },
  { source_key: 'phone',        label: 'Phone' },
  { source_key: 'email',        label: 'Email' },
  { source_key: 'belt_level',   label: 'Belt Level' },
  // 'skills' replaces the older 'course' default. 'course' is kept
  // here for backwards compat with any pre-existing PUTs — a form
  // saved before the rename can still round-trip cleanly.
  { source_key: 'skills',       label: 'Skills' },
  { source_key: 'course',       label: 'Course' },
  { source_key: 'institution',  label: 'Institution' },
  { source_key: 'branch',       label: 'Branch' },
  // Extended defaults added when the form's mandatory-fields set
  // grew (Father's Name, Mother's Name, Student Photo, Address,
  // Master Name, District, State). Every one of these auto-populates
  // from student_profiles where a column exists; the rest fall back
  // to manual entry on the participant form.
  { source_key: 'father_name',  label: "Father's Name" },
  { source_key: 'mother_name',  label: "Mother's Name" },
  { source_key: 'photo_url',    label: 'Student Photo' },
  { source_key: 'address',      label: 'Address' },
  { source_key: 'master_name',  label: 'Master Name' },
  { source_key: 'district',     label: 'District' },
  { source_key: 'state',        label: 'State' },
  // 12-digit government ID. Auto-populates from
  // student_profiles.aadhaar_number when the column exists; on the
  // participant form it renders as a numeric input with a 12-digit
  // validation rule.
  { source_key: 'aadhaar_number', label: 'Aadhaar Number' },
];
const STUDENT_KEYS = new Set(STUDENT_FIELD_CATALOG.map((f) => f.source_key));

// Field types the custom builder supports. Keep in sync with the
// CHECK constraint on event_registration_fields.field_type.
const CUSTOM_FIELD_TYPES = new Set([
  'text', 'number', 'date',
  'dropdown', 'radio', 'checkbox', 'textarea', 'file',
]);
const ENUM_FIELD_TYPES = new Set(['dropdown', 'radio', 'checkbox']);

// Lower-case snake_case slug — used to derive a stable field_key
// from a human-readable label. Collisions are surfaced by the
// UNIQUE (event_id, field_key) index at write time.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// Resolve the institution the current admin belongs to. Sub-branch
// admins pass through — the OWNER of the event is whichever
// institution row owns the mobile_events row, and we check that
// explicitly below.
async function resolveAdminInstitution(userId) {
  const r = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

/**
 * GET /api/events/:eventId/registration-form
 *
 * Public to any signed-in user. Returns { enabled, fields } sorted
 * by sort_order. If the event doesn't exist → 404. If registration
 * is disabled the endpoint still returns the current field list
 * (may be empty) so the organizer's editor can re-enable without
 * losing the previously-configured form.
 */
exports.getForm = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }

    // Read categories alongside the enable flag so the participant
    // Registration Form can populate its Skills dropdown from THIS
    // event's own Categories & Skills list (single source of truth).
    // Best-effort SELECT — falls back to a categories-less shape on
    // environments that haven't run migration 096 yet so the form
    // still loads.
    let evt;
    try {
      evt = await pool.query(
        `SELECT id, registration_enabled, categories
           FROM mobile_events WHERE id = $1`,
        [eventId],
      );
    } catch (colErr) {
      if (colErr?.code === '42703') {
        evt = await pool.query(
          `SELECT id, registration_enabled FROM mobile_events WHERE id = $1`,
          [eventId],
        );
      } else {
        throw colErr;
      }
    }
    if (evt.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found.' });
    }

    const rows = await pool.query(
      `SELECT id, field_key, field_label, field_type, required,
              options, source_type, source_key, sort_order
         FROM event_registration_fields
        WHERE event_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [eventId],
    );

    const fields = rows.rows.map((r) => ({
      id:         r.id,
      fieldKey:   r.field_key,
      label:      r.field_label,
      type:       r.field_type,
      required:   !!r.required,
      options:    r.options || null,
      sourceType: r.source_type,
      sourceKey:  r.source_key,
      sortOrder:  r.sort_order,
    }));

    // Flatten categories → deduped skills list. The participant
    // Registration Form uses this for the Skills dropdown when the
    // student's own snapshot doesn't carry a skill value.
    const cats = Array.isArray(evt.rows[0].categories)
      ? evt.rows[0].categories
      : [];
    const skillsSet = new Set();
    const skillsOptions = [];
    cats.forEach((c) => {
      (c?.skills || []).forEach((s) => {
        const name = String(s?.name || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (skillsSet.has(key)) return;
        skillsSet.add(key);
        skillsOptions.push(name);
      });
    });

    res.json({
      enabled: !!evt.rows[0].registration_enabled,
      fields,
      // Full categories block + a flat convenience list of skill
      // names — either works for the front-end. `skills_options`
      // stays in canonical insertion order so the dropdown mirrors
      // the organiser's ordering from Categories & Skills.
      categories: cats,
      skills_options: skillsOptions,
    });
  } catch (err) {
    console.error('registration-form get error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * PUT /api/events/:eventId/registration-form
 *
 * Full replace. Body:
 *   {
 *     enabled: boolean,
 *     fields: [
 *       { sourceType: 'student', sourceKey: 'name',        required: true, sortOrder: 1 },
 *       { sourceType: 'custom',  label: 'Competition Weight',
 *         type: 'number',   required: true,  sortOrder: 2 },
 *       { sourceType: 'custom',  label: 'T-Shirt Size',
 *         type: 'dropdown', required: true,  sortOrder: 3,
 *         options: [ { label: 'S', value: 'S' }, ... ] },
 *       ...
 *     ]
 *   }
 *
 * Auth: only the event's owning institution admin can PUT. The
 * whole thing runs inside a single transaction — old rows are
 * deleted, new rows inserted, master switch flipped, all-or-nothing.
 */
exports.putForm = async (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(eventId)) {
    return res.status(400).json({ message: 'Invalid event id.' });
  }

  const { enabled, fields } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: '`enabled` must be a boolean.' });
  }
  if (!Array.isArray(fields)) {
    return res.status(400).json({ message: '`fields` must be an array.' });
  }
  if (enabled && fields.length === 0) {
    return res.status(400).json({
      message: 'At least one registration field is required when registration is enabled.',
    });
  }

  // ── Ownership check ────────────────────────────────────────────
  const adminInstitutionId = await resolveAdminInstitution(req.user.id);
  if (!adminInstitutionId) {
    return res.status(403).json({ message: 'No institution linked to this admin.' });
  }
  const evtRow = await pool.query(
    `SELECT institution_id FROM mobile_events WHERE id = $1`,
    [eventId],
  );
  if (evtRow.rowCount === 0) {
    return res.status(404).json({ message: 'Event not found.' });
  }
  if (Number(evtRow.rows[0].institution_id) !== Number(adminInstitutionId)) {
    return res.status(403).json({
      message: 'Only the organizing institution can edit this event\'s registration form.',
    });
  }

  // ── Validate + normalise fields ────────────────────────────────
  const seenKeys = new Set();
  const seenLabels = new Set();
  const cleaned = [];

  for (let idx = 0; idx < fields.length; idx += 1) {
    const raw = fields[idx] || {};
    const sourceType = raw.sourceType === 'student' ? 'student' : 'custom';
    const required   = !!raw.required;
    const sortOrder  = Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : idx;

    let label;
    let fieldType;
    let fieldKey;
    let sourceKey = null;
    let options   = null;

    if (sourceType === 'student') {
      // Student-profile reference — sourceKey MUST be one of the
      // canonical catalog entries.
      sourceKey = String(raw.sourceKey || '').trim();
      if (!STUDENT_KEYS.has(sourceKey)) {
        return res.status(400).json({
          field: 'sourceKey',
          message: `Unknown student field "${sourceKey}".`,
        });
      }
      label     = STUDENT_FIELD_CATALOG.find((f) => f.source_key === sourceKey).label;
      fieldType = 'student';
      fieldKey  = sourceKey;
    } else {
      // Custom field.
      label = String(raw.label || '').trim();
      if (!label) {
        return res.status(400).json({
          field: 'label',
          message: 'Custom field label cannot be empty.',
        });
      }
      fieldType = String(raw.type || '').trim().toLowerCase();
      if (!CUSTOM_FIELD_TYPES.has(fieldType)) {
        return res.status(400).json({
          field: 'type',
          message: `Unsupported field type "${fieldType}".`,
        });
      }

      // Options mandatory for enum-style types.
      if (ENUM_FIELD_TYPES.has(fieldType)) {
        const opts = Array.isArray(raw.options) ? raw.options : [];
        const norm = opts
          .map((o) => {
            if (typeof o === 'string') {
              const t = o.trim();
              return t ? { label: t, value: t } : null;
            }
            const l = String(o?.label || '').trim();
            const v = String(o?.value ?? l).trim();
            return l && v ? { label: l, value: v } : null;
          })
          .filter(Boolean);
        if (norm.length === 0) {
          return res.status(400).json({
            field: 'options',
            message: `Field "${label}" needs at least one option.`,
          });
        }
        options = norm;
      }

      fieldKey = slugify(label);
      if (!fieldKey) fieldKey = `custom_${idx + 1}`;
    }

    // Client-side dup detection so we return a clean 400 instead of
    // relying on the UNIQUE index to throw a raw 500.
    const dupKeyOf = fieldKey;
    if (seenKeys.has(dupKeyOf)) {
      return res.status(400).json({
        field: 'label',
        message: `Duplicate field "${label}". Field labels must be unique on an event.`,
      });
    }
    seenKeys.add(dupKeyOf);
    const labelSlug = slugify(label);
    if (seenLabels.has(labelSlug)) {
      return res.status(400).json({
        field: 'label',
        message: `Duplicate field label "${label}".`,
      });
    }
    seenLabels.add(labelSlug);

    cleaned.push({
      fieldKey,
      label,
      fieldType,
      required,
      options,
      sourceType,
      sourceKey,
      sortOrder,
    });
  }

  // ── Wipe + insert inside a transaction ─────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE mobile_events SET registration_enabled = $2 WHERE id = $1`,
      [eventId, enabled],
    );

    await client.query(
      `DELETE FROM event_registration_fields WHERE event_id = $1`,
      [eventId],
    );

    for (const f of cleaned) {
      await client.query(
        `INSERT INTO event_registration_fields
           (event_id, field_key, field_label, field_type, required,
            options, source_type, source_key, sort_order,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          eventId,
          f.fieldKey,
          f.label,
          f.fieldType,
          f.required,
          f.options ? JSON.stringify(f.options) : null,
          f.sourceType,
          f.sourceKey,
          f.sortOrder,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('registration-form put error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }

  // Return the freshly-saved definition so the client can seed its
  // local state without an extra GET round-trip.
  return exports.getForm(req, res);
};

// Exposed so the mobile side can render the standard catalog
// without hard-coding the labels client-side.
exports.STUDENT_FIELD_CATALOG = STUDENT_FIELD_CATALOG;

/**
 * GET /api/config/registration-form
 *
 * Returns the shared metadata the Registration Form builder needs:
 * the canonical student-field catalog + the supported custom field
 * types. Kept as its own tiny endpoint so both the Create Event
 * screen (Module 1) and the future submission flow (Module 2) can
 * pull one source of truth.
 */
exports.getConfig = (_req, res) => {
  res.json({
    student_fields: STUDENT_FIELD_CATALOG,
    custom_types: [
      { value: 'text',     label: 'Text' },
      { value: 'number',   label: 'Number' },
      { value: 'date',     label: 'Date' },
      { value: 'dropdown', label: 'Dropdown' },
      { value: 'radio',    label: 'Radio' },
      { value: 'checkbox', label: 'Checkbox' },
      { value: 'textarea', label: 'Textarea' },
      { value: 'file',     label: 'File Upload' },
    ],
  });
};
