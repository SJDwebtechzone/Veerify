// backend/src/controllers/legalPage.controller.js
//
// Unified controller for platform-wide and institution-scoped policy
// pages. Schema in migration 059_legal_pages.sql.
//
// Endpoints (mounted under /api/legal-pages):
//
//   Super-admin (platform-wide docs):
//     GET    /platform            list every platform page (drafts + published)
//     POST   /platform            upsert a platform page by slug
//     DELETE /platform/:slug      remove a platform page
//
//   Institution admin (own institution only):
//     GET    /institution         list this institution's pages
//     POST   /institution         upsert
//     DELETE /institution/:slug   remove
//
//   Any signed-in user (role-scoped read):
//     GET /me/platform            published platform pages (all users)
//     GET /me/institution         published pages for the caller's institution
//
// Slug + role gates enforce the visibility matrix from the spec:
//   Student  → T&C, Privacy, Refund, Child Safety     (platform)
//              Academy Rules                          (institution)
//   Trainer  → T&C, Privacy                           (platform)
//              Academy Rules, Belt Test Policy        (institution)
//   Admin    → Contact & Support                      (platform)
//              About Academy, Academy Rules,
//              Attendance Policy, Belt Test Policy    (institution)
//
// Every write path stamps updated_by / updated_at so the audit line
// on the Legal admin screen has attribution without a separate log table.

const pool = require('../config/db');
const { sanitiseSections, sectionsForSlug } = require('../utils/legalSectionSchemas');

// ── Slug allow-lists ─────────────────────────────────────────────────
// Whitelisting slugs at the controller keeps a stray client from
// creating "hacked_terms" or overwriting an unrelated policy. The
// mobile / web pickers only expose these, but a server-side gate is
// belt-and-suspenders.
const PLATFORM_SLUGS = new Set([
  'terms_and_conditions',
  'privacy_policy',
  'refund_and_cancellation_policy',
  'child_safety_policy',
  'contact_and_support',
]);

const INSTITUTION_SLUGS = new Set([
  'about_academy',
  'academy_rules',
  'attendance_policy',
  'belt_test_policy',
]);

// Role → { platform: [slug], institution: [slug] } visibility matrix.
// A missing role reads nothing; a slug not in the array is filtered
// out even if the DB row exists + is published.
const READ_MATRIX = {
  student: {
    platform: [
      'terms_and_conditions',
      'privacy_policy',
      'refund_and_cancellation_policy',
      'child_safety_policy',
    ],
    institution: ['academy_rules'],
  },
  parent: {
    // Parents follow the student rules — they see the same policies
    // their child sees. Keeps the picker consistent across the mobile
    // student + parent tabs.
    platform: [
      'terms_and_conditions',
      'privacy_policy',
      'refund_and_cancellation_policy',
      'child_safety_policy',
    ],
    institution: ['academy_rules'],
  },
  trainer: {
    platform: ['terms_and_conditions', 'privacy_policy'],
    institution: ['academy_rules', 'belt_test_policy'],
  },
  admin: {
    // Institution admin sees everything the platform publishes so they
    // can point their staff at it, plus their own institution's
    // policies (they manage those anyway).
    platform: Array.from(PLATFORM_SLUGS),
    institution: Array.from(INSTITUTION_SLUGS),
  },
  super_admin: {
    platform: Array.from(PLATFORM_SLUGS),
    institution: Array.from(INSTITUTION_SLUGS),
  },
};

// ── Helpers ──────────────────────────────────────────────────────────
async function getAdminInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

function cleanTitle(t, fallback) {
  const s = String(t || '').trim().slice(0, 200);
  return s || fallback;
}

function cleanContent(c) {
  return String(c || '').trim();
}

// ─────────────────────────────────────────────────────────────────────
// PLATFORM (super-admin) endpoints
// ─────────────────────────────────────────────────────────────────────

