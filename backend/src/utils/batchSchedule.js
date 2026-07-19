// backend/src/utils/batchSchedule.js
//
// Shared helpers for interpreting a batch's `days_of_week` column.
// Storage format is the same across create / update / read:
//   • Comma- or space-separated 3-letter abbreviations, case-insensitive.
//   • "Mon,Wed,Fri" — canonical.
//   • "monday, wednesday" — also accepted (we strip to the 3-letter prefix).
//   • null / empty → treat as "unrestricted" (legacy batches that predate
//     the schedule field). Attendance can still be marked on any weekday
//     for these — refusing would break historical data.
//
// The percentage-of-attendance calc reads from the same helpers so the
// server + mobile can never disagree on which days are class days.

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Parse a raw `days_of_week` string into a Set of 3-letter lowercase
 * abbreviations. Returns null when the field is empty/null so callers
 * can treat that as "unrestricted".
 */
function parseScheduleDays(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const days = new Set();
  for (const p of parts) {
    const abbr = p.slice(0, 3);
    if (Object.prototype.hasOwnProperty.call(DAY_INDEX, abbr)) {
      days.add(abbr);
    }
  }
  return days.size > 0 ? days : null;
}

/**
 * True if the given ISO date (YYYY-MM-DD) is a scheduled class day for
 * a batch with the given days_of_week string. Returns true for null /
 * empty schedules so legacy batches don't get locked out.
 */
function isScheduledClassDay(daysOfWeek, isoDate) {
  const days = parseScheduleDays(daysOfWeek);
  if (!days) return true; // legacy batch, no schedule declared
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const abbr = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
  return days.has(abbr);
}

/**
 * Count the number of scheduled class days between two ISO dates
 * (inclusive). Used for the "expected sessions" denominator in the
 * attendance-percentage calc. Both bounds are inclusive.
 */
function countScheduledDays(daysOfWeek, isoStart, isoEnd) {
  const days = parseScheduleDays(daysOfWeek);
  const start = new Date(isoStart);
  const end   = new Date(isoEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  if (!days) {
    // No declared schedule — count every calendar day. Same as before.
    return Math.floor((end - start) / 86_400_000) + 1;
  }
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const abbr = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
    if (days.has(abbr)) count += 1;
  }
  return count;
}

module.exports = {
  parseScheduleDays,
  isScheduledClassDay,
  countScheduledDays,
};
