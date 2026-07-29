// backend/src/utils/registrationStatus.js
//
// Resume Registration / Enrollment — the single source of truth that
// decides whether an email or phone points to an *incomplete* record
// (in which case the client is invited to continue), a *completed*
// record (blocked with the usual "already exists" copy), or nothing
// at all (a clean new registration).
//
// A user is considered COMPLETED when users.registration_completed_at
// IS NOT NULL. The completion stamp is written at the terminal state
// per role (see auth / onboarding / enrollment / trainer controllers).
//
// Everything else — created but no plan yet, plan picked but not paid,
// paid but not activated, trainer without institution, student with no
// active enrollment — is treated as INCOMPLETE, and the previously
// captured fields (name, role, phone, institution assignment, etc.)
// come back as `resume.draft` so the client can prefill.

const pool = require('../config/db');
const { normaliseEmail, normalisePhone } = require('./contactValidation');

// Sticky flag — set the first time we hit a "column does not exist"
// error from Postgres (code 42703), meaning migration 077 hasn't been
// applied yet. Every helper in this file becomes a no-op afterwards so
// registration flows keep working on a stale schema; the moment the
// migration lands and the process restarts, this flag resets and the
// resume behaviour kicks in.
let schemaMissing = false;
function isMissingColumn(err) {
  return err?.code === '42703'
      || /column .* does not exist/i.test(err?.message || '');
}

// Human-friendly next-step hint per role. The mobile / web can turn
// this into a "Pick a plan" button vs. "Add profile details" copy
// without needing to duplicate the state-machine logic.
const NEXT_STEP = {
  admin:   'select_plan_and_pay',
  trainer: 'complete_trainer_profile',
  student: 'complete_enrollment_form',
  parent:  'complete_parent_profile',
};

/**
 * Look up an incomplete registration by email or phone (or both).
 * Rows that are soft-deleted are ignored — those are handled by the
 * existing partial unique index.
 *
 * Match strategy:
 *   • email match wins over phone match when both are supplied.
 *   • email match is case-insensitive.
 *   • phone match is exact against the normalised 10-digit form.
 *
 * Returns one of:
 *   { status: 'available' }
 *     — the email/phone are free; the caller can proceed with a
 *       fresh INSERT.
 *
 *   { status: 'incomplete', user, matchedOn, draft, nextStep }
 *     — an existing user was found and it hasn't finished registering
 *       yet. The `user` object is the raw users row; `draft` is a
 *       client-safe subset (no password, no secrets) the frontend can
 *       use to prefill the form. `matchedOn` is 'email' or 'phone'.
 *
 *   { status: 'completed', matchedOn }
 *     — a live, completed record already owns this email/phone. The
 *       caller must respond with the usual EMAIL_TAKEN / PHONE_TAKEN.
 *
 *   { status: 'error', error }
 *     — an internal failure surfaced by the DB layer.
 *
 * `roleHint` (optional) narrows the lookup so the resume prompt only
 * fires when the roles match ("continue this admin registration on an
 * enrolment form" would be confusing). When omitted, any role
 * matches.
 */
