// backend/src/utils/branchScope.js
//
// Central helper for scoping "student visibility" queries by branch.
//
// Business rule (see spec: "Institution & Branch Login → Student Visibility"):
//   • A student is visible only in the login of the branch whose batch
//     they're enrolled in.
//   • Main-institution admins should see ONLY students enrolled in batches
//     hosted at the main institution (batches with branch_id IS NULL).
//   • Sub-branch admins should see ONLY students enrolled in batches
//     hosted at their own branch (batches with branch_id = <their inst>).
//
// The rule is enforced by ANDing a small SQL fragment onto every list
// query that surfaces student-scoped data (Students, Batches, Attendance,
// Fees / Payments, Progress / Performance Reports, Belts / Certificates,
// Leave requests, etc.). The fragment operates on a `batches` row (or
// alias) so the caller just tells us which alias to constrain.
//
// Usage:
//
//   const { getBranchScope, batchBranchClause } = require('../utils/branchScope');
//
//   const scope = await getBranchScope(req.user.id);
//   const params = [scope.rootId];
//   let where = `e.institution_id = $1`;
//   const branchClause = batchBranchClause(scope, 'b', params);
//   if (branchClause) where += ` AND ${branchClause}`;
//
//   const result = await pool.query(
//     `SELECT ... FROM enrollments e JOIN batches b ON e.batch_id = b.id
//       WHERE ${where}`,
//     params,
//   );

const pool = require('../config/db');

// Resolves the caller's academy group + tells us whether they're a
// sub-branch admin. Returns null when the user isn't linked to any
// institution (defensive — controllers should 403 in that case).
async function getBranchScope(userId) {
  const u = await pool.query(
    `SELECT u.institution_id, i.parent_institution_id
       FROM users u
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = u.rows[0];
  if (!row?.institution_id) return null;
  return {
    // Root institution — top of the academy tree. Enrollment rows always
    // stamp this as their institution_id so every enrollment across the
    // whole tree can be found via one column.
    rootId: row.parent_institution_id || row.institution_id,
    // The caller's own institution row. Same as rootId for a main admin,
    // = the sub-branch's id for a sub-branch admin.
    callerInstId: row.institution_id,
    isSubBranchAdmin: !!row.parent_institution_id,
  };
}

// Returns a SQL fragment that constrains a `batches`-shaped row to the
// caller's branch. Pushes any needed parameter onto `params` and returns
// the placeholder-aware fragment.
//
// Alias is required so callers can compose against `b.branch_id`,
// `batches.branch_id`, or whatever the join uses.
//
// Returns null (no filter) when scope is falsy so the caller can just
// skip the AND.
function batchBranchClause(scope, alias, params) {
  if (!scope) return null;
  const col = `${alias}.branch_id`;
  if (scope.isSubBranchAdmin) {
    params.push(scope.callerInstId);
    return `${col} = $${params.length}`;
  }
  // Main-institution admin: only batches hosted at the main institution
  // (i.e. batch.branch_id IS NULL). Sub-branch batches are hidden.
  return `${col} IS NULL`;
}

// Convenience: same as batchBranchClause but returns just the alias-less
// column check, for callers that already have `branch_id` on their row.
// Rare — most joins carry the batch alias explicitly.
function branchColumnClause(scope, params) {
  return batchBranchClause(scope, 'b', params);
}

// Admin ⇄ student access check.
//
// Returns true when the caller (an institution admin) is allowed to see
// the student's records under the branch-visibility rule: the student
// must be enrolled in at least one batch that falls under the caller's
// branch scope (main-only for main admin, branch-only for sub-branch
// admin).
//
// Used by cross-cutting endpoints (belt journeys, certificates, progress
// details, per-student payment history, etc.) that don't naturally list
// students and therefore can't rely on the list-side branch filter.
async function adminCanSeeStudent(pool, scope, studentId) {
  if (!scope) return false;
  const params = [studentId, scope.rootId];
  let branchExtra;
  if (scope.isSubBranchAdmin) {
    params.push(scope.callerInstId);
    branchExtra = `AND b.branch_id = $${params.length}`;
  } else {
    branchExtra = `AND b.branch_id IS NULL`;
  }
  const r = await pool.query(
    `SELECT 1
       FROM enrollments e
       JOIN batches b ON b.id = e.batch_id
      WHERE e.student_id = $1
        AND (b.institution_id = $2
             OR b.institution_id IN (
               SELECT id FROM institutions
                WHERE parent_institution_id = $2
             ))
        ${branchExtra}
      LIMIT 1`,
    params,
  );
  return r.rows.length > 0;
}

module.exports = {
  getBranchScope,
  batchBranchClause,
  branchColumnClause,
  adminCanSeeStudent,
};
