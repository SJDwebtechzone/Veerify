const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
require('./src/config/db');

const authRoutes = require('./src/routes/auth.routes');
const institutionRoutes = require('./src/routes/institution.routes');
const courseRoutes = require('./src/routes/course.routes');
const trainerRoutes = require('./src/routes/trainer.routes');
const batchRoutes = require('./src/routes/batch.routes');
const enrollmentRoutes = require('./src/routes/enrollment.routes');
const attendanceRoutes = require('./src/routes/attendance.routes');
const parentRoutes = require('./src/routes/parent.routes');
const cmsRoutes = require('./src/routes/cms.routes');
const uploadRoutes = require('./src/routes/upload.routes');
const planRoutes = require('./src/routes/plan.routes');
const onboardingRoutes = require('./src/routes/onboarding.routes');
const paymentsRoutes = require('./src/routes/payments.routes');
const leaveRoutes = require('./src/routes/leave.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const salaryRoutes = require('./src/routes/salary.routes');
const adminRoutes = require('./src/routes/admin.routes');


const app = express();
// CORS allowlist.
//
// Dev origins are always allowed so `npm run dev` on the admin web keeps
// working. Production origins should be set via the CORS_ORIGINS env var on
// the VPS (comma-separated). When the admin web is hosted, add its URL
// there (e.g. CORS_ORIGINS="http://72.61.245.163:5173,https://admin.veerify.com").
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:4173',
];
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...DEFAULT_ORIGINS, ...extraOrigins];

app.use(cors({
  origin: (origin, cb) => {
    // No origin = mobile apps / curl / server-to-server calls — always allow.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));// Bumped to 12MB so legacy data-URL payloads (if any) also work.
// Capture the raw request body on req.rawBody. The Razorpay webhook needs the
// exact bytes to verify the HMAC signature; if we let express.json() reshape
// them first, verification fails.
app.use(express.json({
  limit: '12mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Static-serve uploaded images: /uploads/<filename>
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Veerify backend is running', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/courses', courseRoutes);
// Soft rename for the student-facing UI — same data, friendlier URL.
// We'll do the full DB/file rename in a later cleanup pass.
app.use('/api/programs', courseRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/leave-requests', leaveRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/salaries', salaryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
