// backend/src/controllers/beltPromotionRequest.controller.js
//
// Belt Promotion Approval workflow. Trainer submits a promotion
// request for a student they teach; institution admin reviews and
// either notifies the trainer (return with remarks, keep pending) or
// approves (mints a certificate, updates the student's
// belt_category, marks the request approved, notifies both parties).
//
// Every state change hits belt_promotion_request_events for audit.
// Every actor-facing outcome fans through insertNotification so the
// in-app bell + FCM push both fire automatically (parents don't get
// push — filtered inside notification.service).
//
// Routes are mounted in ../routes/beltPromotionRequest.routes.js:
//   POST   /api/belt-promotion-requests                     (trainer)
//   GET    /api/belt-promotion-requests/mine                (trainer)
//   GET    /api/belt-promotion-requests/institution         (admin)
//   POST   /api/belt-promotion-requests/:id/notify-trainer  (admin)
//   POST   /api/belt-promotion-requests/:id/approve         (admin)

const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');
const { getBranchScope, adminCanSeeStudent } = require('../utils/branchScope');
// Display normalization — strip a trailing " Belt" so certificate
// snapshots read "Black" instead of "Black Belt". Backend + mobile
// share the exact same rule.
const { stripBeltSuffix } = require('../utils/beltDisplay');

// Attendance snapshot for the given student across every batch they
// belong to (bounded by their institution). Used at submit time so
// the institution sees exactly what the trainer saw. Returns the
// same shape the mobile displays elsewhere:
//   { total, present, absent, late, leave, percent }
async function computeAttendanceSummary(studentId) {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int                                                       AS total,
         COUNT(*) FILTER (WHERE status = 'present')::int                     AS present,
         COUNT(*) FILTER (WHERE status = 'absent')::int                      AS absent,
         COUNT(*) FILTER (WHERE status = 'late')::int                        AS late,
         COUNT(*) FILTER (WHERE status = 'leave')::int                       AS leave
       FROM attendance
       WHERE student_id = $1`,
      [studentId],
    );
    const row = r.rows[0] || {};
    const total  = Number(row.total)   || 0;
    const present = Number(row.present) || 0;
    const late    = Number(row.late)    || 0;
    // Same formula the rest of the app uses (present + late * 0.5).
    const percent = total > 0
      ? Math.round(((present + late * 0.5) / total) * 100)
      : 0;
    return {
      total,
      present,
      absent: Number(row.absent) || 0,
      late,
      leave:  Number(row.leave)  || 0,
      percent,
    };
  } catch (err) {
    console.warn('[promo] attendance summary failed:', err?.message);
    return { total: 0, present: 0, absent: 0, late: 0, leave: 0, percent: 0 };
  }
}

// Fire-and-forget audit write. Never throws.
async function auditEvent({ requestId, actorId, actorRole, event, remarks }) {
  try {
    await pool.query(
      `INSERT INTO belt_promotion_request_events
         (request_id, actor_id, actor_role, event, remarks)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, actorId || null, actorRole || null, event, remarks || null],
    );
  } catch (err) {
    console.warn('[promo] audit event failed:', err?.message);
  }
}

// Verify the trainer teaches this student's batch. Same check the
// curriculum + attendance controllers use — a trainer can only act
// on students in one of their own batches.
async function trainerTeachesStudent(trainerUserId, studentId) {
  const r = await pool.query(
    `SELECT 1
       FROM trainers t
       JOIN batches b     ON b.trainer_id = t.id
       JOIN enrollments e ON e.batch_id  = b.id
      WHERE t.user_id = $1
        AND e.student_id = $2
      LIMIT 1`,
    [trainerUserId, studentId],
  );
  return r.rows.length > 0;
}

