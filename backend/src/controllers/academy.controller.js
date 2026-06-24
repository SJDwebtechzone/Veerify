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
const { resolvePincode } = require('../utils/geocoder');

// resolvePincode is shared from utils/geocoder.js so the branch +
// onboarding flows use the exact same lookup logic.

// GET /api/academies/nearby
exports.getNearby = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    // Default "nearby" radius — keeps the list feeling local. The
    // caller can pass max_km=0 to disable. If the first pass returns
    // nothing within this radius we widen automatically so the section
    // never goes empty when there ARE academies in the DB.
    let maxKm = req.query.max_km != null
      ? parseFloat(req.query.max_km)
      : 50;
    if (Number.isNaN(maxKm) || maxKm <= 0) maxKm = null;

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
    let r = await pool.query(sql, params);

    // Progressive widen — if the strict radius found nothing AND the
    // caller didn't pin an explicit max_km, retry once at 200 km, and
    // once unbounded. "Other Academies Near You" should never go empty
    // when there are geocoded academies in the DB; we just label the
    // result so the mobile can say "farther away than usual" if needed.
    let widened_to = null;
    if (r.rows.length === 0 && req.query.max_km == null) {
      const buildSql = (capKm) => {
        const params2 = [lat, lng];
        let distFilter = '';
        if (capKm != null) {
          params2.push(capKm);
          distFilter = ` AND (
            6371 * acos(
              cos(radians($1)) * cos(radians(latitude))
              * cos(radians(longitude) - radians($2))
              + sin(radians($1)) * sin(radians(latitude))
            )
          ) <= $${params2.length}`;
        }
        params2.push(limit);
        return [params2, distFilter];
      };
      // Attempt 200 km.
      {
        const [p2, df2] = buildSql(200);
        const sql2 = sql
          .replace(`${distanceWhere}`, df2)
          .replace(`$${params.length}`, `$${p2.length}`);
        r = await pool.query(sql2, p2);
        if (r.rows.length > 0) widened_to = 200;
      }
      // Attempt unbounded.
      if (r.rows.length === 0) {
        const [p3, df3] = buildSql(null);
        const sql3 = sql
          .replace(`${distanceWhere}`, df3)
          .replace(`$${params.length}`, `$${p3.length}`);
        r = await pool.query(sql3, p3);
        if (r.rows.length > 0) widened_to = 'unbounded';
      }
    }

    // Pincode-text fallback. The spatial query filters out academies
    // whose latitude/longitude are NULL (a lot of older rows have no
    // coords). When the caller searched by pincode and we still found
    // nothing, fall back to a text match on the institutions.pincode
    // column — exact match first, then a 3-digit prefix so the same
    // district returns something. Branches are excluded here since they
    // already require coords by design.
    if (r.rows.length === 0 && req.query.pincode) {
      const pin = String(req.query.pincode).trim();
      if (pin) {
        const exact = await pool.query(
          `SELECT i.id, i.name, i.logo_url, i.city, i.address,
                  NULL::int AS institution_id, NULL::varchar AS institution_name,
                  i.latitude, i.longitude, i.pincode,
                  'institution' AS kind,
                  NULL::float   AS distance_km
             FROM institutions i
            WHERE COALESCE(i.deleted_at::text, '') = ''
              AND i.status = 'active'
              AND i.pincode = $1
            ORDER BY i.created_at DESC
            LIMIT $2`,
          [pin, limit],
        );
        if (exact.rows.length) {
          r = exact;
          widened_to = 'pincode-exact';
        } else if (pin.length >= 3) {
          // Same district by 3-digit prefix.
          const prefix = pin.slice(0, 3) + '%';
          const district = await pool.query(
            `SELECT i.id, i.name, i.logo_url, i.city, i.address,
                    NULL::int AS institution_id, NULL::varchar AS institution_name,
                    i.latitude, i.longitude, i.pincode,
                    'institution' AS kind,
                    NULL::float   AS distance_km
               FROM institutions i
              WHERE COALESCE(i.deleted_at::text, '') = ''
                AND i.status = 'active'
                AND i.pincode LIKE $1
              ORDER BY i.created_at DESC
              LIMIT $2`,
            [prefix, limit],
          );
          if (district.rows.length) {
            r = district;
            widened_to = 'pincode-prefix';
          }
        }
      }
    }

    // Decorate each row with `seats_available` so the mobile can flag
    // institutions whose subscription plan has hit its student cap.
    // For an institution row, the cap is its own; for a branch row, we
    // use the parent institution's cap (since branches share the plan).
    const instIds = [...new Set(
      r.rows.map((row) => row.kind === 'branch' ? row.institution_id : row.id).filter(Boolean),
    )];
    if (instIds.length > 0) {
      const capRows = await pool.query(
        `SELECT i.id            AS institution_id,
                sp.max_students AS max_students,
                (
                  SELECT COUNT(DISTINCT e.student_id)::int
                    FROM enrollments e
                   WHERE e.institution_id = i.id
                ) AS current_students
           FROM institutions i
           LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
          WHERE i.id = ANY($1::int[])`,
        [instIds],
      );
      const capByInst = {};
      capRows.rows.forEach((c) => {
        const cap = Number(c.max_students || 0);
        const used = Number(c.current_students || 0);
        const unlimited = !cap || cap >= 999;
        capByInst[c.institution_id] = {
          seats_available: unlimited ? true : used < cap,
          seats_total:     unlimited ? null : cap,
          seats_used:      used,
        };
      });
      r.rows.forEach((row) => {
        const instId = row.kind === 'branch' ? row.institution_id : row.id;
        const info = capByInst[instId];
        if (info) Object.assign(row, info);
      });
    }

    res.json({
      resolved_from:    resolvedFrom,
      resolved_pincode: resolvedPincode,
      origin:           { latitude: lat, longitude: lng },
      radius_km:        maxKm,
      widened_to,
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

