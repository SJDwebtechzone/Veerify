const pool = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Trainer salaries (payroll)
// ─────────────────────────────────────────────────────────────────────────────
// Endpoints:
//   GET  /api/salaries/me           (trainer)         - own history + summary
//   GET  /api/salaries/me/:id       (trainer)         - single slip (own only)
//   POST /api/salaries              (admin)           - create or upsert a slip
//   PUT  /api/salaries/:id          (admin)           - edit (e.g. correct amounts)
//   POST /api/salaries/:id/mark-paid (admin)          - flip to 'paid' + stamp ref
//   GET  /api/salaries              (admin)           - list for institution

const ALLOWED_STATUS = new Set(['pending', 'paid', 'failed', 'on_hold']);
const ALLOWED_METHODS = new Set(['cash', 'bank', 'upi', 'cheque', 'other']);

function computeNet(base, bonus, deductions) {
  const b = Number(base) || 0;
  const x = Number(bonus) || 0;
  const d = Number(deductions) || 0;
  return Math.round((b + x - d) * 100) / 100;
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function getMyTrainerRow(userId) {
  const r = await pool.query('SELECT id, institution_id FROM trainers WHERE user_id = $1', [userId]);
  return r.rows[0] || null;
}
async function getAdminInstitutionId(userId) {
  const r = await pool.query('SELECT institution_id FROM users WHERE id = $1', [userId]);
  return r.rows[0]?.institution_id || null;
}

// ── Trainer: GET my history + summary ──
exports.getMySalaries = async (req, res) => {
  try {
    const trainer = await getMyTrainerRow(req.user.id);
    if (!trainer) return res.status(403).json({ message: 'Not a trainer' });

    const rows = await pool.query(
      `SELECT * FROM trainer_salaries
        WHERE trainer_id = $1
        ORDER BY period DESC, created_at DESC
        LIMIT 60`,
      [trainer.id],
    );

    // Summary: latest paid month + lifetime totals + outstanding (pending).
    const summary = await pool.query(
      `SELECT
         COUNT(*)                                                    AS slips,
         COUNT(*) FILTER (WHERE status = 'paid')                     AS paid_slips,
         COUNT(*) FILTER (WHERE status = 'pending')                  AS pending_slips,
         COALESCE(SUM(net_amount) FILTER (WHERE status = 'paid'), 0) AS lifetime_paid,
         COALESCE(SUM(net_amount) FILTER (WHERE status = 'pending'), 0) AS outstanding
       FROM trainer_salaries
       WHERE trainer_id = $1`,
      [trainer.id],
    );

    res.json({
      count: rows.rows.length,
      summary: summary.rows[0] || {},
      salaries: rows.rows,
    });
  } catch (err) {
    console.error('Get my salaries error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Trainer: GET single own slip ──
exports.getMySalaryById = async (req, res) => {
  try {
    const trainer = await getMyTrainerRow(req.user.id);
    if (!trainer) return res.status(403).json({ message: 'Not a trainer' });

    const r = await pool.query(
      `SELECT * FROM trainer_salaries WHERE id = $1 AND trainer_id = $2`,
      [req.params.id, trainer.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Slip not found' });
    res.json({ salary: r.rows[0] });
  } catch (err) {
    console.error('Get my salary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Admin: GET institution-wide list ──
exports.listForInstitution = async (req, res) => {
  try {
    const instId = await getAdminInstitutionId(req.user.id);
    if (!instId) return res.status(400).json({ message: 'Not linked to an institution' });

    const { status, period } = req.query;
    const where = ['s.institution_id = $1'];
    const params = [instId];
    if (status && ALLOWED_STATUS.has(status)) {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    }
    if (period) {
      params.push(period);
      where.push(`s.period = $${params.length}`);
    }

    const r = await pool.query(
      `SELECT s.*, u.name AS trainer_name, u.email AS trainer_email
         FROM trainer_salaries s
         JOIN trainers t ON s.trainer_id = t.id
         JOIN users u ON t.user_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY s.period DESC, u.name`,
      params,
    );
    res.json({ count: r.rows.length, salaries: r.rows });
  } catch (err) {
    console.error('List salaries error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Admin: POST create (upserts on (trainer_id, period)) ──
exports.create = async (req, res) => {
  try {
    const instId = await getAdminInstitutionId(req.user.id);
    if (!instId) return res.status(400).json({ message: 'Not linked to an institution' });

    const { trainer_id, period, base_amount = 0, bonus = 0, deductions = 0, status = 'pending', payment_method, payment_reference, paid_at, notes } = req.body || {};
    if (!trainer_id || !period) {
      return res.status(400).json({ message: 'trainer_id and period (YYYY-MM) are required' });
    }
    if (!ALLOWED_STATUS.has(status)) return res.status(400).json({ message: 'Invalid status' });
    if (payment_method && !ALLOWED_METHODS.has(payment_method)) {
      return res.status(400).json({ message: 'Invalid payment_method' });
    }
    // Ensure the trainer belongs to this institution.
    const t = await pool.query('SELECT id, institution_id FROM trainers WHERE id = $1', [trainer_id]);
    if (t.rows.length === 0) return res.status(404).json({ message: 'Trainer not found' });
    if (t.rows[0].institution_id !== instId) {
      return res.status(403).json({ message: 'Trainer is not in your institution' });
    }

    const net = computeNet(base_amount, bonus, deductions);

    const result = await pool.query(
      `INSERT INTO trainer_salaries
         (trainer_id, institution_id, period, base_amount, bonus, deductions, net_amount,
          status, payment_method, payment_reference, paid_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (trainer_id, period) DO UPDATE SET
         base_amount       = EXCLUDED.base_amount,
         bonus             = EXCLUDED.bonus,
         deductions        = EXCLUDED.deductions,
         net_amount        = EXCLUDED.net_amount,
         status            = EXCLUDED.status,
         payment_method    = EXCLUDED.payment_method,
         payment_reference = EXCLUDED.payment_reference,
         paid_at           = EXCLUDED.paid_at,
         notes             = EXCLUDED.notes,
         updated_at        = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        trainer_id, instId, period, base_amount, bonus, deductions, net,
        status, payment_method || null, payment_reference || null,
        paid_at || null, notes || null, req.user.id,
      ],
    );

    res.status(201).json({ message: 'Salary slip saved', salary: result.rows[0] });
  } catch (err) {
    console.error('Create salary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Admin: PUT update ──
exports.update = async (req, res) => {
  try {
    const instId = await getAdminInstitutionId(req.user.id);
    if (!instId) return res.status(400).json({ message: 'Not linked to an institution' });

    const { id } = req.params;
    const body = req.body || {};

    // Auth + load current to recompute net.
    const cur = await pool.query('SELECT * FROM trainer_salaries WHERE id = $1', [id]);
    if (cur.rows.length === 0) return res.status(404).json({ message: 'Slip not found' });
    if (cur.rows[0].institution_id !== instId) {
      return res.status(403).json({ message: 'Not your institution\'s slip' });
    }

    const base = body.base_amount !== undefined ? Number(body.base_amount) : Number(cur.rows[0].base_amount);
    const bon  = body.bonus       !== undefined ? Number(body.bonus)       : Number(cur.rows[0].bonus);
    const ded  = body.deductions  !== undefined ? Number(body.deductions)  : Number(cur.rows[0].deductions);
    const net  = computeNet(base, bon, ded);

    const status = body.status && ALLOWED_STATUS.has(body.status) ? body.status : cur.rows[0].status;
    const method = body.payment_method && ALLOWED_METHODS.has(body.payment_method) ? body.payment_method : cur.rows[0].payment_method;

    const r = await pool.query(
      `UPDATE trainer_salaries SET
         base_amount       = $1,
         bonus             = $2,
         deductions        = $3,
         net_amount        = $4,
         status            = $5,
         payment_method    = $6,
         payment_reference = COALESCE($7, payment_reference),
         paid_at           = COALESCE($8::timestamp, paid_at),
         notes             = COALESCE($9, notes),
         updated_at        = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [base, bon, ded, net, status, method,
       body.payment_reference || null,
       body.paid_at || null,
       body.notes || null,
       id],
    );
    res.json({ message: 'Slip updated', salary: r.rows[0] });
  } catch (err) {
    console.error('Update salary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── Admin: POST mark-paid ──
exports.markPaid = async (req, res) => {
  try {
    const instId = await getAdminInstitutionId(req.user.id);
    if (!instId) return res.status(400).json({ message: 'Not linked to an institution' });

    const { id } = req.params;
    const { payment_method, payment_reference } = req.body || {};
    if (payment_method && !ALLOWED_METHODS.has(payment_method)) {
      return res.status(400).json({ message: 'Invalid payment_method' });
    }

    const cur = await pool.query('SELECT institution_id FROM trainer_salaries WHERE id = $1', [id]);
    if (cur.rows.length === 0) return res.status(404).json({ message: 'Slip not found' });
    if (cur.rows[0].institution_id !== instId) {
      return res.status(403).json({ message: 'Not your institution\'s slip' });
    }

    const r = await pool.query(
      `UPDATE trainer_salaries SET
         status            = 'paid',
         paid_at           = COALESCE(paid_at, NOW()),
         payment_method    = COALESCE($1, payment_method),
         payment_reference = COALESCE($2, payment_reference),
         updated_at        = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [payment_method || null, payment_reference || null, id],
    );
    res.json({ message: 'Marked paid', salary: r.rows[0] });
  } catch (err) {
    console.error('Mark paid error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
