const pool = require('../config/db');

// Helper: get the admin's institution_id
const getAdminInstitutionId = async (userId) => {
  const result = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.institution_id;
};

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
    admission_fee:          body.admission_fee !== undefined ? parseFloat(body.admission_fee) : 0,
    belt_system:            !!body.belt_system,
    certificate_available:  body.certificate_available === undefined ? true : !!body.certificate_available,
    image_url:              body.image_url || null,
    intro_video_url:        body.intro_video_url || null,
    curriculum,
    badge:                  ALLOWED_BADGES.has(body.badge) ? body.badge : null,
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

    const result = await pool.query(
      `INSERT INTO courses (
         institution_id, name, short_description, description, category,
         level, age_group, duration_months,
         days_of_week, class_start_time, class_end_time,
         batch_size_min, batch_size_max, language,
         price, admission_fee,
         belt_system, certificate_available,
         image_url, intro_video_url, curriculum,
         badge, trainer_name, branch_name,
         mode, status
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         $12, $13, $14,
         $15, $16,
         $17, $18,
         $19, $20, $21::jsonb,
         $22, $23, $24,
         $25, $26
       )
       RETURNING *`,
      [
        institutionId, p.name, p.short_description, p.description, p.category,
        p.level, p.age_group, p.duration_months,
        p.days_of_week, p.class_start_time, p.class_end_time,
        p.batch_size_min, p.batch_size_max, p.language,
        p.price, p.admission_fee,
        p.belt_system, p.certificate_available,
        p.image_url, p.intro_video_url, JSON.stringify(p.curriculum),
        p.badge, p.trainer_name, p.branch_name,
        p.mode, p.status,
      ],
    );

    res.status(201).json({
      message: 'Course created successfully',
      course: result.rows[0],
    });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my institution's courses (admin only)
exports.getMyCourses = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);

    if (!institutionId) {
      return res.status(400).json({ message: 'No institution found for this admin' });
    }

    const result = await pool.query(
      'SELECT * FROM courses WHERE institution_id = $1 ORDER BY created_at DESC',
      [institutionId]
    );

    res.json({
      count: result.rows.length,
      courses: result.rows
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

    const result = await pool.query(
      `SELECT c.*, i.name as institution_name
       FROM courses c
       JOIN institutions i ON c.institution_id = i.id
       WHERE c.institution_id = $1
         AND i.status = 'approved'
         AND i.deleted_at IS NULL
         AND COALESCE(c.status, 'active') = 'active'
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

    const result = await pool.query(
      `UPDATE courses SET
         name                  = COALESCE($1,  name),
         short_description     = COALESCE($2,  short_description),
         description           = COALESCE($3,  description),
         category              = COALESCE($4,  category),
         level                 = COALESCE($5,  level),
         age_group             = COALESCE($6,  age_group),
         duration_months       = COALESCE($7,  duration_months),
         days_of_week          = COALESCE($8,  days_of_week),
         class_start_time      = COALESCE($9,  class_start_time),
         class_end_time        = COALESCE($10, class_end_time),
         batch_size_min        = COALESCE($11, batch_size_min),
         batch_size_max        = COALESCE($12, batch_size_max),
         language              = COALESCE($13, language),
         price                 = COALESCE($14, price),
         admission_fee         = COALESCE($15, admission_fee),
         belt_system           = COALESCE($16, belt_system),
         certificate_available = COALESCE($17, certificate_available),
         image_url             = COALESCE($18, image_url),
         intro_video_url       = COALESCE($19, intro_video_url),
         curriculum            = COALESCE($20::jsonb, curriculum),
         badge                 = COALESCE($21, badge),
         trainer_name          = COALESCE($22, trainer_name),
         branch_name           = COALESCE($23, branch_name),
         mode                  = COALESCE($24, mode),
         status                = COALESCE($25, status)
       WHERE id = $26
       RETURNING *`,
      [
        has('name')                  ? body.name                                              : null,
        has('short_description')     ? body.short_description                                 : null,
        has('description')           ? body.description                                       : null,
        has('category')              ? body.category                                          : null,
        has('level')                 ? body.level                                             : null,
        has('age_group')             ? body.age_group                                         : null,
        has('duration_months')       ? parseInt(body.duration_months, 10)                     : null,
        has('days_of_week')          ? body.days_of_week                                      : null,
        has('class_start_time')      ? body.class_start_time                                  : null,
        has('class_end_time')        ? body.class_end_time                                    : null,
        has('batch_size_min')        ? (body.batch_size_min ? parseInt(body.batch_size_min, 10) : null) : null,
        has('batch_size_max')        ? (body.batch_size_max ? parseInt(body.batch_size_max, 10) : null) : null,
        has('language')              ? body.language                                          : null,
        has('price')                 ? parseFloat(body.price)                                 : null,
        has('admission_fee')         ? parseFloat(body.admission_fee)                         : null,
        has('belt_system')           ? !!body.belt_system                                     : null,
        has('certificate_available') ? !!body.certificate_available                           : null,
        has('image_url')             ? body.image_url                                         : null,
        has('intro_video_url')       ? body.intro_video_url                                   : null,
        // curriculum needs the JSONB normaliser; if absent, COALESCE keeps existing.
        has('curriculum')            ? JSON.stringify(sanitizeCoursePayload(body).curriculum) : null,
        badge,
        has('trainer_name')          ? body.trainer_name                                      : null,
        has('branch_name')           ? body.branch_name                                       : null,
        mode,
        status,
        id,
      ],
    );

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