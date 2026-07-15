// backend/src/utils/legalSectionSchemas.js
//
// Canonical section outline for every legal / policy slug. This is
// the single source of truth for "which sections does this document
// have, and in what order?" — both the admin editors (web + mobile)
// and the read-only consumer viewer default to these headings.
//
// The admin editor pre-seeds an empty section per entry when a fresh
// page is opened, so the outline is baked into the UX. The consumer
// viewer falls back to these titles when a saved section is missing
// its own title (older writes / manual DB edits).
//
// If you add a section here, existing rows continue to work unchanged
// — the editor merges saved sections with the schema on load, so any
// new entry is simply appended with empty content the next time an
// admin opens the page.

// ── Platform-wide (super-admin managed) ──────────────────────────
const PLATFORM_SECTIONS = {
  terms_and_conditions: [
    { key: 'introduction',       title: 'Introduction' },
    { key: 'user_accounts',      title: 'User Accounts' },
    { key: 'courses_training',   title: 'Courses & Training' },
    { key: 'certificates',       title: 'Certificates' },
    { key: 'payments',           title: 'Payments' },
    { key: 'acceptable_use',     title: 'Acceptable Use' },
    { key: 'account_suspension', title: 'Account Suspension' },
    { key: 'updates_to_terms',   title: 'Updates to Terms' },
  ],
  privacy_policy: [
    { key: 'information_collected', title: 'Information Collected' },
    { key: 'data_usage',            title: 'Data Usage' },
    { key: 'data_security',         title: 'Data Security' },
    { key: 'data_sharing',          title: 'Data Sharing' },
    { key: 'user_rights',           title: 'User Rights' },
  ],
  refund_and_cancellation_policy: [
    { key: 'subscription_refunds', title: 'Subscription Refunds' },
    { key: 'course_fee_refunds',   title: 'Course Fee Refunds' },
    { key: 'cancellation',         title: 'Cancellation' },
    { key: 'failed_payments',      title: 'Failed Payments' },
  ],
  child_safety_policy: [
    { key: 'safe_learning',      title: 'Safe Learning Environment' },
    { key: 'trainer_conduct',    title: 'Trainer Conduct' },
    { key: 'parent_consent',     title: 'Parent/Guardian Consent' },
    { key: 'reporting_concerns', title: 'Reporting Concerns' },
  ],
  contact_and_support: [
    { key: 'support_email',  title: 'Support Email' },
    { key: 'website',        title: 'Website' },
    { key: 'support_hours',  title: 'Support Hours' },
  ],
};

// ── Institution-scoped (per-academy managed) ─────────────────────
const INSTITUTION_SECTIONS = {
  about_academy: [
    { key: 'academy_name',     title: 'Academy Name' },
    { key: 'established_year', title: 'Established Year' },
    { key: 'about',            title: 'About' },
    { key: 'head_instructor',  title: 'Head Instructor' },
    { key: 'affiliation',      title: 'Affiliation' },
    { key: 'contact_details',  title: 'Contact Details' },
  ],
  academy_rules: [
    { key: 'discipline',           title: 'Discipline' },
    { key: 'uniform',              title: 'Uniform' },
    { key: 'attendance',           title: 'Attendance' },
    { key: 'student_conduct',      title: 'Student Conduct' },
    { key: 'academy_regulations',  title: 'Academy Regulations' },
  ],
  attendance_policy: [
    { key: 'minimum_attendance',    title: 'Minimum Attendance' },
    { key: 'leave_rules',           title: 'Leave Rules' },
    { key: 'eligibility_belt_test', title: 'Eligibility for Belt Test' },
  ],
  belt_test_policy: [
    { key: 'eligibility',          title: 'Eligibility' },
    { key: 'trainer_assessment',   title: 'Trainer Assessment' },
    { key: 'institution_approval', title: 'Institution Approval' },
    { key: 'certificate_issuance', title: 'Certificate Issuance' },
  ],
};

// Given a slug, return its section outline as `[{ key, title }]`.
// Unknown slugs return an empty array (the editors then let admin
// save free-form content into the legacy `content` field).
function sectionsForSlug(slug) {
  return PLATFORM_SECTIONS[slug]
      || INSTITUTION_SECTIONS[slug]
      || [];
}

// Whitelist the section key + title lengths on write. Rejects unknown
// keys silently (drops them from the payload) so a stray client can't
// pollute the JSONB with arbitrary keys.
function sanitiseSections(slug, rawSections) {
  if (!Array.isArray(rawSections)) return [];
  const outline = sectionsForSlug(slug);
  const allowedKeys = new Set(outline.map((s) => s.key));
  return rawSections
    .filter((s) => s && typeof s === 'object' && allowedKeys.has(s.key))
    .map((s) => ({
      key:     String(s.key),
      title:   String(s.title || '').slice(0, 200)
                 || outline.find((o) => o.key === s.key)?.title
                 || s.key,
      // Content is HTML from the contentEditable editor — no size
      // limit for now; typical policies are well under 50 KB per section.
      content: String(s.content || ''),
    }));
}

module.exports = {
  PLATFORM_SECTIONS,
  INSTITUTION_SECTIONS,
  sectionsForSlug,
  sanitiseSections,
};
