const pool = require('../config/db');

// Helper: get the admin's institution_id
const getAdminInstitutionId = async (userId) => {
  const result = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.institution_id;
};

// ─── Schema-aware column filter ─────────────────────────────────────────
//
// The controller has grown to write ~28 columns on courses. Several of
// those (intro_video_url, curriculum, billing_cycle, trainer_id, …)
// were added by later migrations. On a DB that hasn't caught up, an
// INSERT that names a missing column fails with 42703 and blocks
// course creation entirely.
//
// Rather than special-casing every new column, we ask information_schema
// once (per process) which columns actually exist on `courses` and
// build every INSERT / UPDATE against that intersection. New columns
// still get persisted the moment the migration is applied and the
// process restarts; missing columns are silently skipped with a single
// startup log line so ops knows what's pending.
let coursesColumnSetPromise = null;
async function loadCoursesColumns() {
  if (!coursesColumnSetPromise) {
    coursesColumnSetPromise = (async () => {
      try {
        const r = await pool.query(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name   = 'courses'`,
        );
        return new Set(r.rows.map((row) => row.column_name));
      } catch (err) {
        console.warn('[course] schema probe failed, falling back to full column set:', err?.message);
        return null; // null → treat every column as present
      }
    })();
  }
  return coursesColumnSetPromise;
}
// Clear the cache so the NEXT createCourse / updateCourse re-probes.
// Called from the 42703 catch below so a live migration doesn't need a
// full process restart to be noticed (though restart is still cleaner).
function invalidateCoursesColumns() {
  coursesColumnSetPromise = null;
}
function hasCol(cols, name) {
  return !cols || cols.has(name);
}

// Whitelist of mode / level / badge / status values we accept. Anything else is
// silently dropped to the default so a malformed client can't break the DB.
const ALLOWED_MODES   = new Set(['online', 'offline', 'hybrid']);
const ALLOWED_STATUS  = new Set(['active', 'inactive', 'draft']);
const ALLOWED_BADGES  = new Set(['popular', 'new', 'kids_special']);

function sanitizeCoursePayload(body) {
  // Defensive curriculum normalisation: accept either an array (from the form)
  // or a JSON string (from a poorly-typed client). Anything else → empty array.
  let curriculum = body.curriculum;
  if (typeof curriculum === 'string') {
    try { curriculum = JSON.parse(curriculum); } catch { curriculum = []; }
  }
  if (!Array.isArray(curriculum)) curriculum = [];
  curriculum = curriculum
    .filter((l) => l && (l.title || l.name))
    .map((l, i) => ({
      title:    String(l.title || l.name || '').trim(),
      duration: String(l.duration || '').trim(),
      is_free:  !!l.is_free,
      order:    i,
    }));

  return {
    name:                   body.name,
    short_description:      body.short_description || null,
    description:            body.description || null,
    category:               body.category || null,
    level:                  body.level || 'Beginner',
    age_group:              body.age_group || null,
    duration_months:        parseInt(body.duration_months, 10) || 1,
    days_of_week:           body.days_of_week || null,
    class_start_time:       body.class_start_time || null,
    class_end_time:         body.class_end_time || null,
    batch_size_min:         body.batch_size_min ? parseInt(body.batch_size_min, 10) : null,
    batch_size_max:         body.batch_size_max ? parseInt(body.batch_size_max, 10) : null,
    language:               body.language || 'English',
    price:                  body.price !== undefined ? parseFloat(body.price) : 0,
    // billing_cycle drives the fee label on the payment summary,
    // Razorpay checkout, and invoice PDF. Whitelist the enum + default
    // to 'monthly' so anything unrecognised falls back to legacy behaviour.
    billing_cycle:          (['one_time','monthly','quarterly','half_yearly','annual']
                              .includes(String(body.billing_cycle || '').toLowerCase()))
                              ? String(body.billing_cycle).toLowerCase()
                              : 'monthly',
    admission_fee:          body.admission_fee !== undefined ? parseFloat(body.admission_fee) : 0,
    belt_system:            !!body.belt_system,
    certificate_available:  body.certificate_available === undefined ? true : !!body.certificate_available,
    image_url:              body.image_url || null,
    intro_video_url:        body.intro_video_url || null,
    curriculum,
    badge:                  ALLOWED_BADGES.has(body.badge) ? body.badge : null,
    // trainer_id — foreign key to trainers.id (migration 064). When
    // set, we derive trainer_name from the row so the label + FK stay
    // in sync automatically. Falls back to body.trainer_name for
    // legacy callers still sending a free-text name.
    trainer_id:             body.trainer_id != null && body.trainer_id !== ''
      ? parseInt(body.trainer_id, 10) || null
      : null,
    trainer_name:           body.trainer_name || null,
    branch_name:            body.branch_name || null,
    mode:                   ALLOWED_MODES.has(body.mode) ? body.mode : 'offline',
    status:                 ALLOWED_STATUS.has(body.status) ? body.status : 'active',
  };
}

// CREATE course (admin only)
exports.createCourse = async (req, res) => {
  try {
    const adminId = req.user.id;
    const p = sanitizeCoursePayload(req.body);

    if (!p.name) {
      return res.status(400).json({ message: 'Course name is required' });
    }

    const institutionId = await getAdminInstitutionId(adminId);
    if (!institutionId) {
      return res.status(400).json({
        message: 'You must create an institution first before adding courses',
      });
    }

    // If a trainer_id was picked from the searchable dropdown, resolve
    // the trainer's display name so trainer_name stays in sync. When
    // no trainer_id was sent (legacy path or admin left it blank), we
    // keep whatever body.trainer_name was on the payload.
    if (p.trainer_id) {
      const tr = await pool.query(
        `SELECT u.name FROM trainers t
           JOIN users u ON u.id = t.user_id
          WHERE t.id = $1 AND t.institution_id = $2`,
        [p.trainer_id, institutionId],
      );
      if (tr.rows.length === 0) {
        return res.status(400).json({
          message: 'Selected trainer does not belong to your academy.',
        });
      }
      p.trainer_name = tr.rows[0].name;
    }

    // Build the INSERT against only the columns that actually exist
    // on this DB. On a stale schema (e.g. migration 065 not yet
    // applied) the missing columns are silently omitted so course
    // creation keeps working. A 42703 that slips through despite the
    // probe (rare race with a mid-request migration rollback)
    // invalidates the cache and retries once.
    let result;
    try {
      result = await insertCourseDynamic(pool, institutionId, p);
    } catch (err) {
      if (err?.code === '42703') {
        console.warn(
          '[course] INSERT hit 42703 despite schema probe (%s). Re-probing and retrying once.',
          err?.message,
        );
        invalidateCoursesColumns();
        result = await insertCourseDynamic(pool, institutionId, p);
      } else {
        throw err;
      }
    }

    res.status(201).json({
      message: 'Course created successfully',
      course: result.rows[0],
    });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Dynamic INSERT — walks every column the controller wants to write
// and drops the ones the current schema doesn't have. Value type
// coercions (JSON.stringify for curriculum) still apply so the pg
// driver hands the right shape to the DB.
async function insertCourseDynamic(db, institutionId, p) {
  const cols = await loadCoursesColumns();
  // Column → value pairs in write order. Anything the schema doesn't
  // carry gets skipped without any special-casing per column, so the
  // moment a migration lands the value simply starts persisting.
  const candidates = [
    ['institution_id',        institutionId],
    ['name',                  p.name],
    ['short_description',     p.short_description],
    ['description',           p.description],
    ['category',              p.category],
    ['level',                 p.level],
    ['age_group',             p.age_group],
    ['duration_months',       p.duration_months],
    ['days_of_week',          p.days_of_week],
    ['class_start_time',      p.class_start_time],
    ['class_end_time',        p.class_end_time],
    ['batch_size_min',        p.batch_size_min],
    ['batch_size_max',        p.batch_size_max],
    ['language',              p.language],
    ['price',                 p.price],
    ['admission_fee',         p.admission_fee],
    ['belt_system',           p.belt_system],
    ['certificate_available', p.certificate_available],
    ['image_url',             p.image_url],
    ['intro_video_url',       p.intro_video_url],
    // curriculum needs an explicit jsonb cast at the placeholder level;
    // we set jsonb=true on the record so the SQL builder emits it.
    ['curriculum',            JSON.stringify(p.curriculum), { cast: 'jsonb' }],
    ['badge',                 p.badge],
    ['trainer_name',          p.trainer_name],
    ['branch_name',           p.branch_name],
    ['mode',                  p.mode],
    ['status',                p.status],
    ['trainer_id',            p.trainer_id],
    ['billing_cycle',         p.billing_cycle],
  ];
  const kept = candidates.filter(([name]) => hasCol(cols, name));
  const columnList = kept.map(([name]) => name).join(', ');
  const placeholders = kept
    .map(([, , opts], i) => (opts?.cast ? `$${i + 1}::${opts.cast}` : `$${i + 1}`))
    .join(', ');
  const params = kept.map(([, v]) => v);
  return db.query(
    `INSERT INTO courses (${columnList}) VALUES (${placeholders}) RETURNING *`,
    params,
  );
}

// GET my institution's courses (admin only)
exports.getMyCourses = async (req, res) => {
  try {
    // Resolve the caller's academy group so we can:
    //   • MAIN admin  → every course under root (they own the catalog)
    //   • BRANCH admin → only the courses their branch actually handles
    //                    (has at least one batch scoped to their branch)
    // and surface `is_sub_branch` so the mobile can hide Edit/Delete/FAB.
    const scopeRes = await pool.query(
      `SELECT u.institution_id, i.parent_institution_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1`,
      [req.user.id],
    );
    const scope = scopeRes.rows[0];
    if (!scope?.institution_id) {
      return res.status(400).json({ message: 'No institution found for this admin' });
    }
    const rootId       = scope.parent_institution_id || scope.institution_id;
    const isSubBranch  = !!scope.parent_institution_id;
    const callerInstId = scope.institution_id;

    let result;
    if (isSubBranch) {
      // Branch admin — courses their branch handles = courses that have
      // at least one batch whose branch_id matches their institution.
      // Courses live at the root institution; batches carry branch_id.
      result = await pool.query(
        `SELECT DISTINCT c.*
           FROM courses c
           JOIN batches b ON b.course_id = c.id
          WHERE c.institution_id = $1
            AND b.branch_id      = $2
          ORDER BY c.created_at DESC`,
        [rootId, callerInstId],
      );
    } else {
      // Main admin — full catalog (they own courses).
      result = await pool.query(
        `SELECT * FROM courses
          WHERE institution_id = $1
          ORDER BY created_at DESC`,
        [rootId],
      );
    }

    res.json({
      count:         result.rows.length,
      is_sub_branch: isSubBranch,
      courses:       result.rows,
    });
  } catch (err) {
    console.error('Get my courses error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET courses of a specific institution (public — for students)
exports.getCoursesByInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    // When ?include_all=1 the super admin web institution detail page gets
    // every course regardless of status / approval state. Without it (the
    // default), only active courses on approved institutions are returned
    // so the student-facing browse list stays clean.
    const includeAll = req.query.include_all === '1' || req.query.include_all === 'true';

    const extraWhere = includeAll
      ? 'AND i.deleted_at IS NULL'
      : `AND i.status = 'approved'
         AND i.deleted_at IS NULL
         AND COALESCE(c.status, 'active') = 'active'`;

    const result = await pool.query(
      `SELECT c.*, i.name as institution_name,
              (SELECT COUNT(*)::int FROM batches b WHERE b.course_id = c.id) AS batch_count,
              (SELECT COUNT(*)::int FROM enrollments e
                 JOIN batches b ON e.batch_id = b.id
                 WHERE b.course_id = c.id) AS enrollment_count
       FROM courses c
       JOIN institutions i ON c.institution_id = i.id
       WHERE c.institution_id = $1
         ${extraWhere}
       ORDER BY
         CASE c.badge
           WHEN 'popular'      THEN 1
           WHEN 'new'          THEN 2
           WHEN 'kids_special' THEN 3
           ELSE 4
         END,
         c.created_at DESC`,
      [id]
    );

    res.json({
      count: result.rows.length,
      courses: result.rows
    });
  } catch (err) {
    console.error('Get courses by institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET single course by ID (public)
exports.getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, i.name as institution_name, i.city as institution_city
       FROM courses c
       JOIN institutions i ON c.institution_id = i.id
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json({ course: result.rows[0] });
  } catch (err) {
    console.error('Get course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE course (admin only — must own it)
// Uses COALESCE so the admin can PATCH a subset of fields without wiping the
// rest. Sanitization runs first so mode/level/badge/status enums stay valid.
exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    const check = await pool.query(
      'SELECT institution_id FROM courses WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }
    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'You can only update courses in your own institution' });
    }

    // For PATCH-style updates we don't want sanitize's "fill in defaults"
    // behaviour to overwrite existing rows with default values when a field
    // was omitted from the request. So we only forward fields that were
    // actually present in req.body.
    const body = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    // Pull validated values for any enum-y fields that are present.
    const mode   = has('mode')   ? (ALLOWED_MODES.has(body.mode)     ? body.mode   : null) : null;
    const status = has('status') ? (ALLOWED_STATUS.has(body.status)  ? body.status : null) : null;
    const badge  = has('badge')  ? (ALLOWED_BADGES.has(body.badge)   ? body.badge  : null) : null;

    // trainer_id — when present, ensure the trainer belongs to this
    // institution and derive trainer_name so the label stays in sync.
    let trainerIdParam = null;
    let trainerNameParam = has('trainer_name') ? body.trainer_name : null;
    if (has('trainer_id')) {
      trainerIdParam = body.trainer_id != null && body.trainer_id !== ''
        ? (parseInt(body.trainer_id, 10) || null)
        : null;
      if (trainerIdParam) {
        // Scope-check: the trainer must be in the admin's institution.
        const adminInstRes = await pool.query(
          'SELECT institution_id FROM users WHERE id = $1',
          [req.user.id],
        );
        const adminInst = adminInstRes.rows[0]?.institution_id;
        const tr = await pool.query(
          `SELECT u.name FROM trainers t
             JOIN users u ON u.id = t.user_id
            WHERE t.id = $1 AND t.institution_id = $2`,
          [trainerIdParam, adminInst],
        );
        if (tr.rows.length === 0) {
          return res.status(400).json({
            message: 'Selected trainer does not belong to your academy.',
          });
        }
        trainerNameParam = tr.rows[0].name;
      }
    }

    // Whitelist + normalise billing_cycle so the UPDATE branch keeps
    // parity with the CREATE branch. Unknown values fall back to null
    // via COALESCE (which then keeps whatever was already stored).
    const CYCLES = new Set(['one_time','monthly','quarterly','half_yearly','annual']);
    const billingCycleParam = has('billing_cycle')
      ? (CYCLES.has(String(body.billing_cycle || '').toLowerCase())
          ? String(body.billing_cycle).toLowerCase()
          : null)
      : null;

    // Schema-aware UPDATE — same idea as createCourse. Each field is a
    // (col, was_supplied, value, opts?) tuple; we assemble the SET
    // clause from the intersection of "the client set this field" and
    // "the column exists on this schema", then run one COALESCE-style
    // UPDATE. Missing columns are skipped without any special-casing.
    const cols = await loadCoursesColumns();
    const updates = [
      ['name',                  has('name'),                  has('name')                  ? body.name                                              : null],
      ['short_description',     has('short_description'),     has('short_description')     ? body.short_description                                 : null],
      ['description',           has('description'),           has('description')           ? body.description                                       : null],
      ['category',              has('category'),              has('category')              ? body.category                                          : null],
      ['level',                 has('level'),                 has('level')                 ? body.level                                             : null],
      ['age_group',             has('age_group'),             has('age_group')             ? body.age_group                                         : null],
      ['duration_months',       has('duration_months'),       has('duration_months')       ? parseInt(body.duration_months, 10)                     : null],
      ['days_of_week',          has('days_of_week'),          has('days_of_week')          ? body.days_of_week                                      : null],
      ['class_start_time',      has('class_start_time'),      has('class_start_time')      ? body.class_start_time                                  : null],
      ['class_end_time',        has('class_end_time'),        has('class_end_time')        ? body.class_end_time                                    : null],
      ['batch_size_min',        has('batch_size_min'),        has('batch_size_min')        ? (body.batch_size_min ? parseInt(body.batch_size_min, 10) : null) : null],
      ['batch_size_max',        has('batch_size_max'),        has('batch_size_max')        ? (body.batch_size_max ? parseInt(body.batch_size_max, 10) : null) : null],
      ['language',              has('language'),              has('language')              ? body.language                                          : null],
      ['price',                 has('price'),                 has('price')                 ? parseFloat(body.price)                                 : null],
      ['admission_fee',         has('admission_fee'),         has('admission_fee')         ? parseFloat(body.admission_fee)                         : null],
      ['belt_system',           has('belt_system'),           has('belt_system')           ? !!body.belt_system                                     : null],
      ['certificate_available', has('certificate_available'), has('certificate_available') ? !!body.certificate_available                           : null],
      ['image_url',             has('image_url'),             has('image_url')             ? body.image_url                                         : null],
      ['intro_video_url',       has('intro_video_url'),       has('intro_video_url')       ? body.intro_video_url                                   : null],
      ['curriculum',            has('curriculum'),            has('curriculum')            ? JSON.stringify(sanitizeCoursePayload(body).curriculum) : null, { cast: 'jsonb' }],
      ['badge',                 has('badge'),                 badge],
      ['trainer_name',          has('trainer_name') || has('trainer_id'), trainerNameParam],
      ['branch_name',           has('branch_name'),           has('branch_name')           ? body.branch_name                                       : null],
      ['mode',                  has('mode'),                  mode],
      ['status',                has('status'),                status],
      ['trainer_id',            has('trainer_id'),            trainerIdParam],
      ['billing_cycle',         has('billing_cycle'),         billingCycleParam],
    ];
    const kept = updates.filter(([name]) => hasCol(cols, name));
    // Nothing to update — return the row untouched so the client's
    // PATCH is still a no-op success instead of a 500.
    if (kept.length === 0) {
      const untouched = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);
      return res.json({ message: 'Course updated successfully', course: untouched.rows[0] });
    }
    // Build the COALESCE SET clauses + params in one pass.
    const setClauses = [];
    const params = [];
    kept.forEach(([name, , value, opts]) => {
      params.push(value);
      const placeholder = opts?.cast
        ? `$${params.length}::${opts.cast}`
        : `$${params.length}`;
      setClauses.push(`${name} = COALESCE(${placeholder}, ${name})`);
    });
    params.push(id);
    const idPlaceholder = params.length;

    const runUpdate = async () => pool.query(
      `UPDATE courses SET ${setClauses.join(', ')} WHERE id = $${idPlaceholder} RETURNING *`,
      params,
    );

    let result;
    try {
      result = await runUpdate();
    } catch (err) {
      if (err?.code === '42703') {
        console.warn(
          '[course] UPDATE hit 42703 despite schema probe (%s). Re-probing and retrying once.',
          err?.message,
        );
        invalidateCoursesColumns();
        result = await runUpdate();
      } else {
        throw err;
      }
    }

    res.json({
      message: 'Course updated successfully',
      course: result.rows[0],
    });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE course (admin only — must own it)
exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const adminInstitutionId = await getAdminInstitutionId(req.user.id);

    // Verify ownership
    const check = await pool.query(
      'SELECT institution_id FROM courses WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (check.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'You can only delete courses in your own institution' });
    }

    await pool.query('DELETE FROM courses WHERE id = $1', [id]);

    res.json({ message: 'Course deleted successfully' });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};