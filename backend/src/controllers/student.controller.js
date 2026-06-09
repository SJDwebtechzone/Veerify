// backend/src/controllers/student.controller.js
//
// Endpoints for the super admin students roster page AND the student
// mobile dashboard's data needs.
//
// A "student" is a user with role='student'. Their personal details live on
// the student_profiles table (migration 017), and their connection to
// institutions is derived from the enrollments table.

const pool = require('../config/db');

// GET /api/students/all
// Returns every student user joined with their profile (if any) and a
// JSON array of the institutions they're enrolled in. Optional query
// params let the page filter server-side once the dataset gets large:
//   ?institution_id=42
//   ?gender=Male
//   ?status=active
exports.getAllStudents = async (req, res) => {
  try {
    const { institution_id, gender, status } = req.query;

    const where = [
      `u.role = 'student'`,
      `COALESCE(u.is_deleted, false) = false`,
    ];
    const params = [];

    if (gender) {
      params.push(gender);
      where.push(`sp.gender = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    if (institution_id) {
      params.push(Number(institution_id));
      where.push(`EXISTS (
        SELECT 1
        FROM enrollments e
        JOIN batches b ON e.batch_id = b.id
        WHERE e.student_id = u.id
          AND b.institution_id = $${params.length}
      )`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // The JOIN to institutions runs inside a subquery and gets aggregated
    // into a JSONB array so each student row carries all their academies
    // in a single column.
    const result = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.status            AS user_status,
         u.created_at        AS joined_at,

         sp.full_name        AS profile_full_name,
         sp.date_of_birth,
         sp.gender,
         sp.father_name,
         sp.mother_name,
         sp.contact_number   AS profile_contact_number,
         sp.email            AS profile_email,
         sp.address,
         sp.marital_status,
         sp.occupation,
         sp.height_cm,
         sp.weight_kg,
         sp.disabilities,
         sp.photo_url,

         (
           SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
             'id',   i.id,
             'name', i.name,
             'city', i.city
           )), '[]'::jsonb)
           FROM enrollments e
           JOIN batches b ON e.batch_id = b.id
           JOIN institutions i ON b.institution_id = i.id
           WHERE e.student_id = u.id
             AND i.deleted_at IS NULL
         ) AS institutions,

         (
           SELECT COUNT(*)::int
           FROM enrollments e
           WHERE e.student_id = u.id
         ) AS enrollment_count,

         (
           SELECT COUNT(*)::int
           FROM enrollments e
           WHERE e.student_id = u.id
             AND e.payment_status = 'paid'
         ) AS paid_enrollment_count,

         -- All courses this student is enrolled in. Each entry carries the
         -- course id+name, the batch name they joined, and the payment
         -- status — enough for the admin web table to show a Course column
         -- with paid/pending pills without another round-trip.
         (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'enrollment_id',  e.id,
             'course_id',      c.id,
             'course_name',    c.name,
             'course_image',   c.image_url,
             'batch_id',       b.id,
             'batch_name',     b.name,
             'institution_id', i.id,
             'institution_name', i.name,
             'payment_status', e.payment_status,
             'payment_amount', e.payment_amount,
             'enrolled_at',    e.enrolled_at,
             'paid_at',        e.paid_at
           ) ORDER BY e.enrolled_at DESC), '[]'::jsonb)
           FROM enrollments e
           JOIN batches b      ON e.batch_id = b.id
           JOIN courses c      ON b.course_id = c.id
           LEFT JOIN institutions i ON b.institution_id = i.id
           WHERE e.student_id = u.id
         ) AS courses

       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC`,
      params,
    );

    res.json({
      count: result.rows.length,
      students: result.rows,
    });
  } catch (err) {
    console.error('Get all students error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/students/my-videos
//
// Returns course_videos for every batch this student is paid-enrolled in.
// Each row carries enough joined info (batch name, course name, course
// banner, trainer name, institution name) to render a card without
// further round-trips. Ordered newest first.
// ─────────────────────────────────────────────────────────────────────────
// GET /api/students/me/summary
// One-shot card payload for the student home screen — attendance % and
// performance % computed from the live tables. Used to render the two
// circular rings under the hero.
//
//   attendance_pct = present / (present + absent + late + leave) * 100
//   performance_pct = avg of all 6 rating fields across PUBLISHED reports,
//                     scaled from 1-5 → 0-100
//
// Both default to null when there's no data yet (the UI shows a "—" ring
// instead of misleading 0%).
exports.getMySummary = async (req, res) => {
  try {
    const studentId = req.user.id;

    const [attRes, perfRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present')::int AS present,
           COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late', 'leave'))::int AS total
           FROM attendance
          WHERE student_id = $1`,
        [studentId],
      ),
      pool.query(
        `SELECT
           AVG(
             (COALESCE(discipline_rating, 0) +
              COALESCE(attendance_rating, 0) +
              COALESCE(technique_rating,  0) +
              COALESCE(fitness_rating,    0) +
              COALESCE(sparring_rating,   0) +
              COALESCE(behaviour_rating,  0))
             / NULLIF(
                (CASE WHEN discipline_rating IS NULL THEN 0 ELSE 1 END +
                 CASE WHEN attendance_rating IS NULL THEN 0 ELSE 1 END +
                 CASE WHEN technique_rating  IS NULL THEN 0 ELSE 1 END +
                 CASE WHEN fitness_rating    IS NULL THEN 0 ELSE 1 END +
                 CASE WHEN sparring_rating   IS NULL THEN 0 ELSE 1 END +
                 CASE WHEN behaviour_rating  IS NULL THEN 0 ELSE 1 END), 0)
           ) AS avg_rating,
           COUNT(*)::int AS report_count
           FROM performance_reports
          WHERE student_id = $1 AND status = 'published'`,
        [studentId],
      ),
    ]);

    const att = attRes.rows[0] || { present: 0, total: 0 };
    const attendance_pct = att.total > 0
      ? Math.round((Number(att.present) / Number(att.total)) * 100)
      : null;

    const perf = perfRes.rows[0] || {};
    const avg = Number(perf.avg_rating);
    const performance_pct = Number.isFinite(avg) && avg > 0
      ? Math.round((avg / 5) * 100)
      : null;

    res.json({
      attendance: {
        percentage: attendance_pct,
        present:    Number(att.present) || 0,
        total:      Number(att.total)   || 0,
      },
      performance: {
        percentage:   performance_pct,
        report_count: Number(perf.report_count) || 0,
        avg_rating:   Number.isFinite(avg) ? Number(avg.toFixed(2)) : null,
      },
    });
  } catch (err) {
    console.error('Get my summary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getMyVideos = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT
         v.id,
         v.title,
         v.description,
         v.video_url,
         v.thumbnail_url,
         v.duration_seconds,
         v.created_at,
         v.batch_id,
         v.kind,
         v.scheduled_at,

         b.name        AS batch_name,
         b.days_of_week,
         b.start_time,
         b.end_time,

         c.id          AS course_id,
         c.name        AS course_name,
         c.image_url   AS course_image,

         i.id          AS institution_id,
         i.name        AS institution_name,

         u.name        AS uploaded_by_name
       FROM course_videos v
       JOIN batches      b ON v.batch_id = b.id
       JOIN courses      c ON b.course_id = c.id
       LEFT JOIN institutions i ON b.institution_id = i.id
       LEFT JOIN users   u ON v.uploaded_by = u.id
       JOIN enrollments  e ON e.batch_id = b.id
       WHERE e.student_id = $1
         AND e.payment_status = 'paid'
         -- Hide expired live sessions. A live session is "still live" until
         -- scheduled_at + the trainer-provided duration_seconds (or 2 hours
         -- as a sensible default when no duration is set). Recorded videos
         -- and rows with no scheduled_at are always kept.
         AND (
           v.kind = 'recorded'
           OR v.scheduled_at IS NULL
           OR v.scheduled_at + (COALESCE(v.duration_seconds, 7200) || ' seconds')::interval > NOW()
         )
       ORDER BY v.created_at DESC
       LIMIT 50`,
      [studentId],
    );

    res.json({
      count: result.rows.length,
      videos: result.rows,
    });
  } catch (err) {
    console.error('Get my videos error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
