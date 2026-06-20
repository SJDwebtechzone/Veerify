// backend/src/controllers/branch.controller.js
//
// CRUD for institution_branches plus a nearby-search endpoint that
// drives the student-side "Other Academies Near You" list.
//
// Endpoints:
//   GET    /api/branches                         — admin lists own branches
//   GET    /api/branches/nearby?lat=&lng=&max_km — public list, distance-sorted
//   POST   /api/branches                         — admin creates a branch
//   PUT    /api/branches/:id                     — admin updates own branch
//   DELETE /api/branches/:id                     — admin removes own branch
//
// Plan-limit gating: institution_branches.count is gated by the plan's
// max_branches. We reuse the same `ensureCapacity` helper that gates
// trainers + students, so the 402 PLAN_LIMIT_REACHED path is identical.

const pool = require('../config/db');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');

async function getAdminInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

// GET /api/branches — admin lists branches for their own institution.
exports.listMine = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });
    const r = await pool.query(
      `SELECT * FROM institution_branches
        WHERE institution_id = $1
        ORDER BY is_primary DESC, created_at ASC`,
      [institutionId],
    );
    res.json({ branches: r.rows });
  } catch (err) {
    console.error('Branch list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/branches/nearby?lat=&lng=&max_km=&limit=
// Public — the student app calls this with the device's coords. Returns
// branches sorted by haversine distance from the supplied point, joined
// with their parent institution's name + logo so the card can render
// without a second round-trip.
exports.getNearby = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 100);
    const maxKm  = req.query.max_km ? parseFloat(req.query.max_km) : null;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      // No coords? Return a generic list — first N active branches.
      const r = await pool.query(
        `SELECT b.id, b.institution_id, b.name, b.address_line, b.city, b.state,
                b.latitude, b.longitude, b.phone, b.is_primary, b.status,
                i.name AS institution_name, i.logo_url AS institution_logo,
                NULL::float AS distance_km
           FROM institution_branches b
           JOIN institutions i ON i.id = b.institution_id
          WHERE b.status = 'active'
          ORDER BY b.created_at DESC
          LIMIT $1`,
        [limit],
      );
      return res.json({ branches: r.rows });
    }

    const params = [lat, lng];
    let where = `b.status = 'active' AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL`;
    if (maxKm != null && !Number.isNaN(maxKm)) {
      params.push(maxKm);
      where += ` AND (
        6371 * acos(
          cos(radians($1)) * cos(radians(b.latitude))
          * cos(radians(b.longitude) - radians($2))
          + sin(radians($1)) * sin(radians(b.latitude))
        )
      ) <= $${params.length}`;
    }
    params.push(limit);

    const r = await pool.query(
      `SELECT b.id, b.institution_id, b.name, b.address_line, b.city, b.state,
              b.latitude, b.longitude, b.phone, b.is_primary, b.status,
              i.name AS institution_name, i.logo_url AS institution_logo,
              (
                6371 * acos(
                  cos(radians($1)) * cos(radians(b.latitude))
                  * cos(radians(b.longitude) - radians($2))
                  + sin(radians($1)) * sin(radians(b.latitude))
                )
              ) AS distance_km
         FROM institution_branches b
         JOIN institutions i ON i.id = b.institution_id
        WHERE ${where}
        ORDER BY distance_km ASC
        LIMIT $${params.length}`,
      params,
    );
    res.json({ branches: r.rows });
  } catch (err) {
    console.error('Branch nearby error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/branches — admin creates a branch.
exports.create = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });

    // Cap check — same shape as trainer + student gates.
    const overLimit = await ensureCapacity(institutionId, 'branches');
    if (overLimit) return res.status(402).json(limitResponse('branches', overLimit));

    const {
      name, address_line, city, state, pin_code, country,
      phone, email, latitude, longitude, is_primary, status, notes,
    } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Branch name is required' });
    }

    // If the caller marks this branch primary, clear any other primary
    // for the same institution so we don't end up with two flagged.
    if (is_primary === true) {
      await pool.query(
        `UPDATE institution_branches SET is_primary = false WHERE institution_id = $1`,
        [institutionId],
      );
    }

    const r = await pool.query(
      `INSERT INTO institution_branches
         (institution_id, name, address_line, city, state, pin_code, country,
          phone, email, latitude, longitude, is_primary, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'India'),
               $8, $9, $10, $11, COALESCE($12, false), COALESCE($13, 'active'), $14)
       RETURNING *`,
      [institutionId, String(name).trim(), address_line || null,
       city || null, state || null, pin_code || null, country || null,
       phone || null, email || null,
       latitude == null ? null : Number(latitude),
       longitude == null ? null : Number(longitude),
       is_primary === true,
       status || 'active',
       notes || null],
    );
    res.status(201).json({ branch: r.rows[0] });
  } catch (err) {
    console.error('Branch create error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/branches/:id — admin updates own branch.
exports.update = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });

    const existing = await pool.query(
      `SELECT institution_id FROM institution_branches WHERE id = $1`,
      [req.params.id],
    );
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Branch not found' });
    if (existing.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Not your branch' });
    }

    const {
      name, address_line, city, state, pin_code, country,
      phone, email, latitude, longitude, is_primary, status, notes,
    } = req.body || {};

    if (is_primary === true) {
      // Demote any other branch currently marked primary.
      await pool.query(
        `UPDATE institution_branches
            SET is_primary = false
          WHERE institution_id = $1 AND id <> $2`,
        [institutionId, req.params.id],
      );
    }

    const r = await pool.query(
      `UPDATE institution_branches
          SET name         = COALESCE($1, name),
              address_line = $2,
              city         = $3,
              state        = $4,
              pin_code     = $5,
              country      = COALESCE($6, country),
              phone        = $7,
              email        = $8,
              latitude     = $9,
              longitude    = $10,
              is_primary   = COALESCE($11, is_primary),
              status       = COALESCE($12, status),
              notes        = $13,
              updated_at   = NOW()
        WHERE id = $14
        RETURNING *`,
      [name ? String(name).trim() : null,
       address_line || null, city || null, state || null, pin_code || null,
       country || null, phone || null, email || null,
       latitude == null ? null : Number(latitude),
       longitude == null ? null : Number(longitude),
       typeof is_primary === 'boolean' ? is_primary : null,
       status || null, notes || null,
       req.params.id],
    );
    res.json({ branch: r.rows[0] });
  } catch (err) {
    console.error('Branch update error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/branches/:id — admin removes own branch.
exports.remove = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });
    const existing = await pool.query(
      `SELECT institution_id FROM institution_branches WHERE id = $1`,
      [req.params.id],
    );
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Branch not found' });
    if (existing.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Not your branch' });
    }
    await pool.query(`DELETE FROM institution_branches WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Branch delete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
