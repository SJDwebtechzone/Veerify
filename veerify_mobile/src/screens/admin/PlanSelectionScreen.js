import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, BackHandler, Image,
} from 'react-native';
import { Gift, ChevronDown, ChevronUp, LogOut, Sparkles } from 'lucide-react-native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';
import { useAuth } from '../../context/AuthContext';
import { confirm } from '../../components/ConfirmDialog';
import resolveAssetUrl from '../../utils/assetUrl';

// ── Billing cycle catalogue ─────────────────────────────────────────
// Order matters — pills render in this order. Months are used to work
// out the "at monthly rate" extrapolation for the savings badge.
const CYCLES = [
  { term: 'monthly',     label: 'Monthly',     short: 'Mo',  months: 1  },
  { term: 'quarterly',   label: 'Quarterly',   short: '3 Mo', months: 3  },
  { term: 'half_yearly', label: 'Half-Yearly', short: '6 Mo', months: 6  },
  { term: 'annual',      label: 'Annual',      short: '1 Yr', months: 12 },
];

// Turn plan.pricing_terms into a map keyed by billing_term for O(1)
// lookups. Ignores disabled terms so the selector never offers
// something the super admin has turned off. Each value is a
// { base_price, gst_percent, gst_amount, total_payable } snapshot
// so the pill / total-payable card can render the GST breakdown
// without recomputing it per render.
function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
function termBreakdown(basePrice, gstPercent) {
  const base = round2(basePrice);
  const pct  = Math.max(0, Math.min(50, Number(gstPercent) || 0));
  const gst  = round2(base * (pct / 100));
  return { base_price: base, gst_percent: pct, gst_amount: gst, total_payable: round2(base + gst) };
}
function termsMap(plan) {
  const out = {};
  const defaultPct = Number.isFinite(Number(plan?.gst_percent)) ? Number(plan.gst_percent) : 18;
  (plan.pricing_terms || []).forEach((t) => {
    if (t.is_enabled === false) return;
    if (!Number.isFinite(Number(t.price))) return;
    // Prefer server-computed breakdown when present; else compute
    // locally using the plan default rate.
    const pct = Number.isFinite(Number(t.gst_percent)) ? Number(t.gst_percent) : defaultPct;
    out[t.billing_term] = {
      base_price:    Number(t.base_price ?? t.price),
      gst_percent:   pct,
      gst_amount:    Number.isFinite(Number(t.gst_amount)) ? Number(t.gst_amount) : round2(Number(t.price) * (pct / 100)),
      total_payable: Number.isFinite(Number(t.total_payable)) ? Number(t.total_payable) : round2(Number(t.price) + round2(Number(t.price) * (pct / 100))),
    };
  });
  // Legacy fallback — very old plans without any pricing_terms row.
  if (Object.keys(out).length === 0 && plan.price != null) {
    out[plan.billing_cycle || 'monthly'] = termBreakdown(plan.price, defaultPct);
  }
  return out;
}
function fmtINR2(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Savings percentage for a longer term vs. the monthly rate. Only
// meaningful when both `monthly` and the target term are enabled.
// Returns null when it can't be computed (no monthly, or no discount).
function savingsPct(monthlyPrice, cyclePrice, months) {
  if (!monthlyPrice || !cyclePrice || !months || months === 1) return null;
  const straight = monthlyPrice * months;
  if (cyclePrice >= straight) return null;
  return Math.round(((straight - cyclePrice) / straight) * 100);
}

export default function PlanSelectionScreen({ navigation }) {
  const { logout } = useAuth();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  // Per-plan selected billing term. Populated on load — defaults to
  // monthly when enabled, otherwise the cheapest enabled term. Key is
  // plan.id, value is the billing_term string (e.g. 'quarterly').
  const [cycleByPlan, setCycleByPlan] = useState({});

  // Optional referral code — collapsible because most new admins won't have
  // one. The value is sent alongside plan_id to /onboarding/select-plan; the
  // backend resolves it to the referrer and inserts a pending referrals row.
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  // PlanSelection is the admin's initial route after registration, so we
  // need an explicit escape valve — without it there's literally no way
  // out of this screen once you land here, since the native back button is
  // hidden and there's no other navigation.
  const confirmSignOut = () => {
    confirm({
      title: 'Sign out?',
      message:
        'You\'ll need to log back in to pick a plan and finish setting up your academy.',
      variant: 'destructive',
      confirmText: 'Sign out',
      cancelText: 'Stay',
      onConfirm: () => {
        // eslint-disable-next-line no-console
        console.log('[PlanSelection] Sign out confirmed');
        try {
          const result = logout && logout();
          if (result && typeof result.catch === 'function') {
            result.catch((e) =>
              // eslint-disable-next-line no-console
              console.warn('[PlanSelection] logout error', e?.message),
            );
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[PlanSelection] logout threw', e?.message);
        }
      },
    });
  };

  const loadPlans = async () => {
    try {
      const res = await apiClient.get('/plans');
      const rows = res.data.plans || [];
      setPlans(rows);

      // Seed default billing cycle per plan — prefer monthly when it's
      // enabled (matches the mental model most admins bring to a plan
      // page), else the cheapest enabled term. Runs once per load so
      // switching plans doesn't reset the user's manual pick.
      const seed = {};
      rows.forEach((p) => {
        const map = termsMap(p);
        if (map.monthly != null) {
          seed[p.id] = 'monthly';
        } else {
          // Sort by base_price so the cheapest surfaces first,
          // matching the pre-GST behaviour.
          const cheapest = Object.entries(map)
            .sort((a, b) => (a[1].base_price - b[1].base_price))[0];
          if (cheapest) seed[p.id] = cheapest[0];
        }
      });
      setCycleByPlan(seed);
    } catch (err) {
      Alert.alert('Error', 'Failed to load plans. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (plan) => {
    setSelecting(true);
    setSelectedPlanId(plan.id);
    try {
      const term = cycleByPlan[plan.id] || plan.billing_cycle || 'monthly';
      const map = termsMap(plan);
      // Send the GST-EXCLUSIVE base price. The backend layers GST on
      // itself so we never trust a client-computed total for the
      // charge amount.
      const price = map[term]?.base_price ?? Number(plan.price) ?? 0;
      const body = { plan_id: plan.id, billing_term: term, price };
      const code = referralCode.trim().toUpperCase();
      if (code) body.referral_code = code;
      await apiClient.post('/onboarding/select-plan', body);
      navigation.navigate('SetupInstitution');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to select plan');
    } finally {
      setSelecting(false);
      setSelectedPlanId(null);
    }
  };

  // Intercept Android hardware back button — PlanSelection is the root of
  // the admin stack so there's no previous screen to pop to. Without this,
  // pressing back closes the entire app. Instead we show the sign-out
  // confirmation dialog, which is the only valid escape valve from here.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmSignOut();
      return true; // prevent default (app close)
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPlans();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coerce max_* values coming from the API into either a positive
  // integer or null (treated as unlimited). Anything ≥ 999 is also
  // treated as unlimited for backward compat with earlier plan rows
  // seeded that way.
  const capOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n >= 999) return null;
    return Math.floor(n);
  };
  const featureList = (plan) => {
    const students = capOrNull(plan.max_students);
    const trainers = capOrNull(plan.max_trainers);
    const branches = capOrNull(plan.max_branches);
    // plan.features is stored as a JSONB **array of strings** on the
    // backend (admin web collects them line-by-line). Previously we
    // treated it as an object of flags and never rendered the admin's
    // custom feature list.
    const custom = Array.isArray(plan.features) ? plan.features : [];
    return [
      branches === 1
        ? '🏛️ Single Branch'
        : branches === null
          ? '🏛️ Unlimited Branches'
          : `🏛️ Up to ${branches} Branches`,
      students === null
        ? '👥 Unlimited Students'
        : `👥 Up to ${students} Students`,
      trainers === null
        ? '👨‍🏫 Unlimited Trainers'
        : `👨‍🏫 Up to ${trainers} Trainers`,
      ...custom,
    ];
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Top-right Sign out pill — the only escape valve from this screen
          since the native back button is hidden. Tapping calls logout(),
          which clears the JWT and bounces us back to Welcome. */}
      <View style={styles.topRightRow}>
        <TouchableOpacity
          onPress={confirmSignOut}
          style={styles.signOutBtn}
          activeOpacity={0.85}
        >
          <LogOut size={13} color={colors.textLight} strokeWidth={2.4} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Choose Your Plan</Text>
        <Text style={styles.headerSubtitle}>
          Select the plan that fits your academy's needs.{'\n'}
          You can upgrade anytime.
        </Text>
      </View>

      {/* Referral code — collapsed by default. Tap to reveal a single
          input. If filled, it's submitted with the plan choice. */}
      <View style={styles.referralCard}>
        <TouchableOpacity
          onPress={() => setReferralOpen((v) => !v)}
          style={styles.referralHeader}
          activeOpacity={0.85}
        >
          <Gift size={16} color={colors.primary} strokeWidth={2.4} />
          <Text style={styles.referralHeaderText}>
            {referralCode.trim()
              ? `Referral code: ${referralCode.trim().toUpperCase()}`
              : 'Have a referral code?'}
          </Text>
          {referralOpen
            ? <ChevronUp size={16} color={colors.textLight} />
            : <ChevronDown size={16} color={colors.textLight} />}
        </TouchableOpacity>
        {referralOpen ? (
          <View style={styles.referralBody}>
            <Text style={styles.referralHint}>
              Paste the code shared by another institution to earn them rewards
              when you complete your first subscription.
            </Text>
            <TextInput
              value={referralCode}
              onChangeText={setReferralCode}
              placeholder="VEER-XXXXXX"
              placeholderTextColor={colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.referralInput}
              maxLength={20}
            />
          </View>
        ) : null}
      </View>

      {/* Plan cards */}
      {plans.map((plan) => (
        <View
          key={plan.id}
          style={[
            styles.planCard,
            plan.is_popular && styles.planCardPopular
          ]}
        >
          {/* Popular badge */}
          {plan.is_popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>⭐ MOST POPULAR</Text>
            </View>
          )}

          {/* Plan header — image sits to the right of the plan name.
              Price + billing-cycle selector live below the header now
              because they occupy real vertical space with the new
              4-cycle grid. Falls back to a soft brand-tinted
              placeholder when no image is uploaded. */}
          <View style={styles.planHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>{plan.name}</Text>
                <Text style={styles.planTagline}>
                  Pick the billing cycle that suits you.
                </Text>
              </View>
              <PlanImageThumb src={plan.image_url} />
            </View>

            {/* ── Billing cycle selector ────────────────────────────
                One pill per enabled term (Monthly / Quarterly /
                Half-Yearly / Annual). Each pill shows the label + the
                real ₹ price for that cycle. Longer cycles that cost
                less than N × monthly display a "SAVE X%" chip. Only
                the pill for the selected term is highlighted; tapping
                a pill flips this plan's cycle and instantly updates
                the total payable below. */}
            <BillingCycleSelector
              plan={plan}
              selected={cycleByPlan[plan.id]}
              onSelect={(term) =>
                setCycleByPlan((prev) => ({ ...prev, [plan.id]: term }))
              }
            />

            {/* ── Total payable ─────────────────────────────────────
                Sits right under the selector so the amount the admin
                is about to be charged updates the moment they tap a
                different cycle pill. */}
            <TotalPayable
              plan={plan}
              selected={cycleByPlan[plan.id]}
            />

            {/* Trial + grace period pills */}
            {(Number(plan.trial_days) > 0 || Number(plan.grace_days) > 0) ? (
              <View style={styles.trialRow}>
                {Number(plan.trial_days) > 0 ? (
                  <View style={[styles.trialPill, styles.trialPillBlue]}>
                    <Text style={styles.trialPillText}>
                      🎁 {plan.trial_days}-day free trial
                    </Text>
                  </View>
                ) : null}
                {Number(plan.grace_days) > 0 ? (
                  <View style={[styles.trialPill, styles.trialPillAmber]}>
                    <Text style={styles.trialPillTextAmber}>
                      +{plan.grace_days}-day grace
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Features */}
          <View style={styles.featureList}>
            {featureList(plan).map((feature, idx) => (
              <View key={idx} style={styles.featureRow}>
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>

          {/* Select button */}
          <TouchableOpacity
            style={[
              styles.selectButton,
              plan.is_popular && styles.selectButtonPopular
            ]}
            onPress={() => handleSelectPlan(plan)}
            disabled={selecting}
            activeOpacity={0.85}
          >
            {selecting && selectedPlanId === plan.id ? (
              <ActivityIndicator color={plan.is_popular ? colors.white : colors.primary} />
            ) : (
              <Text style={[
                styles.selectButtonText,
                plan.is_popular && styles.selectButtonTextPopular
              ]}>
                Get Started with {plan.name}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ))}

      {/* Footer note */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          🔒 Secure payment powered by Razorpay{'\n'}
          Cancel anytime. No hidden fees.
        </Text>
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

// ── BillingCycleSelector ─────────────────────────────────────────────
// Renders 4 pills (or fewer, if the super admin disabled some terms).
// Each pill shows: cycle name, real ₹ price, and a "SAVE X%" chip if
// the term is cheaper per month than the monthly rate. Tapping a pill
// flips the selection — the parent hoists that into cycleByPlan.
function BillingCycleSelector({ plan, selected, onSelect }) {
  const map    = termsMap(plan);
  const monthlyBase = map.monthly?.base_price ?? null;

  return (
    <View style={styles.cycleGrid}>
      {CYCLES.map((c) => {
        const row = map[c.term];
        // Term is disabled or the plan doesn't offer it — skip.
        if (row == null) return null;
        const isSel = selected === c.term;
        // Savings comparison uses the GST-exclusive base (so a rate
        // slab change doesn't distort the discount headline).
        const save  = savingsPct(monthlyBase, row.base_price, c.months);
        return (
          <TouchableOpacity
            key={c.term}
            onPress={() => onSelect(c.term)}
            activeOpacity={0.85}
            style={[styles.cyclePill, isSel && styles.cyclePillActive]}
          >
            <View style={styles.cyclePillHead}>
              <Text style={[styles.cycleLabel, isSel && styles.cycleLabelActive]}>
                {c.label}
              </Text>
              {save != null ? (
                <View style={[styles.saveChip, isSel && styles.saveChipActive]}>
                  <Text style={[styles.saveChipText, isSel && styles.saveChipTextActive]}>
                    SAVE {save}%
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.cyclePrice, isSel && styles.cyclePriceActive]}>
              {fmtINR2(row.total_payable)}
            </Text>
            <Text style={[styles.cyclePer, isSel && styles.cyclePerActive]}>
              per {c.label.toLowerCase()}
            </Text>
            <Text style={[styles.cycleBreakdown, isSel && styles.cycleBreakdownActive]}>
              Base {fmtINR2(row.base_price)} + GST {row.gst_percent}%
            </Text>
            <Text style={[styles.cycleIncludesGst, isSel && styles.cycleIncludesGstActive]}>
              Includes GST
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── TotalPayable ─────────────────────────────────────────────────────
// Big highlighted amount + a one-line breakdown ("₹9,600 billed once
// every 12 months · Save 20% vs monthly"). Reactive to the selected
// cycle above.
function TotalPayable({ plan, selected }) {
  const map     = termsMap(plan);
  const cycle   = CYCLES.find((c) => c.term === selected) || CYCLES[0];
  const row     = map[cycle.term] || { base_price: 0, gst_percent: 0, gst_amount: 0, total_payable: 0 };
  const monthlyBase = map.monthly?.base_price ?? null;
  const save    = savingsPct(monthlyBase, row.base_price, cycle.months);

  return (
    <View style={styles.totalCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.totalLabel}>Total payable</Text>
        <Text style={styles.totalBreakdown}>
          Billed once every {cycle.months} {cycle.months === 1 ? 'month' : 'months'}
          {save != null ? ` · Save ${save}% vs monthly` : ''}
        </Text>
        <Text style={styles.totalBreakdown}>
          Base {fmtINR2(row.base_price)} + GST {row.gst_percent}% ({fmtINR2(row.gst_amount)})
        </Text>
        <Text style={styles.totalIncludesGst}>Includes GST</Text>
      </View>
      <Text style={styles.totalAmount}>
        {fmtINR2(row.total_payable)}
      </Text>
    </View>
  );
}

// Plan-image thumbnail — a 44x44 circle with a subtle brand-tinted
// placeholder fallback when no image is uploaded on the plan.
function PlanImageThumb({ src }) {
  const url = src ? resolveAssetUrl(src) : null;
  if (url) {
    return <Image source={{ uri: url }} style={styles.planThumbImg} resizeMode="cover" />;
  }
  return (
    <View style={styles.planThumbPlaceholder}>
      <Sparkles size={26} color={colors.primary} strokeWidth={2.2} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f8' },
  content: { padding: 20 },

  topRightRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  signOutText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textLight,
  },

  header: { marginBottom: 24, alignItems: 'center' },
  headerTitle: {
    fontSize: 26, fontWeight: '700',
    color: colors.dark, marginBottom: 8, textAlign: 'center'
  },
  headerSubtitle: {
    fontSize: 14, color: colors.textLight,
    textAlign: 'center', lineHeight: 20
  },

  // Referral code card (collapsible)
  referralCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lightGray,
    marginBottom: 16,
    overflow: 'hidden',
  },
  referralHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  referralHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.dark,
  },
  referralBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lightGray,
    paddingTop: 12,
  },
  referralHint: {
    fontSize: 11,
    color: colors.textLight,
    lineHeight: 16,
  },
  referralInput: {
    borderWidth: 1,
    borderColor: colors.lightGray,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.dark,
    backgroundColor: '#fafafa',
    letterSpacing: 1.2,
    fontWeight: '700',
  },

  planCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  planCardPopular: {
    borderColor: colors.primary,
    borderWidth: 2,
  },

  popularBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  popularBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Stack the plan name on top of the price row. With the discount layout
  // (struck-through + discounted + cycle + %OFF pill) the price block can
  // be wider than the card column, so we let it have the full width below
  // the name instead of competing for horizontal space with it.
  planHeader: {
    marginBottom: 12,
  },
  planName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.dark,
    marginBottom: 6,
  },
  planThumbImg: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: '#FFE4E6',
  },
  planThumbPlaceholder: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: '#FFE4E6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F1D4D7',
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 4,
  },
  planPrice: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.primary,
  },
  planPriceStruck: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textLight,
    textDecorationLine: 'line-through',
    marginBottom: 2,
  },
  planPriceDiscounted: {
    fontSize: 26,
    fontWeight: '700',
    color: '#10B981', // emerald — signals savings
    marginLeft: 4,
  },
  planCycle: {
    fontSize: 13,
    color: colors.textLight,
    marginBottom: 4,
  },
  discountPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
    marginLeft: 4,
    marginBottom: 4,
  },
  discountPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.5,
  },

  // ── Billing cycle selector ──────────────────────────────────────
  planTagline: {
    fontSize: 12,
    color: colors.textLight,
    marginTop: 4,
    fontWeight: '600',
  },
  cycleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  cyclePill: {
    // Two per row on typical phone widths; wraps to 1-per-row on
    // narrow devices. `flexBasis: '48%'` gives us a stable 2-col grid.
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 140,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cyclePillActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF1F2',
  },
  cyclePillHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 4,
  },
  cycleLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    letterSpacing: 0.3,
  },
  cycleLabelActive: { color: colors.primary },
  cyclePrice: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  cyclePriceActive: { color: colors.primary },
  cyclePer: {
    fontSize: 10,
    color: colors.textLight,
    marginTop: 1,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  cyclePerActive: { color: colors.primary, opacity: 0.85 },
  cycleBreakdown: {
    fontSize: 9,
    color: colors.textLight,
    marginTop: 4,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cycleBreakdownActive: { color: colors.primary, opacity: 0.85 },
  cycleIncludesGst: {
    fontSize: 8,
    color: '#166534',
    marginTop: 2,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cycleIncludesGstActive: { color: colors.primary },
  saveChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#DCFCE7',
  },
  saveChipActive: {
    backgroundColor: '#FEF3C7',
  },
  saveChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0.4,
  },
  saveChipTextActive: {
    color: '#92400E',
  },

  // ── Total payable card ──────────────────────────────────────────
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textLight,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  totalBreakdown: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
    marginTop: 2,
    lineHeight: 15,
  },
  totalIncludesGst: {
    fontSize: 10,
    fontWeight: '800',
    color: '#166534',
    marginTop: 3,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.4,
  },

  // Trial / grace pills below the price.
  trialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  trialPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  trialPillBlue: {
    backgroundColor: '#DBEAFE',
  },
  trialPillAmber: {
    backgroundColor: '#FEF3C7',
  },
  trialPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
  },
  trialPillTextAmber: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },

  divider: {
    height: 1,
    backgroundColor: colors.lightGray,
    marginBottom: 14,
  },

  featureList: { gap: 8, marginBottom: 20 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  selectButton: {
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  selectButtonPopular: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  selectButtonTextPopular: {
    color: colors.white,
  },

  footer: {
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
});