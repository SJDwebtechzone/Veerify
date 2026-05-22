// src/screens/admin/tabs/PaymentsTabScreen.js
//
// Payments tab — the institution's financial dashboard.
//
// Layout:
//   1. Header — "Payments" title + this-month summary + filter icon
//   2. Hero summary card — total collected this month with delta + mini bars
//   3. Two summary tiles side by side — Pending and Overdue (with counts)
//   4. Search bar (name / student ID / month)
//   5. Segmented tabs — All / Paid / Pending / Overdue (live counts)
//   6. Student payment list:
//        avatar + name + course pill
//        amount + due/paid date
//        status pill (green/orange/rose)
//   7. FAB for "Record Payment"
//
// Placeholder data for now.

import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert,
} from 'react-native';
import {
  Search, SlidersHorizontal, Wallet, TrendingUp, AlertTriangle,
  Clock, CheckCircle2, ChevronRight, Plus,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';

// ─── Placeholder data ────────────────────────────────────────────────────────
const PAYMENTS = [
  { id: 1, studentId: 'STU-1042', student: 'Aarav Sharma',   course: 'Karate',     amount: 2500, status: 'paid',    date: '05 May', accent: palette.purple },
  { id: 2, studentId: 'STU-1043', student: 'Priya Iyer',     course: 'Taekwondo',  amount: 3000, status: 'paid',    date: '04 May', accent: palette.blue },
  { id: 3, studentId: 'STU-1044', student: 'Rohan Mehta',    course: 'BJJ',        amount: 3500, status: 'pending', date: '20 May', accent: palette.green },
  { id: 4, studentId: 'STU-1045', student: 'Diya Krishnan',  course: 'Boxing',     amount: 2500, status: 'overdue', date: '10 May', accent: palette.orange },
  { id: 5, studentId: 'STU-1046', student: 'Ishaan Kapoor',  course: 'Karate',     amount: 2500, status: 'paid',    date: '03 May', accent: palette.pink },
  { id: 6, studentId: 'STU-1047', student: 'Ananya Reddy',   course: 'Kickboxing', amount: 2800, status: 'pending', date: '22 May', accent: palette.teal },
  { id: 7, studentId: 'STU-1048', student: 'Kabir Singh',    course: 'BJJ',        amount: 3500, status: 'overdue', date: '08 May', accent: palette.purple },
  { id: 8, studentId: 'STU-1049', student: 'Saanvi Patel',   course: 'Taekwondo',  amount: 3000, status: 'pending', date: '25 May', accent: palette.rose },
  { id: 9, studentId: 'STU-1050', student: 'Vihaan Joshi',   course: 'Karate',     amount: 2500, status: 'paid',    date: '02 May', accent: palette.blue },
  { id: 10,studentId: 'STU-1051', student: 'Myra Choudhary', course: 'Boxing',     amount: 2500, status: 'paid',    date: '07 May', accent: palette.green },
];

const TABS = ['All', 'Paid', 'Pending', 'Overdue'];

const STATUS_META = {
  paid:    { color: palette.green,  icon: CheckCircle2,   label: 'Paid'    },
  pending: { color: palette.orange, icon: Clock,          label: 'Pending' },
  overdue: { color: palette.rose,   icon: AlertTriangle,  label: 'Overdue' },
};

// Mini bar series for the hero card — weekly collections in ₹k.
const WEEKLY_COLLECTIONS = [12, 18, 22, 16, 24, 20, 28, 32];

export default function PaymentsTabScreen() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('All');

  const totals = useMemo(() => {
    const collected = PAYMENTS.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const pending   = PAYMENTS.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    const overdue   = PAYMENTS.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount, 0);
    return { collected, pending, overdue };
  }, []);

  const counts = useMemo(() => ({
    All:     PAYMENTS.length,
    Paid:    PAYMENTS.filter(p => p.status === 'paid').length,
    Pending: PAYMENTS.filter(p => p.status === 'pending').length,
    Overdue: PAYMENTS.filter(p => p.status === 'overdue').length,
  }), []);

  const visible = useMemo(() => {
    let arr = PAYMENTS;
    if (tab !== 'All') arr = arr.filter(p => p.status === tab.toLowerCase());
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(p =>
        p.student.toLowerCase().includes(q) ||
        p.studentId.toLowerCase().includes(q) ||
        p.course.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [search, tab]);

  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");
  const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;
  const maxBar = Math.max(...WEEKLY_COLLECTIONS);

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        stickyHeaderIndices={[]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Payments</Text>
            <Text style={styles.subtitle}>
              {fmt(totals.collected)} collected this month
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => placeholder('Filter')}
            style={styles.iconButton}
            activeOpacity={0.8}
          >
            <SlidersHorizontal size={20} color={palette.text} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* Hero: Collected this month */}
        <View style={[styles.heroCard, { backgroundColor: palette.purple.vivid }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>Collected this month</Text>
              <Text style={styles.heroValue}>{fmt(totals.collected)}</Text>
              <View style={styles.heroDelta}>
                <TrendingUp size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.heroDeltaText}>+18% vs last month</Text>
              </View>
            </View>
            <View style={styles.heroIconBubble}>
              <Wallet size={22} color="#fff" strokeWidth={2.2} />
            </View>
          </View>
          {/* Weekly bars */}
          <View style={styles.heroChart}>
            {WEEKLY_COLLECTIONS.map((v, i) => (
              <View key={i} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: 6 + (v / maxBar) * 38,
                      backgroundColor: i === WEEKLY_COLLECTIONS.length - 1
                        ? '#FFFFFF'
                        : 'rgba(255,255,255,0.35)',
                    },
                  ]}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Two summary tiles */}
        <View style={styles.tileRow}>
          <SummaryTile
            label="Pending"
            value={fmt(totals.pending)}
            sub={`${counts.Pending} student${counts.Pending === 1 ? '' : 's'}`}
            accent={palette.orange}
            icon={Clock}
          />
          <SummaryTile
            label="Overdue"
            value={fmt(totals.overdue)}
            sub={`${counts.Overdue} student${counts.Overdue === 1 ? '' : 's'}`}
            accent={palette.rose}
            icon={AlertTriangle}
          />
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by student, ID, or course"
            placeholderTextColor={palette.textLight}
            style={styles.searchInput}
          />
        </View>

        {/* Tabs */}
        <View style={styles.tabsWrap}>
          <FlatList
            data={TABS}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            keyExtractor={(t) => t}
            renderItem={({ item: t }) => {
              const focused = tab === t;
              return (
                <TouchableOpacity
                  onPress={() => setTab(t)}
                  activeOpacity={0.85}
                  style={[styles.tab, focused && styles.tabFocused]}
                >
                  <Text style={[styles.tabText, focused && styles.tabTextFocused]}>{t}</Text>
                  <View style={[styles.tabBadge, focused && styles.tabBadgeFocused]}>
                    <Text style={[styles.tabBadgeText, focused && styles.tabBadgeTextFocused]}>
                      {counts[t]}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* List header */}
        <View style={styles.listHeader}>
          <Text style={styles.listHeaderTitle}>
            {tab === 'All' ? 'All payments' : `${tab} payments`}
          </Text>
          <Text style={styles.listHeaderCount}>
            {visible.length} record{visible.length === 1 ? '' : 's'}
          </Text>
        </View>

        {/* List */}
        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Wallet size={36} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyTitle}>
              {search ? 'No matching payments' : 'Nothing here yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {search ? 'Try a different search term.' : 'Recorded payments will appear here.'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visible.map((p, idx) => (
              <View key={p.id}>
                <PaymentRow payment={p} onPress={() => placeholder(p.student)} />
                {idx < visible.length - 1 ? <View style={styles.rowDivider} /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <FAB
        icon={Plus}
        bottom={92}
        onPress={() => placeholder('Record Payment')}
        accent={palette.purple}
      />
    </View>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────
function SummaryTile({ label, value, sub, accent, icon: Icon }) {
  return (
    <View style={[styles.tile, { backgroundColor: accent.soft }]}>
      <View style={[styles.tileIcon, { backgroundColor: accent.vivid }]}>
        <Icon size={16} color="#fff" strokeWidth={2.4} />
      </View>
      <Text style={[styles.tileValue, { color: accent.on }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: accent.on }]}>{label}</Text>
      <Text style={[styles.tileSub, { color: accent.on }]}>{sub}</Text>
    </View>
  );
}

function PaymentRow({ payment, onPress }) {
  const meta = STATUS_META[payment.status];
  const Icon = meta.icon;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.avatar, { backgroundColor: payment.accent.soft }]}>
        <Text style={[styles.avatarInitial, { color: payment.accent.on }]}>
          {payment.student.charAt(0)}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.studentName} numberOfLines={1}>{payment.student}</Text>
        <View style={styles.rowMeta}>
          <View style={[styles.coursePill, { backgroundColor: payment.accent.soft }]}>
            <Text style={[styles.coursePillText, { color: payment.accent.on }]}>
              {payment.course}
            </Text>
          </View>
          <Text style={styles.rowDate}>
            {payment.status === 'paid' ? 'Paid' : 'Due'} {payment.date}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Text style={styles.amount}>₹{payment.amount.toLocaleString('en-IN')}</Text>
        <View style={[styles.statusPill, { backgroundColor: meta.color.soft }]}>
          <Icon size={10} color={meta.color.vivid} strokeWidth={2.4} />
          <Text style={[styles.statusPillText, { color: meta.color.on }]}>{meta.label}</Text>
        </View>
      </View>

      <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },

  // Hero
  heroCard: {
    marginHorizontal: spacing.xl,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.raised,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start' },
  heroLabel: { ...type.caption, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  heroValue: { ...type.display, color: '#fff', marginTop: 4 },
  heroDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  heroDeltaText: { ...type.caption, color: '#fff', fontWeight: '600' },
  heroIconBubble: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 'auto',
  },
  heroChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 50,
    marginTop: spacing.lg,
  },
  barColumn: { width: 18, alignItems: 'center' },
  bar: { width: 8, borderRadius: 4 },

  // Tiles
  tileRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 4,
  },
  tileIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileValue: { ...type.h2 },
  tileLabel: { ...type.caption, fontWeight: '700' },
  tileSub:   { ...type.micro, opacity: 0.7 },

  // Search
  searchWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  // Tabs
  tabsWrap: { paddingVertical: spacing.lg },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  tabFocused: { backgroundColor: palette.purple.vivid },
  tabText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  tabTextFocused: { color: '#fff' },
  tabBadge: {
    minWidth: 22, height: 20, paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeFocused: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { ...type.micro, color: palette.textMuted },
  tabBadgeTextFocused: { color: '#fff' },

  // List header
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  listHeaderTitle: { ...type.h2, color: palette.text },
  listHeaderCount: { ...type.caption, color: palette.textMuted },

  // List
  list: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  rowDivider: { height: 1, backgroundColor: palette.borderSoft, marginHorizontal: spacing.lg },

  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { ...type.h2, color: palette.text, marginTop: spacing.md },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { ...type.h3, fontWeight: '700' },
  studentName: { ...type.bodyBold, color: palette.text },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  coursePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  coursePillText: { ...type.micro, fontWeight: '700' },
  rowDate: { ...type.caption, color: palette.textMuted },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  amount: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusPillText: { ...type.micro, fontWeight: '700' },
});
