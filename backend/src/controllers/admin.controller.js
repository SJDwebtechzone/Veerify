// backend/src/controllers/admin.controller.js
//
// Aggregations the institution admin dashboard needs, served in one
// round-trip so the mobile screen stays snappy.
//
// All queries are scoped to the calling admin's institution_id, which we
// resolve once from users.institution_id.

const pool = require('../config/db');

// Sun=0..Sat=6. Match what the batches table stores in days_of_week (we
// store it as plain comma-separated abbreviations like "Mon,Wed,Fri" or
// "Mon, Wed", so we lowercase + check for the 3-letter prefix).
const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function getAdminInstitutionId(userId) {
  const r = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

// GET /api/admin/dashboard
//
// Response shape:
// {
//   counts: {
//     students, trainers, today_classes, pending_fees_count, unread_notifications,
//     attendance_pct, pending_fees_total, revenue_this_month
//   },
//   monthly_revenue: [{ month: 'Dec', total: 42000 }, ...],   // last 6 months, oldest first
//   recent_activity: [{ kind, title, meta, at }, ...]         // newest first, max 8
// }
exports.getDashboardStats = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) {
      return res.status(400).json({ message: 'No institution linked to your account' });
    }

    // Resolve whether the caller is a sub-branch admin so the mobile
    // dashboard can hide quick actions that only belong at the main
    // institution (Add Course, Create Batch, Trainer Approvals,
    // Refer & Earn). Cheap single-row lookup.
    const parentRes = await pool.query(
      'SELECT parent_institution_id FROM institutions WHERE id = $1',
      [institutionId],
    );
    const isSubBranch = !!parentRes.rows[0]?.parent_institution_id;
    const rootId      = parentRes.rows[0]?.parent_institution_id || institutionId;

    // Optional ?branch_id override — Institution Home dashboard uses
    // this when the admin picks a specific branch from the header
    // dropdown. Semantics:
    //
    //   omitted            → default scope (main admin sees main,
    //                        sub-branch admin sees own branch).
    //   branch_id = 0      → force the "Main" scope (batches with
    //                        branch_id IS NULL under the root
    //                        institution). Used by the picker's
    //                        "Main Institution" option.
    //   branch_id = <n>    → filter to that specific sub-branch.
    //
    // Sub-branch admins CAN'T override at all — they only ever see
    // their own branch, and the mobile dropdown is hidden for them.
    // The main-institution admin is authorised to inspect any branch
    // under their root, so we validate the id belongs to the same
    // academy tree and refuse otherwise.
    const rawBranchOverride = req.query.branch_id;
    let branchOverride = null; // null=no override, 0=main, N=sub-branch id
    if (!isSubBranch && rawBranchOverride !== undefined) {
      const parsed = parseInt(rawBranchOverride, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        if (parsed === 0) {
          branchOverride = 0;
        } else {
          // Must belong to the caller's tree.
          const bRow = await pool.query(
            `SELECT id FROM institutions
              WHERE id = $1
                AND (id = $2 OR parent_institution_id = $2)
                AND deleted_at IS NULL`,
            [parsed, rootId],
          );
          if (bRow.rows.length === 0) {
            return res.status(403).json({ message: 'Branch not in your academy' });
          }
          branchOverride = parsed;
        }
      }
    }

    // Branch-scoped WHERE fragment for anything joining `batches b`.
    // Matches the same filter the Students / Payments / Batches tabs
    // use, so the dashboard's Total Students / Today's Classes /
    // Pending Fees / Revenue counts stay consistent with what the
    // admin sees when they drill into those tabs.
    //   • main admin (no override) → batches with branch_id IS NULL
    //   • sub-branch admin         → batches with branch_id = <their inst>
    //   • main admin + ?branch_id=0    → same as main scope
    //   • main admin + ?branch_id=N    → batches with branch_id = N
    // We also anchor to the caller's academy tree via batch.institution_id.
    let branchClause;
    if (branchOverride !== null) {
      branchClause = branchOverride === 0
        ? `b.branch_id IS NULL`
        : `b.branch_id = ${branchOverride}`;
    } else {
      branchClause = isSubBranch
        ? `b.branch_id = ${institutionId}`
        : `b.branch_id IS NULL`;
    }
    const treeClause = `(b.institution_id = ${rootId}
                         OR b.institution_id IN (
                           SELECT id FROM institutions WHERE parent_institution_id = ${rootId}
                         ))`;
    // Compose the two — used inside every batch-scoped query below.
    const batchScope = `${treeClause} AND ${branchClause}`;

    // Revenue-only scope. Differs from batchScope in one crucial way:
    // when a main-institution admin has NOT picked a specific branch
    // (branchOverride === null), the Monthly Revenue chart aggregates
    // the WHOLE academy (main + every sub-branch) instead of just the
    // main-institution batches. The other stat tiles use batchScope
    // (default-scope-per-branch); revenue is the one where main-admin
    // "default" means "whole academy total".
    //
    //   • branchOverride === null AND main admin  → treeClause only
    //                                               (main + branches)
    //   • branchOverride === 0                    → treeClause AND
    //                                               b.branch_id IS NULL
    //                                               (Main branch)
    //   • branchOverride > 0                      → treeClause AND
    //                                               b.branch_id = N
    //   • sub-branch admin                        → treeClause AND
    //                                               b.branch_id = <own>
    // The tree filter means a batch never appears twice; every
    // enrollment is joined via exactly one batch, and each batch has
    // exactly one branch_id (or NULL). No dedup pass needed.
    let revenueScope;
    if (branchOverride !== null) {
      revenueScope = `${treeClause} AND ${branchClause}`;
    } else if (isSubBranch) {
      revenueScope = `${treeClause} AND ${branchClause}`;
    } else {
      // Main admin default view — whole academy, main + all branches.
      revenueScope = treeClause;
    }

    // Same override applies to the institution-scoped attendance
    // query below so the "Attendance %" tile matches the other
    // tiles when a branch is picked.
    let attendanceInstitutionId = institutionId;
    if (branchOverride !== null && branchOverride > 0) {
      attendanceInstitutionId = branchOverride;
    } else if (branchOverride === 0) {
      attendanceInstitutionId = rootId;
    }

    const todayAbbr = DAY_ABBR[new Date().getDay()];

    // Single round-trip — fire every query in parallel.
    const [
      studentsRes,
      trainersRes,
      batchesRes,
      pendingFeesRes,
      revenueRes,
      attendanceRes,
      monthlyRevenueRes,
      unreadRes,
      recentEnrollRes,
      recentNotifRes,
      totalBatchesRes,
    ] = await Promise.all([
      // Total distinct students enrolled in any batch under the caller's
      // branch scope. Filters via batch.branch_id so the number matches
      // what the Students tab shows (both surfaces used to disagree —
      // dashboard used batch.institution_id, tab used batch.branch_id).
      // Soft-deleted students are excluded so a removed student doesn't
      // keep counting on the hero tile.
      pool.query(
        `SELECT COUNT(DISTINCT e.student_id)::int AS n
           FROM enrollments e
           JOIN batches b ON e.batch_id = b.id
           JOIN users u   ON u.id = e.student_id
          WHERE ${batchScope}
            AND COALESCE(u.is_deleted, false) = false`,
      ),

      // Active trainers — join users so we can filter out soft-deleted
      // trainers (they still have a row in `trainers` but their user
      // record is is_deleted = TRUE and their status = 'inactive').
      // Otherwise a trainer the admin has removed from the roster keeps
      // counting on the dashboard, which contradicts every other list.
      pool.query(
        `SELECT COUNT(*)::int AS n
           FROM trainers t
           JOIN users u ON u.id = t.user_id
          WHERE t.institution_id = $1
            AND COALESCE(u.is_deleted, false) = false
            AND COALESCE(u.status, 'active') <> 'inactive'`,
        [institutionId],
      ),

      // Batches scheduled today (matching the day abbreviation, case-insensitive).
      // Scoped to the caller's branch so the count matches the Batches tab.
      pool.query(
        `SELECT COUNT(*)::int AS n
           FROM batches b
          WHERE ${batchScope}
            AND b.days_of_week IS NOT NULL
            AND LOWER(b.days_of_week) LIKE '%' || $1 || '%'`,
        [todayAbbr],
      ),

      // Pending fees — sum + count of pending enrollments in the caller's
      // branch scope. Prefer the enrolment's explicit payment_amount when
      // present; fall back to the course's listed price for older rows.
      pool.query(
        `SELECT
           COUNT(*)::int                                                       AS pending_count,
           COALESCE(SUM(COALESCE(e.payment_amount, c.price)), 0)::numeric     AS pending_total
           FROM enrollments e
           JOIN batches b ON e.batch_id = b.id
           JOIN courses c ON b.course_id = c.id
          WHERE ${batchScope}
            AND e.payment_status = 'pending'`,
      ),

      // Revenue this month — sum of REAL paid amounts on enrollments
      // whose payment landed in the current calendar month. Scoped
      // to the caller's branch via the batch join so branch admins
      // only see their branch's revenue.
      //
      // MUST stay filter-for-filter identical to the Earnings tab's
      // "Collected this month" calc in PaymentsTabScreen.js#totals.
      // If the wording of either widget changes, update BOTH.
      //
      // Contract:
      //   • payment_status = 'paid'       — Razorpay-verified or offline recorded.
      //     Excludes pending / failed / refunded / cancelled implicitly.
      //   • paid_at (or enrolled_at fallback) in current calendar month.
      //   • Enrolments only — subscription plan payments, event fees,
      //     and other non-course channels live in different tables
      //     and never mix into this bucket.
      pool.query(
        `SELECT COALESCE(SUM(e.payment_amount), 0)::numeric AS total
           FROM enrollments e
           JOIN batches b ON b.id = e.batch_id
          WHERE ${batchScope}
            AND e.payment_status = 'paid'
            AND COALESCE(e.paid_at, e.enrolled_at) >= date_trunc('month', NOW())`,
      ),

      // Attendance % this month — present / (present + absent + late).
      // We ignore 'leave' from the denominator since leave is excused.
      // Uses `attendanceInstitutionId` so a picked branch reports its
      // own %, not the whole academy's.
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE status IN ('present','absent','late'))::int AS total
         FROM attendance
         WHERE institution_id = $1
           AND date >= date_trunc('month', NOW())`,
        [attendanceInstitutionId],
      ),

      // Monthly revenue series for the last 6 calendar months (oldest first).
      // Uses revenueScope (not batchScope): for a main admin's default
      // view this aggregates the entire academy (main + every sub-
      // branch). For a sub-branch admin, or when a specific branch is
      // picked via ?branch_id, it filters to that branch only.
      //
      // "Only successfully paid" is enforced by payment_status = 'paid' —
      // pending / failed / cancelled / refunded rows are excluded.
      // COUNT() surfaces the number of successful payments per month
      // so the Details screen can render "N payments" without a
      // second query.
      pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', NOW()) - INTERVAL '5 months',
             date_trunc('month', NOW()),
             INTERVAL '1 month'
           ) AS m
         )
         SELECT
           to_char(m.m, 'Mon')                         AS label,
           m.m                                         AS month_start,
           COALESCE(SUM(e.payment_amount), 0)::numeric AS total,
           COUNT(e.id)::int                            AS count
         FROM months m
         LEFT JOIN enrollments e
           ON e.payment_status = 'paid'
           AND COALESCE(e.paid_at, e.enrolled_at) >= m.m
           AND COALESCE(e.paid_at, e.enrolled_at) <  m.m + INTERVAL '1 month'
           AND EXISTS (
             SELECT 1 FROM batches b
              WHERE b.id = e.batch_id AND ${revenueScope}
           )
         GROUP BY m.m
         ORDER BY m.m`,
      ),

      // Unread notifications for this admin user
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM notifications
         WHERE user_id = $1
           AND read_at IS NULL`,
        [req.user.id],
      ),

      // Latest 5 enrollments — fuel for the Recent Activity feed. Scoped
      // to the caller's branch so the feed only shows enrolments the
      // admin actually handles.
      pool.query(
        `SELECT
           e.id, e.enrolled_at, e.payment_status,
           u.name  AS student_name,
           b.name  AS batch_name,
           c.name  AS course_name
           FROM enrollments e
           JOIN batches b ON e.batch_id = b.id
           JOIN courses c ON b.course_id = c.id
           JOIN users   u ON e.student_id = u.id
          WHERE ${batchScope}
          ORDER BY e.enrolled_at DESC
          LIMIT 5`,
      ),

      // Latest 5 notifications targeted at the admin user
      pool.query(
        `SELECT id, title, message, created_at, read_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [req.user.id],
      ),

      // Total batches under the caller's branch scope
      pool.query(
        `SELECT COUNT(*)::int AS n
           FROM batches b
          WHERE ${batchScope}`,
      ),
    ]);

    const presentCount = attendanceRes.rows[0]?.present || 0;
    const attendanceTotal = attendanceRes.rows[0]?.total || 0;
    const attendancePct = attendanceTotal > 0
      ? Math.round((presentCount / attendanceTotal) * 100)
      : null;

    const pendingTotal = Number(pendingFeesRes.rows[0]?.pending_total || 0);
    const pendingCount = pendingFeesRes.rows[0]?.pending_count || 0;
    const revenueMonth = Number(revenueRes.rows[0]?.total || 0);

    // Stitch enrollments + notifications into one chronologically-sorted
    // feed, take the top 8.
    const activity = [
      ...recentEnrollRes.rows.map((e) => ({
        kind: 'enrollment',
        title: `${e.student_name} joined ${e.batch_name}`,
        meta:  e.course_name,
        status: e.payment_status,
        at: e.enrolled_at,
      })),
      ...recentNotifRes.rows.map((n) => ({
        kind: 'notification',
        title: n.title,
        meta:  n.message,
        at: n.created_at,
        read: !!n.read_at,
      })),
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8);

    // Branch metadata for the Institution Home dropdown. We want to
    // tell the mobile:
    //   • plan_max_branches — how many branches the plan supports
    //     (>1 means the branch feature is enabled for this academy).
    //   • branch_count      — how many sub-branches actually exist
    //     under this root today.
    // The mobile hides the dropdown when either signal says "no
    // branches" so a solo academy sees the plain dashboard. Both are
    // cheap single-row lookups. Sub-branch admins never render the
    // picker so we skip the work for them.
    let planMaxBranches = 1;
    let branchCount = 0;
    if (!isSubBranch) {
      try {
        const capRes = await pool.query(
          `SELECT COALESCE(sp.max_branches, 1)::int AS max_branches
             FROM institutions i
             LEFT JOIN subscription_plans sp ON sp.id = i.plan_id
            WHERE i.id = $1`,
          [rootId],
        );
        planMaxBranches = capRes.rows[0]?.max_branches || 1;
        const cntRes = await pool.query(
          `SELECT COUNT(*)::int AS n
             FROM institutions
            WHERE parent_institution_id = $1
              AND deleted_at IS NULL`,
          [rootId],
        );
        branchCount = cntRes.rows[0]?.n || 0;
      } catch (err) {
        console.warn('[dashboard] branch capacity probe failed:', err?.message);
      }
    }

    res.json({
      counts: {
        students:             studentsRes.rows[0]?.n || 0,
        trainers:             trainersRes.rows[0]?.n || 0,
        today_classes:        batchesRes.rows[0]?.n  || 0,
        total_batches:        totalBatchesRes.rows[0]?.n || 0,
        pending_fees_count:   pendingCount,
        pending_fees_total:   pendingTotal,
        revenue_this_month:   revenueMonth,
        attendance_pct:       attendancePct,
        unread_notifications: unreadRes.rows[0]?.n  || 0,
      },
      is_sub_branch:    isSubBranch,
      // Branch-picker metadata. Mobile shows the dropdown iff
      // plan_max_branches > 1 AND branch_count > 0 AND the caller
      // is a main-institution admin.
      plan_max_branches: planMaxBranches,
      branch_count:      branchCount,
      branch_id:         branchOverride,   // echo of applied filter (0 or int, null if omitted)
      monthly_revenue: monthlyRevenueRes.rows.map((r) => ({
        label:       r.label,
        month_start: r.month_start,
        total:       Number(r.total) || 0,
        count:       Number(r.count) || 0,
      })),
      recent_activity: activity,
    });
  } catch (err) {
    console.error('Admin dashboard stats error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/admin/recent-activity
//   ?days=14         → look-back window in days. Default 14 (matches
//                      the mobile dashboard's initial view).
//   ?before=<iso>    → paging cursor. When set, we ignore `days` and
//                      return activities STRICTLY OLDER than that
//                      timestamp. Used by the "Load more" button.
//   ?limit=20        → page size. Default 20, cap 100.
//   ?branch_id=<id>  → same override as /dashboard so the Institution
//                      Home branch picker feeds through.
//
// Response:
//   {
//     activities: [{ kind, title, meta, at, status?, read? }, ...],
//     has_more:  boolean,    // true when the last row's timestamp
//                            // has older activities behind it
//     next_before: string|null   // ISO timestamp to pass back as
//                                // ?before on the next Load More
//   }
//
// Scope: reuses the same branch-scoped SQL as /dashboard so branch
// admins can only see their own branch's enrolments; main admins see
// the whole academy (or a picked branch via ?branch_id).
exports.getRecentActivity = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const parentRes = await pool.query(
      'SELECT parent_institution_id FROM institutions WHERE id = $1',
      [institutionId],
    );
    const isSubBranch = !!parentRes.rows[0]?.parent_institution_id;
    const rootId      = parentRes.rows[0]?.parent_institution_id || institutionId;

    // Same ?branch_id override semantics as /dashboard.
    const rawBranchOverride = req.query.branch_id;
    let branchOverride = null;
    if (!isSubBranch && rawBranchOverride !== undefined) {
      const parsed = parseInt(rawBranchOverride, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        if (parsed === 0) branchOverride = 0;
        else {
          const bRow = await pool.query(
            `SELECT id FROM institutions
              WHERE id = $1
                AND (id = $2 OR parent_institution_id = $2)
                AND deleted_at IS NULL`,
            [parsed, rootId],
          );
          if (bRow.rows.length === 0) {
            return res.status(403).json({ message: 'Branch not in your academy' });
          }
          branchOverride = parsed;
        }
      }
    }

    let branchClause;
    if (branchOverride !== null) {
      branchClause = branchOverride === 0
        ? `b.branch_id IS NULL`
        : `b.branch_id = ${branchOverride}`;
    } else {
      branchClause = isSubBranch
        ? `b.branch_id = ${institutionId}`
        : `b.branch_id IS NULL`;
    }
    const treeClause = `(b.institution_id = ${rootId}
                         OR b.institution_id IN (
                           SELECT id FROM institutions WHERE parent_institution_id = ${rootId}
                         ))`;
    const batchScope = `${treeClause} AND ${branchClause}`;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    // Parse the paging cursor. When set, we return rows STRICTLY
    // older than this timestamp — matching what "Load more" should
    // do. Invalid cursors fall back to the days-based window so the
    // client can't hard-error the endpoint by sending garbage.
    let cursor = null;
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) cursor = d.toISOString();
    }

    // Days look-back — used ONLY when there's no cursor. Default 14
    // matches the mobile's initial window. Clamp to sensible bounds.
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 365);

    // ── Fetch a candidate window from each stream ────────────────
    // We pull `limit` rows from each source (enrolments + this admin's
    // notifications), then interleave in JS to get the top `limit`
    // for the requested window. Pulling `limit` from each side is
    // enough because we always slice to `limit` after the merge.
    const bindWindow = cursor
      ? { clause: `AND ref.at < $1::timestamptz`, params: [cursor] }
      : { clause: `AND ref.at >= NOW() - INTERVAL '${days} days'`, params: [] };

    const [enrollRes, notifRes] = await Promise.all([
      pool.query(
        `SELECT * FROM (
           SELECT
             'enrollment'::text AS kind,
             u.name || ' joined ' || b.name AS title,
             c.name             AS meta,
             e.payment_status   AS status,
             NULL::timestamptz  AS read_at,
             e.enrolled_at      AS at
           FROM enrollments e
           JOIN batches b  ON e.batch_id = b.id
           JOIN courses c  ON b.course_id = c.id
           JOIN users   u  ON e.student_id = u.id
          WHERE ${batchScope}
         ) ref
         WHERE TRUE
           ${bindWindow.clause}
         ORDER BY ref.at DESC
         LIMIT ${limit}`,
        bindWindow.params,
      ),
      pool.query(
        `SELECT * FROM (
           SELECT
             'notification'::text AS kind,
             n.title              AS title,
             n.message            AS meta,
             NULL::text           AS status,
             n.read_at            AS read_at,
             n.created_at         AS at
           FROM notifications n
           WHERE n.user_id = $${bindWindow.params.length + 1}
         ) ref
         WHERE TRUE
           ${bindWindow.clause}
         ORDER BY ref.at DESC
         LIMIT ${limit}`,
        [...bindWindow.params, req.user.id],
      ),
    ]);

    // Interleave, sort descending by timestamp, slice to page size.
    const merged = [
      ...enrollRes.rows.map((r) => ({
        kind: r.kind,
        title: r.title,
        meta: r.meta,
        status: r.status,
        at: r.at,
      })),
      ...notifRes.rows.map((r) => ({
        kind: r.kind,
        title: r.title,
        meta: r.meta,
        read: !!r.read_at,
        at: r.at,
      })),
    ].sort((a, z) => new Date(z.at) - new Date(a.at));

    const page = merged.slice(0, limit);

    // has_more heuristic: either stream saturated to LIMIT, OR we
    // dropped rows off the end of the merged list. Both cases mean
    // there's more chronological content behind the last row we
    // returned. When empty, has_more is false so the mobile hides
    // the Load More button.
    let hasMore = merged.length > limit
      || enrollRes.rows.length >= limit
      || notifRes.rows.length >= limit;
    if (page.length === 0) hasMore = false;

    // Next cursor is the timestamp of the oldest row we returned —
    // the mobile passes it back as ?before= to fetch the next batch.
    const nextBefore = page.length ? new Date(page[page.length - 1].at).toISOString() : null;

    res.json({
      activities:  page,
      has_more:    hasMore,
      next_before: nextBefore,
      window_days: cursor ? null : days,
      branch_id:   branchOverride,
    });
  } catch (err) {
    console.error('Admin recent-activity error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/admin/revenue-details
//   ?months=6          → look-back window in whole calendar months.
//                        Default 6 (matches the dashboard chart).
//                        Cap at 60.
//   ?before=<iso>      → paging cursor. When set, returns the 6
//                        calendar months STRICTLY OLDER than this
//                        month_start (used by the mobile's Load
//                        More button). Overrides `months`.
//   ?branch_id=<id>    → same override semantics as /dashboard so a
//                        picked branch stays consistent.
//
// Response:
//   {
//     months:   [{ label, month_start, total, count }, ...],
//     payments: [
//       { id, amount, at, source, reference, status,
//         student_name, batch_name, course_name, branch_name }, ...
//     ],
//     has_more:    boolean,   // are there older months behind these?
//     next_before: string|null // ISO of the OLDEST returned month;
//                              // pass back as ?before= for the next
//                              // batch.
//     window_months: number
//   }
//
// Uses the same revenueScope as /dashboard so the chart's monthly
// totals and this screen's monthly totals CAN NEVER disagree. Every
// row is a payment_status = 'paid' enrollment; pending / failed /
// cancelled / refunded are excluded on both surfaces.
exports.getRevenueDetails = async (req, res) => {
  try {
    const institutionId = await getAdminInstitutionId(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const parentRes = await pool.query(
      'SELECT parent_institution_id FROM institutions WHERE id = $1',
      [institutionId],
    );
    const isSubBranch = !!parentRes.rows[0]?.parent_institution_id;
    const rootId      = parentRes.rows[0]?.parent_institution_id || institutionId;

    const rawBranchOverride = req.query.branch_id;
    let branchOverride = null;
    if (!isSubBranch && rawBranchOverride !== undefined) {
      const parsed = parseInt(rawBranchOverride, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        if (parsed === 0) branchOverride = 0;
        else {
          const bRow = await pool.query(
            `SELECT id FROM institutions
              WHERE id = $1
                AND (id = $2 OR parent_institution_id = $2)
                AND deleted_at IS NULL`,
            [parsed, rootId],
          );
          if (bRow.rows.length === 0) {
            return res.status(403).json({ message: 'Branch not in your academy' });
          }
          branchOverride = parsed;
        }
      }
    }

    let branchClause;
    if (branchOverride !== null) {
      branchClause = branchOverride === 0
        ? `b.branch_id IS NULL`
        : `b.branch_id = ${branchOverride}`;
    } else {
      branchClause = isSubBranch
        ? `b.branch_id = ${institutionId}`
        : `b.branch_id IS NULL`;
    }
    const treeClause = `(b.institution_id = ${rootId}
                         OR b.institution_id IN (
                           SELECT id FROM institutions WHERE parent_institution_id = ${rootId}
                         ))`;

    // Same rule as getDashboardStats — main admin default = whole
    // academy; branch admin / specific branch = filter to that branch.
    let revenueScope;
    if (branchOverride !== null || isSubBranch) {
      revenueScope = `${treeClause} AND ${branchClause}`;
    } else {
      revenueScope = treeClause;
    }

    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 60);

    // Resolve the anchor month. Cursor path: return the 6 months
    // STRICTLY OLDER than the given month_start (its ISO). Non-cursor
    // path: the last `months` calendar months ending on this month.
    let anchorParam = null;   // ISO of the "newest month" endpoint
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) {
        anchorParam = d.toISOString();
      }
    }

    // Build the months window in SQL. Anchor = date_trunc('month',
    // anchorParam) - 1 month (so cursor pages don't overlap). When
    // no cursor, anchor is the current month.
    const monthsResSql = anchorParam
      ? `
        WITH anchor AS (
          SELECT date_trunc('month', $1::timestamptz) - INTERVAL '1 month' AS end_m
        ),
        gen AS (
          SELECT generate_series(
                   (SELECT end_m FROM anchor) - INTERVAL '${months - 1} months',
                   (SELECT end_m FROM anchor),
                   INTERVAL '1 month'
                 ) AS m
        )
      `
      : `
        WITH gen AS (
          SELECT generate_series(
                   date_trunc('month', NOW()) - INTERVAL '${months - 1} months',
                   date_trunc('month', NOW()),
                   INTERVAL '1 month'
                 ) AS m
        )
      `;

    const monthsRes = await pool.query(
      `${monthsResSql}
       SELECT
         to_char(g.m, 'Mon YYYY')                     AS label,
         g.m                                          AS month_start,
         COALESCE(SUM(e.payment_amount), 0)::numeric  AS total,
         COUNT(e.id)::int                             AS count
       FROM gen g
       LEFT JOIN enrollments e
         ON e.payment_status = 'paid'
         AND COALESCE(e.paid_at, e.enrolled_at) >= g.m
         AND COALESCE(e.paid_at, e.enrolled_at) <  g.m + INTERVAL '1 month'
         AND EXISTS (
           SELECT 1 FROM batches b
            WHERE b.id = e.batch_id AND ${revenueScope}
         )
       GROUP BY g.m
       ORDER BY g.m DESC`,
      anchorParam ? [anchorParam] : [],
    );

    const monthRows = monthsRes.rows.map((r) => ({
      label:       r.label,
      month_start: r.month_start,
      total:       Number(r.total) || 0,
      count:       Number(r.count) || 0,
    }));

    // Payments listing for the same window. Only successful ('paid')
    // enrollments — matches the totals above. Every row surfaces:
    //   amount, timestamp, source (payment_mode || 'Online'),
    //   reference, student/batch/course/branch context.
    // Cap at 500 rows per window so a busy academy doesn't ship a
    // multi-MB payload; the mobile screen groups by month anyway.
    const oldestMonth = monthRows.length
      ? monthRows[monthRows.length - 1].month_start
      : null;
    const newestMonthEnd = monthRows.length
      ? new Date(new Date(monthRows[0].month_start).getTime() + 32 * 24 * 60 * 60 * 1000)
      : null;

    let payments = [];
    if (oldestMonth && newestMonthEnd) {
      // Boundaries are inclusive-oldest, exclusive-next-month-of-newest.
      const paymentsRes = await pool.query(
        `SELECT
           e.id,
           e.payment_amount                     AS amount,
           COALESCE(e.paid_at, e.enrolled_at)   AS at,
           COALESCE(NULLIF(e.payment_mode, ''), 'Online') AS source,
           e.payment_reference                  AS reference,
           e.payment_status                     AS status,
           u.name                               AS student_name,
           b.name                               AS batch_name,
           c.name                               AS course_name,
           br.name                              AS branch_name
         FROM enrollments e
         JOIN batches b     ON e.batch_id = b.id
         JOIN courses c     ON b.course_id = c.id
         JOIN users   u     ON e.student_id = u.id
         LEFT JOIN institutions br ON b.branch_id = br.id
         WHERE e.payment_status = 'paid'
           AND ${revenueScope}
           AND COALESCE(e.paid_at, e.enrolled_at) >= $1
           AND COALESCE(e.paid_at, e.enrolled_at) <  date_trunc('month', $2::timestamptz) + INTERVAL '1 month'
         ORDER BY COALESCE(e.paid_at, e.enrolled_at) DESC
         LIMIT 500`,
        [oldestMonth, newestMonthEnd.toISOString()],
      );
      payments = paymentsRes.rows.map((r) => ({
        id:           r.id,
        amount:       Number(r.amount) || 0,
        at:           r.at,
        source:       r.source,
        reference:    r.reference,
        status:       r.status,
        student_name: r.student_name,
        batch_name:   r.batch_name,
        course_name:  r.course_name,
        branch_name:  r.branch_name,
      }));
    }

    // has_more: are there any successful payments STRICTLY older than
    // the oldest month we returned? Cheap existence check — no need
    // to compute their totals.
    let hasMore = false;
    if (oldestMonth) {
      const olderRes = await pool.query(
        `SELECT 1
           FROM enrollments e
           JOIN batches b ON e.batch_id = b.id
          WHERE e.payment_status = 'paid'
            AND ${revenueScope}
            AND COALESCE(e.paid_at, e.enrolled_at) < $1
          LIMIT 1`,
        [oldestMonth],
      );
      hasMore = olderRes.rows.length > 0;
    }

    res.json({
      months:        monthRows,   // newest → oldest
      payments,                   // newest → oldest, capped 500
      has_more:      hasMore,
      next_before:   oldestMonth ? new Date(oldestMonth).toISOString() : null,
      window_months: months,
      branch_id:     branchOverride,
    });
  } catch (err) {
    console.error('Admin revenue-details error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
