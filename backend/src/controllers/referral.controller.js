const pool = require('../config/db');
const { insertNotification } = require('./notification.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Refer & Earn (migration 026)
// ─────────────────────────────────────────────────────────────────────────────
// Only institution admins (role='admin' with a linked institution) interact
// with this module. Super admin can read settings and toggle defaults.
//
// Lifecycle for a referral:
//   1. Institution A asks for their code (auto-generated on first call).
//   2. Institution B registers and pastes the code into POST /referrals/apply.
//      We set institutions.referred_by_institution_id and insert a row into
//      `referrals` with status='pending'.
//   3. When B's subscription is first paid (paid_at flips from NULL to a
//      timestamp), creditReferralReward(B.id) is invoked — see
//      onboarding.controller.js for the call sites. It promotes the referral
//      to 'credited', writes a ledger row, and bumps A's wallet.
//   4. When A renews their subscription, applyReferralDiscount() takes points
//      from the wallet up to the per-renewal cap (referral_settings.max_pct).
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ────────────────────────────────────────────────────────────────

async function getSettings(client = pool) {
  const r = await client.query(`SELECT * FROM referral_settings WHERE id = 1`);
  return r.rows[0] || {
    // 1 referral = 250 points + 250 rupees deduction. Since rupees_per_point
    // is 1, the 250 points double as ₹250 worth of discount.
    points_per_referral: 250,
    rupees_per_point: 1,
    // 100% max discount lets the entire accumulated wallet apply to the
    // next subscription. If product wants a cap, set this lower.
    max_discount_pct: 100,
    points_expiry_days: 180,
    auto_approve: true,
  };
}

async function getAdminInstitution(userId) {
  const u = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`, [userId],
  );
  return u.rows[0]?.institution_id || null;
}

// Idempotent: if the institution doesn't have a referral_code yet, generate
// one and persist it. Returns the (now-guaranteed-non-null) code.
async function ensureReferralCode(institutionId, client = pool) {
  const r = await client.query(
    `SELECT id, name, referral_code FROM institutions WHERE id = $1`, [institutionId],
  );
  if (r.rows.length === 0) throw new Error('institution not found');
  if (r.rows[0].referral_code) return r.rows[0].referral_code;

  // Generate something like VEER-XX12AB. Loop until UNIQUE accepts it; in
  // practice one iteration is enough at 36^6 combinations.
  for (let i = 0; i < 8; i++) {
    const code = `VEER-${randomChunk(6)}`;
    try {
      const ins = await client.query(
        `UPDATE institutions SET referral_code = $1
          WHERE id = $2 AND referral_code IS NULL
        RETURNING referral_code`,
        [code, institutionId],
      );
      if (ins.rows.length > 0) return ins.rows[0].referral_code;
      // Another writer beat us — refetch.
      const re = await client.query(
        `SELECT referral_code FROM institutions WHERE id = $1`, [institutionId],
      );
      if (re.rows[0]?.referral_code) return re.rows[0].referral_code;
    } catch (err) {
      if (err.code !== '23505') throw err; // 23505 = unique violation, retry
    }
  }
  throw new Error('could not allocate a unique referral code');
}

function randomChunk(n) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip 0/O/1/I for legibility
  let out = '';
  for (let i = 0; i < n; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Ensure a wallet row exists for an institution.
async function ensureWallet(institutionId, client = pool) {
  await client.query(
    `INSERT INTO referral_wallets (institution_id)
     VALUES ($1)
     ON CONFLICT (institution_id) DO NOTHING`,
    [institutionId],
  );
}

// ── PUBLIC: institution admin endpoints ────────────────────────────────────

// GET /api/referrals/me
// One-shot screen payload — code, wallet, summary stats, next-renewal preview.
exports.getMe = async (req, res) => {
  try {
    const institutionId = await getAdminInstitution(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked' });
    }
    await ensureWallet(institutionId);
    const code = await ensureReferralCode(institutionId);

    const [settingsRes, walletRes, refSummary, instRes] = await Promise.all([
      pool.query(`SELECT * FROM referral_settings WHERE id = 1`),
      pool.query(`SELECT * FROM referral_wallets WHERE institution_id = $1`, [institutionId]),
      pool.query(
        `SELECT
           COUNT(*)::int                                              AS total_referrals,
           COUNT(*) FILTER (WHERE status = 'pending')::int            AS pending_count,
           COUNT(*) FILTER (WHERE status = 'credited')::int           AS credited_count,
           COALESCE(SUM(reward_points) FILTER (WHERE status = 'credited'), 0)::int AS lifetime_points
           FROM referrals
          WHERE referrer_institution_id = $1`,
        [institutionId],
      ),
      pool.query(
        `SELECT i.id, i.name, sp.price AS plan_price
           FROM institutions i
           LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
          WHERE i.id = $1`,
        [institutionId],
      ),
    ]);

    const settings = settingsRes.rows[0] || {};
    const wallet   = walletRes.rows[0] || { points_balance: 0, total_earned: 0, total_used: 0 };
    const summary  = refSummary.rows[0];
    const planPrice = Number(instRes.rows[0]?.plan_price) || 0;

    // Compute discount preview for the next renewal.
    const rupeesPerPoint = Number(settings.rupees_per_point) || 1;
    const maxPct         = Number(settings.max_discount_pct) || 50;
    const balancePoints  = Number(wallet.points_balance) || 0;
    const balanceRupees  = Math.floor(balancePoints * rupeesPerPoint);
    const maxDiscount    = Math.floor((planPrice * maxPct) / 100);
    const applicable     = Math.min(balanceRupees, maxDiscount);

    res.json({
      institution_id:   institutionId,
      referral_code:    code,
      wallet:           wallet,
      settings:         settings,
      summary: {
        total_referrals:  summary.total_referrals,
        pending_count:    summary.pending_count,
        credited_count:   summary.credited_count,
        lifetime_points:  summary.lifetime_points,
        available_discount_rupees: balanceRupees,
      },
      next_renewal: {
        plan_price:        planPrice,
        referral_discount: applicable,
        final_payable:     Math.max(0, planPrice - applicable),
      },
    });
  } catch (err) {
    console.error('Referral getMe error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/referrals/regenerate-code (kept simple — rotates the code)
exports.regenerateCode = async (req, res) => {
  try {
    const institutionId = await getAdminInstitution(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    await pool.query(
      `UPDATE institutions SET referral_code = NULL WHERE id = $1`,
      [institutionId],
    );
    const code = await ensureReferralCode(institutionId);
    res.json({ referral_code: code });
  } catch (err) {
    console.error('Referral regenerate error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/referrals/apply  { code }
// Called by the REFERRED institution's admin (typically during onboarding,
// or any time before they pay their first subscription). Side effects:
//   - sets institutions.referred_by_institution_id
//   - inserts a 'pending' row in referrals
// Idempotent — a second call returns the existing referral if any.
exports.apply = async (req, res) => {
  try {
    const myInstitutionId = await getAdminInstitution(req.user.id);
    if (!myInstitutionId) return res.status(403).json({ message: 'No institution linked' });

    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ message: 'Referral code is required' });

    // Resolve the referrer.
    const ref = await pool.query(
      `SELECT id FROM institutions
        WHERE referral_code = $1 AND deleted_at IS NULL`,
      [code],
    );
    if (ref.rows.length === 0) {
      return res.status(404).json({ message: 'Invalid referral code' });
    }
    const referrerId = ref.rows[0].id;

    // Anti-abuse: self-referral and duplicate referrals (already-paid).
    if (referrerId === myInstitutionId) {
      return res.status(400).json({ message: 'You cannot refer yourself.' });
    }
    const me = await pool.query(
      `SELECT paid_at, referred_by_institution_id FROM institutions WHERE id = $1`,
      [myInstitutionId],
    );
    if (me.rows[0]?.paid_at) {
      return res.status(409).json({
        message: 'Referral codes can only be applied before your first subscription payment.',
      });
    }
    if (me.rows[0]?.referred_by_institution_id) {
      return res.status(409).json({
        message: 'A referral code has already been applied to this account.',
      });
    }

    // Persist.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE institutions SET referred_by_institution_id = $1 WHERE id = $2`,
        [referrerId, myInstitutionId],
      );
      const settings = await getSettings(client);
      await client.query(
        `INSERT INTO referrals
           (referrer_institution_id, referred_institution_id, referral_code, status, reward_points)
         VALUES ($1, $2, $3, 'pending', $4)
         ON CONFLICT (referred_institution_id) DO NOTHING`,
        [referrerId, myInstitutionId, code, settings.points_per_referral],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Notify the referrer that they got a pending referral.
    try {
      const u = await pool.query(
        `SELECT owner_user_id, name FROM institutions WHERE id = $1`, [myInstitutionId],
      );
      const referrerOwner = await pool.query(
        `SELECT owner_user_id FROM institutions WHERE id = $1`, [referrerId],
      );
      const ownerId = referrerOwner.rows[0]?.owner_user_id;
      if (ownerId) {
        await insertNotification({
          user_id:        ownerId,
          institution_id: referrerId,
          category:       'system',
          title:          'New referral registered',
          message:        `${u.rows[0]?.name || 'A new institution'} signed up with your referral code. You'll earn points once they pay their first subscription.`,
          data:           { screen: 'AdminReferEarn' },
        });
      }
    } catch (err) {
      console.warn('[referral.apply] notify failed:', err.message);
    }

    res.json({ message: 'Referral code applied. You\'ll see the discount on your sponsor\'s next renewal.' });
  } catch (err) {
    console.error('Referral apply error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/referrals/history — referrals this institution made.
exports.history = async (req, res) => {
  try {
    const institutionId = await getAdminInstitution(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const result = await pool.query(
      `SELECT r.*,
              i.name      AS referred_name,
              i.logo_url  AS referred_logo,
              i.paid_at   AS referred_paid_at,
              i.created_at AS referred_signed_up_at
         FROM referrals r
         JOIN institutions i ON r.referred_institution_id = i.id
        WHERE r.referrer_institution_id = $1
        ORDER BY r.created_at DESC`,
      [institutionId],
    );
    res.json({ count: result.rows.length, referrals: result.rows });
  } catch (err) {
    console.error('Referral history error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/referrals/transactions — full ledger.
exports.transactions = async (req, res) => {
  try {
    const institutionId = await getAdminInstitution(req.user.id);
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const result = await pool.query(
      `SELECT * FROM referral_transactions
        WHERE institution_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [institutionId],
    );
    res.json({ count: result.rows.length, transactions: result.rows });
  } catch (err) {
    console.error('Referral transactions error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/referrals/settings — public read (institution admin sees defaults).
exports.getSettings = async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ settings: s });
  } catch (err) {
    console.error('Referral settings error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/referrals/settings — super-admin only.
// Single row at id=1. All five fields are optional in the payload (PATCH-
// style); we validate before writing.
exports.updateSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const has  = (k) => Object.prototype.hasOwnProperty.call(body, k);

    const ppr   = has('points_per_referral') ? parseInt(body.points_per_referral, 10) : null;
    const rpp   = has('rupees_per_point')    ? parseFloat(body.rupees_per_point)      : null;
    const maxP  = has('max_discount_pct')    ? parseInt(body.max_discount_pct, 10)    : null;
    const exp   = has('points_expiry_days')  ? parseInt(body.points_expiry_days, 10)  : null;
    const auto  = has('auto_approve')        ? !!body.auto_approve                    : null;

    if (ppr  !== null && (isNaN(ppr) || ppr < 0))   return res.status(400).json({ message: 'points_per_referral must be a non-negative integer' });
    if (rpp  !== null && (isNaN(rpp) || rpp < 0))   return res.status(400).json({ message: 'rupees_per_point must be a non-negative number' });
    if (maxP !== null && (isNaN(maxP) || maxP < 0 || maxP > 100)) return res.status(400).json({ message: 'max_discount_pct must be between 0 and 100' });
    if (exp  !== null && (isNaN(exp) || exp < 1))   return res.status(400).json({ message: 'points_expiry_days must be at least 1 day' });

    const updated = await pool.query(
      `UPDATE referral_settings SET
         points_per_referral = COALESCE($1, points_per_referral),
         rupees_per_point    = COALESCE($2, rupees_per_point),
         max_discount_pct    = COALESCE($3, max_discount_pct),
         points_expiry_days  = COALESCE($4, points_expiry_days),
         auto_approve        = COALESCE($5, auto_approve),
         updated_at          = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [ppr, rpp, maxP, exp, auto],
    );
    res.json({ message: 'Settings updated', settings: updated.rows[0] });
  } catch (err) {
    console.error('Referral settings update error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/referrals/admin/stats — platform-wide analytics for the super
// admin Referral Settings page. Returns totals + top referrers.
exports.adminStats = async (_req, res) => {
  try {
    const [counts, wallets, top, recent] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int                                              AS total_referrals,
           COUNT(*) FILTER (WHERE status = 'pending')::int            AS pending,
           COUNT(*) FILTER (WHERE status = 'credited')::int           AS credited,
           COUNT(*) FILTER (WHERE status = 'expired')::int            AS expired,
           COALESCE(SUM(reward_points) FILTER (WHERE status = 'credited'), 0)::int AS lifetime_points
           FROM referrals`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::int                          AS total_wallets,
           COALESCE(SUM(points_balance), 0)::int AS total_outstanding_points,
           COALESCE(SUM(total_earned), 0)::int   AS total_earned,
           COALESCE(SUM(total_used),   0)::int   AS total_used
           FROM referral_wallets`,
      ),
      pool.query(
        `SELECT i.id, i.name,
                COUNT(r.id) FILTER (WHERE r.status = 'credited')::int AS credited_count,
                COALESCE(SUM(r.reward_points) FILTER (WHERE r.status = 'credited'), 0)::int AS points_earned
           FROM institutions i
           LEFT JOIN referrals r ON r.referrer_institution_id = i.id
          WHERE i.deleted_at IS NULL
          GROUP BY i.id, i.name
          HAVING COUNT(r.id) > 0
          ORDER BY credited_count DESC, points_earned DESC
          LIMIT 5`,
      ),
      pool.query(
        `SELECT r.*,
                rfr.name AS referrer_name,
                rfd.name AS referred_name
           FROM referrals r
           JOIN institutions rfr ON r.referrer_institution_id = rfr.id
           JOIN institutions rfd ON r.referred_institution_id = rfd.id
          ORDER BY r.created_at DESC
          LIMIT 20`,
      ),
    ]);

    res.json({
      counts:   counts.rows[0],
      wallets:  wallets.rows[0],
      top_referrers: top.rows,
      recent_referrals: recent.rows,
    });
  } catch (err) {
    console.error('Referral admin stats error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── INTERNAL helpers exported for cross-controller use ─────────────────────

// Promote a 'pending' referral to 'credited' and credit the referrer's wallet.
// Called from onboarding flows when a referred institution's paid_at flips
// from NULL → a value. Idempotent: if already credited, no-ops.
async function creditReferralReward(referredInstitutionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(
      `SELECT * FROM referrals
        WHERE referred_institution_id = $1
          AND status = 'pending'
        FOR UPDATE`,
      [referredInstitutionId],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return { credited: false, reason: 'no pending referral' };
    }
    const referral = r.rows[0];
    const settings = await getSettings(client);
    const points = Number(referral.reward_points) || settings.points_per_referral;

    await ensureWallet(referral.referrer_institution_id, client);

    // Wallet bump
    await client.query(
      `UPDATE referral_wallets
          SET points_balance = points_balance + $1,
              total_earned   = total_earned   + $1,
              updated_at     = CURRENT_TIMESTAMP
        WHERE institution_id = $2`,
      [points, referral.referrer_institution_id],
    );

    // Ledger
    const ref2 = await client.query(
      `SELECT name FROM institutions WHERE id = $1`,
      [referredInstitutionId],
    );
    const referredName = ref2.rows[0]?.name || 'a new institution';
    await client.query(
      `INSERT INTO referral_transactions
         (institution_id, type, points, description, reference_id, expires_at)
       VALUES ($1, 'earned', $2, $3, $4,
               NOW() + ($5 || ' days')::interval)`,
      [
        referral.referrer_institution_id,
        points,
        `Referral completed — ${referredName}`,
        referral.id,
        settings.points_expiry_days,
      ],
    );

    // Status
    await client.query(
      `UPDATE referrals
          SET status = 'credited',
              rewarded_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [referral.id],
    );

    await client.query('COMMIT');

    // Notify referrer (best effort, outside the tx).
    try {
      const owner = await pool.query(
        `SELECT owner_user_id FROM institutions WHERE id = $1`,
        [referral.referrer_institution_id],
      );
      const ownerId = owner.rows[0]?.owner_user_id;
      if (ownerId) {
        await insertNotification({
          user_id:        ownerId,
          institution_id: referral.referrer_institution_id,
          category:       'system',
          title:          'Referral reward credited 🎉',
          message:        `Congratulations! You earned ${points} referral points for referring ${referredName}.`,
          data:           { screen: 'AdminReferEarn' },
        });
      }
    } catch (err) {
      console.warn('[referral.credit] notify failed:', err.message);
    }

    return { credited: true, points, referral_id: referral.id };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('creditReferralReward error:', err);
    return { credited: false, error: err.message };
  } finally {
    client.release();
  }
}

// Given a base price in rupees and an institution id, work out the actual
// referral discount we'd apply on a renewal, but DO NOT consume yet. Use
// this for previews. Returns { discount, used_points, plan_price }.
async function previewDiscount(institutionId, planPrice) {
  const settings = await getSettings();
  const w = await pool.query(
    `SELECT points_balance FROM referral_wallets WHERE institution_id = $1`,
    [institutionId],
  );
  const balance = Number(w.rows[0]?.points_balance) || 0;
  const rupeesPerPoint = Number(settings.rupees_per_point) || 1;
  const maxPct = Number(settings.max_discount_pct) || 50;
  const balanceRupees = Math.floor(balance * rupeesPerPoint);
  const cap = Math.floor((Number(planPrice) || 0) * maxPct / 100);
  const discount = Math.min(balanceRupees, cap);
  const usedPoints = Math.ceil(discount / rupeesPerPoint);
  return {
    discount,
    used_points: usedPoints,
    plan_price: Number(planPrice) || 0,
    settings,
  };
}

// Consume points for a renewal payment. Called from the payment-link
// generation flow when the institution actually pays. Idempotency is the
// caller's responsibility — this function ALWAYS debits.
async function consumeDiscount(institutionId, planPrice) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings = await getSettings(client);
    const w = await client.query(
      `SELECT points_balance FROM referral_wallets
        WHERE institution_id = $1
        FOR UPDATE`,
      [institutionId],
    );
    if (w.rows.length === 0) {
      await client.query('ROLLBACK');
      return { discount: 0, used_points: 0 };
    }
    const balance = Number(w.rows[0].points_balance) || 0;
    const rupeesPerPoint = Number(settings.rupees_per_point) || 1;
    const maxPct = Number(settings.max_discount_pct) || 50;
    const balanceRupees = Math.floor(balance * rupeesPerPoint);
    const cap = Math.floor((Number(planPrice) || 0) * maxPct / 100);
    const discount = Math.min(balanceRupees, cap);
    const usedPoints = Math.ceil(discount / rupeesPerPoint);

    if (usedPoints > 0) {
      await client.query(
        `UPDATE referral_wallets
            SET points_balance = points_balance - $1,
                total_used     = total_used     + $1,
                updated_at     = CURRENT_TIMESTAMP
          WHERE institution_id = $2`,
        [usedPoints, institutionId],
      );
      await client.query(
        `INSERT INTO referral_transactions
           (institution_id, type, points, description, status)
         VALUES ($1, 'used', $2, $3, 'completed')`,
        [
          institutionId,
          -usedPoints,
          `Applied ₹${discount} discount to subscription renewal`,
        ],
      );
    }
    await client.query('COMMIT');
    return { discount, used_points: usedPoints };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('consumeDiscount error:', err);
    return { discount: 0, used_points: 0 };
  } finally {
    client.release();
  }
}

exports.creditReferralReward = creditReferralReward;
exports.previewDiscount      = previewDiscount;
exports.consumeDiscount      = consumeDiscount;