async function findResumableRegistration({ email, phone, role: roleHint } = {}) {
  // Fast-path when migration 077 hasn't been applied yet. The old
  // uniqueness semantics (partial index on live rows) still guard the
  // INSERT, so returning "available" here is safe — the DB layer will
  // still reject duplicates against a completed row via 23505.
  if (schemaMissing) return { status: 'available' };
  try {
    const cleanEmail = email ? normaliseEmail(email) : null;
    const cleanPhone = phone ? normalisePhone(phone) : null;
    if (!cleanEmail && !cleanPhone) return { status: 'available' };

    // Build the WHERE clause dynamically. We prefer email as the
    // matching key when both are supplied so a user re-using the
    // same email + a NEW phone can still resume. Phone-only lookup
    // is the fallback for flows that don't collect email upfront
    // (rare in this app but supported for future-proofing).
    const rows = await pool.query(
      `SELECT id, name, email, phone, role, institution_id,
              registration_completed_at,
              is_deleted, created_at
         FROM users
        WHERE COALESCE(is_deleted, FALSE) = FALSE
          AND (
            ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
            OR
            ($2::text IS NOT NULL AND phone = $2)
          )
        ORDER BY
          CASE WHEN $1::text IS NOT NULL AND LOWER(email) = LOWER($1) THEN 0 ELSE 1 END,
          created_at DESC
        LIMIT 1`,
      [cleanEmail, cleanPhone],
    );
    const user = rows.rows[0];
    if (!user) return { status: 'available' };

    // Role mismatch: a trainer email would never resume an admin
    // registration. When the caller narrowed the role, treat the
    // mismatch as a completed-under-different-role block instead of
    // resumable — the client will surface a clear "email in use
    // under a different account type" message.
    if (roleHint && user.role && user.role !== roleHint) {
      return {
        status:    'completed',
        matchedOn: cleanEmail && user.email && user.email.toLowerCase() === cleanEmail ? 'email' : 'phone',
        reason:    'role_mismatch',
        role:      user.role,
      };
    }

    if (user.registration_completed_at) {
      return {
        status:    'completed',
        matchedOn: cleanEmail && user.email && user.email.toLowerCase() === cleanEmail ? 'email' : 'phone',
        role:      user.role,
      };
    }

    return {
      status:    'incomplete',
      matchedOn: cleanEmail && user.email && user.email.toLowerCase() === cleanEmail ? 'email' : 'phone',
      nextStep:  NEXT_STEP[user.role] || 'complete_registration',
      user,
      draft: {
        // Client-safe subset — no password, no internal ids the app
        // doesn't need. `name` and `phone` are what the resume form
        // will typically prefill.
        name:            user.name || '',
        email:           user.email || '',
        phone:           user.phone || '',
        role:            user.role || null,
        institution_id:  user.institution_id || null,
        created_at:      user.created_at,
      },
    };
  } catch (err) {
    if (isMissingColumn(err)) {
      // Migration 077 has not been applied. Latch the flag so we
      // stop hitting the DB with a doomed query on every incoming
      // registration and log ONCE so the ops team knows what to do.
      if (!schemaMissing) {
        schemaMissing = true;
        console.warn(
          '[registrationStatus] disabled — migration 077_registration_resume.sql has not been applied. '
          + 'Run `npm run migrate -- src/db/migrations/077_registration_resume.sql` and restart the server.',
        );
      }
      return { status: 'available' };
    }
    // Emit and swallow so a broken lookup can never crash the
    // registration path — the caller falls back to the plain unique
    // check as if the resume feature wasn't available.
    console.warn('[registrationStatus] lookup failed:', err?.message);
    return { status: 'error', error: err?.message || 'lookup failed' };
  }
}

/**
 * Stamp registration_completed_at for a user id. Idempotent — a
 * completed row stays with its original timestamp. Callers hit this
 * at the terminal state of each flow:
 *
 *   • admin  — the payment webhook activates the institution.
 *   • student — the enrollment webhook confirms payment (or the
 *              offline path creates + activates in one go).
 *   • trainer — the createTrainer controller succeeds.
 */
async function markRegistrationComplete(userId) {
  if (!userId || schemaMissing) return;
  try {
    await pool.query(
      `UPDATE users
          SET registration_completed_at = COALESCE(registration_completed_at, NOW()),
              updated_at                = NOW()
        WHERE id = $1`,
      [userId],
    );
  } catch (err) {
    if (isMissingColumn(err)) {
      if (!schemaMissing) {
        schemaMissing = true;
        console.warn(
          '[registrationStatus] disabled — migration 077_registration_resume.sql has not been applied. '
          + 'Run `npm run migrate -- src/db/migrations/077_registration_resume.sql` and restart the server.',
        );
      }
      return;
    }
    console.warn(`[registrationStatus] mark complete failed user=${userId}:`, err?.message);
  }
}

/**
 * The 409 response every controller returns when an email/phone
 * collision points at an *incomplete* record. The client is expected
 * to detect `code === 'RESUME_AVAILABLE'` and offer a "Continue
 * previous registration?" dialog.
 */
function resumeAvailableResponse({ matchedOn, user, draft, nextStep }) {
  return {
    code:    'RESUME_AVAILABLE',
    field:   matchedOn,
    message: matchedOn === 'phone'
      ? 'An incomplete registration was found for this mobile number. Would you like to continue where you left off?'
      : 'An incomplete registration was found for this email. Would you like to continue where you left off?',
    resume: {
      user_id:   user.id,
      role:      user.role,
      next_step: nextStep,
      draft,
    },
  };
}

module.exports = {
  findResumableRegistration,
  markRegistrationComplete,
  resumeAvailableResponse,
  NEXT_STEP,
};
