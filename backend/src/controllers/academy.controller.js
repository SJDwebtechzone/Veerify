// backend/src/controllers/academy.controller.js
//
// Public "Find academies near me" endpoint that powers the student-side
// Nearby section. Drives the hybrid GPS-or-pincode UX:
//
//   GET /api/academies/nearby?lat=&lng=
//   GET /api/academies/nearby?pincode=560034
//
// Both shapes resolve to a single { latitude, longitude } centre, then
// the same haversine query runs against (a) institution head offices
// and (b) institution_branches in one UNION-style result. The response
// is sorted by distance_km ascending.
//
// Falls back gracefully when:
//   • the pincode isn't in the lookup table → we try prefix-match (first
//     3 digits) against any pincode that IS in the table.
//   • coords still aren't available → we return the most recently-added
//     institutions so the student sees something.

const pool = require('../config/db');

// Resolve a string pincode to { latitude, longitude, district, state }.
// Returns null if no row even loosely matches.
async function resolvePincode(rawPin) {
  const pin = String(rawPin || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (pin.length !== 6) return null;

  // Exact hit first.
  const exact = await pool.query(
    `SELECT pincode, latitude, longitude, district, state
       FROM pincodes WHERE pincode = $1`,
    [pin],
  );
  if (exact.rows[0]) return exact.rows[0];

  // Prefix match — try 3 digits (same postal sorting district) and
  // average their coords. Good "same city" fallback when the student's
  // exact pincode isn't in our seed yet.
  const prefix = pin.slice(0, 3);
  const fuzzy = await pool.query(
    `SELECT AVG(latitude)::float  AS latitude,
            AVG(longitude)::float AS longitude,
            MAX(district)         AS district,
            MAX(state)            AS state
       FROM pincodes
      WHERE region3 = $1`,
    [prefix],
  );
  const f = fuzzy.rows[0];
  if (f && f.latitude && f.longitude) {
    return { pincode: pin, ...f };
  }
  return null;
}

// GET /api/academies/nearby
exports.getNearby = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const maxKm = req.query.max_km ? parseFloat(req.query.max_km) : null;

    let lat = parseFloat(req.query.lat);
    let lng = parseFloat(req.query.lng);
    let resolvedFrom = 'gps';
    let resolvedPincode = null;

    if ((Number.isNaN(lat) || Number.isNaN(lng)) && req.query.pincode) {
      const r = await resolvePincode(req.query.pincode);
      if (r) {
        lat = r.latitude;
        lng = r.longitude;
        resolvedFrom = 'pincode';
        resolvedPincode = {
          pincode:  r.pincode,
          district: r.district,
          state:    r.state,
        };
      }
    }

    // No coords at all — return a generic newest-first list.
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      const r = await pool.query(
        `SELECT i.id, i.name, i.logo_url, i.city, i.address,
                i.latitude, i.longitude, i.pincode,
                NULL::float AS distance_km,
                'institution' AS kind
           FROM institutions i
          WHERE COALESCE(i.deleted_at::text, '') = ''
            AND i.status = 'active'
          ORDER BY i.created_at DESC
          LIMIT $1`,
        [limit],
      );
      return res.json({
        resolved_from:    null,
        resolved_pincode: null,
        results:          r.rows,
      });
    }

    // Blend institutions + branches in a single distance-sorted result.
    // Both tables expose (latitude, longitude); we tag each row with a
    // `kind` so the mobile can render slightly different cards.
    const params = [lat, lng];
    let distanceWhere = '';
    if (maxKm != null && !Number.isNaN(maxKm)) {
      params.push(maxKm);
      distanceWhere = ` AND (
        6371 * acos(
          cos(radians($1)) * cos(radians(latitude))
          * cos(radians(longitude) - radians($2))
          + sin(radians($1)) * sin(radians(latitude))
        )
      ) <= $${params.length}`;
    }
    params.push(limit);

    const sql = `
      WITH base AS (
        SELECT
          i.id              AS id,
          i.name            AS name,
          i.logo_url        AS logo_url,
          i.city            AS city,
          i.address         AS address,
          NULL::int         AS institution_id,
          NULL::varchar     AS institution_name,
          i.latitude        AS latitude,
          i.longitude       AS longitude,
          i.pincode         AS pincode,
          'institution'     AS kind
        FROM institutions i
        WHERE COALESCE(i.deleted_at::text, '') = ''
          AND i.status = 'active'
          AND i.latitude IS NOT NULL
          AND i.longitude IS NOT NULL

        UNION ALL

        SELECT
          b.id              AS id,
          b.name            AS name,
          i.logo_url        AS logo_url,
          b.city            AS city,
          b.address_line    AS address,
          b.institution_id  AS institution_id,
          i.name            AS institution_name,
          b.latitude        AS latitude,
          b.longitude       AS longitude,
          b.pin_code        AS pincode,
          'branch'          AS kind
        FROM institution_branches b
        JOIN institutions i ON i.id = b.institution_id
        WHERE b.status = 'active'
          AND b.latitude IS NOT NULL
          AND b.longitude IS NOT NULL
          AND COALESCE(i.deleted_at::text, '') = ''
          AND i.status = 'active'
      )
      SELECT
        id, name, logo_url, city, address,
        institution_id, institution_name,
        latitude, longitude, pincode, kind,
        (
          6371 * acos(
            cos(radians($1)) * cos(radians(latitude))
            * cos(radians(longitude) - radians($2))
            + sin(radians($1)) * sin(radians(latitude))
          )
        ) AS distance_km
      FROM base
      WHERE TRUE ${distanceWhere}
      ORDER BY distance_km ASC
      LIMIT $${params.length}
    `;
    const r = await pool.query(sql, params);
    res.json({
      resolved_from:    resolvedFrom,
      resolved_pincode: resolvedPincode,
      origin:           { latitude: lat, longitude: lng },
      results:          r.rows,
    });
  } catch (err) {
    console.error('Academies nearby error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/academies/pincode-lookup?pin=600001
// Lightweight helper the mobile uses to validate / preview a pincode
// before showing it as "Pincode set". Returns null on no match.
exports.lookupPincode = async (req, res) => {
  try {
    const r = await resolvePincode(req.query.pin);
    if (!r) return res.json({ match: null });
    res.json({
      match: {
        pincode:  r.pincode,
        district: r.district,
        state:    r.state,
        latitude: r.latitude,
        longitude: r.longitude,
      },
    });
  } catch (err) {
    console.error('Pincode lookup error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
