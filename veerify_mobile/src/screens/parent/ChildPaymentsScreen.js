// src/screens/parent/ChildPaymentsScreen.js
//
// Parent Step 8 - Payment Management.
//
// Layout:
//   1. Header  back, "Payments" title, child name.
//   2. Hero summary - total due (big), total paid this year, count badges.
//   3. Filter chips - All / Pending / Paid / Failed.
//   4. List of fee items (one per enrollment for now):
//        - Course + batch name
//        - Amount
//        - Status badge
//        - Per-item action: Pay Now (when pending), Share receipt (when paid).
//   5. Payment methods strip (UPI / Cards / Net Banking) for transparency,
//      lights up when an item is selected for payment.
//
// Data:
//   GET /api/parents/children/:id/payments  - existing endpoint
// Note: real installments + due dates + Razorpay integration land in a
// future migration. For now we treat each enrollment as one fee item.

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert, Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Wallet, CheckCircle2, Clock, XCircle, FileText,
  Share2, CreditCard, Smartphone, Building2, Receipt,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  pending: { label: 'Pending', icon: Clock,        accent: palette.orange },
  paid:    { label: 'Paid',    icon: CheckCircle2, accent: palette.green },
  failed:  { label: 'Failed',  icon: XCircle,      accent: palette.rose },
};

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function ChildPaymentsScreen({ navigation, route }) {
  const { activeChild } = useChild();
  const childId = route?.params?.childId ?? activeChild?.child_id ?? null;
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';

  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState({ total: 0, paid: 0, pending: 0 });
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); setRefreshing(false); return; }
    try {
      const res = await apiClient.get(`/parents/children/${childId}/payments`)
        .catch(() => ({ data: { payments: [], summary: { total: 0, paid: 0, pending: 0 } } }));
      setPayments(res.data?.payments || []);
      setSummary(res.data?.summary || { total: 0, paid: 0, pending: 0 });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Counts per status (for filter pills) ──
  const counts = useMemo(() => {
    const c = { all: payments.length, pending: 0, paid: 0, failed: 0 };
    payments.forEach((p) => {
      if (c[p.payment_status] !== undefined) c[p.payment_status]++;
    });
    return c;
  }, [payments]);

  const visible = useMemo(() => {
    if (filter === 'all') return payments;
    return payments.filter((p) => p.payment_status === filter);
  }, [payments, filter]);

  // ── Actions ──
  const handlePayNow = (item) => {
    Alert.alert(
      `Pay ${fmtINR(item.amount)}?`,
      'Online payment via Razorpay will be wired up in the next phase. For now, please pay at the academy and ask them to mark this as paid.',
    );
  };
  const handleShareReceipt = async (item) => {
    try {
      const lines = [
        'VEERIFY PAYMENT RECEIPT',
        '────────────────',
        `Student:    ${childName}`,
        `Course:     ${item.course_name || '—'}`,
        `Batch:      ${item.batch_name || '—'}`,
        `Institution: ${item.institution_name || '—'}`,
        `Amount:     ${fmtINR(item.amount)}`,
        `Status:     ${(item.payment_status || '').toUpperCase()}`,
        `Enrolled:   ${item.enrolled_at ? new Date(item.enrolled_at).toLocaleDateString() : '—'}`,
      ].join('\n');
      await Share.share({ message: lines, title: `Receipt · ${item.course_name || 'Veerify'}` });
    } catch (err) {
      Alert.alert('Could not share', err.message || 'Try again.');
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        {navigation.canGoBack?.() ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Payments</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{childName}</Text>
        </View>
        <View style={styles.headerPill}>
          <Receipt size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{summary.total ? fmtINR(summary.total) : '—'}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroPendingCol}>
            <Text style={styles.heroEyebrow}>TOTAL PENDING</Text>
            <Text style={styles.heroAmount}>{fmtINR(summary.pending)}</Text>
            <Text style={styles.heroSub}>
              {counts.pending === 0
                ? 'All fees are up to date 🎉'
                : `${counts.pending} ${counts.pending === 1 ? 'invoice' : 'invoices'} due`}
            </Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroPaidCol}>
            <Text style={styles.heroEyebrow}>PAID TO DATE</Text>
            <Text style={styles.heroPaidAmount}>{fmtINR(summary.paid)}</Text>
            <Text style={styles.heroSub}>
              {counts.paid} {counts.paid === 1 ? 'payment' : 'payments'}
            </Text>
          </View>
        </View>

        {/* Filter chips */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Wallet size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>FEES</Text>
        </View>
        <View style={styles.filterRow}>
          <FilterChip label="All"     count={counts.all}     active={filter === 'all'}     onPress={() => setFilter('all')} />
          <FilterChip label="Pending" count={counts.pending} active={filter === 'pending'} accent={palette.orange} onPress={() => setFilter('pending')} />
          <FilterChip label="Paid"    count={counts.paid}    active={filter === 'paid'}    accent={palette.green}  onPress={() => setFilter('paid')} />
          {counts.failed > 0 ? (
            <FilterChip label="Failed" count={counts.failed} active={filter === 'failed'} accent={palette.rose} onPress={() => setFilter('failed')} />
          ) : null}
        </View>

        {/* List */}
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Wallet size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {filter === 'pending' ? 'No pending fees' : filter === 'paid' ? 'No paid records yet' : 'No fees yet'}
            </Text>
            <Text style={styles.emptySub}>
              {filter === 'pending'
                ? 'All fees are up to date.'
                : 'Once enrollments are recorded, fee items show up here.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
            {visible.map((item) => (
              <FeeCard
                key={item.id}
                item={item}
                onPay={() => handlePayNow(item)}
                onShare={() => handleShareReceipt(item)}
              />
            ))}
          </View>
        )}

        {/* Payment methods (transparency) */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <CreditCard size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>WE'LL ACCEPT</Text>
        </View>
        <View style={styles.methodsRow}>
          <MethodTile icon={Smartphone}  label="UPI"          />
          <MethodTile icon={CreditCard}  label="Cards"        />
          <MethodTile icon={Building2}   label="Net Banking"  />
        </View>
        <Text style={styles.methodsHint}>
          Online payment via Razorpay is being wired up. Until then, settle fees
          at the academy and they'll mark them paid here.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function FilterChip({ label, count, active, accent, onPress }) {
  const fg = active ? '#fff' : (accent ? accent.vivid : palette.text);
  const bg = active ? (accent ? accent.vivid : palette.text) : palette.surface;
  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        { backgroundColor: bg, borderColor: active ? bg : palette.borderSoft },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.filterChipLabel, { color: fg }]}>{label}</Text>
      <Text style={[
        styles.filterChipCount,
        active
          ? { backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }
          : { backgroundColor: palette.borderSoft, color: palette.textMuted },
      ]}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

function FeeCard({ item, onPay, onShare }) {
  const meta = STATUS_META[item.payment_status] || STATUS_META.pending;
  const StatusIcon = meta.icon;
  const isPaid = item.payment_status === 'paid';

  return (
    <View style={[
      styles.feeCard,
      !isPaid && { borderLeftWidth: 3, borderLeftColor: meta.accent.vivid },
    ]}>
      <View style={styles.feeTopRow}>
        <View style={styles.feeIcon}>
          <Wallet size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.feeTitle} numberOfLines={1}>{item.course_name || 'Course fee'}</Text>
          {item.batch_name ? <Text style={styles.feeBatch} numberOfLines={1}>{item.batch_name}</Text> : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: meta.accent.soft }]}>
          <StatusIcon size={11} color={meta.accent.on} strokeWidth={2.4} />
          <Text style={[styles.statusBadgeText, { color: meta.accent.on }]}>{meta.label}</Text>
        </View>
      </View>

      {item.institution_name ? (
        <Text style={styles.feeInst}>{item.institution_name}</Text>
      ) : null}

      <View style={styles.feeAmountRow}>
        <View>
          <Text style={styles.feeAmountLabel}>{isPaid ? 'Amount paid' : 'Amount due'}</Text>
          <Text style={styles.feeAmount}>{fmtINR(item.amount)}</Text>
        </View>
        {item.enrolled_at ? (
          <View>
            <Text style={styles.feeAmountLabel}>Enrolled</Text>
            <Text style={styles.feeDate}>
              {new Date(item.enrolled_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.feeActions}>
        {!isPaid ? (
          <TouchableOpacity style={styles.payBtn} onPress={onPay} activeOpacity={0.9}>
            <Wallet size={14} color="#fff" strokeWidth={2.4} />
            <Text style={styles.payBtnText}>Pay {fmtINR(item.amount)}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.receiptBtn} onPress={onShare} activeOpacity={0.85}>
            <Share2 size={14} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.receiptBtnText}>Share receipt</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function MethodTile({ icon: Icon, label }) {
  return (
    <View style={styles.methodTile}>
      <View style={styles.methodIcon}>
        <Icon size={18} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.methodLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  headerTitle: { ...type.h1, color: palette.text, fontSize: 18 },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  headerPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },

  // Hero
  hero: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.raised,
  },
  heroPendingCol: { flex: 1 },
  heroPaidCol: { flex: 1, alignItems: 'flex-end' },
  heroEyebrow: { ...type.micro, color: 'rgba(255,255,255,0.75)', fontWeight: '800', letterSpacing: 1 },
  heroAmount: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 2 },
  heroPaidAmount: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  heroSub: { ...type.micro, color: 'rgba(255,255,255,0.85)', fontWeight: '700', marginTop: 4 },
  heroDivider: { width: 1, height: 56, backgroundColor: 'rgba(255,255,255,0.25)' },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterChipLabel: { ...type.caption, fontWeight: '700' },
  filterChipCount: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    minWidth: 22, textAlign: 'center',
  },

  // Fee card
  feeCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  feeTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  feeIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  feeTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  feeBatch: { ...type.caption, color: palette.purple.vivid, fontWeight: '700', marginTop: 1 },
  feeInst: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: spacing.sm, marginLeft: 52 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusBadgeText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  feeAmountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  feeAmountLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  feeAmount: { ...type.display, color: palette.text, fontSize: 22, marginTop: 2 },
  feeDate: { ...type.bodyBold, color: palette.text, marginTop: 2 },

  feeActions: { marginTop: spacing.md },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md, borderRadius: radius.md,
  },
  payBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
  receiptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.soft,
    paddingVertical: spacing.sm + 2, borderRadius: radius.md,
  },
  receiptBtnText: { ...type.bodyBold, color: palette.purple.on, fontWeight: '800' },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // Methods
  methodsRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  methodTile: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  methodIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  methodLabel: { ...type.caption, color: palette.text, fontWeight: '700' },
  methodsHint: {
    ...type.micro, color: palette.textMuted, fontStyle: 'italic',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
