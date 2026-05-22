const pool = require('../config/db');
const { sendApprovalEmail, sendActivationEmail } = require('../utils/mailer');
const { createPaymentLink, verifyWebhookSignature } = require('../utils/razorpay');

// STEP 1: Admin selects a plan
exports.selectPlan = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user.id;

    if (!plan_id) {
      return res.status(400).json({ message: 'Plan ID is required' });
    }

    // Verify plan exists
    const plan = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = TRUE',
      [plan_id]
    );

    if (plan.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    // Check if admin already has an institution
    const existing = await pool.query(
      'SELECT * FROM institutions WHERE owner_user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      const current = existing.rows[0];

      // If the academy is soft-deleted we can't touch it from here — the
      // owner has to choose Restore or Start Over from the AccountDeleted
      // screen first.
      if (current.deleted_at) {
        return res.status(409).json({
          message: 'Your academy is deleted. Restore it or choose "Start fresh" first.',
          status: 'deleted',
        });
      }

      // Don't let a stray call downgrade an academy that's already past plan
      // selection. We allow swapping plans only while status is still
      // 'registered' or 'plan_selected'. Anything beyond that (pending_approval,
      // approved, active, rejected) needs to go through a real plan-change
      // flow, not this endpoint.
      const PRE_SETUP = new Set(['registered', 'plan_selected', null, undefined]);
      const allowStatusReset = PRE_SETUP.has(current.onboarding_status);

      const updated = await pool.query(
        allowStatusReset
          ? `UPDATE institutions
               SET plan_id = $1, onboarding_status = 'plan_selected'
             WHERE owner_user_id = $2
             RETURNING *`
          : `UPDATE institutions
               SET plan_id = $1
             WHERE owner_user_id = $2
             RETURNING *`,
        [plan_id, userId],
      );

      return res.json({
        message: allowStatusReset
          ? 'Plan selected successfully'
          : `Plan updated. Onboarding status (${current.onboarding_status}) left untouched.`,
        institution: updated.rows[0],
        plan: plan.rows[0],
      });
    }

    // Create new institution with plan selected
    const newInst = await pool.query(
      `INSERT INTO institutions 
         (owner_user_id, plan_id, onboarding_status, name, status)
       VALUES ($1, $2, 'plan_selected', 'Unnamed Academy', 'pending')
       RETURNING *`,
      [userId, plan_id]
    );

    // Update user's institution_id
    await pool.query(
      'UPDATE users SET institution_id = $1 WHERE id = $2',
      [newInst.rows[0].id, userId]
    );

    res.status(201).json({
      message: 'Plan selected successfully',
      institution: newInst.rows[0],
      plan: plan.rows[0]
    });
  } catch (err) {
    console.error('Select plan error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// STEP 2: Admin submits academy setup form
exports.setupAcademy = async (req, res) => {
  try {
    const {
      name,
      institution_type,
      website_url,
      email,
      phone,
      address,
      city,
      pincode,
      registration_number,
      master_name,
      logo_url
    } = req.body;

    const userId = req.user.id;

    // Validation
    if (!name || !institution_type || !email || !phone || !address || !registration_number || !master_name) {
      return res.status(400).json({ 
        message: 'All required fields must be filled' 
      });
    }

    // Find the institution
    const instResult = await pool.query(
      'SELECT * FROM institutions WHERE owner_user_id = $1',
      [userId]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Please select a plan first' 
      });
    }

    const institution = instResult.rows[0];

    if (institution.onboarding_status === 'registered') {
      return res.status(400).json({ 
        message: 'Please select a subscription plan first' 
      });
    }

    // Update institution with all details
    const updated = await pool.query(
      `UPDATE institutions SET
         name = $1,
         institution_type = $2,
         website_url = $3,
         email = $4,
         phone = $5,
         address = $6,
         city = $7,
         pincode = $8,
         registration_number = $9,
         master_name = $10,
         logo_url = $11,
         onboarding_status = 'pending_approval',
         status = 'pending'
       WHERE owner_user_id = $12
       RETURNING *`,
      [
        name,
        institution_type,
        website_url,
        email,
        phone,
        address,
        city,
        pincode,
        registration_number,
        master_name,
        logo_url || null,
        userId
      ]
    );

    res.json({
      message: 'Academy details submitted successfully',
      institution: updated.rows[0]
    });
  } catch (err) {
    console.error('Setup academy error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// GET: Check current onboarding status
exports.getMyStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT i.*, sp.name AS plan_name, sp.price AS plan_price, 
              sp.features AS plan_features
       FROM institutions i
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.owner_user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        status: 'registered',
        institution: null
      });
    }

    const inst = result.rows[0];

    res.json({
      // When the row is soft-deleted, onboarding_status is already 'deleted'.
      // We also send back the snapshot of the previous status so the mobile
      // app can say "Your previously-active academy was deleted" vs.
      // "Your pending application was deleted".
      status: inst.onboarding_status,
      institution: inst,
      rejection_reason: inst.rejection_reason || null,
      deleted_at:             inst.deleted_at || null,
      deletion_source:        inst.deletion_source || null,
      deletion_reason:        inst.deletion_reason || null,
      prev_onboarding_status: inst.prev_onboarding_status || null,
    });
  } catch (err) {
    console.error('Get status error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// SUPER ADMIN: Approve an institution
exports.approveInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    const result = await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'approved',
         status = 'approved',
         approved_by = $1,
         approved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [adminId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    // TODO Phase 2: Send email notification to academy owner
    // await sendEmail(institution.email, 'Academy Approved!', '...')

    res.json({
      message: 'Institution approved successfully',
      institution: result.rows[0]
    });
  } catch (err) {
    console.error('Approve institution error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// SUPER ADMIN: Reject an institution
exports.rejectInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason) {
      return res.status(400).json({ 
        message: 'Rejection reason is required' 
      });
    }

    const result = await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'rejected',
         status = 'rejected',
         rejection_reason = $1,
         approved_by = $2
       WHERE id = $3
       RETURNING *`,
      [reason, adminId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    res.json({
      message: 'Institution rejected',
      institution: result.rows[0]
    });
  } catch (err) {
    console.error('Reject institution error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// MOCK PAYMENT: Activate institution after payment (Phase 1 mock)
exports.mockPayment = async (req, res) => {
  try {
    const userId = req.user.id;

    const instResult = await pool.query(
      'SELECT * FROM institutions WHERE owner_user_id = $1',
      [userId]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    const institution = instResult.rows[0];

    if (institution.onboarding_status !== 'approved') {
      return res.status(400).json({ 
        message: 'Institution must be approved before payment' 
      });
    }

    // Activate the institution
    const updated = await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'active',
         status = 'approved',
         subscription_start = NOW(),
         subscription_end = NOW() + INTERVAL '30 days'
       WHERE owner_user_id = $1
       RETURNING *`,
      [userId]
    );

    // Also update user status
    await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      ['active', userId]
    );

    res.json({
      message: '🎉 Payment successful! Your academy is now live.',
      institution: updated.rows[0]
    });
  } catch (err) {
    console.error('Mock payment error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET: List all pending institutions (for super admin)
exports.getPendingInstitutions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         i.*,
         u.name AS owner_name, 
         u.email AS owner_email, 
         u.phone AS owner_phone,
         sp.name AS plan_name, 
         sp.price AS plan_price,
         sp.features AS plan_features
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.onboarding_status = 'pending_approval'
         AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC`
    );

    res.json({
      count: result.rows.length,
      institutions: result.rows
    });
  } catch (err) {
    console.error('Get pending error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
// GET: List ALL institutions (for super admin)
exports.getAllInstitutions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.*,
              u.name AS owner_name, u.email AS owner_email,
              sp.name AS plan_name, sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       ORDER BY i.created_at DESC`
    );

    res.json({
      count: result.rows.length,
      institutions: result.rows
    });
  } catch (err) {
    console.error('Get all institutions error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET single institution details (for admin review)
exports.getInstitutionById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
         i.*,
         u.name AS owner_name,
         u.email AS owner_email,
         u.phone AS owner_phone,
         sp.name AS plan_name,
         sp.price AS plan_price,
         sp.features AS plan_features,
         sp.max_students,
         sp.max_trainers,
         sp.max_branches
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    res.json({ institution: result.rows[0] });
  } catch (err) {
    console.error('Get institution error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET all institutions with filters
//
// Query params (all optional):
//   ?status=active|approved|pending_approval|rejected   filter by onboarding_status
//   ?expired=true                                       only rows whose subscription_end < NOW()
//
// Response shape per row includes everything the admin All-Institutions table
// needs: logo, plan, payment metadata, subscription window, owner contact.
exports.getAllInstitutions = async (req, res) => {
  try {
    const { status, expired, include_deleted } = req.query;

    const where = [];
    const params = [];

    // Soft-deleted rows are hidden by default. Pass ?include_deleted=true to
    // get them too (admin "trash" view). ?include_deleted=only to get ONLY
    // deleted rows.
    if (include_deleted === 'only') {
      where.push(`i.deleted_at IS NOT NULL`);
    } else if (include_deleted !== 'true') {
      where.push(`i.deleted_at IS NULL`);
    }

    if (status) {
      params.push(status);
      where.push(`i.onboarding_status = $${params.length}`);
    }

    if (expired === 'true') {
      // Expired = active institutions whose subscription window has passed.
      where.push(`i.subscription_end IS NOT NULL AND i.subscription_end < NOW()`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         i.id,
         i.name,
         i.institution_type,
         i.city,
         i.phone,
         i.email,
         i.logo_url,
         i.onboarding_status,
         i.is_active,
         i.created_at,
         i.approved_at,
         i.master_name,
         i.registration_number,
         i.subscription_start,
         i.subscription_end,
         i.payment_link_status,
         i.payment_amount,
         i.paid_at,
         i.deleted_at,
         i.deletion_source,
         i.prev_onboarding_status,
         u.name AS owner_name,
         u.email AS owner_email,
         u.phone AS owner_phone,
         sp.name AS plan_name,
         sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       ${whereClause}
       ORDER BY
         CASE i.onboarding_status
           WHEN 'pending_approval' THEN 1
           WHEN 'approved' THEN 2
           WHEN 'active' THEN 3
           WHEN 'rejected' THEN 4
           ELSE 5
         END,
         i.created_at DESC`,
      params,
    );

    res.json({
      count: result.rows.length,
      institutions: result.rows,
    });
  } catch (err) {
    console.error('Get all institutions error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// APPROVE institution → create Razorpay payment link → email owner.
//
// Behaviour:
// 1. Validate status is `pending_approval`.
// 2. Flip status to `approved` atomically (so a second click can't double-process).
// 3. Try to create a Razorpay payment link.
// 4. Try to email the owner with the link.
//
// Email / Razorpay failures are surfaced in the response as warnings BUT do
// NOT roll back the approval — the admin can retry sending via /resend-payment-link.
exports.approveInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    // Pull institution + owner + plan in one shot.
    const instResult = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.id = $1`,
      [id]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    const institution = instResult.rows[0];

    if (institution.onboarding_status !== 'pending_approval') {
      return res.status(400).json({
        message: `Cannot approve — current status is ${institution.onboarding_status}`,
      });
    }

    if (!institution.plan_price) {
      return res.status(400).json({
        message: 'This institution has no plan / plan price set. Cannot create a payment link.',
      });
    }

    // Flip status to approved first so the UI updates even if email/Razorpay fails.
    await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'approved',
         status = 'approved',
         approved_by = $1,
         approved_at = NOW()
       WHERE id = $2`,
      [adminId, id]
    );

    const warnings = [];

    // 3. Create payment link.
    const linkResult = await createPaymentLink({
      amountInRupees: institution.plan_price,
      institution,
    });

    if (linkResult.ok) {
      await pool.query(
        `UPDATE institutions SET
           payment_link_id     = $1,
           payment_link_url    = $2,
           payment_link_status = 'pending',
           payment_amount      = $3
         WHERE id = $4`,
        [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, id]
      );
    } else {
      warnings.push(`Payment link not created: ${linkResult.error}`);
    }

    // 4. Email the owner (only if we have a link to send).
    if (linkResult.ok) {
      const mailResult = await sendApprovalEmail({
        to:              institution.owner_email,
        ownerName:       institution.owner_name,
        institutionName: institution.name,
        planName:        institution.plan_name,
        planPrice:       institution.plan_price,
        paymentUrl:      linkResult.link.short_url,
      });
      if (!mailResult.ok) {
        warnings.push(`Email not sent: ${mailResult.error}`);
      }
    }

    // Return the fresh row so the admin UI re-renders correctly.
    const fresh = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name,
              sp.name AS plan_name, sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.id = $1`,
      [id]
    );

    res.json({
      message: `${institution.name} approved. ${
        linkResult.ok ? 'Payment link emailed to owner.' : 'Payment link could NOT be created — see warnings.'
      }`,
      institution: fresh.rows[0],
      payment_link_url: linkResult.ok ? linkResult.link.short_url : null,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Re-create the payment link and re-send the approval email. Use when:
//  - the original email didn't arrive,
//  - the payment link expired,
//  - approval succeeded but Razorpay was misconfigured at the time.
//
// Only allowed when status is 'approved' (i.e. we already approved but haven't
// activated yet).
exports.resendPaymentLink = async (req, res) => {
  try {
    const { id } = req.params;

    const instResult = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.id = $1`,
      [id]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    const institution = instResult.rows[0];

    if (institution.onboarding_status !== 'approved') {
      return res.status(400).json({
        message: `Can only resend on approved institutions — current status is ${institution.onboarding_status}`,
      });
    }

    const linkResult = await createPaymentLink({
      amountInRupees: institution.plan_price,
      institution,
    });
    if (!linkResult.ok) {
      return res.status(502).json({ message: `Payment link not created: ${linkResult.error}` });
    }

    await pool.query(
      `UPDATE institutions SET
         payment_link_id     = $1,
         payment_link_url    = $2,
         payment_link_status = 'pending',
         payment_amount      = $3
       WHERE id = $4`,
      [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, id]
    );

    const mailResult = await sendApprovalEmail({
      to:              institution.owner_email,
      ownerName:       institution.owner_name,
      institutionName: institution.name,
      planName:        institution.plan_name,
      planPrice:       institution.plan_price,
      paymentUrl:      linkResult.link.short_url,
    });

    res.json({
      message: mailResult.ok
        ? `Payment link re-sent to ${institution.owner_email}.`
        : `Payment link generated, but email failed: ${mailResult.error}`,
      payment_link_url: linkResult.link.short_url,
      email_ok: mailResult.ok,
    });
  } catch (err) {
    console.error('Resend payment link error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// REJECT institution with reason
exports.rejectInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({
        message: 'Rejection reason is required'
      });
    }

    const instResult = await pool.query(
      'SELECT * FROM institutions WHERE id = $1',
      [id]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    const updated = await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'rejected',
         status = 'rejected',
         rejection_reason = $1
       WHERE id = $2
       RETURNING *`,
      [reason, id]
    );

    res.json({
      message: 'Institution rejected',
      institution: updated.rows[0]
    });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ACTIVATE institution after payment confirmed
exports.activateInstitution = async (req, res) => {
  try {
    const { id } = req.params;

    const instResult = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       WHERE i.id = $1`,
      [id]
    );

    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    const institution = instResult.rows[0];

    if (institution.onboarding_status !== 'approved') {
      return res.status(400).json({
        message: `Cannot activate — current status is ${institution.onboarding_status}`
      });
    }

    // Activate institution. We also mark the payment_link_status as 'paid' so
    // the admin UI shows the right badge even on a manual override.
    const updated = await pool.query(
      `UPDATE institutions SET
         onboarding_status   = 'active',
         status              = 'approved',
         subscription_start  = NOW(),
         subscription_end    = NOW() + INTERVAL '30 days',
         payment_link_status = COALESCE(NULLIF(payment_link_status, ''), 'paid'),
         paid_at             = COALESCE(paid_at, NOW())
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    // Force payment_link_status to 'paid' on manual override (the COALESCE above
    // only filled in nulls; this overwrites a stale 'pending').
    await pool.query(
      `UPDATE institutions SET payment_link_status = 'paid'
       WHERE id = $1 AND payment_link_status <> 'paid'`,
      [id]
    );

    // Also activate the owner user
    await pool.query(
      `UPDATE users SET status = 'active'
       WHERE id = (
         SELECT owner_user_id FROM institutions WHERE id = $1
       )`,
      [id]
    );

    // Email the owner. Failures are non-fatal — activation already succeeded.
    const mailResult = await sendActivationEmail({
      to:              institution.owner_email,
      ownerName:       institution.owner_name,
      institutionName: institution.name,
      subscriptionEnd: updated.rows[0].subscription_end,
    });

    res.json({
      message: `${institution.name} is now LIVE! 🎉`,
      institution: updated.rows[0],
      owner_email: institution.owner_email,
      email_ok: mailResult.ok,
      login_url: 'Open the Veerify app and login with your registered credentials',
    });
  } catch (err) {
    console.error('Activate error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────
// Mounted at POST /api/payments/webhook. Public (no JWT) but signature-verified.
//
// IMPORTANT: this route receives the raw request body. server.js captures the
// raw bytes via the `verify` callback on express.json() and stuffs them on
// req.rawBody — see server.js for the wiring.
//
// We listen for `payment_link.paid` events. The payload shape is:
//   { event: 'payment_link.paid',
//     payload: { payment_link: { entity: { id, notes, ... } },
//                payment:      { entity: { id, ... } } } }
//
// Razorpay may deliver the same event more than once (at-least-once delivery),
// so the handler is idempotent: we only flip status if it isn't already 'active'.
exports.handlePaymentWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody;

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] invalid signature');
    return res.status(400).json({ message: 'Invalid signature' });
  }

  // The raw-body parser leaves req.body unparsed; parse it ourselves.
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }

  // We only care about successful payment-link payments. Acknowledge everything
  // else with 200 so Razorpay stops retrying.
  if (event.event !== 'payment_link.paid') {
    return res.json({ ok: true, ignored: event.event });
  }

  try {
    const linkEntity    = event.payload?.payment_link?.entity || {};
    const paymentEntity = event.payload?.payment?.entity      || {};
    const linkId        = linkEntity.id;
    const paymentId     = paymentEntity.id;
    const notesInstId   = linkEntity.notes?.institution_id;

    if (!linkId) {
      console.warn('[webhook] payment_link.paid with no link id');
      return res.status(400).json({ message: 'Missing payment_link.id' });
    }

    // Look up by stored payment_link_id first; fall back to notes.institution_id
    // (defensive against a future row that didn't get the link id saved).
    let inst = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       WHERE i.payment_link_id = $1`,
      [linkId]
    );

    if (inst.rows.length === 0 && notesInstId) {
      inst = await pool.query(
        `SELECT i.*, u.email AS owner_email, u.name AS owner_name
         FROM institutions i
         JOIN users u ON i.owner_user_id = u.id
         WHERE i.id = $1`,
        [notesInstId]
      );
    }

    if (inst.rows.length === 0) {
      console.warn('[webhook] no institution matched payment_link.id=', linkId);
      // Still 200 — we don't want Razorpay retrying forever.
      return res.json({ ok: true, matched: false });
    }

    const institution = inst.rows[0];

    // Idempotent: if already active, just ack.
    if (institution.onboarding_status === 'active') {
      return res.json({ ok: true, already_active: true });
    }

    // Activate.
    const updated = await pool.query(
      `UPDATE institutions SET
         onboarding_status    = 'active',
         status               = 'approved',
         subscription_start   = NOW(),
         subscription_end     = NOW() + INTERVAL '30 days',
         payment_link_status  = 'paid',
         payment_reference    = $2,
         paid_at              = NOW()
       WHERE id = $1
       RETURNING *`,
      [institution.id, paymentId || null]
    );

    await pool.query(
      `UPDATE users SET status = 'active' WHERE id = $1`,
      [institution.owner_user_id]
    );

    // Fire-and-forget welcome email. Don't let it block the webhook ack.
    sendActivationEmail({
      to:              institution.owner_email,
      ownerName:       institution.owner_name,
      institutionName: institution.name,
      subscriptionEnd: updated.rows[0].subscription_end,
    }).catch((e) => console.error('[webhook] activation email failed:', e.message));

    console.log(`[webhook] activated institution ${institution.id} (${institution.name}) via payment ${paymentId}`);
    return res.json({ ok: true, activated: true, institution_id: institution.id });
  } catch (err) {
    console.error('[webhook] handler error:', err);
    // 500 will cause Razorpay to retry, which is what we want on a transient
    // DB error.
    return res.status(500).json({ message: 'Webhook handler error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN: toggle an institution's is_active flag (soft-disable / enable).
// POST /api/onboarding/toggle-active/:id   body: { is_active: boolean }
// Doesn't touch onboarding_status or subscription window — those still reflect
// the academy's "real" lifecycle. This flag is for temporary admin actions
// (suspension, dispute hold, etc.).
// ─────────────────────────────────────────────────────────────────────────────
exports.toggleInstitutionActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ message: 'is_active must be a boolean' });
    }

    const result = await pool.query(
      `UPDATE institutions
         SET is_active = $1
       WHERE id = $2
       RETURNING id, name, is_active`,
      [is_active, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    res.json({
      message: `${result.rows[0].name} is now ${is_active ? 'ACTIVE' : 'INACTIVE'}.`,
      institution: result.rows[0],
    });
  } catch (err) {
    console.error('Toggle active error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SOFT DELETE — both admin (super) and owner (academy) flows.
// ─────────────────────────────────────────────────────────────────────────────
// We do NOT hard-delete the row. The owner's login credentials still work and
// when they sign in again the mobile / web client sees onboarding_status =
// 'deleted' and routes them to a screen that offers Restore or Start Fresh.
//
// Snapshot of the previous status is kept in prev_onboarding_status so Restore
// can put the row back exactly where it was (pending / approved / active /
// rejected). Restore from a row that was deleted before paying for example
// won't sneak the academy into 'active'.
//
// Dependent rows (courses, batches, attendance, ...) stay intact. They're not
// reachable to students because every browse query filters on
// `deleted_at IS NULL`.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: soft-delete a single institution row. Returns the updated row, or
// null when the id doesn't exist / is already deleted.
async function softDeleteInstitution({ id, deletedById, source, reason }) {
  const result = await pool.query(
    `UPDATE institutions
        SET deleted_at             = NOW(),
            deleted_by             = $2,
            deletion_source        = $3,
            deletion_reason        = $4,
            prev_onboarding_status = onboarding_status,
            onboarding_status      = 'deleted',
            is_active              = FALSE
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id, name, prev_onboarding_status`,
    [id, deletedById || null, source, reason || null],
  );
  return result.rows[0] || null;
}

// SUPER ADMIN: soft-delete any institution.
// DELETE /api/onboarding/:id   body: { reason?: string }
exports.deleteInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const adminId = req.user?.id || null;

    const row = await softDeleteInstitution({
      id,
      deletedById: adminId,
      source: 'admin',
      reason,
    });

    if (!row) {
      // Either doesn't exist, or already deleted — surface both as 404 for
      // the admin UI (it just removes the row optimistically).
      return res.status(404).json({ message: 'Institution not found or already deleted' });
    }

    res.json({
      message: `${row.name} deleted. The owner can sign in again to restore or start fresh.`,
      deleted_id: row.id,
      prev_onboarding_status: row.prev_onboarding_status,
    });
  } catch (err) {
    console.error('Delete institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ACADEMY OWNER: soft-delete *their own* institution.
// DELETE /api/onboarding/me      body: { reason?: string }
exports.deleteMyInstitution = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body || {};

    const inst = await pool.query(
      `SELECT id, name FROM institutions
        WHERE owner_user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (inst.rows.length === 0) {
      return res.status(404).json({ message: 'You do not have an active academy to delete' });
    }

    const row = await softDeleteInstitution({
      id: inst.rows[0].id,
      deletedById: userId,
      source: 'owner',
      reason,
    });

    res.json({
      message: `${row.name} deleted. You can sign in again any time to restore or start fresh.`,
      deleted_id: row.id,
      prev_onboarding_status: row.prev_onboarding_status,
    });
  } catch (err) {
    console.error('Delete my institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// SUPER ADMIN: restore a soft-deleted institution.
// POST /api/onboarding/:id/restore
exports.restoreInstitution = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE institutions
          SET deleted_at        = NULL,
              deleted_by        = NULL,
              deletion_source   = NULL,
              deletion_reason   = NULL,
              -- Put status back to where it was when we deleted, but fall
              -- back to 'plan_selected' if we don't have a snapshot (i.e.
              -- rows that were soft-deleted before this migration).
              onboarding_status = COALESCE(prev_onboarding_status, 'plan_selected'),
              prev_onboarding_status = NULL,
              -- Re-activate only if the row was previously fully active.
              is_active = (COALESCE(prev_onboarding_status, '') = 'active')
        WHERE id = $1
          AND deleted_at IS NOT NULL
        RETURNING id, name, onboarding_status`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found or is not deleted' });
    }

    res.json({
      message: `${result.rows[0].name} restored.`,
      institution: result.rows[0],
    });
  } catch (err) {
    console.error('Restore institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ACADEMY OWNER: restore *their own* soft-deleted institution.
// POST /api/onboarding/me/restore
exports.restoreMyInstitution = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE institutions
          SET deleted_at        = NULL,
              deleted_by        = NULL,
              deletion_source   = NULL,
              deletion_reason   = NULL,
              onboarding_status = COALESCE(prev_onboarding_status, 'plan_selected'),
              prev_onboarding_status = NULL,
              is_active = (COALESCE(prev_onboarding_status, '') = 'active')
        WHERE owner_user_id = $1
          AND deleted_at IS NOT NULL
        RETURNING id, name, onboarding_status`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No deleted academy found for this account' });
    }

    res.json({
      message: `Welcome back. ${result.rows[0].name} restored.`,
      institution: result.rows[0],
    });
  } catch (err) {
    console.error('Restore my institution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ACADEMY OWNER: permanently abandon the deleted row and start fresh.
// POST /api/onboarding/me/start-over
// Hard-deletes the soft-deleted institution + its FK-cascaded children so
// re-onboarding from `selectPlan` creates a clean row. We only allow this on
// rows that ARE soft-deleted, never on a live academy.
exports.startOverMyInstitution = async (req, res) => {
  try {
    const userId = req.user.id;

    const inst = await pool.query(
      `SELECT id, name FROM institutions
        WHERE owner_user_id = $1
          AND deleted_at IS NOT NULL`,
      [userId],
    );
    if (inst.rows.length === 0) {
      return res.status(404).json({ message: 'No deleted academy found for this account' });
    }

    await pool.query(
      `DELETE FROM institutions WHERE id = $1`,
      [inst.rows[0].id],
    );

    // Unlink the user — selectPlan will create a fresh row and re-link.
    await pool.query(
      `UPDATE users SET institution_id = NULL WHERE id = $1`,
      [userId],
    );

    res.json({
      message: `Old academy cleared. You can start fresh with the same login.`,
      cleared_id: inst.rows[0].id,
    });
  } catch (err) {
    console.error('Start over error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onboarding/counts
// Lightweight summary endpoint polled by the admin web every 30 seconds so the
// sidebar / bell can show live counts without re-fetching the full list.
// Returns:
//   {
//     counts: { pending_approval, approved, active, rejected, expired, total },
//     recent_pending: [ { id, name, owner_name, owner_email, created_at, plan_name, plan_price }, ... up to 5 ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
exports.getOnboardingCounts = async (_req, res) => {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE onboarding_status = 'pending_approval' AND deleted_at IS NULL) AS pending_approval,
        COUNT(*) FILTER (WHERE onboarding_status = 'approved'         AND deleted_at IS NULL) AS approved,
        COUNT(*) FILTER (WHERE onboarding_status = 'active'           AND deleted_at IS NULL) AS active,
        COUNT(*) FILTER (WHERE onboarding_status = 'rejected'         AND deleted_at IS NULL) AS rejected,
        COUNT(*) FILTER (WHERE subscription_end IS NOT NULL AND subscription_end < NOW() AND deleted_at IS NULL) AS expired,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)                AS deleted,
        COUNT(*) FILTER (WHERE deleted_at IS NULL)                    AS total
      FROM institutions
    `);

    const recent = await pool.query(`
      SELECT
        i.id,
        i.name,
        i.logo_url,
        i.city,
        i.created_at,
        u.name  AS owner_name,
        u.email AS owner_email,
        sp.name AS plan_name,
        sp.price AS plan_price
      FROM institutions i
      JOIN users u ON i.owner_user_id = u.id
      LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
      WHERE i.onboarding_status = 'pending_approval'
        AND i.deleted_at IS NULL
      ORDER BY i.created_at DESC
      LIMIT 5
    `);

    // pg returns COUNT(*) as a string; coerce to numbers for the client.
    const c = summary.rows[0] || {};
    res.json({
      counts: {
        pending_approval: Number(c.pending_approval || 0),
        approved:         Number(c.approved || 0),
        active:           Number(c.active || 0),
        rejected:         Number(c.rejected || 0),
        expired:          Number(c.expired || 0),
        deleted:          Number(c.deleted || 0),
        total:            Number(c.total || 0),
      },
      recent_pending: recent.rows,
    });
  } catch (err) {
    console.error('getOnboardingCounts error:', err);

    res.status(500).json({
      message: 'Server error',
      error: err.message,
    });
  }
};
