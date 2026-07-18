const pool = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Institution payouts
// ─────────────────────────────────────────────────────────────────────────────
// The super admin's "Institution Payout" table sums each institution's paid
// enrolment revenue, deducts the marketplace commission (taken from
// marketplace_settings.commission_percent), and shows the remainder as the
// amount to be transferred. When the super admin clicks "Mark Paid" we
// insert a row in institution_payouts, which the institution's own wallet
// view sums to derive its available balance.
//
// All endpoints are super-admin scoped except getMyWallet which is for the
// institution admin (mobile).
// ─────────────────────────────────────────────────────────────────────────────

// Helper: current marketplace commission %. Falls back to 10 if the row
// hasn't been seeded yet.
async function getCommissionPercent() {
  try {
    const r = await pool.query(
      `SELECT commission_percent FROM marketplace_settings WHERE id = 1`,
    );
    const pct = Number(r.rows[0]?.commission_percent);
    return Number.isFinite(pct) ? pct : 10;
  } catch {
    return 10;
  }
}

// ─── SUPER ADMIN: list every institution + its payout state ─────────────────
// Aggregates per institution:
//   gross_purchases  - sum(enrollments.payment_amount where payment_status='paid')
//   commission_amt   - gross * commission_pct / 100
//   to_transfer      - gross - commission_amt (total owed across all time)
//   transferred      - sum(institution_payouts.transfer_amount) where status='paid'
//   pending          - to_transfer - transferred
//   status           - 'paid' if pending <= 0, else 'pending'
exports.list = async (req, res) => {
  try {
    const commissionPct = await getCommissionPercent();

    // Wallet inclusion filter — MUST match the spec exactly:
    //   • payment_status = 'paid'          (successful only; excludes
    //                                       pending / failed /
    //                                       cancelled / refunded)
    //   • revenue_channel = 'wallet'       (direct student purchases
    //                                       via Razorpay + admin-
    //                                       created "Share Payment
    //                                       Link" enrolments; excludes
    //                                       offline sales which are
    //                                       marked 'revenue')
    // A `null` revenue_channel is NEVER included — those are legacy
    // uncategorised rows the platform can't safely settle without
    // manual review. The three places below (super-admin list,
    // super-admin mark-paid, institution wallet snapshot) all share
    // the same filter so the numbers never drift.
    const WALLET_FILTER = `e.payment_status = 'paid' AND e.revenue_channel = 'wallet'`;
    const result = await pool.query(
      `WITH gross AS (
         SELECT i.id            AS institution_id,
                i.name          AS institution_name,
                i.email         AS institution_email,
                i.logo_url      AS institution_logo,
                COALESCE(SUM(e.payment_amount) FILTER (WHERE ${WALLET_FILTER}), 0)::numeric
                                AS gross_purchases,
                COUNT(*) FILTER (WHERE ${WALLET_FILTER}) AS paid_enrollment_count
           FROM institutions i
           LEFT JOIN enrollments e ON e.institution_id = i.id
          WHERE i.deleted_at IS NULL
          GROUP BY i.id, i.name, i.email, i.logo_url
       ),
       transferred AS (
         SELECT institution_id,
                COALESCE(SUM(transfer_amount), 0)::numeric AS transferred_total,
                MAX(paid_at) AS last_paid_at
           FROM institution_payouts
          WHERE status = 'paid'
          GROUP BY institution_id
       )
       SELECT g.institution_id,
              g.institution_name,
              g.institution_email,
              g.institution_logo,
              g.gross_purchases,
              g.paid_enrollment_count,
              COALESCE(t.transferred_total, 0) AS transferred_total,
              COALESCE(t.last_paid_at, NULL)   AS last_paid_at
         FROM gross g
         LEFT JOIN transferred t ON t.institution_id = g.institution_id
        ORDER BY g.gross_purchases DESC, g.institution_name ASC`,
    );

    const rows = result.rows.map((r) => {
      const gross         = Number(r.gross_purchases) || 0;
      const commissionAmt = Math.round((gross * commissionPct) / 100);
      const toTransfer    = gross - commissionAmt;
      const transferred   = Number(r.transferred_total) || 0;
      const pending       = Math.max(0, toTransfer - transferred);
      return {
        institution_id:        r.institution_id,
        institution_name:      r.institution_name,
        institution_email:     r.institution_email,
        institution_logo:      r.institution_logo,
        paid_enrollment_count: Number(r.paid_enrollment_count) || 0,
        gross_purchases:       gross,
        commission_percent:    commissionPct,
        commission_amount:     commissionAmt,
        transfer_amount:       toTransfer,
        transferred_total:     transferred,
        pending_amount:        pending,
        status:                pending > 0 ? 'pending' : (gross > 0 ? 'paid' : 'pending'),
        last_paid_at:          r.last_paid_at,
      };
    });

    res.json({
      commission_percent: commissionPct,
      count: rows.length,
      payouts: rows,
    });
  } catch (err) {
    console.error('Institution payout list error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── SUPER ADMIN: mark the institution's outstanding amount as paid ─────────
// Records a single institution_payouts row equal to the current pending
// amount. After this the institution's wallet shows the new balance.
exports.markPaid = async (req, res) => {
  try {
    const { institution_id } = req.params;
    const { note } = req.body || {};
    const payerId = req.user.id;

    const commissionPct = await getCommissionPercent();

    // Re-aggregate for THIS institution to compute the exact pending
    // amount — avoids races where the list view and the click happen
    // seconds apart and the totals drift.
    //
    // Filter MUST match the one in list() + getMyWallet(): paid AND
    // revenue_channel='wallet'. This is what keeps offline sales out
    // of the settlement flow (they were already collected in cash /
    // UPI / bank — the platform doesn't owe the institution anything
    // for those).
    const grossRow = await pool.query(
      `SELECT COALESCE(SUM(payment_amount) FILTER (
                 WHERE payment_status = 'paid'
                   AND revenue_channel = 'wallet'
               ), 0)::numeric AS gross_purchases
         FROM enrollments
        WHERE institution_id = $1`,
      [institution_id],
    );
    const gross = Number(grossRow.rows[0]?.gross_purchases) || 0;
    if (gross <= 0) {
      return res.status(400).json({
        message: 'This institution has no paid enrolments yet — nothing to pay out.',
      });
    }
    const commissionAmt = Math.round((gross * commissionPct) / 100);
    const toTransfer    = gross - commissionAmt;

    const transferredRow = await pool.query(
      `SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS transferred_total
         FROM institution_payouts
        WHERE institution_id = $1 AND status = 'paid'`,
      [institution_id],
    );
    const transferred = Number(transferredRow.rows[0]?.transferred_total) || 0;
    const pending     = Math.max(0, toTransfer - transferred);

    if (pending <= 0) {
      return res.status(409).json({
        message: 'This institution is already fully paid out.',
      });
    }

    const insert = await pool.query(
      `INSERT INTO institution_payouts
         (institution_id, gross_amount, commission_percent,
          commission_amount, transfer_amount, status, paid_by, note)
       VALUES ($1, $2, $3, $4, $5, 'paid', $6, $7)
       RETURNING *`,
      [
        institution_id,
        gross,
        commissionPct,
        commissionAmt,
        pending,
        payerId,
        note || null,
      ],
    );

    res.json({
      message: 'Payout marked as paid',
      payout: insert.rows[0],
    });
  } catch (err) {
    console.error('Institution payout mark-paid error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── INSTITUTION ADMIN: my wallet snapshot ──────────────────────────────────
// Returns the same numbers the super-admin list shows but scoped to the
// calling admin's institution. Drives the mobile wallet teaser + breakdown.
exports.getMyWallet = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find this admin's institution.
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`,
      [userId],
    );
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) {
      return res.status(404).json({ message: 'You are not linked to an institution.' });
    }

    const commissionPct = await getCommissionPercent();

    // Wallet inclusion filter — MUST match list() + markPaid():
    //   • payment_status = 'paid'
    //   • revenue_channel = 'wallet'  (direct student purchases via
    //     Razorpay + admin-created "Share Payment Link" enrolments)
    // Offline sales (revenue_channel='revenue') and uncategorised
    // legacy rows (revenue_channel IS NULL) never contribute here.
    const grossRow = await pool.query(
      `SELECT COALESCE(SUM(payment_amount) FILTER (
                 WHERE payment_status = 'paid'
                   AND revenue_channel = 'wallet'
               ), 0)::numeric AS gross_purchases,
              COUNT(*) FILTER (
                 WHERE payment_status = 'paid'
                   AND revenue_channel = 'wallet'
               ) AS paid_enrollment_count
         FROM enrollments
        WHERE institution_id = $1`,
      [institutionId],
    );
    const gross = Number(grossRow.rows[0]?.gross_purchases) || 0;
    const commissionAmt = Math.round((gross * commissionPct) / 100);
    const toTransfer    = gross - commissionAmt;

    const transferredRow = await pool.query(
      `SELECT COALESCE(SUM(transfer_amount), 0)::numeric AS transferred_total,
              MAX(paid_at) AS last_paid_at
         FROM institution_payouts
        WHERE institution_id = $1 AND status = 'paid'`,
      [institutionId],
    );
    const transferred = Number(transferredRow.rows[0]?.transferred_total) || 0;
    const pending     = Math.max(0, toTransfer - transferred);

    // Settlement history — every row the super admin has marked paid
    // to this institution. Drives the mobile "Settlement History"
    // list under the wallet card. Returned newest-first so the
    // latest settlement is always on top. Kept as a first-class
    // field of this response so the mobile doesn't need a second
    // round-trip to hydrate the list.
    const historyRes = await pool.query(
      `SELECT id,
              gross_amount,
              commission_percent,
              commission_amount,
              transfer_amount,
              status,
              paid_at,
              note
         FROM institution_payouts
        WHERE institution_id = $1
        ORDER BY paid_at DESC
        LIMIT 100`,
      [institutionId],
    );

    res.json({
      institution_id:        institutionId,
      paid_enrollment_count: Number(grossRow.rows[0]?.paid_enrollment_count) || 0,
      course_purchases:      gross,
      commission_percent:    commissionPct,
      commission_amount:     commissionAmt,
      to_transfer:           toTransfer,
      // wallet_balance is the amount the institution is STILL OWED.
      // When the super admin clicks "Mark Paid" the payout row is
      // inserted, transferred goes up, and this number goes down to
      // zero. (Marketplace convention: the wallet represents pending
      // settlements, not money already received.)
      wallet_balance:        pending,
      paid_out_total:        transferred,
      pending_amount:        pending,
      last_paid_at:          transferredRow.rows[0]?.last_paid_at || null,
      // Full settlement history — every mark-paid event. Each row
      // carries { id, gross_amount, commission_percent, commission_amount,
      // transfer_amount, status, paid_at, note }. Status is 'paid' or
      // 'reversed' (per the institution_payouts CHECK constraint).
      settlement_history:    historyRes.rows.map((r) => ({
        id:                 r.id,
        gross_amount:       Number(r.gross_amount)       || 0,
        commission_percent: Number(r.commission_percent) || 0,
        commission_amount:  Number(r.commission_amount)  || 0,
        transfer_amount:    Number(r.transfer_amount)    || 0,
        amount:             Number(r.transfer_amount)    || 0,  // alias for clarity in UI
        status:             r.status || 'paid',
        paid_at:            r.paid_at,
        date:               r.paid_at,                          // alias
        note:               r.note || null,
      })),
    });
  } catch (err) {
    console.error('Institution wallet error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
