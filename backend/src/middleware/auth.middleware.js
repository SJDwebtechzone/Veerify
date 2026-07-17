const jwt = require('jsonwebtoken');

// Verify JWT token. Reads from either:
//   1. Authorization: Bearer <token> header (default)
//   2. ?token=<token> query param (needed for browser-initiated GETs
//      like PDF downloads, since the browser won't send the header
//      when you Linking.openURL a signed URL).
exports.verifyToken = (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;  // { id, email, role, institution_id }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};