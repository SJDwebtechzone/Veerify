// src/controllers/eventInterest.controller.js
//
// Backs the "Are you interested to participate?" question on the
// student-facing Event Details screen.
//
// Endpoints (mounted under /api by the route file):
//   GET  /events/:eventId/my-interest
//     → { interested: true|false, updated_at | null }
//     The current student's own answer for this event. 404 → never
//     answered → treated as { interested: null } on the client.
//   PUT  /events/:eventId/my-interest
//     body: { interested: boolean }
//     Upserts the (event_id, student_id) row. Only students may
//     write; admins/trainers/parents get 403.
//
// The institution's Select Students screen joins event_interests
// via /events/:eventId/eligible-students and rows that carry
// interested=true render highlighted.

const pool = require('../config/db');

// Read the student's own answer for the given event. Missing row
// resolves to `interested = null` so the client can render the
// question in its neutral "unanswered" state.
exports.getMyInterest = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const userId = req.user.id;
    const r = await pool.query(
      `SELECT interested, updated_at
         FROM event_interests
        WHERE event_id = $1 AND student_id = $2`,
      [eventId, userId],
    );
    if (r.rowCount === 0) {
      return res.json({ interested: null, updated_at: null });
    }
    res.json({
      interested: !!r.rows[0].interested,
      updated_at: r.rows[0].updated_at,
    });
  } catch (err) {
    console.error('getMyInterest error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Upsert the current student's answer. Boolean only — anything
// else is coerced and rejected so a bad payload can't sneak an
// unexpected value into the DB.
exports.setMyInterest = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    if (String(req.user.role || '').toLowerCase() !== 'student') {
      return res.status(403).json({ message: 'Only students can express interest.' });
    }
    const { interested } = req.body || {};
    if (typeof interested !== 'boolean') {
      return res.status(400).json({ message: '`interested` must be a boolean.' });
    }
    const userId = req.user.id;
    // Verify event exists (and isn't soft-deleted) so we don't
    // insert dangling rows if the frontend cached a stale event id.
    const evt = await pool.query(
      `SELECT id FROM mobile_events WHERE id = $1`,
      [eventId],
    );
    if (evt.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found.' });
    }
    const upsert = await pool.query(
      `INSERT INTO event_interests (event_id, student_id, interested)
         VALUES ($1, $2, $3)
       ON CONFLICT (event_id, student_id) DO UPDATE
         SET interested = EXCLUDED.interested,
             updated_at = NOW()
       RETURNING interested, updated_at`,
      [eventId, userId, interested],
    );
    res.json({
      ok:         true,
      interested: !!upsert.rows[0].interested,
      updated_at: upsert.rows[0].updated_at,
    });
  } catch (err) {
    console.error('setMyInterest error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
