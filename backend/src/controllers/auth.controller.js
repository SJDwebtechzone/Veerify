const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
const {
  validateEmailFormat, validatePhoneFormat,
  ensureEmailUnique, ensurePhoneUnique,
  normaliseEmail, normalisePhone,
} = require('../utils/contactValidation');

// How long a password-reset OTP stays valid.
const RESET_OTP_TTL_MINUTES = 10;
// How many wrong attempts before we lock the OTP and force a fresh request.
const RESET_OTP_MAX_ATTEMPTS = 5;

// REGISTER a new user
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // Basic validation
    if (!name || !password || !role) {
      return res.status(400).json({ message: 'Name, password, and role are required' });
    }

    // Check if role is valid
    const validRoles = ['admin', 'trainer', 'student', 'parent'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, trainer, or student' });
    }

    // ── Email + phone validation (format + uniqueness) ────────────────
    // Phone is optional here (legacy: register form has it as optional)
    // but if supplied it must be a real 10-digit Indian mobile.
    const eFmt = validateEmailFormat(email, { required: true });
    if (!eFmt.ok) return res.status(eFmt.status).json(eFmt.body);
    const pFmt = validatePhoneFormat(phone, { required: false });
    if (!pFmt.ok) return res.status(pFmt.status).json(pFmt.body);
    // Phone uniqueness is enforced here; email uniqueness is handled
    // by the existing "restore deleted" branch below, so we keep that
    // logic intact and only block live duplicates on phone here.
    if (pFmt.value) {
      const phoneUnique = await ensurePhoneUnique(pFmt.value);
      if (!phoneUnique.ok) {
        return res.status(phoneUnique.status).json(phoneUnique.body);
      }
    }

    // Normalised values used for the INSERT/UPDATE.
    const cleanEmail = eFmt.value;
    const cleanPhone = pFmt.value;

    // Uniqueness check — ONLY consider live rows. A soft-deleted user
    // does not block registration: the fresh account gets its own new
    // user_id and its own history. The old row stays soft-deleted
    // forever for audit purposes, and the partial-unique index on
    // users.email (migration 050) makes this INSERT safe at the DB
    // layer too.
    const liveExisting = await pool.query(
      `SELECT id FROM users
        WHERE LOWER(email) = $1
          AND COALESCE(is_deleted, FALSE) = FALSE
        LIMIT 1`,
      [cleanEmail],
    );
    if (liveExisting.rows.length > 0) {
      return res.status(409).json({
        code:    'EMAIL_TAKEN',
        field:   'email',
        message: 'This email is already registered. Please sign in or use a different email.',
      });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, role, institution_id, created_at`,
      [name, cleanEmail, cleanPhone, hashedPassword, role]
    );

   const user = result.rows[0];

    // Generate token
    const token = jwt.sign(
      { id: user.id, role: user.role, institution_id: user.institution_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ── Welcome SMS (fire-and-forget) ─────────────────────────────
    // Fires after the DB commit + JWT succeed, so a Msg91 outage cannot
    // block the response. dispatchWelcomeSms swallows errors internally
    // and only logs — the registration flow is never affected.
    // The 'admin' role here maps to institution owner sign-ups (the
    // wizard creates admins first, then attaches the institution).
    const smsRole = user.role === 'admin' ? 'institution' : user.role;
    dispatchWelcomeSms({
      phone:    user.phone,
      name:     user.name,
      role:     smsRole,
      loginId:  user.email,
      // Password chosen by the user themselves during self-registration,
      // so we don't echo it back over SMS. tempPassword is left blank.
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
            institution_id: user.institution_id,

        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user
const result = await pool.query(
  `
  SELECT * FROM users
  WHERE email = $1
  AND is_deleted = FALSE
  `,
  [email]
);    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Compare password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Block sign-in for pending-payment accounts (created by an admin
    // via "Enable Payment Link" but never activated). Once the
    // Razorpay webhook flips the enrolment to paid, activateStudentAfterPayment
    // upgrades the row to status='active' and mails the temp password.
    if (user.status === 'pending') {
      return res.status(403).json({
        code:    'PAYMENT_PENDING',
        message: 'Your account is pending payment. Once payment is confirmed you\'ll receive an email with your login details.',
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        institution_id: user.institution_id
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Look up the institution's display name + activation state once
    // at login. Name is used for the header chip; onboarding_status
    // powers the "Pending Payment" gate on the mobile so an admin
    // whose Razorpay payment hasn't cleared can't see feature
    // screens. Best-effort: any error here just leaves the fields
    // empty and the downstream /institutions/me fetch takes over.
    let institutionName        = null;
    let onboardingStatus       = null;
    let subscriptionEnd        = null;
    let paidAt                 = null;
    if (user.institution_id) {
      try {
        const instRow = await pool.query(
          `SELECT COALESCE(NULLIF(name, ''), NULLIF(brand_name, '')) AS name,
                  onboarding_status,
                  subscription_end,
                  paid_at
             FROM institutions WHERE id = $1`,
          [user.institution_id],
        );
        institutionName  = instRow.rows[0]?.name || null;
        onboardingStatus = instRow.rows[0]?.onboarding_status || null;
        subscriptionEnd  = instRow.rows[0]?.subscription_end   || null;
        paidAt           = instRow.rows[0]?.paid_at            || null;
      } catch (e) {
        console.warn('[login] institution name lookup failed:', e?.message);
      }
    }

    // ── Institution activation state — allowed, but restricted ───
    // Login is INTENTIONALLY not blocked while the institution is
    // pending payment. The admin needs to be able to sign in to:
    //   • edit / correct any wizard details before paying,
    //   • re-trigger a Razorpay Payment Link if the approval email
    //     went missing,
    //   • view what's still owed.
    // The server marks the session as `login_state: 'pending_payment'`
    // when the institution row is approved-but-unpaid so the mobile
    // renders the restricted "Pending Payment" home (edit + retry
    // payment CTAs only). All feature endpoints — creating trainers,
    // courses, batches, enrolments — remain gated by
    // requireActiveSubscription, which 402s while the phase is
    // 'pending', so the JWT can never be used to bypass activation.
    //
    // The only paths from 'pending' → 'active' are:
    //   1. Razorpay webhook after signature verification (utils/razorpay.js
    //      verifyWebhookSignature — HMAC-SHA256 constant-time).
    //   2. Super-admin manual override via /activate/:id
    //      (requireRole('super_admin')).
    // Failed / cancelled Razorpay attempts leave the row at 'approved'
    // → next login again returns login_state='pending_payment'.
    const isInstitutionAdmin = user.role === 'admin' && !!user.institution_id;
    const isPendingPayment =
      isInstitutionAdmin &&
      onboardingStatus === 'approved' &&
      !paidAt;
    const loginState = isPendingPayment ? 'pending_payment' : 'active';

    res.json({
      message:
        loginState === 'pending_payment'
          ? 'Login successful — payment pending. Please complete Razorpay to activate.'
          : 'Login successful',
      token,
      // Top-level flag the mobile branches on to render the restricted
      // "Pending Payment" home (edit institution + retry payment) vs
      // the full dashboard. Same field is echoed inside `user` for
      // clients that ignore top-level metadata.
      login_state: loginState,
      user: {
        id:               user.id,
        name:             user.name,
        email:            user.email,
        role:             user.role,
        institution_id:   user.institution_id,
        institution_name: institutionName,
        // Snapshot of the institution's activation state so the mobile
        // can render the correct home screen immediately. Kept as-is
        // (no phase computation) so the client uses the same fields
        // it always has — see subscriptionGuard.getCurrentPhase for
        // the canonical derivation used server-side.
        institution_onboarding_status: onboardingStatus,
        institution_paid_at:           paidAt,
        institution_subscription_end:  subscriptionEnd,
        // Restricted session — mobile MUST NOT show create/manage
        // features while this is 'pending_payment'. Editing the
        // wizard fields and retrying the payment link are the only
        // allowed actions until the webhook flips the row to active.
        login_state:                   loginState,
        // True for accounts that were created on someone's behalf with
        // a temp password (currently sub-branch admins). The mobile pops
        // a "Change password / I'll do it later" dialog when this is
        // true. Cleared the moment the user actually changes their
        // password via /auth/change-password (or /auth/reset-password).
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/auth/change-password — verify current password, hash new one.
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ message: 'current_password and new_password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const userId = req.user.id;
    const r = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const valid = await bcrypt.compare(current_password, r.rows[0].password);
    if (!valid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    // Clear must_change_password — the user now has a password they
    // chose themselves, so the first-login dialog won't pop again.
    await pool.query(
      `UPDATE users
          SET password = $1,
              must_change_password = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
      [hashed, userId],
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/auth/delete-account
//
// Self-service permanent account deletion. Called after the mobile
// has shown the "Are you sure?" confirmation and the user has
// re-entered their password. Contract:
//
//   1. Verify the caller's password (bcrypt compare against the
//      currently-stored hash). Reject with 401 on mismatch.
//   2. Write an audit row into account_deletion_audit BEFORE any
//      mutation, so we always have a permanent record even if the
//      teardown itself errors out mid-way.
//   3. Anonymise personal data on `users` (name/email/phone
//      tombstoned, password cleared, is_deleted=TRUE, status='deleted').
//      Financial + legal records that reference this user by
//      user_id (enrollments, payments, invoices, subscription_
//      transactions, certificates) stay intact — the FK still
//      resolves to a "Deleted User" row so ledgers don't break.
//   4. Anonymise the paired student_profiles row (full_name,
//      contact, address, health notes, photo_url all cleared).
//   5. Because the password is cleared and is_deleted flips TRUE,
//      the existing login handler rejects any further sign-in
//      attempt with the same credentials, and every currently-live
//      JWT will 401 on the next protected call. That's the
//      "revoke all active sessions and tokens" contract — we don't
//      maintain a persistent session table, so token invalidation
//      falls out naturally from the users-row state.
exports.deleteAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const { password, reason } = req.body || {};
    if (!password) {
      return res.status(400).json({
        code:    'PASSWORD_REQUIRED',
        message: 'Please re-enter your password to confirm account deletion.',
      });
    }

    const userId = req.user.id;
    const userRes = await client.query(
      `SELECT id, name, email, phone, role, institution_id, password
         FROM users
        WHERE id = $1 AND COALESCE(is_deleted, FALSE) = FALSE`,
      [userId],
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Account not found' });
    }
    const user = userRes.rows[0];

    const valid = await bcrypt.compare(password, user.password || '');
    if (!valid) {
      return res.status(401).json({
        code:    'INVALID_PASSWORD',
        message: 'The password you entered is incorrect. Try again.',
      });
    }

    // Prevent an institution admin from deleting themselves while
    // their institution is still live — that would orphan every
    // student/trainer under them with no owner. They must transfer
    // ownership or delete the institution first via super-admin.
    if (user.role === 'admin' && user.institution_id) {
      const instRes = await client.query(
        `SELECT onboarding_status, deleted_at FROM institutions WHERE id = $1`,
        [user.institution_id],
      );
      const inst = instRes.rows[0];
      if (inst && !inst.deleted_at && inst.onboarding_status !== 'deleted') {
        return res.status(409).json({
          code:    'INSTITUTION_STILL_ACTIVE',
          message:
            'You own an active institution. Contact support to close ' +
            'the institution before deleting your admin account.',
        });
      }
    }

    // Kick everything into a single transaction so a mid-way failure
    // leaves either the full anonymisation OR nothing — never a
    // half-scrubbed user row.
    await client.query('BEGIN');

    // 1. Audit row first — must survive even if the teardown errors.
    await client.query(
      `INSERT INTO account_deletion_audit
         (user_id, role_snapshot, email_snapshot, phone_snapshot,
          institution_id, initiated_by, metadata)
       VALUES ($1, $2, $3, $4, $5, 'user', $6)`,
      [
        userId,
        user.role,
        user.email || null,
        user.phone || null,
        user.institution_id || null,
        {
          reason:     typeof reason === 'string' ? reason.slice(0, 500) : null,
          ip:         req.ip || null,
          user_agent: req.headers['user-agent'] || null,
        },
      ],
    );

    // 2. Anonymise the user row. Email/phone are switched to
    //    deterministic tombstone values so the UNIQUE indexes on
    //    those columns still hold. Password is cleared so no login
    //    is possible; must_change_password is set so any future
    //    session would be forced to change (defensive — is_deleted
    //    already blocks login upstream).
    const tombstoneEmail = `deleted+${userId}@veerify.local`;
    const tombstonePhone = `deleted-${userId}`;
    await client.query(
      `UPDATE users SET
         name                 = 'Deleted User',
         email                = $2,
         phone                = $3,
         password             = '',
         status               = 'deleted',
         is_deleted           = TRUE,
         must_change_password = FALSE,
         institution_id       = NULL,
         updated_at           = NOW()
       WHERE id = $1`,
      [userId, tombstoneEmail, tombstonePhone],
    );

    // 3. Anonymise the paired student_profiles row (if any).
    //    Enrollments + payments stay linked to the tombstoned user
    //    so financial history still resolves.
    await client.query(
      `UPDATE student_profiles SET
         full_name       = 'Deleted User',
         contact_number  = NULL,
         email           = NULL,
         address         = NULL,
         father_name     = NULL,
         mother_name     = NULL,
         disabilities    = NULL,
         photo_url       = NULL,
         emergency_contact = NULL,
         updated_at      = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId],
    );

    // 4. Trainer row (if any) — anonymise the paired profile so
    //    the tombstoned user's teaching history stays attached to
    //    batches/courses without leaking PII on the roster.
    await client.query(
      `UPDATE trainers SET
         specialization = NULL,
         experience     = NULL,
         certificate    = NULL,
         updated_at     = NOW()
       WHERE user_id = $1`,
      [userId],
    ).catch(() => { /* trainers table optional per role */ });

    await client.query('COMMIT');

    console.log(
      `[deleteAccount] user=${userId} role=${user.role} email(before)=${user.email} anonymised`,
    );

    // Response drives the mobile's success flow — show the styled
    // confirm dialog + redirect to Welcome. The mobile discards its
    // JWT so subsequent requests are unauthenticated; the
    // is_deleted flag on the users row ensures any leaked token
    // returns 401 on the next hit.
    return res.json({
      message: 'Your account has been deleted successfully.',
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('deleteAccount error:', err);
    res.status(500).json({
      message: 'Could not delete account. Please try again in a moment.',
      error:   err.message,
    });
  } finally {
    client.release();
  }
};

// GET current user info (protected route)
exports.getMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, role, institution_id, status, created_at,
              org_name, org_logo_url, alt_phone
         FROM users
        WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('GetMe error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/auth/me/profile
//
// Powers the super-admin "My Profile" editor on the admin web. The user
// can update their own profile card — Institution Name + Logo, display
// Name (Owner Name), Email, Mobile, Alternate Contact, and Role (must
// stay one of admin / super_admin).
//
// COALESCE(NULLIF) means: if the client sends an empty string we keep the
// existing value. To explicitly clear a field, the client should not send
// the key. Email uniqueness is checked manually so we can return a clean
// 409 instead of a Postgres constraint error.
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body || {};

    // Email uniqueness — only when a new (different-from-current) email
    // arrives, so the user can save the form unchanged without tripping it.
    if (b.email && typeof b.email === 'string') {
      const trimmed = b.email.trim().toLowerCase();
      if (trimmed) {
        const dup = await pool.query(
          `SELECT id FROM users
            WHERE LOWER(email) = $1
              AND id <> $2
              AND COALESCE(is_deleted, FALSE) = FALSE
            LIMIT 1`,
          [trimmed, userId],
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({
            message: 'That email is already taken by another account.',
            field:   'email',
          });
        }
      }
    }

    // Role guard — only allow flipping between the two "owner" tiers.
    // Students, trainers, parents shouldn't be reachable through this
    // endpoint (which only the super-admin web uses), but the explicit
    // whitelist keeps a sloppy client from elevating itself anyway.
    const ALLOWED_ROLES = new Set(['admin', 'super_admin']);
    if (b.role && !ALLOWED_ROLES.has(b.role)) {
      return res.status(400).json({
        message: 'Role must be one of: admin, super_admin.',
        field:   'role',
      });
    }

    const result = await pool.query(
      `UPDATE users SET
         org_name     = COALESCE(NULLIF($2, ''), org_name),
         org_logo_url = COALESCE(NULLIF($3, ''), org_logo_url),
         name         = COALESCE(NULLIF($4, ''), name),
         email        = COALESCE(NULLIF($5, ''), email),
         phone        = COALESCE(NULLIF($6, ''), phone),
         alt_phone    = COALESCE(NULLIF($7, ''), alt_phone),
         role         = COALESCE(NULLIF($8, ''), role),
         updated_at   = NOW()
       WHERE id = $1
       RETURNING id, name, email, phone, role, institution_id, status,
                 created_at, org_name, org_logo_url, alt_phone`,
      [
        userId,
        b.org_name     || '',
        b.org_logo_url || '',
        b.name         || '',
        b.email        ? b.email.trim().toLowerCase() : '',
        b.phone        || '',
        b.alt_phone    || '',
        b.role         || '',
      ],
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('updateMyProfile error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD - step 1
//
// POST /api/auth/forgot-password   { email }
//
// Issues a 6-digit OTP, stores its bcrypt hash + a 10-minute expiry on the
// users row, and emails the plain OTP to the address on file. To avoid
// account enumeration we return the same generic success message whether
// the email is in the DB or not.
// ─────────────────────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const rawEmail = (req.body?.email || '').trim().toLowerCase();
    console.log('[forgotPassword] Request received for email:', rawEmail);
    if (!rawEmail || !/\S+@\S+\.\S+/.test(rawEmail)) {
      console.warn('[forgotPassword] Invalid email format:', rawEmail);
      return res.status(400).json({ message: 'A valid email is required' });
    }

    const ok = {
      message: 'If that email is registered, a reset code has been sent. Check your inbox in a moment.',
    };

    // Look the user up. If they don't exist, we still pretend we sent.
    console.log('[forgotPassword] Querying database for:', rawEmail);
    const u = await pool.query(
      'SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND COALESCE(is_deleted, false) = false',
      [rawEmail],
    );
    console.log('[forgotPassword] Query result rows count:', u.rows.length);
    if (u.rows.length === 0) {
      console.warn('[forgotPassword] Email not found in DB or user is deleted:', rawEmail);
      return res.json(ok);
    }
    const user = u.rows[0];
    console.log('[forgotPassword] Found user:', user.name, 'with ID:', user.id);

    // Generate a cryptographically random 6-digit OTP.
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    console.log('[forgotPassword] Generated OTP:', otp);
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60_000);

    console.log('[forgotPassword] Updating OTP hash in database...');
    await pool.query(
      `UPDATE users SET
         reset_otp_hash     = $1,
         reset_otp_expires  = $2,
         reset_otp_attempts = 0
       WHERE id = $3`,
      [otpHash, expiresAt, user.id],
    );
    console.log('[forgotPassword] Database updated successfully.');

    // Best-effort email send. If SMTP isn't configured the OTP still lives
    // in the DB so an admin could retrieve it manually; in normal operation
    // this just works.
    console.log('[forgotPassword] Sending password reset email via mailer...');
    const mail = await sendPasswordResetEmail({
      to:              user.email,
      name:            user.name,
      otp,
      expiresMinutes:  RESET_OTP_TTL_MINUTES,
    });
    if (!mail.ok) {
      console.error('[forgotPassword] email send failed:', mail.error);
    } else {
      console.log('[forgotPassword] Email sent successfully! MessageID:', mail.messageId);
    }

    return res.json(ok);
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// RESET PASSWORD - step 2
//
// POST /api/auth/reset-password   { email, otp, new_password }
//
// Verifies the OTP matches the stored hash, isn't expired, and that the
// caller hasn't exhausted their attempts. On success: hashes the new
// password, updates users.password, clears the OTP fields.
// ─────────────────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const rawEmail = (req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const newPassword = req.body?.new_password || '';

    if (!rawEmail || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are all required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const u = await pool.query(
      `SELECT id, email, reset_otp_hash, reset_otp_expires, reset_otp_attempts
       FROM users
       WHERE LOWER(email) = $1
         AND COALESCE(is_deleted, false) = false`,
      [rawEmail],
    );
    if (u.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }
    const user = u.rows[0];

    if (!user.reset_otp_hash || !user.reset_otp_expires) {
      return res.status(400).json({ message: 'No reset code on file. Please request a new one.' });
    }
    if (new Date(user.reset_otp_expires).getTime() < Date.now()) {
      return res.status(400).json({ message: 'This reset code has expired. Please request a new one.' });
    }
    if ((user.reset_otp_attempts || 0) >= RESET_OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many failed attempts. Please request a new code.' });
    }

    const match = await bcrypt.compare(otp, user.reset_otp_hash);
    if (!match) {
      // Increment failed attempts so brute-force gets locked out.
      await pool.query(
        'UPDATE users SET reset_otp_attempts = COALESCE(reset_otp_attempts, 0) + 1 WHERE id = $1',
        [user.id],
      );
      return res.status(400).json({ message: 'Invalid or expired code' });
    }

    // OTP good. Hash the new password and clear the OTP fields.
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      // OTP reset counts as a user-chosen password — clear the
      // first-login flag so the change-password dialog doesn't pop again.
      `UPDATE users SET
         password             = $1,
         must_change_password = FALSE,
         reset_otp_hash       = NULL,
         reset_otp_expires    = NULL,
         reset_otp_attempts   = 0
       WHERE id = $2`,
      [newHash, user.id],
    );

    return res.json({ message: 'Password updated. Please sign in with your new password.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};