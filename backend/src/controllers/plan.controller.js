const pool = require('../config/db');
const { getUsage } = require('../utils/planLimits');

// GET /api/plans/usage — institution-admin scoped.
// Returns the calling admin's current students/trainers counts against
// their plan caps. Feeds the mobile Upgrade prompt + dashboard pills.
exports.getUsage = async (req, res) => {
  try {
    const u = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [req.user.id],
    );
    const institutionId = u.rows[0]?.institution_id;
    if (!institutionId) return res.status(403).json({ message: 'No institution linked' });

    const [students, trainers] = await Promise.all([
      getUsage(institutionId, 'students'),
      getUsage(institutionId, 'trainers'),
    ]);
    // Diagnostic log — visible in the backend terminal. Helps catch
    // the "why didn't the cap fire?" case (usually missing plan_id or
    // a plan row with max_students/max_trainers >= 999).
    // eslint-disable-next-line no-console
    console.log(
      `[plans/usage] inst=${institutionId} ` +
      `students ${students.current}/${students.limit ?? '∞'} ` +
      `(unlimited=${students.unlimited}) | ` +
      `trainers ${trainers.current}/${trainers.limit ?? '∞'} ` +
      `(unlimited=${trainers.unlimited}) | plan="${students.plan_name || 'none'}"`,
    );
    res.json({ students, trainers });
  } catch (err) {
    console.error('Plan usage error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Subscription plans
// ─────────────────────────────────────────────────────────────────────────────
// Plans drive the institution onboarding flow: each new academy picks one,
// payment uses its price, and the platform admin can change the catalog at
// any time from the admin web (Pricing & Plans page).
//
// Soft delete on remove (sets is_active=FALSE) so existing institutions
// already linked to a plan don't end up orphaned with a dangling FK.
// ─────────────────────────────────────────────────────────────────────────────

// Sanitise + normalise input before insert/update. Features can come as
// either a JSON array OR a newline-separated string from the form.
function sanitizePayload(body) {
  let features = body.features;
  if (typeof features === 'string') {
    // Try JSON first; fall back to newline-split.
    try {
      const parsed = JSON.parse(features);
      features = Array.isArray(parsed) ? parsed : null;
    } catch {
      features = features.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(features)) features = [];
  // Each feature should be a string. Coerce defensively.
  features = features.map((f) => String(f).trim()).filter(Boolean);

  // Discount math: if disabled we force discount_percent to 0 so the
  // stored value doesn't get out of sync with the toggle.
  const discountEnabled = !!body.discount_enabled;
  let discountPercent = 0;
  if (discountEnabled && body.discount_percent !== undefined && body.discount_percent !== '') {
    discountPercent = parseFloat(body.discount_percent);
    if (isNaN(discountPercent)) discountPercent = 0;
    if (discountPercent < 0) discountPercent = 0;
    if (discountPercent > 100) discountPercent = 100;
  }

  return {
    name:          (body.name || '').trim() || null,
    price:         body.price !== undefined && body.price !== '' ? parseFloat(body.price) : null,
    billing_cycle: body.billing_cycle || 'monthly',
    max_branches:  body.max_branches !== undefined && body.max_branches !== '' ? parseInt(body.max_branches, 10) : null,
    max_students:  body.max_students !== undefined && body.max_students !== '' ? parseInt(body.max_students, 10) : null,
    max_trainers:  body.max_trainers !== undefined && body.max_trainers !== '' ? parseInt(body.max_trainers, 10) : null,
    features,
    is_popular:    !!body.is_popular,
    is_active:     body.is_active === undefined ? true : !!body.is_active,
    trial_days:    body.trial_days !== undefined && body.trial_days !== '' ? Math.max(0, parseInt(body.trial_days, 10) || 0) : 0,
    grace_days:    body.grace_days !== undefined && body.grace_days !== '' ? Math.max(0, parseInt(body.grace_days, 10) || 0) : 0,
    discount_enabled: discountEnabled,
    discount_percent: discountPercent,
  };
}

// PUBLIC — list of ACTIVE plans for the institution-admin's "Choose Plan" UI.
exports.getPlans = async (req, res) => {
  try {
    const { include_inactive } = req.query;
    const where = include_inactive === 'true' ? '' : 'WHERE is_active = TRUE';
    const result = await pool.query(
      `SELECT * FROM subscription_plans ${where} ORDER BY price ASC`
    );
    res.json({ plans: result.rows });
  } catch (err) {
    console.error('Get plans error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json({ plan: result.rows[0] });
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// SUPER ADMIN — create a new plan.
exports.createPlan = async (req, res) => {
  try {
    const p = sanitizePayload(req.body);
    if (!p.name || p.price === null || isNaN(p.price)) {
      return res.status(400).json({ message: 'name and price are required' });
    }
    const result = await pool.query(
      `INSERT INTO subscription_plans
         (name, price, billing_cycle, max_branches, max_students, max_trainers,
          features, is_popular, is_active,
          trial_days, grace_days, discount_enabled, discount_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        p.name, p.price, p.billing_cycle,
        p.max_branches, p.max_students, p.max_trainers,
        JSON.stringify(p.features),
        p.is_popular, p.is_active,
        p.trial_days, p.grace_days, p.discount_enabled, p.discount_percent,
      ],
    );
    res.status(201).json({ message: 'Plan created', plan: result.rows[0] });
  } catch (err) {
    console.error('Create plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// SUPER ADMIN — update a plan. PATCH-style: only fields actually present in
// the body are updated; everything else stays as-is.
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const p = sanitizePayload(body);

    // features needs its own present-check because sanitizePayload always
    // returns [] when missing, which would otherwise wipe existing features.
    const featuresOrNull = has('features') ? JSON.stringify(p.features) : null;

    const result = await pool.query(
      `UPDATE subscription_plans SET
         name             = COALESCE($1, name),
         price            = COALESCE($2, price),
         billing_cycle    = COALESCE($3, billing_cycle),
         max_branches     = COALESCE($4, max_branches),
         max_students     = COALESCE($5, max_students),
         max_trainers     = COALESCE($6, max_trainers),
         features         = COALESCE($7::jsonb, features),
         is_popular       = COALESCE($8, is_popular),
         is_active        = COALESCE($9, is_active),
         trial_days       = COALESCE($10, trial_days),
         grace_days       = COALESCE($11, grace_days),
         discount_enabled = COALESCE($12, discount_enabled),
         discount_percent = COALESCE($13, discount_percent)
       WHERE id = $14
       RETURNING *`,
      [
        has('name')             ? p.name             : null,
        has('price')            ? p.price            : null,
        has('billing_cycle')    ? p.billing_cycle    : null,
        has('max_branches')     ? p.max_branches     : null,
        has('max_students')     ? p.max_students     : null,
        has('max_trainers')     ? p.max_trainers     : null,
        featuresOrNull,
        has('is_popular')       ? p.is_popular       : null,
        has('is_active')        ? p.is_active        : null,
        has('trial_days')       ? p.trial_days       : null,
        has('grace_days')       ? p.grace_days       : null,
        has('discount_enabled') ? p.discount_enabled : null,
        has('discount_percent') ? p.discount_percent : null,
        id,
      ],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json({ message: 'Plan updated', plan: result.rows[0] });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// SUPER ADMIN — soft-delete (deactivate) a plan. We don't hard-delete because
// existing institutions reference subscription_plans.id via plan_id; nuking
// the row would leave orphaned references. is_active=FALSE hides it from the
// public Choose-Plan list but keeps the row around for historical lookup.
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE subscription_plans SET is_active = FALSE
       WHERE id = $1
       RETURNING id, name`,
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    res.json({
      message: `${result.rows[0].name} archived. Existing institutions on this plan are unaffected.`,
      deactivated_id: result.rows[0].id,
    });
  } catch (err) {
    console.error('Delete plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
