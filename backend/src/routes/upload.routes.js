const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const logoUpload = require('../middleware/upload.middleware');
const { verifyToken } = require('../middleware/auth.middleware');

// Ensure uploads dir exists (for the generic /uploads endpoint).
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Generic multer used by POST /api/uploads — does NOT touch req.user, so it
// works for both authenticated and anonymous callers (CMS uploads from the
// web admin, course banners from the mobile admin, etc.). Files land in
// `uploads/<stamp>-<rand>.<ext>` so collisions can't happen.
const genericStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${rand}${ext}`);
  },
});
const genericFileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, WebP and GIF images are allowed'), false);
};
const genericUpload = multer({
  storage: genericStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: genericFileFilter,
});

// POST /api/uploads — multipart/form-data, field name "file"
//
// Returns BOTH:
//   path: relative path "/uploads/<file>"  — store this in the DB
//   url:  absolute URL on the API host     — use for browser previews
//
// Mobile + admin should save `path` to the DB and prepend their own
// base URL at render time. That way the same record works for the
// browser admin (localhost:5000) and the emulator (10.0.2.2:5000).
router.post('/', genericUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const relPath = `/uploads/${req.file.filename}`;
  const host = `${req.protocol}://${req.get('host')}`;
  const url = `${host}${relPath}`;
  res.status(201).json({ path: relPath, url, filename: req.file.filename, size: req.file.size });
});

// POST /api/uploads/logo — auth-required logo upload (uses the legacy
// per-user-id filename middleware from upload.middleware.js).
router.post('/logo', verifyToken, logoUpload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const logoUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${req.file.filename}`;
    res.json({
      message: 'Logo uploaded successfully',
      logo_url: logoUrl,
      filename: req.file.filename,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// Multer / generic upload error handler — must come AFTER the routes that use it.
router.use((err, _req, res, _next) => {
  if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
});

module.exports = router;
