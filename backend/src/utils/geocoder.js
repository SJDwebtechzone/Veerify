// backend/src/utils/geocoder.js
//
// Server-side pincode + address geocoder.
//
// Resolution order:
//   1. Exact local hit in the `pincodes` table
//   2. OpenStreetMap Nominatim (cached back into `pincodes`)
//   3. 3-digit prefix average over the table (district centroid)
//
// Plus a typed-address geocoder used by branch / institution create
// flows so the admin doesn't have to GPS-tag every location. If the
// admin types just a pincode we use it; if they also typed a city /
// address, we feed all of it to Nominatim for a more precise hit.
//
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   • 1 request per second from a single IP — we throttle here.
//   • Real User-Agent identifying the app — set below.
//   • Cache results to avoid repeat lookups — we write back to `pincodes`.

const pool = require('../config/db');

const NOMINATIM_USER_AGENT = 'Veerify/1.0 (admin@veerify.app)';

// ─── Nominatim throttle ─────────────────────────────────────────────────
let _nominatimLastCall = 0;
async function _waitForNominatimSlot() {
  const sinceLast = Date.now() - _nominatimLastCall;
  const minGap = 1100; // 1.1s for safety
  if (sinceLast < minGap) {
    await new Promise((r) => setTimeout(r, minGap - sinceLast));
  }
  _nominatimLastCall = Date.now();
}

// Generic Nominatim search. Returns { lat, lng, district, state } or null.
//
// IMPORTANT — Nominatim treats `q=` (free-form) and structured filters
// (postalcode / city / county / state / country) as MUTUALLY EXCLUSIVE.
// Mixing them returns HTTP 400. So we only append &country=India when
// the caller's qs is structured; for a free-form q=… lookup, the
// caller must include "India" in the query string itself. Callers of
// geocodeAddress already do this.
async function _nominatimSearch(qs) {
  try {
    await _waitForNominatimSlot();
    const isFreeForm = /(^|&)q=/.test(qs);
    const filters = isFreeForm ? '' : '&country=India';
    const url =
      `https://nominatim.openstreetmap.org/search?${qs}${filters}` +
      `&format=json&addressdetails=1&limit=1`;
    // Cap the outbound Nominatim call at 3s so a slow / unreachable
    // upstream can't stall the whole /academies/nearby endpoint. On
    // timeout we fall back to the local prefix average.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'User-Agent': NOMINATIM_USER_AGENT,
          'Accept':     'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      // 400 usually means the free-form query contained a token
      // Nominatim couldn't parse (e.g. a 2-letter state abbreviation
      // like "Tn"). Not an operational error — the caller retries
      // with a smaller query — so log at info instead of warn to
      // avoid falsely flagging the branch-create pipeline as broken.
      const level = r.status === 400 ? 'log' : 'warn';
      console[level]('[geocoder] nominatim http', r.status, 'for', qs);
      return null;
    }
    const arr = await r.json();
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (!hit || !hit.lat || !hit.lon) return null;
    const addr = hit.address || {};
    return {
      lat:      Number(hit.lat),
      lng:      Number(hit.lon),
      district: addr.county || addr.city_district || addr.state_district || addr.city || addr.town || addr.suburb || null,
      state:    addr.state || null,
    };
  } catch (err) {
    console.warn('[geocoder] nominatim error:', err?.message || err);
    return null;
  }
}

// Resolve a raw pincode to { latitude, longitude, district, state }.
// Caches successful Nominatim hits back into `pincodes` so subsequent
// lookups are instant.
async function resolvePincode(rawPin) {
  const pin = String(rawPin || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (pin.length !== 6) return null;

  // 1. Exact local hit.
  const exact = await pool.query(
    `SELECT pincode, latitude, longitude, district, state
       FROM pincodes WHERE pincode = $1`,
    [pin],
  );
  if (exact.rows[0]) return exact.rows[0];

  // 2. Nominatim.
  const hit = await _nominatimSearch(`postalcode=${encodeURIComponent(pin)}`);
  if (hit) {
    try {
      await pool.query(
        `INSERT INTO pincodes (pincode, latitude, longitude, district, state, region3)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (pincode) DO NOTHING`,
        [pin, hit.lat, hit.lng, hit.district, hit.state, pin.slice(0, 3)],
      );
    } catch (_) { /* cache is best-effort */ }
    return {
      pincode:   pin,
      latitude:  hit.lat,
      longitude: hit.lng,
      district:  hit.district,
      state:     hit.state,
    };
  }

  // 3. Prefix average — last-ditch.
  const fuzzy = await pool.query(
    `SELECT AVG(latitude)::float  AS latitude,
            AVG(longitude)::float AS longitude,
            MAX(district)         AS district,
            MAX(state)            AS state
       FROM pincodes
      WHERE region3 = $1`,
    [pin.slice(0, 3)],
  );
  const f = fuzzy.rows[0];
  if (f && f.latitude && f.longitude) {
    return { pincode: pin, ...f };
  }
  return null;
}

// Geocode a typed address. Used by branch + institution create flows
// so the admin doesn't have to GPS-tag each location they type in.
//
// `parts` is the address pieces we have. We assemble the most precise
// query possible and fall back to pincode-only if the full address
// doesn't match. Returns { latitude, longitude } or null.
async function geocodeAddress({ address_line, city, state, pincode, country = 'India' }) {
  const pin = String(pincode || '').replace(/[^0-9]/g, '').slice(0, 6);

  // Sanitise state — Nominatim wants the full name ("Tamil Nadu"),
  // not the postal abbreviation ("Tn" / "TN"). A 2- or 3-letter
  // token in the state slot triggers a 400 for the whole query, so
  // we drop it. Callers that pass a full state name still work.
  const stateClean = (state && String(state).trim().length > 3)
    ? String(state).trim()
    : null;

  const haveDetail = (address_line && address_line.trim()) || (city && city.trim());
  if (haveDetail) {
    // Try progressively looser candidate queries. Some inputs
    // ("Nagai, Tn, India") make Nominatim return 400 for the full
    // string but succeed with just city + country. Each miss is a
    // silent no-op — the caller (branch/institution create) already
    // treats geocoding as best-effort.
    const candidates = [
      [address_line, city, stateClean, pin, country],
      [address_line, city, pin, country],
      [address_line, city, country],
      [city, stateClean, country],
      [city, country],
    ];
    for (const parts of candidates) {
      const q = parts.filter(Boolean).map((p) => String(p).trim()).filter(Boolean).join(', ');
      if (!q) continue;
      const hit = await _nominatimSearch(`q=${encodeURIComponent(q)}`);
      if (hit) return { latitude: hit.lat, longitude: hit.lng };
    }
  }

  // Fall back to pincode-only.
  if (pin.length === 6) {
    const r = await resolvePincode(pin);
    if (r) return { latitude: r.latitude, longitude: r.longitude };
  }

  return null;
}

module.exports = { resolvePincode, geocodeAddress };
