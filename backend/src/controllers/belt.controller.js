const pool = require('../config/db');
const crypto = require('crypto');
const { insertNotification } = require('./notification.controller');
// Branch-scope + admin-can-see-student check. Ensures a main admin
// can't view a sub-branch student's belt journey and vice versa.
const { getBranchScope, adminCanSeeStudent } = require('../utils/branchScope');

// ─────────────────────────────────────────────────────────────────────────────
// Belt Badges & Certifications
// ─────────────────────────────────────────────────────────────────────────────
// belt_levels — per-institution belt sequence. We auto-seed 7 defaults the
//               first time anyone asks for an institution's belts.
// student_belt_promotions — audit log of every belt a student has earned.
// certificates — generic table for belt/tournament/etc. Belt promos auto-
//                emit a 'belt' certificate inside the same transaction.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BELTS = [
  { name: 'White Belt',  color: '#FFFFFF', emoji: '⚪', sort_order: 1 },
  { name: 'Yellow Belt', color: '#FACC15', emoji: '🟡', sort_order: 2 },
  { name: 'Orange Belt', color: '#F97316', emoji: '🟠', sort_order: 3 },
  { name: 'Green Belt',  color: '#22C55E', emoji: '🟢', sort_order: 4 },
  { name: 'Blue Belt',   color: '#3B82F6', emoji: '🔵', sort_order: 5 },
  { name: 'Brown Belt',  color: '#92400E', emoji: '🟤', sort_order: 6 },
  { name: 'Black Belt',  color: '#111111', emoji: '⚫', sort_order: 7 },
];

