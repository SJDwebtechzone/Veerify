// backend/src/controllers/courseVideo.controller.js
//
// CRUD for course_videos (migration 019). Used by:
//   - Trainer staff app to upload + manage videos for their assigned batches
//   - Student mobile to view (via /api/students/my-videos)
//   - Institution admin (any batch in their institution)

const pool = require('../config/db');

// Resolve who's calling and what they're allowed to do for a given batch.
// Returns { ok: true, role: 'admin'|'trainer'|'student' } or { ok: false, error }.
async function authorizeBatchAccess(userId, userRole, batchId, { requireWrite = false } = {}) {
  const batchRes = await pool.query(
    `SELECT b.id, b.institution_id, b.trainer_id, t.user_id AS trainer_user_id
       FROM batches b
       LEFT JOIN trainers t ON b.trainer_id = t.id
      WHERE b.id = $1`,
    [batchId],
  );
  if (batchRes.rows.length === 0) {
    return { ok: false, status: 404, error: 'Batch not found' };
  }
  const batch = batchRes.rows[0];

  if (userRole === 'admin') {
    const u = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
    if (u.rows[0]?.institution_id !== batch.institution_id) {
      return { ok: false, status: 403, error: 'Not your institution' };
    }
    return { ok: true, role: 'admin', batch };
  }
  if (userRole === 'trainer') {
    if (batch.trainer_user_id !== userId) {
      return { ok: false, status: 403, error: 'You are not assigned to this batch' };
    }
    return { ok: true, role: 'trainer', batch };
  }
  if (userRole === 'student' && !requireWrite) {
    // Student must have a PAID enrollment in this batch to read videos.
    const enr = await pool.query(
      `SELECT 1 FROM enrollments
        WHERE student_id = $1 AND batch_id = $2 AND payment_status = 'paid'
        LIMIT 1`,
      [userId, batchId],
    );
    if (enr.rows.length === 0) {
      return { ok: false, status: 403, error: 'Enroll and complete payment to access videos' };
    }
    return { ok: true, role: 'student', batch };
  }
  return { ok: false, status: 403, error: 'Access denied' };
}

// POST /api/course-videos
// Body: { batch_id, title, description?, video_url, thumbnail_url?,
//         duration_seconds?, kind?, scheduled_at? }
//
// kind defaults to 'recorded'. Pass 'live' to create a live-session entry;
// scheduled_at (ISO string) is required in that case.
exports.create = async (req, res) => {
  try {
    const {
      batch_id, title, description,
      video_url, thumbnail_url, duration_seconds,
      kind, scheduled_at,
    } = req.body || {};

    if (!batch_id || !title || !video_url) {
      return res.status(400).json({ message: 'batch_id, title, and video_url are required' });
    }

    // Normalise kind. Anything other than 'live' falls back to 'recorded' so
    // the existing trainer screens keep working unchanged.
    const normKind = kind === 'live' ? 'live' : 'recorded';
    if (normKind === 'live' && !scheduled_at) {
      return res.status(400).json({ message: 'scheduled_at is required for live sessions' });
    }

    const auth = await authorizeBatchAccess(req.user.id, req.user.role, batch_id, { requireWrite: true });
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    const result = await pool.query(
      `INSERT INTO course_videos
         (batch_id, title, description, video_url, thumbnail_url,
          duration_seconds, uploaded_by, kind, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        batch_id,
        String(title).trim(),
        description ? String(description).trim() : null,
        String(video_url).trim(),
        thumbnail_url ? String(thumbnail_url).trim() : null,
        duration_seconds != null ? Number(duration_seconds) : null,
        req.user.id,
        normKind,
        normKind === 'live' ? scheduled_at : null,
      ],
    );

    res.status(201).json({
      message: normKind === 'live' ? 'Live session posted' : 'Video uploaded',
      video: result.rows[0],
    });
  } catch (err) {
    console.error('Create course video error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/course-videos/batch/:id
exports.listByBatch = async (req, res) => {
  try {
    const batchId = Number(req.params.id);

    const auth = await authorizeBatchAccess(req.user.id, req.user.role, batchId);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.error });

    const result = await pool.query(
      `SELECT v.*, u.name AS uploaded_by_name
         FROM course_videos v
         LEFT JOIN users u ON v.uploaded_by = u.id
        WHERE v.batch_id = $1
        ORDER BY v.created_at DESC`,
      [batchId],
    );

    res.json({
      count: result.rows.length,
      videos: result.rows,
    });
  } catch (err) {
    console.error('List course videos error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/course-videos/:id
exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const vidRes = await pool.query(
      'SELECT id, batch_id, uploaded_by FROM course_videos WHERE id = $1',
      [id],
    );
    if (vidRes.rows.length === 0) {
      return res.status(404).json({ message: 'Video not found' });
    }
    const video = vidRes.rows[0];

    // Only the uploader or an admin of the institution can delete.
    if (req.user.role === 'trainer' && video.uploaded_by !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete videos you uploaded' });
    }
    if (req.user.role === 'admin') {
      // Ownership check via batch institution.
      const auth = await authorizeBatchAccess(req.user.id, req.user.role, video.batch_id, { requireWrite: true });
      if (!auth.ok) return res.status(auth.status).json({ message: auth.error });
    }
    if (req.user.role !== 'trainer' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    await pool.query('DELETE FROM course_videos WHERE id = $1', [id]);
    res.json({ message: 'Video deleted' });
  } catch (err) {
    console.error('Delete course video error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
