const pool = require('../config/db');
// Branch scope — used to enforce that a main-institution admin can't
// see (or mark) a sub-branch batch's attendance, and a sub-branch
// admin can only touch their own branch's.
const { getBranchScope } = require('../utils/branchScope');
// Schedule guard — refuses attendance marks on days the batch isn't
// scheduled to run. Same helper the mobile uses to build the date strip.
const { isScheduledClassDay } = require('../utils/batchSchedule');

// Fetch the batch's days_of_week once so both mark handlers can enforce
// the schedule. Returns null when the batch has no schedule declared —
// callers treat that as "unrestricted" per legacy contract.
async function getBatchScheduleDays(batchId) {
  const r = await pool.query(
    `SELECT days_of_week FROM batches WHERE id = $1`,
    [batchId],
  );
  return r.rows[0]?.days_of_week || null;
}

// Helper: verify the trainer owns this batch
const verifyTrainerOwnsBatch = async (userId, batchId) => {
  const result = await pool.query(
    `SELECT b.id
     FROM batches b
     JOIN trainers t ON b.trainer_id = t.id
     WHERE b.id = $1 AND t.user_id = $2`,
    [batchId, userId]
  );
  return result.rows.length > 0;
};

// Helper: verify the admin can touch this batch's attendance based
// on their branch scope. Returns { ok: true, scope } or { ok: false,
// status, message } for the caller to relay.
async function verifyAdminOwnsBatch(userId, batchId) {
  const batchRes = await pool.query(
    'SELECT institution_id, branch_id FROM batches WHERE id = $1',
    [batchId],
  );
  if (batchRes.rows.length === 0) {
    return { ok: false, status: 404, message: 'Batch not found' };
  }
  const batch = batchRes.rows[0];

  const scope = await getBranchScope(userId);
  if (!scope) return { ok: false, status: 403, message: 'No institution linked' };

  // Batch must belong to the caller's academy tree (root or any child).
  const treeRes = await pool.query(
    `SELECT 1 FROM institutions
      WHERE id = $1 AND (id = $2 OR parent_institution_id = $2) LIMIT 1`,
    [batch.institution_id, scope.rootId],
  );
  if (treeRes.rows.length === 0) {
    return { ok: false, status: 403, message: 'Not your batch' };
  }
  // Sub-branch admin: only their own branch's batches.
  if (scope.isSubBranchAdmin) {
    if (batch.branch_id !== scope.callerInstId) {
      return { ok: false, status: 403, message: 'This batch is not at your branch' };
    }
  } else if (batch.branch_id != null) {
    // Main admin trying to touch a sub-branch batch's attendance.
    return { ok: false, status: 403, message: 'This batch belongs to a sub-branch' };
  }
  return { ok: true, scope, batch };
}

