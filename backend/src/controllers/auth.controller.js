const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/mailer');

// How long a password-reset OTP stays valid.
const RESET_OTP_TTL_MINUTES = 10;
// How many wrong attempts before we lock the OTP and force a fresh request.
const RESET_OTP_MAX_ATTEMPTS = 5;

// REGISTER a new user
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // Basic validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required' });
    }

    // Check if role is valid
    const validRoles = ['admin', 'trainer', 'student', 'parent'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, trainer, or student' });
    }

    // Check if email already exists
 const existing = await pool.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

if (existing.rows.length > 0) {

  const existingUser = existing.rows[0];

  // Active account exists
  if (!existingUser.is_deleted) {
    return res.status(409).json({
      message: 'Email already registered'
    });
  }

  // Restore deleted account
 const hashedPassword = await bcrypt.hash(password, 10);

const restored = await pool.query(
  `
  UPDATE users
  SET
    name = $1,
    phone = $2,
    password = $3,
    role = $4,
    is_deleted = FALSE,
    deleted_at = NULL,
    deleted_by = NULL
  WHERE email = $5
RETURNING id, name, email, phone, role, institution_id, created_at  `,
  [
    name,
    phone,
    hashedPassword,
    role,
    email
  ]
);

  const user = restored.rows[0];

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      institution_id: user.institution_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(200).json({
    message: 'Account restored successfully',
    token,
    user
  });
}
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, email, phone, role, institution_id, created_at`,
      [name, email, phone, hashedPassword, role]
    );

   const user = result.rows[0];

    // Generate token
    const token = jwt.sign(
      { id: user.id, role: user.role, institution_id: user.institution_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

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

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        institution_id: user.institution_id
      }
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
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashed, userId],
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET current user info (protected route)
exports.getMe = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, role, institution_id, status, created_at FROM users WHERE id = $1',
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
      `UPDATE users SET
         password           = $1,
         reset_otp_hash     = NULL,
         reset_otp_expires  = NULL,
         reset_otp_attempts = 0
       WHERE id = $2`,
      [newHash, user.id],
    );

    return res.json({ message: 'Password updated. Please sign in with your new password.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};