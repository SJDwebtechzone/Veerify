const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const {
  sendApprovalEmail, sendActivationEmail, sendBranchSetupEmail,
} = require('../utils/mailer');
const { createPaymentLink, verifyWebhookSignature } = require('../utils/razorpay');
const { insertNotification } = require('./notification.controller');
const { creditReferralReward, consumeDiscount } = require('./referral.controller');

// Same generator as the enrollment controller — 10-char mixed alphanum
// with confusable chars stripped (no O, 0, I, l, 1).
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(0, chars.length)];
  return pw;
}

// STEP 1: Admin selects a plan
exports.selectPlan = async (req, res) => {
  try {
    const { plan_id, referral_code } = req.body;
    const userId = req.user.id;

    if (!plan_id) {
      return res.status(400).json({ message: 'Plan ID is required' });
    }

    // Optional referral code — captured here on first plan selection. We
    // resolve it to a referrer institution and use it in the INSERT below.
    // Apply-after-the-fact is also possible via POST /api/referrals/apply.
    let referredBy = null;
    if (referral_code) {
      const code = String(referral_code).trim().toUpperCase();
      const ref = await pool.query(
        `SELECT id, owner_user_id FROM institutions
          WHERE referral_code = $1 AND deleted_at IS NULL`,
        [code],
      );
      if (ref.rows.length > 0) {
        referredBy = ref.rows[0].id;
        // Self-referral guard.
        if (ref.rows[0].owner_user_id === userId) referredBy = null;
      }
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

      // If a referral code was supplied AND this institution hasn't already
      // been referred AND hasn't paid yet, apply it now. (The earlier code
      // only did this for fresh-INSERT institutions, so admins who came
      // back to PlanSelection after first creating their academy were
      // silently losing the code.)
      if (
        referredBy &&
        !current.referred_by_institution_id &&
        !current.paid_at
      ) {
        try {
          await pool.query(
            `UPDATE institutions
                SET referred_by_institution_id = $1
              WHERE id = $2`,
            [referredBy, current.id],
          );
          const settingsRow = await pool.query(
            `SELECT points_per_referral FROM referral_settings WHERE id = 1`,
          );
          const pts = Number(settingsRow.rows[0]?.points_per_referral) || 500;
          await pool.query(
            `INSERT INTO referrals
               (referrer_institution_id, referred_institution_id,
                referral_code, status, reward_points)
             VALUES ($1, $2, $3, 'pending', $4)
             ON CONFLICT (referred_institution_id) DO NOTHING`,
            [referredBy, current.id, referral_code.toUpperCase(), pts],
          );

          // Notify the referrer that they got a pending referral (same
          // best-effort pattern used by /referrals/apply).
          try {
            const referrerOwner = await pool.query(
              `SELECT owner_user_id FROM institutions WHERE id = $1`,
              [referredBy],
            );
            const ownerId = referrerOwner.rows[0]?.owner_user_id;
            if (ownerId) {
              await insertNotification({
                user_id:        ownerId,
                institution_id: referredBy,
                category:       'system',
                title:          'New referral registered',
                message:        `${current.name || 'A new institution'} signed up with your referral code. You'll earn points once they pay their first subscription.`,
                data:           { screen: 'AdminReferEarn' },
              });
            }
          } catch (err) {
            console.warn('[selectPlan/existing] notify failed:', err?.message);
          }
        } catch (err) {
          console.warn('[selectPlan/existing] referral apply failed:', err?.message);
        }
      }

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
         (owner_user_id, plan_id, onboarding_status, name, status,
          referred_by_institution_id)
       VALUES ($1, $2, 'plan_selected', 'Unnamed Academy', 'pending', $3)
       RETURNING *`,
      [userId, plan_id, referredBy]
    );

    // If a referral code was applied, also insert a 'pending' referrals row
    // so the referrer's dashboard shows the new sign-up immediately.
    if (referredBy) {
      try {
        const settingsRow = await pool.query(
          `SELECT points_per_referral FROM referral_settings WHERE id = 1`,
        );
        const pts = Number(settingsRow.rows[0]?.points_per_referral) || 500;
        await pool.query(
          `INSERT INTO referrals
             (referrer_institution_id, referred_institution_id,
              referral_code, status, reward_points)
           VALUES ($1, $2, $3, 'pending', $4)
           ON CONFLICT (referred_institution_id) DO NOTHING`,
          [referredBy, newInst.rows[0].id, referral_code.toUpperCase(), pts],
        );
      } catch (err) {
        console.warn('[selectPlan] referrals insert failed:', err?.message);
      }
    }

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
// As of migration 014 the form is split into 5 categories. We accept every
// new field as optional (NULL-friendly) and validate only the minimum
// required by the legacy form. Required-field rules will tighten once the
// product team finalises the spec.
exports.setupAcademy = async (req, res) => {
  try {
    const {
      // ── Core Details ──
      name,
      brand_name,
      institution_type,         // legacy single value (kept for back-compat)
      institution_types,        // new TEXT[] of selected types
      registration_number,
      date_of_establishment,
      logo_url,

      // ── Contact & Location ──
      address,           // head office address
      city,
      pincode,
      no_of_branches,
      branches,          // array of { name, address, city, pincode }
      email,             // official email
      phone,             // primary contact number
      website_url,

      // ── Accreditation ──
      affiliation_or_board,
      accreditation_body_name,
      accreditation_expiry_date,
      accreditation_certificate_url,

      // ── Operations ──
      total_student_capacity,
      current_enrollment,                  // new — students currently enrolled
      medium_of_instruction,               // array of strings
      operating_hours,                     // legacy human-readable summary
      operating_hours_weekday,             // new — structured Mon–Fri slots
      operating_hours_weekend,             // new — structured Sat–Sun slots

      // ── Skills (Core step) — new TEXT[] of martial-arts disciplines.
      skills,

      // ── Geographic coordinates of the head office (new) ──
      latitude,
      longitude,

      // ── Point of Contact (Master) ──
      master_name,
      master_role,
      master_email,
      master_phone_number,
    } = req.body;

    const userId = req.user.id;

    // Mobile clients post `institution_types` (array). Older clients still
    // post `institution_type` (single string). Normalise to both:
    //   - typesArr: clean, de-duped array
    //   - primaryType: first entry (or the legacy string), kept in
    //     institution_type for back-compat with existing read paths.
    const typesArr = Array.isArray(institution_types)
      ? institution_types
          .map((t) => (typeof t === 'string' ? t.trim() : ''))
          .filter(Boolean)
          .filter((t, i, a) => a.indexOf(t) === i) // de-dupe
      : (institution_type ? [String(institution_type).trim()] : []);
    const primaryType = typesArr[0] || null;

    // Minimum-viable validation. Anything else is optional until the spec
    // is finalised.
    if (!name || !primaryType || !email || !phone || !address || !registration_number || !master_name) {
      return res.status(400).json({
        message: 'Please fill all required fields: institution name, at least one type, official email, primary phone, head office address, registration number and master name.',
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

    // Normalise array / json inputs so pg doesn't blow up on bad shapes.
    // Branches now carry per-row email + contact_number (added on mobile);
    // we whitelist the known fields so a typo / extra prop on the client
    // can't bloat the jsonb.
    const sanitiseBranches = (raw) => {
      if (!Array.isArray(raw)) return [];
      return raw.map((b) => ({
        name:           (b?.name || '').toString().trim(),
        address:        (b?.address || '').toString().trim(),
        city:           (b?.city || '').toString().trim(),
        pincode:        (b?.pincode || '').toString().trim(),
        email:          (b?.email || '').toString().trim(),
        contact_number: (b?.contact_number || '').toString().trim(),
        latitude:       (b?.latitude  != null && b.latitude  !== '') ? Number(b.latitude)  : null,
        longitude:      (b?.longitude != null && b.longitude !== '') ? Number(b.longitude) : null,
      }));
    };
    const safeBranches = JSON.stringify(sanitiseBranches(branches));
    const safeMedium = Array.isArray(medium_of_instruction)
      ? medium_of_instruction
      : (medium_of_instruction ? [String(medium_of_instruction)] : null);

    // Skills — TEXT[]. Same cleanup as institution_types.
    const safeSkills = Array.isArray(skills)
      ? skills
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean)
          .filter((s, i, a) => a.indexOf(s) === i)
      : null;

    // Operating-hours slot arrays — jsonb. Drop anything that doesn't
    // have both start AND end so we never persist half-typed rows.
    const sanitiseSlots = (raw) => {
      if (!Array.isArray(raw)) return null;
      const cleaned = raw
        .map((s) => ({
          start: typeof s?.start === 'string' ? s.start.trim() : '',
          end:   typeof s?.end   === 'string' ? s.end.trim()   : '',
        }))
        .filter((s) => s.start && s.end);
      return cleaned.length ? JSON.stringify(cleaned) : null;
    };
    const safeHoursWeekday = sanitiseSlots(operating_hours_weekday);
    const safeHoursWeekend = sanitiseSlots(operating_hours_weekend);

    // Numeric coordinates — coerce + validate. Out-of-range values are
    // silently dropped to NULL instead of failing the whole save.
    const toLatLng = (v, kind) => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (kind === 'lat' && (n < -90  || n > 90))  return null;
      if (kind === 'lng' && (n < -180 || n > 180)) return null;
      return n;
    };
    const safeLatitude  = toLatLng(latitude,  'lat');
    const safeLongitude = toLatLng(longitude, 'lng');

    // current_enrollment — non-negative integer or null.
    const safeCurrentEnrollment = (() => {
      if (current_enrollment === '' || current_enrollment == null) return null;
      const n = Number(current_enrollment);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    })();

    // Update institution with all details. Order of $-params matters; keep
    // grouped by category for sanity when reading SQL. `institution_types`
    // holds the canonical array; `institution_type` mirrors the first entry
    // so legacy SELECT paths keep working.
    const updated = await pool.query(
      `UPDATE institutions SET
         -- core details
         name                          = $1,
         brand_name                    = $2,
         institution_type              = $3,
         institution_types             = $4,
         registration_number           = $5,
         date_of_establishment         = $6,
         logo_url                      = $7,
         skills                        = $8,
         -- contact & location
         address                       = $9,
         city                          = $10,
         pincode                       = $11,
         no_of_branches                = $12,
         branches                      = $13::jsonb,
         email                         = $14,
         phone                         = $15,
         website_url                   = $16,
         latitude                      = $17,
         longitude                     = $18,
         -- accreditation
         affiliation_or_board          = $19,
         accreditation_body_name       = $20,
         accreditation_expiry_date     = $21,
         accreditation_certificate_url = $22,
         -- operations
         total_student_capacity        = $23,
         current_enrollment            = $24,
         medium_of_instruction         = $25,
         operating_hours               = $26,
         operating_hours_weekday       = $27::jsonb,
         operating_hours_weekend       = $28::jsonb,
         -- point of contact
         master_name                   = $29,
         master_role                   = $30,
         master_email                  = $31,
         master_phone_number           = $32,
         -- lifecycle
         onboarding_status             = 'pending_approval',
         status                        = 'pending'
       WHERE owner_user_id = $33
       RETURNING *`,
      [
        name,
        brand_name || null,
        primaryType,
        typesArr,
        registration_number,
        date_of_establishment || null,
        logo_url || null,
        safeSkills,

        address,
        city || null,
        pincode || null,
        no_of_branches != null ? Number(no_of_branches) : 0,
        safeBranches,
        email,
        phone,
        website_url || null,
        safeLatitude,
        safeLongitude,

        affiliation_or_board || null,
        accreditation_body_name || null,
        accreditation_expiry_date || null,
        accreditation_certificate_url || null,

        total_student_capacity != null ? Number(total_student_capacity) : null,
        safeCurrentEnrollment,
        safeMedium,
        operating_hours || null,
        safeHoursWeekday,
        safeHoursWeekend,

        master_name,
        master_role || null,
        master_email || null,
        master_phone_number || null,

        userId,
      ]
    );

    // ── Provision each branch as an independent institution ────────────
    // Each branch with a non-empty email becomes:
    //   1. A fresh `users` row (admin role, auto-generated password).
    //   2. A child `institutions` row that inherits the parent's plan,
    //      paid_at, subscription_end and onboarding_status so it lights
    //      up the moment the parent does. parent_institution_id links
    //      it back to the head office.
    // The branch admin gets an email with their own login credentials.
    // We fire each branch email without awaiting so a slow SMTP doesn't
    // block the setup response, but the DB inserts ARE awaited so the
    // child rows exist before we return.
    try {
      const branchRows = sanitiseBranches(branches);
      const ownerRow = await pool.query(
        'SELECT name, email FROM users WHERE id = $1',
        [req.user.id],
      );
      const ownerName = ownerRow.rows[0]?.name || '';
      const parentInst = updated.rows[0];

      for (const b of branchRows) {
        if (!b.email) continue;
        const branchEmail = b.email.toLowerCase().trim();

        // Skip if this branch email is already a user — avoids dup-key
        // crashes on rerun and keeps the provisioning idempotent.
        const existing = await pool.query(
          'SELECT id, institution_id FROM users WHERE LOWER(email) = $1',
          [branchEmail],
        );
        if (existing.rows.length > 0) {
          console.log(`[setup] branch ${branchEmail} already has a user — skipping provision`);
          continue;
        }

        // 1. Create the branch admin user.
        const tempPassword = generateTempPassword();
        const hashed = await bcrypt.hash(tempPassword, 10);
        const branchAdminName = `${b.name || 'Branch'} Admin`;
        const newUser = await pool.query(
          `INSERT INTO users (name, email, phone, password, role, status)
           VALUES ($1, $2, $3, $4, 'admin', 'active')
           RETURNING id`,
          [branchAdminName, branchEmail, b.contact_number || null, hashed],
        );
        const branchUserId = newUser.rows[0].id;

        // 2. Create a child institutions row inheriting parent's plan +
        //    lifecycle so the subscription guard and plan-cap checks
        //    pass for the branch without a second payment.
        const childInst = await pool.query(
          `INSERT INTO institutions (
             owner_user_id, parent_institution_id, name, brand_name,
             institution_type, institution_types,
             address, city, pincode, email, phone,
             plan_id, onboarding_status, status,
             paid_at, subscription_start, subscription_end,
             trial_starts_at, trial_ends_at, grace_ends_at
           )
           VALUES (
             $1, $2, $3, $4,
             $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14,
             $15, $16, $17,
             $18, $19, $20
           )
           RETURNING id`,
          [
            branchUserId,
            parentInst.id,
            b.name || `${name} - Branch`,
            parentInst.brand_name,
            parentInst.institution_type,
            parentInst.institution_types,
            b.address || parentInst.address,
            b.city || parentInst.city,
            b.pincode || parentInst.pincode,
            branchEmail,
            b.contact_number || parentInst.phone,
            parentInst.plan_id,
            parentInst.onboarding_status,
            parentInst.status,
            parentInst.paid_at,
            parentInst.subscription_start,
            parentInst.subscription_end,
            parentInst.trial_starts_at,
            parentInst.trial_ends_at,
            parentInst.grace_ends_at,
          ],
        );

        // Back-link the user row to its institution so JWT scoping works.
        await pool.query(
          'UPDATE users SET institution_id = $1 WHERE id = $2',
          [childInst.rows[0].id, branchUserId],
        );

        // 3. Email the branch admin their credentials (fire-and-forget).
        const branchAddress = [b.address, b.city, b.pincode].filter(Boolean).join(', ');
        sendBranchSetupEmail({
          to:              branchEmail,
          branchName:      b.name,
          branchAddress,
          institutionName: name,
          ownerName,
          loginEmail:      branchEmail,
          loginPassword:   tempPassword,
        }).catch((err) => console.error('[setup] branch email failed:', err?.message));
      }
    } catch (err) {
      // Don't fail the whole setup if branch provisioning blows up — the
      // head office is still saved, super admin can re-run via a future
      // "Resend branch credentials" tool.
      console.error('[setup] branch provisioning loop failed:', err?.message);
    }

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

    // ── Map trial lifecycle → navigation status ────────────────────────────
    // The mobile navigator routes by `status`:
    //   'active'           → AdminDashboard
    //   'approved' / 'payment_pending' → PaymentScreen
    // During the free trial / grace period the institution is functionally
    // active (full feature access; the dashboard banner nags about payment).
    // Only when grace has expired AND they haven't paid do we force the
    // payment screen. This is the difference between "you may pay" and
    // "you must pay to continue".
    let effectiveStatus = inst.onboarding_status;
    if (inst.onboarding_status === 'approved') {
      const now  = Date.now();
      const paid = !!inst.paid_at;
      const tEnd = inst.trial_ends_at ? new Date(inst.trial_ends_at).getTime() : null;
      const gEnd = inst.grace_ends_at ? new Date(inst.grace_ends_at).getTime() : null;

      if (paid) {
        effectiveStatus = 'active';
      } else if (tEnd && now <= tEnd) {
        // Trial active — full free access.
        effectiveStatus = 'active';
      } else if (gEnd && now <= gEnd) {
        // Grace period — still allowed in, but banner pushes them to pay.
        effectiveStatus = 'active';
      } else if (tEnd) {
        // Trial+grace exhausted without payment — hard lock.
        effectiveStatus = 'payment_pending';
      }
      // Else (no trial_ends_at): legacy approved row from before the trial
      // concept existed — keep the old payment-first behaviour.
    }

    res.json({
      // When the row is soft-deleted, onboarding_status is already 'deleted'.
      // We also send back the snapshot of the previous status so the mobile
      // app can say "Your previously-active academy was deleted" vs.
      // "Your pending application was deleted".
      status: effectiveStatus,
      onboarding_status_raw: inst.onboarding_status,
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

// ─────────────────────────────────────────────────────────────────────────────
// Subscription lifecycle: trial / grace / locked / paid
// ─────────────────────────────────────────────────────────────────────────────
//
// Each institution's lifecycle phase is derived from three timestamps on the
// row (trial_starts_at, trial_ends_at, grace_ends_at — populated when the
// super admin approves the row) plus paid_at:
//
//   paid_at IS NOT NULL          -> 'paid'      (active subscription)
//   trial_ends_at IS NULL        -> 'pending'   (not approved yet)
//   NOW() <= trial_ends_at       -> 'trial'     (free access, no payment needed)
//   NOW() <= grace_ends_at       -> 'grace'     (must pay now to keep using app)
//   NOW() > grace_ends_at        -> 'locked'    (hard-locked until they pay)
//
// The mobile admin app polls this on dashboard mount to decide whether to
// show the trial banner / grace warning / lock overlay, and what amount to
// charge (applies plan.discount).
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT i.id, i.name, i.onboarding_status, i.paid_at,
              i.trial_starts_at, i.trial_ends_at, i.grace_ends_at,
              i.payment_link_url, i.payment_link_status,
              sp.id    AS plan_id,
              sp.name  AS plan_name,
              sp.price AS plan_price,
              sp.billing_cycle    AS plan_billing_cycle,
              sp.trial_days       AS plan_trial_days,
              sp.grace_days       AS plan_grace_days,
              sp.discount_enabled AS plan_discount_enabled,
              sp.discount_percent AS plan_discount_percent,
              sp.max_students     AS plan_max_students,
              sp.max_trainers     AS plan_max_trainers
       FROM institutions i
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.owner_user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ phase: 'registered', institution: null });
    }

    const r = result.rows[0];
    const now = new Date();

    // Compute phase.
    let phase;
    if (r.paid_at) {
      phase = 'paid';
    } else if (!r.trial_ends_at) {
      phase = 'pending';
    } else if (now <= new Date(r.trial_ends_at)) {
      phase = 'trial';
    } else if (r.grace_ends_at && now <= new Date(r.grace_ends_at)) {
      phase = 'grace';
    } else {
      phase = 'locked';
    }

    // Days remaining (ceil so a few hours left still reads as "1 day").
    const daysLeft = (target) => {
      if (!target) return null;
      const ms = new Date(target).getTime() - now.getTime();
      return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
    };

    // Effective price the academy will pay — plan price minus discount.
    const basePrice   = Number(r.plan_price) || 0;
    const discountOn  = !!r.plan_discount_enabled;
    const discountPct = Number(r.plan_discount_percent) || 0;
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;

    // ── Derived dates for the Pricing & Plans screen ────────────────
    // subscription_started_at: when this academy entered its current
    // billing window. After payment it's paid_at; during trial it's
    // trial_starts_at; otherwise unknown.
    const subscriptionStartedAt = r.paid_at || r.trial_starts_at || null;

    // next_renewal_at:
    //   - Paid: started + 1 month (or 1 year if yearly billing)
    //   - Trial: trial_ends_at (i.e. when they need to pay to continue)
    //   - Grace: grace_ends_at (hard cut-off)
    //   - Pending/locked: null
    const addPeriod = (iso, cycle) => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      if (String(cycle).toLowerCase() === 'yearly') {
        d.setFullYear(d.getFullYear() + 1);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d.toISOString();
    };
    let nextRenewalAt = null;
    if (phase === 'paid' && r.paid_at) {
      nextRenewalAt = addPeriod(r.paid_at, r.plan_billing_cycle);
    } else if (phase === 'trial') {
      nextRenewalAt = r.trial_ends_at;
    } else if (phase === 'grace') {
      nextRenewalAt = r.grace_ends_at;
    }

    res.json({
      phase,
      institution_id: r.id,
      institution_name: r.name,
      onboarding_status: r.onboarding_status,
      trial_starts_at:  r.trial_starts_at,
      trial_ends_at:    r.trial_ends_at,
      grace_ends_at:    r.grace_ends_at,
      days_left_in_trial: daysLeft(r.trial_ends_at),
      days_left_in_grace: daysLeft(r.grace_ends_at),
      plan: {
        id: r.plan_id,
        name: r.plan_name,
        price: basePrice,
        billing_cycle: r.plan_billing_cycle || 'monthly',
        trial_days: Number(r.plan_trial_days) || 0,
        grace_days: Number(r.plan_grace_days) || 0,
        discount_enabled: discountOn,
        discount_percent: discountPct,
        effective_price: effectivePrice,
        max_students: r.plan_max_students,
        max_trainers: r.plan_max_trainers,
      },
      payment_link_url:    r.payment_link_url || null,
      payment_link_status: r.payment_link_status || null,
      paid_at:             r.paid_at || null,
      subscription_started_at: subscriptionStartedAt,
      next_renewal_at:         nextRenewalAt,
    });
  } catch (err) {
    console.error('Subscription status error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
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

    // Pull institution + owner + plan in one shot. The trial/grace/discount
    // columns on subscription_plans drive what trial window we open here and
    // what we actually charge.
    const instResult = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price,
              sp.trial_days AS plan_trial_days,
              sp.grace_days AS plan_grace_days,
              sp.discount_enabled AS plan_discount_enabled,
              sp.discount_percent AS plan_discount_percent
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

    // Effective price = plan price with discount applied if enabled. We round
    // to the nearest rupee so the Razorpay link doesn't end up with paise.
    const trialDays   = Number(institution.plan_trial_days)   || 0;
    const graceDays   = Number(institution.plan_grace_days)   || 0;
    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const basePrice   = Number(institution.plan_price);
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;

    // Flip status to approved AND open the trial window in the same write so
    // we don't end up with an approved institution that has no trial_ends_at
    // (which would look like "locked" to the gating logic).
    //
    // After approval the academy goes straight into trial — they get full
    // app access for trial_days. Within (trial_days + grace_days), they
    // must pay. After that they're locked until they do.
    await pool.query(
      `UPDATE institutions SET
         onboarding_status = 'approved',
         status            = 'approved',
         approved_by       = $1,
         approved_at       = NOW(),
         trial_starts_at   = NOW(),
         trial_ends_at     = NOW() + ($3 || ' days')::interval,
         grace_ends_at     = NOW() + (($3::int + $4::int) || ' days')::interval
       WHERE id = $2`,
      [adminId, id, trialDays, graceDays]
    );

    const warnings = [];

    // 3a. Apply referral-wallet discount (if any) before generating the link.
    //     This is the FIRST renewal payment so we consume points here.
    let referralDiscount = 0;
    try {
      const ref = await consumeDiscount(id, effectivePrice);
      referralDiscount = ref.discount || 0;
    } catch (err) {
      console.warn('[approve] referral discount failed:', err?.message);
    }
    const finalPayable = Math.max(0, effectivePrice - referralDiscount);

    // 3b. Create payment link at the FINAL price (after plan discount and
    //     referral discount).
    const linkResult = await createPaymentLink({
      amountInRupees: finalPayable,
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

    // 4. Email the owner. Previously this was gated on `linkResult.ok` which
    //    meant a Razorpay misconfiguration silently swallowed the approval
    //    notice. Now the email always goes out — when there's no link we send
    //    a "you've been approved, payment link to follow" version so the
    //    institution at least knows the super admin acted on their request.
    const mailResult = await sendApprovalEmail({
      to:              institution.owner_email,
      ownerName:       institution.owner_name,
      institutionName: institution.name,
      planName:        institution.plan_name,
      planPrice:       institution.plan_price,
      paymentUrl:      linkResult.ok ? linkResult.link.short_url : null,
      trialDays,
      graceDays,
      effectivePrice,
      discountEnabled: discountOn,
      discountPercent: discountPct,
    });
    if (!mailResult.ok) {
      warnings.push(`Email not sent: ${mailResult.error}`);
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
              sp.name AS plan_name, sp.price AS plan_price,
              sp.discount_enabled AS plan_discount_enabled,
              sp.discount_percent AS plan_discount_percent
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

    // Same discount math as approveInstitution so a resend doesn't accidentally
    // charge full price.
    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const basePrice   = Number(institution.plan_price);
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;

    const linkResult = await createPaymentLink({
      amountInRupees: effectivePrice,
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
    // Was this institution already paid before this call? If so, we skip the
    // referral credit so manual re-activations don't double-credit.
    const preFlight = await pool.query(
      `SELECT paid_at FROM institutions WHERE id = $1`, [id],
    );
    const wasAlreadyPaid = !!preFlight.rows[0]?.paid_at;

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

    // Credit the referring institution (if any) — best effort.
    if (!wasAlreadyPaid) {
      creditReferralReward(Number(id)).catch((err) =>
        console.warn('[activate] referral credit failed:', err?.message),
      );
    }

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
    // Track whether this is the first-ever paid event, so we only credit
    // the referrer once per institution.
    const wasAlreadyPaid = !!institution.paid_at;

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

    // Credit the referring institution (if any) — best effort, after commit.
    if (!wasAlreadyPaid) {
      creditReferralReward(institution.id).catch((err) =>
        console.warn('[webhook] referral credit failed:', err?.message),
      );
    }

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
// GET /api/onboarding/recent-payments
//
// Subscription payments made by institutions. Powers the "Recent Payments"
// table on the super admin web dashboard.
//
// Notes:
//   - payment_amount stored in PAISE in the institutions table (Razorpay
//     convention), so we divide by 100 to return rupees to the client.
//   - Returns the Razorpay payment_link_id when available (live Razorpay
//     flow) and falls back to payment_reference (used by the mock pay
//     flow). The client decides which to show as the payment id.
// ─────────────────────────────────────────────────────────────────────────────
exports.getRecentInstitutionPayments = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         i.id                  AS institution_id,
         i.name                AS institution_name,
         i.logo_url,
         i.payment_link_id,
         i.payment_link_url,
         i.payment_link_status,
         i.payment_reference,
         (i.payment_amount / 100.0)::numeric(10,2) AS amount_inr,
         i.paid_at,
         i.subscription_start,
         i.subscription_end,
         sp.name  AS plan_name,
         sp.price AS plan_price,
         u.name   AS owner_name,
         u.email  AS owner_email
       FROM institutions i
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       LEFT JOIN users u ON i.owner_user_id = u.id
       WHERE i.paid_at IS NOT NULL
         AND i.deleted_at IS NULL
       ORDER BY i.paid_at DESC
       LIMIT 25`,
    );

    res.json({
      count: result.rows.length,
      payments: result.rows,
    });
  } catch (err) {
    console.error('getRecentInstitutionPayments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN: send a notification to an institution.
// POST /api/onboarding/:id/notify   body: { title, message?, category? }
//
// Resolves the institution's owner_user_id and drops a notification row in
// that user's inbox. The owner sees it on next sync of the bell icon in
// the mobile admin app. Used by the platform super admin in veerify_admin_web
// to ping individual institutions ("Your renewal is due", "New feature
// available", etc.).
// ─────────────────────────────────────────────────────────────────────────────
exports.notifyInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, category } = req.body || {};
    const senderId = req.user?.id || null;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const instResult = await pool.query(
      `SELECT id, name, owner_user_id FROM institutions WHERE id = $1`,
      [id],
    );
    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    const institution = instResult.rows[0];
    if (!institution.owner_user_id) {
      return res.status(400).json({
        message: 'Institution has no linked owner user',
      });
    }

    const inserted = await insertNotification({
      user_id:        institution.owner_user_id,
      institution_id: institution.id,
      category:       category || 'system',
      title:          String(title).trim(),
      message:        message ? String(message).trim() : null,
      data:           { source: 'super_admin', institution_id: institution.id },
      created_by:     senderId,
    });

    res.status(201).json({
      message: `Notification sent to ${institution.name}.`,
      notification: inserted,
    });
  } catch (err) {
    console.error('notifyInstitution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN: broadcast a notification to many institutions at once.
// POST /api/onboarding/notify-bulk
//   body: {
//     scope: 'all' | 'active' | 'pending' | 'specific',
//     institution_ids?: number[],   // required when scope === 'specific'
//     title: string,
//     message?: string,
//     category?: string,
//   }
//
// Resolves the scope to a list of institutions, fans out one notification
// per owner inside a single transaction, returns delivered + skipped counts.
// Soft-deleted institutions are always skipped (the owner can't read their
// inbox in a deleted state anyway).
// ─────────────────────────────────────────────────────────────────────────────
exports.notifyInstitutionsBulk = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      scope = 'active',
      institution_ids,
      title,
      message,
      category,
    } = req.body || {};
    const senderId = req.user?.id || null;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Build the WHERE clause per scope. All scopes drop soft-deleted rows.
    let whereSql = 'deleted_at IS NULL AND owner_user_id IS NOT NULL';
    const params = [];

    switch (scope) {
      case 'all':
        // No extra filter - every non-deleted institution with an owner.
        break;
      case 'active':
        whereSql += ` AND onboarding_status = 'active'`;
        break;
      case 'pending':
        whereSql += ` AND onboarding_status = 'pending_approval'`;
        break;
      case 'specific':
        if (!Array.isArray(institution_ids) || institution_ids.length === 0) {
          return res.status(400).json({
            message: 'institution_ids must be a non-empty array when scope is "specific"',
          });
        }
        params.push(institution_ids);
        whereSql += ` AND id = ANY($${params.length}::int[])`;
        break;
      default:
        return res.status(400).json({ message: `Unknown scope: ${scope}` });
    }

    const targets = await pool.query(
      `SELECT id, name, owner_user_id FROM institutions WHERE ${whereSql}`,
      params,
    );

    if (targets.rows.length === 0) {
      return res.status(400).json({
        message: 'No institutions matched the selected scope',
      });
    }

    await client.query('BEGIN');
    let delivered = 0;
    for (const inst of targets.rows) {
      try {
        await insertNotification({
          user_id:        inst.owner_user_id,
          institution_id: inst.id,
          category:       category || 'system',
          title:          String(title).trim(),
          message:        message ? String(message).trim() : null,
          data:           { source: 'super_admin', scope },
          created_by:     senderId,
        }, client);
        delivered += 1;
      } catch (err) {
        // Swallow per-row failures so one bad row doesn't roll back the
        // whole broadcast. We surface the skipped count in the response.
        console.warn(`[notify-bulk] insert failed for inst=${inst.id}:`, err.message);
      }
    }
    await client.query('COMMIT');

    res.status(201).json({
      message: `Notification sent to ${delivered} ${delivered === 1 ? 'institution' : 'institutions'}.`,
      delivered_count: delivered,
      skipped_count:   targets.rows.length - delivered,
      scope,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('notifyInstitutionsBulk error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
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
    // Four queries in parallel: institution summary, recent pending list,
    // platform-wide people totals, and the platform MRR (sum of plan price
    // for every currently-active institution = the monthly subscription
    // revenue the super admin sees on the dashboard).
    const [summary, recent, peopleCounts, mrrRow] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE onboarding_status = 'pending_approval' AND deleted_at IS NULL) AS pending_approval,
          COUNT(*) FILTER (WHERE onboarding_status = 'approved'         AND deleted_at IS NULL) AS approved,
          COUNT(*) FILTER (WHERE onboarding_status = 'active'           AND deleted_at IS NULL) AS active,
          COUNT(*) FILTER (WHERE onboarding_status = 'rejected'         AND deleted_at IS NULL) AS rejected,
          COUNT(*) FILTER (WHERE subscription_end IS NOT NULL AND subscription_end < NOW() AND deleted_at IS NULL) AS expired,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)                AS deleted,
          COUNT(*) FILTER (WHERE deleted_at IS NULL)                    AS total
        FROM institutions
      `),
      pool.query(`
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
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'student' AND COALESCE(is_deleted, false) = false) AS total_students,
          COUNT(*) FILTER (WHERE role = 'trainer' AND COALESCE(is_deleted, false) = false) AS total_trainers,
          COUNT(*) FILTER (WHERE role = 'parent'  AND COALESCE(is_deleted, false) = false) AS total_parents
        FROM users
      `),
      // Monthly Recurring Revenue: sum of plan price for every currently-
      // active institution. Institutions without a linked plan contribute 0.
      pool.query(`
        SELECT COALESCE(SUM(sp.price), 0)::numeric AS monthly_revenue
        FROM institutions i
        LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
        WHERE i.onboarding_status = 'active'
          AND i.deleted_at IS NULL
      `),
    ]);

    const c = summary.rows[0] || {};
    const p = peopleCounts.rows[0] || {};
    const m = mrrRow.rows[0] || {};
    res.json({
      counts: {
        pending_approval: Number(c.pending_approval || 0),
        approved:         Number(c.approved || 0),
        active:           Number(c.active || 0),
        rejected:         Number(c.rejected || 0),
        expired:          Number(c.expired || 0),
        deleted:          Number(c.deleted || 0),
        total:            Number(c.total || 0),
        total_students:   Number(p.total_students || 0),
        total_trainers:   Number(p.total_trainers || 0),
        total_parents:    Number(p.total_parents || 0),
        monthly_revenue:  Number(m.monthly_revenue || 0),
      },
      recent_pending: recent.rows,
    });
  } catch (err) {
    console.error('getOnboardingCounts error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Generate a Razorpay renewal payment link for the logged-in admin ──────
// POST /api/onboarding/renew
exports.createRenewalPaymentLink = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { rows } = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price,
              sp.discount_enabled AS plan_discount_enabled,
              sp.discount_percent AS plan_discount_percent
         FROM institutions i
         JOIN users u ON i.owner_user_id = u.id
         LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
        WHERE u.id = $1
           OR i.id = (SELECT institution_id FROM users WHERE id = $1)
        LIMIT 1`,
      [userId],
    );
    const institution = rows[0];
    if (!institution) {
      return res.status(404).json({ message: 'Institution not found for this account' });
    }
    if (!institution.plan_price) {
      return res.status(400).json({ message: 'No active plan to renew. Please pick a plan first.' });
    }

    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const basePrice   = Number(institution.plan_price);
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;

    // ── Apply referral wallet discount to the next renewal ───────────
    // consumeDiscount debits the institution's accumulated referral
    // wallet (₹250 per referral that landed) and returns the rupee
    // discount we should subtract from the renewal price. Capped by
    // settings.max_discount_pct.
    let referralDiscount = 0;
    try {
      const r = await consumeDiscount(institution.id, effectivePrice);
      referralDiscount = Number(r?.discount) || 0;
    } catch (err) {
      console.warn('[renew] referral discount failed:', err?.message);
    }
    const finalPayable = Math.max(0, effectivePrice - referralDiscount);

    const linkResult = await createPaymentLink({ amountInRupees: finalPayable, institution });
    if (!linkResult.ok) {
      return res.status(502).json({ message: `Could not create payment link: ${linkResult.error}` });
    }

    await pool.query(
      `UPDATE institutions SET
         payment_link_id     = $1,
         payment_link_url    = $2,
         payment_link_status = 'pending',
         payment_amount      = $3
       WHERE id = $4`,
      [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, institution.id],
    );

    res.json({
      message: 'Renewal payment link created',
      payment_link_url: linkResult.link.short_url,
      amount: finalPayable,
      base_price: effectivePrice,
      referral_discount: referralDiscount,
      plan_name: institution.plan_name,
    });
  } catch (err) {
    console.error('createRenewalPaymentLink error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
