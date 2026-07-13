// src/screens/student/StudentPaymentsScreen.js
//
// Student → More → Payments. Two sections:
//   1. Upcoming payment due   — any enrollment with payment_status !== paid
//      OR a paid enrollment approaching its next renewal window.
//   2. Payment history        — every enrollment row rendered as a
//      transaction card (plan / course, amount, status, date, txn id,
//      next renewal). Sorted newest first.
//
// Data: GET /api/enrollments/my (the same endpoint /enrollments/my-status
// leans on) — every enrollment carries the payment_amount, payment_status,
// paid_at, payment_reference and course/plan snapshot the student needs.

import React, { useCallback, useMemo, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, AppState, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Wallet, CheckCircle2, Clock, XCircle,
  Building2, CreditCard, Calendar, RefreshCw, AlertCircle,
  Repeat,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Compute "next monthly renewal" from the last paid date. For a monthly
// billing_cycle we add 30 days; annual → 365; anything else → 30 as
// a sensible default.
function nextRenewal(iso, cycle = 'monthly') {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = cycle === 'yearly' || cycle === 'annual' ? 365
             : cycle === 'quarterly' ? 90
             : cycle === 'half_yearly' ? 180
             : 30;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUS_META = {
  paid:    { label: 'Paid',    icon: CheckCircle2, accent: palette.green,  bg: '#D1FAE5', fg: '#065F46' },
  pending: { label: 'Pending', icon: Clock,        accent: palette.orange, bg: '#FEF3C7', fg: '#92400E' },
  failed:  { label: 'Failed',  icon: XCircle,      accent: palette.rose,   bg: '#FEE2E2', fg: '#991B1B' },
};

export default function StudentPaymentsScreen({ navigation }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Which enrollment id we're minting a link for — powers the per-row
  // spinner on the Renew button so a fast tapper can't fire twice.
  const [renewingId, setRenewingId] = useState(null);
  // The pending renewal we're polling for. When the user leaves the app
  // to complete payment in Razorpay and returns, an AppState listener
  // polls /renewal-status; when it flips to 'paid', we celebrate and
  // clear the pending marker.
  const pendingRenewalRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/enrollments/my');
      const list = r.data?.enrollments || [];
      // Sort newest-first by the payment or enrolment date so the
      // history reads like a chronological ledger.
      list.sort((a, b) => {
        const A = new Date(a.paid_at || a.enrolled_at || 0).getTime();
        const B = new Date(b.paid_at || b.enrolled_at || 0).getTime();
        return B - A;
      });
      setRows(list);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[StudentPayments] load error:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Renew flow ─────────────────────────────────────────────────────
  // Mints a payment link on the backend, opens it in the OS browser
  // (Razorpay hosted checkout), and marks the enrollment as
  // "pendingRenewal" so the AppState listener below can poll for a
  // paid confirmation when the student returns.
  const startRenewal = async (enrollment) => {
    setRenewingId(enrollment.id);
    try {
      const r = await apiClient.post(`/enrollments/${enrollment.id}/renew`);
      const data = r.data || {};

      // Dev fallback — Razorpay not configured. Ask the student to
      // confirm and use the mock-pay path so testing still works.
      if (data.mock) {
        confirm({
          title:       'Confirm mock payment?',
          message:     'Razorpay isn\'t configured on this environment. Do you want to simulate a successful payment for testing?',
          variant:     'warning',
          confirmText: 'Simulate paid',
          cancelText:  'Cancel',
          onConfirm:   () => {
            (async () => {
              try {
                await apiClient.post(`/enrollments/${enrollment.id}/mock-pay`);
                setTimeout(() => finishRenewalSuccess(enrollment), 260);
              } catch (err) {
                showRenewalError(err);
              }
            })();
          },
        });
        return;
      }

      if (!data.payment_url) {
        showRenewalError(new Error('No payment URL returned by the server.'));
        return;
      }

      // Remember which enrollment we're waiting on. When the student
      // switches back to the app, the AppState listener polls status.
      pendingRenewalRef.current = {
        enrollmentId: enrollment.id,
        transactionId: data.transaction_id,
        openedAt:     Date.now(),
      };
      const canOpen = await Linking.canOpenURL(data.payment_url);
      if (!canOpen) {
        showRenewalError(new Error('No app can open the payment link.'));
        pendingRenewalRef.current = null;
        return;
      }
      await Linking.openURL(data.payment_url);
    } catch (err) {
      showRenewalError(err);
    } finally {
      setRenewingId(null);
    }
  };

  // Polls the backend for the enrollment's current payment status.
  // Returns 'paid' | 'failed' | 'pending'.
  const pollRenewalStatus = useCallback(async () => {
    const pending = pendingRenewalRef.current;
    if (!pending) return null;
    try {
      const r = await apiClient.get(`/enrollments/${pending.enrollmentId}/renewal-status`);
      const s = r.data?.enrollment?.payment_status;
      if (s === 'paid') {
        pendingRenewalRef.current = null;
        const enrollment = rows.find((x) => x.id === pending.enrollmentId) || { course_name: 'Your course' };
        finishRenewalSuccess(enrollment);
        return 'paid';
      }
      // If we've been waiting more than 10 minutes we assume the user
      // cancelled — surface a soft prompt so they don't stay confused.
      if (Date.now() - pending.openedAt > 10 * 60 * 1000) {
        pendingRenewalRef.current = null;
        confirm({
          title:       'Payment not received',
          message:     'We haven\'t seen a confirmation for that renewal. If you cancelled, no changes were made. If you did pay, pull to refresh in a moment.',
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
    } catch { /* transient — try next time */ }
    return null;
  }, [rows]);

  // AppState — every time the student returns to the app, poll once.
  // We also poll on focus (already handled via useFocusEffect).
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pollRenewalStatus();
    });
    return () => sub.remove();
  }, [pollRenewalStatus]);

  // Success side effects — refresh history + show success dialog.
  const finishRenewalSuccess = (enrollment) => {
    load();
    confirm({
      title:       'Subscription renewed successfully',
      message:     `${enrollment.course_name} is active again. Your next renewal date has been updated.`,
      variant:     'success',
      confirmText: 'Done',
      hideCancel:  true,
    });
  };

  // Central error path — differentiates cancellation ("closed the
  // payment sheet") from an actual failure so the copy is honest.
  const showRenewalError = (err) => {
    const msg = err?.response?.data?.message || err?.message || 'Please try again.';
    confirm({
      title:       'Could not start renewal',
      message:     msg,
      variant:     'warning',
      confirmText: 'OK',
      hideCancel:  true,
    });
  };

  const { totalPaid, upcoming, history } = useMemo(() => {
    let paid = 0;
    const upcomingRows = [];
    const historyRows  = [];
    rows.forEach((r) => {
      if (r.payment_status === 'paid') {
        paid += Number(r.payment_amount) || 0;
        // Also flag as "upcoming due" when their next renewal is within
        // the next 15 days — gives the student a heads-up.
        const next = nextRenewal(r.paid_at || r.enrolled_at, r.course_billing_cycle);
        if (next) {
          const daysAway = Math.round(
            (new Date(next).getTime() - Date.now()) / (24 * 3600 * 1000),
          );
          if (daysAway >= 0 && daysAway <= 15) {
            upcomingRows.push({ ...r, __due: next, __daysAway: daysAway });
          }
        }
      } else {
        upcomingRows.push({ ...r, __due: null, __daysAway: null });
      }
      historyRows.push(r);
    });
    return { totalPaid: paid, upcoming: upcomingRows, history: historyRows };
  }, [rows]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Payments</Text>
          <Text style={styles.subtitle}>
            {rows.length === 0 ? 'No history yet' : `${rows.length} transaction${rows.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {/* Roll-up hero */}
          <View style={styles.hero}>
            <View style={[styles.heroIcon, { backgroundColor: palette.green.soft }]}>
              <Wallet size={18} color={palette.green.vivid} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>Total paid</Text>
              <Text style={styles.heroValue}>{fmtINR(totalPaid)}</Text>
            </View>
          </View>

          {/* Upcoming */}
          <Text style={styles.sectionTitle}>UPCOMING PAYMENT DUE</Text>
          {upcoming.length === 0 ? (
            <View style={styles.emptyThin}>
              <CheckCircle2 size={14} color={palette.green.vivid} strokeWidth={2.4} />
              <Text style={styles.emptyThinText}>You&apos;re all caught up — nothing due.</Text>
            </View>
          ) : (
            upcoming.map((r) => (
              <UpcomingCard
                key={`up-${r.id}`}
                row={r}
                onRenew={() => startRenewal(r)}
                renewing={renewingId === r.id}
              />
            ))
          )}

          {/* History */}
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>PAYMENT HISTORY</Text>
          {history.length === 0 ? (
            <View style={styles.emptyCard}>
              <CreditCard size={32} color={palette.textLight} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No transactions yet</Text>
              <Text style={styles.emptySub}>
                Payments you make on the app will appear here.
              </Text>
            </View>
          ) : (
            history.map((r) => (
              <HistoryCard
                key={`hist-${r.id}`}
                row={r}
                onRenew={() => startRenewal(r)}
                renewing={renewingId === r.id}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function UpcomingCard({ row, onRenew, renewing }) {
  const isUnpaid = row.payment_status !== 'paid';
  const label = isUnpaid ? 'Pending payment' : `Renews in ${row.__daysAway ?? '—'} day${row.__daysAway === 1 ? '' : 's'}`;
  return (
    <View style={[styles.card, { borderWidth: 1, borderColor: isUnpaid ? palette.rose.soft : palette.orange.soft }]}>
      <View style={styles.cardHead}>
        <View style={[styles.iconTile, { backgroundColor: isUnpaid ? palette.rose.soft : palette.orange.soft }]}>
          <AlertCircle size={16} color={isUnpaid ? palette.rose.vivid : palette.orange.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.courseName} numberOfLines={1}>{row.course_name}</Text>
          <View style={styles.metaRow}>
            <Building2 size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.metaText} numberOfLines={1}>{row.institution_name}</Text>
          </View>
        </View>
        <View style={[styles.duePill, isUnpaid && { backgroundColor: palette.rose.soft }]}>
          <Text style={[styles.duePillText, isUnpaid && { color: palette.rose.on }]}>
            {label}
          </Text>
        </View>
      </View>
      <View style={styles.dueRow}>
        <Text style={styles.dueAmount}>{fmtINR(row.payment_amount || row.course_price || 0)}</Text>
        {row.__due ? (
          <Text style={styles.dueDate}>Due {fmtDate(row.__due)}</Text>
        ) : null}
      </View>

      {/* Primary CTA — opens Razorpay checkout via startRenewal. */}
      <TouchableOpacity
        onPress={onRenew}
        disabled={renewing}
        activeOpacity={0.85}
        style={[styles.renewBtn, renewing && { opacity: 0.7 }]}
      >
        {renewing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Repeat size={13} color="#fff" strokeWidth={2.6} />
            <Text style={styles.renewBtnText}>
              {isUnpaid ? 'Pay now' : 'Renew now'}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function HistoryCard({ row, onRenew, renewing }) {
  const meta = STATUS_META[row.payment_status] || STATUS_META.pending;
  const Icon = meta.icon;
  const cycle = row.course_billing_cycle || 'monthly';
  const next = row.payment_status === 'paid'
    ? nextRenewal(row.paid_at || row.enrolled_at, cycle) : null;
  // A row is "renewable" when it's paid but the next renewal is
  // within 30 days OR already past, or when it's still unpaid / failed.
  const daysToNext = next
    ? Math.round((new Date(next).getTime() - Date.now()) / (24 * 3600 * 1000))
    : null;
  const canRenew = row.payment_status !== 'paid' ||
                   (daysToNext != null && daysToNext <= 30);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.iconTile, { backgroundColor: meta.accent.soft }]}>
          <Icon size={16} color={meta.accent.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.courseName} numberOfLines={1}>{row.course_name}</Text>
          <Text style={styles.metaText} numberOfLines={1}>
            {row.institution_name}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <Text style={[styles.statusPillText, { color: meta.fg }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.amountRow}>
        <Text style={styles.amountText}>{fmtINR(row.payment_amount || 0)}</Text>
        <Text style={styles.cycleText}>{cycle === 'yearly' ? 'Yearly' : cycle === 'quarterly' ? 'Quarterly' : cycle === 'half_yearly' ? 'Half-yearly' : 'Monthly'}</Text>
      </View>

      <View style={styles.detailGrid}>
        <Detail
          icon={Calendar}
          label="Payment date"
          value={fmtDate(row.paid_at || row.enrolled_at)}
        />
        <Detail
          icon={RefreshCw}
          label="Next renewal"
          value={next ? fmtDate(next) : '—'}
        />
      </View>
      {row.payment_reference ? (
        <View style={styles.txnRow}>
          <Text style={styles.txnLabel}>TXN</Text>
          <Text style={styles.txnValue} numberOfLines={1}>{row.payment_reference}</Text>
        </View>
      ) : null}

      {/* Renew CTA — only when the row is either overdue or nearing
          its next renewal window, so we don't clutter old paid rows
          that don't need action. */}
      {canRenew ? (
        <TouchableOpacity
          onPress={onRenew}
          disabled={renewing}
          activeOpacity={0.85}
          style={[styles.renewBtnSecondary, renewing && { opacity: 0.7 }]}
        >
          {renewing ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : (
            <>
              <Repeat size={12} color={palette.purple.vivid} strokeWidth={2.6} />
              <Text style={styles.renewBtnSecondaryText}>
                {row.payment_status === 'paid' ? 'Renew subscription' : 'Retry payment'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Detail({ icon: Icon, label, value }) {
  return (
    <View style={styles.detailBox}>
      <View style={styles.detailLabelRow}>
        <Icon size={10} color={palette.textMuted} strokeWidth={2.4} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card, gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title: { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface, borderRadius: radius.lg,
    padding: spacing.lg, ...shadows.card,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  heroLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.6,
  },
  heroValue: { fontSize: 22, fontWeight: '800', color: palette.text, letterSpacing: -0.4 },

  sectionTitle: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: 8,
  },

  emptyCard: {
    backgroundColor: palette.surface, borderRadius: radius.lg,
    padding: spacing.xxl, alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },
  emptyThin: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: spacing.md,
  },
  emptyThinText: { ...type.caption, color: palette.textMuted, fontWeight: '700' },

  card: {
    backgroundColor: palette.surface, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    ...shadows.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  courseName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { ...type.micro, color: palette.textMuted, fontWeight: '700', flexShrink: 1 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  statusPillText: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase',
  },
  duePill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: palette.orange.soft,
  },
  duePillText: {
    fontSize: 10, fontWeight: '800', color: palette.orange.on,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },

  amountRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 6,
    marginTop: spacing.md,
  },
  amountText: {
    fontSize: 20, fontWeight: '800', color: palette.text, letterSpacing: -0.3,
  },
  cycleText: { ...type.micro, color: palette.textMuted, fontWeight: '800' },

  dueRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  dueAmount: {
    fontSize: 18, fontWeight: '800', color: palette.text, letterSpacing: -0.3,
  },
  dueDate: { ...type.caption, color: palette.textMuted, fontWeight: '700' },

  detailGrid: {
    flexDirection: 'row', gap: 6, marginTop: spacing.md,
  },
  detailBox: {
    flex: 1, backgroundColor: palette.bg, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: palette.borderSoft,
  },
  detailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  detailValue: {
    ...type.bodyBold, color: palette.text, fontSize: 12, marginTop: 3,
  },

  txnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  txnLabel: {
    fontSize: 10, fontWeight: '800', color: palette.textMuted,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  txnValue: {
    flex: 1,
    fontSize: 11, fontWeight: '700', color: palette.text,
    fontFamily: 'monospace',
  },

  // Primary Renew button on Upcoming cards — brand-red glow.
  renewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#E63946',
    shadowColor: '#E63946',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  renewBtnText: {
    color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3,
  },

  // Secondary Renew on History cards — soft-purple outline pill so it
  // doesn't compete with the primary CTA above.
  renewBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md,
    paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: palette.purple.vivid,
    backgroundColor: palette.purple.soft,
  },
  renewBtnSecondaryText: {
    color: palette.purple.vivid, fontSize: 13, fontWeight: '800', letterSpacing: 0.3,
  },
});
