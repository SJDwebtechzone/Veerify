// backend/src/services/eventWhatsApp.service.js
//
// Scope-aware WhatsApp fan-out for newly-created events.
//
// Three scopes match the product spec:
//
//   • 'global'      — Web Admin creates a CMS event (mobile_events row
//                     with institution_id = NULL). Every student across
//                     every institution whose plan has WhatsApp
//                     notifications enabled receives the message.
//   • 'institution' — Institution admin creates an event at the main
//                     institution. Every student under that root
//                     institution AND every student in any of its
//                     sub-branches is notified (plan gate applies).
//   • 'branch'      — Branch admin's event has been approved by the
//                     parent. Only students of THAT specific branch
//                     are notified (plan gate lives on the parent).
//
// Contract:
//   notifyEventCreatedWA(event, { scope, institutionId? }) → Promise<void>
//     • Never throws. Every error is caught and logged so the caller's
//       DB commit stays intact.
//     • Dedup: (event_id, user_id) primary key in event_wa_dispatch.
//       ON CONFLICT DO NOTHING lets us re-run the fan-out safely.
//     • Plan gate: isWhatsAppEnabledForUser resolves the STUDENT's
//       institution (walks to root) and checks the plan flag.
//
// The message body is intentionally short and covers every field the
// spec asks for (title, date, time, venue, description).

const pool = require('../config/db');
const { sendTextMessage } = require('./whatsapp.service');
const { isWhatsAppEnabledForUser } = require('../utils/planFeatureGuard');

