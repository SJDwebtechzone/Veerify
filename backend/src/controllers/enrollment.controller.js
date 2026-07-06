const pool = require('../config/db');
// Use the same bcrypt package as the rest of the codebase (the native
// one, not bcryptjs). Both expose the same hash/compare API so no
// other code change is needed.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendStudentCredentialsEmail } = require('../utils/mailer');
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

         u.id    AS student_id,
         u.name  AS student_name,
         u.email AS student_email,
         u.phone AS student_phone,

         sp.photo_url AS student_photo_url,
         sp.gender    AS student_gender,

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
        // Create a fresh student account with a temp password.
        const tempPassword = generateTempPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);
        // Find the admin's institution so we link the new student to it.
        const adminInst = await pool.query(
          `SELECT institution_id FROM users WHERE id = $1`,
          [req.user.id],
        );
        const institutionId = adminInst.rows[0]?.institution_id || null;
        // must_change_password=TRUE — admin-mode enrolment generated the
        // student's password and emails it to them, so the mobile pops
        // the first-login "set a new password" dialog on their next sign-in.
        const insertUser = await pool.query(
          `INSERT INTO users (name, email, phone, password, role, institution_id,
                              must_change_password)
           VALUES ($1, $2, $3, $4, 'student', $5, TRUE)
           RETURNING id, name, email`,
          [cleanName, cleanEmail,
           String(contact_number || '').trim() || null,
           hashed, institutionId],
        );
        studentId = insertUser.rows[0].id;
        // Defer the send until after the transaction commits so we
        // don't email a student whose enrollment ultimately fails.
        createdStudentCreds = {
          to: cleanEmail,
          name: cleanName,
          loginEmail: cleanEmail,
          password: tempPassword,
        };
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

    // ── Offline payment branch ───────────────────────────────────────
    // When an admin enrols a student and supplies a payment_mode (cash,
    // upi, bank, cheque), we treat the fee as collected at the counter
    // and flip the enrolment to 'paid' in the same transaction. This
    // skips the Razorpay / mock-pay step and lets the admin record the
    // sale in one shot. Self-enrolled students never set this branch —
    // they continue through the existing online-pay flow.
    const ALLOWED_MODES = ['cash', 'upi', 'bank', 'cheque'];
    const rawMode = String(req.body?.payment_mode || '').trim().toLowerCase();
    if (req.body?.admin_mode === true && rawMode) {
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
           paid_at           = NOW()
         WHERE id = $4
         RETURNING *`,
        [rawMode, reference, amount, result.rows[0].id]
      );
      // Replace the row we return below so the caller sees the paid state.
      result.rows[0] = paid.rows[0];
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

// MOCK PAYMENT - flips an enrollment from pending to paid. Used while
// Razorpay-for-fees is still deferred. Replace this with a real Razorpay
// webhook handler once the fees flow is wired.
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
    const r = await pool.query(
      'SELECT * FROM student_profiles WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ profile: r.rows[0] || null });
  } catch (err) {
    console.error('Get my profile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my enrollments (student)
exports.getMyEnrollments = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT e.*,
              b.name AS batch_name, b.course_id, b.days_of_week, b.start_time, b.end_time, b.mode,
              c.name AS course_name, c.price AS course_price,
              i.name AS institution_name, i.city AS institution_city,
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
