// src/screens/admin/AdminReferEarnScreen.js
//
// Institution admin's Refer & Earn dashboard. Pulls one consolidated
// snapshot from /api/referrals/me and renders the six spec sections:
// promo banner, code card, summary stats, recent referrals, next-renewal
// preview, and the transactions ledger.

import React, { createContext, useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Share, TextInput,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Gift, Copy, Share2, Users, Star, Wallet, Clock,
  CheckCircle2, AlertCircle, TrendingUp, RefreshCw, Plus, Tag,
} from 'lucide-react-native';
// We avoid a Clipboard dependency by routing Copy through the system Share
// sheet too — Share's "Copy" option puts the text on the clipboard.

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const ReferEarnCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:         { backgroundColor: pal.bg },
    header:         { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle:    { color: pal.text },
    headerSubtitle: { color: pal.textMuted },
    backBtn:        { backgroundColor: pal.border },
    card:           { backgroundColor: pal.surface, borderColor: pal.border },
    codeCard:       { backgroundColor: pal.surface, borderColor: pal.border },
    banner:         { backgroundColor: pal.surface, borderColor: pal.border },
    statCard:       { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:   { color: pal.text },
    sectionSubtitle:{ color: pal.textMuted },
    label:          { color: pal.textMuted },
    value:          { color: pal.text },
  });
}

const STATUS_PILLS = {
  pending:   { label: 'Pending',   bg: '#FEF3C7', fg: '#92400E' },
  completed: { label: 'Completed', bg: '#DBEAFE', fg: '#1E40AF' },
  credited:  { label: 'Credited',  bg: '#DCFCE7', fg: '#166534' },
  expired:   { label: 'Expired',   bg: '#FEE2E2', fg: '#991B1B' },
};

const TX_META = {
  earned:  { label: '+', color: '#16A34A' },
  used:    { label: '−', color: '#DC2626' },
  expired: { label: '−', color: '#6B7280' },
};

