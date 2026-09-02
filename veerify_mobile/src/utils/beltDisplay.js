// veerify_mobile/src/utils/beltDisplay.js
//
// Display-only normalization for belt names on the certificate
// surface (template editor, live preview, dispatched certificate
// renderer). Backend payloads may arrive as "Black Belt" / "White
// Belt" — the UI shows just the colour word ("Black", "White").
//
// This function is intentionally DISPLAY ONLY. It never touches the
// stored value, the placeholder key, promotion logic, or anything
// persisted on the certificate row. Callers pass a value in and get
// a trimmed string back for rendering.
//
// Rules:
//   • Strip a trailing " Belt" / " belt" (case-insensitive), but only
//     when it's a suffix — never mid-string.
//   • Collapse extra whitespace so "White  Belt" also becomes "White".
//   • Preserve numeric / roman suffixes ("Blue I", "Brown III") —
//     those aren't the word "Belt", so they pass through untouched.
//   • Passthrough for anything that isn't a plain string (null,
//     undefined, numbers, objects).
export function stripBeltSuffix(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  // Match trailing " Belt" (case-insensitive) with optional trailing
  // punctuation like "Black Belt." or "Blue Belt,".
  return trimmed.replace(/\s+belt\b\.?,?\s*$/i, '').trim();
}

// Convenience alias — reads better at call sites that want to be
// explicit about intent ("format this belt name for the UI").
export const formatBeltName = stripBeltSuffix;

export default stripBeltSuffix;
