const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const {
  sendApprovalEmail, sendActivationEmail, sendBranchSetupEmail,
  sendTrialWelcomeEmail,
} = require('../utils/mailer');
const { dispatchWelcomeSms } = require('../utils/smsService');
// Welcome WhatsApp — one-time, plan-gated. Fired here (not in the
// register endpoint) because admin self-signup has no institution
// linked yet at register time; the plan gate can only be evaluated
// after approval. See services/whatsapp.service.js for the guards.
const { sendWelcomeMessage: sendWelcomeWhatsApp } = require('../services/whatsapp.service');
const { createPaymentLink, verifyWebhookSignature } = require('../utils/razorpay');
const { computeGst, totalPayable, GST_PERCENT_DEFAULT } = require('../utils/gst');
// Resume Registration completion stamp — swallows 42703 when
// migration 077 hasn't been applied yet so a stale schema can't
// rollback the activation transaction.
const { markRegistrationComplete } = require('../utils/registrationStatus');
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
    const { plan_id, referral_code, billing_term } = req.body;
    const userId = req.user.id;

    if (!plan_id) {
      return res.status(400).json({ message: 'Plan ID is required' });
    }

    // Optional billing_term (mobile's plan card picks one of monthly /
    // quarterly / half_yearly / annual). Anything else is coerced to
    // null so the payment step falls back to plan.billing_cycle.
    const VALID_TERMS = new Set(['monthly', 'quarterly', 'half_yearly', 'annual']);
    const cleanTerm = VALID_TERMS.has(billing_term) ? billing_term : null;

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

      // COALESCE keeps the previous billing_term when the client
      // didn't send one (e.g. legacy mobile builds); when it did,
      // the new pick overrides so the payment step uses the right price.
      const updated = await pool.query(
        allowStatusReset
          ? `UPDATE institutions
               SET plan_id = $1,
                   onboarding_status = 'plan_selected',
                   selected_billing_term = COALESCE($3, selected_billing_term)
             WHERE owner_user_id = $2
             RETURNING *`
          : `UPDATE institutions
               SET plan_id = $1,
                   selected_billing_term = COALESCE($3, selected_billing_term)
             WHERE owner_user_id = $2
             RETURNING *`,
        [plan_id, userId, cleanTerm],
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

    // Create new institution with plan selected + billing_term.
    const newInst = await pool.query(
      `INSERT INTO institutions
         (owner_user_id, plan_id, onboarding_status, name, status,
          referred_by_institution_id, selected_billing_term)
       VALUES ($1, $2, 'plan_selected', 'Unnamed Academy', 'pending', $3, $4)
       RETURNING *`,
      [userId, plan_id, referredBy, cleanTerm]
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

    // ── Column-length guard ────────────────────────────────────────
    // Several institutions columns still carry VARCHAR(N) limits from
    // the original schema (name / brand_name / affiliation / master_*
    // etc.). A slightly-oversize input from the mobile wizard used to
    // fail the whole setup with `22001 value too long for type
    // character varying(150)`. We truncate every string on the way in
    // so a chatty free-text field can never block the save; the DB
    // still enforces the limit for anything downstream.
    const cap = (v, n) => {
      if (v === null || v === undefined) return v;
      const s = String(v);
      return s.length > n ? s.slice(0, n) : s;
    };
    const nameCap                   = cap(name, 150);
    const brandNameCap              = cap(brand_name || null, 150);
    const primaryTypeCap            = cap(primaryType, 50);
    const registrationNumberCap     = cap(registration_number, 100);
    const logoUrlCap                = cap(logo_url || null, 500);
    const addressStr                = address == null ? null : String(address); // address column is TEXT
    const cityCap                   = cap(city || null, 80);
    const pincodeCap                = cap(pincode || null, 10);
    const emailCap                  = cap(email, 150);
    const phoneCap                  = cap(phone, 20);
    const websiteUrlCap             = cap(website_url || null, 500);
    const affiliationCap            = cap(affiliation_or_board || null, 150);
    const accreditationBodyCap      = cap(accreditation_body_name || null, 150);
    const accreditationCertUrlCap   = cap(accreditation_certificate_url || null, 500);
    const operatingHoursCap         = cap(operating_hours || null, 150);
    const masterNameCap             = cap(master_name, 100);
    const masterRoleCap             = cap(master_role || null, 100);
    const masterEmailCap            = cap(master_email || null, 150);
    const masterPhoneCap            = cap(master_phone_number || null, 20);

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
        nameCap,
        brandNameCap,
        primaryTypeCap,
        typesArr,
        registrationNumberCap,
        date_of_establishment || null,
        logoUrlCap,
        safeSkills,

        addressStr,
        cityCap,
        pincodeCap,
        no_of_branches != null ? Number(no_of_branches) : 0,
        safeBranches,
        emailCap,
        phoneCap,
        websiteUrlCap,
        safeLatitude,
        safeLongitude,

        affiliationCap,
        accreditationBodyCap,
        accreditation_expiry_date || null,
        accreditationCertUrlCap,

        total_student_capacity != null ? Number(total_student_capacity) : null,
        safeCurrentEnrollment,
        safeMedium,
        operatingHoursCap,
        safeHoursWeekday,
        safeHoursWeekend,

        masterNameCap,
        masterRoleCap,
        masterEmailCap,
        masterPhoneCap,

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
          // must_change_password is TRUE on first provisioning so the
          // mobile pops the "change password / I'll do it later" dialog
          // the first time this branch admin signs in.
          `INSERT INTO users (name, email, phone, password, role, status,
                              must_change_password)
           VALUES ($1, $2, $3, $4, 'admin', 'active', TRUE)
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

        // 4. Welcome SMS to the branch admin so they can log in even
        //    without checking email. Fire-and-forget: MSG91 outages
        //    never break the head-office setup flow.
        dispatchWelcomeSms({
          phone:        b.contact_number,
          name:         branchAdminName,
          role:         'branch',
          loginId:      branchEmail,
          tempPassword,
        });
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

    let inst = result.rows[0];

    // ── Branch admin fix ─────────────────────────────────────────
    // Sub-branch institutions carry parent_institution_id and their
    // own onboarding_status is not driven through the approval
    // pipeline (they inherit whatever the root academy is doing).
    // Without this, a branch admin's /my-status returned the
    // sub-branch's raw onboarding_status (often NULL or the pre-
    // approval placeholder), so the mobile navigator dumped them on
    // the "Request Submitted" screen instead of the Branch Dashboard.
    //
    // For sub-branches we re-fetch the ROOT institution row and use
    // its onboarding_status + paid_at + trial/grace timestamps for
    // the trial→active mapping below, while KEEPING the branch's own
    // row in the response so the mobile still identifies the caller's
    // branch (branch name, city, etc.).
    let effectiveOnboardingSource = inst;
    let isSubBranch = false;
    if (inst.parent_institution_id) {
      isSubBranch = true;
      try {
        const rootRes = await pool.query(
          `SELECT i.*, sp.name AS plan_name, sp.price AS plan_price,
                  sp.features AS plan_features
             FROM institutions i
             LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
            WHERE i.id = $1`,
          [inst.parent_institution_id],
        );
        if (rootRes.rows.length > 0) {
          effectiveOnboardingSource = rootRes.rows[0];
          // Merge the plan + lifecycle columns from the root over the
          // branch row so the mobile's downstream reads (plan name,
          // trial dates, paid_at, subscription_status) all reflect
          // the parent academy's subscription, which is what actually
          // gates branch access.
          inst = {
            ...inst,
            plan_id:            effectiveOnboardingSource.plan_id,
            plan_name:          effectiveOnboardingSource.plan_name,
            plan_price:         effectiveOnboardingSource.plan_price,
            plan_features:      effectiveOnboardingSource.plan_features,
            onboarding_status:  effectiveOnboardingSource.onboarding_status,
            paid_at:            effectiveOnboardingSource.paid_at,
            trial_starts_at:    effectiveOnboardingSource.trial_starts_at,
            trial_ends_at:      effectiveOnboardingSource.trial_ends_at,
            grace_ends_at:      effectiveOnboardingSource.grace_ends_at,
            subscription_status: effectiveOnboardingSource.subscription_status,
            subscription_start: effectiveOnboardingSource.subscription_start,
            subscription_end:   effectiveOnboardingSource.subscription_end,
          };
        }
      } catch (err) {
        console.warn('[my-status] root lookup for sub-branch failed:', err?.message);
      }
    }

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
              sp.max_trainers     AS plan_max_trainers,
              i.trial_reminder_sent_at,
              i.subscription_status
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

    // ── Post-payment grace window ─────────────────────────────────
    // For paid subscriptions we compute paid_renewal_at from paid_at
    // + billing_cycle and layer a 3-day grace window on top (see
    // migration 075 + services/subscriptionExpiry.service.js). During
    // grace the account can still LOG IN but premium features are
    // refused by subscriptionGuard. After grace the scheduler flips
    // institution.subscription_status to 'inactive' and the login
    // gate rejects the four institution-linked roles.
    const GRACE_DAYS = 3;
    let paidRenewalAt = null;
    let paidGraceEndsAt = null;
    let daysLeftInPaidGrace = null;
    if (r.paid_at) {
      const start = new Date(r.paid_at);
      const cycle = String(r.plan_billing_cycle || 'monthly').toLowerCase();
      const renewal = new Date(start);
      if (cycle === 'yearly') renewal.setFullYear(renewal.getFullYear() + 1);
      else                    renewal.setMonth(renewal.getMonth() + 1);
      paidRenewalAt = renewal;
      const graceEnd = new Date(renewal);
      graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);
      paidGraceEndsAt = graceEnd;
      if (now > renewal) {
        const ms = graceEnd.getTime() - now.getTime();
        daysLeftInPaidGrace = ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
      }
    }

    // Compute phase.
    let phase;
    if (r.paid_at && paidRenewalAt && now < paidRenewalAt) {
      // Paid + inside the billing window.
      phase = 'paid';
    } else if (r.paid_at && paidGraceEndsAt && now < paidGraceEndsAt) {
      // Paid but past renewal — inside the 3-day grace window.
      // subscription_status on the row will be 'expired'.
      phase = 'paid_grace';
    } else if (r.paid_at) {
      // Grace window closed too — institution.subscription_status is
      // (or will imminently be) 'inactive' via the scheduler.
      phase = 'expired';
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
    } else if (phase === 'paid_grace' && paidRenewalAt) {
      nextRenewalAt = paidRenewalAt.toISOString();
    } else if (phase === 'trial') {
      nextRenewalAt = r.trial_ends_at;
    } else if (phase === 'grace') {
      nextRenewalAt = r.grace_ends_at;
    }

    // ── payment_ready ────────────────────────────────────────────
    // Signals to the mobile Pricing screen whether the Pay Now
    // button should appear during the trial phase.
    //   • Trial phase: true once the trial-ending reminder has been
    //     sent (i.e. within 3 days of trial_ends_at) OR when
    //     days_left_in_trial <= 3 as a client-side safety net.
    //   • Grace / locked / expired: always true (payment overdue).
    //   • Paid / pending: false (nothing to pay right now).
    const trialDaysRemaining = daysLeft(r.trial_ends_at);
    const isTrialEndingSoon = phase === 'trial' && (
      !!r.trial_reminder_sent_at ||
      (trialDaysRemaining != null && trialDaysRemaining <= 3)
    );
    const paymentReady =
      phase === 'grace' || phase === 'locked' || phase === 'expired' || phase === 'paid_grace'
        ? true
        : phase === 'trial' ? isTrialEndingSoon : false;

    res.json({
      phase,
      institution_id: r.id,
      institution_name: r.name,
      onboarding_status: r.onboarding_status,
      trial_starts_at:  r.trial_starts_at,
      trial_ends_at:    r.trial_ends_at,
      grace_ends_at:    r.grace_ends_at,
      days_left_in_trial: trialDaysRemaining,
      days_left_in_grace: daysLeft(r.grace_ends_at),
      // Post-payment grace window (migration 075). paid_grace phase
      // means renewal date is past but we're inside the 3-day grace.
      // days_left_in_paid_grace counts down 3 → 2 → 1 → 0 for the
      // mobile Pricing banner.
      subscription_status:    r.subscription_status || 'active',
      paid_renewal_at:        paidRenewalAt ? paidRenewalAt.toISOString() : null,
      paid_grace_ends_at:     paidGraceEndsAt ? paidGraceEndsAt.toISOString() : null,
      days_left_in_paid_grace: daysLeftInPaidGrace,
      // Trial-phase UX flags for the mobile Pricing screen.
      payment_ready:          paymentReady,
      trial_ending_soon:      isTrialEndingSoon,
      trial_reminder_sent_at: r.trial_reminder_sent_at || null,
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
// NOTE: The Phase-1 stub of exports.approveInstitution used to live
// here — a bare UPDATE with a "TODO Phase 2: send email" comment and
// no payment-link generation. It was silently overridden by the real
// implementation further down (line ~1226), which is why approvals
// worked in prod but emails "sometimes disappeared" (a code path
// that thought it was the source of truth actually never fired).
//
// The stub has been removed. The canonical implementation lives in
// exports.approveInstitution near the bottom of this file — it
// sends the approval email + creates the Razorpay Payment Link +
// opens the trial window.

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

// POST /api/onboarding/mock-payment  (DEPRECATED — never activates)
//
// This endpoint used to flip institutions.onboarding_status='active'
// and users.status='active' as a Phase 1 "mock" shortcut so early
// devs could bypass Razorpay. That's a live security hole in
// production: any authenticated institution admin could POST here
// and grant themselves full access without paying.
//
// Activation now goes through EXACTLY one code path — the Razorpay
// webhook after signature verification (verifyWebhookSignature in
// utils/razorpay.js, HMAC-SHA256 constant-time compare). We keep the
// route registered so old builds of the app get a deterministic
// 410 Gone instead of a mysterious 404, but we NEVER mutate the row.
exports.mockPayment = async (_req, res) => {
  return res.status(410).json({
    code:    'MOCK_PAYMENT_DEPRECATED',
    message:
      'Institution activation must go through Razorpay. Complete the ' +
      'payment from your approval email — the webhook will activate ' +
      'your account after the signature check passes.',
  });
};

// GET: List all pending institutions (for super admin)
// NOTE: sub-branches (rows with parent_institution_id set) are excluded here.
// A branch is not a standalone institution to the super admin — it only
// appears nested inside its parent's detail page under "Branch Locations".
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
         sp.features AS plan_features,
         sp.trial_days AS plan_trial_days,
         sp.grace_days AS plan_grace_days
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.onboarding_status = 'pending_approval'
         AND i.deleted_at IS NULL
         AND i.parent_institution_id IS NULL
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

    const inst = result.rows[0];

    // Attach a thin list of sub-branches when this row is a main-branch
    // institution. The admin web's "Branch Locations" section uses it to
    // line up the JSONB-stored branch entries with the real child
    // institutions row so it can render a "Resend credentials" button
    // per branch (the endpoint needs the child institution id).
    if (!inst.parent_institution_id) {
      const kids = await pool.query(
        `SELECT id, name, email, address, city, pincode, owner_user_id
           FROM institutions
          WHERE parent_institution_id = $1
            AND COALESCE(deleted_at::text, '') = ''
          ORDER BY created_at`,
        [inst.id],
      );
      inst.sub_branches = kids.rows;
    }

    // Sub-branch policy: every non-location field is mirrored from the
    // parent institution. The branch's own row only keeps location info
    // (address, city, pincode, latitude, longitude). When we serve a
    // sub-branch we hydrate the missing fields from the parent so the
    // detail page (and the branch admin's mobile app, which reads the
    // same shape) shows uniform branding without us having to copy data
    // into every child row.
    if (inst.parent_institution_id) {
      const parentRes = await pool.query(
        `SELECT name, brand_name, logo_url, institution_type, institution_types,
                registration_number, date_of_establishment, skills,
                email, phone, website_url, branches,
                affiliation_or_board, accreditation_body_name,
                accreditation_expiry_date, accreditation_certificate_url,
                total_student_capacity, current_enrollment,
                medium_of_instruction, operating_hours,
                operating_hours_weekday, operating_hours_weekend,
                master_name, master_role, master_email, master_phone_number
           FROM institutions WHERE id = $1`,
        [inst.parent_institution_id],
      );
      const parent = parentRes.rows[0];
      if (parent) {
        // Location fields stay on the child. branches[] is also kept
        // empty on sub-branches because they don't manage other
        // branches — that's the parent's concern. Inheriting it caused
        // the admin web to render a Branch Locations card on the
        // sub-branch's page with a chip that posted to the wrong id.
        const SKIP_INHERIT = new Set([
          'address', 'city', 'pincode', 'latitude', 'longitude',
          'branches',
        ]);
        // ── GAP-FILL inheritance (not blanket override) ──────────────
        // Old behaviour overwrote the sub-branch's own values with the
        // parent's whenever the parent had one — which meant a sub-branch
        // admin's phone / email / brand edits were invisible on the web
        // detail page, and the "Institution profile updated" highlight
        // in the notification bell pointed at fields whose displayed
        // value hadn't actually changed. Now we only pull from the
        // parent when the sub-branch's own column is null/undefined/'',
        // so the child's edits always take precedence.
        for (const [k, v] of Object.entries(parent)) {
          if (SKIP_INHERIT.has(k)) continue;
          if (v == null) continue;
          const existing = inst[k];
          const isBlank = existing === null || existing === undefined || existing === '';
          if (isBlank) inst[k] = v;
        }
        inst.is_sub_branch = true;
      }
    }

    res.json({ institution: inst });
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

    // Sub-branches are never surfaced in the top-level list — the super admin
    // opens the parent and sees them under "Branch Locations". This keeps the
    // dashboard showing one row per real academy instead of one row per
    // (academy + each branch).
    where.push(`i.parent_institution_id IS NULL`);

    if (status) {
      params.push(status);
      where.push(`i.onboarding_status = $${params.length}`);
      // "Active" on the super-admin dashboard now means:
      //   • onboarding_status='active' (row is provisioned + paid), AND
      //   • is_active flag ON (admin hasn't toggled it off), AND
      //   • subscription_status='active' (post-expiry scheduler has
      //     NOT flipped this row to 'expired' or 'inactive').
      // The old check only inspected subscription_end which the
      // scheduler doesn't touch — it now uses the scheduler-owned
      // subscription_status column so grace/inactive rows correctly
      // fall out of the Active list.
      if (status === 'active') {
        where.push(`i.is_active = TRUE`);
        // Two guards so the Active list stays clean even before the
        // scheduler ticks:
        //   1. scheduler-owned flag says 'active'
        //   2. subscription_end (when set) is still in the future
        // The subscription_end guard fires immediately as the clock
        // passes; the flag catches rows that don't carry
        // subscription_end but hit their paid_at + cycle boundary.
        where.push(`i.subscription_status = 'active'`);
        where.push(`(i.subscription_end IS NULL OR i.subscription_end >= NOW())`);
      }
    }

    if (expired === 'true') {
      // "Expired" now means the scheduler-owned subscription_status
      // is 'expired' (within grace) OR 'inactive' (past grace). The
      // legacy subscription_end < NOW() check kept as an OR so rows
      // predating the scheduler's first tick still surface until
      // the scheduler catches up.
      where.push(`i.onboarding_status = 'active'`);
      where.push(`(
        i.subscription_status IN ('expired', 'inactive')
        OR (i.subscription_end IS NOT NULL AND i.subscription_end < NOW())
      )`);
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
         -- Post-expiry lifecycle (migration 075). The scheduler
         -- keeps subscription_status in sync so the dashboard can
         -- render Active / Expired / Inactive without recomputing.
         i.subscription_status,
         i.subscription_expired_at,
         u.name AS owner_name,
         u.email AS owner_email,
         u.phone AS owner_phone,
         sp.name             AS plan_name,
         sp.price            AS plan_price,
         sp.billing_cycle    AS plan_billing_cycle
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

    // Enrich each row with a computed `effective_status` +
    // `days_left_in_paid_grace` so the frontend renders identical
    // badges everywhere without redoing the date math. The scheduler
    // (services/subscriptionExpiry.service.js) owns the
    // subscription_status column — we just project it into the
    // dashboard vocabulary here.
    const GRACE_DAYS = 3;
    const now = Date.now();
    const enriched = result.rows.map((r) => {
      let effectiveStatus = r.onboarding_status;
      let daysLeftInPaidGrace = null;
      let paidGraceEndsAt = null;

      if (r.onboarding_status === 'active') {
        // Prefer explicit subscription_end when the approve /
        // payment flow wrote one; otherwise derive from paid_at +
        // billing cycle. Whichever we get, this is the renewal
        // boundary the row's lifecycle pivots on.
        let renewalMs = null;
        if (r.subscription_end) {
          const t = new Date(r.subscription_end).getTime();
          if (Number.isFinite(t)) renewalMs = t;
        }
        if (renewalMs == null && r.paid_at) {
          const paidAt = new Date(r.paid_at);
          const cycle = String(r.plan_billing_cycle || 'monthly').toLowerCase();
          const renewal = new Date(paidAt);
          if (cycle === 'yearly') renewal.setFullYear(renewal.getFullYear() + 1);
          else                    renewal.setMonth(renewal.getMonth() + 1);
          renewalMs = renewal.getTime();
        }

        if (renewalMs != null) {
          const graceEndMs = renewalMs + GRACE_DAYS * 24 * 60 * 60 * 1000;
          paidGraceEndsAt = new Date(graceEndMs).toISOString();
          if (now > renewalMs) {
            const ms = graceEndMs - now;
            daysLeftInPaidGrace = ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
          }
        }

        // Compute the date-driven state, then OR it with the
        // scheduler-owned subscription_status column so a row that's
        // clearly expired doesn't sit labelled Active just because
        // the scheduler hasn't ticked yet (fresh migration, cold
        // start, ops paused the service, etc.).
        let dateStatus = 'active';
        if (renewalMs != null) {
          if (now > renewalMs + GRACE_DAYS * 24 * 60 * 60 * 1000) dateStatus = 'inactive';
          else if (now > renewalMs)                               dateStatus = 'expired';
        }
        const schedStatus =
          r.subscription_status === 'inactive' ? 'inactive'
          : r.subscription_status === 'expired' ? 'expired'
          : 'active';

        // Pick the "worst" of the two: any row the date math OR the
        // scheduler flag treats as past due is projected that way.
        const rank = { active: 0, expired: 1, inactive: 2 };
        effectiveStatus =
          rank[dateStatus] > rank[schedStatus] ? dateStatus : schedStatus;
      }

      return {
        ...r,
        effective_status:         effectiveStatus,
        days_left_in_paid_grace:  daysLeftInPaidGrace,
        paid_grace_ends_at:       paidGraceEndsAt,
      };
    });

    res.json({
      count: enriched.length,
      institutions: enriched,
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
              sp.discount_percent AS plan_discount_percent,
              sp.gst_percent AS plan_gst_percent
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

    // Effective price = plan price with discount applied if enabled.
    // Discount is applied on the GST-exclusive base; GST is layered on
    // TOP of the discounted base so total_payable = discounted × (1 + gst%/100).
    // We round to two decimals so the Razorpay link and the invoice
    // line match to the paise.
    const trialDays   = Number(institution.plan_trial_days)   || 0;
    const graceDays   = Number(institution.plan_grace_days)   || 0;
    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const gstPercent  = Number(institution.plan_gst_percent) || GST_PERCENT_DEFAULT;
    const basePrice   = Number(institution.plan_price);
    const discountedBase = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100) * 100) / 100
      : basePrice;
    // Effective price stays GST-EXCLUSIVE for reporting parity with the
    // legacy field. Razorpay is charged total_payable below.
    const effectivePrice = discountedBase;
    const gstBreakdown   = computeGst(discountedBase, gstPercent);

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

    // ── Free Trial gate ─────────────────────────────────────────────
    // Per the Free Trial spec: when the selected plan includes a free
    // trial we DO NOT mint a Razorpay payment link at approval time.
    // The scheduler mints the link (and sends the payment email) 3
    // days before trial expiry. Sending the link now would violate
    // the "no duplicate payment-link emails" rule.
    const hasTrial = trialDays > 0;

    // 3a. Apply referral-wallet discount (if any) before generating the link.
    //     This is the FIRST renewal payment so we consume points here.
    //     Referral wallet is drawn against the GST-EXCLUSIVE base so the
    //     tax on the ex-post-discount amount is computed correctly.
    let referralDiscount = 0;
    try {
      const ref = await consumeDiscount(id, effectivePrice);
      referralDiscount = ref.discount || 0;
    } catch (err) {
      console.warn('[approve] referral discount failed:', err?.message);
    }
    const finalBase       = Math.max(0, effectivePrice - referralDiscount);
    const finalBreakdown  = computeGst(finalBase, gstPercent);
    const finalPayable    = finalBreakdown.total_payable;

    // 3b. Create payment link ONLY for the no-trial path. Trial plans
    //     skip this — the scheduler handles it 3 days before expiry.
    //     Razorpay is charged the GST-INCLUSIVE total_payable so the
    //     amount on the payment page matches the "Total Payable" shown
    //     on the plan card in the app.
    let linkResult = { ok: false, error: 'skipped (trial)' };
    if (!hasTrial) {
      linkResult = await createPaymentLink({
        amountInRupees: finalPayable,
        institution,
        notes: {
          base_price:    String(finalBreakdown.base_price),
          gst_percent:   String(finalBreakdown.gst_percent),
          gst_amount:    String(finalBreakdown.gst_amount),
          total_payable: String(finalBreakdown.total_payable),
        },
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
    }

    // 4. Email the owner. Previously this was gated on `linkResult.ok` which
    //    meant a Razorpay misconfiguration silently swallowed the approval
    //    notice. Now the email always goes out — when there's no link we send
    //    a "you've been approved, payment link to follow" version so the
    //    institution at least knows the super admin acted on their request.
    //
    // We also pull the plan's per-term pricing (migration 049) so the
    // email lists Monthly / Quarterly / Half-Yearly / Yearly with their
    // real prices instead of hard-coding "₹X / month".
    let pricingTerms = [];
    if (institution.plan_id) {
      try {
        const pp = await pool.query(
          `SELECT billing_term, price, is_enabled, gst_percent
             FROM plan_pricing
            WHERE plan_id = $1
              AND is_enabled = TRUE
            ORDER BY
              CASE billing_term
                WHEN 'monthly'     THEN 1
                WHEN 'quarterly'   THEN 2
                WHEN 'half_yearly' THEN 3
                WHEN 'annual'      THEN 4
                ELSE 5
              END`,
          [institution.plan_id],
        );
        pricingTerms = pp.rows.map((r) => {
          const base = Number(r.price) || 0;
          const pct  = Number(r.gst_percent) || gstPercent;
          const g    = computeGst(base, pct);
          return {
            billing_term:  r.billing_term,
            price:         g.base_price,          // legacy alias
            base_price:    g.base_price,
            gst_percent:   g.gst_percent,
            gst_amount:    g.gst_amount,
            total_payable: g.total_payable,
            is_enabled:    true,
          };
        });
      } catch (err) {
        console.warn('[approve] plan_pricing lookup failed:', err?.message);
      }
    }

    // Pull the freshly-set trial window so the welcome email carries
    // the exact dates the institution now sees on their pricing screen.
    let mailResult;
    if (hasTrial) {
      const tw = await pool.query(
        `SELECT trial_starts_at, trial_ends_at FROM institutions WHERE id = $1`,
        [id],
      );
      const trialRow = tw.rows[0] || {};
      mailResult = await sendTrialWelcomeEmail({
        to:              institution.owner_email,
        ownerName:       institution.owner_name,
        institutionName: institution.name,
        planName:        institution.plan_name,
        trialDays,
        trialStartsAt:   trialRow.trial_starts_at,
        trialEndsAt:     trialRow.trial_ends_at,
      });
    } else {
      mailResult = await sendApprovalEmail({
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
        pricingTerms,
        institutionId:   institution.id,
      });
    }
    if (!mailResult.ok) {
      warnings.push(`Email not sent: ${mailResult.error}`);
    }

    // Loud console logging so ops can spot a broken approval flow at
    // a glance. Trial flow deliberately skips payment link creation
    // — that's not an error, so don't scream about it.
    if (!hasTrial && !linkResult.ok) {
      console.error(
        `[approve] payment link creation FAILED for institution=${institution.id} (${institution.name}) — ${linkResult.error}`,
      );
    }
    if (!mailResult.ok) {
      console.error(
        `[approve] ${hasTrial ? 'trial welcome' : 'approval'} email FAILED to ${institution.owner_email} for institution=${institution.id} — ${mailResult.error}`,
      );
    }
    if (mailResult.ok) {
      console.log(
        `[approve] institution=${institution.id} approved OK (${hasTrial ? `trial ${trialDays}d` : 'no trial'}) — email sent to ${institution.owner_email}${!hasTrial && linkResult.ok ? `, payment link ${linkResult.link.short_url}` : ''}`,
      );
    }

    // Return the fresh row so the admin UI re-renders correctly.
    const fresh = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name,
              u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price
       FROM institutions i
       JOIN users u ON i.owner_user_id = u.id
       LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
       WHERE i.id = $1`,
      [id]
    );

    // Compose a message that TELLS THE SUPER ADMIN what actually
    // succeeded — the old message always said "Payment link emailed"
    // even when the email helper had returned an error, which hid
    // the misconfig.
    let message = `${institution.name} approved.`;
    if (hasTrial) {
      message += mailResult.ok
        ? ` Free ${trialDays}-day trial started; welcome email sent. Payment link will be sent 3 days before trial ends.`
        : ` Free ${trialDays}-day trial started, but welcome email delivery FAILED — use "Resend approval email".`;
    } else if (linkResult.ok && mailResult.ok) {
      message += ' Payment link emailed to owner.';
    } else if (linkResult.ok && !mailResult.ok) {
      message += ' Payment link created but email delivery FAILED — use "Resend approval email".';
    } else if (!linkResult.ok && mailResult.ok) {
      message += ' Approval email sent, but payment link could NOT be created — use "Resend approval email" after fixing Razorpay creds.';
    } else {
      message += ' Payment link + email BOTH failed — check Razorpay + SMTP env vars, then "Resend approval email".';
    }

    // ── Welcome WhatsApp — fires HERE (not at register time) ──────
    // Admin self-signup has no institution linked at register, so
    // the plan gate correctly refuses then. Now that the institution
    // is approved and its plan is set, the gate can succeed. The
    // helper's one-time stamp (users.welcome_wa_sent_at) guarantees
    // the message is sent at most once per account even if approval
    // is rerun (rejection → re-approval).
    const ownerRow = fresh.rows[0];
    const ownerId    = ownerRow?.owner_user_id;
    const ownerName  = ownerRow?.owner_name || institution.owner_name;
    const ownerPhone = ownerRow?.owner_phone || institution.owner_phone;
    if (ownerId && ownerPhone) {
      sendWelcomeWhatsApp({
        userId: ownerId,
        name:   ownerName,
        phone:  ownerPhone,
        role:   'institution',
      })
        .then((r) => {
          if (r?.ok) {
            console.log(`[WhatsApp] welcome delivered → owner user=${ownerId} phone=${ownerPhone} messageId=${r.messageId}`);
          } else if (r?.skipped) {
            console.log(`[WhatsApp] welcome skipped → owner user=${ownerId} reason=${r.skipped}`);
          } else {
            console.warn(`[WhatsApp] welcome send FAILED → owner user=${ownerId} error=${r?.error}`);
          }
        })
        .catch(() => { /* logged inside the helper */ });
    } else {
      console.log(
        `[WhatsApp] welcome skipped after approval → owner user=${ownerId} reason=${ownerPhone ? 'no-owner-id' : 'no-owner-phone'}`,
      );
    }

    res.json({
      message,
      institution:       fresh.rows[0],
      payment_link_url:  linkResult.ok ? linkResult.link.short_url : null,
      email_sent:        !!mailResult.ok,
      payment_link_ok:   !!linkResult.ok,
      warnings:          warnings.length ? warnings : undefined,
    });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/onboarding/resend-approval/:id
//
// Super-admin manual retry when the approval flow's email or payment
// link failed on the first attempt (SMTP down, Razorpay creds not
// loaded, etc.). Re-mints the Razorpay Payment Link and re-sends the
// approval email against the CURRENT institution + plan state. Safe
// to call any number of times.
//
// Preconditions:
//   • institution.onboarding_status IN ('approved', 'active')
//     — must have been approved before. Doesn't approve on this call.
//   • plan_id + plan_price set on the row.
//
// On success returns the new payment_link_url + email_sent flag. On
// failure returns the same partial-status message shape approve does.
exports.resendApprovalEmail = async (req, res) => {
  try {
    const { id } = req.params;

    const instResult = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price,
              sp.trial_days AS plan_trial_days,
              sp.grace_days AS plan_grace_days,
              sp.discount_enabled AS plan_discount_enabled,
              sp.discount_percent AS plan_discount_percent,
              sp.gst_percent AS plan_gst_percent
         FROM institutions i
         JOIN users u ON i.owner_user_id = u.id
         LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
        WHERE i.id = $1`,
      [id],
    );
    if (instResult.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    const institution = instResult.rows[0];

    if (!['approved', 'active'].includes(institution.onboarding_status)) {
      return res.status(400).json({
        message: `Cannot resend — institution is ${institution.onboarding_status}. Approve it first.`,
      });
    }
    if (institution.onboarding_status === 'active') {
      // Already paid — no fresh link needed, just re-send the "you're live" note.
      return res.status(409).json({
        code:    'ALREADY_ACTIVE',
        message: 'Institution is already active. No resend needed.',
      });
    }
    if (!institution.plan_price) {
      return res.status(400).json({
        message: 'Institution has no plan / plan price set. Cannot create a payment link.',
      });
    }

    // Recompute the effective price + referral discount fresh so a
    // wallet credit added AFTER approval also flows into the retry.
    // GST is layered on top of the post-discount base — same order as
    // approveInstitution so both paths mint identical amounts.
    const trialDays   = Number(institution.plan_trial_days)   || 0;
    const graceDays   = Number(institution.plan_grace_days)   || 0;
    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const gstPercent  = Number(institution.plan_gst_percent) || GST_PERCENT_DEFAULT;
    const basePrice   = Number(institution.plan_price);
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100) * 100) / 100
      : basePrice;

    let referralDiscount = 0;
    try {
      const ref = await consumeDiscount(id, effectivePrice);
      referralDiscount = ref.discount || 0;
    } catch (err) {
      console.warn('[resend] referral discount failed:', err?.message);
    }
    const finalBase      = Math.max(0, effectivePrice - referralDiscount);
    const finalBreakdown = computeGst(finalBase, gstPercent);
    const finalPayable   = finalBreakdown.total_payable;

    const linkResult = await createPaymentLink({
      amountInRupees: finalPayable,
      institution,
      notes: {
        base_price:    String(finalBreakdown.base_price),
        gst_percent:   String(finalBreakdown.gst_percent),
        gst_amount:    String(finalBreakdown.gst_amount),
        total_payable: String(finalBreakdown.total_payable),
      },
    });
    if (linkResult.ok) {
      await pool.query(
        `UPDATE institutions SET
           payment_link_id     = $1,
           payment_link_url    = $2,
           payment_link_status = 'pending',
           payment_amount      = $3
         WHERE id = $4`,
        [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, id],
      );
    }

    let pricingTerms = [];
    if (institution.plan_id) {
      try {
        const pp = await pool.query(
          `SELECT billing_term, price, is_enabled, gst_percent
             FROM plan_pricing
            WHERE plan_id = $1 AND is_enabled = TRUE
            ORDER BY CASE billing_term
              WHEN 'monthly'     THEN 1
              WHEN 'quarterly'   THEN 2
              WHEN 'half_yearly' THEN 3
              WHEN 'annual'      THEN 4
              ELSE 5 END`,
          [institution.plan_id],
        );
        pricingTerms = pp.rows.map((r) => {
          const base = Number(r.price) || 0;
          const pct  = Number(r.gst_percent) || gstPercent;
          const g    = computeGst(base, pct);
          return {
            billing_term:  r.billing_term,
            price:         g.base_price,
            base_price:    g.base_price,
            gst_percent:   g.gst_percent,
            gst_amount:    g.gst_amount,
            total_payable: g.total_payable,
            is_enabled:    true,
          };
        });
      } catch (err) {
        console.warn('[resend] plan_pricing lookup failed:', err?.message);
      }
    }

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
      pricingTerms,
      institutionId:   institution.id,
    });

    console.log(
      `[resend] institution=${institution.id} — link=${linkResult.ok ? 'ok' : 'FAIL'}, email=${mailResult.ok ? 'ok' : 'FAIL'}`,
    );

    res.json({
      message: linkResult.ok && mailResult.ok
        ? 'Approval email re-sent with a fresh payment link.'
        : linkResult.ok
          ? 'Payment link re-created but email delivery failed. Check SMTP env vars.'
          : mailResult.ok
            ? 'Approval email sent, but the payment link could NOT be minted. Check Razorpay env vars.'
            : 'Both the payment link and the email FAILED. Check Razorpay + SMTP env vars.',
      payment_link_url: linkResult.ok ? linkResult.link.short_url : null,
      email_sent:       !!mailResult.ok,
      payment_link_ok:  !!linkResult.ok,
    });
  } catch (err) {
    console.error('Resend approval error:', err);
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
              sp.discount_percent AS plan_discount_percent,
              sp.gst_percent AS plan_gst_percent
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

    // Same discount + GST math as approveInstitution so a resend
    // charges exactly what the plan card advertises.
    const discountOn  = !!institution.plan_discount_enabled;
    const discountPct = Number(institution.plan_discount_percent) || 0;
    const gstPercent  = Number(institution.plan_gst_percent) || GST_PERCENT_DEFAULT;
    const basePrice   = Number(institution.plan_price);
    const effectivePrice = discountOn && discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100) * 100) / 100
      : basePrice;
    const effectiveBreakdown = computeGst(effectivePrice, gstPercent);

    const linkResult = await createPaymentLink({
      amountInRupees: effectiveBreakdown.total_payable,
      institution,
      notes: {
        base_price:    String(effectiveBreakdown.base_price),
        gst_percent:   String(effectiveBreakdown.gst_percent),
        gst_amount:    String(effectiveBreakdown.gst_amount),
        total_payable: String(effectiveBreakdown.total_payable),
      },
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

    // Same per-term pricing lookup as approveInstitution so the resent
    // email surfaces the full billing terms table too.
    let resendPricingTerms = [];
    if (institution.plan_id) {
      try {
        const pp = await pool.query(
          `SELECT billing_term, price, gst_percent
             FROM plan_pricing
            WHERE plan_id = $1 AND is_enabled = TRUE
            ORDER BY
              CASE billing_term
                WHEN 'monthly'     THEN 1
                WHEN 'quarterly'   THEN 2
                WHEN 'half_yearly' THEN 3
                WHEN 'annual'      THEN 4
                ELSE 5
              END`,
          [institution.plan_id],
        );
        resendPricingTerms = pp.rows.map((r) => {
          const base = Number(r.price) || 0;
          const pct  = Number(r.gst_percent) || gstPercent;
          const g    = computeGst(base, pct);
          return {
            billing_term:  r.billing_term,
            price:         g.base_price,
            base_price:    g.base_price,
            gst_percent:   g.gst_percent,
            gst_amount:    g.gst_amount,
            total_payable: g.total_payable,
            is_enabled:    true,
          };
        });
      } catch (err) {
        console.warn('[resend] plan_pricing lookup failed:', err?.message);
      }
    }

    const mailResult = await sendApprovalEmail({
      to:              institution.owner_email,
      ownerName:       institution.owner_name,
      institutionName: institution.name,
      planName:        institution.plan_name,
      planPrice:       institution.plan_price,
      paymentUrl:      linkResult.link.short_url,
      pricingTerms:    resendPricingTerms,
      institutionId:   institution.id,
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

    // Also activate the owner user.
    await pool.query(
      `UPDATE users SET status = 'active'
       WHERE id = (
         SELECT owner_user_id FROM institutions WHERE id = $1
       )`,
      [id]
    );
    // Resume Registration completion stamp — done through the helper
    // (post-activation) so a missing `registration_completed_at`
    // column on a pre-077 schema doesn't rollback the manual activate.
    try {
      const ownerRow = await pool.query(
        `SELECT owner_user_id FROM institutions WHERE id = $1`, [id],
      );
      const ownerId = ownerRow.rows[0]?.owner_user_id;
      if (ownerId) {
        markRegistrationComplete(ownerId).catch(() => { /* logged inside */ });
      }
    } catch { /* stamping failure never fails an activation */ }

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

  // ── Failed / cancelled / expired branch ─────────────────────────
  // Razorpay fires distinct events for the unhappy paths:
  //   • payment.failed        — a specific charge attempt failed.
  //   • payment_link.cancelled — the merchant / customer cancelled.
  //   • payment_link.expired   — link timed out unpaid.
  // The institution row MUST stay at 'approved' / unpaid for any of
  // these. We only annotate the ledger so History reflects reality;
  // no state change on institutions is fired. Bounced back with 200
  // so Razorpay stops retrying.
  const FAILED_EVENTS = new Set([
    'payment.failed',
    'payment_link.cancelled',
    'payment_link.expired',
  ]);
  if (FAILED_EVENTS.has(event.event)) {
    try {
      const linkEntity    = event.payload?.payment_link?.entity || {};
      const paymentEntity = event.payload?.payment?.entity      || {};
      const failedLinkId  = linkEntity.id || paymentEntity?.notes?.payment_link_id || null;
      const failedPayId   = paymentEntity.id || null;
      const status =
        event.event === 'payment.failed'         ? 'failed'    :
        event.event === 'payment_link.cancelled' ? 'cancelled' :
                                                   'expired';
      if (failedLinkId) {
        await pool.query(
          `UPDATE subscription_transactions
              SET status              = $2,
                  razorpay_payment_id = COALESCE($3, razorpay_payment_id),
                  paid_at             = NULL
            WHERE razorpay_link_id = $1
              AND status = 'pending'`,
          [failedLinkId, status, failedPayId],
        );
        // Reset the institution's pending link marker so the admin
        // can start a fresh link. onboarding_status stays UNTOUCHED —
        // failed / cancelled / expired must never activate.
        await pool.query(
          `UPDATE institutions
              SET payment_link_status = $2
            WHERE payment_link_id = $1
              AND onboarding_status <> 'active'`,
          [failedLinkId, status],
        );
      }
      console.log(`[webhook] ${event.event} recorded link=${failedLinkId}`);
    } catch (err) {
      console.warn(`[webhook] failed-branch bookkeeping error:`, err?.message);
    }
    return res.json({ ok: true, failed_recorded: true });
  }

  // We only activate on successful payment-link payments. Ack anything
  // else with 200 so Razorpay stops retrying.
  if (event.event !== 'payment_link.paid') {
    return res.json({ ok: true, ignored: event.event });
  }

  try {
    const linkEntity    = event.payload?.payment_link?.entity || {};
    const paymentEntity = event.payload?.payment?.entity      || {};
    const linkId        = linkEntity.id;
    const paymentId     = paymentEntity.id;
    const notes         = linkEntity.notes || {};
    const notesInstId   = notes.institution_id;

    if (!linkId) {
      console.warn('[webhook] payment_link.paid with no link id');
      return res.status(400).json({ message: 'Missing payment_link.id' });
    }

    // ── Event payment branch ────────────────────────────────────────
    // Institution admins can gate an event behind a fee. Students /
    // trainers pay via a Razorpay Payment Link minted by
    // institution.controller.js#payForInstitutionEvent, which stamps
    // notes.event_payment='1' plus notes.event_id / notes.user_id. We
    // flip the matching event_payments row to 'paid' and return early.
    if (notes.event_payment === '1' || notes.event_payment === 1) {
      const eventIdNote = parseInt(notes.event_id, 10);
      const userIdNote  = parseInt(notes.user_id, 10);

      // First try the direct link_id lookup — this is set when we insert
      // the pending row, so it should always match.
      let ep = await pool.query(
        `SELECT id, status FROM event_payments WHERE razorpay_link_id = $1`,
        [linkId],
      );

      // Fallback: (event_id, user_id, still-pending) if the link_id
      // somehow wasn't recorded (defensive; shouldn't happen).
      if (ep.rows.length === 0 && Number.isFinite(eventIdNote) && Number.isFinite(userIdNote)) {
        ep = await pool.query(
          `SELECT id, status FROM event_payments
            WHERE event_id = $1 AND user_id = $2 AND status = 'pending'
            ORDER BY created_at DESC LIMIT 1`,
          [eventIdNote, userIdNote],
        );
      }

      if (ep.rows.length === 0) {
        console.warn('[webhook] event payment link=', linkId, 'not found in event_payments');
        return res.json({ ok: true, matched: false });
      }
      if (ep.rows[0].status === 'paid') {
        // Razorpay may retry — idempotent ack.
        return res.json({ ok: true, already_paid: true });
      }

      await pool.query(
        `UPDATE event_payments
            SET status              = 'paid',
                razorpay_payment_id = $2,
                paid_at             = NOW()
          WHERE id = $1`,
        [ep.rows[0].id, paymentId || null],
      );
      return res.json({ ok: true, event_payment: true });
    }

    // ── Enrollment renewal branch ──────────────────────────────────
    // Student-initiated renewals mint their link with
    // notes.action='enrollment_renew' + notes.enrollment_id.
    // We flip the matching enrollments row to 'paid', stamp paid_at
    // and the payment id, and return early (institution-side logic
    // is irrelevant for these).
    if (notes.action === 'enrollment_renew' && notes.enrollment_id) {
      const enrollmentId = parseInt(notes.enrollment_id, 10);
      if (!Number.isInteger(enrollmentId)) {
        return res.status(400).json({ message: 'Invalid enrollment_id note' });
      }
      const upd = await pool.query(
        `UPDATE enrollments
            SET payment_status  = 'paid',
                paid_at         = NOW(),
                payment_reference = COALESCE($2, payment_reference)
          WHERE id = $1
            AND payment_status <> 'paid'
          RETURNING id, student_id, payment_amount`,
        [enrollmentId, paymentId || linkId],
      );
      // eslint-disable-next-line no-console
      console.log('[webhook] enrollment_renew paid=', upd.rowCount, 'enrollment=', enrollmentId);
      return res.json({ ok: true, enrollment_renew: true, matched: upd.rowCount > 0 });
    }

    // ── NEW-enrollment branch ──────────────────────────────────────
    // First-time student enrolments mint their link with
    // notes.action='enrollment_new' + notes.enrollment_id via the
    // /enrollments/:id/create-payment-link endpoint. This is the ONLY
    // point at which a pending enrolment becomes paid — the mobile's
    // "Pay Now" button never marks anything paid client-side. If the
    // webhook never fires (user cancels or payment fails) the row
    // stays payment_status='pending' and appears in the student's
    // "Pending Payment" list until they retry.
    if (notes.action === 'enrollment_new' && notes.enrollment_id) {
      const enrollmentId = parseInt(notes.enrollment_id, 10);
      if (!Number.isInteger(enrollmentId)) {
        return res.status(400).json({ message: 'Invalid enrollment_id note' });
      }
      const upd = await pool.query(
        `UPDATE enrollments
            SET payment_status    = 'paid',
                paid_at           = NOW(),
                payment_reference = COALESCE($2, payment_reference)
          WHERE id = $1
            AND payment_status <> 'paid'
          RETURNING id, student_id, payment_amount`,
        [enrollmentId, paymentId || linkId],
      );
      // eslint-disable-next-line no-console
      console.log('[webhook] enrollment_new paid=', upd.rowCount, 'enrollment=', enrollmentId);
      if (upd.rowCount > 0) {
        // Activate the student (rotates temp password, sets
        // status='active', mails credentials + welcome SMS). Idempotent —
        // a Razorpay retry won't re-rotate an already-active password.
        (async () => {
          try {
            const {
              activateStudentAfterPayment,
            } = require('./enrollment.controller');
            const r = await activateStudentAfterPayment(enrollmentId);
            // eslint-disable-next-line no-console
            console.log('[webhook] enrollment_new activated:', r);
          } catch (e) {
            console.error('[webhook] student activation failed:', e?.message);
          }
        })();
        // Invoice generation — guarded by its own idempotency check.
        (async () => {
          try {
            const { generateEnrollmentInvoice } = require('../utils/invoiceService');
            await generateEnrollmentInvoice({ enrollmentId });
          } catch (e) {
            console.error('[webhook] enrollment invoice failed:', e?.message);
          }
        })();
      }
      return res.json({ ok: true, enrollment_new: true, matched: upd.rowCount > 0 });
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

    // Read the notes so we know what this payment is for. Legacy
    // onboarding payments have no explicit action → treat as
    // 'onboarding' for the transaction ledger; the state machine
    // below is identical to before for that path.
    const action = notes.action === 'renew' || notes.action === 'change_plan'
      ? notes.action : 'onboarding';
    const targetPlanId = notes.target_plan_id ? parseInt(notes.target_plan_id, 10) : null;

    // Extension duration comes from the billing_term note when present.
    // Maps: monthly → 30d, quarterly → 90d, half_yearly → 180d, annual → 365d.
    // Falls back to 30 days for legacy links that don't carry the note.
    const TERM_DAYS = { monthly: 30, quarterly: 90, half_yearly: 180, annual: 365 };
    const extendDays = TERM_DAYS[notes.billing_term] || 30;

    // Compute the new subscription window. Both renewal and plan-change
    // extend by the term's day count from NOW OR from the current
    // subscription_end (whichever is later, so a mid-cycle renewal stacks).
    const extendClause = `GREATEST(NOW(), COALESCE(subscription_end, NOW())) + INTERVAL '${extendDays} days'`;

    let updated;

    if (institution.onboarding_status === 'active'
        && (action === 'renew' || action === 'change_plan')) {
      // Already active — extend subscription window and optionally swap
      // the plan. Idempotency handled by transaction ledger below.
      const alreadyPaid = await pool.query(
        `SELECT id, new_subscription_end
           FROM subscription_transactions
          WHERE razorpay_link_id = $1 AND status = 'paid'
          LIMIT 1`,
        [linkId],
      );
      if (alreadyPaid.rows.length) {
        return res.json({ ok: true, already_paid: true });
      }

      const params = [institution.id, paymentId || null];
      let planSet = '';
      if (action === 'change_plan' && targetPlanId) {
        params.push(targetPlanId);
        planSet = `, plan_id = $${params.length}`;
      }
      updated = await pool.query(
        `UPDATE institutions SET
           subscription_end     = ${extendClause},
           payment_link_status  = 'paid',
           payment_reference    = $2,
           paid_at              = NOW()
           ${planSet}
         WHERE id = $1
         RETURNING *`,
        params,
      );
    } else if (institution.onboarding_status === 'active') {
      // Already active but no known action tag — idempotent ack.
      return res.json({ ok: true, already_active: true });
    } else {

    // First-time activation path (unchanged shape). The referral credit
    // block below reads institution.paid_at directly to gate the credit
    // to a single lifetime firing.
    // First-time activation uses the same billing-term day count as
    // renew / change_plan. Legacy onboarding without a billing_term
    // note defaults to 30 days.
    updated = await pool.query(
      `UPDATE institutions SET
         onboarding_status    = 'active',
         status               = 'approved',
         subscription_start   = NOW(),
         subscription_end     = NOW() + INTERVAL '${extendDays} days',
         payment_link_status  = 'paid',
         payment_reference    = $2,
         paid_at              = NOW()
       WHERE id = $1
       RETURNING *`,
      [institution.id, paymentId || null]
    );
    }
    // Ledger: flip the matching transaction to 'paid' and stamp the
    // new subscription_end for the history row.
    await pool.query(
      `UPDATE subscription_transactions
          SET status              = 'paid',
              razorpay_payment_id = $2,
              paid_at             = NOW(),
              new_subscription_end = $3
        WHERE razorpay_link_id = $1
          AND status = 'pending'`,
      [linkId, paymentId || null, updated.rows[0]?.subscription_end || null],
    );

    // Post-payment side effects — only fire on a first-time activation.
    // Renewals and plan changes don't re-fire welcome emails or the
    // referral credit (both are one-time-per-institution).
    if (action === 'onboarding') {
      await pool.query(
        `UPDATE users SET status = 'active' WHERE id = $1`,
        [institution.owner_user_id]
      );
      // Terminal state for Resume Registration (spec: "Only after the
      // registration/enrollment is successfully completed should the
      // email address and mobile number become unique and unavailable
      // for new registrations"). Stamp via the helper so a schema
      // that hasn't seen migration 077 yet doesn't abort the webhook
      // — the helper swallows the 42703 and logs once.
      markRegistrationComplete(institution.owner_user_id).catch(() => { /* logged inside */ });

      // Credit the referring institution (if any) — best effort, after commit.
      // The `wasAlreadyPaid` guard lives inside the else-branch above, so
      // for legacy webhooks that fell through the onboarding path this
      // remains true only on the first-ever paid event.
      if (!institution.paid_at) {
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

      // Fire-and-forget subscription invoice. Idempotent — a webhook
      // retry with the same payment_id won't create a duplicate.
      (async () => {
        try {
          const { generateSubscriptionInvoice } = require('../utils/invoiceService');
          await generateSubscriptionInvoice({
            institutionId:    institution.id,
            paymentReference: paymentId || linkId,
            amount:           Number(institution.plan_price) || Number(institution.payment_amount) || 0,
            planName:         institution.plan_name,
          });
        } catch (e) {
          console.error('[webhook] subscription invoice failed:', e?.message);
        }
      })();

      console.log(`[webhook] activated institution ${institution.id} (${institution.name}) via payment ${paymentId}`);
      return res.json({ ok: true, activated: true, institution_id: institution.id });
    }

    // Renewal / plan-change branch — fire an invoice here too so
    // every institution payment has a matching PDF.
    (async () => {
      try {
        const { generateSubscriptionInvoice } = require('../utils/invoiceService');
        await generateSubscriptionInvoice({
          institutionId:    institution.id,
          paymentReference: paymentId || linkId,
          amount:           Number(institution.plan_price) || 0,
          planName:         institution.plan_name,
        });
      } catch (e) {
        console.error('[webhook] renewal invoice failed:', e?.message);
      }
    })();

    console.log(`[webhook] ${action} institution ${institution.id} → ${updated.rows[0].subscription_end}`);
    return res.json({ ok: true, action, institution_id: institution.id });
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

    // Also soft-delete the owner's user row so their email/phone frees
    // up for reuse — someone else can register with the same address.
    // We only do this on the ADMIN-triggered delete; owner-self-delete
    // (deleteMyInstitution) leaves the user row alone so the owner can
    // sign in and restore. Sub-branch admin users provisioned under this
    // institution get the same treatment via parent_institution_id.
    await pool.query(
      `UPDATE users
          SET is_deleted = TRUE,
              deleted_at = CURRENT_TIMESTAMP,
              deleted_by = $2,
              status     = 'inactive'
        WHERE COALESCE(is_deleted, FALSE) = FALSE
          AND (
            id = (SELECT owner_user_id FROM institutions WHERE id = $1)
            OR institution_id IN (
              SELECT id FROM institutions
               WHERE id = $1 OR parent_institution_id = $1
            )
          )`,
      [id, adminId],
    );

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

// SUPER ADMIN: soft-delete MANY institutions in one call.
// POST /api/onboarding/bulk-delete   body: { ids: number[], reason?: string }
//
// Applies exactly the same deletion rules as the single-delete above —
// soft-delete the institution row (snapshot status, deactivate) and
// soft-delete the owner + branch-admin user rows so their emails free up.
// Each id is processed independently: one failure never aborts the rest,
// and the response carries a per-id result so the UI can report both
// successes and failures.
exports.bulkDeleteInstitutions = async (req, res) => {
  try {
    const { ids, reason } = req.body || {};
    const adminId = req.user?.id || null;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array of institution ids' });
    }

    // Sanitise: numeric, unique. Cap the batch so a bad client can't ask
    // us to walk the whole table in one request.
    const uniqueIds = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (uniqueIds.length === 0) {
      return res.status(400).json({ message: 'ids must contain valid numeric institution ids' });
    }
    if (uniqueIds.length > 100) {
      return res.status(400).json({ message: 'Cannot delete more than 100 institutions at once' });
    }

    const results = [];
    for (const id of uniqueIds) {
      try {
        const row = await softDeleteInstitution({
          id,
          deletedById: adminId,
          source: 'admin',
          reason,
        });

        if (!row) {
          results.push({ id, success: false, message: 'Institution not found or already deleted' });
          continue;
        }

        // Same user-row cleanup as the single admin delete: free up the
        // owner's email/phone and deactivate any branch-admin users.
        await pool.query(
          `UPDATE users
              SET is_deleted = TRUE,
                  deleted_at = CURRENT_TIMESTAMP,
                  deleted_by = $2,
                  status     = 'inactive'
            WHERE COALESCE(is_deleted, FALSE) = FALSE
              AND (
                id = (SELECT owner_user_id FROM institutions WHERE id = $1)
                OR institution_id IN (
                  SELECT id FROM institutions
                   WHERE id = $1 OR parent_institution_id = $1
                )
              )`,
          [id, adminId],
        );

        results.push({ id, name: row.name, success: true, message: `${row.name} deleted.` });
      } catch (err) {
        console.error(`Bulk delete: institution ${id} failed:`, err);
        results.push({ id, success: false, message: err.message || 'Server error' });
      }
    }

    const deleted = results.filter((r) => r.success).length;
    const failed = results.length - deleted;

    res.json({
      message: `${deleted} deleted, ${failed} failed.`,
      deleted,
      failed,
      results,
    });
  } catch (err) {
    console.error('Bulk delete institutions error:', err);
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
// GET /api/onboarding/subscription-payments  (super admin)
//
// Full ledger of every subscription-related payment attempt across
// every institution — powers Web Admin → Payments → Subscription
// Payments. One row per subscription_transactions record, joined with
// institution (+ parent for branch info), the plan snapshot, and the
// owner so a single fetch renders the whole table.
//
// Query params (all optional):
//   ?status=paid|pending|failed|cancelled  — filter by outcome
//   ?limit=200 (default 200)
//   ?offset=0
//
// Migration-tolerant: the extra columns from migration 053
// (billing_cycle / auto_renewal / payment_gateway / invoice_url) may
// not be applied yet, in which case they're read as NULL so the page
// still renders. Run 053_subscription_txn_extras.sql to enable them.
exports.listSubscriptionPayments = async (req, res) => {
  try {
    const limit  = Math.min(Number.parseInt(req.query.limit, 10) || 200, 500);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const status = ['paid', 'pending', 'failed', 'cancelled'].includes(req.query.status)
      ? req.query.status : null;

    const where = status ? `WHERE t.status = $1` : '';
    const params = status ? [status] : [];

    // Detect which extra columns actually exist. Newer installs (post
    // migration 053) have all four; older installs have none. Anything
    // missing is substituted with a NULL literal so the SELECT is
    // valid regardless.
    const colRes = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'subscription_transactions'
          AND column_name = ANY($1::text[])`,
      [['billing_cycle', 'auto_renewal', 'payment_gateway', 'invoice_url']],
    );
    const have = new Set(colRes.rows.map((r) => r.column_name));
    const col = (name, fallback = 'NULL') => have.has(name) ? `t.${name}` : fallback;

    // Attach institution + parent (for branch label), the current plan's
    // catalog details, and the owner. `plan_name_snapshot` on the txn
    // survives plan renames, so we prefer it and only fall back to the
    // live plan.name when the snapshot is null.
    const rows = await pool.query(
      `SELECT
         t.id,
         t.institution_id,
         t.plan_id,
         COALESCE(t.plan_name_snapshot, sp.name)  AS plan_name,
         t.action,
         t.status,
         ${col('billing_cycle')}    AS billing_cycle,
         ${col('auto_renewal', 'FALSE')} AS auto_renewal,
         ${col('payment_gateway', "'razorpay'")} AS payment_gateway,
         t.razorpay_link_id,
         t.razorpay_payment_id,
         t.razorpay_short_url,
         ${col('invoice_url')} AS invoice_url,
         t.base_paise,
         t.referral_discount_paise,
         t.amount_paise,
         (t.amount_paise / 100.0)::numeric(10,2) AS amount_inr,
         t.created_at,
         t.paid_at,
         t.new_subscription_end,
         i.name                     AS institution_name,
         i.logo_url                 AS institution_logo,
         i.subscription_start,
         i.subscription_end,
         i.parent_institution_id,
         parent.name                AS parent_institution_name,
         CASE
           WHEN i.parent_institution_id IS NOT NULL THEN i.name
           ELSE NULL
         END                         AS branch_name,
         COALESCE(parent.name, i.name) AS root_institution_name,
         u.name                     AS owner_name,
         u.email                    AS owner_email,
         sp.billing_cycle           AS plan_default_billing_cycle
       FROM subscription_transactions t
       JOIN institutions i ON i.id = t.institution_id
       LEFT JOIN institutions parent ON parent.id = i.parent_institution_id
       LEFT JOIN subscription_plans sp ON sp.id = t.plan_id
       LEFT JOIN users u ON u.id = i.owner_user_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    // Small counts strip so the front-end can render tab pills without
    // a second round-trip. Independent of the current filter.
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS n
         FROM subscription_transactions
        GROUP BY status`,
    );
    const countMap = { paid: 0, pending: 0, failed: 0, cancelled: 0, total: 0 };
    counts.rows.forEach((r) => { countMap[r.status] = r.n; countMap.total += r.n; });

    res.json({
      count:    rows.rows.length,
      payments: rows.rows,
      counts:   countMap,
      limit,
      offset,
    });
  } catch (err) {
    console.error('listSubscriptionPayments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

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
    // All institution counters exclude sub-branch rows (parent_institution_id
    // IS NOT NULL) so the sidebar totals stay in sync with the list, which
    // also excludes them.
    const [summary, recent, peopleCounts, mrrRow] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE onboarding_status = 'pending_approval' AND deleted_at IS NULL AND parent_institution_id IS NULL) AS pending_approval,
          COUNT(*) FILTER (WHERE onboarding_status = 'approved'         AND deleted_at IS NULL AND parent_institution_id IS NULL) AS approved,
          -- Active: onboarding_status='active' AND scheduler-owned
          -- subscription_status='active' (not in grace / not inactive).
          COUNT(*) FILTER (WHERE onboarding_status = 'active' AND subscription_status = 'active' AND deleted_at IS NULL AND parent_institution_id IS NULL) AS active,
          COUNT(*) FILTER (WHERE onboarding_status = 'rejected'         AND deleted_at IS NULL AND parent_institution_id IS NULL) AS rejected,
          -- Expired: inside the 3-day grace window (login OK, features gated).
          COUNT(*) FILTER (WHERE onboarding_status = 'active' AND subscription_status = 'expired' AND deleted_at IS NULL AND parent_institution_id IS NULL) AS expired,
          -- Inactive: past grace (login blocked).
          COUNT(*) FILTER (WHERE onboarding_status = 'active' AND subscription_status = 'inactive' AND deleted_at IS NULL AND parent_institution_id IS NULL) AS inactive,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL                                     AND parent_institution_id IS NULL) AS deleted,
          COUNT(*) FILTER (WHERE deleted_at IS NULL                                         AND parent_institution_id IS NULL) AS total
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
          AND i.parent_institution_id IS NULL
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
      // Sub-branches are billed under the parent's subscription, so we count
      // one plan price per parent institution only.
      pool.query(`
        SELECT COALESCE(SUM(sp.price), 0)::numeric AS monthly_revenue
        FROM institutions i
        LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
        WHERE i.onboarding_status = 'active'
          AND i.subscription_status = 'active'
          AND i.deleted_at IS NULL
          AND i.parent_institution_id IS NULL
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
//
// Institution-admin endpoint that mints a Razorpay Payment Link for one
// of three actions:
//   • body omitted or plan_id === current plan → 'renew'
//   • plan_id === a different plan             → 'change_plan'
//     (server further classifies as upgrade / downgrade based on price
//      for the notes payload; the ledger just records 'change_plan')
//
// Records a row in subscription_transactions BEFORE the redirect so
// Payment History always shows the attempt. Status flips to 'paid' from
// the webhook; the client can flip it to 'cancelled' if the admin
// backs out.
// Renders the lightweight HTML page the approval email links to.
// One button per enabled billing term; each button re-hits the same
// route with ?term=<term>, which mints the Razorpay link and 302s.
function renderApprovalPickerHtml({ institution, planName, terms }) {
  const TERM_LABEL = {
    monthly:     'Monthly',
    quarterly:   'Quarterly',
    half_yearly: 'Half-Yearly',
    annual:      'Yearly',
  };
  const TERM_HINT = {
    monthly:     'Billed every month',
    quarterly:   'Billed every 3 months',
    half_yearly: 'Billed every 6 months',
    annual:      'Billed once per year',
  };
  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  const escape = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtBreakdown = (t) => {
    const base = Number(t.base_price ?? t.price ?? 0);
    const gAmt = Number(t.gst_amount ?? 0);
    const pct  = Number(t.gst_percent ?? 0);
    // Only render the breakdown line when we have the enriched data.
    // Older callers that only carry `.price` still render cleanly.
    if (!t.total_payable) return '';
    return `<div style="font-size:11px;color:#64748b;margin-top:4px;">
        Base ${fmtINR(base)} + GST ${pct}% (${fmtINR(gAmt)}) — includes GST
      </div>`;
  };

  const rows = terms.map((t) => `
    <a href="./${institution.id}?term=${encodeURIComponent(t.billing_term)}"
       style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;
              padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;
              background:#ffffff;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;font-size:15px;color:#0f172a;">
          ${escape(TERM_LABEL[t.billing_term] || t.billing_term)}
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">
          ${escape(TERM_HINT[t.billing_term] || '')}
        </div>
        ${fmtBreakdown(t)}
      </div>
      <div style="font-weight:900;font-size:17px;color:#E63946;letter-spacing:-0.2px;">
        ${fmtINR(t.price)}
      </div>
    </a>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Choose your billing term — Veerify</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;
                padding:28px 24px;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-block;background:#dcfce7;color:#166534;font-weight:800;
                    font-size:11px;padding:5px 12px;border-radius:999px;letter-spacing:.5px;">
          ✓ APPROVED
        </div>
      </div>
      <h1 style="text-align:center;font-size:22px;font-weight:900;color:#0f172a;
                 margin:0 0 6px;letter-spacing:-0.4px;">
        Pick your billing term
      </h1>
      <p style="text-align:center;font-size:13px;color:#475569;margin:0 0 20px;line-height:1.6;">
        <b>${escape(institution.name)}</b> is on the <b>${escape(planName || 'Subscription')}</b> plan.
        Pick a term to continue to secure Razorpay payment.
      </p>

      <div style="display:flex;flex-direction:column;gap:10px;">
        ${rows}
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:22px 0 0;line-height:1.6;">
        🔒 Payment happens entirely on Razorpay's secure page.<br/>
        Your subscription activates instantly once payment is confirmed.
      </p>
    </div>
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px;">
      Veerify — the command center for martial arts academies.
    </p>
  </div>
</body>
</html>`;
}

// GET /api/onboarding/pay-approval/:institutionId?term=<billing_term>
//
// Public-facing endpoint the approval email uses. Two modes:
//   • no ?term=   → renders a "pick your term" HTML page (buttons post
//                   back to this URL with ?term=)
//   • ?term=<X>   → mints a Razorpay Payment Link at that term's price
//                   and 302-redirects the owner to Razorpay checkout.
//
// Security posture:
//   • The URL carries the institution id in plain text — same posture
//     as the callback_url on the existing Razorpay Payment Link. Anyone
//     with the link can only start a payment for THAT institution's
//     plan; they can't attach it to a different institution.
//   • The endpoint refuses to mint a link when the institution is
//     already active (short-circuit — no double payment).
//   • Records a subscription_transactions row so the ledger stays
//     truthful when someone pays via email vs the mobile picker.
exports.startApprovalPayment = async (req, res) => {
  try {
    const institutionId = parseInt(req.params.institutionId, 10);
    const rawTerm       = String(req.query.term || '').trim();
    if (!Number.isFinite(institutionId)) {
      return res.status(400).send('Invalid link.');
    }

    // Two-mode endpoint:
    //   • no ?term=            → render the pick-a-term HTML page
    //   • ?term=<billing_term> → mint the Razorpay link + 302 there
    // The email only ever carries the no-term URL; the buttons on the
    // rendered page carry the term back to this same endpoint.
    const wantsPickerPage = !rawTerm;
    if (rawTerm && !['monthly', 'quarterly', 'half_yearly', 'annual'].includes(rawTerm)) {
      return res.status(400).send('Invalid billing term. Expected one of monthly / quarterly / half_yearly / annual.');
    }

    const { rows } = await pool.query(
      `SELECT i.id, i.name, i.email, i.phone, i.onboarding_status, i.plan_id,
              u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name
         FROM institutions i
         JOIN users u ON i.owner_user_id = u.id
         LEFT JOIN subscription_plans sp ON i.plan_id = sp.id
        WHERE i.id = $1
          AND i.deleted_at IS NULL
        LIMIT 1`,
      [institutionId],
    );
    const institution = rows[0];
    if (!institution) return res.status(404).send('Institution not found.');
    if (institution.onboarding_status === 'active') {
      // Redirect to a page we know exists. Same two-tier resolution
      // Razorpay's callback uses: PAYMENT_SUCCESS_URL override wins,
      // otherwise the backend's built-in branded success page (which
      // this controller itself serves at /api/onboarding/payment-success).
      const override = (process.env.PAYMENT_SUCCESS_URL || '').trim();
      const apiBase =
        process.env.API_BASE_URL ||
        process.env.APP_BASE_URL ||
        'https://veerifyapp.com';
      const successUrl = override
        ? `${override}?institution_id=${institutionId}&already=1`
        : `${apiBase}/api/onboarding/payment-success?institution_id=${institutionId}&already=1`;
      return res.redirect(302, successUrl);
    }
    if (!institution.plan_id) {
      return res.status(400).send('This institution has no plan selected yet.');
    }

    // ── Picker page render (no ?term=) ─────────────────────────────
    // Pull every enabled term for this plan and render a lightweight
    // HTML page. Each button posts back to this same endpoint with
    // ?term=<term> — the second branch below then mints the Razorpay
    // link and redirects.
    if (wantsPickerPage) {
      const allTerms = await pool.query(
        `SELECT pp.billing_term, pp.price, pp.is_enabled, pp.gst_percent,
                sp.gst_percent AS plan_gst_percent
           FROM plan_pricing pp
           LEFT JOIN subscription_plans sp ON sp.id = pp.plan_id
          WHERE pp.plan_id = $1
            AND pp.is_enabled = TRUE
            AND pp.price > 0
          ORDER BY
            CASE pp.billing_term
              WHEN 'monthly'     THEN 1
              WHEN 'quarterly'   THEN 2
              WHEN 'half_yearly' THEN 3
              WHEN 'annual'      THEN 4
              ELSE 5
            END`,
        [institution.plan_id],
      );
      // Picker page shows Total Payable (base + GST) — the same figure
      // the payment link will actually charge on the next click, so the
      // owner never sees a "why did it jump" delta between the button
      // and the Razorpay checkout.
      const enabled = allTerms.rows.map((r) => {
        const base = Number(r.price) || 0;
        const pct  = Number(r.gst_percent) || Number(r.plan_gst_percent) || GST_PERCENT_DEFAULT;
        const g    = computeGst(base, pct);
        return {
          billing_term:  r.billing_term,
          price:         g.total_payable,   // displayed figure
          base_price:    g.base_price,
          gst_percent:   g.gst_percent,
          gst_amount:    g.gst_amount,
          total_payable: g.total_payable,
        };
      });
      if (enabled.length === 0) {
        return res.status(400).send('This plan has no billing terms configured yet. Please contact support.');
      }
      const html = renderApprovalPickerHtml({
        institution,
        planName: institution.plan_name,
        terms:    enabled,
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    }

    // ── Redirect branch (?term=X) ──────────────────────────────────
    // Look up the picked term's price + GST rate. GST falls back to the
    // parent plan's rate when a legacy row omits it.
    const pp = await pool.query(
      `SELECT pp.price, pp.is_enabled, pp.gst_percent,
              sp.gst_percent AS plan_gst_percent
         FROM plan_pricing pp
         LEFT JOIN subscription_plans sp ON sp.id = pp.plan_id
        WHERE pp.plan_id = $1 AND pp.billing_term = $2`,
      [institution.plan_id, rawTerm],
    );
    const priceRow = pp.rows[0];
    if (!priceRow) {
      return res.status(400).send(`This plan does not offer ${rawTerm} billing.`);
    }
    if (!priceRow.is_enabled) {
      return res.status(400).send(`${rawTerm} billing is not currently available on this plan.`);
    }
    const priceRupees = Number(priceRow.price) || 0;
    if (priceRupees <= 0) {
      return res.status(400).send('This billing term has no payable amount configured.');
    }
    const gstPct = Number(priceRow.gst_percent) || Number(priceRow.plan_gst_percent) || GST_PERCENT_DEFAULT;
    const breakdown = computeGst(priceRupees, gstPct);

    // Mint the Razorpay Payment Link. Amount is the GST-INCLUSIVE
    // total_payable so the checkout page matches the plan card. Notes
    // carry the term so the webhook can extend subscription_end by the
    // right number of days, plus the GST snapshot for invoice history.
    const linkResult = await createPaymentLink({
      amountInRupees: breakdown.total_payable,
      institution: { ...institution, plan_name: institution.plan_name },
      notes: {
        action:         'onboarding',
        institution_id: String(institution.id),
        target_plan_id: String(institution.plan_id),
        plan_name:      institution.plan_name || '',
        billing_term:   rawTerm,
        base_price:     String(breakdown.base_price),
        gst_percent:    String(breakdown.gst_percent),
        gst_amount:     String(breakdown.gst_amount),
        total_payable:  String(breakdown.total_payable),
      },
    });
    if (!linkResult.ok) {
      return res.status(502).send(`Payment gateway error: ${linkResult.error}`);
    }

    // Point the institution's current pending payment link at the fresh URL
    // + record a pending transaction row so the ledger stays truthful.
    await pool.query(
      `UPDATE institutions SET
         payment_link_id     = $1,
         payment_link_url    = $2,
         payment_link_status = 'pending',
         payment_amount      = $3
       WHERE id = $4`,
      [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, institution.id],
    );
    try {
      await pool.query(
        `INSERT INTO subscription_transactions
           (institution_id, plan_id, plan_name_snapshot, action, previous_plan_id,
            base_paise, referral_discount_paise, amount_paise,
            status, razorpay_link_id, razorpay_short_url,
            billing_cycle, payment_gateway)
         VALUES ($1, $2, $3, 'onboarding', NULL,
                 $4, 0, $4,
                 'pending', $5, $6,
                 $7, 'razorpay')`,
        [
          institution.id, institution.plan_id, institution.plan_name || null,
          linkResult.link.amountPaise,
          linkResult.link.id, linkResult.link.short_url,
          // billing term picked at mint time — surfaces on the Super
          // Admin subscription-payments list without needing to join
          // back to plan_pricing.
          rawTerm || null,
        ],
      );
    } catch (err) {
      console.warn('[startApprovalPayment] ledger insert failed:', err?.message);
    }

    // Straight 302 to Razorpay's hosted checkout.
    res.redirect(302, linkResult.link.short_url);
  } catch (err) {
    console.error('startApprovalPayment error:', err);
    res.status(500).send('Server error. Please try again in a moment.');
  }
};

// GET /api/onboarding/payment-success
//
// Backend fallback for the post-payment landing page. Razorpay
// redirects the payer to `${WEB_APP_URL}/payment-success` — that's
// a real frontend route in production, but during dev or if the
// frontend hasn't been deployed yet the payer would land on a 404.
// A tiny nginx rule can rewrite `/payment-success` to this endpoint
// so nobody gets stranded on the raw Razorpay callback URL.
//
// Renders a branded confirmation card with:
//   • Success tick + "Payment received"
//   • Institution name + amount (looked up from the pending row)
//   • "Open Veerify" CTA that deep-links back into the mobile app
//     with a marketing fallback to the download page.
//
// Public — no auth. Safe because we only surface the institution
// name; no PII beyond what the payer already knew.
exports.renderPaymentSuccessPage = async (req, res) => {
  try {
    const instId  = parseInt(req.query.institution_id, 10);
    const already = req.query.already === '1';
    let institution = null;
    if (Number.isFinite(instId)) {
      const q = await pool.query(
        `SELECT id, name, onboarding_status, plan_id
           FROM institutions
          WHERE id = $1 AND deleted_at IS NULL
          LIMIT 1`,
        [instId],
      );
      institution = q.rows[0] || null;
    }

    const title = already
      ? 'Subscription already active'
      : 'Payment received';
    const sub = already
      ? "You're all set — this institution's subscription is already active. Open the Veerify app to sign in."
      : "Thanks! We've received your payment. The webhook usually confirms it within a few seconds — refresh the app to see your subscription go live.";

    const instName = institution?.name
      ? String(institution.name).replace(/[<>&"']/g, (c) => (
          { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]
        ))
      : null;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Veerify</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #F5F3FF 0%, #FDF2F8 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #111827; padding: 24px;
    }
    .card {
      max-width: 460px; width: 100%; background: #fff;
      border-radius: 20px; padding: 32px 28px;
      box-shadow: 0 20px 60px rgba(15,23,42,0.08),
                  0 4px 12px rgba(15,23,42,0.04);
      text-align: center;
    }
    .tick {
      width: 72px; height: 72px; border-radius: 50%;
      background: #10B981; margin: 4px auto 20px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 10px 30px rgba(16,185,129,0.35);
    }
    .tick svg { width: 40px; height: 40px; stroke: #fff; }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 800; }
    p  { margin: 0 0 8px; color: #6B7280; line-height: 1.55; font-size: 14px; }
    .inst {
      display: inline-block; margin: 14px 0 6px;
      padding: 8px 14px; border-radius: 999px;
      background: #F3E8FF; color: #6D28D9; font-weight: 700; font-size: 13px;
    }
    .cta {
      display: inline-block; margin-top: 22px;
      padding: 12px 22px; border-radius: 12px;
      background: #6D28D9; color: #fff; font-weight: 700;
      text-decoration: none; font-size: 14px;
    }
    .foot { margin-top: 22px; font-size: 11px; color: #9CA3AF; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tick">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>${title}</h1>
    ${instName ? `<div class="inst">${instName}</div>` : ''}
    <p>${sub}</p>
    <a class="cta" href="veerify://payment-complete">Open Veerify</a>
    <div class="foot">You can safely close this tab.</div>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('renderPaymentSuccessPage error:', err);
    return res.status(500).send('Server error. Please try again in a moment.');
  }
};

exports.createRenewalPaymentLink = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const { plan_id: requestedPlanId, billing_term: requestedTerm } = req.body || {};

    const { rows } = await pool.query(
      `SELECT i.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone,
              sp.name AS plan_name, sp.price AS plan_price, sp.gst_percent AS plan_gst_percent
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

    // Resolve target plan. When plan_id is provided we validate + fetch
    // its own row (with discount + GST cols) so upgrade / downgrade go
    // through the same code path as renewal.
    let targetPlanId = institution.plan_id;
    let targetPlanName = institution.plan_name;
    let targetPlanPrice = Number(institution.plan_price) || 0;
    let targetGstPct = Number(institution.plan_gst_percent) || GST_PERCENT_DEFAULT;
    let targetDiscountOn = false;
    let targetDiscountPct = 0;
    let action = 'renew';

    if (requestedPlanId && Number(requestedPlanId) !== Number(institution.plan_id)) {
      const tp = await pool.query(
        `SELECT id, name, price, discount_enabled, discount_percent, is_active, gst_percent
           FROM subscription_plans WHERE id = $1 LIMIT 1`,
        [requestedPlanId],
      );
      const t = tp.rows[0];
      if (!t)               return res.status(404).json({ message: 'Target plan not found.' });
      if (!t.is_active)     return res.status(400).json({ message: 'Target plan is not currently available.' });
      targetPlanId    = t.id;
      targetPlanName  = t.name;
      targetPlanPrice = Number(t.price) || 0;
      targetGstPct    = Number(t.gst_percent) || GST_PERCENT_DEFAULT;
      targetDiscountOn  = !!t.discount_enabled;
      targetDiscountPct = Number(t.discount_percent) || 0;
      action = 'change_plan';
    } else {
      // Renewing the current plan — read its discount + gst cols separately.
      if (institution.plan_id) {
        const cp = await pool.query(
          `SELECT discount_enabled, discount_percent, gst_percent
             FROM subscription_plans WHERE id = $1`,
          [institution.plan_id],
        );
        targetDiscountOn  = !!cp.rows[0]?.discount_enabled;
        targetDiscountPct = Number(cp.rows[0]?.discount_percent) || 0;
        targetGstPct      = Number(cp.rows[0]?.gst_percent) || GST_PERCENT_DEFAULT;
      }
    }

    // ── Per-term pricing (migration 049) ────────────────────────────
    // When the client sends a billing_term, resolve the price + GST
    // from plan_pricing so the payment amount matches whichever term
    // the admin picked on mobile. Falls back to the legacy singleton
    // price for older clients or plans without per-term rows. Per-term
    // gst_percent, when present, overrides the plan-level rate — this
    // is how a Super Admin can taxes a promotional yearly at a
    // different slab than the monthly.
    let resolvedTerm = requestedTerm || null;
    if (resolvedTerm) {
      const pp = await pool.query(
        `SELECT price, is_enabled, gst_percent FROM plan_pricing
          WHERE plan_id = $1 AND billing_term = $2`,
        [targetPlanId, resolvedTerm],
      );
      const row = pp.rows[0];
      if (!row) {
        return res.status(400).json({ message: `This plan does not offer ${resolvedTerm} billing.` });
      }
      if (!row.is_enabled) {
        return res.status(400).json({ message: `${resolvedTerm} billing is not available on this plan.` });
      }
      targetPlanPrice = Number(row.price) || 0;
      if (Number.isFinite(Number(row.gst_percent))) {
        targetGstPct = Number(row.gst_percent);
      }
    }

    if (!targetPlanPrice || targetPlanPrice <= 0) {
      return res.status(400).json({ message: 'Selected plan has no payable amount. Please pick another plan.' });
    }

    const basePrice = targetPlanPrice;
    const effectivePrice = targetDiscountOn && targetDiscountPct > 0
      ? Math.round(basePrice * (1 - targetDiscountPct / 100) * 100) / 100
      : basePrice;

    // Referral wallet discount — only apply to a straight renewal, not
    // to plan changes (avoids double-dipping on cross-plan pricing).
    let referralDiscount = 0;
    if (action === 'renew') {
      try {
        const r = await consumeDiscount(institution.id, effectivePrice);
        referralDiscount = Number(r?.discount) || 0;
      } catch (err) {
        console.warn('[renew] referral discount failed:', err?.message);
      }
    }
    const finalBase      = Math.max(0, effectivePrice - referralDiscount);
    const finalBreakdown = computeGst(finalBase, targetGstPct);
    const finalPayable   = finalBreakdown.total_payable;

    // Mint the Razorpay Payment Link with rich notes so the webhook
    // knows exactly what it's confirming — action, plan, billing term,
    // AND the GST snapshot. The billing_term drives the subscription-
    // window extension (30 / 90 / 180 / 365 days) on webhook
    // confirmation. Amount is GST-INCLUSIVE total_payable.
    const linkResult = await createPaymentLink({
      amountInRupees: finalPayable,
      institution: { ...institution, plan_name: targetPlanName },
      notes: {
        action,
        institution_id: String(institution.id),
        target_plan_id: String(targetPlanId),
        plan_name:      targetPlanName || '',
        billing_term:   resolvedTerm || '',
        base_price:     String(finalBreakdown.base_price),
        gst_percent:    String(finalBreakdown.gst_percent),
        gst_amount:     String(finalBreakdown.gst_amount),
        total_payable:  String(finalBreakdown.total_payable),
      },
    });
    if (!linkResult.ok) {
      return res.status(502).json({ message: `Could not create payment link: ${linkResult.error}` });
    }

    // Store payment reference on the institution (used by /subscription-status).
    await pool.query(
      `UPDATE institutions SET
         payment_link_id     = $1,
         payment_link_url    = $2,
         payment_link_status = 'pending',
         payment_amount      = $3
       WHERE id = $4`,
      [linkResult.link.id, linkResult.link.short_url, linkResult.link.amountPaise, institution.id],
    );

    // Record a pending row in the transactions ledger. billing_cycle
    // is the term the caller picked (monthly / quarterly / annual /
    // half_yearly) and gets read straight off the mint result's notes
    // so the Super Admin ledger listing gets the right label even for
    // plans that offer several terms.
    await pool.query(
      `INSERT INTO subscription_transactions
         (institution_id, plan_id, plan_name_snapshot, action, previous_plan_id,
          base_paise, referral_discount_paise, amount_paise,
          status, razorpay_link_id, razorpay_short_url,
          billing_cycle, payment_gateway)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, 'razorpay')`,
      [
        institution.id,
        targetPlanId,
        targetPlanName || null,
        action,
        action === 'change_plan' ? institution.plan_id : null,
        Math.round(basePrice * 100),
        Math.round(referralDiscount * 100),
        linkResult.link.amountPaise,
        linkResult.link.id,
        linkResult.link.short_url,
        // Prefer the term the caller explicitly requested; fall back to
        // the one baked into the notes we sent to Razorpay.
        requestedTerm || resolvedTerm || null,
      ],
    );

    res.json({
      message:          'Payment link created',
      action,
      payment_link_url: linkResult.link.short_url,
      link_id:          linkResult.link.id,
      amount:           finalPayable,          // GST-inclusive (what Razorpay charges)
      base_price:       finalBreakdown.base_price,
      gst_percent:      finalBreakdown.gst_percent,
      gst_amount:       finalBreakdown.gst_amount,
      total_payable:    finalBreakdown.total_payable,
      referral_discount: referralDiscount,
      plan_id:          targetPlanId,
      plan_name:        targetPlanName,
    });
  } catch (err) {
    console.error('createRenewalPaymentLink error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/onboarding/payment-history
//
// Institution-admin views their subscription transaction history under
// Pricing & Plans → Payment History.
exports.listPaymentHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const uRow = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [userId],
    );
    const institutionId = uRow.rows[0]?.institution_id;
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });

    const rows = await pool.query(
      `SELECT id, plan_id, plan_name_snapshot AS plan_name, action, previous_plan_id,
              base_paise, referral_discount_paise, amount_paise,
              status, razorpay_link_id, razorpay_payment_id,
              created_at, paid_at, new_subscription_end
         FROM subscription_transactions
        WHERE institution_id = $1
        ORDER BY created_at DESC
        LIMIT 200`,
      [institutionId],
    );
    res.json({ count: rows.rowCount, transactions: rows.rows });
  } catch (err) {
    console.error('listPaymentHistory error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/onboarding/mark-payment-cancelled
//
// Mobile calls this if the admin backs out of the Razorpay page without
// paying (checkout page tab closed). Sets the still-pending transaction
// to 'cancelled' so the history is truthful.
exports.markPaymentCancelled = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const uRow = await pool.query(
      `SELECT institution_id FROM users WHERE id = $1`, [userId],
    );
    const institutionId = uRow.rows[0]?.institution_id;
    if (!institutionId) return res.status(400).json({ message: 'No institution linked' });

    const { link_id } = req.body || {};
    if (!link_id) return res.status(400).json({ message: 'link_id required' });

    await pool.query(
      `UPDATE subscription_transactions
          SET status = 'cancelled'
        WHERE institution_id = $1
          AND razorpay_link_id = $2
          AND status = 'pending'`,
      [institutionId, link_id],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('markPaymentCancelled error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Super-admin: edit any institution's details ────────────────────────────
// PUT /api/onboarding/:id/super-admin-edit
//
// Used by the admin web to fill in / update institution fields on behalf of
// an institution. Particularly useful for branches whose parent only
// provided basic info — super admin can complete the Accreditation /
// Operations / Master sections here without bothering the branch admin.
//
// Accepts any subset of fields; uses COALESCE NULLIF so unsent / blank
// values leave the existing value untouched. Touches every category
// EXCEPT staff (trainers) and courses, which live on their own tables.
// POST /api/onboarding/:id/resend-branch-credentials
//
// Recovery flow for sub-branches whose credentials email got lost, never
// arrived (landed in spam), or where the branch admin forgot their temp
// password. The endpoint:
//   1. Validates that :id is a SUB-branch (parent_institution_id is set).
//      Main-branch institutions use the regular password-reset flow.
//   2. Generates a fresh temp password, hashes it, writes it to the
//      branch admin's users row.
//   3. Sends sendBranchSetupEmail with the new password to the branch's
//      official email. Awaited this time (not fire-and-forget) so the
//      caller knows whether the SMTP send succeeded.
//
// Idempotent — each call rotates the temp password, so a second click
// invalidates the password from the first click. That's the correct
// behavior for credential recovery.
exports.resendBranchCredentials = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid institution id' });
    }

    // Pull the branch row + its parent's name (used in the email copy)
    // + the branch admin user's id and email.
    const r = await pool.query(
      `SELECT
         child.id            AS branch_id,
         child.name          AS branch_name,
         child.address       AS branch_address,
         child.city          AS branch_city,
         child.pincode       AS branch_pincode,
         child.email         AS branch_email,
         child.owner_user_id AS branch_user_id,
         child.parent_institution_id,
         parent.name         AS parent_name,
         parent_owner.name   AS parent_owner_name
       FROM institutions child
       LEFT JOIN institutions parent
              ON parent.id = child.parent_institution_id
       LEFT JOIN users parent_owner
              ON parent_owner.id = parent.owner_user_id
       WHERE child.id = $1`,
      [id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    const row = r.rows[0];
    if (!row.parent_institution_id) {
      return res.status(400).json({
        message: 'This is a main-branch institution. Use the standard password reset flow instead.',
      });
    }
    if (!row.branch_user_id) {
      return res.status(400).json({
        message: 'No branch admin user is linked to this sub-branch. Please contact support.',
      });
    }
    if (!row.branch_email) {
      return res.status(400).json({
        message: 'This sub-branch has no email on file — add one before resending credentials.',
      });
    }

    // Rotate the password.
    const newPassword = generateTempPassword();
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      // Re-arm must_change_password so the first-login dialog reappears
      // after a credential reset too — the user now has another temp
      // password they should rotate.
      `UPDATE users
          SET password = $1, must_change_password = TRUE, updated_at = NOW()
        WHERE id = $2`,
      [hashed, row.branch_user_id],
    );

    // Send the email — awaited so we surface the outcome.
    const branchAddress = [row.branch_address, row.branch_city, row.branch_pincode]
      .filter(Boolean).join(', ');
    const mailResult = await sendBranchSetupEmail({
      to:              row.branch_email,
      branchName:      row.branch_name,
      branchAddress,
      institutionName: row.parent_name || '',
      ownerName:       row.parent_owner_name || '',
      loginEmail:      row.branch_email,
      loginPassword:   newPassword,
    });

    if (!mailResult.ok) {
      // Password is already rotated, but the email failed. Tell the
      // caller so they can try again or copy the password manually.
      return res.status(502).json({
        message: 'Password rotated but email send failed. Try again, or share the temp password manually.',
        temp_password: newPassword,
        smtp_error:    mailResult.error,
      });
    }

    res.json({
      message: `Fresh login credentials sent to ${row.branch_email}.`,
      sent_to: row.branch_email,
    });
  } catch (err) {
    console.error('[resendBranchCredentials] error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/onboarding/:parentId/provision-branch
//
// Sister of resendBranchCredentials, but operates on a branch row inside
// the parent's JSONB branches[] array. Handles BOTH cases:
//
//   • Branch was never provisioned (no child institutions row) — the
//     setupAcademy loop may have skipped it because the email already
//     existed, threw silently, or the branch was added later. We run
//     the missing provisioning step now: create the branch admin user,
//     create the child institution row inheriting the parent's plan +
//     lifecycle, link them, then email the credentials.
//
//   • Branch was already provisioned — same recovery path as
//     resendBranchCredentials: rotate the temp password and re-email.
//
// Body: { branch_index } (the position in the parent's branches[] JSONB).
exports.provisionOrResendBranch = async (req, res) => {
  try {
    const parentId = parseInt(req.params.parentId, 10);
    const idx = parseInt(req.body?.branch_index, 10);
    if (!Number.isInteger(parentId) || !Number.isInteger(idx) || idx < 0) {
      return res.status(400).json({
        message: 'parentId and branch_index are required',
      });
    }

    // Pull the parent + its owner so we can use the parent's plan / lifecycle
    // when creating a fresh child institution.
    const parentRes = await pool.query(
      `SELECT i.*, u.name AS owner_name
         FROM institutions i
         JOIN users u ON u.id = i.owner_user_id
        WHERE i.id = $1`,
      [parentId],
    );
    if (parentRes.rows.length === 0) {
      return res.status(404).json({ message: 'Parent institution not found' });
    }
    const parent = parentRes.rows[0];
    if (parent.parent_institution_id) {
      return res.status(400).json({
        message: 'This is a sub-branch. Pass its parent institution id instead.',
      });
    }
    const branches = Array.isArray(parent.branches) ? parent.branches : [];
    // Log what we actually got so we can diagnose blank-branch /
    // missing-email errors against the parent row.
    console.log(
      '[provisionOrResendBranch]',
      `parent=${parentId}`,
      `branch_index=${idx}`,
      `branches_count=${branches.length}`,
      `branch_at_idx=`, branches[idx],
    );
    const branch = branches[idx];
    if (!branch) {
      return res.status(404).json({
        message: branches.length === 0
          ? 'This institution has no branches saved on its record. Re-run the setup wizard and add the branch with an email.'
          : `No branch found at slot ${idx + 1}. The institution only has ${branches.length} branch${branches.length === 1 ? '' : 'es'} saved.`,
      });
    }
    const branchEmail = (branch.email || '').toString().trim().toLowerCase();
    if (!branchEmail) {
      return res.status(400).json({
        message: `Branch "${branch.name || `#${idx + 1}`}" has no email on file. Open the parent setup wizard, add an email to this branch, save, then try again.`,
      });
    }

    // ── Look for an existing child institution.
    //
    // We try two matches in priority order:
    //   (a) parent_id + case-insensitive email match — happy path,
    //       JSONB and the child row are in sync.
    //   (b) parent_id + case-insensitive name match — fallback for the
    //       common desync case where someone edited the branch email in
    //       the parent's setup wizard AFTER the child user was created,
    //       so the JSONB says one address and the child row says another.
    //       When (b) matches, we'll re-align both the child institution's
    //       email column AND the linked user's login email to whatever
    //       the JSONB now says, then rotate the password. The branch
    //       admin's new login email becomes the one displayed on the
    //       parent's page.
    let childRes = await pool.query(
      `SELECT id, owner_user_id, name, email
         FROM institutions
        WHERE parent_institution_id = $1
          AND LOWER(email) = $2
          AND COALESCE(deleted_at::text, '') = ''
        LIMIT 1`,
      [parentId, branchEmail],
    );
    let realignedFromEmail = null;
    if (childRes.rows.length === 0 && (branch.name || '').trim()) {
      const nameMatch = await pool.query(
        `SELECT id, owner_user_id, name, email
           FROM institutions
          WHERE parent_institution_id = $1
            AND LOWER(name) = $2
            AND COALESCE(deleted_at::text, '') = ''
          LIMIT 1`,
        [parentId, branch.name.trim().toLowerCase()],
      );
      if (nameMatch.rows.length > 0) {
        childRes = nameMatch;
        realignedFromEmail = (nameMatch.rows[0].email || '').toLowerCase();
        // Make sure the new email isn't already taken by an unrelated
        // user — otherwise the realignment UPDATE below would fail.
        if (realignedFromEmail !== branchEmail) {
          const conflict = await pool.query(
            `SELECT id FROM users
              WHERE LOWER(email) = $1
                AND id <> $2
                AND COALESCE(is_deleted, FALSE) = FALSE
              LIMIT 1`,
            [branchEmail, nameMatch.rows[0].owner_user_id],
          );
          if (conflict.rows.length > 0) {
            return res.status(409).json({
              message:
                `Another user already uses ${branchEmail}. Change the branch's email in the parent's setup wizard, or pick a different address.`,
            });
          }
        }
      }
    }

    const newPassword = generateTempPassword();
    const hashed = await bcrypt.hash(newPassword, 10);

    let branchUserId;
    let childInstId;
    let branchName;
    let mode; // 'provisioned' or 'rotated'

    if (childRes.rows.length > 0) {
      // ── Recovery path — child exists, just rotate the password.
      childInstId   = childRes.rows[0].id;
      branchUserId  = childRes.rows[0].owner_user_id;
      branchName    = childRes.rows[0].name;

      // If we matched by NAME and the child's email differs from the
      // JSONB email (the desync case), re-align both the child
      // institution and the user's login email to what the parent's
      // JSONB now says. This keeps the displayed email and the actual
      // login id in sync going forward.
      if (realignedFromEmail && realignedFromEmail !== branchEmail) {
        await pool.query(
          `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2`,
          [branchEmail, branchUserId],
        );
        await pool.query(
          `UPDATE institutions SET email = $1, updated_at = NOW() WHERE id = $2`,
          [branchEmail, childInstId],
        );
        console.log(
          `[provisionOrResendBranch] re-aligned branch ${childInstId} email`,
          `${realignedFromEmail} → ${branchEmail}`,
        );
      }

      await pool.query(
        // Re-arm must_change_password so the first-login dialog reappears
        // after a credential reset too — the user now has another temp
        // password they should rotate.
        `UPDATE users
            SET password = $1, must_change_password = TRUE, updated_at = NOW()
          WHERE id = $2`,
        [hashed, branchUserId],
      );
      mode = 'rotated';
    } else {
      // ── First-time provisioning — create user + child institution.
      // Check the email isn't already taken by some unrelated user.
      const dup = await pool.query(
        `SELECT id, institution_id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        [branchEmail],
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({
          message:
            'A user with this email already exists but isn\'t linked to this branch. Change the branch email to a unique address, or contact support to re-link.',
          existing_user_id: dup.rows[0].id,
        });
      }

      const adminName = `${branch.name || 'Branch'} Admin`;
      const newUser = await pool.query(
        // must_change_password TRUE — mobile pops the "change password /
        // do it later" dialog on the branch admin's first sign-in.
        `INSERT INTO users (name, email, phone, password, role, status,
                            must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', 'active', TRUE)
         RETURNING id`,
        [adminName, branchEmail, branch.contact_number || null, hashed],
      );
      branchUserId = newUser.rows[0].id;
      branchName   = branch.name || `${parent.name} - Branch`;

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
          parent.id,
          branchName,
          parent.brand_name,
          parent.institution_type,
          parent.institution_types,
          branch.address || parent.address,
          branch.city    || parent.city,
          branch.pincode || parent.pincode,
          branchEmail,
          branch.contact_number || parent.phone,
          parent.plan_id,
          parent.onboarding_status,
          parent.status,
          parent.paid_at,
          parent.subscription_start,
          parent.subscription_end,
          parent.trial_starts_at,
          parent.trial_ends_at,
          parent.grace_ends_at,
        ],
      );
      childInstId = childInst.rows[0].id;
      await pool.query(
        `UPDATE users SET institution_id = $1 WHERE id = $2`,
        [childInstId, branchUserId],
      );
      mode = 'provisioned';
    }

    // ── Send email (awaited so we surface the outcome).
    const branchAddress = [branch.address, branch.city, branch.pincode]
      .filter(Boolean).join(', ');
    const mailResult = await sendBranchSetupEmail({
      to:              branchEmail,
      branchName,
      branchAddress,
      institutionName: parent.name || '',
      ownerName:       parent.owner_name || '',
      loginEmail:      branchEmail,
      loginPassword:   newPassword,
    });

    if (!mailResult.ok) {
      return res.status(502).json({
        message: `Branch ${mode === 'provisioned' ? 'created' : 'password rotated'}, but the email send failed. Share the temp password manually.`,
        mode,
        child_institution_id: childInstId,
        temp_password:        newPassword,
        smtp_error:           mailResult.error,
      });
    }

    res.json({
      message: mode === 'provisioned'
        ? `Branch provisioned and credentials sent to ${branchEmail}.`
        : `Fresh credentials sent to ${branchEmail}.`,
      mode,
      child_institution_id: childInstId,
      sent_to:              branchEmail,
    });
  } catch (err) {
    console.error('[provisionOrResendBranch] error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.superAdminEditInstitution = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid institution id' });
    }

    // Sub-branch policy: a child institution mirrors its parent for every
    // non-location field, so editing one in isolation would just create
    // drift. Reject the request and tell the caller to edit the parent
    // instead. The admin web hides the Edit button on sub-branches, but
    // this guard makes sure the rule still holds for direct API calls.
    const parentCheck = await pool.query(
      `SELECT parent_institution_id FROM institutions WHERE id = $1`,
      [id],
    );
    if (parentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    if (parentCheck.rows[0].parent_institution_id) {
      return res.status(403).json({
        message:
          'Sub-branch details are inherited from the main branch — edit the parent institution to update them everywhere.',
        code: 'SUB_BRANCH_READ_ONLY',
      });
    }

    const b = req.body || {};

    // Sanitise the few jsonb / array fields. Anything not in the body is
    // sent as null and the SQL COALESCE keeps the existing column value.
    const safeTypes = Array.isArray(b.institution_types) ? b.institution_types : null;
    const safeSkills = Array.isArray(b.skills)
      ? b.skills.map((s) => String(s).trim()).filter(Boolean) : null;
    const safeMedium = Array.isArray(b.medium_of_instruction) ? b.medium_of_instruction : null;
    const safeBranches = Array.isArray(b.branches)
      ? JSON.stringify(b.branches.map((x) => ({
          name: String(x?.name || '').trim(),
          address: String(x?.address || '').trim(),
          city: String(x?.city || '').trim(),
          pincode: String(x?.pincode || '').trim(),
          email: String(x?.email || '').trim(),
          contact_number: String(x?.contact_number || '').trim(),
          latitude: x?.latitude != null && x.latitude !== '' ? Number(x.latitude) : null,
          longitude: x?.longitude != null && x.longitude !== '' ? Number(x.longitude) : null,
        })))
      : null;
    const sanitiseSlots = (raw) => {
      if (!Array.isArray(raw)) return null;
      const cleaned = raw
        .map((s) => ({ start: String(s?.start || ''), end: String(s?.end || '') }))
        .filter((s) => s.start && s.end);
      return JSON.stringify(cleaned);
    };
    const safeWeekday = sanitiseSlots(b.operating_hours_weekday);
    const safeWeekend = sanitiseSlots(b.operating_hours_weekend);
    // NOTE: there is no operating_hours_by_day column in the institutions
    // table — per-day slots are merged into operating_hours_weekday /
    // operating_hours_weekend at write time by the mobile wizard.

    // Single UPDATE — COALESCE+NULLIF means: only overwrite if the new
    // value is non-empty / non-null. This lets the form submit just the
    // fields the super admin actually filled in.
    const result = await pool.query(
      `UPDATE institutions SET
         -- core
         name                          = COALESCE(NULLIF($2,  ''), name),
         brand_name                    = COALESCE(NULLIF($3,  ''), brand_name),
         institution_type              = COALESCE(NULLIF($4,  ''), institution_type),
         institution_types             = COALESCE($5, institution_types),
         registration_number           = COALESCE(NULLIF($6,  ''), registration_number),
         date_of_establishment         = COALESCE($7::date, date_of_establishment),
         skills                        = COALESCE($8, skills),
         -- contact
         address                       = COALESCE(NULLIF($9,  ''), address),
         city                          = COALESCE(NULLIF($10, ''), city),
         pincode                       = COALESCE(NULLIF($11, ''), pincode),
         email                         = COALESCE(NULLIF($12, ''), email),
         phone                         = COALESCE(NULLIF($13, ''), phone),
         website_url                   = COALESCE(NULLIF($14, ''), website_url),
         latitude                      = COALESCE($15::numeric, latitude),
         longitude                     = COALESCE($16::numeric, longitude),
         branches                      = COALESCE($17::jsonb, branches),
         -- accreditation
         affiliation_or_board          = COALESCE(NULLIF($18, ''), affiliation_or_board),
         accreditation_body_name       = COALESCE(NULLIF($19, ''), accreditation_body_name),
         accreditation_expiry_date     = COALESCE($20::date, accreditation_expiry_date),
         accreditation_certificate_url = COALESCE(NULLIF($21, ''), accreditation_certificate_url),
         -- operations
         total_student_capacity        = COALESCE($22::int, total_student_capacity),
         current_enrollment            = COALESCE($23::int, current_enrollment),
         medium_of_instruction         = COALESCE($24, medium_of_instruction),
         operating_hours_weekday       = COALESCE($25::jsonb, operating_hours_weekday),
         operating_hours_weekend       = COALESCE($26::jsonb, operating_hours_weekend),
         -- master / point of contact
         master_name                   = COALESCE(NULLIF($27, ''), master_name),
         master_role                   = COALESCE(NULLIF($28, ''), master_role),
         master_email                  = COALESCE(NULLIF($29, ''), master_email),
         master_phone_number           = COALESCE(NULLIF($30, ''), master_phone_number),
         updated_at                    = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        b.name || '',
        b.brand_name || '',
        b.institution_type || '',
        safeTypes,
        b.registration_number || '',
        b.date_of_establishment || null,
        safeSkills,
        b.address || '',
        b.city || '',
        b.pincode || '',
        b.email || '',
        b.phone || '',
        b.website_url || '',
        b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null,
        b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null,
        safeBranches,
        b.affiliation_or_board || '',
        b.accreditation_body_name || '',
        b.accreditation_expiry_date || null,
        b.accreditation_certificate_url || '',
        b.total_student_capacity != null && b.total_student_capacity !== ''
          ? Number(b.total_student_capacity) : null,
        b.current_enrollment != null && b.current_enrollment !== ''
          ? Number(b.current_enrollment) : null,
        safeMedium,
        safeWeekday,
        safeWeekend,
        b.master_name || '',
        b.master_role || '',
        b.master_email || '',
        b.master_phone_number || '',
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Institution not found' });
    }
    res.json({ message: 'Institution updated', institution: result.rows[0] });
  } catch (err) {
    console.error('superAdminEditInstitution error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
