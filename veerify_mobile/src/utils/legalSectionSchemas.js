// veerify_mobile/src/utils/legalSectionSchemas.js
//
// Mirror of backend/src/utils/legalSectionSchemas.js and the web
// admin's TS mirror. Keep all three files in sync when you add or
// rename a section.

export const PLATFORM_SECTIONS = {
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
    { key: 'support_email', title: 'Support Email' },
    { key: 'website',       title: 'Website' },
    { key: 'support_hours', title: 'Support Hours' },
  ],
};

export const INSTITUTION_SECTIONS = {
  about_academy: [
    { key: 'academy_name',     title: 'Academy Name' },
    { key: 'established_year', title: 'Established Year' },
    { key: 'about',            title: 'About' },
    { key: 'head_instructor',  title: 'Head Instructor' },
    { key: 'affiliation',      title: 'Affiliation' },
    { key: 'contact_details',  title: 'Contact Details' },
  ],
  academy_rules: [
    { key: 'discipline',          title: 'Discipline' },
    { key: 'uniform',             title: 'Uniform' },
    { key: 'attendance',          title: 'Attendance' },
    { key: 'student_conduct',     title: 'Student Conduct' },
    { key: 'academy_regulations', title: 'Academy Regulations' },
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

export function sectionsForSlug(slug) {
  return PLATFORM_SECTIONS[slug] || INSTITUTION_SECTIONS[slug] || [];
}

// Given the outline + a saved sections array (may be undefined),
// return a merged array preserving outline order. Unknown saved keys
// are dropped; missing outline keys get empty content.
export function mergeSectionsWithSchema(outline, saved) {
  const savedByKey = new Map((saved || []).map((s) => [s.key, s]));
  return outline.map((o) => {
    const existing = savedByKey.get(o.key);
    return {
      key:     o.key,
      title:   existing?.title || o.title,
      content: existing?.content || '',
    };
  });
}
