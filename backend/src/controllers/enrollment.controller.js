const pool = require('../config/db');
// Use the same bcrypt package as the rest of the codebase (the native
// one, not bcryptjs). Both expose the same hash/compare API so no
// other code change is needed.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendStudentCredentialsEmail } = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');
const {
  validateEmailFormat, validatePhoneFormat,
  ensureEmailUnique, ensurePhoneUnique,
} = require('../utils/contactValidation');
// Branch-scope filter — main admins only see main-institution batches'
// students; sub-branch admins only see their own branch's students.
const { getBranchScope, batchBranchClause } = require('../utils/branchScope');

// Generates a short, human-shareable temp password for a newly-created
// student account. Mixed-case letters + digits, 10 chars long. Avoids
// ambiguous characters (O, 0, I, l, 1) so the student doesn't mis-type.
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) {
    pw += chars[crypto.randomInt(0, chars.length)];
  }
  return pw;
}

// GET /api/enrollments/all
// Platform-wide most-recent enrollments. Used by the super admin web
// dashboard's "Latest Enrollments" table. Soft-deleted institutions and
// users are excluded.
exports.getAllEnrollments = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         e.id,
         e.enrolled_at,
         e.payment_status,
         e.payment_amount,

         u.id    AS student_id,
         u.name  AS student_name,
         u.email AS student_email,

         c.id    AS course_id,
         c.name  AS course_name,

         b.id    AS batch_id,
         b.name  AS batch_name,

         i.id    AS institution_id,
         i.name  AS institution_name,
         i.city  AS institution_city
       FROM enrollments e
       JOIN users u   ON e.student_id = u.id
       JOIN batches b ON e.batch_id   = b.id
       JOIN courses c ON b.course_id  = c.id
       JOIN institutions i ON b.institution_id = i.id
       WHERE i.deleted_at IS NULL
         AND COALESCE(u.is_deleted, false) = false
       ORDER BY e.enrolled_at DESC
       LIMIT 20`,
    );

    res.json({
      count: result.rows.length,
      enrollments: result.rows,
    });
  } catch (err) {
    console.error('Get all enrollments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/enrollments/institution/me
// Every enrollment for the calling admin's institution, newest first.
// Drives the Earnings tab's payments list and the Students tab's roster on
// the mobile institution-admin app. Joined with student name + email,
// batch + course names, paid_at, and payment fields.
exports.getEnrollmentsForMyInstitution = async (req, res) => {
  try {
    const userId = req.user.id;

    // Branch scope — main admin sees only enrollments in main-institution
    // batches (b.branch_id IS NULL); sub-branch admin sees only their own
    // branch's enrollments (b.branch_id = <their inst>). We scope via
    // the batch join because enrollments.institution_id is stamped from
    // batch.institution_id, which varies (main batches use rootId,
    // sub-branch batches use the branch's own id) — so branch_id is the
    // single reliable column to filter on.
    const scope = await getBranchScope(userId);
    if (!scope) {
      return res.status(403).json({ message: 'You are not linked to an institution.' });
    }

    // Anchor to the academy tree: batches are scoped to institutions in
    // the caller's group (root or any of its sub-branches). We derive
    // this by comparing the batch's institution_id to either rootId
    // (main institution) or a child institution whose parent = rootId.
    const params = [scope.rootId];
    let where = `COALESCE(u.is_deleted, false) = false
                 AND (b.institution_id = $1
                      OR b.institution_id IN (
                        SELECT id FROM institutions
                         WHERE parent_institution_id = $1
                      ))`;
    const branchClause = batchBranchClause(scope, 'b', params);
    if (branchClause) where += ` AND ${branchClause}`;

    const result = await pool.query(
      `SELECT
         e.id,
         e.enrolled_at,
         e.payment_status,
         e.payment_amount,
         e.payment_mode,
         e.paid_at,
         e.payment_reference,
         e.payment_link_enabled,
         e.payment_link_url,
         e.payment_link_sent_at,

         u.id    AS student_id,
         u.name  AS student_name,
         u.email AS student_email,
         u.phone AS student_phone,

         sp.photo_url         AS student_photo_url,
         sp.gender            AS student_gender,
         sp.date_of_birth     AS student_date_of_birth,
         sp.address           AS student_address,
         sp.emergency_contact AS student_emergency_contact,

         c.id              AS course_id,
         c.name            AS course_name,
         c.duration_months AS course_duration_months,

         b.id         AS batch_id,
         b.name       AS batch_name,
         b.branch_id  AS batch_branch_id

       FROM enrollments e
       JOIN users u        ON e.student_id = u.id
       JOIN batches b      ON e.batch_id   = b.id
       JOIN courses c      ON b.course_id  = c.id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE ${where}
       ORDER BY e.enrolled_at DESC`,
      params,
    );

    // Counts strip for the mobile Earnings tab.
    const counts = result.rows.reduce(
      (acc, r) => {
        acc.total += 1;
        const amt = Number(r.payment_amount) || 0;
        if (r.payment_status === 'paid')    { acc.paid    += 1; acc.paid_amt    += amt; }
        if (r.payment_status === 'pending') { acc.pending += 1; acc.pending_amt += amt; }
        if (r.payment_status === 'failed')  { acc.failed  += 1; }
        return acc;
      },
      { total: 0, paid: 0, pending: 0, failed: 0, paid_amt: 0, pending_amt: 0 },
    );

    res.json({
      institution_id: scope.callerInstId,
      root_institution_id: scope.rootId,
      is_sub_branch: scope.isSubBranchAdmin,
      counts,
      enrollments:    result.rows,
    });
  } catch (err) {
    console.error('Get my institution enrollments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CREATE enrollment (student enrolls in a batch)
//
// The mobile enrollment form posts BOTH the batch_id and the student's full
// profile (14 fields) in one call. We upsert the profile and insert the
// enrollment in a single transaction so a failed profile write doesn't
// leave a dangling enrollment.
exports.enrollInBatch = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      batch_id,
      // Profile fields (all optional except full_name when sent)
      full_name,
      date_of_birth,
      gender,
      father_name,
      mother_name,
      contact_number,
      email,
      address,
      marital_status,
      occupation,
      height_cm,
      weight_kg,
      disabilities,
      photo_url,
    } = req.body;

    if (!batch_id) {
      return res.status(400).json({ message: 'batch_id is required' });
    }

    // ── Admin-mode branch ────────────────────────────────────────────
    // When an institution admin enrols a student from the admin app,
    // the request comes in with role='admin'. We don't want to enrol
    // the admin themselves — we want to (a) find or create a student
    // user account with the supplied email, (b) email them their login
    // credentials, then (c) use that user's id as the enrollment's
    // student_id. The rest of the controller continues unchanged.
    let studentId = req.user.id;
    let createdStudentCreds = null; // populated when we created a new account
    if (req.user.role === 'admin') {
      const adminMode = req.body?.admin_mode === true;
      const cleanName = String(full_name || '').trim();
      if (!adminMode || !cleanName) {
        return res.status(400).json({
          field: 'full_name',
          message: 'Admin enrolment needs full_name + email so we can create the student\'s login.',
        });
      }

      // ── Format checks ────────────────────────────────────────────
      // Email is REQUIRED in admin mode (it becomes the student's login).
      // Phone is OPTIONAL but if supplied must be a real 10-digit mobile.
      const eFmt = validateEmailFormat(email, { required: true });
      if (!eFmt.ok) return res.status(eFmt.status).json(eFmt.body);
      const pFmt = validatePhoneFormat(contact_number, { required: false });
      if (!pFmt.ok) return res.status(pFmt.status).json(pFmt.body);
      const cleanEmail = eFmt.value;

      // ── Phone uniqueness ─────────────────────────────────────────
      // We check the phone against every other user globally. If this
      // phone already belongs to someone (trainer, parent, another
      // student under a different academy), the admin can't reuse it.
      // We skip phone check when the phone matches an EXISTING student
      // account that this email would re-use (handled below).
      if (pFmt.value) {
        const phoneUnique = await ensurePhoneUnique(pFmt.value);
        // Allow the phone to belong to a soon-to-be-reused student row
        // (same email + same phone). Look that up before rejecting.
        if (!phoneUnique.ok) {
          const sameRow = await pool.query(
            `SELECT id FROM users
              WHERE LOWER(email) = $1 AND phone = $2 AND role = 'student'
              LIMIT 1`,
            [cleanEmail, pFmt.value],
          );
          if (sameRow.rows.length === 0) {
            return res.status(phoneUnique.status).json(phoneUnique.body);
          }
        }
      }
      // Find an existing student user with that email; otherwise create
      // one. We never overwrite an existing user's password — the admin
      // can ask them to use Forgot Password if they've lost it.
      const existing = await pool.query(
        `SELECT id, role FROM users WHERE LOWER(email) = $1`,
        [cleanEmail],
      );
      if (existing.rows[0]) {
        const u = existing.rows[0];
        if (u.role !== 'student') {
          return res.status(409).json({
            message: 'That email is already registered under a different role. Use a different email.',
          });
        }
        studentId = u.id;
      } else {
        // Create a fresh student account. Two paths:
        //
        //   • Payment link ON  → account lands as status='pending' with
        //     a random unusable password. NO credentials email or
        //     welcome SMS goes out yet — they're deferred until the
        //     Razorpay webhook confirms payment, at which point
        //     activateStudentAfterPayment() rotates the password,
        //     flips status='active', and mails everything.
        //
        //   • Payment link OFF → existing behaviour: status='active',
        //     temp password mailed immediately.
        //
        // The flag is read here so the two paths share the same INSERT.
        const linkEnabled = req.body?.enable_payment_link === true;
        const tempPassword = generateTempPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);
        // Find the admin's institution so we link the new student to it.
        const adminInst = await pool.query(
          `SELECT institution_id FROM users WHERE id = $1`,
          [req.user.id],
        );
        const institutionId = adminInst.rows[0]?.institution_id || null;
        // status: 'pending' when payment link — the login controller
        //         short-circuits with PAYMENT_PENDING so the student
        //         can't sign in until the webhook activates them.
        //         'active' otherwise (offline payment_mode branch).
        // must_change_password=TRUE either way — the student receives
        //         the temp password after payment (or right now, on
        //         the offline path) and the first-login dialog fires.
        const insertUser = await pool.query(
          `INSERT INTO users (name, email, phone, password, role, institution_id,
                              must_change_password, status)
           VALUES ($1, $2, $3, $4, 'student', $5, TRUE, $6)
           RETURNING id, name, email`,
          [cleanName, cleanEmail,
           String(contact_number || '').trim() || null,
           hashed, institutionId,
           linkEnabled ? 'pending' : 'active'],
        );
        studentId = insertUser.rows[0].id;
        // ONLY stash the credentials-send payload when we intend to
        // send it immediately (offline path). When the payment link is
        // enabled, we deliberately leave createdStudentCreds null so
        // the post-transaction send-block below is skipped — the
        // webhook path fires the mail after payment.
        if (!linkEnabled) {
          createdStudentCreds = {
            to: cleanEmail,
            name: cleanName,
            loginEmail: cleanEmail,
            password: tempPassword,
            phone: String(contact_number || '').trim() || null,
          };
        }
      }
    }

    // Get batch details + capacity check
    const batchResult = await pool.query(
      `SELECT b.*, c.price AS course_price,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       WHERE b.id = $1`,
      [batch_id]
    );

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Capacity check (batch-level — physical seat count for this batch).
    if (parseInt(batch.enrolled_count) >= batch.capacity) {
      return res.status(409).json({ message: 'Batch is full. No seats available.' });
    }

    // Plan-cap check (institution-level — total students under the
    // institution's subscription plan). This blocks both self-enrolment
    // by a student and admin-driven enrolment so neither path can sneak
    // past the cap. Returns the same 402 PLAN_LIMIT_REACHED shape the
    // mobile already knows how to render as an upgrade prompt.
    const overLimit = await ensureCapacity(batch.institution_id, 'students');
    if (overLimit) {
      return res.status(402).json(limitResponse('students', overLimit));
    }

    // Check duplicate enrollment
    const existing = await pool.query(
      'SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2',
      [studentId, batch_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'You are already enrolled in this batch' });
    }

    await client.query('BEGIN');

    // Upsert student profile. Caller may omit profile fields if the row
    // already exists (subsequent enrollments) - we COALESCE so we never wipe
    // existing values with NULL.
    if (full_name) {
      await client.query(
        `INSERT INTO student_profiles (
           user_id, full_name, date_of_birth, gender,
           father_name, mother_name,
           contact_number, email, address,
           marital_status, occupation,
           height_cm, weight_kg, disabilities,
           photo_url, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           full_name      = COALESCE(EXCLUDED.full_name,      student_profiles.full_name),
           date_of_birth  = COALESCE(EXCLUDED.date_of_birth,  student_profiles.date_of_birth),
           gender         = COALESCE(EXCLUDED.gender,         student_profiles.gender),
           father_name    = COALESCE(EXCLUDED.father_name,    student_profiles.father_name),
           mother_name    = COALESCE(EXCLUDED.mother_name,    student_profiles.mother_name),
           contact_number = COALESCE(EXCLUDED.contact_number, student_profiles.contact_number),
           email          = COALESCE(EXCLUDED.email,          student_profiles.email),
           address        = COALESCE(EXCLUDED.address,        student_profiles.address),
           marital_status = COALESCE(EXCLUDED.marital_status, student_profiles.marital_status),
           occupation     = COALESCE(EXCLUDED.occupation,     student_profiles.occupation),
           height_cm      = COALESCE(EXCLUDED.height_cm,      student_profiles.height_cm),
           weight_kg      = COALESCE(EXCLUDED.weight_kg,      student_profiles.weight_kg),
           disabilities   = COALESCE(EXCLUDED.disabilities,   student_profiles.disabilities),
           photo_url      = COALESCE(EXCLUDED.photo_url,      student_profiles.photo_url),
           updated_at     = NOW()`,
        [
          studentId, full_name, date_of_birth || null, gender || null,
          father_name || null, mother_name || null,
          contact_number || null, email || null, address || null,
          marital_status || null, occupation || null,
          height_cm != null ? Number(height_cm) : null,
          weight_kg != null ? Number(weight_kg) : null,
          disabilities || null,
          photo_url || null,
        ]
      );

      // Also sync users.name / users.phone / users.email if the form sent
      // updated values (admin lists pull from users so it must match).
      await client.query(
        `UPDATE users SET
           name  = COALESCE($1, name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email)
         WHERE id = $4`,
        [full_name || null, contact_number || null, email || null, studentId]
      );
    }

    // Create enrollment (status = pending; flips to paid via mock-pay)
    const result = await client.query(
      `INSERT INTO enrollments (student_id, batch_id, institution_id, payment_status, payment_amount)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING *`,
      [studentId, batch_id, batch.institution_id, batch.course_price || null]
    );

    // ── Admin-mode: pick the payment path ────────────────────────
    // Two branches now, driven by req.body.enable_payment_link:
    //
    //   • ON  → mint a Razorpay Payment Link, email it to the student,
    //          leave the enrolment as payment_status='pending'. The
    //          webhook flips it to 'paid' only when Razorpay confirms.
    //          Marked revenue_channel='wallet' so downstream reporting
    //          knows the (eventual) settlement belongs on the
    //          institution/branch wallet after platform + gateway
    //          deductions.
    //
    //   • OFF → existing offline-payment_mode flow. Money never
    //          touched the platform, so revenue_channel='revenue':
    //          the fee appears in Institution/Branch Revenue only
    //          and never affects the wallet balance.
    const ALLOWED_MODES = ['cash', 'upi', 'bank', 'cheque'];
    const rawMode = String(req.body?.payment_mode || '').trim().toLowerCase();
    const linkEnabled = req.body?.enable_payment_link === true;
    const isAdminMode = req.body?.admin_mode === true;

    if (isAdminMode && linkEnabled) {
      // ── Payment-link path ────────────────────────────────────
      // Mint a Razorpay Payment Link tied to this enrolment with
      // notes.action='enrollment_new' so the existing webhook
      // (/api/payments/webhook) flips the row to 'paid' on success.
      const enrollmentId = result.rows[0].id;
      const amount = Number(batch.course_price) || 0;
      if (amount <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: 'This course has no price configured — cannot mint a payment link.',
        });
      }
      // Look up the student + institution for the Razorpay customer.
      const stu = await client.query(
        `SELECT u.name, u.email, u.phone FROM users u WHERE u.id = $1`,
        [studentId],
      );
      const inst = await client.query(
        `SELECT id, name FROM institutions WHERE id = $1`,
        [batch.institution_id],
      );
      const { createPaymentLink } = require('../utils/razorpay');
      const link = await createPaymentLink({
        amountInRupees: amount,
        institution: {
          id:          inst.rows[0]?.id,
          name:        inst.rows[0]?.name || 'Veerify Academy',
          owner_name:  stu.rows[0]?.name,
          owner_email: stu.rows[0]?.email,
          owner_phone: stu.rows[0]?.phone,
          plan_name:   batch.course_name || 'Course fee',
        },
        notes: {
          action:        'enrollment_new',
          enrollment_id: String(enrollmentId),
          student_id:    String(studentId),
        },
      });
      if (!link.ok) {
        await client.query('ROLLBACK');
        return res.status(502).json({
          message: link.error || 'Could not create payment link. Please try again.',
        });
      }
      const upd = await client.query(
        `UPDATE enrollments SET
           payment_status       = 'pending',
           payment_reference    = $1,
           payment_link_enabled = TRUE,
           payment_link_url     = $2,
           payment_link_sent_at = NOW(),
           payment_amount       = COALESCE(payment_amount, $3),
           revenue_channel      = 'wallet'
         WHERE id = $4
         RETURNING *`,
        [link.link.id, link.link.short_url, amount, enrollmentId],
      );
      result.rows[0] = upd.rows[0];

      // Fire-and-forget email to the student with the Razorpay link.
      // We build the message inline here rather than adding another
      // mailer helper — the copy is one paragraph and one link.
      try {
        const { sendMail } = require('../utils/mailer');
        if (typeof sendMail === 'function' && stu.rows[0]?.email) {
          sendMail({
            to:      stu.rows[0].email,
            subject: `Complete your enrolment payment — ${inst.rows[0]?.name || 'Veerify'}`,
            text:
              `Hi ${stu.rows[0].name || 'there'},\n\n` +
              `You've been enrolled in ${batch.course_name || 'a course'} at ${inst.rows[0]?.name || 'Veerify'}.\n\n` +
              `Please complete your payment using the link below:\n\n` +
              `${link.link.short_url}\n\n` +
              `Amount payable: ₹${amount}\n\n` +
              `Once your payment is confirmed we'll email your login credentials + a welcome guide so you can start learning right away. ` +
              `Your enrolment stays in Pending Payment status until then — no account access before payment.`,
          }).catch((e) => console.warn('[enroll] link email failed:', e?.message));
        }
      } catch (mailErr) {
        console.warn('[enroll] mailer helper unavailable:', mailErr?.message);
      }
    } else if (isAdminMode && rawMode) {
      // ── Offline-payment path (unchanged behaviour) ──────────────
      if (!ALLOWED_MODES.includes(rawMode)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `payment_mode must be one of: ${ALLOWED_MODES.join(', ')}`,
        });
      }
      const reference = `${rawMode.toUpperCase()}-${Date.now()}-${result.rows[0].id}`;
      const amount = Number(batch.course_price) || 0;
      const paid = await client.query(
        `UPDATE enrollments SET
           payment_status    = 'paid',
           payment_mode      = $1,
           payment_reference = $2,
           payment_amount    = COALESCE(payment_amount, $3),
           paid_at           = NOW(),
           revenue_channel   = 'revenue'
         WHERE id = $4
         RETURNING *`,
        [rawMode, reference, amount, result.rows[0].id]
      );
      // Replace the row we return below so the caller sees the paid state.
      result.rows[0] = paid.rows[0];

      // Generate + email the invoice for this offline sale. Fire after
      // the transaction commits (below) so we don't do disk IO inside
      // the txn — deferred via setImmediate.
      const paidEnrollmentId = paid.rows[0].id;
      setImmediate(async () => {
        try {
          const { generateEnrollmentInvoice } = require('../utils/invoiceService');
          await generateEnrollmentInvoice({ enrollmentId: paidEnrollmentId });
        } catch (e) {
          console.error('[enroll] offline invoice failed:', e?.message);
        }
      });
    }

    // Update student's institution_id (if not set)
    await client.query(
      `UPDATE users SET institution_id = $1
       WHERE id = $2 AND institution_id IS NULL`,
      [batch.institution_id, studentId]
    );

    await client.query('COMMIT');

    // Fire-and-forget: if this enrolment pushed the institution over its
    // max_students cap, notify the owner so they can upgrade. We do this
    // OUTSIDE the transaction so a notification write hiccup never blocks
    // the student's enrolment.
    (async () => {
      try {
        const { getUsage } = require('../utils/planLimits');
        const { insertNotification } = require('./notification.controller');
        const usage = await getUsage(batch.institution_id, 'students');
        if (usage.exceeded) {
          // Find the institution owner.
          const owner = await pool.query(
            `SELECT owner_user_id FROM institutions WHERE id = $1`,
            [batch.institution_id],
          );
          const ownerId = owner.rows[0]?.owner_user_id;
          if (ownerId) {
            await insertNotification({
              user_id:        ownerId,
              institution_id: batch.institution_id,
              category:       'system',
              title:          'Student limit reached',
              message:        `Your ${usage.plan_name || 'current'} plan allows up to ${usage.limit} students. ` +
                              `You're at ${usage.current} after this enrolment — upgrade to unlock more capacity.`,
              data:           { screen: 'PlanSelection', reason: 'student_limit' },
            });
          }
        }
      } catch (err) {
        console.warn('[enroll] limit-notify failed:', err.message);
      }
    })();

    // Now that the transaction has committed, email the student their
    // login credentials if we created a fresh account during this
    // admin-mode call. Best-effort: a mail failure logs a warning but
    // doesn't fail the enrollment (the account exists and the admin can
    // re-share the password manually if needed).
    if (createdStudentCreds) {
      try {
        const inst = await pool.query(
          `SELECT i.name, c.name AS course_name
             FROM batches b
             JOIN courses c ON b.course_id = c.id
             JOIN institutions i ON b.institution_id = i.id
            WHERE b.id = $1`,
          [batch_id],
        );
        const mailResult = await sendStudentCredentialsEmail({
          ...createdStudentCreds,
          institutionName: inst.rows[0]?.name || 'your academy',
          courseName:      inst.rows[0]?.course_name || null,
        });
        if (!mailResult.ok) {
          console.warn('[enroll] student credentials email failed:', mailResult.error);
        }
      } catch (mailErr) {
        console.warn('[enroll] student credentials email threw:', mailErr.message);
      }

      // Welcome SMS — same temp password as the credentials email, so
      // the student can log in via either channel. Fire-and-forget: an
      // MSG91 outage never blocks the 201 response.
      if (createdStudentCreds.phone) {
        dispatchWelcomeSms({
          phone:        createdStudentCreds.phone,
          name:         createdStudentCreds.name,
          role:         'student',
          loginId:      createdStudentCreds.loginEmail,
          tempPassword: createdStudentCreds.password,
        });
      }
    }

    // Tailor the message:
    //   • paid + credentials emailed  → both confirmations
    //   • paid only                   → 'enrolled and payment recorded'
    //   • credentials only            → 'login details emailed'
    //   • neither (self-enrol)        → 'please complete payment'
    const paidNow = result.rows[0]?.payment_status === 'paid';
    let msg;
    if (paidNow && createdStudentCreds) {
      msg = 'Student enrolled, payment recorded, and login details emailed.';
    } else if (paidNow) {
      msg = 'Student enrolled and payment recorded.';
    } else if (createdStudentCreds) {
      msg = 'Student enrolled. Login details emailed to the student.';
    } else {
      msg = 'Enrolled successfully. Please complete payment.';
    }

    res.status(201).json({
      message: msg,
      enrollment: result.rows[0],
      student_credentials_sent: !!createdStudentCreds,
      payment_recorded: paidNow,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Enroll error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// ─── Student: create Razorpay payment link for a NEW enrollment ────────────
// POST /api/enrollments/:id/create-payment-link
//
// The enrollment row is created by /enrollments as payment_status='pending'
// (no Razorpay call happens at that point). This endpoint is called by the
// mobile after the enrollment form is submitted + validated. It:
//   1. Confirms the caller owns the enrollment and it isn't already paid.
//   2. Mints a Razorpay Payment Link with notes.action='enrollment_new'
//      so the webhook can flip the correct row on payment success.
//   3. Stamps the link id on payment_reference so the webhook lookup works.
//
// Returns { payment_url, transaction_id, provider, amount }. On Razorpay
// misconfiguration the response has `mock: true` and the mobile can
// route through the dev mock-pay flow instead.
//
// Payment_status stays 'pending' until the webhook fires — NEVER flipped
// by this endpoint. The mobile polls GET /:id/payment-status after
// returning from the Razorpay browser.
exports.createEnrollmentPaymentLink = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const enrol = await pool.query(
      `SELECT e.id, e.student_id, e.institution_id, e.payment_amount,
              e.payment_status,
              c.name AS course_name, c.price AS course_price,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email, u.phone AS student_phone
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         JOIN users u         ON u.id = e.student_id
        WHERE e.id = $1`,
      [id],
    );
    if (enrol.rows.length === 0) return res.status(404).json({ message: 'Enrollment not found' });
    const row = enrol.rows[0];
    if (row.student_id !== studentId) return res.status(403).json({ message: 'Not your enrollment' });
    if (row.payment_status === 'paid') {
      // Idempotent — already paid, tell the client to move on.
      return res.json({
        already_paid:   true,
        message:        'This enrollment is already paid.',
        payment_status: 'paid',
      });
    }

    const amount = Number(row.payment_amount || row.course_price || 0);
    if (amount <= 0) {
      return res.status(400).json({
        message: 'This course has no price configured — nothing to pay.',
      });
    }

    const { createPaymentLink } = require('../utils/razorpay');
    const link = await createPaymentLink({
      amountInRupees: amount,
      institution: {
        id:          row.institution_id,
        name:        row.institution_name,
        owner_name:  row.student_name,
        owner_email: row.student_email,
        owner_phone: row.student_phone,
        plan_name:   row.course_name,
      },
      notes: {
        action:        'enrollment_new',
        enrollment_id: String(row.id),
        student_id:    String(studentId),
      },
    });

    if (!link.ok) {
      // Dev fallback — no Razorpay creds. The mobile drops back to mock-pay.
      return res.json({
        mock:    true,
        message: link.error || 'Razorpay not configured — mock-pay available.',
      });
    }

    // Stamp the pending link id so the webhook lookup succeeds.
    await pool.query(
      `UPDATE enrollments
          SET payment_reference = $2,
              payment_status    = 'pending'
        WHERE id = $1`,
      [row.id, link.link.id],
    );

    res.json({
      payment_url:    link.link.short_url,
      provider:       'razorpay',
      transaction_id: link.link.id,
      amount,
      payment_status: 'pending',
    });
  } catch (err) {
    console.error('createEnrollmentPaymentLink error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// activateStudentAfterPayment — called by the Razorpay webhook right
// after enrollment_new flips payment_status='paid'. Rotates the temp
// password, activates the users row, then fires the credentials email
// and welcome SMS. Idempotent — subsequent calls for the same
// enrollment are a no-op (status stays 'active', no duplicate mail).
//
// Returns { ok, sent } — used by the webhook only for logging; the
// webhook always acks 200 to Razorpay regardless.
exports.activateStudentAfterPayment = async function (enrollmentId) {
  try {
    const r = await pool.query(
      `SELECT e.id, e.student_id, e.payment_amount,
              c.name AS course_name,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email,
              u.phone AS student_phone, u.status AS user_status
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         JOIN users u         ON u.id = e.student_id
        WHERE e.id = $1`,
      [enrollmentId],
    );
    if (r.rows.length === 0) return { ok: false, error: 'Enrollment not found' };
    const row = r.rows[0];

    // Idempotency guard — if the student is already active, they've
    // already been credential-mailed. A webhook retry from Razorpay
    // shouldn't send a fresh password over an active account (that
    // would silently rotate the student's password after they may
    // have already logged in and set their own).
    if (row.user_status === 'active') {
      return { ok: true, sent: false, alreadyActive: true };
    }

    // Rotate the temp password so a NEW random one is emailed. The
    // password set at enrolment time was never sent to the student
    // (that mail was deferred pending payment), so nothing is lost.
    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    await pool.query(
      `UPDATE users SET
         password             = $1,
         status               = 'active',
         must_change_password = TRUE,
         updated_at           = NOW()
       WHERE id = $2`,
      [hashed, row.student_id],
    );

    // Send credentials email — same helper the offline / trainer
    // flows already use, so the copy stays consistent.
    try {
      await sendStudentCredentialsEmail({
        to:              row.student_email,
        name:            row.student_name,
        loginEmail:      row.student_email,
        password:        tempPassword,
        institutionName: row.institution_name,
        courseName:      row.course_name,
      });
    } catch (mailErr) {
      console.warn('[activateStudent] credentials mail failed:', mailErr?.message);
    }

    // Welcome SMS (fire-and-forget). Falls through silently when the
    // student has no phone.
    if (row.student_phone) {
      dispatchWelcomeSms({
        phone:        row.student_phone,
        name:         row.student_name,
        role:         'student',
        loginId:      row.student_email,
        tempPassword,
      });
    }

    return { ok: true, sent: true };
  } catch (err) {
    console.error('[activateStudent] error:', err);
    return { ok: false, error: err?.message || 'Activate failed' };
  }
};

// POST /api/enrollments/:id/resend-payment-link
//
// Admin re-mints the Razorpay Payment Link for an enrolment that's
// still pending. Useful when the original email got lost or the
// student wants a fresh URL. Only works when payment_link_enabled=TRUE
// AND the row hasn't been paid yet. Returns { payment_url } so the
// admin UI can also render a copy button.
exports.resendPaymentLink = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

    // Institution scope — the caller's institution must own the batch
    // this enrolment belongs to.
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [req.user.id],
    );
    const adminInst = u.rows[0]?.institution_id;
    if (!adminInst) return res.status(403).json({ message: 'No institution linked' });

    const e = await pool.query(
      `SELECT e.*, c.name AS course_name, c.price AS course_price,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email, u.phone AS student_phone
         FROM enrollments e
         JOIN batches b ON b.id = e.batch_id
         JOIN courses c ON c.id = b.course_id
         JOIN institutions i ON i.id = e.institution_id
         JOIN users u ON u.id = e.student_id
        WHERE e.id = $1`,
      [id],
    );
    if (e.rows.length === 0) return res.status(404).json({ message: 'Enrollment not found' });
    const row = e.rows[0];
    // The caller can be the main-institution admin OR a sub-branch
    // admin whose branch owns the batch's institution row.
    if (row.institution_id !== adminInst) {
      const parent = await pool.query(
        `SELECT 1 FROM institutions
          WHERE id = $1 AND parent_institution_id = $2`,
        [row.institution_id, adminInst],
      );
      if (parent.rows.length === 0) {
        return res.status(403).json({ message: 'Not your enrollment' });
      }
    }
    if (!row.payment_link_enabled) {
      return res.status(400).json({
        message: 'Payment Link is not enabled for this enrolment. Toggle it on and re-enrol to send a link.',
      });
    }
    if (row.payment_status === 'paid') {
      return res.status(400).json({ message: 'This enrolment is already paid.' });
    }

    const amount = Number(row.payment_amount || row.course_price || 0);
    const { createPaymentLink } = require('../utils/razorpay');
    const link = await createPaymentLink({
      amountInRupees: amount,
      institution: {
        id:          row.institution_id,
        name:        row.institution_name,
        owner_name:  row.student_name,
        owner_email: row.student_email,
        owner_phone: row.student_phone,
        plan_name:   row.course_name,
      },
      notes: {
        action:        'enrollment_new',
        enrollment_id: String(row.id),
        student_id:    String(row.student_id),
      },
    });
    if (!link.ok) {
      return res.status(502).json({
        message: link.error || 'Could not regenerate the payment link.',
      });
    }
    const upd = await pool.query(
      `UPDATE enrollments
          SET payment_reference    = $2,
              payment_link_url     = $3,
              payment_link_sent_at = NOW(),
              payment_status       = 'pending'
        WHERE id = $1
        RETURNING *`,
      [row.id, link.link.id, link.link.short_url],
    );

    // Fire the email again (best-effort).
    try {
      const { sendMail } = require('../utils/mailer');
      if (typeof sendMail === 'function' && row.student_email) {
        sendMail({
          to:      row.student_email,
          subject: `Payment reminder — ${row.institution_name}`,
          text:
            `Hi ${row.student_name || 'there'},\n\n` +
            `Here's a fresh link to complete your enrolment payment:\n\n` +
            `${link.link.short_url}\n\n` +
            `Amount payable: ₹${amount}\n\n` +
            `Your enrolment stays as Pending Payment until the gateway confirms your transaction.`,
        }).catch((e) => console.warn('[resendPaymentLink] mail failed:', e?.message));
      }
    } catch (mailErr) {
      console.warn('[resendPaymentLink] mailer helper unavailable:', mailErr?.message);
    }

    res.json({
      message:      'Payment link regenerated and emailed to the student.',
      payment_url:  link.link.short_url,
      enrollment:   upd.rows[0],
    });
  } catch (err) {
    console.error('resendPaymentLink error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/enrollments/:id/payment-status
// Poll endpoint. The mobile hits this on an interval after returning
// from the Razorpay checkout browser to detect when the webhook has
// arrived and flipped the row to 'paid'.
exports.paymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    const r = await pool.query(
      `SELECT id, student_id, payment_status, payment_amount, paid_at, payment_reference
         FROM enrollments WHERE id = $1`, [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (r.rows[0].student_id !== studentId) return res.status(403).json({ message: 'Not yours' });
    res.json({ enrollment: r.rows[0] });
  } catch (err) {
    console.error('paymentStatus error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// MOCK PAYMENT - flips an enrollment from pending to paid. Kept ONLY for
// dev-mode fallbacks when Razorpay isn't configured. Real production
// flow must go through createEnrollmentPaymentLink → Razorpay hosted
// page → webhook. The mobile invokes this only when the payment-link
// call returned { mock: true }.
exports.mockPay = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    // Confirm the caller owns this enrollment.
    const e = await pool.query(
      `SELECT e.*, c.price AS course_price
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       WHERE e.id = $1`,
      [id]
    );
    if (e.rows.length === 0) return res.status(404).json({ message: 'Enrollment not found' });
    if (e.rows[0].student_id !== studentId) {
      return res.status(403).json({ message: 'Not your enrollment' });
    }
    if (e.rows[0].payment_status === 'paid') {
      return res.json({ message: 'Already paid', enrollment: e.rows[0] });
    }

    const reference = `MOCK-${Date.now()}-${id}`;
    const amount = Number(e.rows[0].payment_amount) || Number(e.rows[0].course_price) || 0;

    const updated = await pool.query(
      `UPDATE enrollments SET
         payment_status    = 'paid',
         payment_reference = $1,
         payment_amount    = COALESCE(payment_amount, $2),
         paid_at           = NOW()
       WHERE id = $3
       RETURNING *`,
      [reference, amount, id]
    );

    res.json({
      message: 'Payment successful',
      enrollment: updated.rows[0],
      reference,
    });
  } catch (err) {
    console.error('Mock pay error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET student's own profile (for prefilling the enrollment form on
// subsequent enrollments).
exports.getMyProfile = async (req, res) => {
  try {
    // Return a merged view: users columns the student is allowed to
    // edit (name / email / phone) + the full student_profiles row.
    // Also flags which fields are institution-managed (read-only) so
    // the mobile can lock them without a second round-trip.
    const r = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.phone, u.role, u.status,
         to_char(sp.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         sp.gender,
         sp.father_name, sp.mother_name, sp.contact_number,
         sp.email AS profile_email,
         sp.address, sp.marital_status, sp.occupation,
         sp.height_cm, sp.weight_kg, sp.disabilities,
         sp.photo_url,
         sp.emergency_contact,
         sp.created_at AS profile_created_at
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.id = $1`,
      [req.user.id],
    );
    res.json({ profile: r.rows[0] || null });
  } catch (err) {
    console.error('Get my profile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PATCH /api/enrollments/me/profile
//
// Student-facing self-service profile editor. Updates the users row
// (name / email / phone) AND the student_profiles row (DOB, gender,
// address, emergency contact, photo, etc.) inside one transaction.
// Any field left out of the body is left untouched.
//
// Institution-managed fields (student_id / institution / belt / enrollment
// data) live on OTHER tables and are silently ignored if sent — they
// aren't in the write list.
exports.updateMyProfile = async (req, res) => {
  const userId = req.user.id;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── users row (name / email / phone) ─────────────────────────
    // Validate + uniqueness only when the field is actually sent.
    const {
      validateEmailFormat, validatePhoneFormat,
      ensureEmailUnique,   ensurePhoneUnique,
    } = require('../utils/contactValidation');

    // Email is the student's sign-in identifier — we IGNORE any attempt
    // to change it from the mobile Edit Profile screen. If the client
    // sends a value that differs from what's already on the row, we
    // silently drop it so uniqueness checks never trip on the student's
    // own address. Institution admins can still change a student's
    // email via the admin-side edit flow if truly needed.
    if (b.email !== undefined) {
      const existing = await client.query(
        `SELECT email FROM users WHERE id = $1`, [userId],
      );
      const currentEmail = String(existing.rows[0]?.email || '').toLowerCase();
      const sentEmail    = String(b.email || '').trim().toLowerCase();
      if (sentEmail && sentEmail !== currentEmail) {
        // Drop the request quietly — the field is read-only.
        b.email = currentEmail;
      }
    }
    if (b.phone !== undefined) {
      const phone = String(b.phone || '').trim();
      if (phone && !validatePhoneFormat(phone)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Please enter a valid phone number.' });
      }
      if (phone) {
        // ensurePhoneUnique returns { ok: true } when free, or
        // { ok: false, status, body } when taken. Truthy-checking the
        // whole object was the bug — every call registered as a clash.
        const check = await ensurePhoneUnique(phone, { excludeUserId: userId });
        if (!check.ok) {
          await client.query('ROLLBACK');
          return res.status(check.status || 409).json(
            check.body || { message: 'That phone number is already registered.' },
          );
        }
      }
    }

    // Partial UPDATE on users. COALESCE keeps the current value when
    // the field wasn't sent (undefined → SQL NULL → COALESCE).
    await client.query(
      `UPDATE users SET
         name  = COALESCE(NULLIF($2, ''), name),
         email = COALESCE(NULLIF($3, ''), email),
         phone = COALESCE(NULLIF($4, ''), phone)
       WHERE id = $1`,
      [
        userId,
        b.name  != null ? String(b.name).trim()  : '',
        b.email != null ? String(b.email).trim().toLowerCase() : '',
        b.phone != null ? String(b.phone).trim() : '',
      ],
    );

    // ── student_profiles row (photo, DOB, address, etc.) ─────────
    // UPSERT so a first-time save from the profile screen creates
    // the row cleanly. Any column not sent gets COALESCE'd against
    // its current value.
    const existingSp = await client.query(
      `SELECT id FROM student_profiles WHERE user_id = $1`, [userId],
    );

    const spCols = {
      full_name:       b.name  != null ? String(b.name).trim()  : null,
      date_of_birth:   b.date_of_birth != null && String(b.date_of_birth).trim() !== ''
                         ? String(b.date_of_birth).slice(0, 10) : null,
      gender:          b.gender != null ? String(b.gender).slice(0, 20) : null,
      father_name:     b.father_name != null ? String(b.father_name).slice(0, 150) : null,
      mother_name:     b.mother_name != null ? String(b.mother_name).slice(0, 150) : null,
      // Emergency contact lives on its own column. contact_number
      // mirrors users.phone so admin queries always match the primary
      // phone the student just updated.
      emergency_contact: b.emergency_contact != null ? String(b.emergency_contact).trim().slice(0, 20) : null,
      contact_number:    b.phone           != null ? String(b.phone).trim().slice(0, 20)
                         : b.contact_number != null ? String(b.contact_number).trim().slice(0, 20)
                         : null,
      // profile_email mirrors users.email for the same reason.
      email:           b.email          != null ? String(b.email).trim().slice(0, 150)
                       : b.profile_email != null ? String(b.profile_email).trim().slice(0, 150) : null,
      address:         b.address != null ? String(b.address).slice(0, 500) : null,
      marital_status:  b.marital_status != null ? String(b.marital_status).slice(0, 40) : null,
      occupation:      b.occupation != null ? String(b.occupation).slice(0, 120) : null,
      height_cm:       Number.isFinite(b.height_cm) ? b.height_cm : null,
      weight_kg:       Number.isFinite(b.weight_kg) ? b.weight_kg : null,
      disabilities:    b.disabilities != null ? String(b.disabilities).slice(0, 500) : null,
      photo_url:       b.photo_url != null ? String(b.photo_url).slice(0, 500) : null,
    };

    if (existingSp.rows.length === 0) {
      // Insert with the current user's name as full_name fallback.
      const nameRes = await client.query(
        `SELECT name FROM users WHERE id = $1`, [userId],
      );
      const fullName = spCols.full_name || nameRes.rows[0]?.name || 'Student';
      await client.query(
        `INSERT INTO student_profiles
           (user_id, full_name, date_of_birth, gender,
            father_name, mother_name, contact_number, email, address,
            marital_status, occupation, height_cm, weight_kg,
            disabilities, photo_url, emergency_contact, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 $10, $11, $12, $13, $14, $15, $16, NOW())`,
        [
          userId, fullName, spCols.date_of_birth, spCols.gender,
          spCols.father_name, spCols.mother_name, spCols.contact_number,
          spCols.email, spCols.address, spCols.marital_status,
          spCols.occupation, spCols.height_cm, spCols.weight_kg,
          spCols.disabilities, spCols.photo_url, spCols.emergency_contact,
        ],
      );
    } else {
      await client.query(
        `UPDATE student_profiles SET
           full_name         = COALESCE($2, full_name),
           date_of_birth     = COALESCE($3, date_of_birth),
           gender            = COALESCE($4, gender),
           father_name       = COALESCE($5, father_name),
           mother_name       = COALESCE($6, mother_name),
           contact_number    = COALESCE($7, contact_number),
           email             = COALESCE($8, email),
           address           = COALESCE($9, address),
           marital_status    = COALESCE($10, marital_status),
           occupation        = COALESCE($11, occupation),
           height_cm         = COALESCE($12, height_cm),
           weight_kg         = COALESCE($13, weight_kg),
           disabilities      = COALESCE($14, disabilities),
           photo_url         = COALESCE($15, photo_url),
           emergency_contact = COALESCE($16, emergency_contact),
           updated_at        = NOW()
         WHERE user_id = $1`,
        [
          userId,
          spCols.full_name, spCols.date_of_birth, spCols.gender,
          spCols.father_name, spCols.mother_name, spCols.contact_number,
          spCols.email, spCols.address, spCols.marital_status,
          spCols.occupation, spCols.height_cm, spCols.weight_kg,
          spCols.disabilities, spCols.photo_url, spCols.emergency_contact,
        ],
      );
    }

    await client.query('COMMIT');

    // Return the merged profile for immediate UI hydration.
    const merged = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role,
              to_char(sp.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
              sp.gender, sp.father_name, sp.mother_name,
              sp.contact_number, sp.email AS profile_email, sp.address,
              sp.marital_status, sp.occupation, sp.height_cm, sp.weight_kg,
              sp.disabilities, sp.photo_url, sp.emergency_contact
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    res.json({
      message: 'Profile updated successfully',
      profile: merged.rows[0] || null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('updateMyProfile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// GET my enrollments (student)
//
// Includes course_image_url + institution_logo_url so the mobile
// Enrolled Programs cards can render the real thumbnail per course.
// The mobile falls back through course image → institution logo →
// branded placeholder, so any missing image degrades gracefully
// without breaking the card layout.
exports.getMyEnrollments = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT e.*,
              b.name AS batch_name, b.course_id, b.days_of_week, b.start_time, b.end_time, b.mode,
              c.name AS course_name, c.price AS course_price,
              c.image_url AS course_image_url,
              i.name AS institution_name, i.city AS institution_city,
              i.logo_url AS institution_logo_url,
              u.name AS trainer_name
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON e.institution_id = i.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE e.student_id = $1
       ORDER BY e.enrolled_at DESC`,
      [studentId]
    );

    res.json({ count: result.rows.length, enrollments: result.rows });
  } catch (err) {
    console.error('Get my enrollments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET students enrolled in a batch (admin/trainer view)
exports.getEnrollmentsByBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get batch info — include branch_id so we can enforce branch scope.
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id, branch_id FROM batches WHERE id = $1',
      [id]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Authorization check
    if (userRole === 'admin') {
      // Admin must own this batch's institution AND be scoped to its
      // branch. Main-institution admin can only see batches with
      // branch_id IS NULL; sub-branch admins only see batches whose
      // branch_id matches their own institution.
      const scope = await getBranchScope(userId);
      if (!scope || scope.rootId !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
      if (scope.isSubBranchAdmin) {
        if (batch.branch_id !== scope.callerInstId) {
          return res.status(403).json({ message: 'This batch is not at your branch' });
        }
      } else if (batch.branch_id != null) {
        // Main admin trying to peek at a sub-branch batch.
        return res.status(403).json({ message: 'This batch belongs to a sub-branch' });
      }
    } else if (userRole === 'trainer') {
      // Trainer must be assigned to this batch
      const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [userId]);
      if (trainerResult.rows.length === 0 || trainerResult.rows[0].id !== batch.trainer_id) {
        return res.status(403).json({ message: 'You are not assigned to this batch' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get enrollments
    const result = await pool.query(
      `SELECT e.*, u.name AS student_name, u.email AS student_email, u.phone AS student_phone
       FROM enrollments e
       JOIN users u ON e.student_id = u.id
       WHERE e.batch_id = $1
       ORDER BY e.enrolled_at`,
      [id]
    );

    res.json({ count: result.rows.length, enrollments: result.rows });
  } catch (err) {
    console.error('Get enrollments by batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET every student enrolled in ANY of the trainer's assigned batches,
// in ONE shot. Powers the trainer's "View Students" screen.
//
// The old flow issued N+1 requests (one /enrollments/batch/:id per batch)
// and returned a thin payload (only name + email). This endpoint replaces
// both: one query joins every batch the trainer teaches with every
// enrollment in those batches, and the response carries the full detail
// the screen needs (name, phone, photo, course, batch, branch, payment).
//
// Behaviour:
//   • Skips soft-deleted students.
//   • Includes branch info ("Main Institution" for branch_id IS NULL,
//     otherwise the sub-branch's name).
//   • Returns `trainer_id` = null-safe empty array (never 500) when the
//     caller has no trainer profile yet.
//   • De-duplication is left to the client (one student may be in two
//     of the trainer's batches). We return one row PER enrollment so
//     "which batch" info is preserved.
exports.getStudentsForMyTrainerBatches = async (req, res) => {
  try {
    const userId = req.user.id;

    // Resolve trainer_id from the logged-in user.
    const trainerRow = await pool.query(
      `SELECT id, institution_id FROM trainers WHERE user_id = $1`,
      [userId],
    );
    if (trainerRow.rows.length === 0) {
      // A trainer login without a trainers row — return empty so the UI
      // shows the "No batches assigned" empty state instead of erroring.
      return res.json({
        count: 0, batches_count: 0, students: [], has_batches: false,
        diagnostic: 'no_trainer_row',
      });
    }
    const trainerId = trainerRow.rows[0].id;

    // Pull every enrollment for every batch the trainer teaches.
    // JOIN order: batches (scoped to the trainer) → enrollments →
    // student user + profile + course. student_profiles is LEFT joined
    // because it's optional (older students may not have a profile row).
    const result = await pool.query(
      `SELECT
         e.id                       AS enrollment_id,
         e.enrolled_at,
         e.payment_status,
         e.payment_amount,
         e.paid_at,

         u.id                       AS student_id,
         u.name                     AS student_name,
         u.email                    AS student_email,
         u.phone                    AS student_phone,

         sp.photo_url               AS student_photo_url,
         sp.gender                  AS student_gender,
         sp.date_of_birth           AS student_date_of_birth,
         sp.address                 AS student_address,

         c.id                       AS course_id,
         c.name                     AS course_name,
         c.category                 AS course_category,

         b.id                       AS batch_id,
         b.name                     AS batch_name,
         b.days_of_week,
         b.start_time,
         b.end_time,
         b.mode                     AS batch_mode,
         b.branch_id                AS batch_branch_id,
         COALESCE(bi.name, 'Main Institution') AS batch_branch_name,
         (bi.parent_institution_id IS NOT NULL) AS is_sub_branch_batch

       FROM batches b
       JOIN enrollments e ON e.batch_id = b.id
       JOIN users u       ON u.id = e.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN courses c     ON c.id = b.course_id
       LEFT JOIN institutions bi ON bi.id = b.branch_id
       WHERE b.trainer_id = $1
         AND COALESCE(u.is_deleted, false) = false
       ORDER BY b.name, u.name`,
      [trainerId],
    );

    // Also surface how many batches the trainer has, so the mobile can
    // distinguish "no batches assigned" from "batches exist but empty".
    const batchesRow = await pool.query(
      `SELECT COUNT(*)::int AS n FROM batches WHERE trainer_id = $1`,
      [trainerId],
    );

    const bc = Number(batchesRow.rows[0]?.n || 0);

    res.json({
      count:         result.rows.length,
      batches_count: bc,
      has_batches:   bc > 0,
      students:      result.rows,
      trainer_id:    trainerId,
      diagnostic:    bc === 0
        ? 'trainer_has_no_batches'
        : result.rows.length === 0
          ? 'batches_have_no_enrollments'
          : 'ok',
    });
  } catch (err) {
    console.error('Get students for trainer batches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET every enrollment across every batch of a single course. Admin-only,
// scoped to the admin's own institution. Used by the admin Course Detail
// screen to show the full enrolled roster + payment status in one shot.
//
// Branch scoping: main-admin sees only enrollments in main-institution
// batches (batch.branch_id IS NULL); sub-branch admin sees only their
// own branch's enrollments in this course. Enforces the "students belong
// to the login of their batch's branch" rule.
exports.getEnrollmentsByCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const scope = await getBranchScope(userId);
    if (!scope) {
      return res.status(403).json({ message: 'No institution linked to your account' });
    }

    // Course must belong to the caller's academy group. Courses are
    // stored under the root institution so we check against rootId.
    const courseRes = await pool.query(
      'SELECT id, institution_id, name FROM courses WHERE id = $1',
      [id],
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }
    if (courseRes.rows[0].institution_id !== scope.rootId) {
      return res.status(403).json({ message: 'Not your course' });
    }

    // Anchor to the caller's academy tree via the batch's institution_id.
    // For sub-branch batches, batch.institution_id = the sub-branch's id
    // rather than the root, so we accept either the root or any of its
    // children (sub-branches).
    const params = [id, scope.rootId];
    let where = `b.course_id = $1
                 AND (b.institution_id = $2
                      OR b.institution_id IN (
                        SELECT id FROM institutions
                         WHERE parent_institution_id = $2
                      ))`;
    const branchClause = batchBranchClause(scope, 'b', params);
    if (branchClause) where += ` AND ${branchClause}`;

    // Aggregate every enrollment across every batch under this course
    // (scoped to the caller's branch).
    const result = await pool.query(
      `SELECT
         e.id              AS enrollment_id,
         e.enrolled_at,
         e.payment_status,
         e.student_id,
         u.name            AS student_name,
         u.email           AS student_email,
         u.phone           AS student_phone,
         b.id              AS batch_id,
         b.name            AS batch_name,
         b.branch_id       AS batch_branch_id,
         b.days_of_week,
         b.start_time,
         b.end_time
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN users   u ON e.student_id = u.id
       WHERE ${where}
       ORDER BY e.enrolled_at DESC`,
      params,
    );

    res.json({
      count: result.rows.length,
      enrollments: result.rows,
    });
  } catch (err) {
    console.error('Get enrollments by course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// CANCEL enrollment (student deletes their own)
exports.cancelEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      'SELECT student_id FROM enrollments WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    if (check.rows[0].student_id !== studentId) {
      return res.status(403).json({ message: 'You can only cancel your own enrollments' });
    }

    await pool.query('DELETE FROM enrollments WHERE id = $1', [id]);
    res.json({ message: 'Enrollment cancelled' });
  } catch (err) {
    console.error('Cancel enrollment error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// MARK as paid (fake payment for demo)
exports.markPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      'SELECT student_id FROM enrollments WHERE id = $1',
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    if (check.rows[0].student_id !== studentId) {
      return res.status(403).json({ message: 'Not your enrollment' });
    }

    const result = await pool.query(
      `UPDATE enrollments SET payment_status = 'paid' 
       WHERE id = $1 RETURNING *`,
      [id]
    );

    res.json({
      message: 'Payment successful',
      enrollment: result.rows[0]
    });
  } catch (err) {
    console.error('Mark paid error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// ─── Student: renew an enrollment ───────────────────────────────────────────
// POST /api/enrollments/:id/renew
//
// Creates a Razorpay payment link for the student to re-pay for an
// existing enrollment (either currently active-nearing-expiry, or
// already expired). On the Android emulator without Razorpay creds,
// the endpoint short-circuits into a mock-pay path — the caller can
// then confirm via POST /:id/mock-pay.
//
// Response shape:
//   { payment_url: <razorpay short_url>,  provider: 'razorpay',  transaction_id: 'plink_xxx' }
// OR (dev fallback):
//   { mock: true, message: 'Razorpay not configured — mock-pay available.' }
exports.renewEnrollment = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    // Own the row.
    const enrol = await pool.query(
      `SELECT e.id, e.student_id, e.institution_id, e.payment_amount,
              e.payment_status, e.paid_at, e.enrolled_at,
              c.name AS course_name, c.price AS course_price,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email, u.phone AS student_phone
         FROM enrollments e
         JOIN batches b ON b.id = e.batch_id
         JOIN courses c ON c.id = b.course_id
         JOIN institutions i ON i.id = e.institution_id
         JOIN users u ON u.id = e.student_id
        WHERE e.id = $1`,
      [id],
    );
    if (enrol.rows.length === 0) return res.status(404).json({ message: 'Enrollment not found' });
    const row = enrol.rows[0];
    if (row.student_id !== studentId) return res.status(403).json({ message: 'Not your enrollment' });

    const amount = Number(row.payment_amount || row.course_price || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: 'This course has no price configured — nothing to renew.' });
    }

    // Try Razorpay first. Falls back to the mock-pay dev flow when the
    // helper reports "Razorpay not configured".
    const { createPaymentLink } = require('../utils/razorpay');
    const link = await createPaymentLink({
      amountInRupees: amount,
      institution: {
        id: row.institution_id,
        name: row.institution_name,
        owner_name:  row.student_name,
        owner_email: row.student_email,
        owner_phone: row.student_phone,
        plan_name:   row.course_name,
      },
      notes: {
        action:        'enrollment_renew',
        enrollment_id: String(row.id),
        student_id:    String(studentId),
      },
    });

    if (!link.ok) {
      // No Razorpay creds → surface a mock-pay hint the mobile can act on.
      return res.json({
        mock:    true,
        message: link.error || 'Razorpay not configured — using dev mock-pay.',
      });
    }

    // Persist the pending link on the enrollment so the webhook can
    // find it. `payment_reference` doubles as the transaction id we
    // return to the mobile now, and again on the paid confirmation.
    await pool.query(
      `UPDATE enrollments
          SET payment_reference = $2,
              payment_status    = 'pending'
        WHERE id = $1`,
      [row.id, link.link.id],
    );

    res.json({
      payment_url:    link.link.short_url,
      provider:       'razorpay',
      transaction_id: link.link.id,
      amount,
    });
  } catch (err) {
    console.error('renewEnrollment error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/enrollments/:id/renewal-status
// Cheap polling endpoint the mobile hits after the user returns from
// Razorpay. Returns the current payment_status so we can flip the UI.
exports.renewalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;
    const r = await pool.query(
      `SELECT id, student_id, payment_status, payment_amount, paid_at, payment_reference
         FROM enrollments WHERE id = $1`, [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (r.rows[0].student_id !== studentId) return res.status(403).json({ message: 'Not yours' });
    res.json({ enrollment: r.rows[0] });
  } catch (err) {
    console.error('renewalStatus error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Admin: update a student's profile + user record ────────────────────────
// PATCH /api/enrollments/student/:userId
//
// Used by the institution admin from StudentDetailScreen edit pencil.
// Updates the users row (name, email, phone) and the student_profiles row
// (address, father, mother, DOB, gender). Skips fields that arrive as
// empty / undefined so partial saves are safe. Validates email/phone
// uniqueness with the existing contactValidation helpers (passing
// excludeUserId so the student's own email/phone don't collide with
// themselves).
exports.updateStudentByAdmin = async (req, res) => {
  // req.user is decoded jwt; the correct field is `id` (not `userId`).
  // Fall back to `userId` for safety in case an older token variant is
  // still in flight.
  const adminId   = req.user.id || req.user.userId;
  const studentId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(studentId)) {
    return res.status(400).json({ message: 'Invalid student id' });
  }

  const {
    name, email, phone,
    address, father_name, mother_name,
    date_of_birth, gender,
    // NEW: profile photo. Three signals accepted:
    //   • non-empty string   → set photo_url to this path
    //   • explicit null      → clear photo_url (admin removed the photo)
    //   • undefined / omitted → don't touch photo_url at all
    photo_url,
  } = req.body || {};

  try {
    // Confirm the admin's branch scope covers this student. Enforces
    // the "students belong to their batch's branch login" rule: a main
    // admin cannot edit a sub-branch student, and a sub-branch admin
    // cannot edit a main-institution or sibling-branch student.
    const scope = await getBranchScope(adminId);
    if (!scope) {
      return res.status(403).json({ message: 'Admin not linked to an institution' });
    }

    const studentRow = await pool.query(
      'SELECT id, institution_id, name, email, phone FROM users WHERE id = $1 AND role = $2',
      [studentId, 'student'],
    );
    const student = studentRow.rows[0];
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    // Student's users.institution_id is stamped as ROOT — same for the
    // main admin. We still cross-check by branch via adminCanSeeStudent
    // so a sub-branch admin can't edit a student whose only enrollments
    // are at a sibling branch.
    if (student.institution_id !== scope.rootId) {
      return res.status(403).json({ message: 'Student not in your institution' });
    }
    const { adminCanSeeStudent } = require('../utils/branchScope');
    const canSee = await adminCanSeeStudent(pool, scope, studentId);
    if (!canSee) {
      // Fallback path: freshly-registered student with no enrollments
      // yet — allow if their users.institution_id maps to caller.
      if (scope.callerInstId !== student.institution_id) {
        return res.status(403).json({ message: 'Student not in your branch' });
      }
    }

    // ── Validate contact uniqueness (only when the value actually changed)
    if (email && email !== student.email) {
      const fmt = validateEmailFormat(email);
      if (!fmt.ok) return res.status(400).json({ message: fmt.message });
      const uniq = await ensureEmailUnique(email, { excludeUserId: studentId });
      if (!uniq.ok) return res.status(409).json({ message: uniq.message });
    }
    if (phone && phone !== student.phone) {
      const fmt = validatePhoneFormat(phone);
      if (!fmt.ok) return res.status(400).json({ message: fmt.message });
      const uniq = await ensurePhoneUnique(phone, { excludeUserId: studentId });
      if (!uniq.ok) return res.status(409).json({ message: uniq.message });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Patch users row.
      await client.query(
        `UPDATE users SET
           name  = COALESCE(NULLIF($2, ''), name),
           email = COALESCE(NULLIF($3, ''), email),
           phone = COALESCE(NULLIF($4, ''), phone)
         WHERE id = $1`,
        [studentId, name, email, phone],
      );

      // Upsert student_profiles row. The unique index on user_id makes
      // ON CONFLICT (user_id) DO UPDATE the natural fit; if no row exists
      // we create one so the edit form can save profile fields even
      // before the student finished their first enrollment form.
      //
      // photo_url semantics:
      //   • the caller sent `photo_url: null`  → clear the DB column
      //     (admin tapped Remove photo)
      //   • the caller sent a non-empty string → save it
      //   • the caller omitted the key         → keep whatever is there
      // We encode "omitted vs cleared" over the wire by looking at
      // Object.prototype.hasOwnProperty on req.body.
      const wantsPhotoTouch = Object.prototype.hasOwnProperty.call(req.body || {}, 'photo_url');
      const nextPhoto = photo_url == null ? null : String(photo_url).trim() || null;

      await client.query(
        `INSERT INTO student_profiles
           (user_id, full_name, address, father_name, mother_name, date_of_birth, gender, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           full_name     = COALESCE(NULLIF(EXCLUDED.full_name,     ''), student_profiles.full_name),
           address       = COALESCE(NULLIF(EXCLUDED.address,       ''), student_profiles.address),
           father_name   = COALESCE(NULLIF(EXCLUDED.father_name,   ''), student_profiles.father_name),
           mother_name   = COALESCE(NULLIF(EXCLUDED.mother_name,   ''), student_profiles.mother_name),
           date_of_birth = COALESCE(EXCLUDED.date_of_birth,             student_profiles.date_of_birth),
           gender        = COALESCE(NULLIF(EXCLUDED.gender,        ''), student_profiles.gender),
           -- photo_url only updates when the caller actually sent the key.
           -- $9 = wantsPhotoTouch flag; when TRUE we overwrite with the
           -- normalised value (null clears the column), else we leave it.
           photo_url     = CASE WHEN $9 THEN EXCLUDED.photo_url ELSE student_profiles.photo_url END,
           updated_at    = CURRENT_TIMESTAMP`,
        [
          studentId,
          name || student.name,
          address || null,
          father_name || null,
          mother_name || null,
          date_of_birth || null,
          gender || null,
          wantsPhotoTouch ? nextPhoto : null,
          wantsPhotoTouch,
        ],
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Return the freshly-merged view so the mobile screen can refresh
    // its state without a second round-trip.
    const merged = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              sp.address, sp.father_name, sp.mother_name,
              sp.date_of_birth, sp.gender, sp.photo_url
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1`,
      [studentId],
    );
    res.json({ message: 'Student updated', student: merged.rows[0] });
  } catch (err) {
    console.error('updateStudentByAdmin error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Admin: delete a student ───────────────────────────────────────
// DELETE /api/enrollments/student/:userId
//
// Used by the Students tab (institution + branch login) to remove a
// student the admin has access to. Soft-delete pattern — same as the
// trainer delete flow (see trainer.controller.js `deleteTrainer`):
//   • Flip users.is_deleted = TRUE and stamp deleted_at / deleted_by.
//     Preserves audit history (enrollments / attendance FK to the user
//     stay intact) while, thanks to migration 050's partial unique
//     indexes, freeing the email/phone for reuse.
//   • Also mark the user 'inactive' so future sign-in is rejected.
//
// Branch scope: the admin must have visibility into the student per the
// existing rules (main admin → student enrolled in a main-institution
// batch; sub-branch admin → student enrolled in one of THEIR branch's
// batches). Enforced via the shared adminCanSeeStudent() helper.
exports.deleteStudentByAdmin = async (req, res) => {
  const adminId   = req.user.id || req.user.userId;
  const studentId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(studentId)) {
    return res.status(400).json({ message: 'Invalid student id' });
  }

  const client = await pool.connect();
  try {
    // Branch scope check — same guard used by updateStudentByAdmin.
    const { adminCanSeeStudent } = require('../utils/branchScope');
    const scope = await getBranchScope(adminId);
    if (!scope) {
      return res.status(403).json({ message: 'Admin not linked to an institution' });
    }
    const studentRow = await pool.query(
      'SELECT id, name, institution_id FROM users WHERE id = $1 AND role = $2',
      [studentId, 'student'],
    );
    const student = studentRow.rows[0];
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (student.institution_id !== scope.rootId) {
      return res.status(403).json({ message: 'Student not in your institution' });
    }
    const canSee = await adminCanSeeStudent(pool, scope, studentId);
    if (!canSee && scope.callerInstId !== student.institution_id) {
      return res.status(403).json({ message: 'Student not in your branch' });
    }

    await client.query('BEGIN');
    // Soft-delete the user row + mark inactive.
    await client.query(
      `UPDATE users
          SET is_deleted = TRUE,
              deleted_at = CURRENT_TIMESTAMP,
              deleted_by = $2,
              status     = 'inactive'
        WHERE id = $1`,
      [studentId, adminId],
    );
    await client.query('COMMIT');

    res.json({
      message: `${student.name} has been removed. Their email and phone are now free for reuse.`,
      student_id: studentId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('deleteStudentByAdmin error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};
