// src/screens/admin/AdminTrainerLeavesScreen.js
//
// Institution admin's approval queue for trainer-from-work leave requests.
//
// Layout:
//   1. Header — back, "Trainer Leaves" title, total count pill.
//   2. Counters strip — Pending / Approved / Rejected.
//   3. Filter chips — Pending (default) / Approved / Rejected / All.
//   4. List of leave cards. Pending cards expose Approve / Reject buttons.
//      Reviewed cards show the reviewer name + reviewed date + note.
//
// Data:
//   GET  /api/trainer-leave-requests?status=...
//   POST /api/trainer-leave-requests/:id/approve
//   POST /api/trainer-leave-requests/:id/reject

import React, { createContext, useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, ClipboardList, Check, X as XIcon, Clock,
  User, FileText, MessageCircle, Calendar,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
// Shared circular avatar — enforces square container, overflow
// hidden, resizeMode=cover, and centered placement so the face stays
// visible instead of being shifted / clipped by a raw <Image>.
import Avatar from '../../components/Avatar';
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
const TrainerLeavesCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:        { backgroundColor: pal.bg },
    header:        { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle:   { color: pal.text },
    headerSubtitle:{ color: pal.textMuted },
    iconBtn:       { backgroundColor: pal.border },
    card:          { backgroundColor: pal.surface, borderColor: pal.border },
    countersCard:  { backgroundColor: pal.surface, borderColor: pal.border },
    countersLabel: { color: pal.textMuted },
    filterChip:    { backgroundColor: pal.surface, borderColor: pal.border },
    filterChipText:{ color: pal.text },
    listCard:      { backgroundColor: pal.surface, borderColor: pal.border },
    trainerName:   { color: pal.text },
    label:         { color: pal.textMuted },
    value:         { color: pal.text },
  });
}

const STATUS_META = {
  pending:  { label: 'Pending',  color: palette.orange.vivid, bg: palette.orange.soft, icon: Clock },
  approved: { label: 'Approved', color: palette.green.vivid,  bg: palette.green.soft,  icon: Check },
  rejected: { label: 'Rejected', color: palette.rose.vivid,   bg: palette.rose.soft,   icon: XIcon },
};

function isoDay(s) { return String(s || '').slice(0, 10); }
function fmtRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  const same = isoDay(start) === isoDay(end);
  if (same) return s.toLocaleDateString(undefined, opts);
  return `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString(undefined, opts)}`;
}
function daysBetween(start, end) {
  const s = new Date(isoDay(start));
  const e = new Date(isoDay(end));
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}
function resolveAvatar(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Backend stores `/uploads/...`; the apiClient is configured to talk to the
  // same origin so we can usually prepend its baseURL.
  const base = apiClient?.defaults?.baseURL?.replace(/\/api\/?$/, '') || '';
  return base + url;
}

