// src/screens/staff/StaffLeaveRequestsScreen.js
//
// Step 6 of the Staff module - leave requests review queue.
//
// Layout:
//   1. Header  back, "Leave Requests" title, count pill.
//   2. Counters strip - Pending / Approved / Rejected mini-cards.
//   3. Filter chips - All / Pending / Approved / Rejected.
//   4. List of leave cards. Pending cards have Approve / Reject buttons.
//      Reviewed cards show the reviewer name + reviewed-at date.
//
// Data:
//   GET  /api/leave-requests/trainer/my?status=...
//   POST /api/leave-requests/:id/approve
//   POST /api/leave-requests/:id/reject

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import {
  ArrowLeft, ClipboardList, Calendar, Check, X as XIcon, Clock,
  User, FileText, ChevronRight,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  pending:  { label: 'Pending',  color: palette.orange.vivid, bg: palette.orange.soft, on: palette.orange.on, icon: Clock },
  approved: { label: 'Approved', color: palette.green.vivid,  bg: palette.green.soft,  on: palette.green.on,  icon: Check },
  rejected: { label: 'Rejected', color: palette.rose.vivid,   bg: palette.rose.soft,   on: palette.rose.on,   icon: XIcon },
};

function isoDay(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}
function fmtRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const same = isoDay(start) === isoDay(end);
  const opts = { day: 'numeric', month: 'short' };
  if (same) return s.toLocaleDateString(undefined, { ...opts, year: 'numeric' });
  return `${s.toLocaleDateString(undefined, opts)} -> ${e.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}
function daysBetween(start, end) {
  const s = new Date(isoDay(start));
  const e = new Date(isoDay(end));
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

export default function StaffLeaveRequestsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [filter, setFilter] = useState('pending'); // 'all' | 'pending' | 'approved' | 'rejected'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null); // id currently being approved/rejected

  const load = useCallback(async () => {
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await apiClient.get(`/leave-requests/trainer/my${qs}`)
        .catch(() => ({ data: { leave_requests: [], counts: { pending:0, approved:0, rejected:0, total:0 } } }));
      setItems(res.data?.leave_requests || []);
      if (res.data?.counts) setCounts(res.data.counts);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const onApprove = (lr) => {
    Alert.alert(
      'Approve leave request?',
      `${lr.student_name} - ${fmtRange(lr.start_date, lr.end_date)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setBusyId(lr.id);
            try {
              await apiClient.post(`/leave-requests/${lr.id}/approve`);
              await load();
            } catch (err) {
              Alert.alert('Could not approve', err.response?.data?.message || err.message || 'Try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };
  const onReject = (lr) => {
    Alert.alert(
      'Reject leave request?',
      `${lr.student_name} - ${fmtRange(lr.start_date, lr.end_date)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setBusyId(lr.id);
            try {
              await apiClient.post(`/leave-requests/${lr.id}/reject`);
              await load();
            } catch (err) {
              Alert.alert('Could not reject', err.response?.data?.message || err.message || 'Try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Leave Requests</Text>
          <Text style={styles.headerSub}>
            {counts.pending > 0
              ? `${counts.pending} pending your review`
              : 'You\'re all caught up.'}
          </Text>
        </View>
        <View style={styles.headerCountPill}>
          <ClipboardList size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerCountText}>{counts.total}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Counter strip */}
        <View style={styles.counterStrip}>
          {(['pending','approved','rejected']).map((k) => {
            const meta = STATUS_META[k];
            const Icon = meta.icon;
            return (
              <View key={k} style={[styles.counterTile, { backgroundColor: meta.bg }]}>
                <Icon size={14} color={meta.on} strokeWidth={2.4} />
                <Text style={[styles.counterValue, { color: meta.on }]}>{counts[k] || 0}</Text>
                <Text style={[styles.counterLabel, { color: meta.on }]}>{meta.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Filter chips */}
        <View style={styles.filterRow}>
          {['all', 'pending', 'approved', 'rejected'].map((k) => {
            const active = filter === k;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(k)}
                activeOpacity={0.85}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {k === 'all' ? 'All' : STATUS_META[k].label}
                </Text>
                <Text style={[styles.filterChipCount, active && styles.filterChipCountActive]}>
                  {k === 'all' ? counts.total : counts[k] || 0}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* List */}
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <ClipboardList size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {filter === 'pending' ? 'No pending requests' : 'No leave requests yet'}
            </Text>
            <Text style={styles.emptySub}>
              {filter === 'pending'
                ? 'New requests from students or parents will show up here.'
                : 'Once requests start coming in, you\'ll see them here.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md, marginTop: spacing.md }}>
            {items.map((lr) => (
              <LeaveCard
                key={lr.id}
                lr={lr}
                busy={busyId === lr.id}
                onApprove={() => onApprove(lr)}
                onReject={() => onReject(lr)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────
function LeaveCard({ lr, busy, onApprove, onReject }) {
  const meta = STATUS_META[lr.status] || STATUS_META.pending;
  const StatusIcon = meta.icon;
  const initials = (lr.student_name || 'S').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const days = daysBetween(lr.start_date, lr.end_date);

  return (
    <View style={[styles.card, lr.status === 'pending' && { borderLeftWidth: 3, borderLeftColor: meta.color }]}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>{lr.student_name || 'Student'}</Text>
          <View style={styles.studentMetaRow}>
            <User size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.studentMeta}>
              Requested by {lr.requested_by_name || 'student'}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
          <StatusIcon size={11} color={meta.on} strokeWidth={2.4} />
          <Text style={[styles.statusBadgeText, { color: meta.on }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Dates */}
      <View style={styles.datesRow}>
        <View style={styles.datesIcon}>
          <Calendar size={13} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.datesLabel}>Leave dates</Text>
          <Text style={styles.datesValue}>{fmtRange(lr.start_date, lr.end_date)}</Text>
        </View>
        <View style={styles.daysPill}>
          <Text style={styles.daysPillText}>{days} {days === 1 ? 'day' : 'days'}</Text>
        </View>
      </View>

      {/* Reason */}
      {lr.reason ? (
        <View style={styles.reasonBox}>
          <FileText size={12} color={palette.textMuted} strokeWidth={2.4} />
          <Text style={styles.reasonText}>{lr.reason}</Text>
        </View>
      ) : null}

      {/* Batch line */}
      {lr.batch_name ? (
        <Text style={styles.batchLine}>Batch: <Text style={styles.batchLineBold}>{lr.batch_name}</Text></Text>
      ) : null}

      {/* Footer / actions */}
      {lr.status === 'pending' ? (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionReject, busy && { opacity: 0.6 }]}
            onPress={onReject}
            disabled={busy}
            activeOpacity={0.85}
          >
            <XIcon size={14} color={palette.rose.on} strokeWidth={2.6} />
            <Text style={[styles.actionText, { color: palette.rose.on }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionApprove, busy && { opacity: 0.6 }]}
            onPress={onApprove}
            disabled={busy}
            activeOpacity={0.9}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={14} color="#fff" strokeWidth={2.6} />
                <Text style={[styles.actionText, { color: '#fff' }]}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.reviewedRow}>
          <Text style={styles.reviewedText}>
            {meta.label} by {lr.reviewed_by_name || 'staff'}
            {lr.reviewed_at ? ` on ${new Date(lr.reviewed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

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
  headerCountPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  headerCountText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Counter strip
  counterStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  counterTile: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: 4,
  },
  counterValue: { ...type.h1, fontSize: 20 },
  counterLabel: { ...type.micro, fontWeight: '800', letterSpacing: 0.5 },

  // Filter row
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  filterChipActive: { backgroundColor: palette.text, borderColor: palette.text },
  filterChipText: { ...type.caption, color: palette.text, fontWeight: '700' },
  filterChipTextActive: { color: '#fff' },
  filterChipCount: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.borderSoft,
    minWidth: 22, textAlign: 'center',
  },
  filterChipCountActive: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.18)' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  studentName: { ...type.bodyBold, color: palette.text },
  studentMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  studentMeta: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusBadgeText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Dates
  datesRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  datesIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  datesLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  datesValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  daysPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  daysPillText: { ...type.micro, color: palette.text, fontWeight: '800' },

  // Reason
  reasonBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  reasonText: { flex: 1, ...type.caption, color: palette.text, lineHeight: 18 },

  batchLine: { ...type.caption, color: palette.textMuted, marginTop: spacing.sm },
  batchLineBold: { color: palette.text, fontWeight: '700' },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  actionReject: { backgroundColor: palette.rose.soft, borderWidth: 1, borderColor: palette.rose.vivid },
  actionApprove: { backgroundColor: palette.green.vivid },
  actionText: { ...type.bodyBold, fontWeight: '800' },

  reviewedRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  reviewedText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
