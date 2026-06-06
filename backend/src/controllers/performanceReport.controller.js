const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Performance reports (migration 025)
// ─────────────────────────────────────────────────────────────────────────────
// Created by trainers (or institution admins) for students. Lifecycle:
//   draft → published. On publish we fan out a notification to the student
//   plus any active linked parents.
//
// Authorisation:
//   - create / update / publish / delete:
//       * trainer assigned to the student's batch (when batch_id is set)
//       * institution admin (owner of student's institution)
//   - read:
//       * the student (only their published reports)
//       * the parent linked to that student (only published)
//       * the trainer who authored (any status)
//       * institution admin (any status, institution scope)
// ─────────────────────────────────────────────────────────────────────────────

// Helper: clamp a JSON value to a 1-5 int or null.
function ratingFromBody(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(5, n));
}

// Helper: normalise an incoming array of goals / media into a JSON string.
function jsonbArray(v, fallback = []) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch { /* fall through */ }
  }
  return JSON.stringify(fallback);
}

// Authorise the caller for write access on a report (by student + optional
// batch). Returns { ok, institution_id, status, error }.
async function authorizeWrite(req, student_id, batch_id) {
  // Pull the student's institution from their first paid/active enrollment.
  // If batch_id is supplied we use that batch's institution_id; otherwise
  // fall back to the student user row.
  let institutionId = null;
  let trainerOwnsBatch = false;

  if (batch_id) {
    const b = await pool.query(
      `SELECT b.institution_id, t.user_id AS trainer_user_id
         FROM batches b
         LEFT JOIN trainers t ON b.trainer_id = t.id
        WHERE b.id = $1`,
      [batch_id],
    );
    if (b.rows.length === 0) {
      return { ok: false, status: 404, error: 'Batch not found' };
    }
    institutionId = b.rows[0].institution_id;
    trainerOwnsBatch = b.rows[0].trainer_user_id === req.user.id;
  } else {
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [student_id],
    );
    institutionId = u.rows[0]?.institution_id;
  }
  if (!institutionId) {
    return { ok: false, status: 400, error: 'Could not resolve institution for this student' };
  }

  if (req.user.role === 'admin') {
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (u.rows[0]?.institution_id !== institutionId) {
      return { ok: false, status: 403, error: 'Not your institution' };
    }
    return { ok: true, institution_id: institutionId };
  }

  if (req.user.role === 'trainer') {
    // No batch supplied → trainer can write if they have ANY batch in the
    // student's institution AND the student is enrolled in any of their
    // batches. With batch supplied → must be assigned to it.
    if (batch_id && !trainerOwnsBatch) {
      return { ok: false, status: 403, error: 'You are not assigned to this batch' };
    }
    if (!batch_id) {
      const has = await pool.query(
        `SELECT 1 FROM trainers t
           JOIN batches b ON b.trainer_id = t.id
           JOIN enrollments e ON e.batch_id = b.id
          WHERE t.user_id = $1 AND e.student_id = $2
          LIMIT 1`,
        [req.user.id, student_id],
      );
      if (has.rows.length === 0) {
        return { ok: false, status: 403, error: 'This student is not in any of your batches' };
      }
    }
    return { ok: true, institution_id: institutionId };
  }

  return { ok: false, status: 403, error: 'Access denied' };
}

