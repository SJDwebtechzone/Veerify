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

export default formatBatchTime;
