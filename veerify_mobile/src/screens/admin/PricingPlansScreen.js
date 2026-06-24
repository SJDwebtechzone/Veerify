// src/screens/admin/PricingPlansScreen.js
//
// Institution admin "Pricing & Plans" screen — reached from the More tab.
//
// Top of the screen: a hero card showing the academy's CURRENT plan
// (name, price, billing cycle, when the subscription started, next
// renewal date, current phase pill). The hero has a primary action
// matching the phase:
//
//   - paid    → "Renew now"   (kicks the user to PlanSelection so they
//                              can re-confirm + pay for the next cycle)
//   - trial   → "Pay now"     (start paying before the trial ends)
//   - grace   → "Pay now"     (grace period — last chance before lock)
//   - locked  → "Pay now"     (hard-locked, must pay to unlock)
//   - pending → no action     (waiting on super admin approval)
//
// Below the hero: a list of every other ACTIVE plan with:
//   - Plan name + price + billing cycle + caps (students / trainers)
//   - Action button: "Upgrade" if the plan is more expensive than the
//     current one, "Downgrade" if cheaper, "Switch" if same price.
//
// Tapping any action navigates to PlanSelection with the target plan
// pre-selected, so the existing payment flow handles the rest.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Crown, Calendar, RefreshCw, ChevronRight,
  CheckCircle2, Clock, AlertTriangle, Lock, Users, GraduationCap,
  Sparkles, TrendingUp, TrendingDown, ArrowRight,
} from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';
const AMBER       = '#F59E0B';
const SLATE       = '#475569';

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Plan caps come back as 999999 when "unlimited" — display nicely.
function fmtCap(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v >= 999) return 'Unlimited';
  return String(v);
}

