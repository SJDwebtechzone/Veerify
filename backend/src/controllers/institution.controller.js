const pool = require('../config/db');
const Razorpay = require('razorpay');
const { insertNotification } = require('./notification.controller');

// Lazy Razorpay client — shared with utils/razorpay.js but instantiated
// separately so this controller can build the tiny event-fee payment
// link directly without pulling in the subscription-specific helper's
// customer/notes shape.
let _rzp = null;
function rzp() {
  if (_rzp) return _rzp;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  _rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return _rzp;
}

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

// GET /api/institutions/me/support-email
//
// Role-agnostic. Resolves the CALLER's own institution's contact email
// so the Support screen on the mobile app can render the correct
// per-institution address without hardcoding anything.
//
// Resolution order:
//   1. users.institution_id — the direct link (set at enrolment for
//      students, on trainer creation for trainers, on institution
//      setup for admins).
//   2. Sub-branch → parent — if the caller belongs to a branch
//      institution, we walk parent_institution_id up to the head
//      office so a student trained at "Chennai · Anna Nagar Branch"
//      still sees the head office's support email (the one entered
//      during academy registration).
//
// Response shape:
//   { support_email: 'academy@example.com' | null,
//     institution_name: 'Veerify Academy' | null,
//     institution_id:   42 | null }
//
// Never 404s — a caller with no institution_id gets an all-null
// payload and the mobile renders the "Institution support email not
// available." fallback. Never returns other institutions' data.
exports.getMySupportEmail = async (req, res) => {
  try {
    const userId = req.user.id;

    const userRes = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [userId],
    );
    let instId = userRes.rows[0]?.institution_id || null;
    if (!instId) {
      return res.json({
        support_email:    null,
        institution_name: null,
        institution_id:   null,
      });
    }

    // Walk up to the root (main-branch) institution. Sub-branches
    // rarely register a separate contact email — the head office is
    // the canonical support address, so we hop up ONE level when the
    // caller's institution has a parent AND the parent has an email.
    let inst = null;
    {
      const r = await pool.query(
        `SELECT id, name, email, parent_institution_id
           FROM institutions WHERE id = $1`,
        [instId],
      );
      inst = r.rows[0] || null;
    }
    if (inst && !inst.email && inst.parent_institution_id) {
      const p = await pool.query(
        `SELECT id, name, email FROM institutions WHERE id = $1`,
        [inst.parent_institution_id],
      );
      if (p.rows[0]?.email) {
        inst = p.rows[0];
      }
    }

    return res.json({
      support_email:    inst?.email || null,
      institution_name: inst?.name  || null,
      institution_id:   inst?.id    || null,
    });
  } catch (err) {
    console.error('Get support email error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE institution (admin only — updates their own)
//
// The Academy Profile screen on the More tab drives most fields here.
// Every column is COALESCE'd so a partial payload only touches what it
// carries; sending `null` or omitting a field is a no-op for that
// column. Fields are grouped into: core identity, contact, location,
// social handles, operating hours, and master (point-of-contact) block.
//
// After a successful update we fan out a single notification to every
// super_admin user with the institution name, the list of fields the
// admin actually changed, and a timestamp — that's what powers the
// admin-web activity bell.
exports.updateInstitution = async (req, res) => {
  try {
    const adminId = req.user.id;
    const {
      // Core identity (setup wizard step 1)
      name, brand_name, description, logo_url, website_url,
      institution_type, institution_types, registration_number,
      date_of_establishment, skills,
      // Contact
      phone, email,
      // Location
      address, city, pincode, latitude, longitude,
      // Social handles — full URLs; validated as http(s) below when present.
      facebook_url, instagram_url, youtube_url, linkedin_url,
      // Accreditation (setup step 3)
      affiliation_or_board, accreditation_body_name,
      accreditation_expiry_date, accreditation_certificate_url,
      // Operations (setup step 4)
      total_student_capacity, current_enrollment, medium_of_instruction,
      operating_hours_weekday, operating_hours_weekend,
      // Point-of-contact (setup step 5)
      master_name, master_role, master_email, master_phone_number,
      // Legacy per-day map (kept for older mobile builds). Priority is
      // still weekday/weekend since that's what the wizard writes.
      operating_hours_by_day,
    } = req.body || {};

    // Make sure this admin owns an institution.
    const existing = await pool.query(
      `SELECT * FROM institutions WHERE owner_user_id = $1`,
      [adminId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'You have not created an institution yet' });
    }
    const before = existing.rows[0];
    const institutionId = before.id;

    // Reject obviously-broken URLs early — every social/website field
    // must be either empty (skip) or start with http(s)://.
    const urlFields = { website_url, facebook_url, instagram_url, youtube_url, linkedin_url };
    for (const [key, val] of Object.entries(urlFields)) {
      if (val && !/^https?:\/\//i.test(String(val).trim())) {
        return res.status(400).json({ field: key, message: `${key} must start with http:// or https://` });
      }
    }

    // Small helper — trims strings, keeps null/undefined intact so
    // COALESCE preserves the existing DB value.
    const trim = (v) => (v == null ? null : String(v).trim() || null);

    // JSONB / array normalization — mirrors what onboarding.setupAcademy
    // does so both entry points behave identically for the same shapes.
    const jsonOrNull = (v) => (v === undefined ? null : JSON.stringify(v));
    const hoursJson    = jsonOrNull(operating_hours_by_day);
    const hoursWeekday = jsonOrNull(operating_hours_weekday);
    const hoursWeekend = jsonOrNull(operating_hours_weekend);
    // TEXT[] arrays — pg maps a JS array cleanly. Undefined skips.
    const arrOrNull = (v) => {
      if (v === undefined) return null;
      if (v === null) return null;
      if (!Array.isArray(v)) return null;
      return v.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
    };
    const typesArr  = arrOrNull(institution_types);
    const skillsArr = arrOrNull(skills);
    const mediumArr = arrOrNull(medium_of_instruction);

    // Numeric coercion — preserve null for untouched, coerce empty to null
    // for touched-but-blank.
    const intOrNull = (v) => {
      if (v === undefined) return null;
      if (v === '' || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    };
    const latVal = (() => {
      if (latitude === undefined) return null;
      if (latitude === '' || latitude === null) return null;
      const n = Number(latitude);
      return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
    })();
    const lngVal = (() => {
      if (longitude === undefined) return null;
      if (longitude === '' || longitude === null) return null;
      const n = Number(longitude);
      return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
    })();

    const result = await pool.query(
      `UPDATE institutions
          SET name                          = COALESCE($1,  name),
              brand_name                    = COALESCE($2,  brand_name),
              description                   = COALESCE($3,  description),
              logo_url                      = COALESCE($4,  logo_url),
              website_url                   = COALESCE($5,  website_url),
              institution_type              = COALESCE($6,  institution_type),
              institution_types             = COALESCE($7::text[], institution_types),
              registration_number           = COALESCE($8,  registration_number),
              date_of_establishment         = COALESCE($9::date, date_of_establishment),
              skills                        = COALESCE($10::text[], skills),
              phone                         = COALESCE($11, phone),
              email                         = COALESCE($12, email),
              address                       = COALESCE($13, address),
              city                          = COALESCE($14, city),
              pincode                       = COALESCE($15, pincode),
              latitude                      = COALESCE($16, latitude),
              longitude                     = COALESCE($17, longitude),
              facebook_url                  = COALESCE($18, facebook_url),
              instagram_url                 = COALESCE($19, instagram_url),
              youtube_url                   = COALESCE($20, youtube_url),
              linkedin_url                  = COALESCE($21, linkedin_url),
              affiliation_or_board          = COALESCE($22, affiliation_or_board),
              accreditation_body_name       = COALESCE($23, accreditation_body_name),
              accreditation_expiry_date     = COALESCE($24::date, accreditation_expiry_date),
              accreditation_certificate_url = COALESCE($25, accreditation_certificate_url),
              total_student_capacity        = COALESCE($26, total_student_capacity),
              current_enrollment            = COALESCE($27, current_enrollment),
              medium_of_instruction         = COALESCE($28::text[], medium_of_instruction),
              operating_hours_weekday       = COALESCE($29::jsonb, operating_hours_weekday),
              operating_hours_weekend       = COALESCE($30::jsonb, operating_hours_weekend),
              operating_hours_by_day        = COALESCE($31::jsonb, operating_hours_by_day),
              master_name                   = COALESCE($32, master_name),
              master_role                   = COALESCE($33, master_role),
              master_email                  = COALESCE($34, master_email),
              master_phone_number           = COALESCE($35, master_phone_number),
              updated_at                    = CURRENT_TIMESTAMP
        WHERE id = $36
      RETURNING *`,
      [
        trim(name), trim(brand_name), trim(description), trim(logo_url), trim(website_url),
        trim(institution_type), typesArr, trim(registration_number),
        trim(date_of_establishment), skillsArr,
        trim(phone), trim(email),
        trim(address), trim(city), trim(pincode),
        latVal, lngVal,
        trim(facebook_url), trim(instagram_url), trim(youtube_url), trim(linkedin_url),
        trim(affiliation_or_board), trim(accreditation_body_name),
        trim(accreditation_expiry_date), trim(accreditation_certificate_url),
        intOrNull(total_student_capacity), intOrNull(current_enrollment),
        mediumArr,
        hoursWeekday, hoursWeekend, hoursJson,
        trim(master_name), trim(master_role), trim(master_email), trim(master_phone_number),
        institutionId,
      ],
    );
    const after = result.rows[0];

    // ── Compute the diff — what actually changed ──────────────────
    // Only include fields the admin sent AND whose value differs from
    // the DB row we loaded at the start. This keeps the super-admin
    // notification tight and truthful (no "nothing actually changed"
    // pings).
    const WATCHED = [
      'name', 'brand_name', 'description', 'logo_url', 'website_url',
      'institution_type', 'institution_types', 'registration_number',
      'date_of_establishment', 'skills',
      'phone', 'email',
      'address', 'city', 'pincode', 'latitude', 'longitude',
      'facebook_url', 'instagram_url', 'youtube_url', 'linkedin_url',
      'affiliation_or_board', 'accreditation_body_name',
      'accreditation_expiry_date', 'accreditation_certificate_url',
      'total_student_capacity', 'current_enrollment', 'medium_of_instruction',
      'operating_hours_weekday', 'operating_hours_weekend', 'operating_hours_by_day',
      'master_name', 'master_role', 'master_email', 'master_phone_number',
    ];
    const changed = [];
    for (const key of WATCHED) {
      if (!(key in (req.body || {}))) continue;   // untouched
      const b = before[key];
      const a = after[key];
      // Cheap deep-equal via JSON — safe for the string / JSONB shapes
      // we store here.
      if (JSON.stringify(b == null ? null : b) !== JSON.stringify(a == null ? null : a)) {
        changed.push(key);
      }
    }

    // ── Notify every super admin (best-effort) ────────────────────
    // Fires a single notification per super_admin user. Failure here
    // doesn't fail the update — the row already saved.
    if (changed.length > 0) {
      try {
        const supers = await pool.query(
          `SELECT id FROM users WHERE role = 'super_admin' AND COALESCE(is_deleted, false) = false`,
        );
        const humanFields = changed.map(niceFieldLabel).join(', ');
        // Snapshot the new values for the changed fields only. Small
        // JSON payload; the notifications table is JSONB so this stays
        // compact. Web admin uses this to render truthful "changed to X"
        // hints without relying on a fresh fetch.
        const changedValues = {};
        for (const k of changed) {
          const v = after[k];
          // Skip large blobs — anything we wouldn't want to inline in
          // the bell dropdown.
          if (typeof v === 'string' && v.length > 300) continue;
          changedValues[k] = v == null ? null : v;
        }
        for (const s of supers.rows) {
          await insertNotification({
            user_id:        s.id,
            institution_id: institutionId,
            category:       'system',
            title:          'Institution profile updated',
            message:        `${after.name || 'An institution'} updated: ${humanFields}.`,
            data: {
              // Deep-link into the super-admin web's institution detail
              // page. On mobile this maps to the InstitutionDetail
              // screen; on the admin web the notifications provider
              // picks kind='institution_profile_updated' and routes.
              kind:             'institution_profile_updated',
              institution_id:   institutionId,
              institution_name: after.name || null,
              updated_fields:   changed,
              // NEW: values-after snapshot so the web can render an
              // accurate "changed to <value>" hint even if the detail
              // fetch is stale for some transient reason.
              changed_values:   changedValues,
              updated_at:       new Date().toISOString(),
            },
            created_by: adminId,
          });
        }
      } catch (err) {
        console.warn('[institution/update] super-admin notify failed:', err?.message);
      }
    }

    res.json({
      message: 'Institution updated successfully',
      institution: after,
      updated_fields: changed,
    });
  } catch (err) {
    console.error('Update institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// niceFieldLabel — turns a snake_case column key into a human label used
// in the super-admin notification message. Kept small on purpose;
// unknown keys fall through to the raw column name.
function niceFieldLabel(key) {
  const LABELS = {
    name: 'Name',
    brand_name: 'Brand name',
    description: 'Description',
    logo_url: 'Logo',
    website_url: 'Website',
    institution_type: 'Institution type',
    institution_types: 'Institution types',
    registration_number: 'Registration number',
    date_of_establishment: 'Establishment date',
    skills: 'Skills',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    city: 'City',
    pincode: 'Pincode',
    latitude: 'Latitude',
    longitude: 'Longitude',
    facebook_url: 'Facebook',
    instagram_url: 'Instagram',
    youtube_url: 'YouTube',
    linkedin_url: 'LinkedIn',
    affiliation_or_board: 'Affiliation / board',
    accreditation_body_name: 'Accreditation body',
    accreditation_expiry_date: 'Accreditation expiry',
    accreditation_certificate_url: 'Accreditation certificate',
    total_student_capacity: 'Student capacity',
    current_enrollment: 'Current enrollment',
    medium_of_instruction: 'Medium of instruction',
    operating_hours_weekday: 'Weekday hours',
    operating_hours_weekend: 'Weekend hours',
    operating_hours_by_day: 'Operating hours',
    master_name: 'Point-of-contact name',
    master_role: 'Point-of-contact role',
    master_email: 'Point-of-contact email',
    master_phone_number: 'Point-of-contact phone',
  };
  return LABELS[key] || key;
}
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
    // Join courses + trainers + the (optional) branch institution row
    // so the mobile can render the batch card + the student-side
    // enrollment summary WITHOUT a second round-trip per batch. Every
    // field the enrollment form's summary card needs — course_name,
    // course_price, duration_months, trainer_name, branch_name — is
    // produced right here in one query.
    const result = await pool.query(
      `SELECT b.*,
              c.name             AS course_name,
              c.price            AS course_price,
              c.duration_months  AS course_duration_months,
              u.name             AS trainer_name,
              br.name            AS branch_name
         FROM batches b
         LEFT JOIN courses  c  ON b.course_id  = c.id
         LEFT JOIN trainers t  ON b.trainer_id = t.id
         LEFT JOIN users    u  ON t.user_id    = u.id
         LEFT JOIN institutions br ON b.branch_id = br.id
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
    // Caller may be a guest — req.user is optional on this endpoint.
    // When authenticated, we surface `has_paid` so the mobile UI can
    // switch the button from "Pay Now" to "Paid" without a second call.
    const callerUserId = req.user?.id || null;

    // Resolve the academy GROUP for the requested institution — the
    // root (main) institution's id. Events from any sub-branch under
    // the same root are visible to every student of the group, so an
    // event approved by the parent doesn't stay confined to the
    // sub-branch that submitted it.
    const rootRow = await pool.query(
      `SELECT COALESCE(parent_institution_id, id) AS root_id
         FROM institutions WHERE id = $1`,
      [id],
    );
    const rootId = rootRow.rows[0]?.root_id || parseInt(id, 10) || null;

    const result = await pool.query(
      `SELECT
         e.id,
         e.title,
         e.subtitle,
         e.description,
         e.image_url,
         e.event_date,
         e.registration_closing_date,
         e.location,
         e.link,
         e.payment_required,
         e.payment_amount,
         e.publish_at,
         e.sort_order,
         e.institution_id,
         CASE WHEN e.institution_id IS NULL THEN 'global' ELSE 'institution' END AS source,
         EXISTS (
           SELECT 1 FROM event_payments ep
            WHERE ep.event_id = e.id
              AND ep.user_id  = $1
              AND ep.status   = 'paid'
         ) AS has_paid
       FROM mobile_events e
       WHERE e.is_active = TRUE
         AND e.event_date >= CURRENT_DATE
         -- Academy-group match: event belongs to the root itself or to
         -- any sub-branch of that root, OR it's a global (NULL) row.
         -- This lets a sub-branch's approved event surface for every
         -- student in the same group, not just the sub-branch's own.
         AND (
           e.institution_id IS NULL
           OR e.institution_id IN (
             SELECT id FROM institutions
             WHERE id = $2 OR parent_institution_id = $2
           )
         )
         -- Scheduled rows stay hidden from student/trainer feeds until
         -- their publish_at moment passes. NULL = publish immediately
         -- (the legacy behaviour every pre-scheduling event still uses).
         AND (e.publish_at IS NULL OR e.publish_at <= NOW())
         -- Approval gate: sub-branches insert as 'pending'; only rows
         -- the parent has explicitly approved (or main-branch rows,
         -- which default to 'approved') ever reach students / guests.
         AND e.approval_status = 'approved'
       ORDER BY e.event_date ASC
       LIMIT 50`,
      [callerUserId, rootId],
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

    // Resolve parent (if this admin is a sub-branch). Events created by
    // a sub-branch land as approval_status='pending' and are hidden from
    // student/trainer feeds until the parent's admin approves them.
    // Events created by a main-branch admin skip the gate entirely.
    const instRow = await pool.query(
      `SELECT id, name, parent_institution_id
         FROM institutions
        WHERE id = $1`,
      [institutionId],
    );
    const inst = instRow.rows[0] || {};
    const parentInstitutionId = inst.parent_institution_id || null;
    const isSubBranch = !!parentInstitutionId;
    const approvalStatus = isSubBranch ? 'pending' : 'approved';

    const {
      title,
      subtitle,
      description,
      event_date,
      location,
      image_url,
      link,
      registration_closing_date,
      // Payment gate — when true, payment_amount is mandatory and the
      // student/trainer app shows a "Pay Now" button that opens an
      // integrated Razorpay Payment Link (same flow as the subscription
      // Pay Now). No externally-pasted URL: we mint the link server-side
      // per (event, user) at tap time and record it in event_payments.
      payment_required,
      payment_amount,
      // ISO string (or null). Null / past = publish immediately. Future
      // = row is inserted but hidden from student/trainer reads until
      // NOW() catches up, at which point it appears automatically —
      // no cron job needed because we filter on read.
      publish_at,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ field: 'title', message: 'Title is required.' });
    }
    if (!event_date) {
      return res.status(400).json({ field: 'event_date', message: 'Event date is required.' });
    }

    // ── Payment field validation ──────────────────────────────────────
    const paymentOn = payment_required === true || payment_required === 'true';
    let feeRupees = null;
    if (paymentOn) {
      feeRupees = Number(payment_amount);
      if (!Number.isFinite(feeRupees) || feeRupees <= 0) {
        return res.status(400).json({
          field: 'payment_amount',
          message: 'Enter a positive amount (in ₹) when payment is required.',
        });
      }
      // Razorpay minimum is ₹1. We reject anything smaller than a whole
      // rupee to avoid weird sub-rupee UX; admins can always undercut by
      // rounding down manually.
      if (feeRupees < 1) {
        return res.status(400).json({
          field: 'payment_amount',
          message: 'Minimum fee is ₹1.',
        });
      }
      // Store to 2dp — event fees are always paise-exact.
      feeRupees = Math.round(feeRupees * 100) / 100;
    }

    // ── Publish window validation ─────────────────────────────────────
    // We accept any ISO-8601 the mobile picker emits (with or without a
    // timezone). Falsy value = post immediately, stored as NULL. A
    // publish_at in the past is silently coerced to NULL so the row goes
    // live right away — safer than 400ing on a 500ms clock skew.
    let publishAtIso = null;
    if (publish_at) {
      const d = new Date(publish_at);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          field: 'publish_at',
          message: 'Scheduled time is invalid.',
        });
      }
      if (d.getTime() > Date.now() + 30 * 1000) {
        // 30s grace so the "Publish" button doesn't get rejected because
        // the picker had a slightly-in-the-past minute rounded down.
        publishAtIso = d.toISOString();
      }
    }

    const result = await pool.query(
      `INSERT INTO mobile_events
         (title, subtitle, description, location, event_date,
          registration_closing_date, image_url, link,
          payment_required, payment_amount, publish_at,
          institution_id, created_by, approval_status,
          is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, 0)
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
        paymentOn,
        paymentOn ? feeRupees : null,
        publishAtIso,
        institutionId,
        adminId,
        approvalStatus,
      ],
    );
    const eventRow = result.rows[0];

    // ── Notify parent admin when a sub-branch is asking for approval.
    // Best-effort: any DB blip is logged but doesn't fail the create.
    if (isSubBranch) {
      try {
        const parentAdmin = await pool.query(
          `SELECT owner_user_id, name FROM institutions WHERE id = $1`,
          [parentInstitutionId],
        );
        const parentOwnerId = parentAdmin.rows[0]?.owner_user_id;
        if (parentOwnerId) {
          await insertNotification({
            user_id:        parentOwnerId,
            institution_id: parentInstitutionId,
            category:       'system',
            title:          'Branch event awaiting approval',
            message:        `${inst.name || 'A branch'} submitted "${eventRow.title}" for your approval. Tap to review.`,
            data: {
              // StaffNotificationsScreen#onTap reads data.screen and
              // navigation.navigate()s to it — this is what makes the
              // notification actionable. EventsList opens with the
              // "Pending Approvals" section at the top, where the
              // Approve / Reject buttons live.
              screen:      'EventsList',
              kind:        'branch_event_pending',
              event_id:    eventRow.id,
              branch_id:   institutionId,
              branch_name: inst.name || null,
            },
            created_by: adminId,
          });
        }
      } catch (err) {
        console.warn('[event/create] parent notify failed:', err?.message);
      }
    }

    const isScheduled = !!publishAtIso;
    let message;
    if (isSubBranch) {
      message = 'Event submitted — the main institution will review and approve it before students see it.';
    } else if (isScheduled) {
      message = `Event scheduled — it will go live on ${new Date(publishAtIso).toLocaleString()}.`;
    } else {
      message = 'Event published. Your students and trainers will see it on their home screen.';
    }
    res.status(201).json({
      message,
      event: eventRow,
      pending_approval: isSubBranch,
    });
  } catch (err) {
    console.error('createInstitutionEvent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/institutions/me/location
//
// Sub-branch admin taps More → Update Location and saves their branch's
// current GPS coords + address. Sub-branches keep their own location
// fields (address, city, pincode, latitude, longitude) on their own
// `institutions` row — the parent's copy is never touched. A main-branch
// admin can also call this to move the head office; behavior is
// identical because we only ever update the caller's own row.
//
// Body: { latitude, longitude, address, city, pincode }
//   • Every field is optional; we COALESCE, so a partial payload only
//     touches the fields it carries. Sending an empty payload no-ops.
//   • Lat/lng are validated for the reasonable ranges. Text fields are
//     trimmed on save so a stray whitespace doesn't create false diffs.
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/institutions/sub-branches/:id
//
// Main-branch admin edits one of their SUB-BRANCH institution rows
// (the ones the wizard creates with parent_institution_id set). These
// don't live in institution_branches — they're rows in the institutions
// table with their own admin login — so the standard /branches PUT
// doesn't reach them. This endpoint updates the location + contact
// fields the branch card exposes: name, address, city, pincode, phone,
// email, latitude, longitude.
//
// Authorization:
//   • caller must be a main-branch admin (parent_institution_id IS NULL)
//   • the target sub-branch's parent_institution_id must equal the
//     caller's institution id.
// ─────────────────────────────────────────────────────────────────────────
exports.updateSubBranch = async (req, res) => {
  try {
    const adminId = req.user.id;
    const subId   = parseInt(req.params.id, 10);
    if (!Number.isFinite(subId)) return res.status(400).json({ message: 'Bad sub-branch id.' });

    // Caller must be a main-branch admin.
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [adminId],
    );
    const callerInstId = u.rows[0]?.institution_id;
    if (!callerInstId) return res.status(403).json({ message: 'No institution linked.' });
    const me = await pool.query(
      `SELECT id, parent_institution_id FROM institutions WHERE id = $1`,
      [callerInstId],
    );
    if (me.rows[0]?.parent_institution_id) {
      return res.status(403).json({ message: 'Only the main institution admin can edit sub-branches from here.' });
    }

    // Load the sub-branch, verify it belongs to us.
    const before = await pool.query(
      `SELECT * FROM institutions WHERE id = $1 AND deleted_at IS NULL`,
      [subId],
    );
    if (before.rows.length === 0) return res.status(404).json({ message: 'Sub-branch not found.' });
    if (before.rows[0].parent_institution_id !== callerInstId) {
      return res.status(403).json({ message: 'This sub-branch does not belong to your institution.' });
    }

    const {
      name, address, city, pincode, phone, email, latitude, longitude,
    } = req.body || {};

    const trim = (v) => (v == null ? null : String(v).trim() || null);
    const num  = (v, min, max) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (n < min || n > max) return null;
      return n;
    };
    const latVal = num(latitude, -90, 90);
    const lngVal = num(longitude, -180, 180);

    const upd = await pool.query(
      `UPDATE institutions
          SET name       = COALESCE($2, name),
              address    = COALESCE($3, address),
              city       = COALESCE($4, city),
              pincode    = COALESCE($5, pincode),
              phone      = COALESCE($6, phone),
              email      = COALESCE($7, email),
              latitude   = COALESCE($8, latitude),
              longitude  = COALESCE($9, longitude),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [
        subId,
        trim(name), trim(address), trim(city), trim(pincode),
        trim(phone), trim(email),
        latVal, lngVal,
      ],
    );
    const after = upd.rows[0];

    // ── Also sync the matching entry in the parent's `branches` JSONB
    // (populated at setup-wizard time). The admin web's Branch Locations
    // section renders straight from that JSONB, so if we only touched
    // the sub-branch's row here the web would keep showing the setup-
    // wizard value forever. Match order:
    //   1. by email (the wizard always captures it)
    //   2. by phone (fallback for branches without an email)
    //   3. by name (last resort)
    try {
      const parentRow = await pool.query(
        `SELECT branches FROM institutions WHERE id = $1`, [callerInstId],
      );
      const arr = Array.isArray(parentRow.rows[0]?.branches)
        ? parentRow.rows[0].branches
        : [];
      if (arr.length > 0) {
        const oldEmail = (before.rows[0].email || '').toLowerCase();
        const oldPhone = String(before.rows[0].phone || '').replace(/\D/g, '');
        const oldName  = (before.rows[0].name  || '').toLowerCase();

        let matched = -1;
        // 1) email match
        matched = arr.findIndex((b) =>
          b && b.email && oldEmail &&
          String(b.email).toLowerCase() === oldEmail);
        // 2) phone match
        if (matched === -1 && oldPhone) {
          matched = arr.findIndex((b) =>
            b && String(b.contact_number || b.phone || '').replace(/\D/g, '') === oldPhone);
        }
        // 3) name match
        if (matched === -1 && oldName) {
          matched = arr.findIndex((b) =>
            b && b.name && String(b.name).toLowerCase() === oldName);
        }

        if (matched !== -1) {
          const nextArr = arr.map((b, i) => i !== matched ? b : {
            ...b,
            name:           after.name,
            address:        after.address,
            city:           after.city,
            pincode:        after.pincode,
            email:          after.email,
            contact_number: after.phone,
            latitude:       after.latitude,
            longitude:      after.longitude,
          });
          await pool.query(
            `UPDATE institutions
                SET branches = $2::jsonb, updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [callerInstId, JSON.stringify(nextArr)],
          );
        }
      }
    } catch (err) {
      console.warn('[sub-branch/update] JSONB sync failed:', err?.message);
    }

    // Compute diff → notify super admins the sub-branch changed.
    const DIFFABLE = ['name', 'address', 'city', 'pincode', 'phone', 'email', 'latitude', 'longitude'];
    const changed = DIFFABLE.filter((k) => {
      const b = before.rows[0][k]; const a = after[k];
      return JSON.stringify(b == null ? null : b) !== JSON.stringify(a == null ? null : a);
    });

    if (changed.length > 0) {
      try {
        const parentRow = await pool.query(
          `SELECT name FROM institutions WHERE id = $1`, [callerInstId],
        );
        const parentName = parentRow.rows[0]?.name || 'An institution';
        const humanFields = changed.map((k) => k.replace(/_/g, ' ')).join(', ');
        const supers = await pool.query(
          `SELECT id FROM users
            WHERE role = 'super_admin' AND COALESCE(is_deleted, false) = false`,
        );
        // Snapshot the new values for the fields that changed so the
        // web admin can render an authoritative "changed to <value>"
        // hint. Small blobs only — matches the profile-update payload.
        const changedValues = {};
        for (const k of changed) {
          const v = after[k];
          if (typeof v === 'string' && v.length > 300) continue;
          changedValues[k] = v == null ? null : v;
        }
        for (const s of supers.rows) {
          await insertNotification({
            user_id:        s.id,
            institution_id: callerInstId,
            category:       'system',
            title:          'Branch updated',
            message:        `${parentName} updated sub-branch ${after.name} (${humanFields}).`,
            data: {
              kind:             'branch_updated',
              institution_id:   callerInstId,
              institution_name: parentName,
              // branch_id is what the web routes on — this MUST be the
              // sub-branch's own institutions id so the detail page it
              // opens shows the changed values, not the parent's.
              branch_id:        subId,
              branch_name:      after.name,
              changed_fields:   changed,
              changed_values:   changedValues,
              updated_at:       new Date().toISOString(),
            },
            created_by: adminId,
          });
        }
      } catch (err) {
        console.warn('[sub-branch/update] notify failed:', err?.message);
      }
    }

    res.json({ branch: after, changed_fields: changed });
  } catch (err) {
    console.error('updateSubBranch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateMyLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const uRow = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [userId],
    );
    const institutionId = uRow.rows[0]?.institution_id;
    if (!institutionId) {
      return res.status(400).json({ message: 'No institution linked to this admin.' });
    }

    const { latitude, longitude, address, city, pincode } = req.body || {};

    const lat = latitude === undefined || latitude === null || latitude === ''
      ? null : Number(latitude);
    const lng = longitude === undefined || longitude === null || longitude === ''
      ? null : Number(longitude);
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({ field: 'latitude', message: 'Latitude must be between -90 and 90.' });
    }
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      return res.status(400).json({ field: 'longitude', message: 'Longitude must be between -180 and 180.' });
    }

    // COALESCE keeps existing values when a field is null in the payload,
    // so a partial update only overwrites the columns the caller sent.
    const r = await pool.query(
      `UPDATE institutions
          SET latitude   = COALESCE($2, latitude),
              longitude  = COALESCE($3, longitude),
              address    = COALESCE($4, address),
              city       = COALESCE($5, city),
              pincode    = COALESCE($6, pincode)
        WHERE id = $1
        RETURNING id, name, address, city, pincode, latitude, longitude,
                  parent_institution_id`,
      [
        institutionId,
        lat,
        lng,
        address ? String(address).trim() : null,
        city    ? String(city).trim()    : null,
        pincode ? String(pincode).trim() : null,
      ],
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found.' });
    }
    res.json({
      message: 'Location updated.',
      institution: r.rows[0],
    });
  } catch (err) {
    console.error('updateMyLocation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /api/institutions/events/:eventId/pay
//
// Student / trainer taps "Pay Now" on an event that has payment_required.
// We mint (or reuse) a Razorpay Payment Link and return its short_url,
// which the mobile app opens via Linking.openURL — same in-browser flow
// as the subscription Pay Now.
//
// Reuse rule: if the caller already has a still-pending link for this
// event, we hand back the same short_url so refreshes don't spawn a pile
// of orphan payment links in Razorpay's dashboard.
//
// Idempotency: a 'paid' row wins — we short-circuit with { already_paid }.
// ─────────────────────────────────────────────────────────────────────────
exports.payForInstitutionEvent = async (req, res) => {
  try {
    const userId  = req.user?.id;
    const eventId = parseInt(req.params.eventId, 10);
    if (!userId)                return res.status(401).json({ message: 'Not authenticated' });
    if (!Number.isFinite(eventId)) return res.status(400).json({ message: 'Bad event id' });

    // Fetch the event with the institution's context — we surface the
    // academy name in the Razorpay checkout description so the user
    // knows who they're paying.
    const eventRow = await pool.query(
      `SELECT e.id, e.title, e.payment_required, e.payment_amount,
              e.institution_id,
              i.name AS institution_name
         FROM mobile_events e
         LEFT JOIN institutions i ON i.id = e.institution_id
        WHERE e.id = $1
          AND e.is_active = TRUE`,
      [eventId],
    );
    const event = eventRow.rows[0];
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (!event.payment_required) {
      return res.status(400).json({ message: 'This event is free — no payment needed.' });
    }
    const amountRupees = Number(event.payment_amount);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return res.status(500).json({ message: 'Event fee is misconfigured.' });
    }

    // Already paid → tell the client so it can lock the button.
    const paidCheck = await pool.query(
      `SELECT id FROM event_payments
        WHERE event_id = $1 AND user_id = $2 AND status = 'paid'
        LIMIT 1`,
      [eventId, userId],
    );
    if (paidCheck.rows.length) {
      return res.json({ ok: true, already_paid: true });
    }

    // Reuse a still-pending link if there is one — avoids racking up
    // dozens of pending links on repeat taps.
    const pendingRow = await pool.query(
      `SELECT id, razorpay_short_url
         FROM event_payments
        WHERE event_id = $1 AND user_id = $2 AND status = 'pending'
          AND razorpay_short_url IS NOT NULL
          AND created_at > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC
        LIMIT 1`,
      [eventId, userId],
    );
    if (pendingRow.rows[0]?.razorpay_short_url) {
      return res.json({
        ok: true,
        short_url: pendingRow.rows[0].razorpay_short_url,
        reused: true,
      });
    }

    // Mint a fresh link via Razorpay.
    const client = rzp();
    if (!client) {
      return res.status(503).json({ message: 'Payments not configured.' });
    }

    // Grab the payer's contact bits so Razorpay's hosted page pre-fills.
    const payer = await pool.query(
      `SELECT name, email, phone FROM users WHERE id = $1`,
      [userId],
    );
    const p = payer.rows[0] || {};

    // ── Normalise the payer's contact number ─────────────────────────
    // ROOT CAUSE of the "Payment Authentication Failed" error we've
    // been seeing at OTP time: Razorpay uses `customer.contact` for
    // 3DS / OTP delivery. If we pass a bare 10-digit Indian number
    // ("9876543210") the SMS gateway that Razorpay routes through
    // rejects it and the payer sees "Payment Authentication Failed"
    // even though the card + card data were correct. Razorpay expects
    // an E.164 string like "+919876543210". We normalise defensively:
    //   • strip whitespace / hyphens / parentheses
    //   • if the number already starts with '+', keep as-is
    //   • if it starts with '91' and is 12 digits, prefix '+'
    //   • if it's a plain 10-digit Indian mobile (starts 6-9), prefix '+91'
    //   • anything else (unusable) → omit the field entirely so
    //     Razorpay defaults to asking the payer for a phone at
    //     checkout instead of failing auth silently.
    const normaliseContact = (raw) => {
      if (!raw) return undefined;
      const cleaned = String(raw).replace(/[\s\-()]+/g, '');
      if (!cleaned) return undefined;
      if (cleaned.startsWith('+')) return cleaned;
      if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;
      if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
      return undefined;
    };
    const contactE164 = normaliseContact(p.phone);

    // Basic email sanity — pass through only when it looks vaguely
    // valid so Razorpay doesn't reject junk seed emails.
    const cleanEmail =
      typeof p.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())
        ? p.email.trim()
        : undefined;

    const amountPaise = Math.round(amountRupees * 100);
    const referenceId = `evt_${eventId}_u${userId}_${Date.now()}`;

    // Callback URL — points at the backend reconciliation endpoint
    // added below (institution.controller.js#eventPaymentSuccess). If
    // the Razorpay webhook doesn't reach us (misconfigured URL,
    // signature secret drift, blocked port), the reconciler on the
    // callback still flips the row to paid by asking Razorpay's own
    // API whether the link was actually paid. Guarantees the row
    // never gets stuck in 'pending' after a successful charge.
    const apiBase =
      (process.env.API_BASE_URL || process.env.APP_BASE_URL || 'https://veerifyapp.com')
        .replace(/\/+$/, '');
    const callbackUrl = `${apiBase}/api/institutions/events/${eventId}/payment-success?user_id=${userId}`;

    let link;
    try {
      link = await client.paymentLink.create({
        amount: amountPaise,
        currency: 'INR',
        accept_partial: false,
        notify: { email: false, sms: false },
        reminder_enable: false,
        description: `${event.title} — ${event.institution_name || 'Event fee'}`,
        reference_id: referenceId,
        customer: {
          name:    p.name || undefined,
          email:   cleanEmail,
          contact: contactE164,
        },
        notes: {
          // Webhook uses these to route back to the correct row.
          event_payment: '1',
          event_id: String(eventId),
          user_id:  String(userId),
        },
        callback_url:    callbackUrl,
        callback_method: 'get',
      });
    } catch (err) {
      const desc = err?.error?.description || err.message || 'Razorpay error';
      console.error('[event-pay] createPaymentLink failed:', desc);
      return res.status(502).json({ message: `Payment gateway: ${desc}` });
    }

    // Record the attempt so the webhook can flip it to 'paid'.
    await pool.query(
      `INSERT INTO event_payments
         (event_id, user_id, amount_paise, razorpay_link_id, razorpay_short_url, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [eventId, userId, amountPaise, link.id, link.short_url],
    );

    // Return the full envelope the mobile client needs to render its
    // "Verifying" state and (optionally, in future) drive the native
    // Razorpay SDK. We include:
    //   • key_id   — public key so the client can render an "opened
    //     with Razorpay <keyId>" strip and switch to native SDK later
    //   • order_id — the Payment Link id, used as the correlation id
    //     for the polling endpoint (/events/:id/payment-status)
    //   • amount   — paise (Razorpay convention) so client math never
    //     drifts from server truth
    //   • currency — always INR for now, explicit so future USD/etc
    //     doesn't need a shim
    return res.json({
      ok: true,
      short_url: link.short_url,
      key_id:    process.env.RAZORPAY_KEY_ID,
      order_id:  link.id,
      amount:    amountPaise,
      currency:  'INR',
    });
  } catch (err) {
    console.error('payForInstitutionEvent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/events/:eventId/payment-status
//
// Mobile polls this after the payer returns from the Razorpay hosted
// page. Reports the current server-side status of the caller's most
// recent event_payments row for this event. Never mutates state —
// only the signed webhook can flip 'pending' → 'paid'.
//
// Returns:
//   { status: 'paid' | 'pending' | 'failed' | 'none',
//     payment_id: string | null,
//     paid_at:    ISO string | null }
exports.getEventPaymentStatus = async (req, res) => {
  try {
    const userId  = req.user?.id;
    const eventId = parseInt(req.params.eventId, 10);
    if (!userId)                   return res.status(401).json({ message: 'Not authenticated' });
    if (!Number.isFinite(eventId)) return res.status(400).json({ message: 'Bad event id' });

    const q = await pool.query(
      `SELECT status, razorpay_payment_id, paid_at
         FROM event_payments
        WHERE event_id = $1 AND user_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [eventId, userId],
    );
    if (q.rows.length === 0) {
      return res.json({ status: 'none', payment_id: null, paid_at: null });
    }
    const row = q.rows[0];
    return res.json({
      status:     row.status || 'pending',
      payment_id: row.razorpay_payment_id || null,
      paid_at:    row.paid_at || null,
    });
  } catch (err) {
    console.error('getEventPaymentStatus error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/institutions/events/:eventId/payment-success
//
// Razorpay redirects the payer here after successful event-fee
// checkout. Same "webhook + active reconciliation" contract we use
// for enrollments — this endpoint:
//
//   1. Looks up the payer's most recent event_payments row.
//   2. If already 'paid' → renders confirmation page (idempotent).
//   3. Otherwise queries the Razorpay REST API to confirm the link
//      is genuinely paid. If yes and our DB still says pending →
//      flips the row to 'paid' + stamps the real payment id.
//   4. Renders a branded HTML page that ALWAYS works — never a 404.
//      Auto-refreshes every 3s while still pending so a slow
//      webhook doesn't leave the payer staring at "processing".
//
// Public — no auth. The event_id + user_id in the URL identify
// exactly which row to reconcile; nothing sensitive is exposed.
exports.eventPaymentSuccess = async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId, 10);
    const userId  = parseInt(req.query.user_id, 10);
    if (!Number.isFinite(eventId) || !Number.isFinite(userId)) {
      return res.status(400).send('Missing or invalid event_id / user_id.');
    }

    // Pull the payer's most recent event_payments row + display
    // context for the confirmation card.
    const r = await pool.query(
      `SELECT ep.id, ep.status, ep.razorpay_link_id, ep.razorpay_payment_id,
              ep.paid_at, ep.amount_paise,
              e.title AS event_title,
              i.name  AS institution_name,
              u.name  AS payer_name, u.email AS payer_email
         FROM event_payments ep
         JOIN mobile_events e ON e.id = ep.event_id
         LEFT JOIN institutions i ON i.id = e.institution_id
         JOIN users u ON u.id = ep.user_id
        WHERE ep.event_id = $1 AND ep.user_id = $2
        ORDER BY ep.created_at DESC
        LIMIT 1`,
      [eventId, userId],
    );
    if (r.rows.length === 0) {
      return res.status(404).send('Event payment record not found.');
    }
    const row = r.rows[0];

    // ── Active reconciliation ─────────────────────────────────────
    let reconciled = false;
    let reconciledError = null;
    if (row.status !== 'paid' && row.razorpay_link_id) {
      try {
        const { fetchPaymentLinkStatus } = require('../utils/razorpay');
        const info = await fetchPaymentLinkStatus(row.razorpay_link_id);
        if (info.ok && info.status === 'paid') {
          const upd = await pool.query(
            `UPDATE event_payments
                SET status              = 'paid',
                    razorpay_payment_id = COALESCE($2, razorpay_payment_id),
                    paid_at             = NOW()
              WHERE id = $1
                AND status <> 'paid'
              RETURNING id`,
            [row.id, info.paymentId || null],
          );
          reconciled = upd.rowCount > 0;
          if (reconciled) {
            console.log(
              `[eventPaymentSuccess] reconciled event=${eventId} user=${userId} via Razorpay API`,
            );
          }
        } else if (info.ok) {
          reconciledError = `Razorpay reports status "${info.status}" — the charge hasn't fully cleared yet. Refresh in a few seconds.`;
        } else {
          reconciledError = info.error || 'Could not verify payment with Razorpay.';
        }
      } catch (e) {
        reconciledError = e?.message || 'Reconciliation failed';
        console.error('[eventPaymentSuccess] reconcile error:', e);
      }
    }

    // Re-fetch to render the latest state.
    const finalRow = await pool.query(
      `SELECT status FROM event_payments WHERE id = $1`,
      [row.id],
    );
    const paid = finalRow.rows[0]?.status === 'paid';

    const esc = (s) => String(s || '').replace(/[<>&"']/g, (c) => (
      { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]
    ));
    const title = paid
      ? 'Registration confirmed'
      : (reconciledError ? 'Still confirming payment' : 'Payment processing');
    const sub = paid
      ? `You're registered for ${esc(row.event_title)}${row.institution_name ? ` at ${esc(row.institution_name)}` : ''}. See you there.`
      : (reconciledError
          ? `Your payment succeeded on Razorpay but our server hasn't confirmed it yet. ${esc(reconciledError)} This page will refresh automatically.`
          : `Your payment is being processed. This page will update automatically once we confirm the charge — usually within 5 seconds.`);
    const tickColor = paid ? '#10B981' : '#F59E0B';
    const refreshMeta = paid ? '' : '<meta http-equiv="refresh" content="3">';

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refreshMeta}
  <title>${esc(title)} — Veerify</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #F5F3FF 0%, #FDF2F8 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #111827; padding: 24px;
    }
    .card {
      max-width: 460px; width: 100%; background: #fff;
      border-radius: 20px; padding: 32px 28px;
      box-shadow: 0 20px 60px rgba(15,23,42,0.08),
                  0 4px 12px rgba(15,23,42,0.04);
      text-align: center;
    }
    .tick {
      width: 72px; height: 72px; border-radius: 50%;
      background: ${tickColor}; margin: 4px auto 20px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 10px 30px ${tickColor}55;
    }
    .tick svg { width: 40px; height: 40px; stroke: #fff; }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 800; }
    p  { margin: 0 0 8px; color: #6B7280; line-height: 1.55; font-size: 14px; }
    .evt {
      display: inline-block; margin: 14px 0 6px;
      padding: 8px 14px; border-radius: 999px;
      background: #F3E8FF; color: #6D28D9; font-weight: 700; font-size: 13px;
    }
    .cta {
      display: inline-block; margin-top: 22px;
      padding: 12px 22px; border-radius: 12px;
      background: #6D28D9; color: #fff; font-weight: 700;
      text-decoration: none; font-size: 14px;
    }
    .foot { margin-top: 22px; font-size: 11px; color: #9CA3AF; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tick">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3"
           stroke-linecap="round" stroke-linejoin="round">
        ${paid ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>'}
      </svg>
    </div>
    <h1>${esc(title)}</h1>
    <div class="evt">${esc(row.event_title)}</div>
    <p>${sub}</p>
    <a class="cta" href="veerify://event-registered">Open Veerify</a>
    <div class="foot">You can safely close this tab.</div>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('eventPaymentSuccess error:', err);
    return res.status(500).send('Server error. Please try again in a moment.');
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
         payment_required, payment_amount, publish_at,
         approval_status, approval_reason, approval_decided_at,
         institution_id, created_at,
         -- Four-way status so the admin's EventsList can badge each row.
         -- Approval outcomes win over publish/date state — a rejected
         -- event is rejected regardless of when it was scheduled.
         CASE
           WHEN approval_status = 'pending'                    THEN 'pending'
           WHEN approval_status = 'rejected'                   THEN 'rejected'
           WHEN publish_at IS NOT NULL AND publish_at > NOW()  THEN 'scheduled'
           WHEN event_date <  CURRENT_DATE                     THEN 'past'
           ELSE                                                     'upcoming'
         END AS status
       FROM mobile_events
       WHERE institution_id = $1
       ORDER BY
         CASE
           WHEN publish_at IS NOT NULL AND publish_at > NOW() THEN 0
           ELSE 1
         END,
         event_date DESC
       LIMIT 200`,
      [institutionId],
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('listMyInstitutionEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Branch → Parent event approval flow
// ─────────────────────────────────────────────────────────────────────────
// Sub-branch events land as approval_status='pending'. The parent's admin
// reviews them here.

// GET /api/institutions/me/events/pending
// Parent admin lists every pending event from any of their sub-branches.
exports.listPendingBranchEvents = async (req, res) => {
  try {
    const adminId = req.user.id;
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [adminId],
    );
    const homeId = u.rows[0]?.institution_id;
    if (!homeId) return res.status(403).json({ message: 'No institution linked.' });

    // The parent admin's own institutions row has parent_institution_id = NULL.
    // Sub-branch admins can't call this — reject if they're not at the root.
    const meRow = await pool.query(
      `SELECT parent_institution_id FROM institutions WHERE id = $1`,
      [homeId],
    );
    if (meRow.rows[0]?.parent_institution_id) {
      return res.status(403).json({ message: 'Only the main institution admin can approve branch events.' });
    }

    // Pending events from any institution whose parent is our home id.
    const result = await pool.query(
      `SELECT e.id, e.title, e.subtitle, e.description, e.image_url,
              e.event_date, e.registration_closing_date, e.location, e.link,
              e.payment_required, e.payment_amount, e.publish_at,
              e.approval_status, e.institution_id, e.created_at,
              i.name AS branch_name
         FROM mobile_events e
         JOIN institutions i ON i.id = e.institution_id
        WHERE i.parent_institution_id = $1
          AND e.approval_status = 'pending'
          AND e.is_active = TRUE
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [homeId],
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('listPendingBranchEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Shared decide helper — DRY for approve/reject. Enforces:
//   • caller is main-branch admin
//   • event belongs to a sub-branch under caller's institution
//   • event is currently 'pending'
async function decideBranchEvent({ res, decidingUserId, eventId, decision, reason }) {
  // Look up caller's institution + confirm they're a main-branch admin.
  const u = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`, [decidingUserId],
  );
  const homeId = u.rows[0]?.institution_id;
  if (!homeId) return res.status(403).json({ message: 'No institution linked.' });
  const meRow = await pool.query(
    `SELECT parent_institution_id FROM institutions WHERE id = $1`, [homeId],
  );
  if (meRow.rows[0]?.parent_institution_id) {
    return res.status(403).json({ message: 'Only the main institution admin can approve branch events.' });
  }

  // Load event + verify its branch is one of our sub-branches.
  const ev = await pool.query(
    `SELECT e.id, e.title, e.institution_id, e.approval_status,
            e.created_by, i.parent_institution_id, i.name AS branch_name
       FROM mobile_events e
       JOIN institutions i ON i.id = e.institution_id
      WHERE e.id = $1`,
    [eventId],
  );
  const row = ev.rows[0];
  if (!row) return res.status(404).json({ message: 'Event not found.' });
  if (row.parent_institution_id !== homeId) {
    return res.status(403).json({ message: 'This event does not belong to your branches.' });
  }
  if (row.approval_status !== 'pending') {
    return res.status(409).json({
      message: `Event is already ${row.approval_status}.`,
      approval_status: row.approval_status,
    });
  }

  const updated = await pool.query(
    `UPDATE mobile_events
        SET approval_status     = $2,
            approval_reason     = $3,
            approval_decided_by = $4,
            approval_decided_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [eventId, decision, decision === 'rejected' ? (reason || null) : null, decidingUserId],
  );

  // Notify the sub-branch admin so their EventsList row updates fast.
  try {
    if (row.created_by) {
      const isApproval = decision === 'approved';
      await insertNotification({
        user_id:        row.created_by,
        institution_id: row.institution_id,
        category:       'system',
        title:          isApproval ? 'Event approved' : 'Event rejected',
        message:        isApproval
          ? `"${row.title}" is now live for your students and trainers.`
          : `"${row.title}" was not approved${reason ? `: ${reason}` : '.'}`,
        data: {
          // Same deep-link mechanism as the pending notification — tap
          // takes the branch admin to their own EventsList, where the
          // row is now badged as Live (green) or Rejected (red).
          screen:   'EventsList',
          kind:     isApproval ? 'branch_event_approved' : 'branch_event_rejected',
          event_id: row.id,
          reason:   reason || null,
        },
        created_by: decidingUserId,
      });
    }
  } catch (err) {
    console.warn('[event/decide] branch notify failed:', err?.message);
  }

  return res.json({
    message: decision === 'approved'
      ? 'Event approved — it is now visible to students and trainers.'
      : 'Event rejected — the branch admin has been notified.',
    event: updated.rows[0],
  });
}

// PATCH /api/institutions/events/:eventId/approve
exports.approveBranchEvent = async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId, 10);
    if (!Number.isFinite(eventId)) return res.status(400).json({ message: 'Bad event id.' });
    return decideBranchEvent({
      res,
      decidingUserId: req.user.id,
      eventId,
      decision: 'approved',
    });
  } catch (err) {
    console.error('approveBranchEvent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PATCH /api/institutions/events/:eventId/reject
// Body: { reason?: string }
exports.rejectBranchEvent = async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId, 10);
    if (!Number.isFinite(eventId)) return res.status(400).json({ message: 'Bad event id.' });
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
    return decideBranchEvent({
      res,
      decidingUserId: req.user.id,
      eventId,
      decision: 'rejected',
      reason,
    });
  } catch (err) {
    console.error('rejectBranchEvent error:', err);
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
    const callerUserId = req.user.id;
    const u = await pool.query(
      `SELECT u.institution_id,
              COALESCE(i.parent_institution_id, i.id) AS root_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1`,
      [callerUserId],
    );
    const rootId = u.rows[0]?.root_id || null;

    // Guests / un-linked users → globals only. Linked users see events
    // from anywhere in their academy GROUP (root + every sub-branch),
    // so an event a sub-branch created and the parent approved shows
    // up for students at any branch of the same academy.
    let where, params;
    if (rootId) {
      where = `(
        e.institution_id IS NULL
        OR e.institution_id IN (
          SELECT id FROM institutions
          WHERE id = $2 OR parent_institution_id = $2
        )
      )`;
      params = [callerUserId, rootId];
    } else {
      where  = `e.institution_id IS NULL`;
      params = [callerUserId];
    }

    const result = await pool.query(
      `SELECT
         e.id, e.title, e.subtitle, e.description, e.image_url, e.event_date,
         e.registration_closing_date, e.location, e.link,
         e.payment_required, e.payment_amount, e.publish_at,
         e.sort_order, e.institution_id,
         CASE WHEN e.institution_id IS NULL THEN 'global' ELSE 'institution' END AS source,
         EXISTS (
           SELECT 1 FROM event_payments ep
            WHERE ep.event_id = e.id
              AND ep.user_id  = $1
              AND ep.status   = 'paid'
         ) AS has_paid
       FROM mobile_events e
       WHERE e.is_active = TRUE
         AND e.event_date >= CURRENT_DATE
         AND (e.publish_at IS NULL OR e.publish_at <= NOW())
         AND e.approval_status = 'approved'
         AND ${where}
       ORDER BY e.event_date ASC
       LIMIT 50`,
      params,
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('getMyEvents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
