const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
require('./src/config/db');

// One-line boot log for the WhatsApp verify token so we can tell at
// a glance whether .env is being loaded and the value is the right
// LENGTH — WITHOUT ever printing the token itself. Bracketed the
// last 2 chars so the operator can eyeball it against Meta's UI.
(function logWhatsAppVerifyTokenStatus() {
  const tok = process.env.WHATSAPP_VERIFY_TOKEN
    || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    || '';
  if (!tok) {
    console.log('[whatsapp][boot] verify token: MISSING (set WHATSAPP_VERIFY_TOKEN or WHATSAPP_WEBHOOK_VERIFY_TOKEN in .env)');
  } else {
    const hint = tok.length > 2 ? `••${tok.slice(-2)}` : '••';
    console.log(`[whatsapp][boot] verify token loaded — length=${tok.length}, tail=${hint}`);
  }
})();

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
// Super-admin approval queue for Intra-Level (cross-institution)
// mobile events. See src/controllers/intraEventApproval.controller.js.
const intraEventApprovalRoutes = require('./src/routes/intraEventApproval.routes');
// MODULE 1: Registration-form builder for events. Read + write
// endpoints under /api/events/:eventId/registration-form.
const eventRegistrationFormRoutes = require('./src/routes/eventRegistrationForm.routes');
// MODULE 2: Select-students-for-event flow (eligible list + duplicate probe).
const eventRegistrationRoutes = require('./src/routes/eventRegistration.routes');
// MODULE 4: Organizer registration management.
const eventRegistrationOrganizerRoutes = require('./src/routes/eventRegistrationOrganizer.routes');
const curriculumRoutes   = require('./src/routes/curriculum.routes');
const branchRoutes       = require('./src/routes/branch.routes');
const academyRoutes      = require('./src/routes/academy.routes');
const studentRoutes = require('./src/routes/student.routes');
const courseVideoRoutes = require('./src/routes/courseVideo.routes');
const marketplaceRoutes = require('./src/routes/marketplace.routes');
const whatsappWebhookRoutes =
  require('./src/routes/whatsappWebhook.routes');


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

  'https://veerifyapp.com',
  'https://www.veerifyapp.com',
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
app.use('/api/intra-events', intraEventApprovalRoutes);
// Registration-form builder mounts at /api so the routes match
// their canonical URLs (/api/events/:id/registration-form and
// /api/config/registration-form).
app.use('/api', eventRegistrationFormRoutes);
app.use('/api', eventRegistrationRoutes);
app.use('/api', eventRegistrationOrganizerRoutes);
// Student-facing "Are you interested to participate?" endpoints.
// Kept alongside the other event-scoped routes.
app.use('/api', require('./src/routes/eventInterest.routes'));
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
// Belt Promotion Approval workflow — trainer submits a request,
// institution admin reviews. Full flow in
// controllers/beltPromotionRequest.controller.js.
app.use('/api/belt-promotion-requests', require('./src/routes/beltPromotionRequest.routes'));
app.use('/api/academies', academyRoutes);
// Shared enumerations (skills, belt levels, ...) — canonical arrays
// exposed to every client so Web Admin filters / Academy Setup form /
// Student Enrollment form all render the same options. See
// src/config/enums.js for the source of truth.
app.get('/api/config/enums', (_req, res) => {
  const { SKILL_OPTIONS, BELT_OPTIONS } = require('./src/config/enums');
  res.json({ skills: SKILL_OPTIONS, belts: BELT_OPTIONS });
});
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

// ── Public certificate verification page ─────────────────────────
// The mobile certificate carries a "Verify Certificate" button that
// opens THIS URL (not the JSON API). The page is a single-file HTML
// bundle that reads the token from the path, calls the existing
// GET /api/certificates/verify/:token endpoint client-side, and
// renders a clean verifier view — no login required. Keeps the raw
// API URL out of end-user hands.
app.get('/certificates/verify/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'certificate-verify.html'));
});
app.use('/api', whatsappWebhookRoutes);
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

  // Post-expiry lifecycle: active → expired → inactive with a
  // 3-day grace window. Runs hourly. See services/
  // subscriptionExpiry.service.js for the state machine.
  try {
    const subscriptionExpiry = require('./src/services/subscriptionExpiry.service');
    subscriptionExpiry.start();
  } catch (err) {
    console.warn('[startup] subscriptionExpiry scheduler not started:', err?.message);
  }

  // Pre-expiry WhatsApp reminders — T-3 / T-2 / T-1 daily nudges to
  // the institution admin with plan + expiry + days-left + renewal
  // link. Dedup by (institution, subscription_end date, days_before)
  // so a renewal automatically starts a fresh cycle and no reminder
  // ever fires twice in the same day. WA failures are logged only —
  // subscription / payment processing is untouched. See
  // services/subscriptionExpiryReminder.service.js.
  try {
    const expiryReminder = require('./src/services/subscriptionExpiryReminder.service');
    expiryReminder.start();
  } catch (err) {
    console.warn('[startup] subscriptionExpiryReminder scheduler not started:', err?.message);
  }
});
