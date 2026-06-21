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

// Slugify free-form names into a filesystem-safe filename prefix.
// "Mohan Kumar !"  →  "mohan-kumar"
// Drops everything that isn't a-z, 0-9, hyphen or space; collapses
// whitespace into single hyphens; trims hyphens off the ends; clamps
// to 40 chars so the final path doesn't explode if someone pastes a
// novel into the name field.
function slugifyHint(raw) {
  if (!raw) return null;
  const slug = String(raw)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')      // strip accents
    .replace(/[^a-z0-9\s-]/g, '')                            // keep alnum + space + hyphen
    .replace(/\s+/g, '-')                                    // spaces → hyphens
    .replace(/-+/g, '-')                                     // collapse repeats
    .replace(/^-|-$/g, '')                                   // trim ends
    .slice(0, 40);
  return slug || null;
}

// Generic multer used by POST /api/uploads — does NOT touch req.user, so it
// works for both authenticated and anonymous callers (CMS uploads from the
// web admin, course banners from the mobile admin, etc.).
//
// Filename format:
//   • With ?name_hint=mohan-kumar  →  uploads/mohan-kumar-<stamp>-<rand>.jpg
//   • Without hint                 →  uploads/<stamp>-<rand>.jpg
//
// The hint is slugified server-side, so the caller can pass a friendly
// raw name ("Mohan Kumar") without worrying about safety. The stamp +
// rand suffix guarantees collisions can't happen even when two students
// share a name.
const genericStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const hint = slugifyHint(req.query?.name_hint);
    const base = hint ? `${hint}-${stamp}-${rand}` : `${stamp}-${rand}`;
    cb(null, `${base}${ext}`);
  },
});
const genericFileFilter = (_req, file, cb) => {
  // Accept common images plus PDFs (accreditation certificates etc.).
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only JPG, PNG, WebP, GIF or PDF files are allowed'), false);
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
