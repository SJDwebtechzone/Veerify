// src/utils/batchOccurrence.js
//
// Given a batch (recurring class) with a weekly schedule stored as
// `days_of_week` + `start_time` + `end_time` — or the newer per-day
// JSONB `schedule` map — compute:
//
//   • nextOccurrence(batch, from) → { start, end, isOngoing } | null
//     The soonest future or currently-active session, in the device's
//     local timezone. Returns null when the batch has no schedule at
//     all so callers can filter it out cleanly.
//
//   • partitionBatches(batches, from)
//     Split a list into { ongoing, upcoming } arrays where "ongoing"
//     is batches with a session currently in progress (now between
//     start and end) and "upcoming" is batches whose next session is
//     strictly in the future. Both arrays are sorted so the closest
//     session bubbles to the top.
//
// The spec says compare using the user's local timezone — that's the
// default JS Date behavior since we build every date using local
// getters (getDay/getFullYear/getMonth/getDate) rather than any UTC
// helper. Time strings are the Postgres TIME format "HH:MM" or
// "HH:MM:SS" as they arrive on the wire.

// Short day tokens — matches the DB convention (days_of_week is
// stored as "Mon,Wed,Fri" or similar). Sunday sits at index 0 to
// match JS Date#getDay().
const DAY_TOKENS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Small tolerant parser — turns "6:00", "06:00", "18:30:00" into
// [hours, minutes]. Returns null when the input is unusable.
function parseTime(input) {
  if (input == null || input === '') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(input).trim());
  if (!m) return null;
  const h  = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return [h, mm];
}

// Extract the days a batch runs on. Prefers the newer per-day JSONB
// map (each key is a day token like "Mon") and falls back to the
// comma-separated days_of_week field. Returns an array of short day
// tokens (e.g. ["Mon", "Wed"]).
function extractDays(batch) {
  const out = new Set();
  const csv = String(batch?.days_of_week || '').split(',');
  csv.forEach((raw) => {
    const s = raw.trim();
    if (!s) return;
    // Normalise "Monday" → "Mon" etc.
    const short = s.slice(0, 3);
    const cap = short.charAt(0).toUpperCase() + short.slice(1).toLowerCase();
    if (DAY_TOKENS.includes(cap)) out.add(cap);
  });
  if (batch?.schedule && typeof batch.schedule === 'object') {
    Object.keys(batch.schedule).forEach((k) => {
      const cap = k.slice(0, 3);
      const norm = cap.charAt(0).toUpperCase() + cap.slice(1).toLowerCase();
      if (DAY_TOKENS.includes(norm)) out.add(norm);
    });
  }
  return Array.from(out);
}

// Resolve the start/end TIME string for a given day. When the JSONB
// map has an entry for that day we use it; otherwise fall back to
// the legacy pair which applies to every listed day.
function timesForDay(batch, dayToken) {
  const map = (batch?.schedule && typeof batch.schedule === 'object') ? batch.schedule : null;
  const per = map?.[dayToken];
  const start = per?.start || batch?.start_time || '';
  const end   = per?.end   || batch?.end_time   || '';
  return { start, end };
}

/**
 * Compute the next occurrence of a recurring batch.
 *
 * @param {object} batch     – row with days_of_week / start_time / end_time
 * @param {Date}   [from]    – reference "now" (defaults to new Date())
 * @returns {{ start: Date, end: Date, isOngoing: boolean } | null}
 *
 * The search window is 8 days so if today's session hasn't fired yet
 * we pick today; otherwise we walk forward until we hit the next
 * scheduled day. Returns null when the batch has no valid schedule.
 */
export function nextOccurrence(batch, from = new Date()) {
  const days = extractDays(batch);
  if (days.length === 0) return null;

  const now = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(now.getTime())) return null;

  // Search up to 8 days forward (7 to cover the full week + 1 to
  // handle the "today already ended, roll to same weekday next week"
  // edge). This gives us at most 8 candidate days to score.
  let best = null;
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      0, 0, 0, 0,
    );
    const token = DAY_TOKENS[candidate.getDay()];
    if (!days.includes(token)) continue;

    const { start, end } = timesForDay(batch, token);
    const s = parseTime(start);
    if (!s) continue;
    const e = parseTime(end) || [s[0] + 1, s[1]]; // default 1-hour window

    const startAt = new Date(
      candidate.getFullYear(), candidate.getMonth(), candidate.getDate(),
      s[0], s[1], 0, 0,
    );
    const endAt = new Date(
      candidate.getFullYear(), candidate.getMonth(), candidate.getDate(),
      e[0], e[1], 0, 0,
    );
    // If today's session already ended, skip forward — we want the
    // next FUTURE (or currently-active) occurrence.
    if (endAt.getTime() <= now.getTime()) continue;

    const isOngoing = startAt.getTime() <= now.getTime() && now.getTime() < endAt.getTime();
    best = { start: startAt, end: endAt, isOngoing };
    break;
  }
  return best;
}

/**
 * Split a list of batches into ongoing (in progress right now) and
 * upcoming (next session in the future). Both arrays are sorted with
 * the soonest session first. Batches with no schedule are dropped.
 */
export function partitionBatches(batches, from = new Date()) {
  const ongoing = [];
  const upcoming = [];
  (batches || []).forEach((b) => {
    const occ = nextOccurrence(b, from);
    if (!occ) return;
    const row = { ...b, _next: occ };
    if (occ.isOngoing) ongoing.push(row);
    else upcoming.push(row);
  });
  const sortByStart = (a, z) => a._next.start.getTime() - z._next.start.getTime();
  ongoing.sort(sortByStart);
  upcoming.sort(sortByStart);
  return { ongoing, upcoming };
}

/**
 * Convenience helper — future-only list. When the caller doesn't care
 * about the ongoing/upcoming split (e.g. a plain "Upcoming Batches"
 * section) this gives you just the sorted upcoming array.
 */
export function upcomingBatches(batches, from = new Date()) {
  return partitionBatches(batches, from).upcoming;
}
