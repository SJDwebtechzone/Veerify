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
    ] = await Promise.all([
      // Total distinct students enrolled in any active batch of this institution
      pool.query(
        `SELECT COUNT(DISTINCT e.student_id)::int AS n
         FROM enrollments e
         JOIN batches b ON e.batch_id = b.id
         WHERE b.institution_id = $1`,
        [institutionId],
      ),

      // Active trainers
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM trainers
         WHERE institution_id = $1`,
        [institutionId],
      ),

      // Batches scheduled today (matching the day abbreviation, case-insensitive)
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM batches
         WHERE institution_id = $1
           AND days_of_week IS NOT NULL
           AND LOWER(days_of_week) LIKE '%' || $2 || '%'`,
        [institutionId, todayAbbr],
      ),

      // Pending fees — sum + count of pending enrollments. Prefer the
      // enrolment's explicit payment_amount when present; fall back to the
      // course's listed price for older rows where the student hasn't
      // initiated payment yet so we still have a useful estimate.
      pool.query(
        `SELECT
           COUNT(*)::int                                                       AS pending_count,
           COALESCE(SUM(COALESCE(e.payment_amount, c.price)), 0)::numeric     AS pending_total
         FROM enrollments e
         JOIN batches b ON e.batch_id = b.id
         JOIN courses c ON b.course_id = c.id
         WHERE b.institution_id = $1
           AND e.payment_status = 'pending'`,
        [institutionId],
      ),

      // Revenue this month — sum of the REAL paid amount on enrollments
      // whose payment landed in the current calendar month. We use
      // payment_amount (set when the student paid) rather than the
      // course's listed price, and COALESCE(paid_at, enrolled_at) so legacy
      // rows without a recorded paid_at still get attributed to the month
      // the enrolment happened. Without this, the dashboard never moves on
      // new payments — only on new enrolments.
      pool.query(
        `SELECT COALESCE(SUM(e.payment_amount), 0)::numeric AS total
         FROM enrollments e
         WHERE e.institution_id = $1
           AND e.payment_status = 'paid'
           AND COALESCE(e.paid_at, e.enrolled_at) >= date_trunc('month', NOW())`,
        [institutionId],
      ),

      // Attendance % this month — present / (present + absent + late). We
      // ignore 'leave' from the denominator since leave is excused.
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE status IN ('present','absent','late'))::int AS total
         FROM attendance
         WHERE institution_id = $1
           AND date >= date_trunc('month', NOW())`,
        [institutionId],
      ),

      // Monthly revenue series for the last 6 calendar months (oldest first).
      // Same fix as above — bucket by COALESCE(paid_at, enrolled_at) and sum
      // the real payment_amount so the chart reflects actual cash inflow,
      // not enrolment events times the listed price.
      pool.query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', NOW()) - INTERVAL '5 months',
             date_trunc('month', NOW()),
             INTERVAL '1 month'
           ) AS m
         )
         SELECT
           to_char(m.m, 'Mon')           AS label,
           m.m                           AS month_start,
           COALESCE(SUM(e.payment_amount), 0)::numeric AS total
         FROM months m
         LEFT JOIN enrollments e
           ON e.institution_id = $1
           AND e.payment_status = 'paid'
           AND COALESCE(e.paid_at, e.enrolled_at) >= m.m
           AND COALESCE(e.paid_at, e.enrolled_at) <  m.m + INTERVAL '1 month'
         GROUP BY m.m
         ORDER BY m.m`,
        [institutionId],
      ),

      // Unread notifications for this admin user
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM notifications
         WHERE user_id = $1
           AND read_at IS NULL`,
        [req.user.id],
      ),

      // Latest 5 enrollments — fuel for the Recent Activity feed
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
         WHERE b.institution_id = $1
         ORDER BY e.enrolled_at DESC
         LIMIT 5`,
        [institutionId],
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

    res.json({
      counts: {
        students:             studentsRes.rows[0]?.n || 0,
        trainers:             trainersRes.rows[0]?.n || 0,
        today_classes:        batchesRes.rows[0]?.n  || 0,
        pending_fees_count:   pendingCount,
        pending_fees_total:   pendingTotal,
        revenue_this_month:   revenueMonth,
        attendance_pct:       attendancePct,
        unread_notifications: unreadRes.rows[0]?.n  || 0,
      },
      monthly_revenue: monthlyRevenueRes.rows.map((r) => ({
        label: r.label,
        total: Number(r.total) || 0,
      })),
      recent_activity: activity,
    });
  } catch (err) {
    console.error('Admin dashboard stats error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
