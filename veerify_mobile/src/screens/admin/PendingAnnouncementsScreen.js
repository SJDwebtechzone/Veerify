// src/screens/admin/PendingAnnouncementsScreen.js
//
// Institution admin's review queue for trainer-submitted announcements.
// Lists every pending draft with sender + target + content, plus Approve
// and Reject actions. Approval fans out to recipients server-side.

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, RefreshControl, StyleSheet, StatusBar, Platform,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Bell, CheckCircle2, XCircle, User, Calendar,
  Users, MessageSquare, X,
} from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const GREEN       = '#10B981';
const GREEN_SOFT  = '#D1FAE5';
const AMBER       = '#F59E0B';
const AMBER_SOFT  = '#FEF3C7';
const RED         = '#EF4444';
const RED_SOFT    = '#FEE2E2';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';

// Tabs shown at the top of the screen — each maps to a `status` query
// param on /notifications/pending-approval.
const TABS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All' },
];

function statusMeta(status) {
  if (status === 'approved') return { bg: GREEN_SOFT, fg: GREEN, label: 'Approved' };
  if (status === 'rejected') return { bg: RED_SOFT,   fg: RED,   label: 'Rejected' };
  return                            { bg: AMBER_SOFT, fg: AMBER, label: 'Pending'  };
}

