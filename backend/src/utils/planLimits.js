// backend/src/utils/planLimits.js
//
// Helpers for enforcing the institution's subscription-plan caps
// (max_students / max_trainers / max_branches) when an admin tries to add
// another row.
//
// Convention:
//   - Plan-row columns equal to >= 999 are treated as "unlimited" (the
//     admin web's Plans form uses 999 as the unlimited sentinel).
//   - When a cap is reached, the caller surfaces the standard
//     `PLAN_LIMIT_REACHED` payload below; the mobile catches it and shows
//     the Upgrade prompt.

const pool = require('../config/db');

// Returns { limit, current, plan_name, exceeded } for a given resource.
// kind: 'students' | 'trainers' | 'branches'
async function getUsage(institutionId, kind) {
  const planRow = await pool.query(
    `SELECT i.plan_id AS institution_plan_id,
            sp.id, sp.name, sp.max_students, sp.max_trainers, sp.max_branches
       FROM institutions i
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
      WHERE i.id = $1`,
    [institutionId],
  );
  let plan = planRow.rows[0] || {};

  // Defensive fallback: when the institution doesn't have a plan linked
  // yet (e.g. legacy row, mid-trial signup) we shouldn't silently treat
  // them as "unlimited" — that defeats the cap. Pin them to the cheapest
  // active plan so the basic caps apply until they actually upgrade.
  if (!plan.id) {
    const fallback = await pool.query(
      `SELECT id, name, max_students, max_trainers, max_branches
         FROM subscription_plans
        WHERE is_active = TRUE
        ORDER BY price ASC
        LIMIT 1`,
    );
    if (fallback.rows[0]) {
      plan = { ...fallback.rows[0], institution_plan_id: null };
      // eslint-disable-next-line no-console
      console.log(
        `[planLimits] institution=${institutionId} has no plan_id; falling back to "${plan.name}" caps`,
      );
    }
  }

  let limitCol;
  let currentSql;
  if (kind === 'trainers') {
    limitCol = plan.max_trainers;
    currentSql = `SELECT COUNT(*)::int AS c FROM trainers WHERE institution_id = $1`;
  } else if (kind === 'branches') {
    limitCol = plan.max_branches;
    // No branches table yet — return 1 (the institution itself).
    return {
      kind,
      limit: limitCol ?? null,
      current: 1,
      plan_name: plan.name || null,
      unlimited: !limitCol || limitCol >= 999,
      exceeded: false,
    };
  } else {
    // default 'students' — distinct paid + pending students enrolled.
    limitCol = plan.max_students;
    currentSql = `SELECT COUNT(DISTINCT student_id)::int AS c
                    FROM enrollments WHERE institution_id = $1`;
  }

  const limit = limitCol == null ? null : Number(limitCol);
  const unlimited = limit == null || limit >= 999;

  const currentRow = await pool.query(currentSql, [institutionId]);
  const current = Number(currentRow.rows[0]?.c || 0);

  return {
    kind,
    limit,
    current,
    plan_name: plan.name || null,
    unlimited,
    exceeded: !unlimited && current >= limit,
  };
}

// Throws a friendly error object when the institution has hit the cap.
// Use inside a controller like:
//   const limit = await ensureCapacity(instId, 'trainers');
//   if (limit) return res.status(402).json({ code: 'PLAN_LIMIT_REACHED', ...limit });
async function ensureCapacity(institutionId, kind) {
  const usage = await getUsage(institutionId, kind);
  if (usage.exceeded) return usage;
  return null;
}

// Build a standardized 402 response payload for the mobile to parse.
function limitResponse(kind, usage) {
  const label = kind === 'trainers' ? 'trainer' :
                kind === 'branches' ? 'branch' :
                'student';
  return {
    code:        'PLAN_LIMIT_REACHED',
    kind,
    limit:       usage.limit,
    current:     usage.current,
    plan_name:   usage.plan_name,
    message:     `Your ${usage.plan_name || 'current'} plan allows up to ${usage.limit} ${label}${usage.limit === 1 ? '' : 's'}. ` +
                 `You're at ${usage.current} now — upgrade to add more.`,
  };
}

module.exports = { getUsage, ensureCapacity, limitResponse };
