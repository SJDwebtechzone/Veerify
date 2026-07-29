// backend/src/utils/planFeatureGuard.js
//
// Central gate for plan-scoped feature flags. Right now it covers the
// WhatsApp Notifications toggle from migration 073; extend the switch
// as more plan-level features land.
//
// Contract:
//   assertWhatsAppAllowed(userId) → { ok: true } when the caller's
//     institution is subscribed to a plan whose
//     whatsapp_notifications_enabled = TRUE; { ok: false, reason,
//     code: 'WHATSAPP_DISABLED' } otherwise. Never throws — every
//     WhatsApp sender should await this before opening a request to
//     the WhatsApp provider (Meta Cloud API / MSG91 / Twilio / etc.)
//     and short-circuit to the fallback channels (email + in-app)
//     when the gate refuses.
//
// A user with no institution (super admin) is treated as allowed —
// the assumption is that super-admin diagnostic sends go through the
// same helper and we don't want to block them.

const pool = require('../config/db');

async function readPlanFlag(userId, column) {
  // Walk to the ROOT institution before resolving the plan. A user
  // created under a sub-branch has u.institution_id = <branch>, but
  // subscription plans are attached to the ROOT (parent) institution
  // — the branch itself carries plan_id = NULL. Without this walk
  // every plan lookup for a sub-branch-scoped user would report
  // "Institution has no subscription plan" and silently disable
  // WhatsApp on real institutions that are fully paid.
  const r = await pool.query(
    `WITH me AS (
       SELECT u.id                              AS user_id,
              u.institution_id                  AS own_inst_id,
              i.name                            AS own_inst_name,
              i.parent_institution_id           AS parent_id,
              COALESCE(i.parent_institution_id, u.institution_id) AS root_inst_id
         FROM users u
         LEFT JOIN institutions i ON i.id = u.institution_id
        WHERE u.id = $1
        LIMIT 1
     )
     SELECT sp.${column}       AS flag,
            sp.name             AS plan_name,
            COALESCE(me.own_inst_name, ri.name) AS institution_name,
            me.own_inst_id      AS user_institution_id,
            me.root_inst_id     AS root_institution_id
       FROM me
       LEFT JOIN institutions ri        ON ri.id = me.root_inst_id
       LEFT JOIN subscription_plans sp  ON sp.id = ri.plan_id`,
    [userId],
  );
  return r.rows[0] || null;
}

async function assertWhatsAppAllowed(userId) {
  try {
    const row = await readPlanFlag(userId, 'whatsapp_notifications_enabled');
    console.log("=== WhatsApp Plan Check ===");
console.log("User ID:", userId);
console.log("DB Row:", row);
console.log("==========================");
    if (!row) {
      return {
        ok: false,
        code: 'WHATSAPP_DISABLED',
        reason: 'No user context.',
      };
    }
    // Super-admin / users without an institution or plan pass
    // through — they aren't the audience for the plan-scoped gate.
    if (!row.institution_name) return { ok: true, superAdmin: true };
    if (!row.plan_name) {
      return {
        ok: false,
        code: 'WHATSAPP_DISABLED',
        reason: 'Institution has no subscription plan.',
      };
    }
    if (!row.flag) {
      return {
        ok: false,
        code: 'WHATSAPP_DISABLED',
        reason: `WhatsApp notifications are not included in the ${row.plan_name} plan.`,
        plan_name: row.plan_name,
      };
    }
    return { ok: true, plan_name: row.plan_name };
  } catch (err) {
    // Fail closed on unexpected DB errors — a broken lookup should
    // never allow a WhatsApp send that the plan wouldn't authorise.
    console.warn('[planFeatureGuard] assertWhatsAppAllowed failed:', err?.message);
    return { ok: false, code: 'WHATSAPP_DISABLED', reason: 'Feature check failed.' };
  }
}

/**
 * Express middleware — refuses the request with 402 when the caller's
 * plan doesn't include WhatsApp. Mount ahead of the route handler for
 * any endpoint that dispatches to the WhatsApp provider.
 *
 *   router.post('/announcements/whatsapp',
 *     verifyToken,
 *     requireWhatsAppEnabled,
 *     announcementController.sendWhatsapp);
 */
async function requireWhatsAppEnabled(req, res, next) {
  const gate = await assertWhatsAppAllowed(req.user?.id);
  if (gate.ok) return next();
  return res.status(402).json({
    message: gate.reason || 'WhatsApp notifications are disabled for your plan.',
    code:    gate.code,
    plan_name: gate.plan_name || null,
  });
}

/**
 * Boolean-only helper for post-commit hooks (registration, admin-
 * creates-student, admin-creates-trainer) that already hold a user
 * row and just want a yes/no on whether WhatsApp is enabled for
 * that user's institution's plan. Never throws — falls to `false`
 * on any error so a broken lookup never accidentally dispatches
 * an unauthorised send.
 */
async function isWhatsAppEnabledForUser(userId) {
  const gate = await assertWhatsAppAllowed(userId);
  return !!gate.ok && !gate.superAdmin;
}

module.exports = {
  assertWhatsAppAllowed,
  requireWhatsAppEnabled,
  isWhatsAppEnabledForUser,
};
