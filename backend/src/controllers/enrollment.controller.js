const pool = require('../config/db');

// ── Schema-availability latch ───────────────────────────────────
// Migration 084 adds enrollments.next_payment_date. On a DB that
// hasn't run it, any query that selects the column fails with 42703
// and the endpoint 500s. We latch the missing state on the FIRST
// failure so:
//   • subsequent requests skip the failing column immediately (no
//     wasted round-trip),
//   • the app keeps working on stale schemas until the migration
//     lands + the process restarts (fresh boot → latch defaults
//     back to available and probes again).
// Never negates on success — one bad query per process is enough.
let hasNextPaymentDate = true;
function markNextPaymentDateMissing() {
  if (hasNextPaymentDate) {
    hasNextPaymentDate = false;
    console.warn(
      '[enrollment] enrollments.next_payment_date column missing — '
      + 'apply migration 084 and restart. Serving requests without it in the meantime.'
    );
  }
}

// Use the same bcrypt package as the rest of the codebase (the native
// one, not bcryptjs). Both expose the same hash/compare API so no
// other code change is needed.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendStudentCredentialsEmail } = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
// WhatsApp credentials dispatch — plan-gated + one-shot per call.
// Fire-and-forget: WhatsApp API outages, plan-not-enabled, or an
// invalid phone must NEVER fail an otherwise-successful enrolment.
// The helper below wraps sendStudentCredentialsMessage with a
// uniform log line so we can grep for the outcome per student.
const { sendStudentCredentialsMessage: sendStudentCredentialsWhatsApp } = require('../services/whatsapp.service');

