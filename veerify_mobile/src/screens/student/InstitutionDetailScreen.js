// src/screens/student/InstitutionDetailScreen.js
//
// DEPRECATED — this screen has been removed. Its content (branding
// banner, academy details card, active-course list) now renders inline
// on the Home tab (see HomeTabScreen.js). Tapping an academy from any
// list — nearby academies, All Academies, Category Academies — now
// selects the academy via useInstitution() and jumps to Home instead
// of pushing this screen.
//
// The file is kept only so any stray dynamic require() during the
// transition surfaces a clear error instead of a bundler resolution
// failure. Nothing in the app imports it.

throw new Error(
  '[InstitutionDetailScreen] This screen was removed. Academy details ' +
  'now render inline on the Home tab — call selectInstitution() and ' +
  'navigate to the Home tab instead.',
);
