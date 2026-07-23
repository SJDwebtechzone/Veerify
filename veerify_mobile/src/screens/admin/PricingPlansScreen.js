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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, AppState, Modal, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Crown, Calendar, RefreshCw, ChevronRight,
  CheckCircle2, Clock, AlertTriangle, Lock, Users, GraduationCap,
  Sparkles, TrendingUp, TrendingDown, ArrowRight, History,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';
import resolveAssetUrl from '../../utils/assetUrl';
import DownloadInvoiceButton from '../../components/DownloadInvoiceButton';

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

// Human labels for each per-term billing key.
const TERM_LABEL = {
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  half_yearly: 'Half-Yearly',
  annual:      'Annual',
};

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
  const [history, setHistory]       = useState([]);   // subscription_transactions ledger

  const load = useCallback(async () => {
    try {
      const [sRes, pRes, hRes] = await Promise.all([
        apiClient.get('/onboarding/subscription-status').catch(() => ({ data: null })),
        apiClient.get('/plans').catch(() => ({ data: { plans: [] } })),
        apiClient.get('/onboarding/payment-history').catch(() => ({ data: { transactions: [] } })),
      ]);
      setStatus(sRes.data || null);
      setPlans(pRes.data?.plans || []);
      setHistory(hRes.data?.transactions || []);
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

  // Track the still-pending link_id so we can mark it cancelled if the
  // admin backs out of Razorpay without paying. AppState listener below
  // triggers the check when the tab comes back to foreground.
  const [pendingLinkId, setPendingLinkId] = useState(null);

  // When the admin returns from Razorpay we quietly refresh the status
  // so a fresh subscription_end / plan_id lands here without a manual
  // pull-to-refresh. Also nudges any still-pending link into 'cancelled'
  // if the webhook hasn't stamped it 'paid'.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        load();
        // Give the webhook a moment; then check whether the link is
        // still pending on the server side.
        if (pendingLinkId) {
          setTimeout(async () => {
            try {
              await apiClient.post('/onboarding/mark-payment-cancelled', {
                link_id: pendingLinkId,
              });
            } catch { /* ignore — refresh already ran */ }
            setPendingLinkId(null);
          }, 2500);
        }
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLinkId]);

  // Billing-term picker modal state. When set, the modal renders with
  // the plan's enabled pricing_terms and the admin picks one before
  // Razorpay opens.
  const [pickingTerm, setPickingTerm] = useState(null);
  // pickingTerm shape: { plan, actionLabel }

  // The single entry point for Renew / Upgrade / Downgrade / Switch.
  // When the target plan offers more than one billing term, we first
  // pop the picker; otherwise we go straight to the confirm dialog.
  const startPayment = async (targetPlan, actionLabel) => {
    const plan = targetPlan || status?.plan || {};
    const enabledTerms = (plan.pricing_terms || [])
      .filter((t) => t.is_enabled && Number(t.price) > 0);
    if (enabledTerms.length > 1) {
      setPickingTerm({ plan, actionLabel });
      return;
    }
    // Single-term or legacy pricing → straight to confirm.
    return startPaymentWithTerm(plan, actionLabel, enabledTerms[0]?.billing_term || null);
  };

  const startPaymentWithTerm = async (targetPlan, actionLabel, billingTerm) => {
    const isSamePlan = !targetPlan || targetPlan.id === currentPlanId;
    const displayPlan = targetPlan || status?.plan || {};
    const displayName = displayPlan.name || 'your plan';

    // Preview amount: prefer the price for the chosen term, fall back to
    // the plan's legacy singleton price. Server re-computes with
    // discounts + referral wallet, so this is just a friendly heads-up.
    let rawPrice = Number(displayPlan.effective_price ?? displayPlan.price ?? 0);
    if (billingTerm && Array.isArray(displayPlan.pricing_terms)) {
      const t = displayPlan.pricing_terms.find((x) => x.billing_term === billingTerm && x.is_enabled);
      if (t && Number(t.price) > 0) rawPrice = Number(t.price);
    }
    const previewAmount = rawPrice > 0 ? fmtINR(rawPrice) : null;
    const termLabel = billingTerm ? TERM_LABEL[billingTerm] || billingTerm : null;

    confirm({
      title:       `${actionLabel}: ${displayName}${termLabel ? ` · ${termLabel}` : ''}`,
      message:     previewAmount
        ? `You'll be redirected to Razorpay to pay ${previewAmount} for the ${displayName} plan${termLabel ? ` (${termLabel} billing)` : ''}. Your current subscription stays unchanged until the payment is confirmed.`
        : `You'll be redirected to Razorpay for the ${displayName} plan. Your current subscription stays unchanged until the payment is confirmed.`,
      variant:     'info',
      confirmText: 'Continue to payment',
      cancelText:  'Cancel',
      onConfirm: async () => {
        try {
          const body = {};
          if (!isSamePlan) body.plan_id = targetPlan.id;
          if (billingTerm) body.billing_term = billingTerm;
          const res = await apiClient.post('/onboarding/renew', body);
          const url = res.data?.payment_link_url;
          const linkId = res.data?.link_id
            || (url && url.split('/').pop()) // best-effort id from short URL
            || null;
          if (linkId) setPendingLinkId(linkId);
          if (!url) throw new Error('Payment link not received');
          try {
            await Linking.openURL(url);
          } catch {
            confirm({
              title:       'Could not open payment page',
              message:     'Please try again in a moment.',
              variant:     'destructive',
              confirmText: 'OK', hideCancel: true,
            });
          }
        } catch (err) {
          const msg = err?.response?.data?.message || err.message || 'Payment could not be started.';
          confirm({
            title:       'Payment failed to start',
            message:     `${msg}\n\nYour subscription is unchanged.`,
            variant:     'destructive',
            confirmText: 'OK', hideCancel: true,
          });
        }
      },
    });
  };

  // Public entry: label the button according to whether the target plan
  // is more expensive (Upgrade) / cheaper (Downgrade) / same price
  // (Switch) / the current plan (Renew now).
  const goToPlan = (planId) => {
    const target = plans.find((p) => p.id === planId) || null;
    let label = 'Renew now';
    if (target && target.id !== currentPlanId) {
      const tPrice = Number(target.effective_price ?? target.price ?? 0);
      if (tPrice > currentPrice) label = 'Upgrade';
      else if (tPrice < currentPrice) label = 'Downgrade';
      else label = 'Switch';
    }
    startPayment(target, label);
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

        {/* ───── Payment history ─────
            Every renew / upgrade / downgrade / onboarding transaction,
            newest first. Status pills: Paid (green), Pending (amber),
            Failed / Cancelled (red / slate). Kept compact — the full
            audit trail sits on the server if the admin needs to dig. */}
        {history.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Payment History</Text>
            <Text style={styles.sectionSub}>{history.length} record{history.length === 1 ? '' : 's'}</Text>
            {history.slice(0, 12).map((tx) => (
              <HistoryRow key={tx.id} tx={tx} />
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* Billing-term picker — shown when the tapped plan offers more
          than one enabled billing term. Picks the term → confirm dialog
          fires with the correct amount → Razorpay opens. */}
      <BillingTermPicker
        visible={!!pickingTerm}
        plan={pickingTerm?.plan}
        actionLabel={pickingTerm?.actionLabel || 'Renew'}
        onClose={() => setPickingTerm(null)}
        onPick={(term) => {
          const ctx = pickingTerm;
          setPickingTerm(null);
          if (ctx) startPaymentWithTerm(ctx.plan, ctx.actionLabel, term);
        }}
      />
    </View>
  );
}

// ─── Billing-term picker modal ─────────────────────────────────────────
function BillingTermPicker({ visible, plan, actionLabel, onClose, onPick }) {
  if (!plan) return null;
  const terms = (plan.pricing_terms || [])
    .filter((t) => t.is_enabled && Number(t.price) > 0);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.pickerBackdrop}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickerTitle}>
                {actionLabel}: {plan.name}
              </Text>
              <Text style={styles.pickerSub}>
                Pick a billing term to continue to payment.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.pickerClose} hitSlop={8}>
              <Text style={styles.pickerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {terms.length === 0 ? (
            <Text style={styles.pickerEmpty}>
              This plan has no billing terms configured yet.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {terms.map((t) => (
                <TouchableOpacity
                  key={t.billing_term}
                  style={styles.termRow}
                  onPress={() => onPick(t.billing_term)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.termLabel}>
                      {TERM_LABEL[t.billing_term] || t.billing_term}
                    </Text>
                    <Text style={styles.termHint}>
                      {t.billing_term === 'monthly'     ? 'Billed every month'
                       : t.billing_term === 'quarterly' ? 'Billed every 3 months'
                       : t.billing_term === 'half_yearly' ? 'Billed every 6 months'
                       : 'Billed once per year'}
                    </Text>
                  </View>
                  <Text style={styles.termPrice}>{fmtINR(Number(t.price))}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Current plan hero ──────────────────────────────────────────────────
function CurrentPlanCard({ status, onAction }) {
  const phase = status?.phase || 'pending';
  const plan  = status?.plan || {};
  const planName = plan.name || 'Free';
  const price = Number(plan.effective_price ?? plan.price ?? 0);
  const cycle = plan.billing_cycle || 'monthly';

  // ── Days-until-renewal window ────────────────────────────────────
  // For a PAID subscription, we only want to show a payment CTA when
  // renewal is close (7-day window per spec). Outside that window
  // the card should say "Paid" and nothing more.
  const RENEWAL_WINDOW_DAYS = 7;
  const daysToRenewal = (() => {
    if (!status?.next_renewal_at) return null;
    const t = new Date(status.next_renewal_at).getTime();
    if (!Number.isFinite(t)) return null;
    const diffMs = t - Date.now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  })();
  const isRenewalDue =
    daysToRenewal != null && daysToRenewal <= RENEWAL_WINDOW_DAYS;

  // Phase-aware styling and CTA copy.
  //   paid + renewal not due → Green "Paid" badge, NO button.
  //   paid + within 7 days   → Green "Paid" badge + "Renew now" button.
  //   trial / grace          → Amber. Existing behaviour.
  //   locked / expired       → Red "Expired" + "Renew now" button.
  //   pending                → Slate, awaiting super-admin approval (no CTA).
  // Free Trial flags coming from /onboarding/subscription-status:
  //   trial_ending_soon: true when we're within the last 3 days AND
  //     the reminder email has been sent — the moment the Pay Now
  //     button becomes available per the Free Trial spec.
  //   payment_ready: master flag the screen uses to gate the button.
  const trialEndingSoon = !!status?.trial_ending_soon;
  const paymentReady    = !!status?.payment_ready;

  const phaseInfo = {
    paid: {
      label:      'Paid',
      color:      GREEN,
      icon:       CheckCircle2,
      action:     'Renew now',
      // Only show the Renew CTA in the last 7 days before renewal.
      // Any earlier and the card is purely informational.
      showAction: isRenewalDue,
    },
    // Trial: label + CTA both switch when the reminder has fired.
    //   • Active trial (payment_ready = false): shows "Free Trial"
    //     with NO Pay Now button.
    //   • Ending soon  (payment_ready = true):  shows "Trial Ending
    //     Soon" with the Pay Now CTA enabled.
    trial: {
      label:      trialEndingSoon ? 'Trial Ending Soon' : 'Free Trial',
      color:      trialEndingSoon ? BRAND : GREEN,
      icon:       trialEndingSoon ? AlertTriangle : Clock,
      action:     'Pay now',
      showAction: paymentReady,
    },
    grace:   { label: 'Pending',      color: AMBER, icon: AlertTriangle, action: 'Pay now',   showAction: true  },
    locked:  { label: 'Pending',      color: BRAND, icon: Lock,         action: 'Pay now',   showAction: true  },
    expired: { label: 'Expired',      color: BRAND, icon: AlertTriangle, action: 'Renew now', showAction: true  },
    pending: { label: 'Awaiting approval', color: SLATE, icon: Clock,   action: '',          showAction: false },
  }[phase] || { label: phase, color: SLATE, icon: Clock, action: '', showAction: false };

  const PhaseIcon = phaseInfo.icon;

  // Days left badge — surfaces urgency for trial, grace, and the
  // 7-day pre-renewal window on paid subscriptions.
  let daysBadge = null;
  if (phase === 'trial' && status?.days_left_in_trial != null) {
    daysBadge = `${status.days_left_in_trial} day${status.days_left_in_trial === 1 ? '' : 's'} left in trial`;
  } else if (phase === 'grace' && status?.days_left_in_grace != null) {
    daysBadge = `${status.days_left_in_grace} day${status.days_left_in_grace === 1 ? '' : 's'} left in grace`;
  } else if (phase === 'paid' && isRenewalDue && daysToRenewal >= 0) {
    daysBadge = daysToRenewal === 0
      ? 'Renews today'
      : `Renews in ${daysToRenewal} day${daysToRenewal === 1 ? '' : 's'}`;
  }

  return (
    <View style={styles.currentCard}>
      {/* Top accent strip */}
      <View style={[styles.currentAccent, { backgroundColor: BRAND }]} />

      {/* Plan name + price block. The plan image sits on the right side
          of the whole title area so it visually anchors both the name
          and the price at the same height. */}
      <View style={styles.currentHeroRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.currentTopRow}>
            <View style={styles.crownWrap}>
              <Crown size={20} color="#fff" strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.currentEyebrow}>YOUR CURRENT PLAN</Text>
              <Text style={styles.currentName} numberOfLines={1}>{planName}</Text>
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
        </View>

        {plan.image_url ? (
          <Image
            source={{ uri: resolveAssetUrl(plan.image_url) }}
            style={styles.currentHeroThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.currentHeroThumbPlaceholder}>
            <Sparkles size={26} color={BRAND} strokeWidth={2.2} />
          </View>
        )}
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

      {/* Download Invoice — only meaningful for phases that have an
          actual paid subscription. The backend returns 404 for others
          and the button surfaces a friendly "will be available…" hint. */}
      {phase === 'paid' && status?.institution_id ? (
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <DownloadInvoiceButton
            kind="subscription"
            refId={status.institution_id}
            label="Download last invoice"
            compact
          />
        </View>
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
        <Text style={styles.planRowName} numberOfLines={1}>{plan.name}</Text>
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

      {/* Plan image — sits on the right of the name+meta block, sized to
          visually align with both the plan name and the price line. */}
      {plan.image_url ? (
        <Image
          source={{ uri: resolveAssetUrl(plan.image_url) }}
          style={styles.planRowThumb}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.planRowThumbPlaceholder}>
          <Sparkles size={18} color={BRAND} strokeWidth={2.4} />
        </View>
      )}

      <View style={[styles.actionPill, { backgroundColor: actionColor + '14', borderColor: actionColor + '40' }]}>
        <ActionIcon size={13} color={actionColor} strokeWidth={2.6} />
        <Text style={[styles.actionPillText, { color: actionColor }]}>{actionLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Payment history row ──────────────────────────────────────────────
function HistoryRow({ tx }) {
  const rupees = Math.round((tx.amount_paise || 0) / 100);
  const actionLabel = tx.action === 'onboarding'  ? 'Initial payment'
                    : tx.action === 'change_plan' ? 'Plan change'
                    : 'Renewal';
  const statusInfo = tx.status === 'paid'
    ? { label: 'Paid',      color: GREEN, bg: GREEN + '22', icon: CheckCircle2 }
    : tx.status === 'pending'
      ? { label: 'Pending',  color: AMBER, bg: AMBER + '22', icon: Clock }
      : tx.status === 'cancelled'
        ? { label: 'Cancelled', color: SLATE, bg: SLATE + '22', icon: AlertTriangle }
        : { label: 'Failed',   color: BRAND, bg: '#FEE2E2',   icon: AlertTriangle };
  const StatusIcon = statusInfo.icon;

  const when = tx.paid_at || tx.created_at;
  return (
    <View style={styles.historyRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.historyTopRow}>
          <Text style={styles.historyPlan} numberOfLines={1}>
            {tx.plan_name || 'Plan'}
          </Text>
          <View style={[styles.historyPill, { backgroundColor: statusInfo.bg }]}>
            <StatusIcon size={10} color={statusInfo.color} strokeWidth={2.4} />
            <Text style={[styles.historyPillText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>
        <Text style={styles.historyMeta} numberOfLines={1}>
          {actionLabel} · {fmtDate(when)}
        </Text>
      </View>
      <Text style={styles.historyAmount}>{fmtINR(rupees)}</Text>
    </View>
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
  currentHeroRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  currentHeroThumb: {
    width: 76, height: 76, borderRadius: 14,
    backgroundColor: '#FFE4E6',
  },
  currentHeroThumbPlaceholder: {
    width: 76, height: 76, borderRadius: 14,
    backgroundColor: '#FFE4E6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F1D4D7',
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
  planRowThumb: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: '#FFE4E6',
    marginHorizontal: 10,
  },
  planRowThumbPlaceholder: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: '#FFE4E6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F1D4D7',
    marginHorizontal: 10,
  },
  planRowName: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 4 },
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

  // ── Payment history row ────────────────────────────────────────
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    padding: 12, marginBottom: 8,
  },
  historyTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2,
  },
  historyPlan:  { fontSize: 13, fontWeight: '800', color: TEXT, flex: 1 },
  historyPill:  {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },
  historyPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  historyMeta:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },
  historyAmount: { fontSize: 14, fontWeight: '900', color: TEXT },

  // ── Billing-term picker modal ─────────────────────────────────
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28,
  },
  pickerHead: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: 14,
  },
  pickerTitle: { fontSize: 16, fontWeight: '900', color: TEXT, letterSpacing: -0.2 },
  pickerSub:   { fontSize: 12, color: TEXT_MUTED, marginTop: 3, fontWeight: '600' },
  pickerClose: { paddingHorizontal: 10, paddingVertical: 6 },
  pickerCloseText: { fontSize: 13, fontWeight: '800', color: TEXT_MUTED },
  pickerEmpty: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginVertical: 20 },

  termRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  termLabel: { fontSize: 14, fontWeight: '800', color: TEXT },
  termHint:  { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  termPrice: { fontSize: 16, fontWeight: '900', color: BRAND, letterSpacing: -0.2 },
});