// ── CREATE ──────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      student_id, batch_id, report_date, belt_level,
      discipline_rating, attendance_rating, technique_rating,
      fitness_rating, sparring_rating, behaviour_rating,
      strengths, improvements, trainer_remarks,
      next_goals, classes_attended, classes_missed,
      media_urls, visible_to_student, visible_to_parent,
    } = req.body || {};

    if (!student_id) {
      return res.status(400).json({ message: 'student_id is required' });
    }

    const auth = await authorizeWrite(req, Number(student_id), batch_id ? Number(batch_id) : null);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    const result = await pool.query(
      `INSERT INTO performance_reports
         (student_id, trainer_id, batch_id, institution_id,
          report_date, belt_level,
          discipline_rating, attendance_rating, technique_rating,
          fitness_rating, sparring_rating, behaviour_rating,
          strengths, improvements, trainer_remarks,
          next_goals, classes_attended, classes_missed,
          media_urls, visible_to_student, visible_to_parent,
          status)
       VALUES ($1, $2, $3, $4,
               COALESCE($5::date, CURRENT_DATE), $6,
               $7, $8, $9, $10, $11, $12,
               $13, $14, $15,
               $16::jsonb, $17, $18,
               $19::jsonb, $20, $21,
               'draft')
       RETURNING *`,
      [
        student_id, req.user.id, batch_id || null, auth.institution_id,
        report_date || null, belt_level || null,
        ratingFromBody(discipline_rating),
        ratingFromBody(attendance_rating),
        ratingFromBody(technique_rating),
        ratingFromBody(fitness_rating),
        ratingFromBody(sparring_rating),
        ratingFromBody(behaviour_rating),
        strengths || null,
        improvements || null,
        trainer_remarks || null,
        jsonbArray(next_goals),
        classes_attended != null ? Number(classes_attended) : null,
        classes_missed   != null ? Number(classes_missed)   : null,
        jsonbArray(media_urls),
        visible_to_student !== false,
        visible_to_parent !== false,
      ],
    );

    res.status(201).json({ message: 'Report saved as draft', report: result.rows[0] });
  } catch (err) {
    console.error('Performance report create error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── UPDATE ──────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const existing = await pool.query(
      `SELECT * FROM performance_reports WHERE id = $1`, [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Report not found' });
    }
    const r = existing.rows[0];

    const auth = await authorizeWrite(req, r.student_id, r.batch_id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    // PATCH-style: only fields actually present in the body are written.
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const updated = await pool.query(
      `UPDATE performance_reports SET
         report_date         = COALESCE($1::date, report_date),
         belt_level          = COALESCE($2, belt_level),
         discipline_rating   = COALESCE($3, discipline_rating),
         attendance_rating   = COALESCE($4, attendance_rating),
         technique_rating    = COALESCE($5, technique_rating),
         fitness_rating      = COALESCE($6, fitness_rating),
         sparring_rating     = COALESCE($7, sparring_rating),
         behaviour_rating    = COALESCE($8, behaviour_rating),
         strengths           = COALESCE($9, strengths),
         improvements        = COALESCE($10, improvements),
         trainer_remarks     = COALESCE($11, trainer_remarks),
         next_goals          = COALESCE($12::jsonb, next_goals),
         classes_attended    = COALESCE($13, classes_attended),
         classes_missed      = COALESCE($14, classes_missed),
         media_urls          = COALESCE($15::jsonb, media_urls),
         visible_to_student  = COALESCE($16, visible_to_student),
         visible_to_parent   = COALESCE($17, visible_to_parent),
         updated_at          = CURRENT_TIMESTAMP
       WHERE id = $18
       RETURNING *`,
      [
        has('report_date')        ? body.report_date           : null,
        has('belt_level')         ? body.belt_level            : null,
        has('discipline_rating')  ? ratingFromBody(body.discipline_rating) : null,
        has('attendance_rating')  ? ratingFromBody(body.attendance_rating) : null,
        has('technique_rating')   ? ratingFromBody(body.technique_rating)  : null,
        has('fitness_rating')     ? ratingFromBody(body.fitness_rating)    : null,
        has('sparring_rating')    ? ratingFromBody(body.sparring_rating)   : null,
        has('behaviour_rating')   ? ratingFromBody(body.behaviour_rating)  : null,
        has('strengths')          ? body.strengths             : null,
        has('improvements')       ? body.improvements          : null,
        has('trainer_remarks')    ? body.trainer_remarks       : null,
        has('next_goals')         ? jsonbArray(body.next_goals): null,
        has('classes_attended')   ? (body.classes_attended != null ? Number(body.classes_attended) : null) : null,
        has('classes_missed')     ? (body.classes_missed   != null ? Number(body.classes_missed)   : null) : null,
        has('media_urls')         ? jsonbArray(body.media_urls): null,
        has('visible_to_student') ? !!body.visible_to_student  : null,
        has('visible_to_parent')  ? !!body.visible_to_parent   : null,
        id,
      ],
    );

    res.json({ message: 'Report updated', report: updated.rows[0] });
  } catch (err) {
    console.error('Performance report update error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── PUBLISH ─────────────────────────────────────────────────────────────────
exports.publish = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query(
      `SELECT lr.*, u.name AS student_name
         FROM performance_reports lr
         JOIN users u ON lr.student_id = u.id
        WHERE lr.id = $1`, [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Report not found' });
    }
    const r = existing.rows[0];
    const auth = await authorizeWrite(req, r.student_id, r.batch_id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    if (r.status === 'published') {
      return res.status(409).json({ message: 'Already published' });
    }

    const updated = await pool.query(
      `UPDATE performance_reports SET
         status = 'published',
         published_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id],
    );

    // Fan out notifications — best effort.
    try {
      if (r.visible_to_student) {
        await insertNotification({
          user_id:        r.student_id,
          institution_id: r.institution_id,
          category:       'performance',
          title:          'New performance report',
          message:        `Your trainer has published a new performance report (${new Date(r.report_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}).`,
          data:           { screen: 'StudentPerformanceReportDetail', report_id: r.id },
          created_by:     req.user.id,
        });
      }
      if (r.visible_to_parent) {
        const parents = await pool.query(
          `SELECT parent_id FROM parent_child_links
            WHERE child_id = $1 AND status = 'active'`,
          [r.student_id],
        );
        for (const p of parents.rows) {
          await insertNotification({
            user_id:        p.parent_id,
            institution_id: r.institution_id,
            category:       'performance',
            title:          `${r.student_name}'s performance report`,
            message:        `A new performance report has been published for ${r.student_name}.`,
            data:           { screen: 'ParentPerformanceReportDetail', report_id: r.id, student_id: r.student_id },
            created_by:     req.user.id,
          });
        }
      }
    } catch (err) {
      console.warn('[performance.publish] notify failed:', err.message);
    }

    res.json({ message: 'Report published', report: updated.rows[0] });
  } catch (err) {
    console.error('Performance report publish error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── DELETE ──────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(
      `SELECT * FROM performance_reports WHERE id = $1`, [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Report not found' });
    }
    const r = existing.rows[0];
    const auth = await authorizeWrite(req, r.student_id, r.batch_id);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    await pool.query(`DELETE FROM performance_reports WHERE id = $1`, [id]);
    res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('Performance report delete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── LIST (trainer/admin scope) ──────────────────────────────────────────────
// GET /api/performance-reports?student_id=&status=
exports.listForTrainer = async (req, res) => {
  try {
    const { student_id, status } = req.query;
    const params = [];
    const where = [];

    if (req.user.role === 'trainer') {
      params.push(req.user.id);
      where.push(`pr.trainer_id = $${params.length}`);
    } else if (req.user.role === 'admin') {
      const u = await pool.query(
        `SELECT institution_id FROM users WHERE id = $1`, [req.user.id],
      );
      const institutionId = u.rows[0]?.institution_id;
      if (!institutionId) return res.status(403).json({ message: 'No institution linked' });
      params.push(institutionId);
      where.push(`pr.institution_id = $${params.length}`);
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (student_id) {
      params.push(Number(student_id));
      where.push(`pr.student_id = $${params.length}`);
    }
    if (status && ['draft', 'published'].includes(status)) {
      params.push(status);
      where.push(`pr.status = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT pr.*,
              s.name AS student_name,
              s.email AS student_email,
              sp.photo_url AS student_photo_url,
              b.name AS batch_name,
              c.name AS course_name,
              t.name AS trainer_name
         FROM performance_reports pr
         JOIN users s ON pr.student_id = s.id
         LEFT JOIN student_profiles sp ON sp.user_id = s.id
         LEFT JOIN batches b ON pr.batch_id = b.id
         LEFT JOIN courses c ON b.course_id = c.id
         LEFT JOIN users t ON pr.trainer_id = t.id
        WHERE ${where.join(' AND ')}
        ORDER BY pr.report_date DESC, pr.created_at DESC`,
      params,
    );
    res.json({ count: result.rows.length, reports: result.rows });
  } catch (err) {
    console.error('Performance report list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── LIST (student scope) ────────────────────────────────────────────────────
// GET /api/performance-reports/my  — student sees their own PUBLISHED.
exports.listMy = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*,
              b.name AS batch_name,
              c.name AS course_name,
              t.name AS trainer_name
         FROM performance_reports pr
         LEFT JOIN batches b ON pr.batch_id = b.id
         LEFT JOIN courses c ON b.course_id = c.id
         LEFT JOIN users t ON pr.trainer_id = t.id
        WHERE pr.student_id = $1
          AND pr.status = 'published'
          AND pr.visible_to_student = TRUE
        ORDER BY pr.report_date DESC`,
      [req.user.id],
    );
    res.json({ count: result.rows.length, reports: result.rows });
  } catch (err) {
    console.error('Performance report my error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── GET ONE ─────────────────────────────────────────────────────────────────
// Used by all roles. We check read permission against the caller.
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT pr.*,
              s.name  AS student_name,
              s.email AS student_email,
              sp.photo_url AS student_photo_url,
              b.name  AS batch_name,
              c.name  AS course_name,
              t.name  AS trainer_name,
              i.name  AS institution_name
         FROM performance_reports pr
         JOIN users s ON pr.student_id = s.id
         LEFT JOIN student_profiles sp ON sp.user_id = s.id
         LEFT JOIN batches b ON pr.batch_id = b.id
         LEFT JOIN courses c ON b.course_id = c.id
         LEFT JOIN users t ON pr.trainer_id = t.id
         LEFT JOIN institutions i ON pr.institution_id = i.id
        WHERE pr.id = $1`, [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Report not found' });
    }
    const r = result.rows[0];

    // Read auth.
    const role = req.user.role;
    if (role === 'student') {
      if (r.student_id !== req.user.id || r.status !== 'published' || !r.visible_to_student) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'parent') {
      const link = await pool.query(
        `SELECT 1 FROM parent_child_links
          WHERE parent_id = $1 AND child_id = $2 AND status = 'active'
          LIMIT 1`,
        [req.user.id, r.student_id],
      );
      if (link.rows.length === 0 || r.status !== 'published' || !r.visible_to_parent) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'admin' || role === 'trainer') {
      const auth = await authorizeWrite(req, r.student_id, r.batch_id);
      if (!auth.ok) return res.status(auth.status).json({ message: auth.error });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ report: r });
  } catch (err) {
    console.error('Performance report getById error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