// Helpers ───────────────────────────────────────────────────────────────────
async function getCallerInstitution(userId) {
  const u = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`, [userId],
  );
  return u.rows[0]?.institution_id || null;
}

async function ensureSeeded(institutionId, client = pool) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM belt_levels WHERE institution_id = $1`,
    [institutionId],
  );
  if (Number(r.rows[0]?.n) > 0) return;
  for (const b of DEFAULT_BELTS) {
    await client.query(
      `INSERT INTO belt_levels (institution_id, name, color_hex, emoji, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [institutionId, b.name, b.color, b.emoji, b.sort_order],
    );
  }
}

// Generate a short URL-safe token (8 chars from /A-Z2-9/) for QR / certificate
// numbering. Loops on collision until UNIQUE accepts it.
async function newToken(client) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 8; i++) {
    let t = '';
    for (let j = 0; j < 10; j++) t += chars[Math.floor(Math.random() * chars.length)];
    const r = await client.query(
      `SELECT 1 FROM certificates WHERE qr_token = $1 OR certificate_no = $1`, [t],
    );
    if (r.rows.length === 0) return t;
  }
  // Fallback to crypto.
  return crypto.randomBytes(7).toString('base64url').toUpperCase().slice(0, 10);
}

// Compute display status per belt for a given student (completed/current/locked).
function annotateBelts(belts, promotionMap) {
  // promotionMap: belt_level_id → { promoted_at, id }
  // The student's "current" belt is the one with the highest sort_order that
  // exists in their promotion log. Lower-sort-order = completed. Higher = locked.
  let currentSort = -1;
  for (const b of belts) {
    if (promotionMap.has(b.id)) {
      if (b.sort_order > currentSort) currentSort = b.sort_order;
    }
  }
  return belts.map((b) => {
    const earned = promotionMap.get(b.id);
    let status;
    if (b.sort_order === currentSort) status = 'current';
    else if (earned)                 status = 'completed';
    else                              status = 'locked';
    return {
      ...b,
      status,
      earned_at: earned?.promoted_at || null,
      promotion_id: earned?.id || null,
    };
  });
}

// ── Endpoints ──────────────────────────────────────────────────────────────

// GET /api/belts/levels — list of belts for the caller's institution.
// Auto-seeds the 7 defaults on the first read.
exports.getLevels = async (req, res) => {
  try {
    const role = req.user.role;
    let institutionId;
    if (role === 'student' || role === 'parent') {
      // For students/parents we use their linked institution_id directly.
      institutionId = await getCallerInstitution(req.user.id);
    } else {
      institutionId = await getCallerInstitution(req.user.id);
    }
    if (!institutionId) return res.json({ belts: [] });

    await ensureSeeded(institutionId);
    const r = await pool.query(
      `SELECT id, name, color_hex, emoji, sort_order, is_active
         FROM belt_levels
        WHERE institution_id = $1
        ORDER BY sort_order`,
      [institutionId],
    );
    res.json({ count: r.rows.length, belts: r.rows });
  } catch (err) {
    console.error('Belt levels error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/belts/journey/:studentId — full timeline for a student.
// Auth: student themselves, linked parent, the institution admin, or any
// trainer whose batch the student is in.
exports.getJourney = async (req, res) => {
  try {
    const studentId = Number(req.params.studentId || req.user.id);
    const role = req.user.role;

    // Determine the student's institution.
    const sRow = await pool.query(
      `SELECT u.id, u.name, u.email, u.institution_id, sp.photo_url
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1 AND u.role = 'student'`,
      [studentId],
    );
    if (sRow.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const student = sRow.rows[0];

    // Access checks.
    if (role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (role === 'parent') {
      const link = await pool.query(
        `SELECT 1 FROM parent_child_links
          WHERE parent_id = $1 AND child_id = $2 AND status = 'active' LIMIT 1`,
        [req.user.id, studentId],
      );
      if (link.rows.length === 0) return res.status(403).json({ message: 'Access denied' });
    }
    if (role === 'admin') {
      // Admin access = student is enrolled in at least one batch under
      // the caller's branch scope (main-only for main admin; branch-only
      // for sub-branch admin). Falls back to the legacy institution-id
      // check when the student has no enrollments yet, so admins can
      // still promote freshly-signed-up students they own.
      const scope = await getBranchScope(req.user.id);
      const canSee = await adminCanSeeStudent(pool, scope, studentId);
      if (!canSee) {
        if (!scope || scope.callerInstId !== student.institution_id) {
          return res.status(403).json({ message: 'Not your student' });
        }
      }
    }
    if (role === 'trainer') {
      const trainerRow = await pool.query(
        `SELECT 1
           FROM trainers t
           JOIN batches b ON b.trainer_id = t.id
           JOIN enrollments e ON e.batch_id = b.id
          WHERE t.user_id = $1 AND e.student_id = $2 LIMIT 1`,
        [req.user.id, studentId],
      );
      if (trainerRow.rows.length === 0) {
        return res.status(403).json({ message: 'Not in your batches' });
      }
    }

    await ensureSeeded(student.institution_id);

    const beltsRes = await pool.query(
      `SELECT id, name, color_hex, emoji, sort_order, is_active
         FROM belt_levels
        WHERE institution_id = $1
        ORDER BY sort_order`,
      [student.institution_id],
    );
    const proms = await pool.query(
      `SELECT id, belt_level_id, promoted_at, instructor_name,
              performance_notes, remarks
         FROM student_belt_promotions
        WHERE student_id = $1
        ORDER BY promoted_at DESC, id DESC`,
      [studentId],
    );
    const promotionMap = new Map();
    proms.rows.forEach((p) => promotionMap.set(p.belt_level_id, p));
    const belts = annotateBelts(beltsRes.rows, promotionMap);

    // ── Belt history (source of truth for the mobile timeline) ──
    //
    // The classic belts[] above is CATALOGUE-based (institution's
    // belt_levels sequence with each row annotated completed /
    // current / locked). Useful for the "here's the whole path"
    // view, but it doesn't reflect the actual promotion trail — and
    // the new belt-promotion-approval workflow writes to
    // `belt_promotion_requests` (status='approved') NOT to
    // student_belt_promotions, so a student promoted via that flow
    // would never show up in belts[].
    //
    // Build a chronological belt_history[] that merges BOTH sources:
    //   • student_belt_promotions rows (joined to belt_levels for the
    //     canonical belt name + colour + emoji).
    //   • belt_promotion_requests rows where status='approved' (joined
    //     to users for the trainer's display name).
    //
    // Sorted ascending (oldest first) per spec: "Order belts from
    // first to latest." Renderers can reverse the array if they want
    // newest-first without recomputing.
    let promoHistory = { rows: [] };
    try {
      promoHistory = await pool.query(
        `SELECT r.id, r.requested_belt AS belt_name,
                r.resolved_at         AS promoted_at,
                r.trainer_remarks     AS remarks,
                COALESCE(t.name, '')  AS trainer_name,
                COALESCE(a.name, '')  AS approver_name
           FROM belt_promotion_requests r
           LEFT JOIN users t ON t.id = r.trainer_id
           LEFT JOIN users a ON a.id = r.resolved_by
          WHERE r.student_id = $1
            AND r.status     = 'approved'
          ORDER BY r.resolved_at, r.id`,
        [studentId],
      );
    } catch (err) {
      // Pre-085 schema (table doesn't exist yet) — degrade to just
      // the student_belt_promotions rows below. Log once so ops
      // knows to apply the migration.
      if (err?.code !== '42P01') {
        console.warn('[belt/journey] promo requests read failed:', err?.message);
      }
    }

    const belt_history = [];
    proms.rows.forEach((p) => {
      const belt = beltsRes.rows.find((b) => b.id === p.belt_level_id);
      belt_history.push({
        id:            `sbp:${p.id}`,
        source:        'student_belt_promotions',
        belt_name:     belt?.name || 'Belt',
        color_hex:     belt?.color_hex || null,
        emoji:         belt?.emoji || null,
        promoted_at:   p.promoted_at,
        promoted_by:   p.instructor_name || null,
        remarks:       p.remarks || p.performance_notes || null,
      });
    });
    promoHistory.rows.forEach((r) => {
      belt_history.push({
        id:            `bpr:${r.id}`,
        source:        'belt_promotion_request',
        belt_name:     r.belt_name,
        // No colour_hex on requests — the belt name is free-text so
        // the mobile derives a swatch from the label. Emoji stays
        // null; the mobile falls back to 🥋.
        color_hex:     null,
        emoji:         null,
        promoted_at:   r.promoted_at,
        // Prefer the trainer who submitted the request (they earned
        // the credit); fall back to the admin who approved when the
        // trainer row was cleaned up via ON DELETE SET NULL.
        promoted_by:   r.trainer_name || r.approver_name || null,
        remarks:       r.remarks || null,
      });
    });
    // Oldest → newest so the timeline reads chronologically. Same
    // date collisions tie-broken by the synthetic id keeping insert
    // order stable.
    belt_history.sort((a, b) => {
      const da = a.promoted_at ? new Date(a.promoted_at).getTime() : 0;
      const db = b.promoted_at ? new Date(b.promoted_at).getTime() : 0;
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });

    // Current belt derivation:
    //   1. Newest belt_history entry wins (it's the last one the
    //      institution approved OR the last row in the canonical
    //      promotion audit).
    //   2. Fall back to student_profiles.belt_category — captured
    //      from the enrolment form, always populated for a fresh
    //      student even before any promotion happens.
    //   3. Finally the catalogue's currently-marked belt (legacy).
    let currentFromHistory = null;
    if (belt_history.length > 0) {
      const last = belt_history[belt_history.length - 1];
      currentFromHistory = {
        name:      last.belt_name,
        color_hex: last.color_hex,
        emoji:     last.emoji,
        earned_at: last.promoted_at,
      };
    }
    let currentFromProfile = null;
    try {
      const pRes = await pool.query(
        `SELECT belt_category FROM student_profiles WHERE user_id = $1`,
        [studentId],
      );
      const cat = pRes.rows[0]?.belt_category;
      if (cat) {
        currentFromProfile = { name: cat, color_hex: null, emoji: null, earned_at: null };
      }
    } catch (_) { /* schema missing */ }

    const current = currentFromHistory
      || currentFromProfile
      || belts.find((b) => b.status === 'current')
      || null;

    const certsRes = await pool.query(
      `SELECT c.*, i.name AS institution_name, u.name AS student_name,
              t.name             AS template_name,
              t.background_url   AS template_background_url,
              t.background_kind  AS template_background_kind,
              t.canvas_width     AS template_canvas_width,
              t.canvas_height    AS template_canvas_height,
              t.signature_url    AS template_signature_url,
              t.seal_url         AS template_seal_url
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
         JOIN users u ON c.student_id = u.id
         LEFT JOIN certificate_templates t ON t.id = c.template_id
        WHERE c.student_id = $1
        ORDER BY c.issue_date DESC, c.id DESC`,
      [studentId],
    );

    // Build the unified timeline (promotions + certificates).
    const timeline = [];
    proms.rows.forEach((p) => {
      const belt = beltsRes.rows.find((b) => b.id === p.belt_level_id);
      timeline.push({
        kind: 'promotion',
        date: p.promoted_at,
        title: `${belt?.name || 'Belt'} achieved`,
        emoji: belt?.emoji,
        notes: p.remarks || p.performance_notes,
      });
    });
    certsRes.rows.filter((c) => c.kind !== 'belt').forEach((c) => {
      timeline.push({
        kind: 'certificate',
        date: c.issue_date,
        title: c.title,
        emoji: c.kind === 'tournament' ? '🏆' : '📜',
      });
    });
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      student: {
        id: student.id, name: student.name, email: student.email,
        photo_url: student.photo_url, institution_id: student.institution_id,
      },
      current_belt: current,
      belts,
      // Chronological promotion history — what the mobile Belt
      // Journey timeline renders. Fed by BOTH student_belt_promotions
      // AND belt_promotion_requests (approved), sorted oldest → newest.
      belt_history,
      certificates: certsRes.rows,
      summary: {
        // belts_earned = actual promotions on record (either source),
        // not the catalogue slots. When there's no promotion history
        // at all we count the initial enrolled belt (if the profile
        // has one) as 1 so the tile isn't zero for a fresh student.
        belts_earned: belt_history.length > 0
          ? belt_history.length
          : (currentFromProfile ? 1 : 0),
        certificates: certsRes.rows.length,
      },
      timeline,
    });
  } catch (err) {
    console.error('Belt journey error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/belts/my-journey — convenience for students.
exports.myJourney = (req, res) => {
  req.params.studentId = req.user.id;
  return exports.getJourney(req, res);
};

// POST /api/belts/promote
// Body: { student_id, belt_level_id, promoted_at?, instructor_name?,
//         performance_notes?, remarks?, signature_url?, academy_seal_url? }
//
// Atomic: writes promotion + certificate in one transaction. Auth: trainer
// assigned to one of the student's batches, OR institution admin.
exports.promote = async (req, res) => {
  const client = await pool.connect();
  try {
    // Trainers can no longer promote directly. Per the Belt Promotion
    // Approval workflow (migration 085), trainers must submit a
    // request via POST /api/belt-promotion-requests and the
    // institution admin approves. Guard the legacy direct endpoint
    // so an older mobile build (or a curl) can't sidestep the flow.
    if (req.user?.role === 'trainer') {
      return res.status(403).json({
        code:    'BELT_PROMOTION_REQUIRES_APPROVAL',
        message: 'Trainers cannot promote belts directly. Submit a promotion request; the institution admin approves.',
      });
    }
    const {
      student_id, belt_level_id, promoted_at,
      instructor_name, performance_notes, remarks,
      signature_url, academy_seal_url,
    } = req.body || {};
    if (!student_id || !belt_level_id) {
      return res.status(400).json({ message: 'student_id and belt_level_id are required' });
    }

    // Student row + institution.
    const sRow = await pool.query(
      `SELECT u.id, u.name, u.institution_id FROM users u
        WHERE u.id = $1 AND u.role = 'student'`,
      [student_id],
    );
    if (sRow.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const student = sRow.rows[0];

    // Auth.
    const role = req.user.role;
    if (role === 'admin') {
      // Same branch-scoped access rule as the read side (getJourney).
      const scope = await getBranchScope(req.user.id);
      const canSee = await adminCanSeeStudent(pool, scope, student_id);
      if (!canSee) {
        if (!scope || scope.callerInstId !== student.institution_id) {
          return res.status(403).json({ message: 'Not your student' });
        }
      }
    } else if (role === 'trainer') {
      const ok = await pool.query(
        `SELECT 1 FROM trainers t
           JOIN batches b ON b.trainer_id = t.id
           JOIN enrollments e ON e.batch_id = b.id
          WHERE t.user_id = $1 AND e.student_id = $2 LIMIT 1`,
        [req.user.id, student_id],
      );
      if (ok.rows.length === 0) {
        return res.status(403).json({ message: 'This student is not in any of your batches' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Belt level must belong to the student's institution.
    const bRow = await pool.query(
      `SELECT id, name, sort_order, emoji
         FROM belt_levels
        WHERE id = $1 AND institution_id = $2 AND is_active = TRUE`,
      [belt_level_id, student.institution_id],
    );
    if (bRow.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid belt level for this institution' });
    }
    const belt = bRow.rows[0];

    // Institution name for the cert title.
    const iRow = await pool.query(
      `SELECT name FROM institutions WHERE id = $1`, [student.institution_id],
    );
    const institutionName = iRow.rows[0]?.name || 'Academy';

    await client.query('BEGIN');

    // Insert promotion.
    let promo;
    try {
      promo = await client.query(
        `INSERT INTO student_belt_promotions
           (student_id, belt_level_id, institution_id, promoted_by, promoted_at,
            instructor_name, performance_notes, remarks,
            signature_url, academy_seal_url, status)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE),
                 $6, $7, $8, $9, $10, 'published')
         RETURNING *`,
        [
          student_id, belt_level_id, student.institution_id, req.user.id, promoted_at || null,
          instructor_name || null, performance_notes || null, remarks || null,
          signature_url || null, academy_seal_url || null,
        ],
      );
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        return res.status(409).json({ message: 'This student already has that belt.' });
      }
      throw e;
    }

    // Insert certificate.
    const token = await newToken(client);
    const certNo = 'CERT-' + token;
    const certTitle = `${belt.name} Promotion`;
    const cert = await client.query(
      `INSERT INTO certificates
         (student_id, institution_id, kind, title, description,
          issue_date, instructor_name, certificate_no, qr_token,
          promotion_id, signature_url, academy_seal_url)
       VALUES ($1, $2, 'belt', $3, $4,
               COALESCE($5::date, CURRENT_DATE), $6, $7, $8,
               $9, $10, $11)
       RETURNING *`,
      [
        student_id, student.institution_id, certTitle,
        `This certifies that ${student.name} has successfully achieved the ${belt.name}.`,
        promoted_at || null, instructor_name || null,
        certNo, token, promo.rows[0].id,
        signature_url || null, academy_seal_url || null,
      ],
    );

    await client.query('COMMIT');

    // Notify student + linked parents (best effort).
    try {
      await insertNotification({
        user_id:        student_id,
        institution_id: student.institution_id,
        category:       'system',
        title:          `${belt.emoji || '🥋'} ${belt.name} unlocked!`,
        message:        `${institutionName} promoted you to ${belt.name}. Tap to view your new certificate.`,
        data:           { screen: 'StudentBeltJourney' },
        created_by:     req.user.id,
      });
      const parents = await pool.query(
        `SELECT parent_id FROM parent_child_links
          WHERE child_id = $1 AND status = 'active'`, [student_id],
      );
      for (const p of parents.rows) {
        await insertNotification({
          user_id:        p.parent_id,
          institution_id: student.institution_id,
          category:       'system',
          title:          `${belt.emoji || '🥋'} New belt for ${student.name}`,
          message:        `${student.name} has been promoted to ${belt.name}.`,
          data:           { screen: 'StudentBeltJourney', student_id },
          created_by:     req.user.id,
        });
      }
    } catch (err) {
      console.warn('[promote] notify failed:', err.message);
    }

    res.status(201).json({
      message: `${student.name} promoted to ${belt.name}.`,
      promotion: promo.rows[0],
      certificate: cert.rows[0],
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Promote error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
