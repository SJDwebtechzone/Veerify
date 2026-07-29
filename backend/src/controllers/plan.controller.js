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

    const [students, trainers, branches] = await Promise.all([
      getUsage(institutionId, 'students'),
      getUsage(institutionId, 'trainers'),
      getUsage(institutionId, 'branches'),
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
      `(unlimited=${trainers.unlimited}) | ` +
      `branches ${branches.current}/${branches.limit ?? '∞'} ` +
      `(unlimited=${branches.unlimited}) | plan="${students.plan_name || 'none'}"`,
    );
    res.json({ students, trainers, branches });
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
    // Optional plan image (migration 051). Empty string → null so the
    // COALESCE on update doesn't accidentally clear a saved image
    // when the admin re-saves the form without touching the upload.
    image_url:     body.image_url ? String(body.image_url).trim() : null,
    // WhatsApp notifications gate (migration 073). Default FALSE.
    // Applied by planFeatureGuard.assertWhatsAppAllowed before every
    // WhatsApp API send so an institution on a lower-tier plan can
    // never dispatch WhatsApp messages, even if the client tries.
    whatsapp_notifications_enabled: !!body.whatsapp_notifications_enabled,
    // GST percentage (migration 076). Defaults to 18 (India SaaS
    // slab). Clamped to 0..50 by the DB CHECK constraint; we clamp
    // here too so a malformed payload gets a friendly value instead
    // of a raw 23514 error.
    gst_percent: (() => {
      const raw = body.gst_percent;
      if (raw === undefined || raw === null || raw === '') return 18;
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return 18;
      return Math.max(0, Math.min(50, n));
    })(),
  };
}

// ── GST helpers ──────────────────────────────────────────────────────
// Rounds a rupee amount to 2 decimal places using half-away-from-zero
// so a ₹99.995 base doesn't drift to ₹99.99 (bankers' rounding surprises
// customers on invoice line items).
function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

// Given a base price and a gst_percent, return the { gst_amount,
// total_payable } pair as 2dp numbers. Used everywhere the API needs
// to project GST into the client — attachPricing for lists, the
// approve / renew flows for Razorpay charge amounts, and the invoice
// renderer for line breakdowns.
function computeGst(basePrice, gstPercent) {
  const base = round2(basePrice);
  const pct  = Number(gstPercent) || 0;
  const gst  = round2(base * (pct / 100));
  return {
    base_price:    base,
    gst_percent:   pct,
    gst_amount:    gst,
    total_payable: round2(base + gst),
  };
}

// ── Pricing terms helper ─────────────────────────────────────────────
// Load plan_pricing rows for the given plan ids in one query and
// group them into per-plan arrays keyed by plan_id.
async function loadPricingByPlan(planIds) {
  if (!planIds.length) return new Map();
  const r = await pool.query(
    `SELECT plan_id, billing_term, price, is_enabled, gst_percent
       FROM plan_pricing
      WHERE plan_id = ANY($1::int[])
      ORDER BY
        CASE billing_term
          WHEN 'monthly'     THEN 1
          WHEN 'quarterly'   THEN 2
          WHEN 'half_yearly' THEN 3
          WHEN 'annual'      THEN 4
          ELSE 5
        END`,
    [planIds],
  );
  const byPlan = new Map();
  for (const row of r.rows) {
    if (!byPlan.has(row.plan_id)) byPlan.set(row.plan_id, []);
    byPlan.get(row.plan_id).push({
      billing_term: row.billing_term,
      price:        Number(row.price),
      is_enabled:   !!row.is_enabled,
      gst_percent:  Number(row.gst_percent) || 0,
    });
  }
  return byPlan;
}

// Attach pricing_terms to each plan row so the mobile shows the correct
// term options + prices. For consumers that only understand the legacy
// singleton `price` + `billing_cycle`, both stay populated on the row.
//
// Every term row is enriched with base_price / gst_percent /
// gst_amount / total_payable so both the Web Admin and mobile display
// identical breakdowns (spec: "API returns Base Price, GST Percentage,
// GST Amount, and Total Payable"). Same enrichment is projected onto
// the plan's legacy singleton price so an older client that reads
// plan.total_payable / plan.gst_amount still gets a sane value.
async function attachPricing(plans) {
  const ids = plans.map((p) => p.id);
  const byPlan = await loadPricingByPlan(ids);
  return plans.map((p) => {
    const planGstPercent = Number(p.gst_percent);
    const defaultPct = Number.isFinite(planGstPercent) ? planGstPercent : 18;
    const terms = (byPlan.get(p.id) || []).map((t) => {
      const pct = Number.isFinite(t.gst_percent) && t.gst_percent > 0
        ? t.gst_percent
        : defaultPct;
      const gst = computeGst(t.price, pct);
      return {
        ...t,
        gst_percent:   pct,
        base_price:    gst.base_price,
        gst_amount:    gst.gst_amount,
        total_payable: gst.total_payable,
      };
    });
    const legacyGst = computeGst(p.price, defaultPct);
    return {
      ...p,
      gst_percent:   defaultPct,
      base_price:    legacyGst.base_price,
      gst_amount:    legacyGst.gst_amount,
      total_payable: legacyGst.total_payable,
      pricing_terms: terms,
    };
  });
}

