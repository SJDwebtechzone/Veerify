// backend/src/controllers/courseCompletion.controller.js
//
// Handles the "student finished the curriculum → belt test → certificate"
// lifecycle. Three surfaces call in:
//
//   Trainer Login
//     • POST   /api/course-completions            — record course-completed
//                                                    when the last curriculum
//                                                    lesson is ticked.
//     • GET    /api/course-completions/trainer/mine
//                                                  — list Completed Students.
//     • PATCH  /api/course-completions/:id/remarks
//                                                  — trainer submits belt-
//                                                    test remarks (auto-stamps
//                                                    belt_test_completed_at
//                                                    and flips status to
//                                                    'awaiting_certificate').
//
//   Institution Login
//     • GET    /api/course-completions/institution/awaiting-certificate
//                                                  — Certificates queue.
//     • POST   /api/course-completions/:id/send-certificate
//                                                  — mark 'certificate_sent',
//                                                    stamp certificate_sent_at.

const pool = require('../config/db');

// Resolve the caller's institution_id (used by the institution admin
// endpoints so they only see rows in their own academy tree).
async function getMyInstitutionId(userId) {
  const r = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// POST /api/course-completions
// Body: { student_id, course_id, batch_id? }
//
// Called by the trainer when the "Course completed. Proceed to Belt Test?"
// dialog is answered Yes. Idempotent — if the student already has a
// course_completions row for this (student, course) pair (e.g. they hit
// the last lesson twice) we return the existing row so the mobile can
// still route them to the Completed Students screen.
exports.recordCourseCompletion = async (req, res) => {
  try {
    const trainerUserId = req.user.id;
    const { student_id, course_id, batch_id } = req.body || {};
    if (!student_id || !course_id) {
      return res.status(400).json({ message: 'student_id and course_id are required' });
    }

    // Look up the student's institution and the trainer must be linked
    // to that same academy tree. We keep this simple: any trainer who
    // has access to the student's batch can record completion.
    const studentRow = await pool.query(
      `SELECT id, institution_id FROM users WHERE id = $1 AND role = 'student'`,
      [student_id],
    );
    if (studentRow.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const institutionId = studentRow.rows[0].institution_id;

    // Trainer must actually teach a batch this student is enrolled in.
    const teaches = await pool.query(
      `SELECT 1
         FROM trainers t
         JOIN batches b     ON b.trainer_id = t.id
         JOIN enrollments e ON e.batch_id   = b.id
        WHERE t.user_id = $1
          AND e.student_id = $2
        LIMIT 1`,
      [trainerUserId, student_id],
    );
    if (teaches.rows.length === 0) {
      return res.status(403).json({
        message: 'You can only mark completion for students in your own batches.',
      });
    }

    const upsert = await pool.query(
      `INSERT INTO course_completions
         (student_id, course_id, batch_id, trainer_id, institution_id,
          course_completed_at, status)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'awaiting_test')
       ON CONFLICT (student_id, course_id)
         DO UPDATE SET
           trainer_id  = EXCLUDED.trainer_id,
           batch_id    = COALESCE(EXCLUDED.batch_id, course_completions.batch_id),
           updated_at  = NOW()
       RETURNING *`,
      [student_id, course_id, batch_id || null, trainerUserId, institutionId],
    );

    res.status(201).json({
      message:    'Course marked complete',
      completion: upsert.rows[0],
    });
  } catch (err) {
    console.error('recordCourseCompletion error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/course-completions/trainer/mine
// Returns every completion row where trainer_id = caller. Newest first.
// Includes student + course names so the Completed Students screen
// renders without another round-trip.
exports.listTrainerCompletions = async (req, res) => {
  try {
    const trainerUserId = req.user.id;
    const r = await pool.query(
      `SELECT
         cc.id, cc.status,
         cc.course_completed_at,
         cc.belt_test_completed_at,
         cc.certificate_sent_at,
         cc.test_remarks,
         cc.student_id,
         u.name  AS student_name,
         u.email AS student_email,
         sp.photo_url AS student_photo_url,
         cc.course_id,
         c.name  AS course_name,
         cc.batch_id,
         b.name  AS batch_name,
         cc.institution_id,
         i.name  AS institution_name
       FROM course_completions cc
       JOIN users u      ON u.id = cc.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN courses c    ON c.id = cc.course_id
       LEFT JOIN batches b     ON b.id = cc.batch_id
       LEFT JOIN institutions i ON i.id = cc.institution_id
      WHERE cc.trainer_id = $1
      ORDER BY cc.course_completed_at DESC`,
      [trainerUserId],
    );
    res.json({ count: r.rows.length, completions: r.rows });
  } catch (err) {
    console.error('listTrainerCompletions error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PATCH /api/course-completions/:id/remarks
// Body: { test_remarks }
//
// Trainer records the belt-test remarks. This is the ONLY field they can
// edit on the completion. Submitting the remarks auto-stamps
// belt_test_completed_at (the "test date" the spec calls out) and moves
// status to 'awaiting_certificate' so the institution admin sees the
// row in their Certificates queue.
exports.submitTestRemarks = async (req, res) => {
  try {
    const trainerUserId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
    const remarks = String((req.body?.test_remarks) || '').trim();
    if (!remarks) {
      return res.status(400).json({ message: 'Please add test remarks before submitting.' });
    }

    const check = await pool.query(
      `SELECT id, trainer_id, status FROM course_completions WHERE id = $1`,
      [id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (check.rows[0].trainer_id !== trainerUserId) {
      return res.status(403).json({ message: 'Not your student' });
    }
    if (check.rows[0].status === 'certificate_sent') {
      return res.status(400).json({
        message: 'Certificate has already been dispatched — remarks are locked.',
      });
    }

    const upd = await pool.query(
      `UPDATE course_completions
          SET test_remarks           = $2,
              belt_test_completed_at = COALESCE(belt_test_completed_at, NOW()),
              status                 = 'awaiting_certificate',
              updated_at             = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, remarks],
    );

    res.json({ message: 'Remarks saved', completion: upd.rows[0] });
  } catch (err) {
    console.error('submitTestRemarks error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/course-completions/institution/awaiting-certificate
//
// Institution Login → Certificates. Returns every row for the caller's
// institution with status = 'awaiting_certificate' (i.e. the trainer
// has already submitted remarks and it's now the admin's turn). Also
// carries recent trainer_name so the admin knows who signed off.
exports.listInstitutionAwaitingCertificate = async (req, res) => {
  try {
    const institutionId = await getMyInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    // Include both the branch's own rows AND any child branch rows
    // (main-admin visibility). We check whether the caller is a main
    // admin (parent_institution_id NULL) or a sub-branch admin.
    const parentRes = await pool.query(
      `SELECT parent_institution_id FROM institutions WHERE id = $1`,
      [institutionId],
    );
    const isSubBranch = !!parentRes.rows[0]?.parent_institution_id;

    // Filter: sub-branch admin → only their branch; main admin → root +
    // every child branch under it.
    const filter = isSubBranch
      ? `cc.institution_id = $1`
      : `(cc.institution_id = $1
          OR cc.institution_id IN (
            SELECT id FROM institutions WHERE parent_institution_id = $1
          ))`;

    const r = await pool.query(
      `SELECT
         cc.id,
         cc.status,
         cc.course_completed_at,
         cc.belt_test_completed_at,
         cc.certificate_sent_at,
         cc.test_remarks,
         cc.student_id,
         u.name  AS student_name,
         u.email AS student_email,
         sp.photo_url AS student_photo_url,
         cc.course_id,
         c.name  AS course_name,
         cc.batch_id,
         b.name  AS batch_name,
         cc.trainer_id,
         tu.name AS trainer_name,
         cc.institution_id,
         i.name  AS branch_name,
         -- Student's most recently earned belt name (if any). Powers
         -- the Belt column on the admin's Certificates queue.
         (SELECT bl.name
            FROM student_belt_promotions p
            JOIN belt_levels bl ON bl.id = p.belt_level_id
           WHERE p.student_id = cc.student_id
           ORDER BY p.promoted_at DESC
           LIMIT 1) AS belt_name
       FROM course_completions cc
       JOIN users u      ON u.id = cc.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN courses c    ON c.id = cc.course_id
       LEFT JOIN batches b     ON b.id = cc.batch_id
       LEFT JOIN users tu      ON tu.id = cc.trainer_id
       LEFT JOIN institutions i ON i.id = cc.institution_id
      WHERE ${filter}
        AND cc.status = 'awaiting_certificate'
      ORDER BY cc.belt_test_completed_at DESC NULLS LAST,
               cc.course_completed_at DESC`,
      [institutionId],
    );
    res.json({ count: r.rows.length, completions: r.rows });
  } catch (err) {
    console.error('listInstitutionAwaitingCertificate error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/course-completions/:id/send-certificate
//
// Institution admin dispatches the certificate for this completion.
// Flips status to 'certificate_sent', stamps certificate_sent_at and
// certificate_sent_by. Also inserts a lightweight row in the existing
// `certificates` table so the certificate is discoverable from the
// student's own belt/certificate history.
exports.sendCertificate = async (req, res) => {
  const client = await pool.connect();
  try {
    const adminId = req.user.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

    await client.query('BEGIN');

    const check = await client.query(
      `SELECT cc.*, c.name AS course_name, u.name AS student_name
         FROM course_completions cc
         JOIN courses c ON c.id = cc.course_id
         JOIN users u   ON u.id = cc.student_id
        WHERE cc.id = $1
        FOR UPDATE`,
      [id],
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Not found' });
    }
    const row = check.rows[0];

    // Institution access check — same rule as the list endpoint.
    const adminInst = await getMyInstitutionId(adminId);
    if (!adminInst) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'No institution linked' });
    }
    const parentRes = await client.query(
      `SELECT parent_institution_id FROM institutions WHERE id = $1`,
      [adminInst],
    );
    const isSubBranch = !!parentRes.rows[0]?.parent_institution_id;
    const allowed = isSubBranch
      ? adminInst === row.institution_id
      : (adminInst === row.institution_id
         || (await client.query(
              `SELECT 1 FROM institutions WHERE id = $1 AND parent_institution_id = $2`,
              [row.institution_id, adminInst],
            )).rows.length > 0);
    if (!allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not your student' });
    }

    if (row.status === 'certificate_sent') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Certificate already sent' });
    }

    // Certificate template + merged placeholder payload. Optional
    // template_id lets the admin pick a template; when omitted we fall
    // back to the institution's default (marked is_default = TRUE).
    // Any placeholder pin on the template gets its `value` filled in
    // from the student / completion data, and the merged array is
    // stored on certificates.placeholder_data so a re-render never has
    // to hit live tables again.
    const bodyTemplateId = Number.parseInt(req.body?.template_id, 10);
    let template = null;
    try {
      const t = await client.query(
        Number.isInteger(bodyTemplateId)
          ? `SELECT * FROM certificate_templates
              WHERE id = $1 AND institution_id = $2`
          : `SELECT * FROM certificate_templates
              WHERE institution_id = $1 AND is_default = TRUE
              ORDER BY updated_at DESC LIMIT 1`,
        Number.isInteger(bodyTemplateId) ? [bodyTemplateId, row.institution_id]
                                         : [row.institution_id],
      );
      template = t.rows[0] || null;
    } catch (tplErr) {
      // eslint-disable-next-line no-console
      console.log('[sendCertificate] template lookup skipped:', tplErr?.message);
    }

    // Sample values that map onto the standard placeholder keys.
    // `belt_name` is read from the request body when the admin picks it
    // (institution UI includes it on the row); otherwise falls back to
    // the student's most recent belt promotion, if any.
    let currentBelt = req.body?.belt_name || null;
    if (!currentBelt) {
      try {
        const bRes = await client.query(
          `SELECT bl.name
             FROM student_belt_promotions p
             JOIN belt_levels bl ON bl.id = p.belt_level_id
            WHERE p.student_id = $1
            ORDER BY p.promoted_at DESC LIMIT 1`,
          [row.student_id],
        );
        currentBelt = bRes.rows[0]?.name || null;
      } catch { /* belt tables optional */ }
    }
    // Fall back to the student's saved profile belt when nothing else
    // is available — this is what the admin sees in the students list.
    if (!currentBelt) {
      try {
        const spRes = await client.query(
          `SELECT belt_category FROM student_profiles WHERE user_id = $1`,
          [row.student_id],
        );
        currentBelt = spRes.rows[0]?.belt_category || null;
      } catch { /* profile table optional */ }
    }

    // Belt-range gate — refuse to dispatch when the picked template
    // has an active range and the student's belt sits outside it.
    // Same helper as the /prepare endpoint so the message the admin
    // sees in the preview matches what they'd see on Confirm.
    try {
      const { checkBeltRange } = require('./certificateTemplate.controller');
      const gate = checkBeltRange(template, currentBelt);
      if (!gate.ok) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          message: gate.message,
          code: 'BELT_RANGE_BLOCKED',
        });
      }
    } catch (rangeErr) {
      // eslint-disable-next-line no-console
      console.warn('[sendCertificate] belt-range check skipped:', rangeErr?.message);
    }
    const iRes = await client.query(
      `SELECT name, city FROM institutions WHERE id = $1`,
      [row.institution_id],
    );
    const trainerRes = row.trainer_id
      ? await client.query(`SELECT name FROM users WHERE id = $1`, [row.trainer_id])
      : { rows: [] };

    const now = new Date();
    const certNo = `VRF-${row.institution_id}-${now.getFullYear()}-${
      Math.floor(Math.random() * 90000) + 10000
    }`;
    // Defensive date coercion — pg normally returns TIMESTAMPTZ as
    // JavaScript Date objects, but occasionally connection pools or
    // middleware coerce them to strings. Calling .toISOString() on a
    // string throws, and this used to bubble as "Server error". Now
    // we accept string / Date / null and always emit YYYY-MM-DD.
    const toISODate = (v) => {
      if (!v) return now.toISOString().slice(0, 10);
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return now.toISOString().slice(0, 10);
      return d.toISOString().slice(0, 10);
    };
    // Belt PROGRESSION — resolve the student's most recent belt_
    // promotions row so the belt_from / belt_to placeholder pins can
    // render "White Belt → Yellow Belt" on the certificate. If no
    // promotion exists (e.g. certificate not tied to a grading
    // event), both fields resolve to '' and the pins render blank
    // per spec ("If a certificate is not associated with a belt
    // promotion, the fields should remain blank or be hidden").
    let beltFrom = '';
    let beltTo   = '';
    try {
      const bp = await client.query(
        `SELECT previous_belt, new_belt
           FROM belt_promotions
          WHERE student_id = $1
          ORDER BY promoted_at DESC
          LIMIT 1`,
        [row.student_id],
      );
      if (bp.rows.length > 0) {
        beltFrom = bp.rows[0].previous_belt || '';
        beltTo   = bp.rows[0].new_belt      || '';
      }
    } catch (_) {
      // Table missing / older schema — leave blank.
    }

    const values = {
      student_name:     row.student_name,
      course_name:      row.course_name,
      belt_name:        currentBelt || 'White Belt',
      belt_from:        beltFrom,
      belt_to:          beltTo,
      institution_name: iRes.rows[0]?.name || '',
      venue:            iRes.rows[0]?.city || '',
      completion_date:  toISODate(row.belt_test_completed_at || row.course_completed_at),
      certificate_no:   certNo,
      instructor_name:  trainerRes.rows[0]?.name || '',
      digital_signature:'',
    };
    // Drop inactive pins BEFORE storing the snapshot — this way the
    // student's view exactly matches the layout the admin approved on
    // the preview modal. Image-backed pins (digital_signature / seal)
    // also carry the template's signature_url / seal_url so the
    // student renderer never has to cross-reference the template row.
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

    // Insert a matching row in the shared certificates table so the
    // student sees the certificate in their history and the verify
    // page works out of the box.
    //
    // IMPORTANT — this used to reference `verify_token` and `notes`,
    // which don't exist on the certificates schema (migration 027 uses
    // `qr_token` NOT NULL UNIQUE and `description`). The failing INSERT
    // put the enclosing transaction into an aborted state, causing the
    // next UPDATE course_completions to fail with "current transaction
    // is aborted", which the outer catch surfaced as a generic 500.
    // We now:
    //   • Use a SAVEPOINT so an unexpected failure here doesn't poison
    //     the outer transaction.
    //   • Insert into columns that actually exist on certificates.
    //   • Provide qr_token (NOT NULL) and instructor_name for the
    //     verify page.
    let certId = null;
    try {
      await client.query('SAVEPOINT cert_insert');
      const crypto = require('crypto');
      const qrToken = crypto.randomBytes(12).toString('hex');
      const certRes = await client.query(
        `INSERT INTO certificates
           (student_id, institution_id, kind, title, description,
            issue_date, instructor_name, certificate_no, qr_token,
            template_id, placeholder_data, course_id, trainer_remarks)
         VALUES ($1, $2, 'completion', $3, $4,
                 CURRENT_DATE, $5, $6, $7,
                 $8, $9::jsonb, $10, $11)
         RETURNING id`,
        [
          row.student_id,
          row.institution_id,
          `${row.course_name} — Course Completion`,
          row.test_remarks || null,
          trainerRes.rows[0]?.name || null,
          certNo,
          qrToken,
          template?.id || null,
          JSON.stringify(mergedPlaceholders),
          row.course_id || null,
          row.test_remarks || null,
        ],
      );
      certId = certRes.rows[0]?.id || null;
      await client.query('RELEASE SAVEPOINT cert_insert');
    } catch (certErr) {
      // Roll back JUST the cert insert so the outer transaction stays
      // alive and the completion status update below still succeeds.
      // eslint-disable-next-line no-console
      console.warn('[sendCertificate] certificates insert failed, continuing without cert row:', certErr?.message);
      try { await client.query('ROLLBACK TO SAVEPOINT cert_insert'); } catch (_) {}
    }

    const upd = await client.query(
      `UPDATE course_completions
          SET status              = 'certificate_sent',
              certificate_sent_at = NOW(),
              certificate_sent_by = $2,
              certificate_id      = COALESCE($3, certificate_id),
              updated_at          = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, adminId, certId],
    );

    await client.query('COMMIT');
    res.json({
      message:    `Certificate sent to ${row.student_name}.`,
      completion: upd.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('sendCertificate error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