// Shared, non-blocking dispatch used at every "credentials just went
// out" site (offline admin enrolment, post-payment activation, admin
// resend). `userId` MUST be set so isWhatsAppEnabledForUser() can
// resolve the institution + plan for the gate check — that's why we
// always call this AFTER the student's user row is linked to the
// institution (either via institution_id on the row or via the
// enrolment we just wrote).
//
// Duplicate-send protection: when `enrollmentId` is supplied, we
// consult enrollments.credentials_wa_sent_at (migration 079). If the
// row is already stamped the send is skipped; on successful delivery
// we stamp it so a webhook retry / reload never double-sends. Set
// `force: true` (used by the admin resend endpoint) to override the
// stamp AND clear it before delivery so the classic "one-shot per
// enrolment unless an admin explicitly asks again" behaviour holds.
//
// `institutionName` is threaded through to the WhatsApp template so
// the message can address the student by academy — spec required.
function dispatchStudentCredentialsWa({
  userId, phone, studentName, email, password,
  enrollmentId, institutionName,
  tag = 'enroll',
  force = false,
}) {
  // Pre-dispatch trace so it's OBVIOUS in the terminal that we
  // reached the WhatsApp send site. Every silent skip below carries a
  // matching "→ skipped" line so a missing PRE line means we never
  // even attempted the send (usually because `if (createdStudentCreds)`
  // was false — i.e. we reused an existing user).
  console.log(
    `[WhatsApp][PRE] student credentials → tag=${tag} user=${userId || 'n/a'} `
    + `phone=${phone || 'n/a'} enrollment=${enrollmentId || 'n/a'} `
    + `institution=${institutionName || 'n/a'} force=${!!force}`,
  );
  if (!userId || !phone) {
    console.log(`[WhatsApp] student credentials skipped → tag=${tag} reason=missing-required-data user=${userId || 'n/a'} phone=${phone || 'n/a'}`);
    return;
  }
  (async () => {
    // Duplicate-send guard. When enrollmentId is present, look up the
    // stamp; skip if already sent unless the caller explicitly forces
    // a resend. Missing `credentials_wa_sent_at` column (migration
    // 079 pending) silently degrades to "no dedup" so a stale schema
    // never blocks the send.
    if (enrollmentId && !force) {
      try {
        const stamp = await pool.query(
          `SELECT credentials_wa_sent_at FROM enrollments WHERE id = $1`,
          [enrollmentId],
        );
        if (stamp.rows[0]?.credentials_wa_sent_at) {
          console.log(
            `[WhatsApp] student credentials skipped → tag=${tag} enrollment=${enrollmentId} reason=already-sent`,
          );
          return;
        }
      } catch (err) {
        if (err?.code === '42703') {
          // migration 079 not yet applied — carry on without dedup.
        } else {
          console.warn(`[WhatsApp] dedup check failed → tag=${tag} error=${err?.message}`);
        }
      }
    }

    let r = { ok: false, error: 'send-not-attempted' };
    try {
      r = await sendStudentCredentialsWhatsApp({
        userId,
        phone,
        studentName,
        institutionName,
        email,
        password,
      });
    } catch (err) {
      console.warn(
        `[WhatsApp] student credentials threw → tag=${tag} user=${userId} error=${err?.message}`,
      );
      return;
    }

    if (r?.ok) {
      console.log(
        `[WhatsApp] student credentials delivered → tag=${tag} user=${userId} phone=${phone} messageId=${r.messageId || 'n/a'}`,
      );
      // Stamp the enrolment so retries can't double-send. Best-effort
      // — a failure here doesn't roll back the actual delivery.
      if (enrollmentId) {
        try {
          await pool.query(
            `UPDATE enrollments
                SET credentials_wa_sent_at = NOW()
              WHERE id = $1`,
            [enrollmentId],
          );
        } catch (err) {
          if (err?.code !== '42703') {
            console.warn(
              `[WhatsApp] failed to stamp credentials_wa_sent_at → enrollment=${enrollmentId} error=${err?.message}`,
            );
          }
        }
      }
    } else if (r?.skipped) {
      console.log(
        `[WhatsApp] student credentials skipped → tag=${tag} user=${userId} reason=${r.skipped}`,
      );
    } else {
      console.warn(
        `[WhatsApp] student credentials send FAILED → tag=${tag} user=${userId} error=${r?.error || 'unknown'}`,
      );
    }
  })();
}
const { ensureCapacity, limitResponse } = require('../utils/planLimits');
const {
  validateEmailFormat, validatePhoneFormat,
  ensureEmailUnique, ensurePhoneUnique,
} = require('../utils/contactValidation');
// Resume Registration / Enrollment (migration 077). Admin-mode student
// enrolments delegate here so a re-used email/phone that points at an
// INCOMPLETE student record surfaces a friendly RESUME_AVAILABLE 409.
const {
  findResumableRegistration,
  markRegistrationComplete,
  resumeAvailableResponse,
} = require('../utils/registrationStatus');
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

    // Branch View override — the Institution Home dashboard passes
    // ?branch_id=X when the admin drilled into a specific branch's
    // tile. Values accepted (main admin only):
    //   'all' | 'ALL'   — every branch + main institution (used by
    //                     the Earnings tab so Payment Details isn't
    //                     empty for academies whose students are all
    //                     enrolled through sub-branches).
    //   0               — Main institution only (b.branch_id IS NULL).
    //   positive int    — locks to that branch, validated below.
    // Sub-branch admins can't override (they only see their own
    // branch anyway); an invalid id is silently ignored so a stale
    // link never leaks another academy's data.
    let usedOverride = false;
    if (!scope.isSubBranchAdmin && req.query.branch_id !== undefined) {
      const rawStr = String(req.query.branch_id || '').trim().toLowerCase();
      if (rawStr === 'all') {
        // No branch clause — accept every enrolment in the caller's
        // academy tree. This matches the "aggregate revenue" view the
        // Earnings tab wants by default.
        usedOverride = true;
      } else {
        const raw = parseInt(rawStr, 10);
        if (Number.isFinite(raw) && raw >= 0) {
          if (raw === 0) {
            where += ` AND b.branch_id IS NULL`;
            usedOverride = true;
          } else {
            // Validate the branch belongs to the caller's tree so a
            // spoofed id can't spy on another academy.
            const bRow = await pool.query(
              `SELECT id FROM institutions
                WHERE id = $1
                  AND (id = $2 OR parent_institution_id = $2)
                  AND deleted_at IS NULL`,
              [raw, scope.rootId],
            );
            if (bRow.rows.length > 0) {
              params.push(raw);
              where += ` AND b.branch_id = $${params.length}`;
              usedOverride = true;
            }
          }
        }
      }
    }
    if (!usedOverride) {
      const branchClause = batchBranchClause(scope, 'b', params);
      if (branchClause) where += ` AND ${branchClause}`;
    }

    // next_payment_date is spliced in only when the schema latch
    // reports the column exists. On first 42703 we flip the latch
    // and retry without the column so a pre-084 schema returns rows
    // instead of 500-ing. Renderers already treat null / missing as
    // "no manual reminder set".
    const buildQuery = () => `SELECT
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
         ${hasNextPaymentDate ? 'e.next_payment_date,' : '/* next_payment_date column missing */'}

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
         c.billing_cycle   AS course_billing_cycle,
         c.price           AS course_price,

         b.id         AS batch_id,
         b.name       AS batch_name,
         b.branch_id  AS batch_branch_id

       FROM enrollments e
       JOIN users u        ON e.student_id = u.id
       JOIN batches b      ON e.batch_id   = b.id
       JOIN courses c      ON b.course_id  = c.id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE ${where}
       ORDER BY e.enrolled_at DESC`;

    let result;
    try {
      result = await pool.query(buildQuery(), params);
    } catch (queryErr) {
      // 42703 = undefined_column. On the first hit for
      // next_payment_date, latch it as missing and re-run without.
      if (queryErr?.code === '42703' && hasNextPaymentDate) {
        markNextPaymentDateMissing();
        result = await pool.query(buildQuery(), params);
      } else {
        throw queryErr;
      }
    }

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
      blood_group,
      belt_category,
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

      // ── Resume Registration probe ─────────────────────────────────
      // The spec forbids reserving an email/phone until the enrolment
      // fully completes. So before we go looking for a live user
      // match, ask registrationStatus whether this email/phone maps
      // to an INCOMPLETE student — if so, surface RESUME_AVAILABLE
      // (client shows the "Would you like to continue where you left
      // off?" prompt) unless the admin opted in with { resume: true }.
      const resumeLookup = await findResumableRegistration({
        email: cleanEmail, phone: pFmt.value, role: 'student',
      });
      const resumeFlag = req.body?.resume === true;
      if (resumeLookup.status === 'incomplete' && !resumeFlag) {
        return res.status(409).json(resumeAvailableResponse(resumeLookup));
      }

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
        const scope = await getBranchScope(req.user.id);
        const institutionId = scope ? scope.callerInstId : null;
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

    // Branch ownership check for admin enrollments
    if (req.user.role === 'admin') {
      const scope = await getBranchScope(req.user.id);
      if (scope) {
        if (scope.isSubBranchAdmin) {
          if (batch.branch_id !== scope.callerInstId && batch.institution_id !== scope.callerInstId) {
            return res.status(403).json({ message: 'Batch does not belong to your branch.' });
          }
        } else if (batch.institution_id !== scope.rootId) {
          return res.status(403).json({ message: 'Batch does not belong to your institution.' });
        }
      }
    }

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
           blood_group, belt_category,
           photo_url, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
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
           blood_group    = COALESCE(EXCLUDED.blood_group,    student_profiles.blood_group),
           belt_category  = COALESCE(EXCLUDED.belt_category,  student_profiles.belt_category),
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
          blood_group || null, belt_category || null,
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

    // ── next_payment_date validation ──────────────────────────────
    // Applies to the OFFLINE payment path only. The admin sets it on
    // the Add Student form so the reminder scheduler can nudge the
    // student N days before the next installment. Ignored server-
    // side when Payment Link is enabled (Razorpay drives that
    // timeline). Accepts YYYY-MM-DD or an empty string / null.
    let nextPaymentDate = null;
    const rawNext = String(req.body?.next_payment_date || '').trim();
    if (rawNext) {
      // Strict YYYY-MM-DD so a client passing a raw Date.toString()
      // doesn't accidentally land as an unparseable value.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawNext)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          field: 'next_payment_date',
          message: 'next_payment_date must be YYYY-MM-DD',
        });
      }
      const d = new Date(`${rawNext}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          field: 'next_payment_date',
          message: 'next_payment_date is not a valid date',
        });
      }
      nextPaymentDate = rawNext;
    }

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
      // Enrollment-specific callback URL. Points at the backend
      // reconciliation handler which we KNOW exists — no dependency
      // on a frontend /payment-success route. The handler flips the
      // row to paid via active Razorpay verification if the webhook
      // fails to arrive, then mails credentials + generates the
      // invoice. See enrollment.controller.js#enrollmentPaymentSuccess.
      const apiBase =
        (process.env.API_BASE_URL || process.env.APP_BASE_URL || 'https://veerifyapp.com')
          .replace(/\/+$/, '');
      const callbackUrl = `${apiBase}/api/enrollments/payment-success?enrollment_id=${enrollmentId}`;
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
        callbackUrl,
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
      console.log(`[enroll] Created payment link ${link.link.id} for enrollment ${enrollmentId}`);
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
          })
          .then(() => console.log(`[enroll] Sent payment link email to ${stu.rows[0].email}`))
          .catch((e) => console.warn('[enroll] link email failed:', e?.message));
        }
      } catch (mailErr) {
        console.warn('[enroll] mailer helper unavailable:', mailErr?.message);
      }

      // ── WhatsApp: same payment link, spec-copy ────────────────
      // Fires only when:
      //   • admin-mode enrolment (we're inside isAdminMode &&
      //     linkEnabled already, so this covers both institution
      //     and branch admins).
      //   • institution's plan has WhatsApp enabled
      //     (isWhatsAppEnabledForUser walks to root; branch admins
      //     inherit the parent academy's plan).
      //   • student has a valid mobile number on file (users.phone).
      // The message uses the EXACT short_url minted by Razorpay — same
      // URL sent by email — so the two channels never diverge.
      // Fire-and-forget: WA outages, missing envs, plan-disabled, or
      // an invalid phone must NEVER fail the enrolment.
      (async () => {
        try {
          const { sendTextMessage } = require('../services/whatsapp.service');
          const { isWhatsAppEnabledForUser } = require('../utils/planFeatureGuard');
          const actorId = req.user?.id;
          const enabled = await isWhatsAppEnabledForUser(actorId);
          if (!enabled) {
            console.log(`[enroll/wa/link] skip enrollment=${enrollmentId} reason=plan-disabled`);
            return;
          }
          const studentPhone = stu.rows[0]?.phone;
          if (!studentPhone) {
            console.log(`[enroll/wa/link] skip enrollment=${enrollmentId} reason=no-phone`);
            return;
          }
          const institutionName = inst.rows[0]?.name || 'Veerify';
          const message =
            `Welcome to ${institutionName}!\n\n`
            + `Your enrollment is successful.\n\n`
            + `Complete your payment using the link below:\n`
            + `${link.link.short_url}\n\n`
            + `Thank you,\n`
            + `${institutionName}`;
          const res = await sendTextMessage(studentPhone, message);
          if (res?.ok) {
            console.log(
              `[enroll/wa/link] sent enrollment=${enrollmentId} `
              + `student=${studentId} to=${studentPhone}`,
            );
          } else {
            console.warn(
              `[enroll/wa/link] send failed enrollment=${enrollmentId} `
              + `student=${studentId} reason=${res?.error || 'unknown'}`,
            );
          }
        } catch (waErr) {
          // Belt-and-suspenders — never throws to the enrolment flow.
          console.warn('[enroll/wa/link] unexpected error:', waErr?.message);
        }
      })();
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
      // Schema-tolerant next_payment_date write. Migration 084 adds
      // the column; on pre-084 DBs we swallow the 42703 (undefined
      // column) via a SAVEPOINT so a stale schema doesn't roll back
      // the enrolment. Only stamped on the offline path — spec:
      // "If Payment Link is enabled, payment scheduling is handled
      // by payment links, so manual Next Payment Date should not be
      // editable."
      await client.query('SAVEPOINT nxt_pmt');
      let paid;
      try {
        paid = await client.query(
          `UPDATE enrollments SET
             payment_status    = 'paid',
             payment_mode      = $1,
             payment_reference = $2,
             payment_amount    = COALESCE(payment_amount, $3),
             paid_at           = NOW(),
             revenue_channel   = 'revenue',
             next_payment_date = $5
           WHERE id = $4
           RETURNING *`,
          [rawMode, reference, amount, result.rows[0].id, nextPaymentDate]
        );
        await client.query('RELEASE SAVEPOINT nxt_pmt');
      } catch (updErr) {
        if (updErr?.code === '42703') {
          // Column missing → rollback the failed UPDATE and re-run
          // without next_payment_date so the enrolment still lands.
          await client.query('ROLLBACK TO SAVEPOINT nxt_pmt');
          if (nextPaymentDate) {
            console.warn(
              '[enroll] next_payment_date requested but column missing — apply migration 084.'
            );
          }
          paid = await client.query(
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
        } else {
          throw updErr;
        }
      }
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

    // Terminal state for a student's Resume Registration flow: the
    // enrolment is written, the institution is linked, and (for the
    // offline path) the login is fully activated. Stamp
    // registration_completed_at so a future submission of the same
    // email/phone gets the classic EMAIL_TAKEN response instead of
    // the resume prompt. Fire post-commit and via
    // markRegistrationComplete (which swallows a 42703 when
    // migration 077 hasn't been applied yet) so a stale schema
    // never rolls back an otherwise-successful enrolment.
    markRegistrationComplete(studentId).catch(() => { /* logged inside */ });

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
      // Look up institution name + course name once — both email +
      // WhatsApp templates want the academy in the copy. Hoisted out
      // of the try so a mail failure doesn't rob the WhatsApp send
      // of its institutionName.
      let institutionNameForCreds = 'your academy';
      let courseNameForCreds = null;
      try {
        const inst = await pool.query(
          `SELECT i.name, c.name AS course_name
             FROM batches b
             JOIN courses c ON b.course_id = c.id
             JOIN institutions i ON b.institution_id = i.id
            WHERE b.id = $1`,
          [batch_id],
        );
        institutionNameForCreds = inst.rows[0]?.name || institutionNameForCreds;
        courseNameForCreds      = inst.rows[0]?.course_name || null;
        const mailResult = await sendStudentCredentialsEmail({
          ...createdStudentCreds,
          institutionName: institutionNameForCreds,
          courseName:      courseNameForCreds,
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

      // WhatsApp credentials (fire-and-forget, plan-gated). Sent AFTER
      // the enrolment is committed AND the account row is created.
      // Duplicate-send protection via enrollments.credentials_wa_sent_at
      // (migration 079) so a webhook retry / admin retry can't
      // deliver a second WhatsApp for the same enrolment.
      dispatchStudentCredentialsWa({
        userId:          studentId,
        phone:           createdStudentCreds.phone,
        studentName:     createdStudentCreds.name,
        email:           createdStudentCreds.loginEmail,
        password:        createdStudentCreds.password,
        enrollmentId:    result.rows[0]?.id,
        institutionName: institutionNameForCreds,
        tag:             'offline-admin-enroll',
      });
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
              c.billing_cycle AS course_billing_cycle,
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

    // Shared billing-cycle label — same source used by the mobile
    // payment summary and the PDF invoice, so all three surfaces
    // ("Monthly Fee" / "Quarterly Fee" / "Annual Fee" / etc.) render
    // exactly the same wording as the course's configured cycle.
    const { billingCycleLabel } = require('../utils/billingCycle');
    const cycleLabel = billingCycleLabel(row.course_billing_cycle);

    const { createPaymentLink } = require('../utils/razorpay');
    // Enrollment-specific callback URL — routes to the reconciliation
    // handler on this same controller. See enrollmentPaymentSuccess.
    const apiBase =
      (process.env.API_BASE_URL || process.env.APP_BASE_URL || 'https://veerifyapp.com')
        .replace(/\/+$/, '');
    const callbackUrl = `${apiBase}/api/enrollments/payment-success?enrollment_id=${row.id}`;
    const link = await createPaymentLink({
      amountInRupees: amount,
      institution: {
        id:          row.institution_id,
        name:        row.institution_name,
        owner_name:  row.student_name,
        owner_email: row.student_email,
        owner_phone: row.student_phone,
        // Reads as "Veerify subscription — <course> (<cycle>) for <academy>"
        // on the Razorpay hosted checkout, so the payer knows exactly
        // what they're being charged for and on what cadence.
        plan_name:   `${row.course_name} (${cycleLabel})`,
      },
      notes: {
        action:        'enrollment_new',
        enrollment_id: String(row.id),
        student_id:    String(studentId),
        billing_cycle: String(row.course_billing_cycle || 'monthly'),
      },
      callbackUrl,
    });

    if (!link.ok) {
      // Dev fallback — no Razorpay creds. The mobile drops back to mock-pay.
      return res.json({
        mock:    true,
        message: link.error || 'Razorpay not configured — mock-pay available.',
      });
    }

    // Stamp the pending link id so the webhook lookup succeeds. Also
    // stamp revenue_channel='wallet' — this is a direct student
    // purchase paid via Razorpay, so the settlement flows through
    // the institution wallet exactly like an admin-created "Share
    // Payment Link" enrolment. Without this stamp the row would
    // stay revenue_channel=NULL and be excluded from the wallet
    // aggregation (offline / uncategorised sales are excluded per
    // spec).
    await pool.query(
      `UPDATE enrollments
          SET payment_reference = $2,
              payment_status    = 'pending',
              revenue_channel   = 'wallet'
        WHERE id = $1`,
      [row.id, link.link.id],
    );

    res.json({
      payment_url:    link.link.short_url,
      provider:       'razorpay',
      transaction_id: link.link.id,
      amount,
      currency:       'INR',
      payment_status: 'pending',
      // Surface the billing cycle + human label so the mobile summary
      // and any UI that renders this response never needs to know the
      // enum → label mapping locally.
      billing_cycle:  row.course_billing_cycle || 'monthly',
      billing_label:  cycleLabel,
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
    const upd = await pool.query(
      `UPDATE users SET
         password             = $1,
         status               = 'active',
         must_change_password = TRUE,
         updated_at           = NOW()
       WHERE id = $2 AND status = 'pending'`,
      [hashed, row.student_id],
    );
    if (upd.rowCount === 0) {
      // Another concurrent request already activated this user
      return { ok: true, sent: false, alreadyActive: true };
    }
    // Resume Registration completion stamp — done separately so a
    // stale schema (missing `registration_completed_at` before
    // migration 077 is applied) doesn't rollback the activation.
    markRegistrationComplete(row.student_id).catch(() => { /* logged inside */ });

    // Send credentials email — same helper the offline / trainer
    // flows already use, so the copy stays consistent.
    //
    // sendStudentCredentialsEmail returns { ok, error } — it never
    // throws — so the previous try/catch always saw "success" even
    // when the mailer had actually failed silently. We now inspect
    // the return value, log the reason loudly, and surface it in
    // the response so callers (webhook + reconciler) can react.
    let credentialsSent = false;
    let credentialsError = null;
    try {
      const mail = await sendStudentCredentialsEmail({
        to:              row.student_email,
        name:            row.student_name,
        loginEmail:      row.student_email,
        password:        tempPassword,
        institutionName: row.institution_name,
        courseName:      row.course_name,
      });
      if (mail && mail.ok) {
        credentialsSent = true;
        console.log(
          `[activateStudent] credentials emailed to ${row.student_email} (enrollment=${enrollmentId})`,
        );
      } else {
        credentialsError = mail?.error || 'Unknown mailer error';
        console.error(
          `[activateStudent] credentials email FAILED for enrollment=${enrollmentId} to=${row.student_email}: ${credentialsError}`,
        );
      }
    } catch (mailErr) {
      credentialsError = mailErr?.message || 'Send threw';
      console.error(
        `[activateStudent] credentials email THREW for enrollment=${enrollmentId}: ${credentialsError}`,
      );
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

    // WhatsApp credentials (fire-and-forget, plan-gated). The
    // idempotency guard above (`row.user_status === 'active'` early
    // return) already prevents a webhook retry from double-sending
    // this message — a paid student is only activated once. Even so
    // we pass `enrollmentId` so the per-enrolment stamp acts as a
    // second belt-and-braces guard against retries that slip past
    // the alreadyActive check (e.g. two webhooks racing on the same
    // link_id before the UPDATE lands).
    dispatchStudentCredentialsWa({
      userId:          row.student_id,
      phone:           row.student_phone,
      studentName:     row.student_name,
      email:           row.student_email,
      password:        tempPassword,
      enrollmentId:    enrollmentId,
      institutionName: row.institution_name,
      tag:             'activate-after-payment',
    });

    return {
      ok:                true,
      sent:              credentialsSent,
      credentials_sent:  credentialsSent,
      credentials_error: credentialsError,
    };
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

    // ── WhatsApp: same freshly-minted link, spec-copy ─────────
    // Same gate + message as the initial enrolment path. Fire-and-
    // forget so a WA outage never fails the resend response.
    (async () => {
      try {
        const { sendTextMessage } = require('../services/whatsapp.service');
        const { isWhatsAppEnabledForUser } = require('../utils/planFeatureGuard');
        const enabled = await isWhatsAppEnabledForUser(req.user.id);
        if (!enabled) {
          console.log(`[resendPaymentLink/wa] skip enrollment=${row.id} reason=plan-disabled`);
          return;
        }
        if (!row.student_phone) {
          console.log(`[resendPaymentLink/wa] skip enrollment=${row.id} reason=no-phone`);
          return;
        }
        const message =
          `Welcome to ${row.institution_name}!\n\n`
          + `Your enrollment is successful.\n\n`
          + `Complete your payment using the link below:\n`
          + `${link.link.short_url}\n\n`
          + `Thank you,\n`
          + `${row.institution_name}`;
        const r = await sendTextMessage(row.student_phone, message);
        if (r?.ok) {
          console.log(`[resendPaymentLink/wa] sent enrollment=${row.id} to=${row.student_phone}`);
        } else {
          console.warn(
            `[resendPaymentLink/wa] send failed enrollment=${row.id} `
            + `reason=${r?.error || 'unknown'}`,
          );
        }
      } catch (waErr) {
        console.warn('[resendPaymentLink/wa] unexpected error:', waErr?.message);
      }
    })();

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

// GET /api/enrollments/payment-success
//
// Razorpay redirects the payer here after a successful checkout. This
// endpoint is the second half of the "webhook + active reconciliation"
// contract — even if the Razorpay webhook fails, is misconfigured, or
// arrives late, this handler:
//
//   1. Reads the enrollment id from the query string.
//   2. Checks the enrollment's current server-side status.
//   3. If already 'paid' → renders success page (idempotent).
//   4. Otherwise, calls Razorpay's Payment Link API to confirm the
//      link is genuinely paid. If Razorpay says paid but our DB says
//      pending → runs the same activation code the webhook runs
//      (flips to paid, activates student, mails credentials, generates
//      invoice). Every side-effect is idempotency-guarded internally.
//   5. Renders a branded HTML success page that ALWAYS works — no
//      dependency on a frontend `/payment-success` route existing.
//
// Public — no auth. Safe because we only expose the student's name
// and course; nothing sensitive. Enrollment id in URL is the same
// posture as the pay-approval link that survives from onboarding.
exports.enrollmentPaymentSuccess = async (req, res) => {
  try {
    const enrollmentId = parseInt(req.query.enrollment_id, 10);
    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).send('Missing or invalid enrollment_id.');
    }

    // Pull enrollment + student + course + institution for the render.
    const enrolRes = await pool.query(
      `SELECT e.id, e.student_id, e.payment_status, e.payment_amount,
              e.payment_reference,
              c.name AS course_name,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         JOIN users u         ON u.id = e.student_id
        WHERE e.id = $1`,
      [enrollmentId],
    );
    if (enrolRes.rows.length === 0) {
      return res.status(404).send('Enrollment not found.');
    }
    const row = enrolRes.rows[0];

    // ── Active reconciliation ─────────────────────────────────────
    // If the DB still says 'pending', don't wait for the webhook —
    // ask Razorpay directly. This closes the loop on webhook
    // failures (misconfigured URL, dropped payloads, signature
    // mismatch) so a paid student ALWAYS gets activated.
    let reconciled = false;
    let reconciledError = null;
    if (row.payment_status !== 'paid' && row.payment_reference) {
      try {
        const { fetchPaymentLinkStatus } = require('../utils/razorpay');
        const info = await fetchPaymentLinkStatus(row.payment_reference);
        if (info.ok && info.status === 'paid') {
          // Flip to paid + record the confirmed payment id. Guarded
          // with `WHERE payment_status <> 'paid'` so a concurrent
          // webhook run doesn't double-write.
          const upd = await pool.query(
            `UPDATE enrollments
                SET payment_status    = 'paid',
                    paid_at           = NOW(),
                    payment_reference = COALESCE($2, payment_reference)
              WHERE id = $1
                AND payment_status <> 'paid'
              RETURNING id`,
            [enrollmentId, info.paymentId || row.payment_reference],
          );
          reconciled = upd.rowCount > 0;

          if (reconciled) {
            // Fire the same side-effects the webhook fires. Both are
            // idempotent internally (activate skips when user is
            // already active; invoice service skips duplicates).
            try {
              const r = await exports.activateStudentAfterPayment(enrollmentId);
              console.log('[enrollmentPaymentSuccess] activation via reconcile:', r);
            } catch (e) {
              reconciledError = e?.message || 'activation failed';
              console.error('[enrollmentPaymentSuccess] activation error:', e);
            }
            try {
              const { generateEnrollmentInvoice } = require('../utils/invoiceService');
              await generateEnrollmentInvoice({ enrollmentId });
            } catch (e) {
              console.error('[enrollmentPaymentSuccess] invoice error:', e?.message);
            }
          }
        } else if (info.ok) {
          reconciledError = `Payment link status is "${info.status}" — Razorpay hasn't confirmed the charge yet. Refresh in a few seconds.`;
        } else {
          reconciledError = info.error || 'Could not verify payment with Razorpay.';
        }
      } catch (e) {
        reconciledError = e?.message || 'Reconciliation failed';
        console.error('[enrollmentPaymentSuccess] reconcile error:', e);
      }
    }

    // Re-fetch the row so we render the latest state.
    const finalRow = await pool.query(
      `SELECT payment_status FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    const paid = finalRow.rows[0]?.payment_status === 'paid';

    // Render a branded HTML page. Never a 404 — always a friendly
    // status page, whether paid, still-processing, or explicit fail.
    const esc = (s) => String(s || '').replace(/[<>&"']/g, (c) => (
      { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]
    ));
    const title = paid
      ? 'Payment received'
      : (reconciledError ? 'Still confirming payment' : 'Payment processing');
    const sub = paid
      ? `Thanks! ${esc(row.student_name || 'You')}'s enrolment in ${esc(row.course_name)} at ${esc(row.institution_name)} is now active. Login details have been emailed to ${esc(row.student_email)}.`
      : (reconciledError
          ? `Your payment succeeded on Razorpay but our server hasn't confirmed it yet. ${esc(reconciledError)} Refresh this page or open the Veerify app — credentials will arrive by email within a minute.`
          : `Your payment is being processed. This page will update automatically once we confirm the charge — usually within 5 seconds.`);
    const tickColor = paid ? '#10B981' : '#F59E0B';

    res.set('Content-Type', 'text/html; charset=utf-8');
    // Auto-refresh every 3s while still pending so the payer sees
    // the confirmed state without touching the reload button.
    const refreshMeta = paid ? '' : '<meta http-equiv="refresh" content="3">';
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
    .inst {
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
    <div class="inst">${esc(row.course_name)}</div>
    <p>${sub}</p>
    <a class="cta" href="veerify://payment-complete">Open Veerify</a>
    <div class="foot">You can safely close this tab.</div>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('enrollmentPaymentSuccess error:', err);
    return res.status(500).send('Server error. Please try again in a moment.');
  }
};

