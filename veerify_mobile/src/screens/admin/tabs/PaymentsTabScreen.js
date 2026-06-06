// src/screens/admin/tabs/PaymentsTabScreen.js
//
// Earnings tab — the institution's financial dashboard.
//
// Layout:
//   1. Header — "Earnings" title + this-month summary + wallet balance chip (top-right)
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

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import {
  Search, SlidersHorizontal, Wallet, TrendingUp, AlertTriangle,
  Clock, CheckCircle2, ChevronRight, Plus,
  Info, ArrowRight, X as XIcon, ShoppingCart, Receipt, Send,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';
import apiClient from '../../../api/client';

// All / Paid / Pending — Overdue isn't a real backend status; pending+past-due
// is folded into Pending. If we later add an SLA we can split it back out.
const TABS = ['All', 'Paid', 'Pending'];

const STATUS_META = {
  paid:    { color: palette.green,  icon: CheckCircle2,   label: 'Paid'    },
  pending: { color: palette.orange, icon: Clock,          label: 'Pending' },
  failed:  { color: palette.rose,   icon: AlertTriangle,  label: 'Failed'  },
};

// Rotate accents across rows so the avatar tints aren't all the same colour.
const ACCENT_CYCLE = [
  palette.purple, palette.blue, palette.green, palette.orange,
  palette.pink, palette.teal, palette.rose,
];

function resolvePhoto(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = apiClient?.defaults?.baseURL?.replace(/\/api\/?$/, '') || '';
  return base + url;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Placeholder wallet ledger.
//   course_purchases   - gross revenue from student course enrolments this cycle
//   admin_deduction_%  - the platform / super-admin cut (now pulled live from
//                        /api/marketplace-settings; default 10% as a fallback
//                        if the call fails).
//   to_transfer        - net amount the institution will receive next payout
//   wallet_balance     - cumulative available-to-withdraw balance
const DEFAULT_WALLET = {
  course_purchases:    0,
  admin_deduction_pct: 10,
  wallet_balance:      0,    // pending owed
  paid_out_total:      0,    // cumulative already received
  pending_amount:      0,
};

export default function PaymentsTabScreen() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('All');
  const [walletVisible, setWalletVisible] = useState(false);

  // Wallet ledger — fully live from /institution-payouts/me/wallet.
  // course_purchases, commission %, to-transfer, wallet balance, and pending
  // are computed server-side against the enrollments + institution_payouts
  // tables, so a "Mark Paid" click in the super-admin web instantly bumps
  // the wallet balance the next time this screen loads.
  const [wallet, setWallet] = useState(DEFAULT_WALLET);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/institution-payouts/me/wallet');
        if (!cancelled && res.data) {
          setWallet({
            course_purchases:    Number(res.data.course_purchases)   || 0,
            admin_deduction_pct: Number(res.data.commission_percent) || 0,
            // wallet_balance = pending owed. Decreases when the super admin
            // marks a payout as paid.
            wallet_balance:      Number(res.data.wallet_balance)     || 0,
            // paid_out_total = cumulative settlements already received. Shown
            // as a separate "Already paid out" line in the breakdown modal.
            paid_out_total:      Number(res.data.paid_out_total)     || 0,
            pending_amount:      Number(res.data.pending_amount)     || 0,
            last_paid_at:        res.data.last_paid_at || null,
          });
        }
      } catch (err) {
        // Silent fallback — keep defaults. Logged for triage.
        console.log('[PaymentsTab] wallet load failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derived: commission amount + net to-be-transferred. Recomputed when the
  // commission % or gross purchases change.
  const walletDerived = useMemo(() => {
    const deduction = Math.round(wallet.course_purchases * (wallet.admin_deduction_pct / 100));
    return {
      ...wallet,
      admin_deduction: deduction,
      to_transfer:     wallet.course_purchases - deduction,
    };
  }, [wallet]);

  // ── Live enrollment payments ───────────────────────────────────────────
  // GET /api/enrollments/institution/me returns one row per enrollment with
  // student name, course/batch, amount, status, and paid_at. We shape each
  // into the same payment-row contract the existing UI expected, so the
  // renderer below doesn't have to change.
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/enrollments/institution/me');
        const rows = (res.data?.enrollments || []).map((e, idx) => ({
          id:         e.id,
          studentId:  String(e.student_id),
          student:    e.student_name || 'Student',
          course:     [e.course_name, e.batch_name].filter(Boolean).join(' · ') || '—',
          amount:     Number(e.payment_amount) || 0,
          status:     e.payment_status || 'pending',
          date:       shortDate(e.paid_at || e.enrolled_at),
          photo_url:  resolvePhoto(e.student_photo_url),
          accent:     ACCENT_CYCLE[idx % ACCENT_CYCLE.length],
        }));
        if (!cancelled) setPayments(rows);
      } catch (err) {
        console.log('[PaymentsTab] enrolments load failed:', err?.message);
      } finally {
        if (!cancelled) setPaymentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totals = useMemo(() => {
    const collected = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const pending   = payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    return { collected, pending, overdue: 0 };
  }, [payments]);

  const counts = useMemo(() => ({
    All:     payments.length,
    Paid:    payments.filter(p => p.status === 'paid').length,
    Pending: payments.filter(p => p.status === 'pending').length,
  }), [payments]);

  const visible = useMemo(() => {
    let arr = payments;
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
  }, [search, tab, payments]);

  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");
  const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        stickyHeaderIndices={[]}
      >
        {/* Header — wallet was here as a chip; it now lives in the teaser
            card below the header so it gets the visual weight it deserves. */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Earnings</Text>
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

        {/* ───── Wallet teaser card ─────
            Sits between the header and the "Collected this month" hero so
            the wallet feels primary — most admins open this tab to see
            "what's owed to me". Tap opens a modal with the full breakdown. */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setWalletVisible(true)}
          style={styles.walletTeaser}
        >
          {/* Decorative blobs */}
          <View style={styles.walletBlobA} />
          <View style={styles.walletBlobB} />

          <View style={styles.walletTeaserRow}>
            <View style={styles.walletTeaserIcon}>
              <Wallet size={22} color="#fff" strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletTeaserEyebrow}>MY WALLET</Text>
              <Text style={styles.walletTeaserAmount}>{fmt(walletDerived.wallet_balance)}</Text>
              <Text style={styles.walletTeaserSubtitle}>
                {walletDerived.wallet_balance > 0
                  ? 'Pending settlement from admin'
                  : 'No pending settlement'}
              </Text>
            </View>
            <View style={styles.walletTeaserArrow}>
              <ArrowRight size={16} color="#fff" strokeWidth={2.4} />
            </View>
          </View>

          <View style={styles.walletTeaserCta}>
            <Info size={12} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />
            <Text style={styles.walletTeaserCtaText}>Click here to know more</Text>
          </View>
        </TouchableOpacity>

        {/* Wallet breakdown modal — opened by the teaser. */}
        {walletVisible && (
          <TouchableOpacity
            style={styles.walletOverlay}
            activeOpacity={1}
            onPress={() => setWalletVisible(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={styles.walletSheet}
              onPress={() => {} /* swallow tap so backdrop doesn't close */}
            >
              {/* Sheet header */}
              <View style={styles.walletSheetHeader}>
                <View style={styles.walletSheetIcon}>
                  <Wallet size={18} color={palette.purple.vivid} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walletSheetTitle}>Wallet breakdown</Text>
                  <Text style={styles.walletSheetSubtitle}>
                    How your payout is calculated
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setWalletVisible(false)}
                  style={styles.walletSheetClose}
                  activeOpacity={0.7}
                >
                  <XIcon size={18} color={palette.textLight} strokeWidth={2.2} />
                </TouchableOpacity>
              </View>

              {/* Course purchases */}
              <BreakdownRow
                icon={ShoppingCart}
                accent={palette.blue}
                label="Course purchases"
                sub="Gross revenue from student enrolments"
                value={fmt(walletDerived.course_purchases)}
              />

              {/* Admin deduction (shown as a debit row) */}
              <BreakdownRow
                icon={Receipt}
                accent={palette.orange}
                label={`Platform fee (${walletDerived.admin_deduction_pct}%)`}
                sub="Admin's per-transaction deduction"
                value={`− ${fmt(walletDerived.admin_deduction)}`}
                valueColor={palette.orange.vivid}
              />

              <View style={styles.walletDivider} />

              {/* Total amount the institution is entitled to over all time. */}
              <BreakdownRow
                icon={Send}
                accent={palette.green}
                label="Total payable"
                sub="Course purchases − platform fee"
                value={fmt(walletDerived.to_transfer)}
                emphasize
              />

              {/* Already settled by the admin (informational). */}
              <BreakdownRow
                icon={CheckCircle2}
                accent={palette.teal}
                label="Already paid out"
                sub={
                  walletDerived.last_paid_at
                    ? `Last payout: ${shortDate(walletDerived.last_paid_at)}`
                    : 'No payouts yet'
                }
                value={fmt(walletDerived.paid_out_total || 0)}
              />

              {/* Wallet balance = pending owed. Decreases when admin marks paid. */}
              <View style={styles.walletBalanceBlock}>
                <View style={styles.walletBalanceLeft}>
                  <Text style={styles.walletBalanceLabel}>Pending in wallet</Text>
                  <Text style={styles.walletBalanceSub}>
                    {walletDerived.wallet_balance > 0
                      ? 'Awaiting transfer from admin'
                      : 'Fully settled — you\'re all caught up'}
                  </Text>
                </View>
                <Text style={styles.walletBalanceAmount}>
                  {fmt(walletDerived.wallet_balance)}
                </Text>
              </View>

              {/* Actions — settlements are initiated by the super admin from
                  the Institution Payout page; the institution-side view is
                  read-only, so we keep a single Close button. */}
              <View style={styles.walletActions}>
                <TouchableOpacity
                  onPress={() => setWalletVisible(false)}
                  style={[styles.walletAction, styles.walletActionPrimary]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.walletActionPrimaryText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        )}

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
          {/* Per-status mini summary instead of placeholder weekly bars. */}
          <View style={styles.heroFooter}>
            <Text style={styles.heroFooterText}>
              {counts.Paid} paid · {counts.Pending} pending
            </Text>
          </View>
        </View>

        {/* Two summary tiles — Paid + Pending (real numbers from /enrollments). */}
        <View style={styles.tileRow}>
          <SummaryTile
            label="Collected"
            value={fmt(totals.collected)}
            sub={`${counts.Paid} payment${counts.Paid === 1 ? '' : 's'}`}
            accent={palette.green}
            icon={CheckCircle2}
          />
          <SummaryTile
            label="Pending"
            value={fmt(totals.pending)}
            sub={`${counts.Pending} student${counts.Pending === 1 ? '' : 's'}`}
            accent={palette.orange}
            icon={Clock}
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
        {paymentsLoading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.purple.vivid} />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <Wallet size={36} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyTitle}>
              {search
                ? 'No matching payments'
                : payments.length === 0
                  ? 'No enrolments yet'
                  : `No ${tab.toLowerCase()} payments`}
            </Text>
            <Text style={styles.emptyBody}>
              {search
                ? 'Try a different search term.'
                : payments.length === 0
                  ? 'Payments will appear here once students enrol in your courses.'
                  : 'Switch tabs to see other statuses.'}
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

// One line in the wallet breakdown sheet — icon + label + small description
// on the left, monetary value on the right. `emphasize` bumps the type for
// the row that shows the headline payout amount.
function BreakdownRow({ icon: Icon, accent, label, sub, value, valueColor, emphasize }) {
  return (
    <View style={[styles.bdRow, emphasize && styles.bdRowEmphasize]}>
      <View style={[styles.bdIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bdLabel, emphasize && styles.bdLabelEmphasize]}>
          {label}
        </Text>
        {sub ? <Text style={styles.bdSub}>{sub}</Text> : null}
      </View>
      <Text
        style={[
          styles.bdValue,
          emphasize && styles.bdValueEmphasize,
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

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
  // Status meta defaults to 'pending' for any unexpected backend value (e.g.
  // 'failed' before we wire its own pill) so the row never blows up.
  const meta = STATUS_META[payment.status] || STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      {payment.photo_url ? (
        <Image source={{ uri: payment.photo_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: payment.accent.soft, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[styles.avatarInitial, { color: payment.accent.on }]}>
            {(payment.student || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

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
    gap: spacing.sm,
  },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },

  // ── Wallet teaser card (above the hero) ──────────────────────────────────
  walletTeaser: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#7C3AED', // brand violet, base of the gradient feel
    overflow: 'hidden',
    ...shadows.raised,
  },
  walletBlobA: {
    position: 'absolute',
    top: -32, right: -28,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  walletBlobB: {
    position: 'absolute',
    bottom: -40, left: -24,
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  walletTeaserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  walletTeaserIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  walletTeaserEyebrow: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  walletTeaserAmount: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  walletTeaserSubtitle: {
    color: 'rgba(255,255,255,0.80)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  walletTeaserArrow: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  walletTeaserCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  walletTeaserCtaText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Wallet breakdown modal ───────────────────────────────────────────────
  walletOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    zIndex: 99,
  },
  walletSheet: {
    width: '100%',
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.raised,
  },
  walletSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  walletSheetIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  walletSheetTitle: { ...type.h2, color: palette.text },
  walletSheetSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  walletSheetClose: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surfaceAlt,
  },

  // Breakdown rows
  bdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bdRowEmphasize: {
    backgroundColor: palette.green.soft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginTop: 4,
  },
  bdIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  bdLabel: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  bdLabelEmphasize: { color: palette.green.on, fontWeight: '800' },
  bdSub: { ...type.micro, color: palette.textLight, marginTop: 1 },
  bdValue: { ...type.bodyBold, color: palette.text, fontSize: 14, fontWeight: '700' },
  bdValueEmphasize: { color: palette.green.on, fontSize: 16, fontWeight: '800' },
  walletDivider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginVertical: spacing.sm,
  },

  walletBalanceBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.purple.soft,
    gap: spacing.md,
  },
  walletBalanceLeft: { flex: 1 },
  walletBalanceLabel: {
    ...type.caption,
    color: palette.purple.on,
    fontWeight: '700',
  },
  walletBalanceSub: {
    ...type.micro,
    color: palette.purple.on,
    opacity: 0.75,
    marginTop: 2,
  },
  walletBalanceAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: palette.purple.vivid,
    letterSpacing: -0.4,
  },

  walletActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  walletAction: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  walletActionGhost: {
    backgroundColor: palette.surfaceAlt,
  },
  walletActionGhostText: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
  },
  walletActionPrimary: {
    backgroundColor: palette.purple.vivid,
  },
  walletActionPrimaryText: {
    ...type.bodyBold,
    color: '#fff',
    fontSize: 13,
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
  heroFooter: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  heroFooterText: {
    ...type.caption,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

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
