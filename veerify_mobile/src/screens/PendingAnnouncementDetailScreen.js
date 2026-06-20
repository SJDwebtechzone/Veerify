// src/screens/PendingAnnouncementDetailScreen.js
//
// Detail view for a single trainer-submitted announcement draft.
//
// Used by two roles, same screen:
//   • Admin  — opens by tapping a "Trainer announcement awaiting
//     approval" notification, or by tapping a row in
//     PendingAnnouncementsScreen. Sees Approve + Reject buttons when
//     the draft is still pending.
//   • Trainer — opens by tapping the "Announcement approved" or
//     "Announcement rejected" notification. Sees status + decision
//     metadata; no action buttons.
//
// Route param: { id }   (the pending_announcements row id)

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, Modal, TextInput, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Megaphone, User, Users, Building2, Clock,
  CheckCircle2, XCircle, ShieldCheck, MessageSquare, Send, X as XIcon,
  AlertTriangle,
} from 'lucide-react-native';

import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';

// ─── Theme ─────────────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';
const GREEN_SOFT = '#D1FAE5';
const AMBER = '#F59E0B';
const AMBER_SOFT = '#FEF3C7';
const RED = '#EF4444';
const RED_SOFT = '#FEE2E2';

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function PendingAnnouncementDetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const draftId = route?.params?.id ?? route?.params?.draft_id;
  const isAdmin = user?.role === 'admin';

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  // Reject reason modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const fetchDraft = useCallback(async () => {
    if (!draftId) {
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get(`/notifications/pending/${draftId}`);
      setDraft(res.data?.draft || null);
    } catch (err) {
      console.log('[PendingDetail] fetch failed:', err?.response?.data || err?.message);
      Alert.alert(
        'Cannot load announcement',
        err?.response?.data?.message || 'Please try again.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [draftId]);

  useEffect(() => { fetchDraft(); }, [fetchDraft]);

  const onApprove = () => {
    Alert.alert(
      'Approve and send?',
      `This will deliver "${draft.title}" to ${draft.recipient_count || 0} ${draft.recipient_count === 1 ? 'recipient' : 'recipients'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve & send',
          onPress: async () => {
            setActing(true);
            try {
              const r = await apiClient.post(`/notifications/pending/${draftId}/approve`);
              Alert.alert(
                'Sent',
                `Delivered to ${r.data?.sent || 0} recipient${r.data?.sent === 1 ? '' : 's'}.`,
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (err) {
              Alert.alert('Approve failed', err?.response?.data?.message || 'Please try again.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  };

  const onReject = async () => {
    setActing(true);
    try {
      await apiClient.post(`/notifications/pending/${draftId}/reject`, {
        reason: reason.trim() || null,
      });
      setRejectOpen(false);
      Alert.alert(
        'Rejected',
        'The trainer has been notified.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Reject failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      setActing(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  // ── Not-found / no-permission ───────────────────────────────────────
  if (!draft) {
    return (
      <View style={styles.screen}>
        <Header onBack={() => navigation.goBack()} title="Announcement" />
        <View style={styles.emptyState}>
          <AlertTriangle size={36} color={TEXT_LIGHT} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Can't find this announcement</Text>
          <Text style={styles.emptySub}>
            It may have been removed, or you don't have permission to view it.
          </Text>
        </View>
      </View>
    );
  }

  const status = draft.status; // 'pending' | 'approved' | 'rejected'
  const audienceLabel =
    draft.audience === 'batch'
      ? (draft.batch_name || 'A batch')
      : draft.audience === 'institution'
        ? 'Whole institution'
        : draft.audience;

  return (
    <View style={styles.screen}>
      <Header onBack={() => navigation.goBack()} title="Announcement" />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchDraft(); }}
            tintColor={BRAND}
          />
        }
      >
        {/* ── Status badge ───────────────────────────────────────── */}
        <StatusPill status={status} />

        {/* ── Title + message card ─────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Megaphone size={18} color={BRAND} strokeWidth={2.4} />
          </View>
          <Text style={styles.title}>{draft.title}</Text>
          {draft.message ? (
            <Text style={styles.message}>{draft.message}</Text>
          ) : (
            <Text style={styles.messageMuted}>(No additional message.)</Text>
          )}
        </View>

        {/* ── Sender row ───────────────────────────────────────── */}
        <View style={styles.detailCard}>
          <DetailRow
            icon={User}
            label="From"
            primary={draft.sender_name || 'Trainer'}
            secondary={draft.sender_email || null}
          />
          <Divider />
          <DetailRow
            icon={draft.audience === 'batch' ? Users : Building2}
            label="Audience"
            primary={audienceLabel}
            secondary={
              draft.recipient_count != null
                ? `${draft.recipient_count} recipient${draft.recipient_count === 1 ? '' : 's'}`
                : null
            }
          />
          <Divider />
          <DetailRow
            icon={Clock}
            label="Submitted"
            primary={fullDate(draft.created_at)}
            secondary={relTime(draft.created_at)}
          />
        </View>

        {/* ── Decision block (only once reviewed) ─────────────── */}
        {status !== 'pending' ? (
          <View style={[
            styles.decisionCard,
            status === 'approved' ? styles.decisionApproved : styles.decisionRejected,
          ]}>
            <View style={styles.decisionHeaderRow}>
              {status === 'approved' ? (
                <CheckCircle2 size={20} color={GREEN} strokeWidth={2.4} />
              ) : (
                <XCircle size={20} color={RED} strokeWidth={2.4} />
              )}
              <Text style={[
                styles.decisionTitle,
                { color: status === 'approved' ? GREEN : RED },
              ]}>
                {status === 'approved' ? 'Approved' : 'Rejected'}
              </Text>
            </View>
            {draft.reviewer_name ? (
              <Text style={styles.decisionLine}>
                <Text style={styles.decisionLabel}>By:</Text> {draft.reviewer_name}
              </Text>
            ) : null}
            {draft.reviewed_at ? (
              <Text style={styles.decisionLine}>
                <Text style={styles.decisionLabel}>When:</Text> {fullDate(draft.reviewed_at)}
              </Text>
            ) : null}
            {status === 'rejected' && draft.rejection_reason ? (
              <View style={styles.reasonBox}>
                <Text style={styles.decisionLabel}>Reason</Text>
                <Text style={styles.reasonText}>{draft.rejection_reason}</Text>
              </View>
            ) : null}
            {status === 'rejected' && !draft.rejection_reason ? (
              <Text style={styles.decisionLine}>No reason provided.</Text>
            ) : null}
          </View>
        ) : null}

        {/* ── Admin info note for pending ───────────────────────── */}
        {status === 'pending' && isAdmin ? (
          <View style={styles.infoNote}>
            <ShieldCheck size={16} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.infoNoteText}>
              Approving sends this announcement to every recipient in the
              chosen audience. Rejecting lets you share a reason with the
              trainer.
            </Text>
          </View>
        ) : null}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ── Admin action bar (pending only) ───────────────────── */}
      {status === 'pending' && isAdmin ? (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => { setReason(''); setRejectOpen(true); }}
            disabled={acting}
            activeOpacity={0.85}
          >
            <XCircle size={16} color={RED} strokeWidth={2.4} />
            <Text style={[styles.actionBtnText, { color: RED }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={onApprove}
            disabled={acting}
            activeOpacity={0.85}
          >
            {acting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Send size={16} color="#fff" strokeWidth={2.4} />
                <Text style={[styles.actionBtnText, { color: '#fff' }]}>
                  Approve & send
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Reject reason modal ───────────────────────────────── */}
      <Modal
        visible={rejectOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setRejectOpen(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reject announcement</Text>
              <TouchableOpacity onPress={() => setRejectOpen(false)} activeOpacity={0.7}>
                <XIcon size={18} color={TEXT_MUTED} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Add an optional reason. The trainer will see this in their
              notification.
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="e.g. Wrong batch — please resend to Batch B."
              placeholderTextColor={TEXT_LIGHT}
              value={reason}
              onChangeText={(v) => setReason(v.slice(0, 240))}
              multiline
              maxLength={240}
            />
            <Text style={styles.counter}>{reason.length}/240</Text>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectFillBtn, { marginTop: 10 }]}
              onPress={onReject}
              disabled={acting}
              activeOpacity={0.85}
            >
              {acting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.actionBtnText, { color: '#fff' }]}>
                  Reject announcement
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Local subcomponents ───────────────────────────────────────────────
function Header({ title, onBack }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} activeOpacity={0.7}>
        <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ width: 36 }} />
    </View>
  );
}

function StatusPill({ status }) {
  let bg = AMBER_SOFT, fg = AMBER, label = 'Awaiting approval', Icon = Clock;
  if (status === 'approved') { bg = GREEN_SOFT; fg = GREEN; label = 'Approved & sent'; Icon = CheckCircle2; }
  if (status === 'rejected') { bg = RED_SOFT; fg = RED; label = 'Rejected'; Icon = XCircle; }
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Icon size={14} color={fg} strokeWidth={2.4} />
      <Text style={[styles.statusPillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon: Icon, label, primary, secondary }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <Icon size={14} color={TEXT_MUTED} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailPrimary} numberOfLines={2}>{primary}</Text>
        {secondary ? <Text style={styles.detailSecondary}>{secondary}</Text> : null}
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    backgroundColor: SURFACE,
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 16, fontWeight: '800', color: TEXT, letterSpacing: -0.2,
  },

  body: { padding: 16, paddingBottom: 24 },

  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  statusPillText: { fontSize: 12, fontWeight: '800' },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  message: { marginTop: 8, fontSize: 14, color: TEXT, lineHeight: 21 },
  messageMuted: { marginTop: 8, fontSize: 13, color: TEXT_LIGHT, fontStyle: 'italic' },

  detailCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  detailIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  detailPrimary: { fontSize: 14, color: TEXT, fontWeight: '700', marginTop: 2 },
  detailSecondary: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginHorizontal: 0,
  },

  decisionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  decisionApproved: { backgroundColor: GREEN_SOFT, borderColor: '#A7F3D0' },
  decisionRejected: { backgroundColor: RED_SOFT, borderColor: '#FCA5A5' },
  decisionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  decisionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  decisionLine: { fontSize: 13, color: TEXT, marginTop: 2 },
  decisionLabel: { fontSize: 12, fontWeight: '800', color: TEXT_MUTED },
  reasonBox: {
    marginTop: 10,
    backgroundColor: SURFACE,
    borderRadius: 10,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
  },
  reasonText: { marginTop: 4, fontSize: 13, color: TEXT, lineHeight: 19 },

  infoNote: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: BRAND_SOFT,
    borderRadius: 12,
    padding: 12,
    alignItems: 'flex-start',
  },
  infoNoteText: { flex: 1, fontSize: 12, color: '#7F1D1D', lineHeight: 17 },

  actionBar: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: SURFACE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnText: { fontSize: 14, fontWeight: '800' },
  approveBtn: { backgroundColor: BRAND },
  rejectBtn: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: RED,
  },
  rejectFillBtn: { backgroundColor: RED },

  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  modalCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  modalSub: { fontSize: 12, color: TEXT_MUTED, marginBottom: 12, lineHeight: 17 },
  reasonInput: {
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: TEXT,
    textAlignVertical: 'top',
  },
  counter: {
    fontSize: 11, color: TEXT_LIGHT, textAlign: 'right', marginTop: 4,
  },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: '800', color: TEXT },
  emptySub: {
    marginTop: 6, fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 19,
  },
});