export default function PricingPlansScreen({ navigation }) {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus]         = useState(null); // /onboarding/subscription-status payload
  const [plans, setPlans]           = useState([]);   // active plans from /plans

  const load = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        apiClient.get('/onboarding/subscription-status').catch(() => ({ data: null })),
        apiClient.get('/plans').catch(() => ({ data: { plans: [] } })),
      ]);
      setStatus(sRes.data || null);
      setPlans(pRes.data?.plans || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const currentPlanId = status?.plan?.id || null;
  const currentPrice  = Number(status?.plan?.effective_price ?? status?.plan?.price ?? 0);

  // Other plans = active plans minus the current one.
  const otherPlans = useMemo(
    () => plans.filter((p) => p.id !== currentPlanId),
    [plans, currentPlanId],
  );

  const goToPlan = (planId) => {
    // PlanSelection reads `?planId=` style params to pre-select.
    navigation.navigate('PlanSelection', { selectedPlanId: planId });
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Pricing & Plans</Text>
          <Text style={styles.headerSub}>Manage your academy's subscription</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
      >
        {/* ───── Current plan hero ───── */}
        <CurrentPlanCard status={status} onAction={() => goToPlan(currentPlanId)} />

        {/* ───── Available plans ───── */}
        {otherPlans.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Available Plans</Text>
            <Text style={styles.sectionSub}>
              Switch any time. Your current plan's renewal date carries over.
            </Text>
            {otherPlans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                currentPrice={currentPrice}
                onPress={() => goToPlan(p.id)}
              />
            ))}
          </>
        ) : null}

        {/* ───── No plan / pending state ───── */}
        {!status?.plan?.id ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={28} color={AMBER} strokeWidth={2} />
            <Text style={styles.emptyTitle}>No active plan</Text>
            <Text style={styles.emptyText}>
              Your institution is waiting for super-admin approval. Once
              approved you'll be able to pick a plan and start serving
              students.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Current plan hero ──────────────────────────────────────────────────
function CurrentPlanCard({ status, onAction }) {
  const phase = status?.phase || 'pending';
  const plan  = status?.plan || {};
  const planName = plan.name || 'Free';
  const price = Number(plan.effective_price ?? plan.price ?? 0);
  const cycle = plan.billing_cycle || 'monthly';

  // Phase-aware styling and CTA copy.
  const phaseInfo = {
    paid:    { label: 'Active',    color: GREEN, icon: CheckCircle2, action: 'Renew now',    showAction: true  },
    trial:   { label: 'Free trial', color: AMBER, icon: Clock,        action: 'Pay now',      showAction: true  },
    grace:   { label: 'Grace period', color: AMBER, icon: AlertTriangle, action: 'Pay now',   showAction: true  },
    locked:  { label: 'Locked',    color: BRAND, icon: Lock,         action: 'Pay now',      showAction: true  },
    pending: { label: 'Awaiting approval', color: SLATE, icon: Clock, action: '',            showAction: false },
  }[phase] || { label: phase, color: SLATE, icon: Clock, action: '', showAction: false };

  const PhaseIcon = phaseInfo.icon;

  // Days left badge — surfaces the urgency for trial / grace.
  let daysBadge = null;
  if (phase === 'trial' && status?.days_left_in_trial != null) {
    daysBadge = `${status.days_left_in_trial} day${status.days_left_in_trial === 1 ? '' : 's'} left in trial`;
  } else if (phase === 'grace' && status?.days_left_in_grace != null) {
    daysBadge = `${status.days_left_in_grace} day${status.days_left_in_grace === 1 ? '' : 's'} left in grace`;
  }

  return (
    <View style={styles.currentCard}>
      {/* Top accent strip */}
      <View style={[styles.currentAccent, { backgroundColor: BRAND }]} />

      {/* Plan name row */}
      <View style={styles.currentTopRow}>
        <View style={styles.crownWrap}>
          <Crown size={20} color="#fff" strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.currentEyebrow}>YOUR CURRENT PLAN</Text>
          <Text style={styles.currentName}>{planName}</Text>
        </View>
        {/* Phase pill */}
        <View style={[styles.phasePill, { backgroundColor: phaseInfo.color + '22' }]}>
          <PhaseIcon size={12} color={phaseInfo.color} strokeWidth={2.4} />
          <Text style={[styles.phasePillText, { color: phaseInfo.color }]}>{phaseInfo.label}</Text>
        </View>
      </View>

      {/* Price */}
      <View style={styles.priceRow}>
        <Text style={styles.priceValue}>{fmtINR(price)}</Text>
        <Text style={styles.priceCycle}>/{cycle === 'yearly' ? 'year' : 'month'}</Text>
      </View>

      {/* Days-left badge */}
      {daysBadge ? (
        <View style={styles.daysBadge}>
          <Clock size={11} color={AMBER} strokeWidth={2.4} />
          <Text style={styles.daysBadgeText}>{daysBadge}</Text>
        </View>
      ) : null}

      {/* Dates */}
      <View style={styles.datesRow}>
        <View style={styles.dateBlock}>
          <View style={styles.dateIcon}>
            <Calendar size={12} color={BRAND} strokeWidth={2.4} />
          </View>
          <View>
            <Text style={styles.dateLabel}>STARTED</Text>
            <Text style={styles.dateValue}>{fmtDate(status?.subscription_started_at)}</Text>
          </View>
        </View>

        <View style={styles.dateDivider} />

        <View style={styles.dateBlock}>
          <View style={styles.dateIcon}>
            <RefreshCw size={12} color={BRAND} strokeWidth={2.4} />
          </View>
          <View>
            <Text style={styles.dateLabel}>NEXT RENEWAL</Text>
            <Text style={styles.dateValue}>{fmtDate(status?.next_renewal_at)}</Text>
          </View>
        </View>
      </View>

      {/* Caps */}
      <View style={styles.capsRow}>
        <View style={styles.capChip}>
          <GraduationCap size={11} color={TEXT_MUTED} strokeWidth={2.4} />
          <Text style={styles.capChipText}>{fmtCap(plan.max_students)} students</Text>
        </View>
        <View style={styles.capChip}>
          <Users size={11} color={TEXT_MUTED} strokeWidth={2.4} />
          <Text style={styles.capChipText}>{fmtCap(plan.max_trainers)} trainers</Text>
        </View>
      </View>

      {/* Primary CTA */}
      {phaseInfo.showAction ? (
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onAction}
          activeOpacity={0.88}
        >
          <RefreshCw size={16} color="#fff" strokeWidth={2.4} />
          <Text style={styles.primaryCtaText}>{phaseInfo.action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Available plan row ────────────────────────────────────────────────
function PlanRow({ plan, currentPrice, onPress }) {
  const price = Number(plan.price) || 0;
  const isUpgrade   = price > currentPrice;
  const isDowngrade = price < currentPrice && currentPrice > 0;
  const sameTier    = price === currentPrice;

  // Choose the action label + icon based on the price comparison.
  let actionLabel = 'Switch';
  let ActionIcon  = ArrowRight;
  let actionColor = SLATE;
  if (isUpgrade) {
    actionLabel = 'Upgrade';
    ActionIcon  = TrendingUp;
    actionColor = BRAND;
  } else if (isDowngrade) {
    actionLabel = 'Downgrade';
    ActionIcon  = TrendingDown;
    actionColor = SLATE;
  } else if (sameTier) {
    actionLabel = 'Switch';
    ActionIcon  = ArrowRight;
    actionColor = SLATE;
  }

  return (
    <TouchableOpacity style={styles.planRow} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.planLeft}>
        <Text style={styles.planRowName}>{plan.name}</Text>
        <View style={styles.planRowMeta}>
          <Text style={styles.planRowPrice}>
            {fmtINR(price)}
            <Text style={styles.planRowCycle}>
              /{plan.billing_cycle === 'yearly' ? 'yr' : 'mo'}
            </Text>
          </Text>
          <Text style={styles.planRowCaps}>
            {fmtCap(plan.max_students)} students · {fmtCap(plan.max_trainers)} trainers
          </Text>
        </View>
        {plan.is_popular ? (
          <View style={styles.popularBadge}>
            <Sparkles size={9} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.popularBadgeText}>POPULAR</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.actionPill, { backgroundColor: actionColor + '14', borderColor: actionColor + '40' }]}>
        <ActionIcon size={13} color={actionColor} strokeWidth={2.6} />
        <Text style={[styles.actionPillText, { color: actionColor }]}>{actionLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  // Current plan card
  currentCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
    shadowColor: BRAND,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  currentAccent: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 4,
  },
  currentTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 12,
  },
  crownWrap: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  currentEyebrow: {
    fontSize: 10, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 1.5,
  },
  currentName: {
    fontSize: 22, fontWeight: '900', color: TEXT,
    letterSpacing: -0.3, marginTop: 2,
  },

  phasePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  phasePillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // Price
  priceRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    marginBottom: 8,
  },
  priceValue: { fontSize: 32, fontWeight: '900', color: BRAND, letterSpacing: -0.5 },
  priceCycle: { fontSize: 13, color: TEXT_MUTED, fontWeight: '700', marginLeft: 4, marginBottom: 5 },

  daysBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: AMBER + '15',
    marginBottom: 14,
  },
  daysBadgeText: { fontSize: 11, color: AMBER, fontWeight: '800' },

  // Dates
  datesRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG,
    padding: 12, borderRadius: 12,
    marginBottom: 12,
    marginTop: 4,
  },
  dateBlock: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  dateDivider: { width: 1, height: 32, backgroundColor: BORDER, marginHorizontal: 4 },
  dateIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  dateLabel: { fontSize: 9, color: TEXT_MUTED, fontWeight: '800', letterSpacing: 0.8 },
  dateValue: { fontSize: 13, color: TEXT, fontWeight: '700', marginTop: 1 },

  // Caps row
  capsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  capChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: BG, borderRadius: 999,
    borderWidth: 1, borderColor: BORDER,
  },
  capChipText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700' },

  // Primary CTA
  primaryCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    paddingVertical: 14, borderRadius: 12,
    shadowColor: BRAND, shadowOpacity: 0.3,
    shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryCtaText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },

  // Available plans section
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: TEXT,
    marginTop: 28, marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12, color: TEXT_MUTED, fontWeight: '600',
    marginBottom: 16, lineHeight: 17,
  },

  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  planLeft: { flex: 1 },
  planRowName: { fontSize: 15, fontWeight: '800', color: TEXT },
  planRowMeta: { marginTop: 4 },
  planRowPrice: { fontSize: 14, color: TEXT, fontWeight: '800' },
  planRowCycle: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700' },
  planRowCaps: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  popularBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: BRAND_SOFT,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    marginTop: 6,
  },
  popularBadgeText: { fontSize: 9, color: BRAND, fontWeight: '900', letterSpacing: 0.5 },

  actionPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5,
  },
  actionPillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },

  // Empty / pending state
  emptyCard: {
    marginTop: 24,
    padding: 24, borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginTop: 10 },
  emptyText: {
    fontSize: 12, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 6, lineHeight: 18,
  },
});