const fmtPts   = (n) => `${n >= 0 ? '' : ''}${Number(n || 0).toLocaleString('en-IN')}`;
const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate  = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function AdminReferEarnScreen({ navigation }) {
  // Theme hooks — MUST live above any early-return so hook order
  // stays stable across renders (React reported "Rendered more
  // hooks than during the previous render" when these lived after
  // the loading branch).
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  const [data,    setData]    = useState(null);
  const [history, setHistory] = useState([]);
  const [txs,     setTxs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Post-hoc "apply someone else's code". Useful for institutions that
  // already signed up without entering a code on PlanSelection. The
  // backend rejects after first payment so we hide the panel once paid.
  const [applyCode,   setApplyCode]   = useState('');
  const [applying,    setApplying]    = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, hRes, tRes] = await Promise.all([
        apiClient.get('/referrals/me'),
        apiClient.get('/referrals/history').catch(() => ({ data: { referrals: [] } })),
        apiClient.get('/referrals/transactions').catch(() => ({ data: { transactions: [] } })),
      ]);
      setData(meRes.data || null);
      setHistory(hRes.data?.referrals || []);
      setTxs(tRes.data?.transactions || []);
    } catch (err) {
      console.log('[ReferEarn] load failed:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onCopy = async () => {
    if (!data?.referral_code) return;
    // Open the system share sheet with JUST the code, so the user can pick
    // "Copy" or paste straight into a chat. Saves us an extra dependency.
    try {
      await Share.share({ message: data.referral_code });
    } catch {}
  };

  const onShare = async () => {
    if (!data?.referral_code) return;
    try {
      await Share.share({
        message:
          `Join me on Veerify and supercharge your martial-arts academy. ` +
          `Use my referral code ${data.referral_code} when you pick a plan to thank me — ` +
          `we both win.`,
      });
    } catch {}
  };

  const onRegenerate = () => {
    Alert.alert(
      'Generate a new code?',
      'Your current referral code will stop working immediately. Anyone you sent the old code to won\'t be able to use it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', style: 'destructive', onPress: async () => {
          setRegenerating(true);
          try {
            await apiClient.post('/referrals/regenerate-code', {});
            await load();
          } catch (err) {
            Alert.alert('Could not regenerate', err?.response?.data?.message || err.message);
          } finally {
            setRegenerating(false);
          }
        }},
      ],
    );
  };

  // Submit someone else's code so the referrer earns points on our first
  // payment. The backend handles all anti-abuse: self-referral, duplicate
  // apply, already-paid account.
  const onApply = async () => {
    const code = applyCode.trim().toUpperCase();
    if (!code) {
      Alert.alert('Enter a code', 'Paste the referral code shared with you.');
      return;
    }
    setApplying(true);
    try {
      await apiClient.post('/referrals/apply', { code });
      setApplyCode('');
      Alert.alert(
        'Code applied',
        'Thanks! Your referrer will earn points when your first subscription payment is completed.',
      );
      await load();
    } catch (err) {
      Alert.alert(
        'Could not apply code',
        err?.response?.data?.message || err?.message || 'Please double-check the code and try again.',
      );
    } finally {
      setApplying(false);
    }
  };

  if (loading || !data) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={palette.purple.vivid} />
      </View>
    );
  }

  const wallet     = data.wallet   || {};
  const summary    = data.summary  || {};
  const nextRenew  = data.next_renewal || {};
  const settings   = data.settings || {};

  // Theme hooks live at the top of the component so hook order
  // stays stable across renders (see the top of the file).
  return (
    <ReferEarnCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}

      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, isDark && dark.backBtn]}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : HEADER_NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Refer & Earn</Text>
          <Text style={[styles.headerSubtitle, isDark && dark.headerSubtitle]}>Invite institutions, earn discounts</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* ── Section 1: Promo banner ── */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerBlobA} />
          <View style={styles.bannerBlobB} />
          <View style={styles.bannerIcon}>
            <Gift size={22} color="#fff" strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Invite. Earn. Renew for less.</Text>
            <Text style={styles.bannerSub}>
              {settings.points_per_referral || 500} points for every academy you bring on board.
              {' '}1 point = ₹{Number(settings.rupees_per_point || 1).toFixed(0)}.
            </Text>
          </View>
        </View>

        {/* ── Section 2: Referral code ── */}
        <SectionTitle>Your referral code</SectionTitle>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>REFERRAL CODE</Text>
          <Text style={styles.codeValue}>{data.referral_code}</Text>
          <View style={styles.codeActions}>
            <TouchableOpacity onPress={onCopy} style={[styles.codeBtn, styles.codeBtnGhost]} activeOpacity={0.85}>
              <Copy size={14} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={[styles.codeBtnText, { color: palette.purple.vivid }]}>Copy code</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onShare} style={[styles.codeBtn, styles.codeBtnPrimary]} activeOpacity={0.85}>
              <Share2 size={14} color="#fff" strokeWidth={2.4} />
              <Text style={[styles.codeBtnText, { color: '#fff' }]}>Share invite</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onRegenerate} disabled={regenerating} style={styles.regenLink}>
            {regenerating ? (
              <ActivityIndicator size="small" color={palette.textLight} />
            ) : (
              <>
                <RefreshCw size={11} color={palette.textLight} strokeWidth={2.4} />
                <Text style={styles.regenText}>Regenerate code</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Note: the "Got a code from another institution?" apply-code
            card has been removed by product decision. Apply-code is now
            only surfaced during the initial plan selection / signup
            flow, not on the running dashboard. */}

        {/* ── Section 3: Summary ── */}
        <SectionTitle>Referral summary</SectionTitle>
        <View style={styles.statsGrid}>
          <StatCard
            icon={Users}
            label="Total Referrals"
            value={summary.total_referrals || 0}
            accent={palette.purple}
          />
          <StatCard
            icon={Star}
            label="Referral Points"
            value={fmtPts(wallet.points_balance || 0)}
            accent={palette.orange}
          />
          <StatCard
            icon={Wallet}
            label="Available Discount"
            value={fmtMoney(summary.available_discount_rupees || 0)}
            accent={palette.green}
          />
          <StatCard
            icon={Clock}
            label="Pending Rewards"
            value={summary.pending_count || 0}
            accent={palette.blue}
          />
        </View>

        {/* ── Section 5: Next renewal preview ── */}
        <SectionTitle>Next subscription</SectionTitle>
        <View style={styles.renewCard}>
          <RenewLine label="Plan amount"        value={fmtMoney(nextRenew.plan_price || 0)} />
          <RenewLine label="Referral discount"  value={`− ${fmtMoney(nextRenew.referral_discount || 0)}`} negative />
          <View style={styles.renewDivider} />
          <RenewLine label="Final payable"      value={fmtMoney(nextRenew.final_payable || 0)} bold />
        </View>

        {/* ── Section 4: Recent referrals ── */}
        <SectionTitle>Recent referrals</SectionTitle>
        {history.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertCircle size={20} color={palette.textLight} />
            <Text style={styles.emptyText}>
              Nobody has used your code yet. Share it to start earning!
            </Text>
          </View>
        ) : (
          history.map((r) => (
            <ReferralRow key={r.id} item={r} />
          ))
        )}

        {/* ── Section 6: Transactions ── */}
        <SectionTitle>Referral transactions</SectionTitle>
        {txs.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertCircle size={20} color={palette.textLight} />
            <Text style={styles.emptyText}>No referral activity yet.</Text>
          </View>
        ) : (
          txs.map((t) => <TransactionRow key={t.id} item={t} />)
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
    </ReferEarnCtx.Provider>
  );
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <View style={[styles.statCard, { borderColor: accent.soft }]}>
      <View style={[styles.statIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RenewLine({ label, value, bold, negative }) {
  return (
    <View style={styles.renewLine}>
      <Text style={[styles.renewLabel, bold && styles.renewLabelBold]}>{label}</Text>
      <Text
        style={[
          styles.renewValue,
          bold && styles.renewValueBold,
          negative && { color: palette.green.vivid },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ReferralRow({ item }) {
  const pill = STATUS_PILLS[item.status] || STATUS_PILLS.pending;
  return (
    <View style={styles.referralRow}>
      <View style={styles.referralAvatar}>
        <Text style={styles.referralAvatarText}>
          {(item.referred_name || '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.referralName} numberOfLines={1}>
          {item.referred_name || '—'}
        </Text>
        <Text style={styles.referralMeta}>
          Joined {fmtDate(item.referred_signed_up_at || item.created_at)}
        </Text>
        <Text style={styles.referralPoints}>
          Reward: {item.reward_points || 0} pts
        </Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
        <Text style={[styles.statusText, { color: pill.fg }]}>{pill.label}</Text>
      </View>
    </View>
  );
}

function TransactionRow({ item }) {
  const meta = TX_META[item.type] || { label: '', color: palette.textLight };
  const points = Number(item.points || 0);
  return (
    <View style={styles.txRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.txDesc} numberOfLines={2}>{item.description}</Text>
        <Text style={styles.txMeta}>{fmtDate(item.created_at)}</Text>
      </View>
      <Text style={[styles.txPoints, { color: meta.color }]}>
        {points >= 0 ? '+' : ''}{points} pts
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Institution Home ambient page base — the wash SVG paints on top.
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  // Header — glass slab with navy title and soft blue lift shadow.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48, paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1, fontWeight: '600' },

  scrollContent: { padding: spacing.xl },

  // Banner
  bannerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderRadius: radius.xl,
    backgroundColor: '#7C3AED',
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadows.raised,
  },
  bannerBlobA: {
    position: 'absolute', top: -30, right: -20,
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  bannerBlobB: {
    position: 'absolute', bottom: -40, left: -20,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bannerIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  bannerSub:   { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 2, lineHeight: 17 },

  sectionTitle: {
    fontSize: 12, color: palette.textLight, fontWeight: '800',
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: 8,
  },

  // Code card — translucent glass fill + light glass border + soft
  // blue lift shadow so the code chip reads as a glass panel on
  // the Institution Home ambient wash.
  codeCard: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  codeLabel: {
    fontSize: 10, color: palette.textLight, fontWeight: '800',
    letterSpacing: 0.6,
  },
  codeValue: {
    fontSize: 24, fontWeight: '800', color: palette.purple.vivid,
    letterSpacing: 1.2, marginTop: 4, marginBottom: 14,
  },
  codeActions: { flexDirection: 'row', gap: 8 },
  codeBtn: {
    flex: 1, paddingVertical: 11,
    borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  codeBtnGhost: { backgroundColor: palette.purple.soft },
  codeBtnPrimary: { backgroundColor: palette.purple.vivid },
  codeBtnText: { fontSize: 13, fontWeight: '800' },
  regenLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, marginTop: 10,
  },
  regenText: { fontSize: 11, color: palette.textLight, fontWeight: '700' },

  // Apply-someone-else's-code panel
  applyCard: {
    backgroundColor: palette.green.soft,
    borderRadius: radius.lg,
    padding: 14,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: palette.green.vivid + '33',
  },
  applyHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  applyTitle: {
    fontSize: 13, fontWeight: '800', color: palette.green.on,
  },
  applyHint: {
    fontSize: 11, color: palette.green.on, opacity: 0.85,
    marginTop: 4, marginBottom: 10,
  },
  applyRow: { flexDirection: 'row', gap: 8 },
  applyInput: {
    flex: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    fontSize: 14, color: palette.dark,
    letterSpacing: 1.2, fontWeight: '700',
  },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingHorizontal: 14,
    backgroundColor: palette.green.vivid,
    borderRadius: radius.md,
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Stats grid (2 cols)
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  statCard: {
    width: '48%',
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    // Soft blue lift shadow so each stat tile reads as a glass
    // panel on the Institution Home ambient wash. `borderColor`
    // is left to the caller so each accent tile keeps its tone.
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: { fontSize: 18, fontWeight: '800', color: palette.dark },
  statLabel: { fontSize: 11, color: palette.textLight, marginTop: 2 },

  // Renew preview — matches the other Institution Home glass
  // cards on this screen.
  renewCard: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  renewLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 6,
  },
  renewLabel: { fontSize: 13, color: palette.textLight, fontWeight: '600' },
  renewLabelBold: { color: palette.dark, fontWeight: '800' },
  renewValue: { fontSize: 14, color: palette.dark, fontWeight: '700' },
  renewValueBold: { fontSize: 18, color: palette.purple.vivid, fontWeight: '800' },
  renewDivider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: 4 },

  // Empty card
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  emptyText: { flex: 1, fontSize: 12, color: palette.textLight },

  // Referral row
  referralRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 8,
  },
  referralAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  referralAvatarText: { color: palette.purple.vivid, fontWeight: '800' },
  referralName: { fontSize: 14, fontWeight: '700', color: palette.dark },
  referralMeta: { fontSize: 11, color: palette.textLight, marginTop: 1 },
  referralPoints: { fontSize: 11, color: palette.green.vivid, fontWeight: '700', marginTop: 2 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  // Transactions
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 6,
  },
  txDesc: { fontSize: 13, color: palette.dark, fontWeight: '600' },
  txMeta: { fontSize: 11, color: palette.textLight, marginTop: 2 },
  txPoints: { fontSize: 14, fontWeight: '800' },
});