// ────────────────────────────────────────────────────────────────
// POST /api/belt-promotion-requests
// Body: { student_id, requested_belt, remarks? }
// ────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    if (req.user?.role !== 'trainer') {
      return res.status(403).json({ message: 'Only trainers can submit promotion requests.' });
    }
    const trainerUserId = req.user.id;
    const studentId     = parseInt(req.body?.student_id, 10);
    const requestedBelt = String(req.body?.requested_belt || '').trim();
    const remarks       = String(req.body?.remarks || '').trim() || null;
    // MODULE FIX: curriculum_item_id makes each request per-item so
    // "Pending Approval" on Level 1 no longer paints Level 2/3 too.
    // Kept optional for legacy clients that don't send it yet.
    const rawItemId     = req.body?.curriculum_item_id;
    const curriculumItemId = rawItemId != null && rawItemId !== ''
      ? parseInt(rawItemId, 10) : null;
    if (!Number.isInteger(studentId) || !requestedBelt) {
      return res.status(400).json({ message: 'student_id + requested_belt are required.' });
    }

    // Access — trainer must actually teach this student.
    const owns = await trainerTeachesStudent(trainerUserId, studentId);
    if (!owns) {
      return res.status(403).json({
        message: 'You can only submit promotion requests for students in your own batches.',
      });
    }

    // Resolve institution + current belt in one query.
    const s = await pool.query(
      `SELECT u.institution_id,
              u.name AS student_name,
              sp.belt_category AS current_belt
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1 AND u.role = 'student'`,
      [studentId],
    );
    if (s.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    const student = s.rows[0];
    if (!student.institution_id) {
      return res.status(400).json({ message: 'Student is not linked to an institution.' });
    }

    // Duplicate-pending guard — the partial unique index does this
    // at the DB level too, but a friendly early return avoids the
    // 23505 code bubbling as a generic 500 to the mobile.
    //
    // Now scoped by curriculum_item_id so the trainer can have one
    // pending request per item (Level 1 pending doesn't block a
    // Level 2 submit). Legacy student-level requests (null item)
    // still block a matching null-item resubmit.
    const dup = await pool.query(
      `SELECT id FROM belt_promotion_requests
        WHERE student_id = $1
          AND status = 'pending'
          AND curriculum_item_id IS NOT DISTINCT FROM $2::int
        LIMIT 1`,
      [studentId, curriculumItemId],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        code: 'PROMOTION_ALREADY_PENDING',
        message: 'A promotion for this student is already awaiting institution approval.',
      });
    }

    const attendance = await computeAttendanceSummary(studentId);

    // Supersede any prior sent_for_recheck / declined row for the
    // same (student, curriculum_item) pair — the fresh pending
    // request is the one that should show on the institution UI, not
    // the recheck stub. Marking as 'closed' keeps the audit history
    // (the old row still exists) but removes it from every consumer
    // surface. Best-effort: if the UPDATE errors on an unusual schema
    // we still fall through and let the INSERT proceed.
    try {
      await pool.query(
        `UPDATE belt_promotion_requests
            SET status = 'closed'
          WHERE student_id = $1
            AND curriculum_item_id IS NOT DISTINCT FROM $2::int
            AND status IN ('sent_for_recheck', 'declined')`,
        [studentId, curriculumItemId],
      );
    } catch (supErr) {
      console.warn('[promo] supersede prior recheck failed:', supErr?.message);
    }

    let inserted;
    try {
      inserted = await pool.query(
        `INSERT INTO belt_promotion_requests
           (student_id, trainer_id, institution_id,
            current_belt, requested_belt, trainer_remarks,
            attendance_summary, status, curriculum_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', $8)
         RETURNING *`,
        [
          studentId, trainerUserId, student.institution_id,
          student.current_belt || null,
          requestedBelt,
          remarks,
          JSON.stringify(attendance),
          curriculumItemId,
        ],
      );
    } catch (dbErr) {
      // Unique-index race — a second submit landed between our SELECT
      // and this INSERT. Surface the same 409 as the early check.
      if (dbErr?.code === '23505') {
        return res.status(409).json({
          code: 'PROMOTION_ALREADY_PENDING',
          message: 'A promotion for this student is already awaiting institution approval.',
        });
      }
      throw dbErr;
    }
    const row = inserted.rows[0];

    await auditEvent({
      requestId: row.id,
      actorId:   trainerUserId,
      actorRole: 'trainer',
      event:     'submitted',
      remarks,
    });

    // Notify institution admin(s). Any admin under the student's
    // institution receives the bell + push. Deep link points at
    // the AdminCertificates screen where the pending promotion list
    // lives.
    try {
      const adminsRes = await pool.query(
        `SELECT id FROM users
          WHERE role = 'admin' AND institution_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE`,
        [student.institution_id],
      );
      for (const a of adminsRes.rows) {
        await insertNotification({
          user_id:        a.id,
          institution_id: student.institution_id,
          category:       'system',
          title:          'Belt promotion pending review',
          message:        `${req.user.name || 'A trainer'} requested a belt promotion for ${student.student_name}.`,
          data: {
            screen:         'AdminCertificates',
            reference_type: 'belt_promotion_request',
            reference_id:   row.id,
          },
          created_by: trainerUserId,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('[promo] admin notify failed:', err?.message);
    }

    return res.status(201).json({ message: 'Promotion request submitted', request: row });
  } catch (err) {
    console.error('promotion create error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/belt-promotion-requests/mine
// Trainer's submitted requests (any status). Ordered newest first.
// ────────────────────────────────────────────────────────────────
exports.listMine = async (req, res) => {
  try {
    if (req.user?.role !== 'trainer') {
      return res.status(403).json({ message: 'Trainer role required.' });
    }
    const r = await pool.query(
      `SELECT r.*, u.name AS student_name
         FROM belt_promotion_requests r
         JOIN users u ON u.id = r.student_id
        WHERE r.trainer_id = $1
        ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    return res.json({ count: r.rows.length, requests: r.rows });
  } catch (err) {
    console.error('promotion listMine error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/belt-promotion-requests/mine-as-student
//
// Student-facing companion to listMine — returns promotion requests
// where the caller IS the student. Powers the "Promoted" badge on
// the student's EnrolledCourse curriculum view so the approved
// state shows up on their side without needing trainer credentials.
// ────────────────────────────────────────────────────────────────
exports.listMineAsStudent = async (req, res) => {
  try {
    if (req.user?.role !== 'student') {
      return res.status(403).json({ message: 'Student role required.' });
    }
    const r = await pool.query(
      `SELECT id, student_id, curriculum_item_id, status,
              requested_belt, current_belt,
              approved_at, created_at
         FROM belt_promotion_requests
        WHERE student_id = $1
        ORDER BY created_at DESC`,
      [req.user.id],
    );
    return res.json({ count: r.rows.length, requests: r.rows });
  } catch (err) {
    console.error('promotion listMineAsStudent error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/belt-promotion-requests/institution
// Institution admin — every pending (default) or all with ?status=all
// Scoped through the student's institution tree; sub-branch admins
// only see requests for their branch's students.
// ────────────────────────────────────────────────────────────────
exports.listInstitution = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const scope = await getBranchScope(req.user.id);
    if (!scope) {
      return res.status(403).json({ message: 'No institution linked.' });
    }

    // Branch scoping — join through the student's most recent batch
    // and filter by that batch's branch_id. Sub-branch admin: only
    // requests for students in their branch. Main admin: only
    // main-institution batches (branch_id IS NULL). Matches
    // batchBranchClause semantics used across the app.
    //
    // Default status filter now covers BOTH open states:
    //   'pending'          — awaiting institution action
    //   'sent_for_recheck' — institution returned it to the trainer;
    //                        row still visible with the "Sent for
    //                        Recheck" label so the admin sees the
    //                        state of every request they've touched.
    // 'closed' (superseded by a fresh submission) and 'approved' /
    // 'declined' are excluded from the default list. ?status=all is
    // still honoured so an audit view can pull the entire history.
    const params = [scope.rootId];
    let where = `r.status IN ('pending', 'sent_for_recheck')
                 AND (
                   e.batch_id IS NULL
                   OR b.institution_id = $1
                   OR b.institution_id IN (SELECT id FROM institutions WHERE parent_institution_id = $1)
                 )`;
    if (scope.isSubBranchAdmin) {
      params.push(scope.callerInstId);
      where += ` AND b.branch_id = $${params.length}`;
    } else {
      where += ` AND (b.branch_id IS NULL OR e.batch_id IS NULL)`;
    }
    const statusFilter = String(req.query?.status || '').toLowerCase();
    if (statusFilter === 'all') {
      where = where.replace(
        `r.status IN ('pending', 'sent_for_recheck') AND `,
        '',
      );
    }

    const r = await pool.query(
      `SELECT r.*,
              u.name AS student_name,
              t.name AS trainer_name,
              c.name AS course_name,
              b.name AS batch_name
         FROM belt_promotion_requests r
         JOIN users u ON u.id = r.student_id
         LEFT JOIN users t ON t.id = r.trainer_id
         LEFT JOIN LATERAL (
           SELECT batch_id FROM enrollments
            WHERE student_id = r.student_id
            ORDER BY id DESC LIMIT 1
         ) e ON TRUE
         LEFT JOIN batches b ON b.id = e.batch_id
         LEFT JOIN courses c ON c.id = b.course_id
        WHERE ${where}
        ORDER BY r.created_at DESC`,
      params,
    );
    return res.json({ count: r.rows.length, requests: r.rows });
  } catch (err) {
    console.error('promotion listInstitution error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/belt-promotion-requests/:id/notify-trainer
// Body: { remarks }
// Admin returns the request to the trainer with remarks. Status
// flips to 'declined'; the trainer sees a bell + push with the
// institution's message and can submit a fresh request.
// ────────────────────────────────────────────────────────────────
exports.notifyTrainer = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const remarks = String(req.body?.remarks || '').trim();
    if (!remarks) {
      return res.status(400).json({ message: 'Remarks are required so the trainer knows what to revise.' });
    }

    const r = await pool.query(
      `SELECT r.*, u.name AS student_name
         FROM belt_promotion_requests r
         JOIN users u ON u.id = r.student_id
        WHERE r.id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ message: 'Request not found.' });
    if (row.status !== 'pending') {
      return res.status(409).json({ message: `Request is already ${row.status}.` });
    }

    // Access — admin's institution must own this student.
    const scope = await getBranchScope(req.user.id);
    if (!scope || scope.rootId !== row.institution_id) {
      // Root-level check + fine-grained per-branch check below.
      const canSee = await adminCanSeeStudent(pool, scope, row.student_id);
      if (!canSee) return res.status(403).json({ message: 'Not your student.' });
    }

    // MODULE FIX — Notify Trainer no longer hard-declines the
    // request. It moves it into 'sent_for_recheck', which:
    //   • keeps the row visible on the institution's Certificates
    //     screen (labelled "Sent for Recheck", no action buttons)
    //   • unlocks the trainer's curriculum row back to "Promote
    //     Belt" so they can review and resubmit
    // The pending unique index (status='pending' only) is preserved,
    // so the trainer can freely POST a new request for the same
    // (student, curriculum_item) pair. The subsequent create call
    // supersedes this sent_for_recheck row by flipping it to 'closed'
    // (see exports.create).
    await pool.query(
      `UPDATE belt_promotion_requests SET
         status              = 'sent_for_recheck',
         institution_remarks = $2,
         resolved_at         = NOW(),
         resolved_by         = $3
       WHERE id = $1`,
      [id, remarks, req.user.id],
    );

    await auditEvent({
      requestId: id, actorId: req.user.id, actorRole: 'admin',
      event: 'sent_for_recheck', remarks,
    });

    // Notify the trainer. Payload carries EVERY id the mobile needs
    // to deep-link straight to the concerned Student Profile with the
    // right curriculum item focused — no intermediate list screen:
    //   • screen              — React Navigation route name
    //   • params              — object the FCM cold-start handler
    //                           forwards verbatim to navigationRef
    //                           (background + terminated app case)
    //   • student_id          — top-level so the in-app bell tap
    //                           handler can build params without
    //                           parsing `params`
    //   • curriculum_item_id  — which lesson row to scroll to /
    //                           highlight (nullable for legacy rows)
    //   • promotion_request_id — audit linkage for future features
    //   • reference_type / _id — kept for existing analytics hooks
    if (row.trainer_id) {
      const navParams = {
        studentId:            row.student_id,
        focusCurriculumItemId: row.curriculum_item_id || null,
        promotionRequestId:   id,
        source:               'recheck',
      };
      await insertNotification({
        user_id:        row.trainer_id,
        institution_id: row.institution_id,
        category:       'system',
        title:          'Belt promotion sent for recheck',
        message:        `Please recheck your promotion request for ${row.student_name}: ${remarks}`,
        data: {
          screen:                'StaffStudentDetail',
          params:                navParams,
          student_id:            row.student_id,
          curriculum_item_id:    row.curriculum_item_id || null,
          promotion_request_id:  id,
          source:                'recheck',
          reference_type:        'belt_promotion_request',
          reference_id:          id,
        },
        created_by: req.user.id,
      }).catch(() => {});
    }

    return res.json({ message: 'Trainer notified. Request marked for recheck.' });
  } catch (err) {
    console.error('promotion notifyTrainer error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/belt-promotion-requests/:id/approve
// Body: { template_id? }
// Admin approves: mint a certificate (kind='belt'), stamp the
// student's belt_category to the requested belt, mark the request
// approved, notify trainer + student.
// ────────────────────────────────────────────────────────────────
exports.approve = async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user?.role !== 'admin') {
      client.release();
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      client.release();
      return res.status(400).json({ message: 'Invalid id' });
    }

    // Read outside the transaction — cheap + avoids poisoning the tx
    // with an aborted SELECT if any optional column is missing.
    const r = await pool.query(
      `SELECT r.*, u.name AS student_name, i.name AS institution_name
         FROM belt_promotion_requests r
         JOIN users u ON u.id = r.student_id
         LEFT JOIN institutions i ON i.id = r.institution_id
        WHERE r.id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row) { client.release(); return res.status(404).json({ message: 'Request not found.' }); }
    // Idempotency guard #1 — same request re-approved. Return the
    // already-issued certificate id instead of minting a duplicate.
    // The DB partial unique index on certificates.promotion_request_id
    // is the belt-and-braces safety net; this early return keeps the
    // happy path clean when the admin double-taps Approve.
    if (row.status === 'approved') {
      client.release();
      return res.json({
        message: 'Promotion already approved.',
        certificate_id: row.certificate_id || null,
        idempotent: true,
      });
    }
    if (row.status !== 'pending') {
      client.release();
      return res.status(409).json({ message: `Request is already ${row.status}.` });
    }

    // Access — resolve student's institution tree.
    const scope = await getBranchScope(req.user.id);
    if (scope && scope.rootId !== row.institution_id) {
      const canSee = await adminCanSeeStudent(pool, scope, row.student_id);
      if (!canSee) {
        client.release();
        return res.status(403).json({ message: 'Not your student.' });
      }
    }

    // Template — same lookup shape as sendCertificate. Walks to root
    // so branch admins hit the parent academy's templates.
    const rootRes = await pool.query(
      `SELECT COALESCE(parent_institution_id, id) AS root_id
         FROM institutions WHERE id = $1`,
      [row.institution_id],
    );
    const rootInstitutionId = rootRes.rows[0]?.root_id || row.institution_id;
    const bodyTemplateId = Number.parseInt(req.body?.template_id, 10);
    let template = null;
    try {
      if (Number.isInteger(bodyTemplateId)) {
        // Admin picked a specific template on the approve modal.
        const t = await pool.query(
          `SELECT * FROM certificate_templates
            WHERE id = $1 AND institution_id = $2`,
          [bodyTemplateId, rootInstitutionId],
        );
        template = t.rows[0] || null;
      }
      if (!template) {
        // Prefer the institution's default template.
        const t = await pool.query(
          `SELECT * FROM certificate_templates
            WHERE institution_id = $1 AND is_default = TRUE
            ORDER BY updated_at DESC
            LIMIT 1`,
          [rootInstitutionId],
        );
        template = t.rows[0] || null;
      }
      if (!template) {
        // Fallback: any template the academy has authored. Belt
        // promotions must always render on the institution's own
        // certificate design — never blank — even when the admin
        // forgot to mark one as default.
        const t = await pool.query(
          `SELECT * FROM certificate_templates
            WHERE institution_id = $1
            ORDER BY is_default DESC NULLS LAST, updated_at DESC
            LIMIT 1`,
          [rootInstitutionId],
        );
        template = t.rows[0] || null;
      }
    } catch (tplErr) {
      console.log('[promo/approve] template lookup skipped:', tplErr?.message);
    }

    // Build the merged placeholder payload — same shape sendCertificate
    // uses so the student's viewer renders the exact same layout.
    // Belt strings are normalized to short-form ("Black" not "Black
    // Belt") on the way in so the certificate snapshot, the DB row,
    // the QR verify page, and the mobile viewer all speak the same
    // string. Storage stays historical-safe: if a legacy request
    // arrived with "White Belt" in current_belt, we still strip it
    // for display but the source row is untouched.
    const requestedBeltShort = stripBeltSuffix(row.requested_belt) || row.requested_belt;
    const currentBeltShort   = stripBeltSuffix(row.current_belt || '') || '';

    const now = new Date();
    const certNo = `VRF-${row.institution_id}-${now.getFullYear()}-BELT-${
      Math.floor(Math.random() * 90000) + 10000
    }`;
    const values = {
      student_name:     row.student_name,
      belt_name:        requestedBeltShort,
      belt_from:        currentBeltShort,
      belt_to:          requestedBeltShort,
      institution_name: row.institution_name || '',
      completion_date:  now.toISOString().slice(0, 10),
      certificate_no:   certNo,
      digital_signature:'',
      seal:             '',
    };
    const mergedPlaceholders = (template?.placeholders || [])
      .filter((pin) => pin.active !== false)
      .map((pin) => ({
        ...pin,
        value: values[pin.key] ?? '',
        image_url: pin.key === 'digital_signature'
          ? (template?.signature_url || null)
          : pin.key === 'seal'
            ? (template?.seal_url || null)
            : null,
      }));

    await client.query('BEGIN');

    // Certificate row. kind='belt' so the student's Belts & Certs
    // screen groups it correctly. qr_token is lowercase hex to match
    // the case-insensitive verify endpoint (task #132). Title is the
    // short-form belt name so the student's list reads "Black" not
    // "Black Belt" — the redundant suffix was scrapped per the
    // Certificate Templates spec. promotion_request_id links this
    // certificate back to the exact promotion so QR verification and
    // /certificates/my both surface the promotion audit trail.
    const crypto = require('crypto');
    const qrToken = crypto.randomBytes(12).toString('hex');
    let certId = null;
    try {
      await client.query('SAVEPOINT cert_insert');
      const certRes = await client.query(
        `INSERT INTO certificates
           (student_id, institution_id, kind, title, description,
            issue_date, certificate_no, qr_token,
            template_id, placeholder_data, promotion_request_id)
         VALUES ($1, $2, 'belt', $3, $4,
                 CURRENT_DATE, $5, $6,
                 $7, $8::jsonb, $9)
         RETURNING id`,
        [
          row.student_id,
          row.institution_id,
          requestedBeltShort,
          row.trainer_remarks || null,
          certNo,
          qrToken,
          template?.id || null,
          JSON.stringify(mergedPlaceholders),
          id,
        ],
      );
      certId = certRes.rows[0]?.id || null;
      await client.query('RELEASE SAVEPOINT cert_insert');
    } catch (certErr) {
      // 23505 on uq_certificates_promotion_request means another
      // approve landed first (race) — recover the existing cert id
      // instead of failing the whole approve. Everything else falls
      // through to the warn + rollback path so the promotion still
      // completes even if a schema hiccup blocks the cert insert.
      try { await client.query('ROLLBACK TO SAVEPOINT cert_insert'); } catch (_) {}
      if (certErr?.code === '23505') {
        try {
          const existing = await client.query(
            `SELECT id FROM certificates WHERE promotion_request_id = $1 LIMIT 1`,
            [id],
          );
          certId = existing.rows[0]?.id || null;
        } catch (_) { /* best-effort */ }
      } else {
        console.warn('[promo/approve] certificate insert failed:', certErr?.message);
      }
    }

    // Update the student's belt_category. Short-form so the trainer
    // curriculum view, student profile, and any downstream card show
    // the same "Black" string. Fires whether or not the certificate
    // row landed — the promotion itself is still valid even if the
    // artwork insert had a schema hiccup.
    await client.query(
      `INSERT INTO student_profiles (user_id, full_name, belt_category)
         VALUES ($1, (SELECT name FROM users WHERE id = $1), $2)
       ON CONFLICT (user_id) DO UPDATE SET
         belt_category = EXCLUDED.belt_category,
         updated_at    = CURRENT_TIMESTAMP`,
      [row.student_id, requestedBeltShort],
    );

    // Mirror into student_belt_promotions when a matching belt_level
    // exists — this keeps the historical Belt Journey timeline in
    // sync with the new promotion. Best-effort inside a SAVEPOINT so
    // an unusual belt name (custom label the academy invented) never
    // fails the whole approve. The unique (student_id, belt_level_id)
    // constraint takes care of duplicate promotion rows.
    try {
      await client.query('SAVEPOINT belt_journey_sync');
      await client.query(
        `INSERT INTO student_belt_promotions
           (student_id, belt_level_id, institution_id,
            promoted_by, promoted_at, remarks)
         SELECT $1, bl.id, $2, $3, CURRENT_DATE, $4
           FROM belt_levels bl
          WHERE bl.institution_id = $2
            AND (LOWER(bl.name) = LOWER($5) OR LOWER(bl.name) = LOWER($6))
          LIMIT 1
        ON CONFLICT (student_id, belt_level_id) DO NOTHING`,
        [
          row.student_id, row.institution_id, req.user.id,
          row.trainer_remarks || null,
          requestedBeltShort,
          row.requested_belt,
        ],
      );
      await client.query('RELEASE SAVEPOINT belt_journey_sync');
    } catch (bjErr) {
      try { await client.query('ROLLBACK TO SAVEPOINT belt_journey_sync'); } catch (_) {}
      console.warn('[promo/approve] belt journey mirror skipped:', bjErr?.message);
    }

    // Mark the request approved.
    await client.query(
      `UPDATE belt_promotion_requests SET
         status         = 'approved',
         certificate_id = COALESCE($2, certificate_id),
         resolved_at    = NOW(),
         resolved_by    = $3
       WHERE id = $1`,
      [id, certId, req.user.id],
    );

    await client.query('COMMIT');

    await auditEvent({
      requestId: id, actorId: req.user.id, actorRole: 'admin',
      event: 'approved',
      remarks: `Promoted to ${requestedBeltShort}`,
    });

    // Notify student.
    await insertNotification({
      user_id:        row.student_id,
      institution_id: row.institution_id,
      category:       'system',
      title:          'Congratulations — belt promoted!',
      message:        `You've been promoted to ${requestedBeltShort}. Your certificate is now available under Belts & Certs.`,
      data: {
        screen:         'StudentCertificates',
        reference_type: 'certificate',
        reference_id:   certId || id,
      },
      created_by: req.user.id,
    }).catch(() => {});

    // Notify trainer.
    if (row.trainer_id) {
      await insertNotification({
        user_id:        row.trainer_id,
        institution_id: row.institution_id,
        category:       'system',
        title:          'Promotion approved',
        message:        `Your promotion request for ${row.student_name} was approved. The student is now ${requestedBeltShort}.`,
        data: {
          screen:         'StaffStudentDetail',
          reference_type: 'belt_promotion_request',
          reference_id:   id,
        },
        created_by: req.user.id,
      }).catch(() => {});
    }

    return res.json({
      message: `Promotion approved. ${row.student_name} is now ${requestedBeltShort}.`,
      certificate_id: certId,
      promotion_request_id: id,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('promotion approve error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
