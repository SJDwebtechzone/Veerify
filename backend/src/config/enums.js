// backend/src/config/enums.js
//
// Canonical enumerations exposed to every client (Web Admin, mobile
// admin app, mobile student app) via GET /config/enums so all three
// surfaces render the same dropdowns.
//
// Sources of truth:
//   • SKILL_OPTIONS — mirrors the martial-arts list on the mobile
//     Academy Setup wizard (SetupInstitutionScreen.js #SKILL_OPTIONS).
//     Keep the two arrays byte-identical; any addition here MUST also
//     land in the mobile constant, and vice versa.
//   • BELT_OPTIONS — mirrors the belt ladder on the mobile Student
//     Enrollment form (EnrollmentFormScreen.js #BELT_OPTIONS). Same
//     rule — the two arrays MUST stay in lockstep.
//
// The mobile app currently keeps its own local copies because the
// bundle needs to work offline; the arrays here match those literals
// exactly so the Web Admin's Trainers filters can pull the canonical
// list from the API without a client-side hardcoded fallback.

const SKILL_OPTIONS = [
  'Karate',
  'Taekwondo',
  'Kung Fu',
  'Judo',
  'Boxing',
  'Muay Thai',
  'Brazilian Jiu-Jitsu (BJJ)',
  'MMA',
  'Yoga',
  'Silambam',
  'Kalaripayattu',
  'Adimurai',
  'Aikido',
  'Krav Maga',
  'Kickboxing',
  'Self Defense',
];

const BELT_OPTIONS = [
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue',
  'Blue I',
  'Blue II',
  'Gray',
  'Brown I',
  'Brown II',
  'Brown III',
  'Black',
  'Other',
];

module.exports = { SKILL_OPTIONS, BELT_OPTIONS };