// Format an event_date string / Date into a friendly line the student
// can read at a glance. Uses en-IN date + en-US 12-hour time so the
// stamp matches every other date/time surface in the app.
function formatEventWhen(dateInput) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return String(dateInput);
  const datePart = d.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${datePart} at ${timePart}`;
}

function buildBody(event, { institutionName } = {}) {
  const lines = [];
  lines.push('📢 New event announced!');
  lines.push('');
  lines.push(`*${(event.title || 'Event').trim()}*`);
  if (institutionName) lines.push(institutionName);
  lines.push('');
  const when = formatEventWhen(event.event_date);
  if (when) lines.push(`📅 ${when}`);
  const venue = event.location ? String(event.location).trim() : '';
  if (venue) lines.push(`📍 ${venue}`);
  if (event.description) {
    const desc = String(event.description).trim();
    // WhatsApp text-mode messages have a generous limit but a long
    // description clutters the notification preview — cap at ~500 chars
    // so the important lines above stay visible on the lock screen.
    const clipped = desc.length > 500 ? `${desc.slice(0, 497)}…` : desc;
    lines.push('');
    lines.push(clipped);
  }
  lines.push('');
  lines.push('Open the Veerify app for full details.');
  return lines.join('\n');
}

// Resolve the audience for a given scope.
//
//   • global      — every active student across every institution.
//   • institution — the root institution + every one of its sub-
//                   branches (walk parent_institution_id).
//   • branch      — that branch's own students only.
//
// Uses phone as-is; the WhatsApp service handles country-code
// normalization. Filters out users without a phone up front.
async function resolveAudience({ scope, institutionId }) {
  let sql, params;
  if (scope === 'global') {
    sql = `
      SELECT u.id, u.name, u.phone
        FROM users u
       WHERE u.role = 'student'
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND u.deleted_at IS NULL
         AND u.phone IS NOT NULL
         AND u.phone <> ''
    `;
    params = [];
  } else if (scope === 'institution') {
    // Root + every sub-branch.
    sql = `
      SELECT u.id, u.name, u.phone
        FROM users u
       WHERE u.role = 'student'
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND u.deleted_at IS NULL
         AND u.phone IS NOT NULL
         AND u.phone <> ''
         AND u.institution_id IN (
           SELECT id FROM institutions
            WHERE id = $1
               OR parent_institution_id = $1
         )
    `;
    params = [institutionId];
  } else if (scope === 'branch') {
    // Only that branch's students.
    sql = `
      SELECT u.id, u.name, u.phone
        FROM users u
       WHERE u.role = 'student'
         AND COALESCE(u.is_active, TRUE) = TRUE
         AND u.deleted_at IS NULL
         AND u.phone IS NOT NULL
         AND u.phone <> ''
         AND u.institution_id = $1
    `;
    params = [institutionId];
  } else {
    return [];
  }
  try {
    const r = await pool.query(sql, params);
    return r.rows;
  } catch (err) {
    // Missing columns (deleted_at / is_active on very old schemas)
    // shouldn't nuke the fan-out — fall back to a permissive read.
    if (err && err.code === '42703') {
      const relaxed = scope === 'global'
        ? `SELECT id, name, phone FROM users
            WHERE role = 'student' AND phone IS NOT NULL AND phone <> ''`
        : scope === 'institution'
          ? `SELECT id, name, phone FROM users
              WHERE role = 'student' AND phone IS NOT NULL AND phone <> ''
                AND institution_id IN (
                  SELECT id FROM institutions
                   WHERE id = $1 OR parent_institution_id = $1
                )`
          : `SELECT id, name, phone FROM users
              WHERE role = 'student' AND phone IS NOT NULL AND phone <> ''
                AND institution_id = $1`;
      try {
        const r = await pool.query(relaxed, scope === 'global' ? [] : [institutionId]);
        return r.rows;
      } catch (_) { return []; }
    }
    console.warn('[eventWA] resolveAudience failed:', err?.message);
    return [];
  }
}

// Try to record (or reserve) a dispatch row. Returns true when the
// insert took (i.e. this is a fresh send) and false when a prior row
// already exists — the caller uses this to short-circuit the actual
// WhatsApp POST for a duplicate.
async function reserveDispatch(eventId, userId) {
  try {
    const r = await pool.query(
      `INSERT INTO event_wa_dispatch (event_id, user_id, status)
       VALUES ($1, $2, 'sent')
       ON CONFLICT (event_id, user_id) DO NOTHING
       RETURNING event_id`,
      [eventId, userId],
    );
    return r.rowCount > 0;
  } catch (err) {
    // Pre-086 schema — treat as "no dedup" so the send still runs.
    // Ops sees the missing-table warning once and can migrate.
    if (err && err.code === '42P01') {
      console.warn('[eventWA] event_wa_dispatch missing — run migration 086. Dedup disabled.');
      return true;
    }
    console.warn('[eventWA] reserveDispatch failed:', err?.message);
    return false;
  }
}

async function updateDispatchOutcome(eventId, userId, { status, messageId, reason }) {
  try {
    await pool.query(
      `UPDATE event_wa_dispatch
          SET status = $3,
              message_id = $4,
              reason = $5,
              sent_at = NOW()
        WHERE event_id = $1 AND user_id = $2`,
      [eventId, userId, status, messageId || null, reason || null],
    );
  } catch (_) { /* best-effort audit; never fail the fan-out */ }
}

/**
 * Fire-and-forget event WhatsApp fan-out. Never throws.
 *
 * @param {object} event – full event row (must include id, title,
 *                         event_date; optional description, location).
 * @param {object} opts
 *   • scope          – 'global' | 'institution' | 'branch'
 *   • institutionId  – required for 'institution' and 'branch'; ignored
 *                      for 'global'. For 'institution' this is the
 *                      ROOT institution id.
 *   • institutionName – optional; injected into the message header so
 *                       students see which academy sent it.
 */
async function notifyEventCreatedWA(event, opts = {}) {
  try {
    if (!event || !event.id) return;
    const scope = opts.scope;
    if (!['global', 'institution', 'branch'].includes(scope)) return;
    if ((scope === 'institution' || scope === 'branch') && !opts.institutionId) return;

    const audience = await resolveAudience({
      scope,
      institutionId: opts.institutionId,
    });
    if (audience.length === 0) return;

    const body = buildBody(event, { institutionName: opts.institutionName });

    // Sequential loop — small audiences (per branch / institution)
    // keep this cheap, and it avoids hammering the WhatsApp API with a
    // concurrent burst that would immediately hit rate limits.
    for (const student of audience) {
      try {
        // Plan gate — resolved per student so a mixed audience in
        // 'global' mode correctly skips students whose institution's
        // plan doesn't include WhatsApp.
        const enabled = await isWhatsAppEnabledForUser(student.id);
        if (!enabled) continue;

        // Dedup: reserve a row up front. If reservation fails because
        // one already exists, skip this student — they've been sent.
        const reserved = await reserveDispatch(event.id, student.id);
        if (!reserved) continue;

        const send = await sendTextMessage(student.phone, body);
        if (send.ok) {
          await updateDispatchOutcome(event.id, student.id, {
            status: 'sent',
            messageId: send.messageId || null,
          });
        } else {
          await updateDispatchOutcome(event.id, student.id, {
            status: 'failed',
            reason: send.error || 'send-failed',
          });
        }
      } catch (perStudentErr) {
        // Never let one bad row abort the fan-out.
        console.warn(
          '[eventWA] per-student send failed:',
          student.id, perStudentErr?.message,
        );
      }
    }
  } catch (err) {
    // Absolutely swallow — the caller has already committed the event
    // and must not receive a 500 because WhatsApp had a bad day.
    console.warn('[eventWA] notifyEventCreatedWA failed:', err?.message);
  }
}

module.exports = { notifyEventCreatedWA };
