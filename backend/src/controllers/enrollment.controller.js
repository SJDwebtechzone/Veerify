const pool = require('../config/db');
// Use the same bcrypt package as the rest of the codebase (the native
// one, not bcryptjs). Both expose the same hash/compare API so no
// other code change is needed.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendStudentCredentialsEmail } = require('../utils/mailer');
const { ensureCapacity, limitResponse } = require('../utils/planLimits');

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

    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [userId],
    );
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) {
      return res.status(403).json({ message: 'You are not linked to an institution.' });
    }

    const result = await pool.query(
      `SELECT
         e.id,
         e.enrolled_at,
         e.payment_status,
         e.payment_amount,
         e.paid_at,
         e.payment_reference,

         u.id    AS student_id,
         u.name  AS student_name,
         u.email AS student_email,
         u.phone AS student_phone,

         sp.photo_url AS student_photo_url,
         sp.gender    AS student_gender,

         c.id    AS course_id,
         c.name  AS course_name,

         b.id    AS batch_id,
         b.name  AS batch_name

       FROM enrollments e
       JOIN users u        ON e.student_id = u.id
       JOIN batches b      ON e.batch_id   = b.id
       JOIN courses c      ON b.course_id  = c.id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE e.institution_id = $1
         AND COALESCE(u.is_deleted, false) = false
       ORDER BY e.enrolled_at DESC`,
      [institutionId],
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
      institution_id: institutionId,
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
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanName  = String(full_name || '').trim();
      if (!adminMode || !cleanEmail || !cleanName) {
        return res.status(400).json({
          message: 'Admin enrolment needs full_name + email so we can create the student\'s login.',
        });
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
        const insertUser = await pool.query(
          `INSERT INTO users (name, email, phone, password, role, institution_id)
           VALUES ($1, $2, $3, $4, 'student', $5)
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

    res.status(201).json({
      message: createdStudentCreds
        ? 'Student enrolled. Login details emailed to the student.'
        : 'Enrolled successfully. Please complete payment.',
      enrollment: result.rows[0],
      student_credentials_sent: !!createdStudentCreds,
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

    // Get batch info
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id FROM batches WHERE id = $1',
      [id]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Authorization check
    if (userRole === 'admin') {
      // Admin must own this batch's institution
      const userResult = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
      if (userResult.rows[0].institution_id !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
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

// GET every enrollment across every batch of a single course. Admin-only,
// scoped to the admin's own institution. Used by the admin Course Detail
// screen to show the full enrolled roster + payment status in one shot.
exports.getEnrollmentsByCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Resolve the calling admin's institution and confirm the course
    // belongs to it.
    const userRes = await pool.query(
      'SELECT institution_id FROM users WHERE id = $1',
      [userId],
    );
    const adminInstitutionId = userRes.rows[0]?.institution_id;
    if (!adminInstitutionId) {
      return res.status(403).json({ message: 'No institution linked to your account' });
    }

    const courseRes = await pool.query(
      'SELECT id, institution_id, name FROM courses WHERE id = $1',
      [id],
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }
    if (courseRes.rows[0].institution_id !== adminInstitutionId) {
      return res.status(403).json({ message: 'Not your course' });
    }

    // Aggregate every enrollment across every batch under this course.
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
         b.days_of_week,
         b.start_time,
         b.end_time
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN users   u ON e.student_id = u.id
       WHERE b.course_id = $1
       ORDER BY e.enrolled_at DESC`,
      [id],
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