// Core UPSERT with audit — used by both single + bulk mark endpoints.
// Ensures we always know whether the write was a 'create' or an
// 'update' so the audit trail is accurate.
async function upsertWithAudit(client, {
  student_id, batch_id, institution_id, date, status, actorId, actorRole,
}) {
  // Check for existing row first so we can log create vs update
  // deterministically and grab the previous status.
  const existing = await client.query(
    `SELECT id, status
       FROM attendance
      WHERE student_id = $1 AND batch_id = $2 AND date = $3`,
    [student_id, batch_id, date],
  );

  let attendanceRow;
  let action;
  let previousStatus = null;

  if (existing.rows.length === 0) {
    action = 'create';
    const insertRes = await client.query(
      `INSERT INTO attendance
         (student_id, batch_id, institution_id, date, status,
          marked_by, created_by, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6, CURRENT_TIMESTAMP)
       RETURNING *`,
      [student_id, batch_id, institution_id, date, status, actorId],
    );
    attendanceRow = insertRes.rows[0];
  } else {
    action = 'update';
    previousStatus = existing.rows[0].status;
    const updateRes = await client.query(
      `UPDATE attendance
          SET status     = $2,
              updated_by = $3,
              updated_at = CURRENT_TIMESTAMP,
              marked_by  = $3
        WHERE id = $1
        RETURNING *`,
      [existing.rows[0].id, status, actorId],
    );
    attendanceRow = updateRes.rows[0];
  }

  // Audit — one row per action. `actor_role` is snapshotted so the
  // history stays truthful if the actor's role changes later.
  await client.query(
    `INSERT INTO attendance_history
       (attendance_id, student_id, batch_id, date, action,
        previous_status, new_status, actor_id, actor_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      attendanceRow.id, student_id, batch_id, date, action,
      previousStatus, status, actorId, actorRole,
    ],
  );

  return { attendance: attendanceRow, action };
}

// Resolve the batch's institution_id + verify the caller (trainer OR
// admin) can mark attendance on it. Shared between the single + bulk
// endpoints. Returns { ok, institutionId } or { ok: false, status, message }.
async function verifyMarkAccess(role, userId, batchId) {
  if (role === 'trainer') {
    const owns = await verifyTrainerOwnsBatch(userId, batchId);
    if (!owns) return { ok: false, status: 403, message: 'You are not assigned to this batch' };
    // Fetch institution_id for the audit / storage.
    const bRes = await pool.query('SELECT institution_id FROM batches WHERE id = $1', [batchId]);
    if (bRes.rows.length === 0) return { ok: false, status: 404, message: 'Batch not found' };
    return { ok: true, institutionId: bRes.rows[0].institution_id };
  }
  if (role === 'admin') {
    const check = await verifyAdminOwnsBatch(userId, batchId);
    if (!check.ok) return check;
    return { ok: true, institutionId: check.batch.institution_id };
  }
  return { ok: false, status: 403, message: 'Access denied' };
}

// MARK attendance (single student) — trainers on their own batch, or
// admins (main / sub-branch) on batches under their branch scope.
exports.markAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: 'Request body is required with student_id, batch_id, and date' });
    }
    const { student_id, batch_id, date, status } = req.body;
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (!student_id || !batch_id || !date) {
      return res.status(400).json({ message: 'student_id, batch_id, and date are required' });
    }

    const access = await verifyMarkAccess(actorRole, actorId, batch_id);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    // Schedule gate — refuse marks on days the batch isn't scheduled
    // to run. Legacy batches with days_of_week=null are unrestricted.
    // Same guard applies to the bulk endpoint below.
    const scheduleDays = await getBatchScheduleDays(batch_id);
    if (!isScheduledClassDay(scheduleDays, date)) {
      return res.status(400).json({
        code: 'NOT_A_CLASS_DAY',
        message: `This batch does not run on ${date}. Schedule: ${scheduleDays || 'none set'}.`,
        schedule: scheduleDays,
      });
    }

    // Verify student is enrolled in this batch.
    const enrollCheck = await pool.query(
      'SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2',
      [student_id, batch_id]
    );
    if (enrollCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Student is not enrolled in this batch' });
    }

    await client.query('BEGIN');
    const { attendance, action } = await upsertWithAudit(client, {
      student_id,
      batch_id,
      institution_id: access.institutionId,
      date,
      status: status || 'present',
      actorId,
      actorRole,
    });
    await client.query('COMMIT');

    res.status(action === 'create' ? 201 : 200).json({
      message: action === 'create' ? 'Attendance marked' : 'Attendance updated',
      action,
      attendance,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Mark attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// BULK mark attendance — records = [{ student_id, status }, ...]
exports.markBulkAttendance = async (req, res) => {
  const client = await pool.connect();
  try {
    const { batch_id, date, records } = req.body;
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (!batch_id || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: 'batch_id, date, and records array are required' });
    }

    const access = await verifyMarkAccess(actorRole, actorId, batch_id);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    // Schedule gate — same as the single-mark endpoint. Refuses the
    // entire bulk write when the date isn't a scheduled class day for
    // this batch so a stale mobile calendar can't silently create
    // rows for a day the batch doesn't meet.
    const scheduleDays = await getBatchScheduleDays(batch_id);
    if (!isScheduledClassDay(scheduleDays, date)) {
      return res.status(400).json({
        code: 'NOT_A_CLASS_DAY',
        message: `This batch does not run on ${date}. Schedule: ${scheduleDays || 'none set'}.`,
        schedule: scheduleDays,
      });
    }

    await client.query('BEGIN');
    const results = [];
    for (const record of records) {
      const { attendance, action } = await upsertWithAudit(client, {
        student_id: record.student_id,
        batch_id,
        institution_id: access.institutionId,
        date,
        status: record.status || 'present',
        actorId,
        actorRole,
      });
      results.push({ ...attendance, action });
    }
    await client.query('COMMIT');

    res.status(201).json({
      message: `Attendance marked for ${results.length} students`,
      attendance: results,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Bulk attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

// GET attendance for a batch (trainer/admin) — includes creator +
// updater metadata so the UI can render "Marked by X (trainer)
// on 2 Jun · Last updated by Y (branch admin) on 3 Jun".
exports.getAttendanceByBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;  // optional ?date=2026-05-08
    const userId = req.user.id;
    const userRole = req.user.role;

    // Auth check — include branch_id so we can enforce branch scope.
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id, branch_id FROM batches WHERE id = $1',
      [id]
    );
    if (batchResult.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    const batch = batchResult.rows[0];

    if (userRole === 'admin') {
      const scope = await getBranchScope(userId);
      if (!scope || scope.rootId !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
      if (scope.isSubBranchAdmin) {
        if (batch.branch_id !== scope.callerInstId) {
          return res.status(403).json({ message: 'This batch is not at your branch' });
        }
      } else if (batch.branch_id != null) {
        return res.status(403).json({ message: 'This batch belongs to a sub-branch' });
      }
    } else if (userRole === 'trainer') {
      const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [userId]);
      if (trainerResult.rows.length === 0 || trainerResult.rows[0].id !== batch.trainer_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Build query (with optional date filter). We LEFT JOIN users
    // twice to fetch the original creator and the last updater by
    // name + role, so the mobile can render the audit strip inline
    // without a second round trip.
    let query = `
      SELECT
        a.*,
        u.name  AS student_name,
        u.email AS student_email,
        creator.name AS created_by_name,
        creator.role AS created_by_role,
        updater.name AS updated_by_name,
        updater.role AS updated_by_role
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      LEFT JOIN users creator ON creator.id = a.created_by
      LEFT JOIN users updater ON updater.id = a.updated_by
      WHERE a.batch_id = $1`;
    const params = [id];

    if (date) {
      query += ' AND a.date = $2';
      params.push(date);
    }

    query += ' ORDER BY a.date DESC, u.name';

    const result = await pool.query(query, params);

    res.json({ count: result.rows.length, attendance: result.rows });
  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET history for a single attendance row — full audit chain, newest
// first. Used by the "who touched this?" popover on the attendance
// grid. Same auth rules as getAttendanceByBatch: caller must have
// access to the parent batch.
exports.getAttendanceHistory = async (req, res) => {
  try {
    const attendanceId = Number(req.params.id);
    if (!Number.isInteger(attendanceId)) {
      return res.status(400).json({ message: 'Invalid attendance id' });
    }

    // Resolve batch so we can reuse the same access check.
    const aRes = await pool.query(
      'SELECT batch_id FROM attendance WHERE id = $1',
      [attendanceId],
    );
    if (aRes.rows.length === 0) return res.status(404).json({ message: 'Attendance not found' });
    const batchId = aRes.rows[0].batch_id;

    // Access check — same logic as getAttendanceByBatch.
    const batchResult = await pool.query(
      'SELECT institution_id, trainer_id, branch_id FROM batches WHERE id = $1',
      [batchId],
    );
    const batch = batchResult.rows[0];
    const role = req.user.role;
    if (role === 'admin') {
      const scope = await getBranchScope(req.user.id);
      if (!scope || scope.rootId !== batch.institution_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
      if (scope.isSubBranchAdmin && batch.branch_id !== scope.callerInstId) {
        return res.status(403).json({ message: 'This batch is not at your branch' });
      }
      if (!scope.isSubBranchAdmin && batch.branch_id != null) {
        return res.status(403).json({ message: 'This batch belongs to a sub-branch' });
      }
    } else if (role === 'trainer') {
      const trainerResult = await pool.query('SELECT id FROM trainers WHERE user_id = $1', [req.user.id]);
      if (trainerResult.rows.length === 0 || trainerResult.rows[0].id !== batch.trainer_id) {
        return res.status(403).json({ message: 'Not your batch' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    const historyRes = await pool.query(
      `SELECT h.id, h.action, h.previous_status, h.new_status,
              h.actor_id, h.actor_role, h.at,
              u.name AS actor_name
         FROM attendance_history h
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.attendance_id = $1
        ORDER BY h.at DESC, h.id DESC`,
      [attendanceId],
    );

    res.json({ count: historyRes.rows.length, history: historyRes.rows });
  } catch (err) {
    console.error('Get attendance history error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/attendance/batch/:id/summary
//
// Institution / branch admin's READ-ONLY attendance summary for a
// batch. Returns two percentages:
//
//   • today.percentage  = how many enrolled students were marked
//                          present (or late) TODAY, out of the total
//                          enrolled in the batch.
//   • month.percentage  = across every attendance record for this
//                          batch in the CURRENT calendar month, what
//                          share was marked present (or late).
//
// The counts backing each percentage are returned alongside so the
// mobile can render "12 / 20 students · 60%" style breakdowns without
// having to redo the math.
exports.getBatchAttendanceSummary = async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (!Number.isInteger(batchId)) {
      return res.status(400).json({ message: 'Invalid batch id' });
    }

    // Institution scope check — the caller's users.institution_id must
    // match the batch's institution_id (or its parent institution when
    // this is a sub-branch). Reuses the same shape as verifyAdminOwnsBatch
    // but only for read; branch admins may also inspect their own batches.
    const admin = await verifyAdminOwnsBatch(req.user.id, batchId);
    if (!admin.ok) {
      return res.status(admin.status || 403).json({ message: admin.message });
    }

    // Total enrolled — denominator for today.percentage.
    const enrolled = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM enrollments
        WHERE batch_id = $1`,
      [batchId],
    );
    const totalEnrolled = enrolled.rows[0]?.n || 0;

    // Today's counts. 'present' and 'late' count as "attended".
    const today = await pool.query(
      `SELECT
         COUNT(*)::int                                          AS marked,
         COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present
        FROM attendance
       WHERE batch_id = $1
         AND date     = CURRENT_DATE`,
      [batchId],
    );
    const todayMarked  = today.rows[0]?.marked  || 0;
    const todayPresent = today.rows[0]?.present || 0;
    const todayPct = totalEnrolled > 0
      ? Math.round((todayPresent / totalEnrolled) * 100)
      : 0;

    // Month-to-date counts. Denominator is total records marked this
    // month (a stable, natural yardstick — students who weren't
    // scheduled don't get counted as absent).
    const month = await pool.query(
      `SELECT
         COUNT(*)::int                                          AS marked,
         COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present
        FROM attendance
       WHERE batch_id = $1
         AND date_trunc('month', date) = date_trunc('month', CURRENT_DATE)`,
      [batchId],
    );
    const monthMarked  = month.rows[0]?.marked  || 0;
    const monthPresent = month.rows[0]?.present || 0;
    const monthPct = monthMarked > 0
      ? Math.round((monthPresent / monthMarked) * 100)
      : 0;

    res.json({
      today: {
        percentage:     todayPct,
        present:        todayPresent,
        marked:         todayMarked,
        total_enrolled: totalEnrolled,
      },
      month: {
        percentage: monthPct,
        present:    monthPresent,
        marked:     monthMarked,
      },
    });
  } catch (err) {
    console.error('Get batch attendance summary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/attendance/institution/today
//
// Institution-wide TODAY's attendance percentage across every active
// batch. Powers the Institution Home Dashboard "Today's Attendance"
// card. Sub-branch admins see the number for their own branch only;
// main-institution admins see the aggregate across every branch.
//
// Formula: sum of present records today / sum of enrollments across
// all batches whose attendance was marked today × 100. Batches with
// no attendance marked today don't contribute to either side (so a
// day with 0 batches marked reports 0% rather than dividing by 0).
exports.getInstitutionTodayAttendance = async (req, res) => {
  try {
    // Resolve the caller's institution + branch scope.
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [req.user.id],
    );
    const instId = u.rows[0]?.institution_id;
    if (!instId) {
      return res.status(403).json({ message: 'No institution linked' });
    }
    const scope = await getBranchScope(req.user.id);

    // Determine which batches count. Sub-branch admins → only their
    // own branch's batches. Main-institution admins → every batch
    // across the root institution + its sub-branches.
    const params = [instId];
    let batchWhere = '';
    if (scope?.type === 'sub_branch') {
      params.push(instId); // sub-branch's own id is same as institution_id from the JWT
      batchWhere = `AND b.branch_id = $${params.length}`;
    }

    const summary = await pool.query(
      `WITH scoped_batches AS (
         SELECT b.id
           FROM batches b
           JOIN institutions i ON i.id = b.institution_id
          WHERE (i.id = $1 OR i.parent_institution_id = $1)
            ${batchWhere}
       ),
       today_att AS (
         SELECT batch_id,
                COUNT(*)::int AS marked,
                COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present
           FROM attendance
          WHERE date = CURRENT_DATE
            AND batch_id IN (SELECT id FROM scoped_batches)
          GROUP BY batch_id
       )
       SELECT
         COALESCE(SUM(marked),  0)::int AS marked,
         COALESCE(SUM(present), 0)::int AS present,
         COUNT(*)::int                   AS batches_marked
       FROM today_att`,
      params,
    );

    const row = summary.rows[0] || { marked: 0, present: 0, batches_marked: 0 };
    const percentage = row.marked > 0
      ? Math.round((row.present / row.marked) * 100)
      : 0;

    res.json({
      today: {
        percentage,
        present:        row.present,
        marked:         row.marked,
        batches_marked: row.batches_marked,
      },
    });
  } catch (err) {
    console.error('Get institution today attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my attendance (student)
exports.getMyAttendance = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT a.*, b.name AS batch_name, c.name AS course_name
       FROM attendance a
       JOIN batches b ON a.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       WHERE a.student_id = $1
       ORDER BY a.date DESC`,
      [studentId]
    );

    // Calculate summary stats
    const total = result.rows.length;
    const present = result.rows.filter(r => r.status === 'present').length;
    const absent = result.rows.filter(r => r.status === 'absent').length;
    const late = result.rows.filter(r => r.status === 'late').length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

    res.json({
      summary: { total, present, absent, late, percentage },
      attendance: result.rows
    });
  } catch (err) {
    console.error('Get my attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
