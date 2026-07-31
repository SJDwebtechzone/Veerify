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
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');
const { geocodeAddress } = require('../utils/geocoder');
const { insertNotification } = require('./notification.controller');
const { sendBranchSetupEmail } = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
// WhatsApp for branch admin credentials — same helper the trainer
// path uses. Optional; degrades silently when Meta env isn't set.
let sendBranchWhatsApp = null;
try {
  const { sendTrainerCredentialsMessage } = require('../services/whatsapp.service');
  sendBranchWhatsApp = sendTrainerCredentialsMessage;
} catch (_) {}

function makeTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

// ── Super-admin notify helper ─────────────────────────────────────────
// Fired after a successful branch create or update so the admin web bell
// surfaces "Institution X added / updated branch Y". Best-effort: any
// DB blip is logged but must not fail the underlying write.
async function notifySuperAdminsOfBranchChange({
  institutionId, branchRow, changedFields, action, actorUserId,
}) {
  try {
    const instRow = await pool.query(
      `SELECT name FROM institutions WHERE id = $1`, [institutionId],
    );
    const instName = instRow.rows[0]?.name || 'An institution';
    const humanFields = (changedFields && changedFields.length)
      ? changedFields.map(niceBranchLabel).join(', ')
      : null;
    const supers = await pool.query(
      `SELECT id FROM users
        WHERE role = 'super_admin'
          AND COALESCE(is_deleted, false) = false`,
    );
    const title   = action === 'added' ? 'Branch added' : 'Branch updated';
    const message = action === 'added'
      ? `${instName} added a new branch: ${branchRow.name}.`
      : `${instName} updated branch ${branchRow.name}${humanFields ? ` (${humanFields})` : ''}.`;

    // Ground-truth values for the changed fields — web admin uses this
    // when the /onboarding/:id fetch is transiently stale. Only for
    // updates (add carries the whole new row's data implicitly).
    const changedValues = {};
    if (action === 'updated' && Array.isArray(changedFields)) {
      for (const k of changedFields) {
        const v = branchRow[k];
        if (typeof v === 'string' && v.length > 300) continue;
        changedValues[k] = v == null ? null : v;
      }
    }
    for (const s of supers.rows) {
      await insertNotification({
        user_id:        s.id,
        institution_id: institutionId,
        category:       'system',
        title,
        message,
        data: {
          kind:             action === 'added' ? 'branch_added' : 'branch_updated',
          institution_id:   institutionId,
          institution_name: instName,
          branch_id:        branchRow.id,
          branch_name:      branchRow.name,
          changed_fields:   changedFields || [],
          changed_values:   changedValues,
          updated_at:       new Date().toISOString(),
        },
        created_by: actorUserId,
      });
    }
  } catch (err) {
    console.warn('[branch] super-admin notify failed:', err?.message);
  }
}

function niceBranchLabel(key) {
  const LABELS = {
    name: 'Name', address_line: 'Address', city: 'City', state: 'State',
    pin_code: 'Pincode', country: 'Country', phone: 'Phone', email: 'Email',
    latitude: 'Latitude', longitude: 'Longitude',
    is_primary: 'Primary flag', status: 'Status', notes: 'Notes',
  };
  return LABELS[key] || key;
}

async function getAdminInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

// Resolve the caller's home institution up to the ROOT (main branch).
// If the caller is a sub-branch admin, `users.institution_id` points at
// the sub-branch row; the actual `institution_branches` satellites are
// owned by the parent. Every branch CRUD path here scopes on this root
// so the sub-branch admin sees the same list the main admin sees, and
// nothing from any other academy leaks in.
async function getAdminRootInstitutionId(userId) {
  const homeId = await getAdminInstitutionId(userId);
  if (!homeId) return null;
  const r = await pool.query(
    `SELECT COALESCE(parent_institution_id, id) AS root_id
       FROM institutions WHERE id = $1`,
    [homeId],
  );
  return r.rows[0]?.root_id || homeId;
}

