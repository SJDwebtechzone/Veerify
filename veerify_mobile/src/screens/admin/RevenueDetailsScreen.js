// src/screens/admin/RevenueDetailsScreen.js
//
// Monthly Revenue → Details drill-down for institution + branch
// admins.
//
// Layout:
//   • Header — total for the visible window
//   • Monthly summary rows — one per calendar month with total + #
//     successful payments. Newest → oldest.
//   • Payment ledger — every successful ('paid') payment in the
//     window, grouped under its month. Each row: amount, date/time
//     (12h AM/PM), source (Cash / UPI / Bank / Cheque / Online),
//     payment reference.
//   • "Load more" pill at the bottom fetches the NEXT 6 months of
//     history until the backend reports has_more=false.
//
// Data:
//   GET /admin/revenue-details?months=6&before=<iso>
//   The endpoint uses the exact same revenueScope as /admin/dashboard,
//   so the totals here can NEVER disagree with the dashboard chart.
//
// Scope routing lives entirely server-side:
//   • Sub-branch admin      → their branch only.
//   • Main admin, no picker → whole academy (main + branches).
//   • Main admin, picker N  → that branch only. Pass branchId via
//                             route.params to reuse.

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { CreditCard, Landmark, Smartphone, Banknote, ScrollText } from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { formatDateTime12h } from '../../utils/formatTime';

const PAGE_MONTHS = 6;

function fmtINR(v) {
  const n = Number(v) || 0;
  return `₹${n.toLocaleString('en-IN')}`;
}

// Rough source → icon map. Payment mode names come from the backend
// (`payment_mode` on enrollments) with 'Online' as the online-payment
// fallback. Keep the map generous so future custom modes still render
// with a sensible icon.
function iconFor(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('cash'))    return Banknote;
  if (s.includes('upi'))     return Smartphone;
  if (s.includes('bank'))    return Landmark;
  if (s.includes('cheque'))  return ScrollText;
  return CreditCard;
}