// PUBLIC — list of ACTIVE plans for the institution-admin's "Choose Plan" UI.
exports.getPlans = async (req, res) => {
  try {
    const { include_inactive } = req.query;
    const where = include_inactive === 'true' ? '' : 'WHERE is_active = TRUE';
    const result = await pool.query(
      `SELECT * FROM subscription_plans ${where} ORDER BY price ASC`
    );
    const plans = await attachPricing(result.rows);
    res.json({ plans });
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
    const [plan] = await attachPricing(result.rows);
    res.json({ plan });
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Upsert the pricing terms for a plan. Accepts an array of
//   { billing_term, price, is_enabled }
// entries. Missing terms are left alone (partial edit possible), sent
// terms overwrite. Cleans invalid terms silently to avoid 400ing on a
// stale client payload.
const VALID_TERMS = new Set(['monthly', 'quarterly', 'half_yearly', 'annual']);
async function upsertPricingTerms(planId, rawTerms, defaultGstPct) {
  if (!Array.isArray(rawTerms)) return;
  const fallbackPct = Number.isFinite(defaultGstPct) ? defaultGstPct : 18;
  for (const t of rawTerms) {
    if (!t || !VALID_TERMS.has(t.billing_term)) continue;
    const priceNum = Number(t.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) continue;
    const enabled = t.is_enabled === false ? false : true;
    // Per-term gst_percent snapshot. Falls back to the parent plan's
    // rate so a legacy client that only sends { billing_term, price,
    // is_enabled } still lands with the plan default. Clamped to
    // 0..50 mirroring the CHECK constraint.
    const gstRaw = t.gst_percent;
    const gstPct = Math.max(0, Math.min(50,
      gstRaw === undefined || gstRaw === null || gstRaw === ''
        ? fallbackPct
        : (parseFloat(gstRaw) || fallbackPct),
    ));
    await pool.query(
      `INSERT INTO plan_pricing (plan_id, billing_term, price, is_enabled, gst_percent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (plan_id, billing_term) DO UPDATE SET
         price       = EXCLUDED.price,
         is_enabled  = EXCLUDED.is_enabled,
         gst_percent = EXCLUDED.gst_percent,
         updated_at  = NOW()`,
      [planId, t.billing_term, priceNum, enabled, gstPct],
    );
  }
}

// Derive the legacy singleton `price` + `billing_cycle` columns from
// the enabled terms so the old readers (mobile PlanSelection legacy
// screens, subscription-status endpoint, etc.) keep working. Picks the
// lowest-priced ENABLED term; falls back to monthly if nothing enabled.
async function refreshLegacyPricing(planId) {
  const r = await pool.query(
    `SELECT billing_term, price
       FROM plan_pricing
      WHERE plan_id = $1 AND is_enabled = TRUE
      ORDER BY price ASC
      LIMIT 1`,
    [planId],
  );
  if (r.rows.length === 0) return;
  const { billing_term, price } = r.rows[0];
  await pool.query(
    `UPDATE subscription_plans SET price = $1, billing_cycle = $2 WHERE id = $3`,
    [price, billing_term, planId],
  );
}

// SUPER ADMIN — create a new plan.
//
// New shape accepts `pricing_terms: [{ billing_term, price, is_enabled }, ...]`.
// If provided, the legacy singleton `price` + `billing_cycle` are
// derived from the enabled terms (cheapest wins). If omitted, the
// legacy singletons are used as before and a matching plan_pricing row
// is inserted so the new endpoint still returns pricing_terms.
exports.createPlan = async (req, res) => {
  try {
    const p = sanitizePayload(req.body);
    const rawTerms = Array.isArray(req.body?.pricing_terms) ? req.body.pricing_terms : null;

    if (!p.name) {
      return res.status(400).json({ message: 'name is required' });
    }

    // Derive legacy fallback from pricing_terms if the caller didn't
    // send a top-level price.
    if ((p.price === null || isNaN(p.price)) && rawTerms) {
      const enabled = rawTerms.filter(
        (t) => t && VALID_TERMS.has(t.billing_term) && t.is_enabled !== false && Number(t.price) >= 0,
      );
      if (enabled.length === 0) {
        return res.status(400).json({ message: 'At least one enabled pricing term is required.' });
      }
      const cheapest = enabled.reduce((acc, t) =>
        acc == null || Number(t.price) < Number(acc.price) ? t : acc, null);
      p.price = Number(cheapest.price);
      p.billing_cycle = cheapest.billing_term;
    }

    if (p.price === null || isNaN(p.price)) {
      return res.status(400).json({ message: 'price is required' });
    }

    const result = await pool.query(
      `INSERT INTO subscription_plans
         (name, price, billing_cycle, max_branches, max_students, max_trainers,
          features, is_popular, is_active,
          trial_days, grace_days, discount_enabled, discount_percent,
          image_url, whatsapp_notifications_enabled, gst_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        p.name, p.price, p.billing_cycle,
        p.max_branches, p.max_students, p.max_trainers,
        JSON.stringify(p.features),
        p.is_popular, p.is_active,
        p.trial_days, p.grace_days, p.discount_enabled, p.discount_percent,
        p.image_url,
        p.whatsapp_notifications_enabled,
        p.gst_percent,
      ],
    );
    const plan = result.rows[0];

    // Persist pricing_terms if the caller sent them; otherwise seed a
    // single row from the legacy singleton pair so the new shape is
    // always returnable. Plan's default GST rate is forwarded so per-
    // term rows inherit it when the client omits gst_percent.
    if (rawTerms) {
      await upsertPricingTerms(plan.id, rawTerms, p.gst_percent);
    } else {
      await upsertPricingTerms(plan.id, [{
        billing_term: p.billing_cycle || 'monthly',
        price:        Number(p.price),
        is_enabled:   true,
        gst_percent:  p.gst_percent,
      }], p.gst_percent);
    }
    await refreshLegacyPricing(plan.id);

    const [enriched] = await attachPricing([plan]);
    res.status(201).json({ message: 'Plan created', plan: enriched });
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

    // image_url uses a present-check too so an admin who saves without
    // touching the upload doesn't clear the existing image. The
    // sanitised value is used regardless — passing `image_url: null`
    // in the body is how the client clears it.
    const imageOrNull = has('image_url')
      ? (p.image_url === null ? null : p.image_url)
      : null;

    const result = await pool.query(
      `UPDATE subscription_plans SET
         name                            = COALESCE($1, name),
         price                           = COALESCE($2, price),
         billing_cycle                   = COALESCE($3, billing_cycle),
         max_branches                    = COALESCE($4, max_branches),
         max_students                    = COALESCE($5, max_students),
         max_trainers                    = COALESCE($6, max_trainers),
         features                        = COALESCE($7::jsonb, features),
         is_popular                      = COALESCE($8, is_popular),
         is_active                       = COALESCE($9, is_active),
         trial_days                      = COALESCE($10, trial_days),
         grace_days                      = COALESCE($11, grace_days),
         discount_enabled                = COALESCE($12, discount_enabled),
         discount_percent                = COALESCE($13, discount_percent),
         image_url                       = CASE WHEN $15::boolean THEN $14 ELSE image_url END,
         whatsapp_notifications_enabled  = COALESCE($16, whatsapp_notifications_enabled),
         gst_percent                     = COALESCE($17, gst_percent)
       WHERE id = $18
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
        imageOrNull,
        has('image_url'),
        has('whatsapp_notifications_enabled') ? p.whatsapp_notifications_enabled : null,
        has('gst_percent')      ? p.gst_percent      : null,
        id,
      ],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    const plan = result.rows[0];

    // pricing_terms round-trip. Same semantics as create — the caller
    // sends any subset (partial edits work), missing terms untouched.
    // Forward the effective plan gst_percent so any newly-inserted term
    // rows default to it when the client omitted per-row gst_percent.
    if (Array.isArray(req.body?.pricing_terms)) {
      const effectiveGst = Number(plan.gst_percent) || p.gst_percent || 18;
      await upsertPricingTerms(plan.id, req.body.pricing_terms, effectiveGst);
      await refreshLegacyPricing(plan.id);
    }

    const [enriched] = await attachPricing([plan]);
    res.json({ message: 'Plan updated', plan: enriched });
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
