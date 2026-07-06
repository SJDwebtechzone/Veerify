// backend/src/controllers/curriculum.controller.js
//
// Per-student curriculum progress — trainers tick off lessons as the
// student completes them, picking the date the work happened.
//
// Lessons live as a JSONB array on `courses.curriculum`; we identify a
// lesson by its zero-based index in that array. Progress lives in
// `student_curriculum_progress` (migration 030).
//
// Endpoints:
//   GET    /api/curriculum-progress?student_id=&course_id=
//          -> { course, lessons, progress }
//          • course: { id, name }
//          • lessons: parsed curriculum array (so the mobile renders the
//            checklist directly from this response)
//          • progress: array of { lesson_index, completed_at,
//            completed_by_name, notes }
//   POST   /api/curriculum-progress
//          { student_id, course_id, lesson_index, completed_at?, notes? }
//          Upserts a progress row. Defaults completed_at to today.
//   DELETE /api/curriculum-progress
//          body or query: { student_id, course_id, lesson_index }
//          Removes the row → un-ticks the checkbox.

const pool = require('../config/db');

// Auth helper — trainers can only act on students enrolled in one of
// their batches; admins can act on any student in their institution.
// Students can READ their own progress (controlled by the `readOnly`
// flag callers pass when handling a GET).
async function assertCanManage(req, studentId, courseId, opts = {}) {
  const userId = req.user.id;
  const role   = req.user.role;
  // Students may only read, and only their own progress.
  if (role === 'student' || role === 'parent') {
    if (!opts.readOnly) return { ok: false, status: 403, message: 'Read-only access' };
    if (Number(userId) !== Number(studentId)) {
      return { ok: false, status: 403, message: 'Not your progress' };
    }
    return { ok: true };
  }
  if (role === 'admin') {
    const u = await pool.query(
      'SELECT institution_id FROM users WHERE id = $1', [userId]
    );
    const adminInst = u.rows[0]?.institution_id;
    const c = await pool.query(
      'SELECT institution_id FROM courses WHERE id = $1', [courseId]
    );
    if (!c.rows[0] || c.rows[0].institution_id !== adminInst) {
      return { ok: false, status: 403, message: 'Not your course' };
    }
    return { ok: true };
  }
  if (role === 'trainer') {
    // The trainer must be the assigned trainer on at least one batch
    // of the given course that the student is enrolled in.
    const r = await pool.query(
      `SELECT 1
         FROM enrollments e
         JOIN batches  b ON e.batch_id = b.id
         JOIN trainers t ON t.id = b.trainer_id
        WHERE e.student_id = $1
          AND b.course_id  = $2
          AND t.user_id    = $3
        LIMIT 1`,
      [studentId, courseId, userId],
    );
    if (r.rows.length === 0) {
      return { ok: false, status: 403, message: 'Student is not in any of your batches for this course' };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, message: 'Access denied' };
}

// GET /api/curriculum-progress?student_id=...&course_id=...
exports.getProgress = async (req, res) => {
  try {
    const studentId = parseInt(req.query.student_id, 10);
    const courseId  = parseInt(req.query.course_id, 10);
    if (!studentId || !courseId) {
      return res.status(400).json({ message: 'student_id and course_id are required' });
    }

    const auth = await assertCanManage(req, studentId, courseId, { readOnly: true });
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const cRes = await pool.query(
      `SELECT id, name, COALESCE(curriculum, '[]'::jsonb) AS curriculum
         FROM courses WHERE id = $1`,
      [courseId],
    );
    const course = cRes.rows[0];
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const pRes = await pool.query(
      `SELECT p.lesson_index,
              p.completed_at, p.notes,
              p.student_rating,
              p.student_remarks,
              p.student_remarked_at,
              u.name AS completed_by_name
         FROM student_curriculum_progress p
         LEFT JOIN users u ON u.id = p.completed_by
        WHERE p.student_id = $1 AND p.course_id = $2
        ORDER BY p.lesson_index`,
      [studentId, courseId],
    );

    res.json({
      course: { id: course.id, name: course.name },
      lessons: Array.isArray(course.curriculum) ? course.curriculum : [],
      progress: pRes.rows,
    });
  } catch (err) {
    console.error('Curriculum getProgress error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/curriculum-progress  -> upsert
// Body: { student_id, course_id, lesson_index, completed_at?, notes? }
exports.markComplete = async (req, res) => {
  try {
    const { student_id, course_id, lesson_index, completed_at, notes } = req.body || {};
    const sid = parseInt(student_id,   10);
    const cid = parseInt(course_id,    10);
    const idx = parseInt(lesson_index, 10);
    if (!sid || !cid || Number.isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: 'student_id, course_id, and lesson_index are required' });
    }

    const auth = await assertCanManage(req, sid, cid);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    // Sanity — lesson_index must fit inside the course's curriculum array.
    const cRes = await pool.query(
      `SELECT jsonb_array_length(COALESCE(curriculum, '[]'::jsonb)) AS n
         FROM courses WHERE id = $1`,
      [cid],
    );
    const n = Number(cRes.rows[0]?.n || 0);
    if (idx >= n) {
      return res.status(400).json({ message: `Lesson index ${idx} out of range (course has ${n} lessons)` });
    }

    // Normalise date — accept YYYY-MM-DD or ISO; default to today.
    let dateStr = (completed_at || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateStr = new Date().toISOString().slice(0, 10);
    }

    const r = await pool.query(
      `INSERT INTO student_curriculum_progress
         (student_id, course_id, lesson_index, completed_at, completed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (student_id, course_id, lesson_index)
       DO UPDATE SET
         completed_at = EXCLUDED.completed_at,
         completed_by = EXCLUDED.completed_by,
         notes        = COALESCE(EXCLUDED.notes, student_curriculum_progress.notes),
         updated_at   = NOW()
       RETURNING lesson_index, completed_at, notes`,
      [sid, cid, idx, dateStr, req.user.id, notes || null],
    );

    res.status(201).json({ progress: r.rows[0] });
  } catch (err) {
    console.error('Curriculum markComplete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/curriculum-progress/feedback
//
// Student-side write: lets the signed-in student (or a parent acting on
// their behalf) attach a rating + remarks to a specific lesson. Unlike
// markComplete this DOES auto-create a progress row if one doesn't exist
// yet — the student shouldn't have to wait for the trainer to tick the
// lesson before they can rate it.
//
// Body: { course_id, lesson_index, rating?, remarks? }
//       (student_id is implicit — pulled from req.user)
//
// Either rating or remarks must be supplied; both can be cleared by
// passing null explicitly.
exports.submitStudentFeedback = async (req, res) => {
  try {
    const { course_id, lesson_index } = req.body || {};
    let { rating, remarks } = req.body || {};
    const cid = parseInt(course_id,    10);
    const idx = parseInt(lesson_index, 10);
    if (!cid || Number.isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: 'course_id and lesson_index are required' });
    }

    // Only the student themself (or their parent — handled the same as the
    // student in the existing assertCanManage helper) can write feedback.
    if (!['student', 'parent'].includes(req.user.role)) {
      return res.status(403).json({
        message: 'Only students can submit feedback for their own lessons.',
      });
    }
    const sid = req.user.id;

    // Validate rating range when supplied. Allow explicit null to clear.
    if (rating !== undefined && rating !== null && rating !== '') {
      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) {
        return res.status(400).json({ message: 'rating must be an integer 1–5' });
      }
      rating = r;
    } else {
      rating = null;
    }
    remarks = (remarks === undefined || remarks === null) ? null
      : String(remarks).trim() || null;

    if (rating === null && remarks === null) {
      return res.status(400).json({
        message: 'Provide at least a rating or a remark.',
      });
    }

    // Sanity-check the lesson index against the course's curriculum length.
    const cRes = await pool.query(
      `SELECT jsonb_array_length(COALESCE(curriculum, '[]'::jsonb)) AS n
         FROM courses WHERE id = $1`,
      [cid],
    );
    const n = Number(cRes.rows[0]?.n || 0);
    if (idx >= n) {
      return res.status(400).json({
        message: `Lesson index ${idx} out of range (course has ${n} lessons)`,
      });
    }

    // Upsert. completed_at is required by the table — when we're auto-
    // creating a row purely for student feedback we still need to seed
    // a date, so we use today (the trainer can edit it later when they
    // formally mark the lesson done).
    const today = new Date().toISOString().slice(0, 10);
    const r = await pool.query(
      `INSERT INTO student_curriculum_progress
         (student_id, course_id, lesson_index,
          completed_at, student_rating, student_remarks, student_remarked_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (student_id, course_id, lesson_index)
       DO UPDATE SET
         student_rating      = EXCLUDED.student_rating,
         student_remarks     = EXCLUDED.student_remarks,
         student_remarked_at = NOW(),
         updated_at          = NOW()
       RETURNING lesson_index, completed_at,
                 student_rating, student_remarks, student_remarked_at`,
      [sid, cid, idx, today, rating, remarks],
    );

    res.status(201).json({ feedback: r.rows[0] });
  } catch (err) {
    console.error('Curriculum submitStudentFeedback error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/curriculum-progress
// Body: { student_id, course_id, lesson_index }
exports.unmarkComplete = async (req, res) => {
  try {
    const src = Object.keys(req.body || {}).length ? req.body : req.query;
    const sid = parseInt(src.student_id,   10);
    const cid = parseInt(src.course_id,    10);
    const idx = parseInt(src.lesson_index, 10);
    if (!sid || !cid || Number.isNaN(idx) || idx < 0) {
      return res.status(400).json({ message: 'student_id, course_id, and lesson_index are required' });
    }

    const auth = await assertCanManage(req, sid, cid);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    await pool.query(
      `DELETE FROM student_curriculum_progress
        WHERE student_id = $1 AND course_id = $2 AND lesson_index = $3`,
      [sid, cid, idx],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Curriculum unmarkComplete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
