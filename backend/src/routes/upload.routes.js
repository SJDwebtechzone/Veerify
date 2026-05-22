const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const upload = require('../middleware/upload.middleware');
const { verifyToken } = require('../middleware/auth.middleware');

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${rand}${ext}`);
  },
});

// Upload academy logo
router.post('/logo', verifyToken, upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const logoUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${req.file.filename}`;

    res.json({
      message: 'Logo uploaded successfully',
      logo_url: logoUrl,
      filename: req.file.filename
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
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
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const path = `/uploads/${req.file.filename}`;
  const host = `${req.protocol}://${req.get('host')}`;
  const url = `${host}${path}`;
  res.status(201).json({ path, url, filename: req.file.filename, size: req.file.size });
});

router.use((err, _req, res, _next) => {
  if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
});
// Upload academy logo
router.post('/logo', verifyToken, upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Build the URL to access the file
    const logoUrl = `${req.protocol}://${req.get('host')}/uploads/logos/${req.file.filename}`;

    res.json({
      message: 'Logo uploaded successfully',
      logo_url: logoUrl,
      filename: req.file.filename
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});
module.exports = router;