// POST /api/enrollments/:id/resend-credentials
//
// Admin manual retry for the credentials email that goes out after a
// student's payment clears. Used when the first attempt failed
// silently (SMTP hiccup, Gmail app password rotation, etc.) and the
// student never received their login details.
//
// Rotates the temp password so no one — including the admin — can
// know the previous one, then re-sends the email. Requires the
// enrollment to already be paid (this endpoint doesn't grant access;
// it only re-delivers credentials for an account that's already
// active).
exports.resendStudentCredentials = async (req, res) => {
  try {
    const enrollmentId = parseInt(req.params.id, 10);
    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).json({ message: 'Invalid enrollment id' });
    }

    // Confirm the caller can touch this enrollment (branch scope
    // check, same rule the mark-attendance endpoints use). Pull the
    // student + course + institution while we're at it.
    const r = await pool.query(
      `SELECT e.id, e.student_id, e.payment_status, e.institution_id,
              c.name AS course_name,
              i.name AS institution_name,
              u.name AS student_name, u.email AS student_email,
              u.phone AS student_phone
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         JOIN users u         ON u.id = e.student_id
        WHERE e.id = $1`,
      [enrollmentId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    const row = r.rows[0];

    // Branch scope — main admin can touch any student, sub-branch
    // admin only their own branch. Same helper the update-student
    // endpoint uses.
    const scope = await getBranchScope(req.user.id);
    if (!scope) {
      return res.status(403).json({ message: 'Admin not linked to an institution' });
    }
    if (scope.rootId !== row.institution_id
        && !(scope.callerInstId === row.institution_id)) {
      return res.status(403).json({ message: 'Not your student' });
    }

    if (row.payment_status !== 'paid') {
      return res.status(400).json({
        code:    'NOT_PAID',
        message: 'This enrollment is not yet paid. Credentials are only sent after payment clears.',
      });
    }

    // Rotate password + re-send. The user is already active, so
    // this bypasses the activate-once idempotency guard — that
    // guard exists to prevent DUPLICATE mails from webhook retries,
    // not to block an admin-initiated resend.
    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    await pool.query(
      `UPDATE users SET
         password             = $1,
         must_change_password = TRUE,
         updated_at           = NOW()
       WHERE id = $2`,
      [hashed, row.student_id],
    );

    let sent = false;
    let error = null;
    try {
      const mail = await sendStudentCredentialsEmail({
        to:              row.student_email,
        name:            row.student_name,
        loginEmail:      row.student_email,
        password:        tempPassword,
        institutionName: row.institution_name,
        courseName:      row.course_name,
      });
      sent  = !!(mail && mail.ok);
      error = sent ? null : (mail?.error || 'Unknown mailer error');
    } catch (e) {
      error = e?.message || 'Send threw';
    }

    // Welcome SMS with the fresh password so at least ONE channel
    // delivers, even if SMTP is still broken.
    if (row.student_phone) {
      dispatchWelcomeSms({
        phone:        row.student_phone,
        name:         row.student_name,
        role:         'student',
        loginId:      row.student_email,
        tempPassword,
      });
    }

    // WhatsApp credentials (fire-and-forget, plan-gated). Admin
    // explicitly requested a resend, so a duplicate-send guard is
    // intentionally NOT applied here — that's the whole point of the
    // endpoint. The plan gate + phone presence still protect it from
    // firing on institutions that never opted into WhatsApp.
    dispatchStudentCredentialsWa({
      userId:          row.student_id,
      phone:           row.student_phone,
      studentName:     row.student_name,
      email:           row.student_email,
      password:        tempPassword,
      enrollmentId:    enrollmentId,
      institutionName: row.institution_name,
      tag:             'admin-resend',
      // Admin explicitly requested a fresh delivery — bypass the
      // per-enrolment dedup stamp and clear it inline so the next
      // organic send (if any) starts clean.
      force:           true,
    });
    // Clear the stamp so `force: true` above lands on a fresh row.
    // Best-effort — a schema pre-079 has no column and the query
    // will 42703, which we swallow silently.
    try {
      await pool.query(
        `UPDATE enrollments SET credentials_wa_sent_at = NULL WHERE id = $1`,
        [enrollmentId],
      );
    } catch (err) {
      if (err?.code !== '42703') {
        console.warn(`[resendStudentCredentials] clear stamp failed: ${err?.message}`);
      }
    }

    console.log(
      `[resendStudentCredentials] enrollment=${enrollmentId} to=${row.student_email} sent=${sent} err=${error || 'none'}`,
    );

    if (sent) {
      return res.json({
        message: `Fresh login credentials emailed to ${row.student_email}.`,
        credentials_sent: true,
      });
    }
    return res.status(502).json({
      code:    'MAIL_FAILED',
      message: `Password was rotated but the email could NOT be delivered: ${error}. Try again after fixing SMTP.`,
      credentials_sent: false,
      credentials_error: error,
    });
  } catch (err) {
    console.error('resendStudentCredentials error:', err);
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
              b.branch_id AS batch_branch_id,
              -- Branch label: sub-branch name for pinned batches,
              -- 'Main Institution' for batches whose branch_id IS NULL.
              -- The mobile Batches screen renders this verbatim per
              -- spec ("Display: Batch / Course / Trainer / Branch /
              -- Schedule / Status").
              COALESCE(br.name, 'Main Institution') AS batch_branch_name,
              c.name AS course_name, c.price AS course_price,
              c.image_url AS course_image_url,
              i.name AS institution_name, i.city AS institution_city,
              i.logo_url AS institution_logo_url,
              u.name AS trainer_name
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON e.institution_id = i.id
       LEFT JOIN institutions br ON br.id = b.branch_id
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

    // Get enrollments — LEFT JOIN student_profiles so the trainer's
    // Attendance + cross-branch Students screens have the same
    // profile fields (belt_category, photo, gender, DOB, etc.) as
    // the home-branch /trainer/my-students endpoint. Prevents belt
    // badges reverting to grey / synthetic values when viewing a
    // sister branch.
    const result = await pool.query(
      `SELECT e.*,
              u.name  AS student_name,
              u.email AS student_email,
              u.phone AS student_phone,
              sp.photo_url        AS student_photo_url,
              sp.gender           AS student_gender,
              sp.date_of_birth    AS student_date_of_birth,
              sp.address          AS student_address,
              sp.belt_category    AS belt_category,
              sp.blood_group      AS blood_group,
              sp.emergency_contact AS emergency_contact
         FROM enrollments e
         JOIN users u        ON e.student_id = u.id
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
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
// GET /api/enrollments/trainer/student/:studentId
//
// Fresh, full-detail view of a single student for the trainer detail
// screen. Contract:
//   • The trainer MUST teach at least one batch this student is
//     enrolled in — otherwise 403. Prevents a stale route param from
//     leaking another trainer's roster.
//   • Returns EVERY enrolment the trainer's batches share with the
//     student (so a student in two of the trainer's batches shows
//     both). Each row carries course, batch, institution/branch,
//     schedule, payment status.
//   • Includes the merged student_profiles fields (address, gender,
//     DOB, blood_group, belt_category, health_notes, contact_number,
//     photo_url) so the detail screen doesn't rely on stale route
//     params for personal info.
//   • Attendance summary (present / absent / late / leave counts +
//     percentage) computed across every batch the trainer teaches
//     that this student is enrolled in.
exports.getStudentDetailForTrainer = async (req, res) => {
  try {
    const userId    = req.user.id;
    const studentId = parseInt(req.params.studentId, 10);
    if (!Number.isFinite(studentId)) {
      return res.status(400).json({ message: 'Invalid student id' });
    }

    const trainerRow = await pool.query(
      `SELECT id FROM trainers WHERE user_id = $1`,
      [userId],
    );
    if (trainerRow.rows.length === 0) {
      return res.status(403).json({ message: 'Not linked to a trainer profile' });
    }
    const trainerId = trainerRow.rows[0].id;

    // Access check — trainer must teach at least one batch this
    // student is enrolled in. Combined with the WHERE below on the
    // main query this guarantees we never leak another trainer's
    // roster via a guessed studentId in the URL.
    const accessRes = await pool.query(
      `SELECT 1
         FROM enrollments e
         JOIN batches b ON b.id = e.batch_id
        WHERE e.student_id = $1 AND b.trainer_id = $2
        LIMIT 1`,
      [studentId, trainerId],
    );
    if (accessRes.rows.length === 0) {
      return res.status(403).json({ message: 'This student is not in your roster' });
    }

    // Merged profile + every relevant enrolment. LEFT JOIN
    // student_profiles because it's optional.
    const profileRes = await pool.query(
      `SELECT u.id            AS student_id,
              u.name          AS student_name,
              u.email         AS student_email,
              u.phone         AS student_phone,
              u.institution_id AS user_institution_id,
              sp.full_name    AS profile_full_name,
              sp.gender,
              sp.date_of_birth,
              sp.father_name,
              sp.mother_name,
              sp.contact_number,
              sp.address,
              sp.occupation,
              sp.height_cm,
              sp.weight_kg,
              sp.disabilities AS health_notes,
              sp.blood_group,
              sp.belt_category,
              sp.photo_url,
              sp.emergency_contact
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1
          AND COALESCE(u.is_deleted, false) = false`,
      [studentId],
    );
    if (profileRes.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const profile = profileRes.rows[0];

    const enrolsRes = await pool.query(
      `SELECT e.id                       AS enrollment_id,
              e.enrolled_at,
              e.payment_status,
              e.payment_amount,
              e.payment_mode,
              e.paid_at,
              e.payment_reference,
              c.id                       AS course_id,
              c.name                     AS course_name,
              c.category                 AS course_category,
              c.duration_months          AS course_duration_months,
              c.billing_cycle            AS course_billing_cycle,
              c.price                    AS course_price,
              b.id                       AS batch_id,
              b.name                     AS batch_name,
              b.days_of_week,
              b.start_time,
              b.end_time,
              b.mode                     AS batch_mode,
              b.branch_id                AS batch_branch_id,
              COALESCE(bi.name, i.name)  AS institution_name,
              (bi.parent_institution_id IS NOT NULL) AS is_sub_branch_batch
         FROM enrollments e
         JOIN batches b       ON b.id = e.batch_id
         JOIN courses c       ON c.id = b.course_id
         JOIN institutions i  ON i.id = e.institution_id
         LEFT JOIN institutions bi ON bi.id = b.branch_id
        WHERE e.student_id = $1
          AND b.trainer_id = $2
        ORDER BY e.enrolled_at DESC`,
      [studentId, trainerId],
    );

    // Attendance across every relevant batch. Percentage uses the
    // same formula the admin dashboard uses: present / (present +
    // absent + late) * 100 — leave is excluded from the denominator.
    const attRes = await pool.query(
      `SELECT status, COUNT(*)::int AS n
         FROM attendance a
         JOIN batches b ON b.id = a.batch_id
        WHERE a.student_id = $1 AND b.trainer_id = $2
        GROUP BY status`,
      [studentId, trainerId],
    );
    const counts = { present: 0, absent: 0, late: 0, leave: 0 };
    attRes.rows.forEach((r) => {
      if (counts[r.status] != null) counts[r.status] = Number(r.n) || 0;
    });
    const denom = counts.present + counts.absent + counts.late;
    const attendancePct = denom > 0 ? Math.round((counts.present / denom) * 100) : null;

    return res.json({
      student: {
        ...profile,
        // Prefer the profile.full_name when set; fall back to users.name.
        display_name: profile.profile_full_name || profile.student_name,
      },
      enrollments: enrolsRes.rows,
      attendance: {
        ...counts,
        total_marked: counts.present + counts.absent + counts.late + counts.leave,
        percentage:   attendancePct,
      },
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getStudentDetailForTrainer error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

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
         sp.belt_category           AS belt_category,
         sp.blood_group             AS blood_group,

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

// PATCH /enrollments/:id/payment  (DEPRECATED — never grants access)
//
// This endpoint used to flip payment_status='paid' for the caller's
// own enrollment as a "demo" shortcut. It's been retired because the
// mobile Pay Now flow was silently invoking it and granting course
// access with no Razorpay charge ever happening. Payment MUST go
// through /create-payment-link → Razorpay Payment Link → webhook.
//
// We keep the route registered so old builds of the app get a
// deterministic 410 Gone instead of a mysterious 404, but we NEVER
// mutate the row — even for the correct student.
exports.markPaid = async (req, res) => {
  return res.status(410).json({
    code:    'MARK_PAID_DEPRECATED',
    message:
      'Payments must go through Razorpay. Start the payment from ' +
      'the Enrolment screen so it can be verified.',
  });
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
    // Full-form profile fields — parity with the Student Enrollment
    // Form so the admin can edit everything a student entered on the
    // way in. Every one of these is optional; the SQL below uses
    // COALESCE(NULLIF('', ''), existing) so an empty string is
    // treated as "no change" and a real value overwrites.
    occupation,
    height_cm, weight_kg,
    disabilities,    // maps to the "Health notes" field on the form
    blood_group,     // one of the 8 ABO/Rh values, or NULL
    belt_category,   // curated list + free-text "Other"
    // NEW: profile photo. Three signals accepted:
    //   • non-empty string   → set photo_url to this path
    //   • explicit null      → clear photo_url (admin removed the photo)
    //   • undefined / omitted → don't touch photo_url at all
    photo_url,
    // Next Payment Date — YYYY-MM-DD, empty string clears it. The
    // update below only applies it to enrolments where
    // payment_link_enabled=FALSE (the offline path); link-driven
    // enrolments derive their next-due date from Razorpay and the
    // manual field is read-only in the UI.
    next_payment_date,
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
      `SELECT u.id, u.institution_id, u.name, u.email, u.phone, i.parent_institution_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1 AND u.role = $2`,
      [studentId, 'student'],
    );
    const student = studentRow.rows[0];
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const studentRootId = student.parent_institution_id || student.institution_id;
    if (studentRootId !== scope.rootId) {
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

      // Height/weight arrive as numbers or strings; coerce safely.
      // A null/undefined/empty string means "don't touch", not "clear".
      const num = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };

      await client.query(
        `INSERT INTO student_profiles (
           user_id, full_name, address, father_name, mother_name,
           date_of_birth, gender,
           occupation, height_cm, weight_kg,
           disabilities, blood_group, belt_category,
           photo_url
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (user_id) DO UPDATE SET
           full_name     = COALESCE(NULLIF(EXCLUDED.full_name,     ''), student_profiles.full_name),
           address       = COALESCE(NULLIF(EXCLUDED.address,       ''), student_profiles.address),
           father_name   = COALESCE(NULLIF(EXCLUDED.father_name,   ''), student_profiles.father_name),
           mother_name   = COALESCE(NULLIF(EXCLUDED.mother_name,   ''), student_profiles.mother_name),
           date_of_birth = COALESCE(EXCLUDED.date_of_birth,             student_profiles.date_of_birth),
           gender        = COALESCE(NULLIF(EXCLUDED.gender,        ''), student_profiles.gender),
           occupation    = COALESCE(NULLIF(EXCLUDED.occupation,    ''), student_profiles.occupation),
           height_cm     = COALESCE(EXCLUDED.height_cm,                 student_profiles.height_cm),
           weight_kg     = COALESCE(EXCLUDED.weight_kg,                 student_profiles.weight_kg),
           disabilities  = COALESCE(NULLIF(EXCLUDED.disabilities,  ''), student_profiles.disabilities),
           blood_group   = COALESCE(NULLIF(EXCLUDED.blood_group,   ''), student_profiles.blood_group),
           belt_category = COALESCE(NULLIF(EXCLUDED.belt_category, ''), student_profiles.belt_category),
           -- photo_url only updates when the caller actually sent the key.
           -- wantsPhotoTouch flag toggles overwrite; when FALSE we leave
           -- whatever is already stored.
           photo_url     = CASE WHEN $15 THEN EXCLUDED.photo_url ELSE student_profiles.photo_url END,
           updated_at    = CURRENT_TIMESTAMP`,
        [
          studentId,
          name || student.name,
          address || null,
          father_name || null,
          mother_name || null,
          date_of_birth || null,
          gender || null,
          occupation || null,
          num(height_cm),
          num(weight_kg),
          disabilities || null,
          blood_group || null,
          belt_category || null,
          wantsPhotoTouch ? nextPhoto : null,
          wantsPhotoTouch,
        ],
      );

      // ── Next Payment Date — enrolment-level, offline path only ──
      // Payment-link enrolments derive their next due date from the
      // Razorpay link lifecycle, so we deliberately skip those rows
      // (the mobile also disables the field for them). The predicate
      // scopes the UPDATE to enrolments under this student where
      // payment_link_enabled = FALSE; if the caller passed a null /
      // empty value we clear the column, otherwise we set it.
      const wantsNextPaymentTouch = Object.prototype.hasOwnProperty.call(
        req.body || {}, 'next_payment_date',
      );
      if (wantsNextPaymentTouch) {
        let nextVal = null;
        if (next_payment_date != null && String(next_payment_date).trim() !== '') {
          const raw = String(next_payment_date).trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              field: 'next_payment_date',
              message: 'next_payment_date must be YYYY-MM-DD',
            });
          }
          nextVal = raw;
        }
        try {
          await client.query(
            `UPDATE enrollments SET next_payment_date = $2
              WHERE student_id = $1
                AND COALESCE(payment_link_enabled, FALSE) = FALSE`,
            [studentId, nextVal],
          );
        } catch (err) {
          // Pre-084 schema — swallow.
          if (err?.code !== '42703') throw err;
          console.warn(
            '[updateStudent] next_payment_date requested but column missing — apply migration 084.'
          );
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Return the freshly-merged view so the mobile screen can refresh
    // its state without a second round-trip. Returns every column the
    // edit form knows how to render so the client can trust the
    // server as its source of truth after Save. next_payment_date +
    // payment_link_enabled come from the student's most recent
    // enrolment so the client knows whether the field should be
    // editable on the Edit Student form.
    const merged = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              sp.full_name, sp.address, sp.father_name, sp.mother_name,
              sp.date_of_birth, sp.gender, sp.photo_url,
              sp.occupation, sp.height_cm, sp.weight_kg,
              sp.disabilities, sp.blood_group, sp.belt_category,
              e.next_payment_date, e.payment_link_enabled
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT next_payment_date, payment_link_enabled
             FROM enrollments
            WHERE student_id = u.id
            ORDER BY id DESC
            LIMIT 1
         ) e ON TRUE
        WHERE u.id = $1`,
      [studentId],
    ).catch(async (err) => {
      // Pre-084 fallback — re-run without the next_payment_date join.
      if (err?.code !== '42703') throw err;
      return pool.query(
        `SELECT u.id, u.name, u.email, u.phone,
                sp.full_name, sp.address, sp.father_name, sp.mother_name,
                sp.date_of_birth, sp.gender, sp.photo_url,
                sp.occupation, sp.height_cm, sp.weight_kg,
                sp.disabilities, sp.blood_group, sp.belt_category
           FROM users u
           LEFT JOIN student_profiles sp ON sp.user_id = u.id
          WHERE u.id = $1`,
        [studentId],
      );
    });
    res.json({ message: 'Student updated', student: merged.rows[0] });
  } catch (err) {
    console.error('updateStudentByAdmin error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Admin: delete a student ───────────────────────────────────────
// DELETE /api/enrollments/student/:userId
//
// Used by the Students tab (institution + branch login) to permanently
// remove a student the admin has access to. HARD delete — every row
// linked to this student is purged inside a single transaction:
//
//   • users
//   • student_profiles           (ON DELETE CASCADE)
//   • enrollments                (ON DELETE CASCADE)
//   • attendance + attendance_audit (ON DELETE CASCADE)
//   • leave_requests             (ON DELETE CASCADE)
//   • notifications              (ON DELETE CASCADE)
//   • performance_reports        (ON DELETE CASCADE)
//   • student_belt_promotions +
//     certificates               (ON DELETE CASCADE)
//   • student_curriculum_progress + student_lesson_feedback (ON DELETE CASCADE)
//   • event_payments             (ON DELETE CASCADE)
//   • feedback                   (ON DELETE CASCADE)
//   • course_completions         (ON DELETE CASCADE)
//   • account_activity_log       (ON DELETE CASCADE)
//   • invoices                   (enrollment_id → ON DELETE SET NULL,
//                                 so we MANUALLY purge them before the
//                                 cascade so payment records are gone
//                                 too, per spec.)
//
// account_deletion_audit stays as a tamper-evident tombstone — the row
// carries user_id / role / email / phone snapshots but no FK, so it
// survives even after the identifying rows are gone.
//
// Branch scope: the admin must have visibility into the student per the
// existing rules (main admin → student enrolled in a main-institution
// batch; sub-branch admin → student enrolled in one of THEIR branch's
// batches). Enforced via the shared adminCanSeeStudent() helper.
//
// Everything runs inside BEGIN … COMMIT. Any error rolls the entire
// transaction back so a partial deletion is impossible.
exports.deleteStudentByAdmin = async (req, res) => {
  const adminId   = req.user.id || req.user.userId;
  const studentId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(studentId)) {
    return res.status(400).json({ message: 'Invalid student id' });
  }

  const client = await pool.connect();
  try {
    // ── Authorization: same guards used by updateStudentByAdmin ──
    const { adminCanSeeStudent } = require('../utils/branchScope');
    const scope = await getBranchScope(adminId);
    if (!scope) {
      return res.status(403).json({ message: 'Admin not linked to an institution' });
    }
    const studentRow = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.institution_id, i.parent_institution_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1 AND u.role = $2`,
      [studentId, 'student'],
    );
    const student = studentRow.rows[0];
    if (!student) return res.status(404).json({ message: 'Student not found' });
    const studentRootId = student.parent_institution_id || student.institution_id;
    if (studentRootId !== scope.rootId) {
      return res.status(403).json({ message: 'Student not in your institution' });
    }
    const canSee = await adminCanSeeStudent(pool, scope, studentId);
    if (!canSee && scope.callerInstId !== student.institution_id) {
      return res.status(403).json({ message: 'Student not in your branch' });
    }

    // ── Pre-flight schema probe (OUTSIDE the transaction) ──────────
    // Postgres poisons a transaction after ANY statement error — even
    // one we catch — so we can't just try/catch 42P01 inside BEGIN.
    // Ask information_schema which optional tables actually exist and
    // only include the statements we know will succeed.
    const schemaProbe = await pool.query(
      `SELECT
         to_regclass('public.invoices')                 IS NOT NULL AS has_invoices,
         to_regclass('public.account_deletion_audit')   IS NOT NULL AS has_audit`,
    );
    const hasInvoices = !!schemaProbe.rows[0]?.has_invoices;
    const hasAudit    = !!schemaProbe.rows[0]?.has_audit;

    // Capture enrolment ids BEFORE the txn so the DELETE FROM
    // invoices below doesn't need a preceding SELECT inside the
    // transaction (keeps the txn footprint minimal).
    const erPre = await pool.query(
      'SELECT id FROM enrollments WHERE student_id = $1',
      [studentId],
    );
    const enrollmentIds = erPre.rows.map((r) => r.id);

    // ── Hard delete transaction ────────────────────────────────────
    await client.query('BEGIN');

    // 1. Purge invoices that reference the student's enrolments.
    //    `invoices.enrollment_id` uses ON DELETE SET NULL, so without
    //    this the invoice row would survive the cascade with a NULL
    //    enrollment_id. Spec: "payments/related records" must be
    //    permanently deleted.
    if (hasInvoices && enrollmentIds.length > 0) {
      await client.query(
        `DELETE FROM invoices WHERE enrollment_id = ANY($1::int[])`,
        [enrollmentIds],
      );
    }

    // 2. Write the audit tombstone BEFORE the user row disappears
    //    so we always have a permanent record of who removed what.
    //    account_deletion_audit has no FK, so it survives the cascade.
    if (hasAudit) {
      await client.query(
        `INSERT INTO account_deletion_audit
           (user_id, role_snapshot, email_snapshot, phone_snapshot,
            institution_id, initiated_by, metadata)
         VALUES ($1, 'student', $2, $3, $4, 'admin', $5::jsonb)`,
        [
          studentId,
          student.email || null,
          student.phone || null,
          student.institution_id || null,
          JSON.stringify({
            deleted_by_admin_id: adminId,
            enrollment_count:    enrollmentIds.length,
            reason:              'admin_hard_delete',
          }),
        ],
      );
    }

    // 3. Cascade the user delete. Every table with an
    //    `ON DELETE CASCADE` referencing users.id (student_profiles,
    //    enrollments, attendance, notifications, leave_requests,
    //    performance_reports, student_belt_promotions, certificates,
    //    student_curriculum_progress, event_payments, feedback,
    //    course_completions, attendance_audit, account_activity_log,
    //    …) is emptied automatically.
    const del = await client.query(
      'DELETE FROM users WHERE id = $1 AND role = $2 RETURNING id',
      [studentId, 'student'],
    );
    if (del.rowCount === 0) {
      // Shouldn't happen — we just SELECTed the row above — but roll
      // back so we never return success on a phantom delete.
      throw new Error('Student row not deleted (concurrent modification?)');
    }

    await client.query('COMMIT');

    console.log(
      `[deleteStudentByAdmin] hard-deleted student=${studentId} by admin=${adminId}, enrollments=${enrollmentIds.length}`,
    );
    return res.json({
      message: `${student.name} and all their data have been permanently removed.`,
      student_id:       studentId,
      enrollments_purged: enrollmentIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('deleteStudentByAdmin error:', err);
    return res.status(500).json({
      message: 'Failed to delete student. Nothing was changed.',
      error:   err.message,
    });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/enrollments/:id/course
//
// Institution admin switches this enrollment to a different course
// offered by the same academy. Only enrollments.course_id changes —
// attendance rows (keyed on batch_id + student_id), payments (keyed
// on enrollment id via payment_reference), certificates, and belt
// history all reference the enrollment/student ids, so they stay put.
//
// Body:  { course_id: number }
// Guards:
//   • Enrollment must belong to the caller's institution tree (or a
//     sub-branch under the caller). Cross-academy transfers refused.
//   • Target course must be under the SAME root institution AND
//     `status='active'`. Prevents "transferred to a deleted /
//     disabled course" bugs.
//   • If the current enrollment has a batch, we DO NOT auto-detach —
//     the admin is expected to run Transfer Batch next to pick a
//     batch under the new course. We only WARN in the response if the
//     student's current batch is now on a different course.
// ─────────────────────────────────────────────────────────────────────
exports.changeEnrollmentCourse = async (req, res) => {
  try {
    const enrollmentId = parseInt(req.params.id, 10);
    const courseId     = parseInt(req.body?.course_id, 10);
    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).json({ message: 'Bad enrollment id.' });
    }
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ field: 'course_id', message: 'course_id is required.' });
    }

    // Resolve caller's institution tree root.
    const meRes = await pool.query(
      `SELECT u.institution_id,
              COALESCE(i.parent_institution_id, i.id) AS root_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1`,
      [req.user.id],
    );
    const rootId = meRes.rows[0]?.root_id;
    if (!rootId) return res.status(403).json({ message: 'No institution linked.' });

    // Load the enrollment + verify it's in the caller's academy tree.
    // Enrollments carry institution_id which is either the root or a
    // sub-branch under it — accept either.
    const enrollRes = await pool.query(
      `SELECT e.id, e.student_id, e.course_id, e.batch_id, e.institution_id,
              i.parent_institution_id
         FROM enrollments e
         JOIN institutions i ON i.id = e.institution_id
        WHERE e.id = $1
        LIMIT 1`,
      [enrollmentId],
    );
    const enrollment = enrollRes.rows[0];
    if (!enrollment) return res.status(404).json({ message: 'Enrollment not found.' });
    const enrollRoot = enrollment.parent_institution_id || enrollment.institution_id;
    if (enrollRoot !== rootId) {
      return res.status(403).json({ message: 'Enrollment is not in your academy.' });
    }

    // Verify the target course belongs to the same root and is active.
    const courseRes = await pool.query(
      `SELECT c.id, c.name, c.institution_id, COALESCE(c.status, 'active') AS status
         FROM courses c
        WHERE c.id = $1
        LIMIT 1`,
      [courseId],
    );
    const course = courseRes.rows[0];
    if (!course) return res.status(404).json({ message: 'Course not found.' });
    if (course.institution_id !== rootId) {
      return res.status(403).json({ message: 'Course is not in your academy.' });
    }
    if (course.status !== 'active') {
      return res.status(400).json({ message: 'That course is not currently active.' });
    }

    if (enrollment.course_id === courseId) {
      return res.status(200).json({
        message: 'Student is already enrolled in this course.',
        enrollment,
        no_change: true,
      });
    }

    // Capture the OLD course name BEFORE the update so the WhatsApp
    // notification can include both previous and new course names.
    let oldCourseName = null;
    if (enrollment.course_id) {
      const oldCourseRes = await pool.query(
        `SELECT name FROM courses WHERE id = $1 LIMIT 1`,
        [enrollment.course_id],
      );
      oldCourseName = oldCourseRes.rows[0]?.name || null;
    }

    // Warn (but don't refuse) when the current batch is no longer
    // valid for the new course. The admin is expected to run Transfer
    // Batch next to pick a batch under the new course. Surfaced as a
    // `batch_mismatch: true` flag so the mobile can prompt.
    let batchMismatch = false;
    if (enrollment.batch_id) {
      const bRes = await pool.query(
        `SELECT course_id FROM batches WHERE id = $1`,
        [enrollment.batch_id],
      );
      const bCourse = bRes.rows[0]?.course_id;
      if (bCourse && bCourse !== courseId) batchMismatch = true;
    }

    const updated = await pool.query(
      `UPDATE enrollments
          SET course_id = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, student_id, course_id, batch_id, institution_id, payment_status`,
      [enrollmentId, courseId],
    );

    // ── Async WhatsApp notification (fire-and-forget) ──────────────
    // Runs AFTER the DB update has committed. A WhatsApp failure
    // never rolls back the course change or affects the HTTP response.
    (async () => {
      try {
        const { sendCourseTransferMessage } = require('../services/whatsapp.service');
        // Fetch student details + institution name for the message.
        const detailRes = await pool.query(
          `SELECT u.name AS student_name, u.phone AS student_phone,
                  COALESCE(ri.name, i.name) AS institution_name
             FROM users u
             LEFT JOIN institutions i  ON i.id = u.institution_id
             LEFT JOIN institutions ri ON ri.id = i.parent_institution_id
            WHERE u.id = $1
            LIMIT 1`,
          [enrollment.student_id],
        );
        const detail = detailRes.rows[0];
        if (!detail || !detail.student_phone) {
          console.log(
            `[changeEnrollmentCourse] WhatsApp skipped → enrollment=${enrollmentId} reason=no-student-phone`,
          );
          return;
        }
        await sendCourseTransferMessage({
          adminUserId:     req.user.id,
          phone:           detail.student_phone,
          studentName:     detail.student_name,
          institutionName: detail.institution_name,
          oldCourseName,
          newCourseName:   course.name,
        });
      } catch (waErr) {
        console.warn(
          `[changeEnrollmentCourse] WhatsApp notification failed (non-blocking):`,
          waErr?.message,
        );
      }
    })();

    return res.json({
      message: 'Course changed successfully.',
      enrollment: updated.rows[0],
      new_course_name: course.name,
      batch_mismatch:  batchMismatch,
    });
  } catch (err) {
    // updated_at column may not exist on very old schemas — retry
    // without it so a stale DB can't 500 the transfer.
    if (err && err.code === '42703' && /updated_at/i.test(err.message || '')) {
      try {
        const enrollmentId = parseInt(req.params.id, 10);
        const courseId     = parseInt(req.body?.course_id, 10);
        const legacy = await pool.query(
          `UPDATE enrollments SET course_id = $2 WHERE id = $1
             RETURNING id, student_id, course_id, batch_id, institution_id, payment_status`,
          [enrollmentId, courseId],
        );
        return res.json({
          message: 'Course changed successfully.',
          enrollment: legacy.rows[0],
        });
      } catch (_) { /* fall through */ }
    }
    console.error('changeEnrollmentCourse error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/enrollments/:id/batch
//
// Institution admin moves this enrollment to a different batch under
// the same course + academy. Only enrollments.batch_id changes.
// Attendance history stays on the OLD batch id (per-session rows are
// keyed on (batch_id, student_id, date) — that's exactly the record
// we want to preserve for historical reporting).
//
// Body:  { batch_id: number }
// Guards:
//   • Enrollment must belong to the caller's academy tree.
//   • Target batch must exist AND be under the same academy tree.
//   • Target batch must belong to the SAME course as the enrollment
//     (the admin should Change Course first if they want a batch
//     under a different course).
//   • Target batch must NOT be the student's CURRENT batch.
// ─────────────────────────────────────────────────────────────────────
exports.transferEnrollmentBatch = async (req, res) => {
  try {
    const enrollmentId = parseInt(req.params.id, 10);
    const batchId      = parseInt(req.body?.batch_id, 10);
    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).json({ message: 'Bad enrollment id.' });
    }
    if (!Number.isFinite(batchId)) {
      return res.status(400).json({ field: 'batch_id', message: 'batch_id is required.' });
    }

    const meRes = await pool.query(
      `SELECT u.institution_id,
              COALESCE(i.parent_institution_id, i.id) AS root_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1`,
      [req.user.id],
    );
    const rootId = meRes.rows[0]?.root_id;
    if (!rootId) return res.status(403).json({ message: 'No institution linked.' });

    const enrollRes = await pool.query(
      `SELECT e.id, e.student_id, e.course_id, e.batch_id, e.institution_id,
              i.parent_institution_id
         FROM enrollments e
         JOIN institutions i ON i.id = e.institution_id
        WHERE e.id = $1
        LIMIT 1`,
      [enrollmentId],
    );
    const enrollment = enrollRes.rows[0];
    if (!enrollment) return res.status(404).json({ message: 'Enrollment not found.' });
    const enrollRoot = enrollment.parent_institution_id || enrollment.institution_id;
    if (enrollRoot !== rootId) {
      return res.status(403).json({ message: 'Enrollment is not in your academy.' });
    }

    if (enrollment.batch_id === batchId) {
      return res.status(400).json({ message: 'Student is already in this batch.' });
    }

    // Capture the OLD batch name BEFORE the update so the WhatsApp
    // notification can include both previous and new batch names.
    let oldBatchName = null;
    if (enrollment.batch_id) {
      const oldBatchRes = await pool.query(
        `SELECT name FROM batches WHERE id = $1 LIMIT 1`,
        [enrollment.batch_id],
      );
      oldBatchName = oldBatchRes.rows[0]?.name || null;
    }

    // Target batch — must be same academy tree AND same course as the
    // enrollment. batches.institution_id is the branch id when the
    // batch runs at a sub-branch, so we join to institutions to walk
    // to the tree root.
    const batchRes = await pool.query(
      `SELECT b.id, b.name, b.course_id, b.institution_id,
              COALESCE(bi.parent_institution_id, bi.id) AS root_id
         FROM batches b
         JOIN institutions bi ON bi.id = b.institution_id
        WHERE b.id = $1
        LIMIT 1`,
      [batchId],
    );
    const batch = batchRes.rows[0];
    if (!batch) return res.status(404).json({ message: 'Batch not found.' });
    if (batch.root_id !== rootId) {
      return res.status(403).json({ message: 'Batch is not in your academy.' });
    }
    if (batch.course_id !== enrollment.course_id) {
      return res.status(400).json({
        message: 'That batch runs a different course. Change the course first if you want to move.',
      });
    }

    const updated = await pool.query(
      `UPDATE enrollments
          SET batch_id = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, student_id, course_id, batch_id, institution_id, payment_status`,
      [enrollmentId, batchId],
    );

    // ── Async WhatsApp notification (fire-and-forget) ──────────────
    // Runs AFTER the DB update has committed. A WhatsApp failure
    // never rolls back the batch transfer or affects the HTTP response.
    (async () => {
      try {
        const { sendBatchTransferMessage } = require('../services/whatsapp.service');
        // Fetch student details + institution name for the message.
        const detailRes = await pool.query(
          `SELECT u.name AS student_name, u.phone AS student_phone,
                  COALESCE(ri.name, i.name) AS institution_name
             FROM users u
             LEFT JOIN institutions i  ON i.id = u.institution_id
             LEFT JOIN institutions ri ON ri.id = i.parent_institution_id
            WHERE u.id = $1
            LIMIT 1`,
          [enrollment.student_id],
        );
        const detail = detailRes.rows[0];
        if (!detail || !detail.student_phone) {
          console.log(
            `[transferEnrollmentBatch] WhatsApp skipped → enrollment=${enrollmentId} reason=no-student-phone`,
          );
          return;
        }
        await sendBatchTransferMessage({
          adminUserId:     req.user.id,
          phone:           detail.student_phone,
          studentName:     detail.student_name,
          institutionName: detail.institution_name,
          oldBatchName,
          newBatchName:    batch.name,
        });
      } catch (waErr) {
        console.warn(
          `[transferEnrollmentBatch] WhatsApp notification failed (non-blocking):`,
          waErr?.message,
        );
      }
    })();

    return res.json({
      message: 'Batch transferred successfully.',
      enrollment: updated.rows[0],
      new_batch_name: batch.name,
    });
  } catch (err) {
    if (err && err.code === '42703' && /updated_at/i.test(err.message || '')) {
      try {
        const enrollmentId = parseInt(req.params.id, 10);
        const batchId      = parseInt(req.body?.batch_id, 10);
        const legacy = await pool.query(
          `UPDATE enrollments SET batch_id = $2 WHERE id = $1
             RETURNING id, student_id, course_id, batch_id, institution_id, payment_status`,
          [enrollmentId, batchId],
        );
        return res.json({
          message: 'Batch transferred successfully.',
          enrollment: legacy.rows[0],
        });
      } catch (_) { /* fall through */ }
    }
    console.error('transferEnrollmentBatch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

