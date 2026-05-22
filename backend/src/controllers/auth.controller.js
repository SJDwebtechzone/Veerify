const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

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