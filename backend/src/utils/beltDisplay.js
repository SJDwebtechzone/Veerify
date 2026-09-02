// backend/src/utils/beltDisplay.js
//
// Server mirror of veerify_mobile/src/utils/beltDisplay.js. The
// certificate surface renders belt names WITHOUT the redundant
// " Belt" suffix ("Black", not "Black Belt"). To keep the backend
// snapshots aligned with what the UI shows — so verify pages,
// notifications, exports, and mobile all speak the same string —
// values are normalized at persist time as well as at display.
//
// The transformation is intentionally minimal:
//   • Only strips a trailing " Belt" (case-insensitive), never
//     mid-string. "Blue Belt" → "Blue"; "Belt buckle award" is
//     untouched.
//   • Collapses runs of whitespace so "White  Belt" also → "White".
//   • Passes through non-strings (null, undefined, numbers) as-is
//     so callers don't need type guards.
function stripBeltSuffix(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  return trimmed.replace(/\s+belt\b\.?,?\s*$/i, '').trim();
}

module.exports = { stripBeltSuffix };
