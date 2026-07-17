// backend/src/controllers/invoice.controller.js
//
// Auth-gated invoice endpoints. Streams the PDF from the invoices
// table so a guessed /uploads/... URL never returns someone else's
// invoice — the download route enforces "must be the payer or the
// owning institution admin".
//
// Endpoints:
//   GET /api/invoices/enrollment/:enrollmentId  → student / owning admin
//   GET /api/invoices/subscription/:institutionId → institution admin
//   GET /api/invoices/:id/pdf                   → auth-gated download
//   GET /api/invoices/mine                      → list caller's invoices

const fs   = require('fs');
const path = require('path');
const pool = require('../config/db');

async function getUserInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

// Common access check for an invoice row. Returns true iff the caller
// is one of: the enrolment's student, an admin of the invoice's
// institution, or a super_admin.
async function callerCanReadInvoice(user, invoice) {
  if (user.role === 'super_admin') return true;
  if (invoice.kind === 'enrollment' && invoice.enrollment_id) {
    const r = await pool.query(
      `SELECT student_id, institution_id FROM enrollments WHERE id = $1`,
      [invoice.enrollment_id],
    );
    const row = r.rows[0];
    if (!row) return false;
    if (user.id === row.student_id) return true;
    if (user.role === 'admin') {
      const inst = await getUserInstitutionId(user.id);
      if (inst === row.institution_id) return true;
      // Sub-branch admin whose parent owns the batch's institution.
      const parent = await pool.query(
        `SELECT 1 FROM institutions WHERE id = $1 AND parent_institution_id = $2`,
        [row.institution_id, inst],
      );
      if (parent.rows.length > 0) return true;
    }
  }
  if (invoice.kind === 'subscription' && invoice.institution_id) {
    if (user.role === 'admin') {
      const inst = await getUserInstitutionId(user.id);
      if (inst === invoice.institution_id) return true;
    }
  }
  return false;
}

// GET /api/invoices/enrollment/:enrollmentId
exports.getForEnrollment = async (req, res) => {
  try {
    const enrollmentId = parseInt(req.params.enrollmentId, 10);
    if (!Number.isInteger(enrollmentId)) {
      return res.status(400).json({ message: 'Invalid enrollment id' });
    }
    const r = await pool.query(
      `SELECT * FROM invoices WHERE enrollment_id = $1`,
      [enrollmentId],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'No invoice yet' });
    const invoice = r.rows[0];
    if (!(await callerCanReadInvoice(req.user, invoice))) {
      return res.status(403).json({ message: 'Not your invoice' });
    }
    res.json({ invoice });
  } catch (err) {
    console.error('getForEnrollment error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/invoices/subscription/:institutionId
// Returns the LATEST subscription invoice for the institution.
exports.getForSubscription = async (req, res) => {
  try {
    const institutionId = parseInt(req.params.institutionId, 10);
    if (!Number.isInteger(institutionId)) {
      return res.status(400).json({ message: 'Invalid institution id' });
    }
    const r = await pool.query(
      `SELECT * FROM invoices
        WHERE kind = 'subscription' AND institution_id = $1
        ORDER BY issued_at DESC
        LIMIT 1`,
      [institutionId],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'No invoice yet' });
    const invoice = r.rows[0];
    if (!(await callerCanReadInvoice(req.user, invoice))) {
      return res.status(403).json({ message: 'Not your invoice' });
    }
    res.json({ invoice });
  } catch (err) {
    console.error('getForSubscription error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/invoices/mine
// Every invoice the caller can read. Students get their own; admins
// get every invoice under their institution.
exports.listMine = async (req, res) => {
  try {
    const rows = [];
    if (req.user.role === 'student') {
      const r = await pool.query(
        `SELECT inv.* FROM invoices inv
           JOIN enrollments e ON e.id = inv.enrollment_id
          WHERE e.student_id = $1
          ORDER BY inv.issued_at DESC`,
        [req.user.id],
      );
      rows.push(...r.rows);
    } else if (req.user.role === 'admin') {
      const instId = await getUserInstitutionId(req.user.id);
      if (instId) {
        const r = await pool.query(
          `SELECT * FROM invoices WHERE institution_id = $1
            ORDER BY issued_at DESC`,
          [instId],
        );
        rows.push(...r.rows);
      }
    }
    res.json({ count: rows.length, invoices: rows });
  } catch (err) {
    console.error('listMine error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/invoices/:id/pdf
// Streams the PDF file. Auth-gated via callerCanReadInvoice so a
// guessed /uploads/invoices/VRF-INV-2026-000001.pdf URL from outside
// the app won't leak someone else's invoice.
exports.downloadPdf = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).send('Invalid id');
    const r = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const invoice = r.rows[0];
    if (!(await callerCanReadInvoice(req.user, invoice))) {
      return res.status(403).send('Forbidden');
    }
    const absPath = path.join(__dirname, '..', '..', invoice.pdf_path);
    if (!fs.existsSync(absPath)) {
      return res.status(410).send('Invoice PDF missing on server');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${invoice.number}.pdf"`,
    );
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    console.error('downloadPdf error:', err);
    res.status(500).send('Server error');
  }
};
