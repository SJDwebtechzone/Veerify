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
const trainerLeaveRoutes = require('./src/routes/trainerLeave.routes');
const institutionPayoutRoutes = require('./src/routes/institutionPayout.routes');
const performanceReportRoutes = require('./src/routes/performanceReport.routes');
const referralRoutes = require('./src/routes/referral.routes');
const beltRoutes = require('./src/routes/belt.routes');
const certificateRoutes = require('./src/routes/certificate.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const salaryRoutes = require('./src/routes/salary.routes');
const adminRoutes = require('./src/routes/admin.routes');
const announcementRoutes = require('./src/routes/announcement.routes');
const curriculumRoutes   = require('./src/routes/curriculum.routes');
const branchRoutes       = require('./src/routes/branch.routes');
const academyRoutes      = require('./src/routes/academy.routes');
const studentRoutes = require('./src/routes/student.routes');
const courseVideoRoutes = require('./src/routes/courseVideo.routes');
const marketplaceRoutes = require('./src/routes/marketplace.routes');


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
  'http://localhost:5175',
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
app.use('/api/trainer-leave-requests', trainerLeaveRoutes);
app.use('/api/institution-payouts', institutionPayoutRoutes);
app.use('/api/performance-reports', performanceReportRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/belts', beltRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/salaries', salaryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/curriculum-progress', curriculumRoutes);
app.use('/api/branches', branchRoutes);
// Per-institution promotional banners shown on student / trainer
// dashboards. Admin CRUDs them under More → Branding → Banners.
app.use('/api/institution-banners', require('./src/routes/institutionBanner.routes'));
// Course completion → belt-test remarks → certificate dispatch workflow.
// Trainer records completion + remarks; institution admin dispatches the
// certificate from the Certificates queue.
app.use('/api/course-completions', require('./src/routes/courseCompletion.routes'));
// Certificate template CRUD + merge/preview. The templates are the
// canvas for the "Send Certificate" flow on the admin's Certificates screen.
app.use('/api/certificate-templates', require('./src/routes/certificateTemplate.routes'));
app.use('/api/academies', academyRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/course-videos', courseVideoRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/marketplace-settings', marketplaceRoutes);
// Feedback module — mobile submit + super-admin read.
app.use('/api/feedback', require('./src/routes/feedback.routes'));

// Dynamic FAQ module — super-admin CRUDs entries on the web panel,
// mobile app fetches them role-scoped via GET /api/faqs.
app.use('/api/faqs', require('./src/routes/faq.routes'));

// Legal / policy pages — platform-wide (super-admin) + per-institution
// (institution admin). Consumer reads at /me/platform + /me/institution
// are role-gated so students see only their four platform policies +
// Academy Rules, trainers see T&C / Privacy + Academy Rules / Belt Test.
app.use('/api/legal-pages', require('./src/routes/legalPage.routes'));

// Invoices — auto-generated after every successful Razorpay / offline
// payment. GET /:id/pdf streams the file behind a role + ownership
// check so guessed URLs can't leak someone else's invoice.
app.use('/api/invoices', require('./src/routes/invoice.routes'));

// MSG91 email diagnostics — dev-only. GET /api/dev/email-test?to=addr@x
// fires the "welcome" template at the supplied address and returns
// MSG91's raw response so you can prove the AUTHKEY + template id
// wiring is correct before the real flows depend on it. NEVER exposed
// in production so a stray link can't be abused to spam.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev/email-test', require('./src/routes/emailTest.routes'));
}

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  // Probe the SMTP transporter on startup so credential / TLS errors
  // surface immediately rather than only when a real send fails.
  try {
    const { verifyTransporter } = require('./src/utils/mailer');
    verifyTransporter();
  } catch (_) { /* mailer is optional */ }

  // Free Trial reminder scheduler — hourly scan for institutions whose
  // free trial ends within 3 days and hasn't been reminded yet. Sends
  // the payment link email exactly once per institution.
  try {
    const trialReminder = require('./src/services/trialReminder.service');
    trialReminder.start();
  } catch (err) {
    console.warn('[startup] trialReminder scheduler not started:', err?.message);
  }
});