// GET /api/legal-pages/platform
exports.listPlatform = async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, slug, title, content, sections, is_published,
              created_at, updated_at, updated_by
         FROM legal_pages
        WHERE scope = 'platform'
        ORDER BY slug`,
    );
    // Fill in missing slugs as unsaved drafts so the UI can render
    // every expected policy tile — the admin doesn't have to remember
    // which ones haven't been created yet.
    const bySlug = Object.fromEntries(r.rows.map((row) => [row.slug, row]));
    const pages = Array.from(PLATFORM_SLUGS).map((slug) => bySlug[slug] || {
      slug,
      title: null,
      content: '',
      sections: [],
      is_published: false,
      id: null,
    });
    res.json({ count: pages.length, pages });
  } catch (err) {
    console.error('[legalPage.listPlatform]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/legal-pages/platform
// Body: { slug, title, content, sections?, is_published? }
exports.upsertPlatform = async (req, res) => {
  try {
    const b = req.body || {};
    const slug = String(b.slug || '').trim();
    if (!PLATFORM_SLUGS.has(slug)) {
      return res.status(400).json({ message: 'Invalid platform slug' });
    }
    const title = cleanTitle(b.title, slug.replace(/_/g, ' '));
    // `content` is the legacy free-form blob (kept for back-compat);
    // `sections` is the new structured payload. Both are persisted so
    // an older reader gets something in the content field.
    const content = cleanContent(b.content);
    const sections = sanitiseSections(slug, b.sections);
    const publish = !!b.is_published;

    const r = await pool.query(
      `INSERT INTO legal_pages
         (scope, institution_id, slug, title, content, sections, is_published,
          created_by, updated_by)
       VALUES ('platform', NULL, $1, $2, $3, $4::jsonb, $5, $6, $6)
       ON CONFLICT (slug) WHERE scope = 'platform' DO UPDATE SET
         title        = EXCLUDED.title,
         content      = EXCLUDED.content,
         sections     = EXCLUDED.sections,
         is_published = EXCLUDED.is_published,
         updated_by   = EXCLUDED.updated_by,
         updated_at   = NOW()
       RETURNING *`,
      [slug, title, content, JSON.stringify(sections), publish, req.user.id],
    );
    res.json({ page: r.rows[0] });
  } catch (err) {
    console.error('[legalPage.upsertPlatform]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/legal-pages/platform/:slug
exports.deletePlatform = async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!PLATFORM_SLUGS.has(slug)) {
      return res.status(400).json({ message: 'Invalid platform slug' });
    }
    const r = await pool.query(
      `DELETE FROM legal_pages
        WHERE scope = 'platform' AND slug = $1
        RETURNING id`,
      [slug],
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[legalPage.deletePlatform]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// INSTITUTION admin endpoints
// ─────────────────────────────────────────────────────────────────────

// GET /api/legal-pages/institution
exports.listInstitution = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const r = await pool.query(
      `SELECT id, slug, title, content, sections, is_published,
              created_at, updated_at, updated_by
         FROM legal_pages
        WHERE scope = 'institution'
          AND institution_id = $1
        ORDER BY slug`,
      [institutionId],
    );
    const bySlug = Object.fromEntries(r.rows.map((row) => [row.slug, row]));
    const pages = Array.from(INSTITUTION_SLUGS).map((slug) => bySlug[slug] || {
      slug,
      title: null,
      content: '',
      sections: [],
      is_published: false,
      id: null,
    });
    res.json({ count: pages.length, pages });
  } catch (err) {
    console.error('[legalPage.listInstitution]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/legal-pages/institution
// Body: { slug, title, content, sections?, is_published? }
exports.upsertInstitution = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const b = req.body || {};
    const slug = String(b.slug || '').trim();
    if (!INSTITUTION_SLUGS.has(slug)) {
      return res.status(400).json({ message: 'Invalid institution slug' });
    }
    const title = cleanTitle(b.title, slug.replace(/_/g, ' '));
    const content = cleanContent(b.content);
    const sections = sanitiseSections(slug, b.sections);
    const publish = !!b.is_published;

    const r = await pool.query(
      `INSERT INTO legal_pages
         (scope, institution_id, slug, title, content, sections, is_published,
          created_by, updated_by)
       VALUES ('institution', $1, $2, $3, $4, $5::jsonb, $6, $7, $7)
       ON CONFLICT (institution_id, slug) WHERE scope = 'institution' DO UPDATE SET
         title        = EXCLUDED.title,
         content      = EXCLUDED.content,
         sections     = EXCLUDED.sections,
         is_published = EXCLUDED.is_published,
         updated_by   = EXCLUDED.updated_by,
         updated_at   = NOW()
       RETURNING *`,
      [institutionId, slug, title, content, JSON.stringify(sections), publish, req.user.id],
    );
    res.json({ page: r.rows[0] });
  } catch (err) {
    console.error('[legalPage.upsertInstitution]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/legal-pages/institution/:slug
exports.deleteInstitution = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
    const slug = String(req.params.slug || '').trim();
    if (!INSTITUTION_SLUGS.has(slug)) {
      return res.status(400).json({ message: 'Invalid institution slug' });
    }
    const r = await pool.query(
      `DELETE FROM legal_pages
        WHERE scope = 'institution'
          AND institution_id = $1
          AND slug = $2
        RETURNING id`,
      [institutionId, slug],
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[legalPage.deleteInstitution]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────
// Consumer (student / trainer / admin) read endpoints
// ─────────────────────────────────────────────────────────────────────

// GET /api/legal-pages/me/platform
exports.listPublishedForMe = async (req, res) => {
  try {
    const role = req.user.role;
    const allowed = (READ_MATRIX[role] || {}).platform || [];
    if (allowed.length === 0) return res.json({ pages: [] });

    const r = await pool.query(
      `SELECT slug, title, content, sections, updated_at
         FROM legal_pages
        WHERE scope = 'platform'
          AND is_published = TRUE
          AND slug = ANY($1::varchar[])
        ORDER BY slug`,
      [allowed],
    );
    res.json({ pages: r.rows });
  } catch (err) {
    console.error('[legalPage.listPublishedForMe]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/legal-pages/me/institution
// Optional ?institution_id=N for students whose home isn't bound yet
// (guest browsing an academy pre-login). Trainers / admins always use
// the institution linked to their users row.
exports.listInstitutionForMe = async (req, res) => {
  try {
    const role = req.user.role;
    const allowed = (READ_MATRIX[role] || {}).institution || [];
    if (allowed.length === 0) return res.json({ pages: [] });

    let institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId && req.query.institution_id) {
      institutionId = parseInt(req.query.institution_id, 10) || null;
    }
    if (!institutionId) return res.json({ pages: [] });

    const r = await pool.query(
      `SELECT slug, title, content, sections, updated_at
         FROM legal_pages
        WHERE scope = 'institution'
          AND institution_id = $1
          AND is_published = TRUE
          AND slug = ANY($2::varchar[])
        ORDER BY slug`,
      [institutionId, allowed],
    );
    res.json({ pages: r.rows });
  } catch (err) {
    console.error('[legalPage.listInstitutionForMe]', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