function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PendingAnnouncementsScreen({ navigation }) {
  const [drafts,     setDrafts]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working,    setWorking]    = useState(null);  // id currently being approved/rejected
  const [rejecting,  setRejecting]  = useState(null);  // draft being rejected (modal target)
  const [reason,     setReason]     = useState('');
  const [tab,        setTab]        = useState('pending'); // pending | approved | rejected | all
  // Cumulative counts so we can show "Pending 3" on the tabs even when
  // the user is browsing approved/rejected history. Refreshed on each
  // tab switch by re-pulling the corresponding bucket.
  const [counts,     setCounts]     = useState({ pending: 0, approved: 0, rejected: 0, all: 0 });

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/notifications/pending-approval?status=${tab}`);
      setDrafts(res?.data?.drafts || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[PendingAnnouncements] load failed:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  // Lightweight count fetch — pulls the four buckets in parallel and
  // stores their lengths so the tab badges show real numbers. Errors
  // are non-fatal; the tabs just keep their previous count.
  const loadCounts = useCallback(async () => {
    try {
      const [p, a, r, all] = await Promise.all([
        apiClient.get('/notifications/pending-approval?status=pending'),
        apiClient.get('/notifications/pending-approval?status=approved'),
        apiClient.get('/notifications/pending-approval?status=rejected'),
        apiClient.get('/notifications/pending-approval?status=all'),
      ]);
      setCounts({
        pending:  (p?.data?.drafts   || []).length,
        approved: (a?.data?.drafts   || []).length,
        rejected: (r?.data?.drafts   || []).length,
        all:      (all?.data?.drafts || []).length,
      });
    } catch (_) { /* noop */ }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    loadCounts();
  }, [load, loadCounts]));

  const approve = async (draft) => {
    if (working) return;
    setWorking(draft.id);
    try {
      const res = await apiClient.post(`/notifications/pending/${draft.id}/approve`);
      Alert.alert('Approved', `Announcement sent to ${res?.data?.sent || 0} recipients.`);
      load();
      loadCounts();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to approve');
    } finally {
      setWorking(null);
    }
  };

  const openReject = (draft) => {
    setRejecting(draft);
    setReason('');
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setWorking(rejecting.id);
    try {
      await apiClient.post(`/notifications/pending/${rejecting.id}/reject`, {
        reason: reason.trim() || null,
      });
      setRejecting(null);
      setReason('');
      load();
      loadCounts();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to reject');
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={SURFACE} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Trainer Approvals</Text>
          <Text style={styles.headerSub}>
            {tab === 'pending'
              ? (counts.pending > 0
                  ? `${counts.pending} awaiting your review`
                  : 'Nothing pending right now')
              : `Showing ${drafts.length} ${tab === 'all' ? 'in history' : tab}`}
          </Text>
        </View>
      </View>

      {/* Status tabs — switch between buckets and view full history. */}
      <View style={styles.tabsRow}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const n = counts[t.key] || 0;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => { if (tab !== t.key) { setLoading(true); setTab(t.key); } }}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
              {n > 0 ? (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>
                    {n}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={drafts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={BRAND} />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Bell size={28} color={BRAND} strokeWidth={1.8} />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === 'pending'
                ? 'All caught up'
                : tab === 'approved'
                  ? 'No approved announcements yet'
                  : tab === 'rejected'
                    ? 'No rejected announcements'
                    : 'No history yet'}
            </Text>
            <Text style={styles.emptySub}>
              {tab === 'pending'
                ? 'Trainer-submitted announcements will appear here for your review before being sent to students.'
                : 'Once a trainer submits and you decide on it, the record will show up here.'}
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => {
          const busy = working === item.id;
          const meta = statusMeta(item.status);
          const isPending = item.status === 'pending';
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('PendingAnnouncementDetail', { id: item.id })}
            >
              {/* Status pill + meta row */}
              <View style={styles.metaRow}>
                <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.statusPillText, { color: meta.fg }]}>{meta.label}</Text>
                </View>
                <View style={styles.metaPill}>
                  <User size={11} color={BRAND} strokeWidth={2.4} />
                  <Text style={styles.metaText}>{item.sender_name || 'Trainer'}</Text>
                </View>
                <View style={styles.metaPill}>
                  <Users size={11} color={BRAND} strokeWidth={2.4} />
                  <Text style={styles.metaText}>
                    {item.audience === 'institution' ? 'Whole institution' : (item.batch_name || `Batch #${item.batch_id}`)}
                  </Text>
                </View>
                <View style={styles.metaPill}>
                  <Calendar size={11} color={BRAND} strokeWidth={2.4} />
                  <Text style={styles.metaText}>{fmtRelative(item.created_at)}</Text>
                </View>
              </View>

              {/* Body */}
              <Text style={styles.title}>{item.title}</Text>
              {item.message ? <Text style={styles.message}>{item.message}</Text> : null}

              {/* Rejection reason — surface on the card itself so admins
                  can recall why they declined a draft without opening it. */}
              {item.status === 'rejected' && item.rejection_reason ? (
                <View style={styles.reasonChip}>
                  <Text style={styles.reasonChipLabel}>Reason</Text>
                  <Text style={styles.reasonChipText} numberOfLines={3}>
                    {item.rejection_reason}
                  </Text>
                </View>
              ) : null}

              {/* Actions — only for pending drafts. Decided ones are
                  read-only history (tap card → detail screen). */}
              {isPending ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnReject, busy && { opacity: 0.5 }]}
                    onPress={() => openReject(item)}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    <XCircle size={14} color={BRAND} strokeWidth={2.4} />
                    <Text style={styles.btnRejectText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnApprove, busy && { opacity: 0.6 }]}
                    onPress={() => approve(item)}
                    disabled={busy}
                    activeOpacity={0.85}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <CheckCircle2 size={14} color="#fff" strokeWidth={2.6} />
                        <Text style={styles.btnApproveText}>Approve & send</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.viewMoreHint}>Tap to view full detail →</Text>
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* Reject reason modal */}
      <Modal
        visible={!!rejecting}
        transparent
        animationType="fade"
        onRequestClose={() => setRejecting(null)}
        statusBarTranslucent
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setRejecting(null)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Reject announcement</Text>
                <Text style={styles.modalSub}>Let the trainer know why so they can iterate.</Text>
              </View>
              <TouchableOpacity onPress={() => setRejecting(null)} style={styles.modalClose} hitSlop={8}>
                <X size={16} color={TEXT} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Wording needs to be more specific about the make-up class date."
              placeholderTextColor={TEXT_LIGHT}
              multiline
              textAlignVertical="top"
              maxLength={300}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setRejecting(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnConfirmReject, working ? { opacity: 0.6 } : null]}
                onPress={confirmReject}
                disabled={!!working}
                activeOpacity={0.85}
              >
                {working ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnConfirmRejectText}>Reject</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    gap: 10,
  },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  // Tab strip — Pending / Approved / Rejected / All
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    gap: 6,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: BG,
  },
  tabActive: { backgroundColor: BRAND },
  tabText: { fontSize: 12, fontWeight: '800', color: TEXT_MUTED },
  tabTextActive: { color: '#fff' },
  tabBadge: {
    paddingHorizontal: 7, paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: '#FFF',
    minWidth: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  tabBadgeActive: { backgroundColor: '#fff', borderColor: 'transparent' },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: TEXT_MUTED },
  tabBadgeTextActive: { color: BRAND },

  // Per-card status pill (Pending / Approved / Rejected)
  statusPill: {
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // Rejection reason chip on the card
  reasonChip: {
    backgroundColor: RED_SOFT,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  reasonChipLabel: { fontSize: 10, fontWeight: '800', color: RED, letterSpacing: 0.4, textTransform: 'uppercase' },
  reasonChipText: { fontSize: 12, color: '#7F1D1D', marginTop: 3, lineHeight: 17 },

  viewMoreHint: { marginTop: 6, fontSize: 11, color: TEXT_LIGHT, fontWeight: '700' },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: BRAND_SOFT,
    borderRadius: 999,
  },
  metaText: { fontSize: 11, color: BRAND, fontWeight: '800', letterSpacing: 0.2 },

  title: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 4 },
  message: { fontSize: 13, color: TEXT, fontWeight: '500', lineHeight: 19, marginBottom: 12 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10,
  },
  btnReject: { backgroundColor: BRAND_SOFT, borderWidth: 1, borderColor: BRAND },
  btnRejectText: { fontSize: 13, fontWeight: '800', color: BRAND },
  btnApprove: { backgroundColor: GREEN },
  btnApproveText: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // Empty state
  emptyCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 4 },
  emptySub: { fontSize: 12, color: TEXT_MUTED, fontWeight: '500', textAlign: 'center', lineHeight: 17 },

  // ── Reject reason modal ───────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 18,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  modalSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },
  modalClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  modalLabel: { fontSize: 11, fontWeight: '800', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  modalInput: {
    minHeight: 90,
    backgroundColor: BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    color: TEXT,
    fontWeight: '500',
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 14,
  },
  modalActions: { flexDirection: 'row', gap: 8 },
  btnGhost: { backgroundColor: BG },
  btnGhostText: { fontSize: 13, fontWeight: '700', color: TEXT },
  btnConfirmReject: { backgroundColor: BRAND },
  btnConfirmRejectText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});