export default function AdminTrainerLeavesScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(
        `/trainer-leave-requests${filter !== 'all' ? `?status=${filter}` : ''}`,
      );
      setItems(res.data?.leave_requests || []);
      setCounts(res.data?.counts || { pending: 0, approved: 0, rejected: 0, total: 0 });
    } catch (err) {
      console.log('[AdminTrainerLeaves] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async (id, decision) => {
    setBusyId(id);
    try {
      const res = await apiClient.post(`/trainer-leave-requests/${id}/${decision}`, {});
      console.log('[AdminTrainerLeaves] decide OK', decision, id, res?.data);
      await load();
    } catch (err) {
      // Show as much info as we can pull off the error so the failure mode
      // is obvious — common ones: 401 (token), 403 (institution mismatch),
      // 404 (id), 409 (already decided), network error.
      const status = err?.response?.status;
      const body   = err?.response?.data;
      const msg    = body?.message || err?.message || 'Unknown error';
      console.log('[AdminTrainerLeaves] decide FAIL', decision, id, status, body);
      Alert.alert(
        decision === 'approve' ? 'Approve failed' : 'Reject failed',
        `Status: ${status || 'no-response'}\n${msg}\n\nLeave id: ${id}`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const onApprove = (item) => {
    Alert.alert(
      'Approve leave?',
      `${item.trainer_name} — ${fmtRange(item.start_date, item.end_date)} (${daysBetween(item.start_date, item.end_date)} day${daysBetween(item.start_date, item.end_date) === 1 ? '' : 's'})`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => decide(item.id, 'approve') },
      ],
    );
  };

  const onReject = (item) => {
    Alert.alert(
      'Reject leave?',
      `${item.trainer_name} — ${fmtRange(item.start_date, item.end_date)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => decide(item.id, 'reject') },
      ],
    );
  };

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <TrainerLeavesCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}

      {/* Header */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, isDark && dark.iconBtn]} activeOpacity={0.7}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : HEADER_NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Trainer Leaves</Text>
          <Text style={[styles.headerSubtitle, isDark && dark.headerSubtitle]}>
            {counts.total} total · {counts.pending} pending
          </Text>
        </View>
        <View style={[styles.headerIcon, { backgroundColor: BRAND_ACCENT_SOFT }]}>
          <ClipboardList size={18} color={BRAND_DARK_BLUE} />
        </View>
      </View>

      {/* Counts strip */}
      <View style={styles.countsRow}>
        <CountPill label="Pending"  value={counts.pending}  color={palette.orange.vivid} bg={palette.orange.soft} />
        <CountPill label="Approved" value={counts.approved} color={palette.green.vivid}  bg={palette.green.soft} />
        <CountPill label="Rejected" value={counts.rejected} color={palette.rose.vivid}   bg={palette.rose.soft} />
      </View>

      {/* Filter chips */}
      <View style={styles.chipsRow}>
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f && styles.chipActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
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
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.purple.vivid} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileText size={28} color={palette.textLight} />
            <Text style={styles.emptyTitle}>
              {filter === 'pending'
                ? 'No pending requests'
                : filter === 'approved'
                  ? 'No approved requests yet'
                  : filter === 'rejected'
                    ? 'No rejected requests'
                    : 'No leave requests yet'}
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <LeaveCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onApprove={() => onApprove(item)}
              onReject={() => onReject(item)}
            />
          ))
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
    </TrainerLeavesCtx.Provider>
  );
}

function CountPill({ label, value, color, bg }) {
  return (
    <View style={[styles.countPill, { backgroundColor: bg }]}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={[styles.countLabel, { color }]}>{label}</Text>
    </View>
  );
}

function LeaveCard({ item, busy, onApprove, onReject }) {
  const meta = STATUS_META[item.status] || STATUS_META.pending;
  const StatusIcon = meta.icon;
  const days = daysBetween(item.start_date, item.end_date);
  const photoUrl = resolveAvatar(item.trainer_photo_url);

  return (
    <View style={styles.card}>
      {/* Trainer row */}
      <View style={styles.cardTop}>
        <Avatar
          uri={photoUrl}
          name={item.trainer_name}
          size={38}
          tone="slate"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.trainerName}>{item.trainer_name || 'Trainer'}</Text>
          {item.trainer_skills ? (
            <Text style={styles.trainerMeta} numberOfLines={1}>{item.trainer_skills}</Text>
          ) : null}
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <StatusIcon size={12} color={meta.color} strokeWidth={2.4} />
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Date range */}
      <View style={styles.row}>
        <Calendar size={13} color={palette.textLight} />
        <Text style={styles.rowText}>{fmtRange(item.start_date, item.end_date)}</Text>
        <View style={styles.daysPill}>
          <Text style={styles.daysPillText}>{days}d</Text>
        </View>
      </View>

      {/* Reason */}
      {item.reason ? (
        <View style={styles.row}>
          <FileText size={13} color={palette.textLight} />
          <Text style={styles.rowText}>{item.reason}</Text>
        </View>
      ) : null}

      {/* Reviewer note */}
      {item.review_note ? (
        <View style={styles.row}>
          <MessageCircle size={13} color={palette.textLight} />
          <Text style={styles.rowText}>
            <Text style={styles.rowLabel}>Note: </Text>{item.review_note}
          </Text>
        </View>
      ) : null}

      {/* Reviewer meta */}
      {item.reviewed_by_name ? (
        <Text style={styles.metaLine}>
          Reviewed by {item.reviewed_by_name}
          {item.reviewed_at ? ` · ${new Date(item.reviewed_at).toLocaleDateString()}` : ''}
        </Text>
      ) : null}

      {/* Action buttons - pending only */}
      {item.status === 'pending' ? (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={onReject}
            disabled={busy}
            style={[styles.actionBtn, styles.rejectBtn, busy && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            <XIcon size={14} color={palette.rose.vivid} strokeWidth={2.4} />
            <Text style={[styles.actionText, { color: palette.rose.vivid }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onApprove}
            disabled={busy}
            style={[styles.actionBtn, styles.approveBtn, busy && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Check size={14} color="#fff" strokeWidth={2.4} />
                <Text style={[styles.actionText, { color: '#fff' }]}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Institution Home ambient page base — the wash SVG paints on top.
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  // Header — glass slab with navy title and a soft blue lift shadow.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1,
    borderBottomColor: GLASS_BORDER_LIGHT,
    gap: 12,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1, fontWeight: '600' },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },

  countsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  countPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  countValue: { fontSize: 18, fontWeight: '800' },
  countLabel: { fontSize: 10, fontWeight: '700', marginTop: 1, letterSpacing: 0.4 },

  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.surfaceAlt,
  },
  chipActive: { backgroundColor: palette.purple.vivid },
  chipText: { fontSize: 12, fontWeight: '600', color: palette.textLight },
  chipTextActive: { color: '#fff' },

  scrollContent: { padding: spacing.xl },

  loading: { paddingVertical: 32, alignItems: 'center' },

  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl + 6,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: palette.dark, marginTop: 4 },

  // Leave card — translucent glass fill + light glass border +
  // soft blue lift shadow so each card reads as a glass panel on
  // the Institution Home ambient wash.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: {
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  trainerName: { fontSize: 14, fontWeight: '700', color: palette.dark },
  trainerMeta: { fontSize: 11, color: palette.textLight, marginTop: 1 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999, gap: 4,
  },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  rowText: { flex: 1, fontSize: 12, color: palette.text },
  rowLabel: { fontWeight: '700', color: palette.textLight },
  daysPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
  },
  daysPillText: { fontSize: 10, fontWeight: '700', color: palette.purple.vivid },

  metaLine: { fontSize: 11, color: palette.textLight, marginTop: 6 },

  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    gap: 6,
  },
  rejectBtn: {
    backgroundColor: palette.rose.soft,
    borderWidth: 1,
    borderColor: palette.rose.vivid,
  },
  approveBtn: { backgroundColor: palette.green.vivid },
  actionText: { fontSize: 13, fontWeight: '700' },
});
