const pool = require('../config/db');

// CREATE institution (admin only)
exports.createInstitution = async (req, res) => {
  try {
    const { name, description, address, city, pincode, phone, email, logo_url } = req.body;
    const adminId = req.user.id;  // from JWT

    if (!name) {
      return res.status(400).json({ message: 'Institution name is required' });
    }

    // Check if this admin already owns an institution
    const existing = await pool.query(
      'SELECT id FROM institutions WHERE owner_user_id = $1',
      [adminId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        message: 'You already own an institution. Each admin can create only one.' 
      });
    }

    // Create institution
    const result = await pool.query(
      `INSERT INTO institutions 
        (name, description, address, city, pincode, phone, email, logo_url, owner_user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')
       RETURNING *`,
      [name, description, address, city, pincode, phone, email, logo_url, adminId]
    );

    const institution = result.rows[0];

    // Link admin to this institution
    await pool.query(
      'UPDATE users SET institution_id = $1 WHERE id = $2',
      [institution.id, adminId]
    );

    res.status(201).json({
      message: 'Institution created successfully',
      institution
    });
  } catch (err) {
    console.error('Create institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET all institutions (public — students/guests can browse)
exports.getAllInstitutions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, address, city, pincode, phone, email, logo_url, created_at
       FROM institutions
       WHERE status = 'approved'
         AND deleted_at IS NULL
       ORDER BY created_at DESC`
    );

    res.json({
      count: result.rows.length,
      institutions: result.rows
    });
  } catch (err) {
    console.error('Get institutions error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET single institution by ID (public)
exports.getInstitutionById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, name, description, address, city, pincode, phone, email, logo_url, status, created_at
       FROM institutions
       WHERE id = $1
         AND status = 'approved'
         AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    res.json({ institution: result.rows[0] });
  } catch (err) {
    console.error('Get institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my institution (admin only — gets their own academy)
exports.getMyInstitution = async (req, res) => {
  try {
    const adminId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM institutions WHERE owner_user_id = $1',
      [adminId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        message: 'You have not created an institution yet' 
      });
    }

    res.json({ institution: result.rows[0] });
  } catch (err) {
    console.error('Get my institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE institution (admin only — updates their own)
exports.updateInstitution = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { name, description, address, city, pincode, phone, email, logo_url } = req.body;

    // Make sure this admin owns an institution
    const existing = await pool.query(
      'SELECT id FROM institutions WHERE owner_user_id = $1',
      [adminId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'You have not created an institution yet' });
    }

    const institutionId = existing.rows[0].id;

    const result = await pool.query(
      `UPDATE institutions 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           address = COALESCE($3, address),
           city = COALESCE($4, city),
           pincode = COALESCE($5, pincode),
           phone = COALESCE($6, phone),
           email = COALESCE($7, email),
           logo_url = COALESCE($8, logo_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [name, description, address, city, pincode, phone, email, logo_url, institutionId]
    );

    res.json({
      message: 'Institution updated successfully',
      institution: result.rows[0]
    });
  } catch (err) {
    console.error('Update institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// STUDENT-FACING BROWSE ENDPOINTS (public — no auth required)
// ─────────────────────────────────────────────────────────────────────────────
// Used by the mobile student app. Every list is filtered to institutions that
// are: onboarding_status='active' AND is_active=TRUE AND accepts_students=TRUE.
// That's the "real, paid, accepting students" filter — and it matches the
// partial index added in migration 004 for cheap lookups.

const STUDENT_BROWSABLE = `
  i.onboarding_status = 'active'
  AND COALESCE(i.is_active, TRUE) = TRUE
  AND COALESCE(i.accepts_students, TRUE) = TRUE
  AND i.deleted_at IS NULL
`;

// GET /api/institutions/nearby?lat=<num>&lng=<num>&limit=<int>&max_km=<int>
// Returns institutions sorted by haversine distance from the given lat/lng.
// Defaults: limit=10, max_km=50. If lat/lng are omitted, falls back to the
// "all browsable institutions" list (so the mobile picker still has something
// to show when GPS is denied).
exports.getNearbyInstitutions = async (req, res) => {
  try {
    const lat   = req.query.lat   !== undefined ? Number(req.query.lat)   : null;
    const lng   = req.query.lng   !== undefined ? Number(req.query.lng)   : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const maxKm = Math.min(parseInt(req.query.max_km, 10) || 50, 500);

    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);

    if (!hasGeo) {
      // Fallback: same shape as the geo query but without distance.
      const result = await pool.query(
        `SELECT i.id, i.name, i.city, i.pincode, i.address, i.logo_url,
                i.latitude, i.longitude, i.institution_type, i.phone,
                NULL::float AS distance_km
           FROM institutions i
          WHERE ${STUDENT_BROWSABLE}
          ORDER BY i.created_at DESC
          LIMIT $1`,
        [limit],
      );
      return res.json({ used_geo: false, count: result.rows.length, institutions: result.rows });
    }

    // Haversine distance in km. earthdistance/cube extensions would be faster
    // at huge scale but raw SQL is fine for thousands of rows.
    const result = await pool.query(
      `SELECT
         i.id, i.name, i.city, i.pincode, i.address, i.logo_url,
         i.latitude, i.longitude, i.institution_type, i.phone,
         (
           6371 * acos(
             cos(radians($1)) * cos(radians(i.latitude))
             * cos(radians(i.longitude) - radians($2))
             + sin(radians($1)) * sin(radians(i.latitude))
           )
         ) AS distance_km
       FROM institutions i
       WHERE ${STUDENT_BROWSABLE}
         AND i.latitude  IS NOT NULL
         AND i.longitude IS NOT NULL
       HAVING (
         6371 * acos(
           cos(radians($1)) * cos(radians(i.latitude))
           * cos(radians(i.longitude) - radians($2))
           + sin(radians($1)) * sin(radians(i.latitude))
         )
       ) <= $3
       ORDER BY distance_km ASC
       LIMIT $4`,
      [lat, lng, maxKm, limit],
    );

    res.json({ used_geo: true, count: result.rows.length, institutions: result.rows });
  } catch (err) {
    console.error('getNearbyInstitutions error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/:id/programs?featured=true&limit=20
// Institution-scoped program list for the student app. Joins course info with
// the trainer's display name (if courses.trainer_id exists in this schema).
exports.getInstitutionPrograms = async (req, res) => {
  try {
    const { id } = req.params;
    const featuredOnly = req.query.featured === 'true';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    // Make sure the institution itself is student-browsable before exposing
    // its programs to a guest. Stops a deactivated academy's content leaking.
    const inst = await pool.query(
      `SELECT id FROM institutions i
        WHERE i.id = $1 AND ${STUDENT_BROWSABLE}`,
      [id],
    );
    if (inst.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found or not accepting students' });
    }

    const result = await pool.query(
      `SELECT c.*
         FROM courses c
        WHERE c.institution_id = $1
          AND COALESCE(c.status, 'active') = 'active'
          ${featuredOnly ? 'AND c.is_featured = TRUE' : ''}
        ORDER BY
          c.is_featured DESC NULLS LAST,
          CASE c.badge
            WHEN 'popular'      THEN 1
            WHEN 'new'          THEN 2
            WHEN 'kids_special' THEN 3
            ELSE 4
          END,
          c.created_at DESC
        LIMIT $2`,
      [id, limit],
    );

    res.json({ count: result.rows.length, programs: result.rows });
  } catch (err) {
    console.error('getInstitutionPrograms error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/:id/batches
exports.getInstitutionBatches = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT b.*
         FROM batches b
        WHERE b.institution_id = $1
        ORDER BY b.created_at DESC
        LIMIT 100`,
      [id],
    );
    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('getInstitutionBatches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/:id/trainers
exports.getInstitutionTrainers = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*
         FROM trainers t
        WHERE t.institution_id = $1
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [id],
    );
    res.json({ count: result.rows.length, trainers: result.rows });
  } catch (err) {
    console.error('getInstitutionTrainers error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/:id/live-classes
// Live classes table doesn't exist yet — returns an empty array for now so the
// mobile screen can render its empty state. Wire to a real `live_classes`
// table when the live-classes feature is built.
exports.getInstitutionLiveClasses = async (_req, res) => {
  res.json({ count: 0, live_classes: [], _note: 'Live-classes table not yet implemented' });
};

// GET /api/institutions/:id/events
//
// Returns the union of:
//   1. Events scoped to this institution (institution_id = :id)
//   2. Global events curated by the super admin (institution_id IS NULL)
//
// Both are filtered to active rows whose event_date hasn't passed.
// Institution-scoped rows surface for that academy's students AND its
// trainers; global rows surface for everyone.
exports.getInstitutionEvents = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
         id,
         title,
         subtitle,
         description,
         image_url,
         event_date,
         location,
         link,
         sort_order,
         institution_id,
         CASE WHEN institution_id IS NULL THEN 'global' ELSE 'institution' END AS source
       FROM mobile_events
       WHERE is_active = TRUE
         AND event_date >= CURRENT_DATE
         AND (institution_id = $1 OR institution_id IS NULL)
       ORDER BY event_date ASC
       LIMIT 50`,
      [id],
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('getInstitutionEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/institutions/me/events
//
// Institution-admin endpoint — creates an event scoped to the caller's
// own institution. The event automatically appears on the home screen of
// every student AND trainer linked to that institution via the
// /institutions/:id/events read above.
//
// Required fields: title, event_date. Everything else is optional.
exports.createInstitutionEvent = async (req, res) => {
  try {
    const adminId = req.user.id;
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [adminId],
    );
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }

    const {
      title,
      subtitle,
      description,
      event_date,
      location,
      image_url,
      link,
      registration_closing_date,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ field: 'title', message: 'Title is required.' });
    }
    if (!event_date) {
      return res.status(400).json({ field: 'event_date', message: 'Event date is required.' });
    }

    const result = await pool.query(
      `INSERT INTO mobile_events
         (title, subtitle, description, location, event_date,
          registration_closing_date, image_url, link,
          institution_id, created_by, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 0)
       RETURNING *`,
      [
        String(title).trim(),
        subtitle ? String(subtitle).trim() : null,
        description ? String(description).trim() : null,
        location ? String(location).trim() : null,
        event_date,
        registration_closing_date || null,
        image_url || null,
        link || null,
        institutionId,
        adminId,
      ],
    );

    res.status(201).json({
      message: 'Event created. Your students and trainers will see it on their home screen.',
      event: result.rows[0],
    });
  } catch (err) {
    console.error('createInstitutionEvent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/me/events/all
//
// Admin-only history view — returns EVERY event the caller's institution
// has ever created, including past ones. Used by the EventsList screen
// on the More tab so the admin can see what they've published and what's
// still upcoming in one list, sorted newest event first.
exports.listMyInstitutionEvents = async (req, res) => {
  try {
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [req.user.id],
    );
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }
    const result = await pool.query(
      `SELECT
         id, title, subtitle, description, image_url, event_date,
         registration_closing_date, location, link, is_active, sort_order,
         institution_id, created_at,
         CASE WHEN event_date >= CURRENT_DATE THEN 'upcoming' ELSE 'past' END AS status
       FROM mobile_events
       WHERE institution_id = $1
       ORDER BY event_date DESC
       LIMIT 200`,
      [institutionId],
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('listMyInstitutionEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/events/my
//
// Convenience endpoint for the trainer + student home screens — returns
// the same union as getInstitutionEvents but uses the caller's own
// institution_id from their JWT instead of requiring it in the URL.
// Lets the trainer/student app fetch events without knowing their
// institution id up front.
exports.getMyEvents = async (req, res) => {
  try {
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [req.user.id],
    );
    const institutionId = u.rows[0]?.institution_id;

    // Even guests / un-linked users can fetch — they just get globals only.
    const params = institutionId ? [institutionId] : [];
    const where  = institutionId
      ? `(institution_id = $1 OR institution_id IS NULL)`
      : `institution_id IS NULL`;

    const result = await pool.query(
      `SELECT
         id, title, subtitle, description, image_url, event_date,
         location, link, sort_order, institution_id,
         CASE WHEN institution_id IS NULL THEN 'global' ELSE 'institution' END AS source
       FROM mobile_events
       WHERE is_active = TRUE
         AND event_date >= CURRENT_DATE
         AND ${where}
       ORDER BY event_date ASC
       LIMIT 50`,
      params,
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('getMyEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
