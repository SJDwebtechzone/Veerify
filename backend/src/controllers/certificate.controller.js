const pool = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Certificates
// ─────────────────────────────────────────────────────────────────────────────
// The belt promote flow auto-inserts a 'belt' certificate. Other kinds
// (tournament / completion / achievement) can be inserted directly by an
// admin or trainer via POST /certificates.
//
// Public:  GET /certificates/verify/:token  — no auth, returns just enough
//          info to confirm a certificate is real.
// Private: GET /certificates/my  — student/parent scope.
//          GET /certificates/student/:id — staff/admin scope.
//          GET /certificates/:id — fetch by id (role-checked).
// ─────────────────────────────────────────────────────────────────────────────

async function getInstitutionId(userId) {
  const u = await pool.query(`SELECT institution_id FROM users WHERE id = $1`, [userId]);
  return u.rows[0]?.institution_id || null;
}

// ── PUBLIC verify ──────────────────────────────────────────────────────────
// GET /api/certificates/verify/:token  (no auth)
exports.verify = async (req, res) => {
  try {
    const token = String(req.params.token || '').trim().toUpperCase();
    if (!token) return res.status(400).json({ message: 'Token required' });

    const r = await pool.query(
      `SELECT c.id, c.kind, c.title, c.issue_date, c.certificate_no,
              c.status, c.instructor_name,
              u.name AS student_name,
              i.name AS institution_name
         FROM certificates c
         JOIN users u ON c.student_id = u.id
         JOIN institutions i ON c.institution_id = i.id
        WHERE c.qr_token = $1
        LIMIT 1`,
      [token],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({
        valid: false,
        message: 'Certificate not found. The link may be invalid.',
      });
    }
    const c = r.rows[0];
    res.json({
      valid: c.status === 'verified',
      certificate: c,
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── List: student's own ────────────────────────────────────────────────────
exports.listMy = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*, i.name AS institution_name
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
        WHERE c.student_id = $1
        ORDER BY c.issue_date DESC, c.id DESC`,
      [req.user.id],
    );
    res.json({ count: r.rows.length, certificates: r.rows });
  } catch (err) {
    console.error('Cert listMy error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── List for a specific student (staff / admin / linked parent) ────────────
exports.listForStudent = async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);
    const role = req.user.role;

    // Permission: student themselves
    if (role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    // Permission: parent linked
    if (role === 'parent') {
      const link = await pool.query(
        `SELECT 1 FROM parent_child_links
          WHERE parent_id = $1 AND child_id = $2 AND status = 'active' LIMIT 1`,
        [req.user.id, studentId],
      );
      if (link.rows.length === 0) return res.status(403).json({ message: 'Access denied' });
    }
    // Permission: admin in same institution
    if (role === 'admin') {
      const sRow = await pool.query(`SELECT institution_id FROM users WHERE id = $1`, [studentId]);
      const my = await getInstitutionId(req.user.id);
      if (sRow.rows[0]?.institution_id !== my) {
        return res.status(403).json({ message: 'Not your student' });
      }
    }
    // Permission: trainer in any of student's batches
    if (role === 'trainer') {
      const ok = await pool.query(
        `SELECT 1 FROM trainers t
           JOIN batches b ON b.trainer_id = t.id
           JOIN enrollments e ON e.batch_id = b.id
          WHERE t.user_id = $1 AND e.student_id = $2 LIMIT 1`,
        [req.user.id, studentId],
      );
      if (ok.rows.length === 0) return res.status(403).json({ message: 'Not in your batches' });
    }

    const r = await pool.query(
      `SELECT c.*, i.name AS institution_name, u.name AS student_name
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
         JOIN users u ON c.student_id = u.id
        WHERE c.student_id = $1
        ORDER BY c.issue_date DESC, c.id DESC`,
      [studentId],
    );
    res.json({ count: r.rows.length, certificates: r.rows });
  } catch (err) {
    console.error('Cert listForStudent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Fetch one (role-scoped) ────────────────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT c.*, i.name AS institution_name, u.name AS student_name
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
         JOIN users u ON c.student_id = u.id
        WHERE c.id = $1`,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const cert = r.rows[0];

    // Reuse the listForStudent permission logic by faking params + role check.
    const role = req.user.role;
    if (role === 'student' && cert.student_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (role === 'parent') {
      const link = await pool.query(
        `SELECT 1 FROM parent_child_links
          WHERE parent_id = $1 AND child_id = $2 AND status = 'active' LIMIT 1`,
        [req.user.id, cert.student_id],
      );
      if (link.rows.length === 0) return res.status(403).json({ message: 'Access denied' });
    }
    if (role === 'admin') {
      const my = await getInstitutionId(req.user.id);
      if (my !== cert.institution_id) return res.status(403).json({ message: 'Not your institution' });
    }
    if (role === 'trainer') {
      const ok = await pool.query(
        `SELECT 1 FROM trainers t
           JOIN batches b ON b.trainer_id = t.id
           JOIN enrollments e ON e.batch_id = b.id
          WHERE t.user_id = $1 AND e.student_id = $2 LIMIT 1`,
        [req.user.id, cert.student_id],
      );
      if (ok.rows.length === 0) return res.status(403).json({ message: 'Not in your batches' });
    }
    res.json({ certificate: cert });
  } catch (err) {
    console.error('Cert getById error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
