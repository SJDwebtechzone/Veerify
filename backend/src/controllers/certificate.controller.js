const pool = require('../config/db');
// Branch-scoped access check — main admin can only see students
// enrolled in main-institution batches; sub-branch admins only see
// students enrolled in their own branch's batches.
const { getBranchScope, adminCanSeeStudent } = require('../utils/branchScope');

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
    // Tokens are minted by sendCertificate via `crypto.randomBytes(12)
    // .toString('hex')` — lowercase hex. Uppercasing here (which the
    // previous version did) guaranteed the lookup missed EVERY new
    // certificate. Match case-insensitively so both a QR scan and a
    // hand-typed uppercase link resolve to the same row.
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ message: 'Token required' });

    // Pull the promotion linkage alongside the certificate so the
    // verify page can prove this artefact was minted from a real
    // promotion_request (not manually inserted). The LEFT JOIN keeps
    // legacy / non-belt certificates working: they simply come back
    // with null promotion fields.
    //
    // The extended query depends on:
    //   • certificates.promotion_request_id  (migration 094)
    //   • belt_promotion_requests table      (migration 085)
    //   • belt_promotion_requests.curriculum_item_id (migration 093)
    // Environments that haven't run one of those migrations yet would
    // 42703 the whole query and turn every /verify into a "not
    // found". To survive that, we run the enriched query first and
    // silently fall back to a plain certificate-only lookup if any
    // referenced column is missing.
    async function runEnriched() {
      return pool.query(
        `SELECT c.id, c.kind, c.title, c.issue_date, c.certificate_no,
                c.status, c.instructor_name,
                c.promotion_request_id,
                u.name AS student_name,
                i.name AS institution_name,
                r.id                  AS promo_id,
                r.status              AS promo_status,
                r.current_belt        AS promo_from_belt,
                r.requested_belt      AS promo_to_belt,
                r.curriculum_item_id  AS promo_curriculum_item_id,
                r.resolved_at         AS promo_approved_at
           FROM certificates c
           JOIN users u ON c.student_id = u.id
           JOIN institutions i ON c.institution_id = i.id
           LEFT JOIN belt_promotion_requests r ON r.id = c.promotion_request_id
          WHERE LOWER(c.qr_token) = LOWER($1)
          LIMIT 1`,
        [token],
      );
    }
    async function runBasic() {
      return pool.query(
        `SELECT c.id, c.kind, c.title, c.issue_date, c.certificate_no,
                c.status, c.instructor_name,
                u.name AS student_name,
                i.name AS institution_name
           FROM certificates c
           JOIN users u ON c.student_id = u.id
           JOIN institutions i ON c.institution_id = i.id
          WHERE LOWER(c.qr_token) = LOWER($1)
          LIMIT 1`,
        [token],
      );
    }

    let r;
    try {
      r = await runEnriched();
    } catch (enrichedErr) {
      // 42703 = undefined_column; 42P01 = undefined_table. Anything
      // else is a real fault the outer catch should surface.
      if (enrichedErr?.code === '42703' || enrichedErr?.code === '42P01') {
        console.warn('[verify] enriched query fell back to basic:', enrichedErr.message);
        r = await runBasic();
      } else {
        throw enrichedErr;
      }
    }
    if (r.rows.length === 0) {
      return res.status(404).json({
        valid: false,
        message: 'Certificate not found. The link may be invalid.',
      });
    }
    const c = r.rows[0];
    // Belt-typed certificates carry a promotion block; other kinds
    // stay flat so existing clients don't have to branch.
    const promotion = c.kind === 'belt' && c.promotion_request_id
      ? {
          id:                  c.promo_id,
          status:              c.promo_status,
          from_belt:           c.promo_from_belt,
          to_belt:             c.promo_to_belt,
          curriculum_item_id:  c.promo_curriculum_item_id,
          approved_at:         c.promo_approved_at,
        }
      : null;
    res.json({
      valid: c.status === 'verified',
      certificate: {
        id:                   c.id,
        kind:                 c.kind,
        title:                c.title,
        issue_date:           c.issue_date,
        certificate_no:       c.certificate_no,
        status:               c.status,
        instructor_name:      c.instructor_name,
        student_name:         c.student_name,
        institution_name:     c.institution_name,
        promotion_request_id: c.promotion_request_id,
      },
      promotion,
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── List: student's own ────────────────────────────────────────────────────
exports.listMy = async (req, res) => {
  try {
    // Issued certificates (real rows) + pending awaits so the student's
    // Certificates screen can show BOTH sections in one round-trip.
    const [certs, awaits] = await Promise.all([
      // Pull the template's artwork alongside each certificate so the
      // student's viewer renders the exact layout the admin dispatched
      // — background image, canvas ratio, and signature / seal URLs so
      // image-backed pins can resolve without another round-trip.
      pool.query(
        `SELECT c.*, i.name AS institution_name,
                t.name             AS template_name,
                t.background_url   AS template_background_url,
                t.background_kind  AS template_background_kind,
                t.canvas_width     AS template_canvas_width,
                t.canvas_height    AS template_canvas_height,
                t.signature_url    AS template_signature_url,
                t.seal_url         AS template_seal_url
           FROM certificates c
           JOIN institutions i ON c.institution_id = i.id
           LEFT JOIN certificate_templates t ON t.id = c.template_id
          WHERE c.student_id = $1
          ORDER BY c.issue_date DESC, c.id DESC`,
        [req.user.id],
      ),
      // Course completions that haven't been dispatched yet. We show
      // these under an "Awaiting Certificate" section on the student's
      // screen so the state is transparent to them.
      pool.query(
        `SELECT
           cc.id, cc.status,
           cc.course_completed_at, cc.belt_test_completed_at,
           co.name AS course_name,
           i.name  AS institution_name
         FROM course_completions cc
         JOIN courses co ON co.id = cc.course_id
         LEFT JOIN institutions i ON i.id = cc.institution_id
        WHERE cc.student_id = $1
          AND cc.status <> 'certificate_sent'
        ORDER BY cc.course_completed_at DESC`,
        [req.user.id],
      ).catch(() => ({ rows: [] })),
    ]);
    res.json({
      count:        certs.rows.length,
      certificates: certs.rows,
      awaiting:     awaits.rows,
    });
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
    // Permission: admin whose branch scope includes this student. A main
    // admin can only see students enrolled in main-institution batches;
    // sub-branch admins only see their own branch's students.
    if (role === 'admin') {
      const scope = await getBranchScope(req.user.id);
      const canSee = await adminCanSeeStudent(pool, scope, studentId);
      if (!canSee) {
        // Fallback: allow when the student is directly registered under
        // the admin's institution (edge case: no enrollments yet).
        const sRow = await pool.query(`SELECT institution_id FROM users WHERE id = $1`, [studentId]);
        if (!scope || sRow.rows[0]?.institution_id !== scope.callerInstId) {
          return res.status(403).json({ message: 'Not your student' });
        }
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
      `SELECT c.*, i.name AS institution_name, u.name AS student_name,
              t.name             AS template_name,
              t.background_url   AS template_background_url,
              t.background_kind  AS template_background_kind,
              t.canvas_width     AS template_canvas_width,
              t.canvas_height    AS template_canvas_height,
              t.signature_url    AS template_signature_url,
              t.seal_url         AS template_seal_url
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
         JOIN users u ON c.student_id = u.id
         LEFT JOIN certificate_templates t ON t.id = c.template_id
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

// ── List: every certificate the institution has dispatched ────────────────
// GET /api/certificates/institution
//
// Powers the Admin → More → Certificates → Dispatched Certificates screen.
// Branch-scoped the same way promotion requests are: sub-branch admins
// only see certificates for students in their own branch (via the most
// recent enrollment.batch_id → batches.branch_id); main-institution
// admins see everything under the root plus its branches. Reads are
// LEFT-JOINed to the template so the viewer can render the exact
// artwork the admin dispatched — no separate round-trip needed.
exports.listInstitution = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const scope = await getBranchScope(req.user.id);
    if (!scope) return res.status(403).json({ message: 'No institution linked.' });

    // Institution filter — root institution plus its sub-branches.
    // Mirrors the promotion listInstitution query so admins see a
    // consistent set of students across the two screens.
    const params = [scope.rootId];
    let where = `(
                   c.institution_id = $1
                   OR c.institution_id IN (
                        SELECT id FROM institutions WHERE parent_institution_id = $1
                   )
                 )`;

    // Sub-branch admins are further narrowed to certificates whose
    // owning student's most-recent batch sits under their branch.
    // Main admins see everything under the root (no extra clause).
    if (scope.isSubBranchAdmin) {
      params.push(scope.callerInstId);
      where += ` AND EXISTS (
                   SELECT 1
                     FROM enrollments e
                     JOIN batches b ON b.id = e.batch_id
                    WHERE e.student_id = c.student_id
                      AND b.branch_id  = $${params.length}
                 )`;
    }

    // Optional kind filter (?kind=belt | tournament | completion | achievement).
    const kindFilter = String(req.query?.kind || '').trim().toLowerCase();
    if (['belt', 'tournament', 'completion', 'achievement'].includes(kindFilter)) {
      params.push(kindFilter);
      where += ` AND c.kind = $${params.length}`;
    }

    const r = await pool.query(
      `SELECT c.*,
              u.name             AS student_name,
              i.name             AS institution_name,
              t.name             AS template_name,
              t.background_url   AS template_background_url,
              t.background_kind  AS template_background_kind,
              t.canvas_width     AS template_canvas_width,
              t.canvas_height    AS template_canvas_height,
              t.signature_url    AS template_signature_url,
              t.seal_url         AS template_seal_url
         FROM certificates c
         JOIN users u        ON u.id = c.student_id
         JOIN institutions i ON i.id = c.institution_id
         LEFT JOIN certificate_templates t ON t.id = c.template_id
        WHERE ${where}
        ORDER BY c.issue_date DESC, c.id DESC`,
      params,
    );
    return res.json({ count: r.rows.length, certificates: r.rows });
  } catch (err) {
    console.error('Cert listInstitution error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Fetch one (role-scoped) ────────────────────────────────────────────────
exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT c.*, i.name AS institution_name, u.name AS student_name,
              t.name             AS template_name,
              t.background_url   AS template_background_url,
              t.background_kind  AS template_background_kind,
              t.canvas_width     AS template_canvas_width,
              t.canvas_height    AS template_canvas_height,
              t.signature_url    AS template_signature_url,
              t.seal_url         AS template_seal_url
         FROM certificates c
         JOIN institutions i ON c.institution_id = i.id
         JOIN users u ON c.student_id = u.id
         LEFT JOIN certificate_templates t ON t.id = c.template_id
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
