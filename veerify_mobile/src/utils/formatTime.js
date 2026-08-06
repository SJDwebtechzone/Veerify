// src/utils/formatTime.js
//
// Shared time formatter for batch / course timings. The backend stores
// times as Postgres TIME (`HH:MM:SS`), which surfaces to the mobile as
// plain strings like "06:00:00" or "18:30:00". Rendering those raw is
// awkward for a consumer audience — this helper converts them to a
// friendly 12-hour clock label ("6:00 AM", "6:30 PM").
//
// Contract:
//   formatBatchTime("06:00:00")           → "6:00 AM"
//   formatBatchTime("12:00:00")           → "12:00 PM"
//   formatBatchTime("18:30")              → "6:30 PM"
//   formatBatchTime("00:15")              → "12:15 AM"
//   formatBatchTime(null / '' / bad)      → '' (never throws)
//
//   formatBatchTimeRange("06:00:00", "07:30:00")
//                                          → "6:00 AM – 7:30 AM"
//   formatBatchTimeRange("06:00:00", null) → "6:00 AM"
//   formatBatchTimeRange(null, null)       → ''
//
// The stored value in the DB never changes — this is a render-time
// convenience only. Keep the fallback silent so a malformed row can't
// crash a list.

function pad2(n) {
  const s = String(n);
  return s.length < 2 ? '0' + s : s;
}

/**
 * Convert a 24-hour "HH:MM" or "HH:MM:SS" string (or a Date-parseable
 * string) into a 12-hour "H:MM AM/PM" label. Anything unparseable
 * returns an empty string so the caller can render nothing rather
 * than a broken value.
 */
export function formatBatchTime(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();

  // Common case — a "HH:MM" or "HH:MM:SS" string straight from the
  // Postgres TIME column. We match strictly to avoid mis-parsing
  // things like "yesterday at 6".
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = pad2(parseInt(m[2], 10));
    if (!Number.isFinite(h) || h < 0 || h > 23) return '';
    const period = h >= 12 ? 'PM' : 'AM';
    // 0 → 12 AM, 12 → 12 PM, 13 → 1 PM, etc.
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${mm} ${period}`;
  }

  // Secondary: parseable as a full Date (e.g. "2026-07-23T18:30:00Z").
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  return '';
}

/**
 * Convenience for the very common "start – end" render. The dash is a
 * proper en-dash to match the existing UI. When either bound is
 * missing we return whatever we have (a single time, or ''); when
 * both are present we join them with " – ".
 */
export function formatBatchTimeRange(start, end) {
  const a = formatBatchTime(start);
  const b = formatBatchTime(end);
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
}

// ── Generic 12-hour helpers ─────────────────────────────────────
//
// Every place in the app that shows a time-of-day should go through
// one of the two helpers below so the format stays consistent:
//
//   formatTime12h("2026-08-05T14:30:00Z")     → "2:30 PM"
//   formatTime12h(new Date())                 → "9:07 AM"
//   formatTime12h("18:30:00")                 → "6:30 PM"
//   formatTime12h(null / bad)                 → ''
//
//   formatDateTime12h("2026-08-05T14:30:00Z") → "05 Aug 2026, 2:30 PM"
//   formatDateTime12h(new Date())             → "05 Aug 2026, 9:07 AM"
//
// Both are hour12: true regardless of the device locale — the spec
// mandates AM/PM everywhere in the app, so we never let the system's
// 24-hour preference leak through.

/**
 * 12-hour time-of-day. Accepts a Date, an ISO string, a Postgres
 * TIME string, or a raw HH:MM. Empty string on unparseable input so
 * a broken row can never crash a list.
 */
export function formatTime12h(input) {
  if (input == null || input === '') return '';

  // Date object.
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '';
    return input.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  // HH:MM or HH:MM:SS — Postgres TIME column.
  const s = String(input).trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return formatBatchTime(s);

  // Fall through: parse as full Date.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }
  return '';
}

/**
 * Date + 12-hour time in one line. Used across list rows, activity
 * feeds, notification cards, payment history, etc.
 */
export function formatDateTime12h(input, opts = {}) {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const dateOpts = opts.longMonth
    ? { day: '2-digit', month: 'long',  year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  const datePart = d.toLocaleDateString('en-IN', dateOpts);
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

export default formatBatchTime;
