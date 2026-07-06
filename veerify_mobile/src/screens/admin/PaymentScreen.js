import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, RefreshControl, Linking, AppState,
} from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../utils/styles';
import { confirm } from '../../components/ConfirmDialog';
import PaymentSuccessOverlay from '../../components/PaymentSuccessOverlay';

// Post-approval payment screen.
//
// The academy has been approved. The owner picks a billing term
// (Monthly / Quarterly / Half-Yearly / Annual) — enabled terms are
// pulled from the plan's plan_pricing rows. Tapping a term:
//   1. POSTs /onboarding/renew with billing_term
//   2. Backend mints a Razorpay Payment Link at that term's price
//   3. We open the returned URL via Linking.openURL
//   4. When the webhook flips the institution to 'active', a foreground
//      refresh routes the owner straight into the dashboard.
//
// "I've paid — refresh status" is kept as a fallback the owner can tap
// after returning from Razorpay.

const TERM_LABEL = {
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  half_yearly: 'Half-Yearly',
  annual:      'Annual',
};
const TERM_HINT = {
  monthly:     'Billed every month',
  quarterly:   'Billed every 3 months',
  half_yearly: 'Billed every 6 months',
  annual:      'Billed once per year',
};

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

export default function PaymentScreen({ navigation }) {
  const { user, logout, refreshOnboardingStatus } = useAuth();

  const [institution, setInstitution] = useState(null);
  const [plan, setPlan]               = useState(null);        // full plan row from /plans/:id
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [checking, setChecking]       = useState(false);
  const [payingTerm, setPayingTerm]   = useState(null);        // key of the term being processed
  const [successOpen, setSuccessOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/onboarding/my-status');
      const inst = res.data.institution;
      setInstitution(inst);

      // Pull the plan with its per-term pricing so we can render the
      // billing-term picker below.
      if (inst?.plan_id) {
        try {
          const planRes = await apiClient.get(`/plans/${inst.plan_id}`);
          setPlan(planRes.data?.plan || null);
        } catch {
          // If /plans/:id fails, fall back to the legacy singleton
          // fields from my-status so at least the summary renders.
          setPlan({
            id:            inst.plan_id,
            name:          inst.plan_name,
            price:         inst.plan_price,
            billing_cycle: inst.plan_billing_cycle,
            pricing_terms: [],
          });
        }
      } else {
        setPlan(null);
      }

      // If we land here but backend already says active, just push to dashboard.
      if (res.data.status === 'active') {
        navigation.replace('AdminDashboard');
      }
    } catch (err) {
      console.log('PaymentScreen load:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when the tab comes back from Razorpay.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  // Compute enabled terms (with a legacy fallback for plans predating
  // the plan_pricing table).
  const enabledTerms = (() => {
    const arr = Array.isArray(plan?.pricing_terms) ? plan.pricing_terms : [];
    const enabled = arr
      .filter((t) => t.is_enabled && Number(t.price) > 0);
    if (enabled.length > 0) return enabled;
    // Legacy: derive one row from the plan's singleton price/billing_cycle.
    if (plan?.price) {
      const legacyTerm = plan.billing_cycle === 'yearly' ? 'annual' : (plan.billing_cycle || 'monthly');
      return [{ billing_term: legacyTerm, price: Number(plan.price), is_enabled: true }];
    }
    return [];
  })();

  const startPayment = async (term) => {
    if (payingTerm) return;
    setPayingTerm(term.billing_term);
    try {
      const res = await apiClient.post('/onboarding/renew', {
        billing_term: term.billing_term,
      });
      const url = res.data?.payment_link_url;
      if (!url) throw new Error('Payment link not received');
      try {
        await Linking.openURL(url);
      } catch {
        confirm({
          title: 'Could not open payment page',
          message: 'Please try again in a moment.',
          variant: 'destructive', hideCancel: true, confirmText: 'OK',
        });
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Payment could not be started.';
      confirm({
        title:   'Payment failed to start',
        message: `${msg}\n\nYour subscription is unchanged.`,
        variant: 'destructive', hideCancel: true, confirmText: 'OK',
      });
    } finally {
      setPayingTerm(null);
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      const status = await refreshOnboardingStatus();
      if (status === 'active') {
        setSuccessOpen(true);
      } else {
        confirm({
          title: 'Still waiting',
          message: "We haven't received confirmation yet. Razorpay can take up to a minute after you complete payment. Try again shortly, or check your email for the payment link.",
          variant: 'warning', hideCancel: true, confirmText: 'OK',
        });
      }
    } catch (err) {
      confirm({
        title:   'Could not refresh',
        message: err?.message || 'Network error — please try again.',
        variant: 'destructive', hideCancel: true, confirmText: 'OK',
      });
    } finally {
      setChecking(false);
    }
  };

  const handlePullToRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSignOut = () => {
    confirm({
      title:   'Sign out?',
      message: 'You can come back and sign in any time once you complete payment.',
      variant: 'destructive',
      confirmText: 'Sign out', cancelText: 'Cancel',
      onConfirm: () => logout(),
    });
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const ownerEmail = institution?.owner_email || user?.email || 'your email';

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handlePullToRefresh} />}
      >
        {/* Approved banner */}
        <View style={styles.approvedBanner}>
          <Text style={styles.approvedEmoji}>🎉</Text>
          <Text style={styles.approvedTitle}>Academy Approved!</Text>
          <Text style={styles.approvedSubtitle}>
            Choose a billing term to complete your subscription.
          </Text>
        </View>

        {/* Plan + owner summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your plan</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Academy</Text>
            <Text style={styles.detailValue}>{institution?.name}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Plan</Text>
            <Text style={styles.detailValue}>{plan?.name || '—'}</Text>
          </View>
          {institution?.city ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>City</Text>
              <Text style={styles.detailValue}>{institution.city}</Text>
            </View>
          ) : null}
        </View>

        {/* Billing term picker */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pick a billing term</Text>
          <Text style={styles.cardBody}>
            Each option pays for one full cycle in one go. You can switch
            terms any time from Pricing & Plans.
          </Text>

          {enabledTerms.length === 0 ? (
            <Text style={[styles.cardBody, { marginTop: 10, color: colors.textLight, fontStyle: 'italic' }]}>
              No billing terms configured yet. Please contact support.
            </Text>
          ) : (
            <View style={{ marginTop: 10, gap: 10 }}>
              {enabledTerms.map((term) => {
                const busy = payingTerm === term.billing_term;
                return (
                  <TouchableOpacity
                    key={term.billing_term}
                    style={styles.termRow}
                    onPress={() => startPayment(term)}
                    disabled={!!payingTerm}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.termLabel}>
                        {TERM_LABEL[term.billing_term] || term.billing_term}
                      </Text>
                      <Text style={styles.termHint}>
                        {TERM_HINT[term.billing_term] || ''}
                      </Text>
                    </View>
                    {busy ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={styles.termPrice}>{fmtINR(term.price)}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Fallback email note */}
        <View style={[styles.card, styles.emailNote]}>
          <Text style={styles.emailNoteTitle}>📧 Prefer to pay from email?</Text>
          <Text style={styles.emailNoteBody}>
            We also sent a payment link to{' '}
            <Text style={styles.emailHighlight}>{ownerEmail}</Text> at the
            plan's default price. If you use that link the standard billing
            term applies.
          </Text>
        </View>

        {/* Re-check status */}
        <TouchableOpacity
          style={[styles.primaryButton, checking && { opacity: 0.6 }]}
          onPress={handleCheckStatus}
          disabled={checking}
          activeOpacity={0.85}
        >
          {checking ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <CheckCircle2 size={16} color={colors.white} strokeWidth={2.4} />
              <Text style={styles.primaryButtonText}>I've paid — refresh status</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.secureText}>
          🔒 Payment is handled entirely on Razorpay's secure page.
        </Text>

        <TouchableOpacity onPress={handleSignOut} style={styles.signOutLink}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <PaymentSuccessOverlay
        visible={successOpen}
        institutionName={institution?.name}
        onContinue={() => {
          setSuccessOpen(false);
          navigation.replace('AdminDashboard');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f8' },
  content: { padding: 20 },

  approvedBanner: {
    backgroundColor: '#e1f5ee',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0f6e56',
  },
  approvedEmoji: { fontSize: 40, marginBottom: 8 },
  approvedTitle: {
    fontSize: 20, fontWeight: '700',
    color: '#085041', marginBottom: 4,
  },
  approvedSubtitle: {
    fontSize: 13, color: '#0f6e56', textAlign: 'center',
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  cardTitle: {
    fontSize: 15, fontWeight: '800',
    color: colors.dark, marginBottom: 8,
  },
  cardBody: { fontSize: 13, color: colors.text, lineHeight: 19 },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: { fontSize: 13, color: colors.textLight },
  detailValue: { fontSize: 13, fontWeight: '700', color: colors.text },

  // ── Billing term row
  termRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.lightGray,
    backgroundColor: colors.white,
  },
  termLabel: { fontSize: 14, fontWeight: '800', color: colors.dark },
  termHint:  { fontSize: 11, color: colors.textLight, marginTop: 2, fontWeight: '600' },
  termPrice: { fontSize: 17, fontWeight: '900', color: colors.primary, letterSpacing: -0.2 },

  // ── Fallback email note
  emailNote: { backgroundColor: '#fefaf3', borderColor: '#f5d99a' },
  emailNoteTitle: { fontSize: 13, fontWeight: '800', color: '#8a6d3b' },
  emailNoteBody:  { fontSize: 12, color: '#8a6d3b', marginTop: 4, lineHeight: 17 },
  emailHighlight: { fontWeight: '800', color: colors.primary },

  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15, fontWeight: '700', color: colors.white,
  },

  secureText: {
    fontSize: 12, color: colors.textLight, textAlign: 'center',
    marginBottom: 18,
  },
  signOutLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signOutText: {
    fontSize: 13, fontWeight: '600',
    color: colors.textLight,
    textDecorationLine: 'underline',
  },
});