export default function RevenueDetailsScreen({ route }) {
  const branchIdParam = route?.params?.branchId ?? null;

  const [months, setMonths]        = useState([]);
  const [payments, setPayments]    = useState([]);
  const [loading, setLoading]      = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]      = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError]          = useState(null);

  const load = useCallback(async (opts = {}) => {
    const isReset = !!opts.reset;
    if (isReset) setError(null);
    try {
      const params = new URLSearchParams();
      params.set('months', String(PAGE_MONTHS));
      if (branchIdParam !== null) params.set('branch_id', String(branchIdParam));
      if (!isReset && nextBefore) params.set('before', nextBefore);
      const res = await apiClient.get(`/admin/revenue-details?${params.toString()}`);
      const nextMonths   = Array.isArray(res.data?.months)   ? res.data.months   : [];
      const nextPayments = Array.isArray(res.data?.payments) ? res.data.payments : [];
      setMonths((prev) => (isReset ? nextMonths : [...prev, ...nextMonths]));
      setPayments((prev) => (isReset ? nextPayments : [...prev, ...nextPayments]));
      setHasMore(!!res.data?.has_more);
      setNextBefore(res.data?.next_before || null);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load revenue';
      setError(msg);
      if (isReset) { setMonths([]); setPayments([]); }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [branchIdParam, nextBefore]);

  useEffect(() => {
    setLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (async () => { await load({ reset: true }); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchIdParam]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNextBefore(null);
    setHasMore(false);
    load({ reset: true });
  }, [load]);

  const onLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || !nextBefore) return;
    setLoadingMore(true);
    load({ reset: false });
  }, [loadingMore, hasMore, nextBefore, load]);

  // Group payments under the month they belong to (based on the
  // month_start of every visible month). Newest month first.
  const grouped = useMemo(() => {
    const out = [];
    for (const m of months) {
      const start = new Date(m.month_start);
      const end   = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      const inMonth = payments.filter((p) => {
        const at = new Date(p.at);
        return at >= start && at < end;
      });
      out.push({ month: m, payments: inMonth });
    }
    return out;
  }, [months, payments]);

  const windowTotal = useMemo(
    () => months.reduce((sum, m) => sum + (Number(m.total) || 0), 0),
    [months],
  );
  const windowCount = useMemo(
    () => months.reduce((sum, m) => sum + (Number(m.count) || 0), 0),
    [months],
  );

  if (loading && months.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Revenue Details</Text>
        <Text style={styles.headerSubtitle}>
          {fmtINR(windowTotal)} · {windowCount} payment{windowCount === 1 ? '' : 's'}
          {months.length > 0 ? ` · last ${months.length} month${months.length === 1 ? '' : 's'}` : ''}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={grouped}
        keyExtractor={(g) => String(g.month.month_start)}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No revenue yet</Text>
            <Text style={styles.emptyBody}>
              Successful enrolment payments will appear here.
            </Text>
          </View>
        }
        ListFooterComponent={
          months.length === 0 ? null : hasMore ? (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={onLoadMore}
              disabled={loadingMore}
              activeOpacity={0.85}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </TouchableOpacity>
          ) : (
            <Text style={styles.endOfList}>You&apos;ve reached the end.</Text>
          )
        }
        renderItem={({ item: g }) => (
          <View style={styles.monthCard}>
            <View style={styles.monthHead}>
              <Text style={styles.monthLabel}>{g.month.label}</Text>
              <Text style={styles.monthTotal}>{fmtINR(g.month.total)}</Text>
            </View>
            <Text style={styles.monthCount}>
              {g.month.count} successful payment{g.month.count === 1 ? '' : 's'}
            </Text>
            {g.payments.length === 0 ? (
              <Text style={styles.monthEmpty}>No payments this month.</Text>
            ) : (
              g.payments.map((p, idx) => {
                const Icon = iconFor(p.source);
                return (
                  <View key={p.id} style={[styles.payRow, idx > 0 && styles.payRowSep]}>
                    <View style={styles.payIconWrap}>
                      <Icon size={16} color={palette.purple.vivid} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.payTop}>
                        <Text style={styles.payStudent} numberOfLines={1}>
                          {p.student_name || 'Student'}
                        </Text>
                        <Text style={styles.payAmount}>{fmtINR(p.amount)}</Text>
                      </View>
                      <Text style={styles.payMeta} numberOfLines={1}>
                        {[p.course_name, p.batch_name].filter(Boolean).join(' · ')}
                      </Text>
                      <View style={styles.payFoot}>
                        <Text style={styles.paySource}>{p.source || 'Online'}</Text>
                        <Text style={styles.payWhen}>{formatDateTime12h(p.at)}</Text>
                      </View>
                      {p.branch_name ? (
                        <Text style={styles.payBranch}>Branch: {p.branch_name}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.md },
  headerTitle:    { ...type.display, color: palette.text },
  headerSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 4 },

  errorBox: {
    marginHorizontal: spacing.xl,
    padding: spacing.md,
    backgroundColor: palette.rose?.soft || '#FEE2E2',
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  errorText: { ...type.caption, color: palette.rose?.on || '#991B1B', fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.xs },
  emptyTitle: { ...type.h2, color: palette.text, marginBottom: 4, textAlign: 'center' },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  monthCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  monthHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  monthLabel: { ...type.h2, color: palette.text },
  monthTotal: { ...type.h2, color: palette.purple.vivid, fontWeight: '800' },
  monthCount: { ...type.caption, color: palette.textMuted, marginTop: 2, marginBottom: spacing.sm },
  monthEmpty: {
    ...type.caption,
    color: palette.textLight,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },

  payRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  payRowSep: {
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    marginTop: spacing.sm,
  },
  payIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: palette.purple.soft || '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  payTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  payStudent: { ...type.bodyBold, color: palette.text, flex: 1, paddingRight: 8 },
  payAmount:  { ...type.bodyBold, color: palette.green?.vivid || '#16A34A' },
  payMeta:    { ...type.caption, color: palette.textMuted, marginTop: 2 },
  payFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  paySource: {
    ...type.micro,
    color: palette.purple.on || palette.purple.vivid,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  payWhen:  { ...type.micro, color: palette.textLight, fontWeight: '600' },
  payBranch: { ...type.micro, color: palette.textLight, marginTop: 2 },

  loadMoreBtn: {
    marginTop: spacing.lg,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  loadMoreText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },

  endOfList: {
    ...type.caption,
    color: palette.textLight,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
});
