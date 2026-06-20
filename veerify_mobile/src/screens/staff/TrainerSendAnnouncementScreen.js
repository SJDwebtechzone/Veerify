// src/screens/staff/TrainerSendAnnouncementScreen.js
//
// Trainer-side announcement composer.
//
// A trainer drafts a short notice for one of their batches. The draft is
// NOT delivered immediately — it lands in `pending_announcements` and the
// institution admin reviews + approves before it fans out to students.
//
// Flow:
//   1. Pick a batch (lists this trainer's own batches via
//      GET /api/batches/trainer/my).
//   2. Type a title + message.
//   3. Submit → POST /api/notifications/announce  { audience: 'batch',
//      batch_id, title, message, category }
//      Backend returns 202 + status:'pending' for trainer role.
//   4. Success screen: "Submitted for approval".
//
// Companion screen: TrainerMyPendingAnnouncementsScreen (queue history).

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Megaphone, CheckCircle, ChevronDown, Check, Send,
  Sparkles, Users, ClockAlert,
} from 'lucide-react-native';

import apiClient from '../../api/client';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';
const AMBER = '#F59E0B';

const MAX_TITLE = 120;
const MAX_MESSAGE = 800;

export default function TrainerSendAnnouncementScreen({ navigation }) {
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(true);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Fetch the trainer's batches once.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/batches/trainer/my');
        const list = Array.isArray(res.data?.batches) ? res.data.batches : [];
        setBatches(list);
        if (list.length === 1) setBatchId(list[0].id);
      } catch (err) {
        console.log('[TrainerAnnounce] batches fetch failed:', err?.message);
      } finally {
        setLoadingBatches(false);
      }
    })();
  }, []);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === batchId) || null,
    [batches, batchId],
  );

  const recipientCount = Number(selectedBatch?.enrolled_count || 0);

  const canSend = useMemo(() => {
    return (
      !!batchId &&
      title.trim().length > 0 &&
      !sending
    );
  }, [batchId, title, sending]);

  const handleSubmit = async () => {
    const t = title.trim();
    const m = message.trim();
    if (!batchId) {
      Alert.alert('Pick a batch', 'Choose which batch this announcement is for.');
      return;
    }
    if (!t) {
      Alert.alert('Title required', 'Type a short title so students see what it is about.');
      return;
    }

    Alert.alert(
      'Submit for approval?',
      `This draft will go to your institution admin first. Once they approve, it will be delivered to ${recipientCount} ${recipientCount === 1 ? 'student' : 'students'} in this batch.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setSending(true);
            try {
              await apiClient.post('/notifications/announce', {
                audience: 'batch',
                batch_id: batchId,
                title: t,
                message: m || null,
                category: 'announcement',
              });
              setSent(true);
            } catch (err) {
              Alert.alert(
                'Submit failed',
                err?.response?.data?.message || 'Please try again.',
              );
            } finally {
              setSending(false);
            }
          },
        },
      ],
    );
  };

  // ── Success screen ────────────────────────────────────────────────────
  if (sent) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.successBody}>
          <View style={styles.successCircle}>
            <CheckCircle size={56} color="#fff" strokeWidth={2.4} />
          </View>
          <Text style={styles.successTitle}>Submitted for approval</Text>
          <Text style={styles.successSub}>
            Your institution admin will review this announcement before it
            reaches students. You'll get a notification once they decide.
          </Text>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => {
              setSent(false);
              setTitle('');
              setMessage('');
            }}
            activeOpacity={0.85}
          >
            <Sparkles size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.btnPrimaryText}>Draft another</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, { marginTop: 8 }]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.btnGhostText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Compose screen ────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
          disabled={sending}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Send Announcement</Text>
          <Text style={styles.headerSub}>Drafts go to your admin for approval</Text>
        </View>
      </View>

      {/* Approval-required banner — sets expectations up front. */}
      <View style={styles.notice}>
        <ClockAlert size={16} color={AMBER} strokeWidth={2.4} />
        <Text style={styles.noticeText}>
          Trainer announcements need institution admin approval before
          they reach students.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Batch picker ─────────────────────────────────────────── */}
        <Text style={styles.label}>Batch</Text>
        <TouchableOpacity
          style={[
            styles.dropdownTrigger,
            (loadingBatches || batches.length === 0) && styles.dropdownTriggerDisabled,
          ]}
          onPress={() => setBatchOpen((o) => !o)}
          disabled={loadingBatches || batches.length === 0}
          activeOpacity={0.85}
        >
          <View style={styles.dropdownIconWrap}>
            <Users size={14} color={BRAND} strokeWidth={2.4} />
          </View>
          <Text
            style={[
              styles.dropdownText,
              !selectedBatch && { color: TEXT_LIGHT, fontWeight: '500' },
            ]}
            numberOfLines={1}
          >
            {loadingBatches
              ? 'Loading your batches…'
              : batches.length === 0
                ? 'You have no batches yet'
                : selectedBatch
                  ? selectedBatch.name
                  : 'Select a batch'}
          </Text>
          <ChevronDown
            size={16}
            color={TEXT_MUTED}
            strokeWidth={2.4}
            style={{ transform: [{ rotate: batchOpen ? '180deg' : '0deg' }] }}
          />
        </TouchableOpacity>

        {batchOpen ? (
          <View style={styles.inlineMenu}>
            {batches.length === 0 ? (
              <Text style={styles.inlineEmpty}>Nothing here yet.</Text>
            ) : null}
            {batches.map((b) => {
              const sel = b.id === batchId;
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.inlineRow, sel && styles.inlineRowSelected]}
                  onPress={() => {
                    setBatchId(b.id);
                    setBatchOpen(false);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inlineRowText} numberOfLines={1}>
                      {b.name}
                    </Text>
                    <Text style={styles.inlineRowSub} numberOfLines={1}>
                      {b.course_name} · {Number(b.enrolled_count || 0)} student
                      {Number(b.enrolled_count || 0) === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {sel ? <Check size={14} color={BRAND} strokeWidth={2.6} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {selectedBatch ? (
          <Text style={styles.reachHint}>
            Will reach <Text style={{ fontWeight: '800', color: TEXT }}>
              {recipientCount}
            </Text>{' '}
            {recipientCount === 1 ? 'student' : 'students'} once approved.
          </Text>
        ) : null}

        {/* ── Title ─────────────────────────────────────────────────── */}
        <Text style={[styles.label, { marginTop: 18 }]}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="Class moved to 6 PM tomorrow"
          placeholderTextColor={TEXT_LIGHT}
          value={title}
          onChangeText={(v) => setTitle(v.slice(0, MAX_TITLE))}
          maxLength={MAX_TITLE}
          editable={!sending}
        />
        <Text style={styles.counter}>
          {title.length}/{MAX_TITLE}
        </Text>

        {/* ── Message ───────────────────────────────────────────────── */}
        <Text style={[styles.label, { marginTop: 14 }]}>Message (optional)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Add any extra details students should know…"
          placeholderTextColor={TEXT_LIGHT}
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE))}
          maxLength={MAX_MESSAGE}
          multiline
          editable={!sending}
        />
        <Text style={styles.counter}>
          {message.length}/{MAX_MESSAGE}
        </Text>
      </ScrollView>

      {/* ── Submit ─────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, !canSend && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={!canSend}
          activeOpacity={0.85}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.btnPrimaryText}>Submit for approval</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  headerSub: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFF8E1',
    borderColor: '#FCD34D',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
  },
  noticeText: { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },

  scrollBody: { padding: 16, paddingBottom: 32 },

  label: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  dropdownTrigger: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownTriggerDisabled: { opacity: 0.55 },
  dropdownIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  dropdownText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '700' },

  inlineMenu: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    gap: 10,
  },
  inlineRowSelected: { backgroundColor: BRAND_SOFT },
  inlineRowText: { fontSize: 14, fontWeight: '700', color: TEXT },
  inlineRowSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  inlineEmpty: {
    paddingHorizontal: 14, paddingVertical: 16,
    fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic', textAlign: 'center',
  },
  reachHint: { fontSize: 12, color: TEXT_MUTED, marginTop: 8 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: TEXT,
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  counter: {
    fontSize: 11,
    color: TEXT_LIGHT,
    textAlign: 'right',
    marginTop: 4,
  },

  footer: {
    padding: 16,
    backgroundColor: SURFACE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, gap: 8,
  },
  btnPrimary: { backgroundColor: BRAND },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  btnGhost: { backgroundColor: 'transparent' },
  btnGhostText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '700' },

  successBody: { padding: 24, paddingTop: 80, alignItems: 'center' },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  successTitle: {
    fontSize: 20, fontWeight: '800', color: TEXT,
    letterSpacing: -0.3, marginBottom: 8, textAlign: 'center',
  },
  successSub: {
    fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 19,
    paddingHorizontal: 8,
  },
});