// GET /api/branches/accessible
//
// Returns every institution that belongs to the SAME main-branch group as
// the caller's home institution. The "group" is the main branch + every
// sub-branch with parent_institution_id pointing to it. Used by the
// trainer mobile's Students-tab branch picker to switch context.
//
// Response: { branches: [{ id, name, is_main, is_home, address, city }] }
// (ordered with main branch first, then sub-branches by created_at).
// GET /api/branches/institution/:id
//
// Super-admin lookup: returns both sub-branch institutions and
// satellite locations linked to the given institution id, keyed for
// the InstitutionDetail Branches section on the web admin panel.
// Same shape the mobile /branches endpoint uses so the UI can share
// its card renderer.
exports.listByInstitutionId = async (req, res) => {
  try {
    const institutionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(institutionId)) {
      return res.status(400).json({ message: 'Invalid institution id' });
    }
    const [subBranches, satellites, wizardBranches] = await Promise.all([
      pool.query(
        `SELECT id,
                $1::int         AS institution_id,
                name,
                address         AS address_line,
                city,
                NULL::text      AS state,
                pincode         AS pin_code,
                phone,
                email,
                latitude,
                longitude,
                FALSE           AS is_primary,
                CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
                created_at,
                'sub_branch'    AS branch_kind,
                parent_institution_id,
                credentials_sent,
                onboarding_status
           FROM institutions
          WHERE parent_institution_id = $1
            AND deleted_at IS NULL
          ORDER BY created_at ASC`,
        [institutionId],
      ),
      pool.query(
        `SELECT id, institution_id, name, address_line, city, state, pin_code,
                phone, email, latitude, longitude,
                is_primary, status, created_at,
                'satellite' AS branch_kind,
                institution_id AS parent_institution_id
           FROM institution_branches
          WHERE institution_id = $1
          ORDER BY is_primary DESC, created_at ASC`,
        [institutionId],
      ),
      // Wizard branches — the setup form stores the branch repeater
      // as institutions.branches (JSONB). Rows that carried an email
      // got promoted to full sub-branch institutions during
      // setupAcademy; rows without an email STAYED in the JSONB and
      // never landed anywhere else, so a super admin browsing the
      // detail page saw an empty list even though the mobile Branches
      // screen showed the wizard rows. Surface them here too so both
      // audiences see the same set.
      pool.query(
        `SELECT branches
           FROM institutions
          WHERE id = $1`,
        [institutionId],
      ),
    ]);

    // Flatten every source into the same shape the mobile card
    // renderer expects. Dedup by lower-cased (name+city) so the
    // sub-branch institutions row and its mirrored institution_branches
    // satellite (both written on every create) render once, and any
    // wizard entry that was later promoted doesn't appear twice
    // either. Sub-branch wins — its id is the canonical institutions.id
    // that downstream navigation depends on.
    const seen = new Set();
    const keyFor = (b) => `${(b.name || '').trim().toLowerCase()}|${(b.city || '').trim().toLowerCase()}`;
    const branches = [];
    subBranches.rows.forEach((b) => {
      const k = keyFor(b);
      if (seen.has(k)) return;
      seen.add(k);
      branches.push(b);
    });
    satellites.rows.forEach((b) => {
      const k = keyFor(b);
      if (seen.has(k)) return;
      seen.add(k);
      branches.push(b);
    });

    const rawJson = wizardBranches.rows[0]?.branches;
    // JSONB comes through as a JS array already; guard for legacy
    // TEXT-stored payloads and null / non-array shapes.
    let wizardArr = [];
    if (Array.isArray(rawJson)) wizardArr = rawJson;
    else if (typeof rawJson === 'string') {
      try { const parsed = JSON.parse(rawJson); if (Array.isArray(parsed)) wizardArr = parsed; } catch (_) {}
    }
    wizardArr.forEach((b, idx) => {
      if (!b || typeof b !== 'object') return;
      const flat = {
        id:                     `wiz-${institutionId}-${idx}`, // synthetic id (string so it can't clash with numeric row ids)
        institution_id:         institutionId,
        name:                   (b.name || '').toString().trim() || 'Branch',
        address_line:           (b.address || b.address_line || '').toString().trim() || null,
        city:                   (b.city || '').toString().trim() || null,
        state:                  b.state || null,
        pin_code:               (b.pincode || b.pin_code || '').toString().trim() || null,
        phone:                  (b.contact_number || b.phone || '').toString().trim() || null,
        email:                  (b.email || '').toString().trim() || null,
        latitude:               b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null,
        longitude:              b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null,
        is_primary:             false,
        status:                 'active',
        created_at:             null,
        branch_kind:            'wizard',
        parent_institution_id:  institutionId,
        credentials_sent:       false,
        onboarding_status:      'pending_activation',
      };
      if (seen.has(keyFor(flat))) return;
      seen.add(keyFor(flat));
      branches.push(flat);
    });

    return res.json({
      count:          branches.length,
      institution_id: institutionId,
      branches,
    });
  } catch (err) {
    console.error('listByInstitutionId error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.listAccessibleBranches = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRes = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [userId],
    );
    const homeId = userRes.rows[0]?.institution_id;
    if (!homeId) {
      return res.status(400).json({ message: 'No institution linked to this user.' });
    }

    // Find the main branch (root) for the caller's group.
    const homeRow = await pool.query(
      `SELECT id, parent_institution_id FROM institutions WHERE id = $1`,
      [homeId],
    );
    if (homeRow.rows.length === 0) {
      return res.status(404).json({ message: 'Home institution not found.' });
    }
    const rootId = homeRow.rows[0].parent_institution_id || homeRow.rows[0].id;

    // Pull main + all sub-branches in one query.
    const result = await pool.query(
      `SELECT i.id, i.name, i.address, i.city, i.pincode,
              (i.parent_institution_id IS NULL) AS is_main
         FROM institutions i
        WHERE (i.id = $1 OR i.parent_institution_id = $1)
          AND COALESCE(i.deleted_at::text, '') = ''
        ORDER BY i.parent_institution_id NULLS FIRST, i.created_at`,
      [rootId],
    );

    const branches = result.rows.map((r) => ({
      ...r,
      is_home: r.id === homeId,
    }));

    res.json({ count: branches.length, branches, home_institution_id: homeId });
  } catch (err) {
    console.error('listAccessibleBranches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/branches — admin lists branches for their own academy.
//
// A "branch" in this app is one of two things, and the mobile More →
// Branches screen surfaces BOTH so the admin's mental model matches:
//
//   1. Sub-branch institutions — rows in `institutions` with
//      parent_institution_id set. These are what the setup wizard
//      creates when the admin adds a branch during onboarding: each
//      one gets its own login credentials, its own students/trainers,
//      and appears nested under the parent in the super admin's
//      dashboard.
//
//   2. Satellite locations — rows in `institution_branches`. These
//      are extra physical addresses (map pins) an admin can add for
//      the student-side "Nearby Academies" search. Not standalone
//      academies, just additional addresses of one academy.
//
// Both scope on the caller's ROOT institution id so a sub-branch admin
// sees the whole group's roster. Nothing from another academy leaks in.
exports.listMine = async (req, res) => {
  try {
    const rootId = await getAdminRootInstitutionId(req.user.id);
    if (!rootId) return res.status(400).json({ message: 'No institution linked' });

    // Run both reads in parallel — no dependency between them.
    const [subBranches, satellites] = await Promise.all([
      // Wizard-created child institutions. Field aliases normalise the
      // shape to whatever institution_branches emits so the mobile card
      // can render either kind without a special case.
      pool.query(
        `SELECT id,
                $1::int         AS institution_id,
                name,
                address         AS address_line,
                city,
                NULL::text      AS state,
                pincode         AS pin_code,
                phone,
                email,
                latitude,
                longitude,
                FALSE           AS is_primary,
                CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
                created_at,
                'sub_branch'    AS branch_kind,
                credentials_sent,
                onboarding_status
           FROM institutions
          WHERE parent_institution_id = $1
            AND deleted_at IS NULL
          ORDER BY created_at ASC`,
        [rootId],
      ),
      pool.query(
        `SELECT id, institution_id, name, address_line, city, state, pin_code,
                phone, email, latitude, longitude,
                is_primary, status, created_at,
                'satellite' AS branch_kind
           FROM institution_branches
          WHERE institution_id = $1
          ORDER BY is_primary DESC, created_at ASC`,
        [rootId],
      ),
    ]);

    // Sub-branches first (they carry real login credentials), then
    // satellite locations. Primary is preserved within each group.
    //
    // Dedup: every /branches POST now writes BOTH a sub-branch
    // institutions row AND a mirrored institution_branches row so
    // the location renderer + Nearby search keep working. We match
    // by lower-cased (name+city) so the same physical branch only
    // shows up once — the sub-branch row wins because it carries the
    // canonical institution id downstream navigation depends on.
    const seenKey = new Set();
    const keyFor = (b) => `${(b.name || '').trim().toLowerCase()}|${(b.city || '').trim().toLowerCase()}`;
    const branches = [];
    subBranches.rows.forEach((b) => { seenKey.add(keyFor(b)); branches.push(b); });
    satellites.rows.forEach((b) => {
      if (seenKey.has(keyFor(b))) return;
      seenKey.add(keyFor(b));
      branches.push(b);
    });
    res.json({
      count: branches.length,
      branches,
      institution_id: rootId,
    });
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
//
// Branches belong to the root (parent) institution. If a sub-branch
// admin creates one, we still attach it under the root so the whole
// group sees it in the same list.
exports.create = async (req, res) => {
  try {
    const institutionId = await getAdminRootInstitutionId(req.user.id);
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

    // ── Auto-geocode ───────────────────────────────────────────────
    // The admin fills in branch info from their office without
    // visiting each location. If they didn't supply lat/lng we
    // resolve them from the pincode (most accurate) or from the full
    // typed address (when the pincode isn't available). The resulting
    // coords are what the student-side nearby search needs.
    let latNum = latitude == null ? null : Number(latitude);
    let lngNum = longitude == null ? null : Number(longitude);
    if ((latNum == null || Number.isNaN(latNum) || lngNum == null || Number.isNaN(lngNum))
        && (pin_code || city || address_line)) {
      try {
        const resolved = await geocodeAddress({
          address_line, city, state, pincode: pin_code, country,
        });
        if (resolved) {
          latNum = resolved.latitude;
          lngNum = resolved.longitude;
        }
      } catch (e) {
        // Geocoding is best-effort; we still create the branch even if
        // it fails. Admin can edit later to retry / supply manually.
        console.warn('[branch/create] geocode failed:', e?.message);
      }
    }

    // If the caller marks this branch primary, clear any other primary
    // for the same institution so we don't end up with two flagged.
    if (is_primary === true) {
      await pool.query(
        `UPDATE institution_branches SET is_primary = false WHERE institution_id = $1`,
        [institutionId],
      );
    }

    // ── Create the branch as a full sub-branch INSTITUTION row ──
    // Per the spec, branches must be linked to the parent via
    // parent_institution_id so that:
    //   • the branch has its own institutions.id (used everywhere the
    //     Super Admin / mobile navigates by institution id — clicking
    //     a branch card no longer hits a 404 details endpoint),
    //   • the plan / subscription lifecycle is inherited from the
    //     parent (branch admins with credentials can log in and land
    //     directly on the Branch Dashboard),
    //   • listByInstitutionId picks it up from its first (institutions)
    //     query without needing the satellite table.
    // We ALSO write the location details into institution_branches
    // so the existing "Nearby academies" search + satellite renderer
    // keep working without a data migration.
    const client = await pool.connect();
    let subBranchRow = null;
    let satelliteRow = null;
    try {
      await client.query('BEGIN');

      // Mirror lifecycle + plan fields from the parent so the child
      // is functionally ready the moment the parent is. `onboarding_status`
      // = 'active' when the parent is already active/approved, else
      // the parent's own status — this keeps a branch created during
      // the trial from unlocking before the parent is approved.
      const parentRes = await client.query(
        `SELECT plan_id, onboarding_status, paid_at,
                trial_starts_at, trial_ends_at, grace_ends_at,
                subscription_start, subscription_end, subscription_status
           FROM institutions WHERE id = $1`,
        [institutionId],
      );
      const parent = parentRes.rows[0] || {};
      const inheritedStatus =
        parent.onboarding_status === 'active' || parent.onboarding_status === 'approved'
          ? 'active'
          : (parent.onboarding_status || 'active');

      const subIns = await client.query(
        `INSERT INTO institutions
           (name, brand_name, address, city, pincode, phone, email,
            latitude, longitude,
            parent_institution_id, plan_id,
            onboarding_status, status, is_active, credentials_sent,
            paid_at, trial_starts_at, trial_ends_at, grace_ends_at,
            subscription_start, subscription_end, subscription_status)
         VALUES ($1, $1, $2, $3, $4, $5, $6,
                 $7, $8,
                 $9, $10,
                 'pending_activation', 'pending', FALSE, FALSE,
                 $11, $12, $13, $14,
                 $15, $16, $17)
         RETURNING *`,
        [
          String(name).trim(),
          address_line || null,
          city || null,
          pin_code || null,
          phone || null,
          email || null,
          latNum, lngNum,
          institutionId,
          parent.plan_id || null,
          parent.paid_at || null,
          parent.trial_starts_at || null,
          parent.trial_ends_at || null,
          parent.grace_ends_at || null,
          parent.subscription_start || null,
          parent.subscription_end || null,
          parent.subscription_status || 'active',
        ],
      );
      subBranchRow = subIns.rows[0];
      if (!subBranchRow || !subBranchRow.id) {
        throw new Error('Branch institution insert returned no row');
      }

      // Satellite row too, for the location renderer + Nearby search.
      // It's a lightweight write; a failure here rolls back the sub-
      // branch insert so a partial state can't happen.
      const satIns = await client.query(
        `INSERT INTO institution_branches
           (institution_id, name, address_line, city, state, pin_code, country,
            phone, email, latitude, longitude, is_primary, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'India'),
                 $8, $9, $10, $11, COALESCE($12, false), COALESCE($13, 'active'), $14)
         RETURNING *`,
        [institutionId, String(name).trim(), address_line || null,
         city || null, state || null, pin_code || null, country || null,
         phone || null, email || null,
         latNum, lngNum,
         is_primary === true,
         status || 'active',
         notes || null],
      );
      satelliteRow = satIns.rows[0];

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[branch/create] transaction rolled back:', txErr?.message);
      client.release();
      // Spec: "If branch creation partially fails, return a proper
      // error instead of showing a success notification." Neither the
      // sub-branch nor the satellite row exists at this point.
      return res.status(500).json({
        message: 'Branch was not saved. Please try again.',
      });
    }
    client.release();

    // Fire-and-forget super-admin ping. Pass the sub-branch
    // INSTITUTION row so the notification's data.branch_id resolves
    // to the child institutions.id — which is what the Web Admin's
    // notification bell tap uses to navigate to /institutions/:id.
    // Previously we passed the satellite row here and the id
    // collided with an unrelated institution's id sequence, so the
    // deep link opened the wrong academy and its Branches section
    // rendered "No linked branches yet."
    notifySuperAdminsOfBranchChange({
      institutionId,
      branchRow: subBranchRow,
      changedFields: null,      // "added" doesn't need a diff
      action:        'added',
      actorUserId:   req.user.id,
    });

    // Response carries BOTH ids so the mobile client can navigate to
    // the sub-branch's own institutions row without another lookup
    // (fixes the "Institution not found" 404 on the details screen).
    res.status(201).json({
      branch: {
        // Satellite fields for the location renderer.
        ...(satelliteRow || {}),
        // Full sub-branch institution row for anything that navigates
        // by institution id.
        institution:            subBranchRow,
        institution_id:         subBranchRow.id,
        parent_institution_id:  institutionId,
        branch_kind:            'sub_branch',
      },
    });
  } catch (err) {
    console.error('Branch create error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/branches/:id — admin updates own branch.
exports.update = async (req, res) => {
  try {
    const institutionId = await getAdminRootInstitutionId(req.user.id);
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });

    // Load the full row so we can diff against it for the notification.
    const existing = await pool.query(
      `SELECT * FROM institution_branches WHERE id = $1`,
      [req.params.id],
    );
    if (existing.rows.length === 0) return res.status(404).json({ message: 'Branch not found' });
    if (existing.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Not your branch' });
    }
    const before = existing.rows[0];

    const {
      name, address_line, city, state, pin_code, country,
      phone, email, latitude, longitude, is_primary, status, notes,
    } = req.body || {};

    // Auto-geocode on update too — handles the common case where the
    // admin edits the pincode / city of an existing branch and we need
    // to refresh its lat/lng to match the new location.
    let latNum = latitude == null ? null : Number(latitude);
    let lngNum = longitude == null ? null : Number(longitude);
    if ((latNum == null || Number.isNaN(latNum) || lngNum == null || Number.isNaN(lngNum))
        && (pin_code || city || address_line)) {
      try {
        const resolved = await geocodeAddress({
          address_line, city, state, pincode: pin_code, country,
        });
        if (resolved) {
          latNum = resolved.latitude;
          lngNum = resolved.longitude;
        }
      } catch (e) {
        console.warn('[branch/update] geocode failed:', e?.message);
      }
    }

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
       latNum, lngNum,
       typeof is_primary === 'boolean' ? is_primary : null,
       status || null, notes || null,
       req.params.id],
    );
    const after = r.rows[0];

    // Diff — only fields whose value actually differs. Keeps the
    // super-admin notification message truthful ("nothing changed"
    // updates get an empty list; caller can decide to skip the ping).
    const DIFFABLE = [
      'name', 'address_line', 'city', 'state', 'pin_code', 'country',
      'phone', 'email', 'latitude', 'longitude',
      'is_primary', 'status', 'notes',
    ];
    const changed = DIFFABLE.filter((k) => {
      const b = before[k]; const a = after[k];
      return JSON.stringify(b == null ? null : b) !== JSON.stringify(a == null ? null : a);
    });
    if (changed.length > 0) {
      notifySuperAdminsOfBranchChange({
        institutionId,
        branchRow:     after,
        changedFields: changed,
        action:        'updated',
        actorUserId:   req.user.id,
      });
    }

    res.json({ branch: after, changed_fields: changed });
  } catch (err) {
    console.error('Branch update error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/branches/:id — admin removes own branch.
//
// Since every create now writes BOTH a sub-branch institutions row
// AND a mirrored institution_branches satellite, delete has to clean
// up both — otherwise the Web Admin's Linked Branches section keeps
// showing the sub-branch even after the mobile listing removes it.
//
// The `:id` we receive can be either:
//   • institution_branches.id   (older mobile builds sending the
//     satellite id, or a wizard-only entry that was never promoted)
//   • institutions.id           (current mobile builds — listMine
//     deduplicates by name+city and the sub-branch row wins)
//
// Look the branch up both ways, verify it belongs to the caller's
// root institution, then remove the paired rows in a transaction.
exports.remove = async (req, res) => {
  const client = await pool.connect();
  try {
    const rootId = await getAdminRootInstitutionId(req.user.id);
    if (!rootId) return res.status(400).json({ message: 'No institution linked' });
    const idParam = parseInt(req.params.id, 10);
    if (!Number.isFinite(idParam)) {
      return res.status(400).json({ message: 'Invalid branch id' });
    }

    // 1. Try as a satellite row.
    let name = null;
    let city = null;
    let subBranchId = null;
    let satelliteId = null;

    const asSatellite = await pool.query(
      `SELECT id, institution_id, name, city
         FROM institution_branches WHERE id = $1`,
      [idParam],
    );
    if (asSatellite.rows.length > 0) {
      const row = asSatellite.rows[0];
      if (row.institution_id !== rootId) {
        return res.status(403).json({ message: 'Not your branch' });
      }
      satelliteId = row.id;
      name = row.name;
      city = row.city;
    } else {
      // 2. Try as a sub-branch institutions row.
      const asSub = await pool.query(
        `SELECT id, name, city, parent_institution_id
           FROM institutions
          WHERE id = $1 AND deleted_at IS NULL`,
        [idParam],
      );
      if (asSub.rows.length === 0) {
        return res.status(404).json({ message: 'Branch not found' });
      }
      const row = asSub.rows[0];
      if (row.parent_institution_id !== rootId) {
        return res.status(403).json({ message: 'Not your branch' });
      }
      subBranchId = row.id;
      name = row.name;
      city = row.city;
    }

    // 3. Find the paired row (satellite ↔ sub-branch) by name+city
    //    under the same root, so a delete initiated from either side
    //    cleans up both. Case- and whitespace-insensitive match.
    const key = (v) => (v || '').toString().trim().toLowerCase();
    const nameKey = key(name);
    const cityKey = key(city);

    if (subBranchId == null) {
      const paired = await pool.query(
        `SELECT id FROM institutions
          WHERE parent_institution_id = $1
            AND deleted_at IS NULL
            AND LOWER(TRIM(COALESCE(name, ''))) = $2
            AND LOWER(TRIM(COALESCE(city, ''))) = $3
          LIMIT 1`,
        [rootId, nameKey, cityKey],
      );
      subBranchId = paired.rows[0]?.id || null;
    }
    if (satelliteId == null) {
      const paired = await pool.query(
        `SELECT id FROM institution_branches
          WHERE institution_id = $1
            AND LOWER(TRIM(COALESCE(name, ''))) = $2
            AND LOWER(TRIM(COALESCE(city, ''))) = $3
          LIMIT 1`,
        [rootId, nameKey, cityKey],
      );
      satelliteId = paired.rows[0]?.id || null;
    }

    // 4. Remove both. Sub-branch is soft-deleted (deleted_at) so
    //    listMine's `deleted_at IS NULL` filter and every downstream
    //    scope check drop it. Satellite is hard-deleted.
    await client.query('BEGIN');
    if (subBranchId != null) {
      await client.query(
        `UPDATE institutions SET deleted_at = NOW() WHERE id = $1`,
        [subBranchId],
      );
    }
    if (satelliteId != null) {
      await client.query(
        `DELETE FROM institution_branches WHERE id = $1`,
        [satelliteId],
      );
    }
    await client.query('COMMIT');

    return res.json({
      ok: true,
      removed: {
        sub_branch_institution_id: subBranchId,
        satellite_id:              satelliteId,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Branch delete error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// GET /api/branches/:id/dashboard
//
// Read-only Branch Dashboard for the parent-institution admin. Given a
// sub-branch's id (institutions.id whose parent_institution_id = the
// caller's root), returns aggregated live numbers scoped strictly to
// that branch's batches (batches.branch_id = :id):
//
//   • Students  — total, active (any paid enrolment), inactive.
//   • Revenue   — total-ever + range (?from=YYYY-MM-DD&to=YYYY-MM-DD),
//                 series of last 6 months for the trend chart.
//   • Attendance — today's present/absent/late/leave counts, monthly
//                 percentage, and a plain (present, total) roll-up
//                 covering an optional ?month=YYYY-MM window (defaults
//                 to the current calendar month).
//
// All data comes from existing enrollments / attendance rows — no
// duplication. Safe for main admin to poll; sub-branch admins can also
// call it for their own branch id (they'd just be re-reading their own
// data from a different lens).
exports.getBranchDashboard = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    if (!Number.isInteger(branchId)) {
      return res.status(400).json({ message: 'Invalid branch id' });
    }

    // Auth — caller must be part of the same academy tree. Reuse the
    // helper other endpoints use for the "root institution" of the
    // caller. Then confirm the branch is either the caller's root
    // itself OR a child of it.
    const rootId = await getAdminRootInstitutionId(req.user.id);
    if (!rootId) return res.status(400).json({ message: 'No institution linked' });

    const instRes = await pool.query(
      `SELECT id, name, parent_institution_id, city, deleted_at
         FROM institutions
        WHERE id = $1`,
      [branchId],
    );
    if (instRes.rows.length === 0 || instRes.rows[0].deleted_at) {
      return res.status(404).json({ message: 'Branch not found' });
    }
    const branch = instRes.rows[0];
    if (branch.id !== rootId && branch.parent_institution_id !== rootId) {
      return res.status(403).json({ message: 'Not your branch' });
    }

    // ── Date-range filters ────────────────────────────────────────
    // Revenue supports ?from + ?to. Attendance supports ?month=YYYY-MM
    // (falls back to the current calendar month if omitted / invalid).
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isDate(req.query.from) ? req.query.from : null;
    const to   = isDate(req.query.to)   ? req.query.to   : null;
    const monthRaw = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? `${req.query.month}-01` : null;
    // Compute month bounds in JS to keep the SQL simple (Postgres
    // interval math handles the rest).
    const monthStart = monthRaw || (() => {
      const d = new Date(); d.setUTCDate(1);
      return d.toISOString().slice(0, 10);
    })();

    // ── Filter fragment for enrolments / attendance scoped to this
    //    branch's batches. batches.branch_id = branchId picks up
    //    every batch pinned to the sub-branch.
    const branchBatchFragment = `
      (b.branch_id = $1
       OR (b.branch_id IS NULL AND b.institution_id = $1))
    `;

    // ── Students: total, active (any paid enrolment counts as active),
    //    inactive (paid_count = 0 among their branch enrolments).
    const studentAggRes = await pool.query(
      `WITH branch_enrol AS (
         SELECT e.student_id,
                MAX(CASE WHEN e.payment_status = 'paid' THEN 1 ELSE 0 END) AS has_paid
           FROM enrollments e
           JOIN batches b ON b.id = e.batch_id
           JOIN users   u ON u.id = e.student_id
          WHERE ${branchBatchFragment}
            AND COALESCE(u.is_deleted, false) = false
          GROUP BY e.student_id
       )
       SELECT
         COUNT(*)::int                                              AS total,
         COALESCE(SUM(has_paid), 0)::int                            AS active,
         (COUNT(*) - COALESCE(SUM(has_paid), 0))::int               AS inactive
       FROM branch_enrol`,
      [branchId],
    );

    // ── Revenue: total-ever + ranged (?from / ?to) + last-6-months series.
    const [revTotalRes, revRangeRes, revSeriesRes] = await Promise.all([
      // Total ever (all paid enrolments in this branch).
      pool.query(
        `SELECT COALESCE(SUM(e.payment_amount), 0)::numeric AS total,
                COUNT(*) FILTER (WHERE e.payment_status = 'paid')::int AS paid_count
           FROM enrollments e
           JOIN batches b ON b.id = e.batch_id
          WHERE ${branchBatchFragment}
            AND e.payment_status = 'paid'`,
        [branchId],
      ),
      // Ranged (defaults to current month when from/to omitted).
      pool.query(
        `SELECT COALESCE(SUM(e.payment_amount), 0)::numeric AS total,
                COUNT(*)::int AS paid_count
           FROM enrollments e
           JOIN batches b ON b.id = e.batch_id
          WHERE ${branchBatchFragment}
            AND e.payment_status = 'paid'
            AND COALESCE(e.paid_at, e.enrolled_at) >= COALESCE($2::date, date_trunc('month', NOW()))
            AND COALESCE(e.paid_at, e.enrolled_at) <  COALESCE($3::date + INTERVAL '1 day', date_trunc('month', NOW()) + INTERVAL '1 month')`,
        [branchId, from, to],
      ),
      // Last 6 months trend.
      pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', NOW()) - INTERVAL '5 months',
             date_trunc('month', NOW()),
             INTERVAL '1 month'
           ) AS m
         )
         SELECT
           to_char(m.m, 'Mon') AS label,
           m.m                 AS month_start,
           COALESCE(SUM(e.payment_amount), 0)::numeric AS total
         FROM months m
         LEFT JOIN enrollments e
           ON e.payment_status = 'paid'
           AND COALESCE(e.paid_at, e.enrolled_at) >= m.m
           AND COALESCE(e.paid_at, e.enrolled_at) <  m.m + INTERVAL '1 month'
           AND EXISTS (
             SELECT 1 FROM batches b
              WHERE b.id = e.batch_id AND ${branchBatchFragment.replace('$1', '$1')}
           )
         GROUP BY m.m
         ORDER BY m.m`,
        [branchId],
      ),
    ]);

    // ── Attendance:
    //    • today  → counts by status
    //    • month  → present / total for the current or selected month,
    //               plus percentage.
    const [todayRes, monthRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
           COUNT(*) FILTER (WHERE a.status = 'late')::int    AS late,
           COUNT(*)::int                                      AS total
         FROM attendance a
         JOIN batches b ON b.id = a.batch_id
        WHERE ${branchBatchFragment}
          AND a.date = CURRENT_DATE`,
        [branchId],
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
           COUNT(*) FILTER (WHERE a.status = 'late')::int    AS late,
           COUNT(*)::int                                      AS total
         FROM attendance a
         JOIN batches b ON b.id = a.batch_id
        WHERE ${branchBatchFragment}
          AND a.date >= $2::date
          AND a.date <  $2::date + INTERVAL '1 month'`,
        [branchId, monthStart],
      ),
    ]);

    const monthTotals = monthRes.rows[0] || { present: 0, total: 0 };
    const monthPct = monthTotals.total > 0
      ? Math.round((monthTotals.present / monthTotals.total) * 100)
      : null;

    res.json({
      branch: {
        id:   branch.id,
        name: branch.name,
        city: branch.city,
      },
      filters: {
        revenue: { from, to },
        attendance: { month: monthStart.slice(0, 7) },
      },
      students: studentAggRes.rows[0] || { total: 0, active: 0, inactive: 0 },
      revenue: {
        total: Number(revTotalRes.rows[0]?.total || 0),
        paid_count_total: revTotalRes.rows[0]?.paid_count || 0,
        range: {
          total: Number(revRangeRes.rows[0]?.total || 0),
          paid_count: revRangeRes.rows[0]?.paid_count || 0,
        },
        series_last_6_months: revSeriesRes.rows.map((r) => ({
          label: r.label,
          total: Number(r.total) || 0,
        })),
      },
      attendance: {
        today: todayRes.rows[0] || { present: 0, absent: 0, late: 0, total: 0 },
        month: { ...monthTotals, percentage: monthPct },
      },
    });
  } catch (err) {
    console.error('Branch dashboard error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/branches/:id/send-credentials — Super Admin only.
//
// Activates a Pending Activation branch:
//   1. Provisions an owner `users` row (role='admin', institution_id
//      = the branch's own institutions.id, temp password) if one
//      doesn't already exist.
//   2. Dispatches the credentials via email (best-effort), welcome SMS
//      (best-effort), and WhatsApp (plan-gated, best-effort).
//   3. Stamps credentials_sent=TRUE, credentials_sent_at=NOW(),
//      credentials_sent_by=<caller>, and flips the row to
//      status='approved' + is_active=TRUE so the branch admin can
//      log in immediately.
//
// Idempotent-ish: calling again for an already-activated branch
// rotates the password and re-dispatches the message so ops can
// "resend credentials" if the branch admin lost them. Response
// includes `resent: true` in that case.
exports.sendBranchCredentials = async (req, res) => {
  const client = await pool.connect();
  try {
    const branchId = parseInt(req.params.id, 10);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ message: 'Invalid branch id' });
    }
    const branchRes = await client.query(
      `SELECT i.id, i.name, i.email, i.phone, i.parent_institution_id,
              i.credentials_sent, i.owner_user_id,
              p.name AS parent_name
         FROM institutions i
         LEFT JOIN institutions p ON p.id = i.parent_institution_id
        WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [branchId],
    );
    const branch = branchRes.rows[0];
    if (!branch) return res.status(404).json({ message: 'Branch not found' });
    if (!branch.parent_institution_id) {
      return res.status(400).json({
        message: 'This is not a branch. Credentials can only be sent for branches.',
      });
    }
    if (!branch.email) {
      return res.status(400).json({
        message: 'Branch has no email on file. Add an email before sending credentials.',
      });
    }

    const tempPassword = makeTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    const alreadyActive = !!branch.credentials_sent;
    let ownerUserId = branch.owner_user_id || null;

    await client.query('BEGIN');

    if (!ownerUserId) {
      // Fresh provision — create the user.
      const uRes = await client.query(
        `INSERT INTO users (name, email, phone, password, role, institution_id,
                            status, must_change_password)
         VALUES ($1, LOWER($2), $3, $4, 'admin', $5, 'active', TRUE)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [branch.name || 'Branch admin', branch.email, branch.phone || null,
         hashed, branch.id],
      );
      if (uRes.rows.length > 0) {
        ownerUserId = uRes.rows[0].id;
      } else {
        // Email collision — reuse the existing live user.
        const existing = await client.query(
          `SELECT id FROM users
            WHERE LOWER(email) = LOWER($1)
              AND COALESCE(is_deleted, FALSE) = FALSE
            LIMIT 1`,
          [branch.email],
        );
        ownerUserId = existing.rows[0]?.id || null;
        if (ownerUserId) {
          await client.query(
            `UPDATE users SET
               password = $1, must_change_password = TRUE,
               institution_id = $2, role = 'admin', status = 'active'
             WHERE id = $3`,
            [hashed, branch.id, ownerUserId],
          );
        }
      }
    } else {
      // Already provisioned — rotate password (resend flow).
      await client.query(
        `UPDATE users SET password = $1, must_change_password = TRUE WHERE id = $2`,
        [hashed, ownerUserId],
      );
    }

    if (!ownerUserId) {
      throw new Error('Failed to resolve branch owner user');
    }

    // Link + flip status.
    await client.query(
      `UPDATE institutions SET
         owner_user_id       = COALESCE(owner_user_id, $1),
         credentials_sent    = TRUE,
         credentials_sent_at = NOW(),
         credentials_sent_by = $2,
         onboarding_status   = 'active',
         status              = 'approved',
         is_active           = TRUE
       WHERE id = $3`,
      [ownerUserId, req.user?.id || null, branch.id],
    );

    await client.query('COMMIT');

    // Fire-and-forget dispatches. Any failure logs but never fails
    // the request — the admin can re-press the button to resend.
    try {
      await sendBranchSetupEmail({
        to:              branch.email,
        institutionName: branch.parent_name || 'Veerify',
        branchName:      branch.name,
        ownerName:       null,
        loginEmail:      branch.email,
        loginPassword:   tempPassword,
      });
    } catch (e) {
      console.warn('[branch] setup email failed:', e?.message);
    }
    if (branch.phone) {
      try {
        dispatchWelcomeSms({
          phone:        branch.phone,
          name:         branch.name,
          role:         'branch',
          loginId:      branch.email,
          tempPassword,
        });
      } catch (e) {
        console.warn('[branch] welcome SMS failed:', e?.message);
      }
    }
    if (sendBranchWhatsApp && branch.phone) {
      sendBranchWhatsApp({
        userId:      ownerUserId,
        phone:       branch.phone,
        trainerName: branch.name,
        academyName: branch.parent_name || 'Veerify',
        otp:         tempPassword,
      }).catch((e) => console.warn('[branch] WhatsApp failed:', e?.message));
    }

    return res.json({
      ok:                true,
      resent:            alreadyActive,
      branch_id:         branch.id,
      owner_user_id:     ownerUserId,
      credentials_sent:  true,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('sendBranchCredentials error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
