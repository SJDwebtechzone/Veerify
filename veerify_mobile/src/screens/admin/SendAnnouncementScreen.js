// src/screens/admin/SendAnnouncementScreen.js
//
// Institution admin composer for in-app announcements. Picks an audience
// (staff for now, students/all also wired in case we expand later),
// title + message, previews the recipient count, and fans out one
// notification per recipient when "Send" is tapped.
//
// Backend:
//   GET  /api/announcements/audience-counts   -> { counts: { staff, students, all } }
//   POST /api/announcements                   -> { audience, title, message, category }

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Megaphone, Users, GraduationCap, CheckCircle, ChevronRight,
  Send, Sparkles, UserCircle,
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

const AUDIENCES = [
  { key: 'staff',    label: 'Staff',    icon: GraduationCap, sub: 'All trainers' },
  { key: 'students', label: 'Students', icon: Users,         sub: 'All enrolled' },
  { key: 'parents',  label: 'Parents',  icon: UserCircle,    sub: 'Linked parents' },
  { key: 'all',      label: 'Everyone', icon: Megaphone,     sub: 'Staff · students · parents' },
];

const MAX_TITLE = 120;
const MAX_MESSAGE = 800;

export default function SendAnnouncementScreen({ navigation }) {
  const [audience, setAudience] = useState('staff');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [counts, setCounts] = useState({ staff: 0, students: 0, parents: 0, all: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { delivered_count, audience }

  // Fetch recipient counts so the composer shows "Will reach N people"
  // before the admin hits Send.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/announcements/audience-counts');
        setCounts(res.data?.counts || { staff: 0, students: 0, parents: 0, all: 0 });
      } catch (err) {
        console.log('[Announcement] counts fetch failed:', err?.message);
      } finally {
        setLoadingCounts(false);
      }
    })();
  }, []);

  const recipientCount = counts[audience] || 0;

  const canSend = useMemo(() => {
    return title.trim().length > 0 && !sending && recipientCount > 0;
  }, [title, sending, recipientCount]);

  const handleSend = async () => {
    const t = title.trim();
    const m = message.trim();
    if (!t) {
      Alert.alert('Title required', 'Type a short title so recipients see what the announcement is about.');
      return;
    }
    if (recipientCount === 0) {
      Alert.alert('No recipients', 'There are no users in this audience to send to.');
      return;
    }

    Alert.alert(
      'Send announcement?',
      `This will deliver "${t}" to ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}. You can't undo a send.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSending(true);
            try {
              const res = await apiClient.post('/announcements', {
                audience, title: t, message: m || null,
                category: 'announcement',
              });
              setSent({
                // status='pending' when the backend gated this for admin
                // approval (e.g. trainer submitting). delivered_count
                // stays absent in that case, so the success screen
                // branches into the "Awaiting approval" copy.
                pending:         res.data?.status === 'pending',
                delivered_count: res.data?.delivered_count || recipientCount,
                audience,
              });
            } catch (err) {
              Alert.alert('Send failed', err?.response?.data?.message || 'Please try again.');
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
          <Text style={styles.successTitle}>
            {sent.pending ? 'Submitted for approval' : 'Announcement sent'}
          </Text>
          <Text style={styles.successSub}>
            {sent.pending
              ? 'Your institution admin will review and approve this before it reaches students. You\'ll get a notification once they decide.'
              : `Delivered to ${sent.delivered_count} ${sent.delivered_count === 1 ? 'person' : 'people'}. They'll see it in their notifications inbox.`}
          </Text>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => {
              setSent(null);
              setTitle('');
              setMessage('');
            }}
            activeOpacity={0.85}
          >
            <Sparkles size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.btnPrimaryText}>Send another</Text>
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

  // ── Compose screen ───────────────────────────────────────────────────
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
          <Text style={styles.headerSub}>Compose a broadcast for your academy</Text>
        </View>
        {/* Sent-history shortcut — lets the admin audit what they've
            dispatched without leaving the announcement flow. */}
        <TouchableOpacity
          onPress={() => navigation.navigate('SentNotifications')}
          style={styles.historyBtn}
          activeOpacity={0.7}
          disabled={sending}
          hitSlop={6}
        >
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero icon */}
        <View style={styles.heroIcon}>
          <Megaphone size={32} color={BRAND} strokeWidth={2} />
        </View>

        {/* Audience picker */}
        <SectionTitle text="Audience" />
        <View style={styles.audienceRow}>
          {AUDIENCES.map((a) => {
            const Icon = a.icon;
            const on = audience === a.key;
            const c = counts[a.key] || 0;
            return (
              <TouchableOpacity
                key={a.key}
                style={[styles.audienceCard, on && styles.audienceCardOn]}
                onPress={() => setAudience(a.key)}
                activeOpacity={0.85}
              >
                <View style={[styles.audienceIcon, on && styles.audienceIconOn]}>
                  <Icon
                    size={18}
                    color={on ? '#fff' : BRAND}
                    strokeWidth={2.4}
                  />
                </View>
                <Text style={[styles.audienceLabel, on && styles.audienceLabelOn]}>
                  {a.label}
                </Text>
                <Text style={[styles.audienceSub, on && styles.audienceSubOn]} numberOfLines={1}>
                  {a.sub}
                </Text>
                <View style={[styles.audienceCount, on && styles.audienceCountOn]}>
                  <Text style={[styles.audienceCountText, on && styles.audienceCountTextOn]}>
                    {loadingCounts ? '…' : c}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Title */}
        <SectionTitle text="Title" />
        <TextInput
          style={styles.input}
          placeholder="e.g. Holiday on Monday"
          placeholderTextColor={TEXT_LIGHT}
          value={title}
          onChangeText={(v) => setTitle(v.slice(0, MAX_TITLE))}
          maxLength={MAX_TITLE}
        />
        <Text style={styles.hint}>
          {title.length}/{MAX_TITLE} characters
        </Text>

        {/* Message */}
        <SectionTitle text="Message" />
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Add the details here. Keep it short and clear."
          placeholderTextColor={TEXT_LIGHT}
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE))}
          multiline
          textAlignVertical="top"
          maxLength={MAX_MESSAGE}
        />
        <Text style={styles.hint}>
          {message.length}/{MAX_MESSAGE} characters
        </Text>

        {/* Preview card */}
        <SectionTitle text="Preview" />
        <View style={styles.previewCard}>
          <View style={styles.previewBadge}>
            <Megaphone size={11} color="#fff" strokeWidth={2.4} />
            <Text style={styles.previewBadgeText}>ANNOUNCEMENT</Text>
          </View>
          <Text style={styles.previewTitle} numberOfLines={2}>
            {title.trim() || 'Your title appears here'}
          </Text>
          {(message.trim() || !title.trim()) ? (
            <Text style={styles.previewMessage} numberOfLines={3}>
              {message.trim() || 'Your message appears here. Recipients see this in their notifications inbox.'}
            </Text>
          ) : null}
          <View style={styles.previewMeta}>
            <Text style={styles.previewMetaText}>Just now</Text>
          </View>
        </View>
      </ScrollView>

      {/* Send button */}
      <View style={styles.footer}>
        <View style={styles.deliveryRow}>
          <Send size={12} color={TEXT_MUTED} strokeWidth={2.4} />
          <Text style={styles.deliveryText}>
            Will reach {loadingCounts ? '…' : recipientCount}{' '}
            {recipientCount === 1 ? 'person' : 'people'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, !canSend && { opacity: 0.5 }]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.85}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.btnPrimaryText}>
                Send to {recipientCount} {recipientCount === 1 ? 'person' : 'people'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────
function SectionTitle({ text }) {
  return <Text style={styles.sectionTitle}>{text}</Text>;
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  historyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
  },
  historyBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: 0.2,
  },

  body: { padding: 16, paddingBottom: 24 },

  heroIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.6,
    marginTop: 18, marginBottom: 8,
  },

  // Audience cards — wrap to 2x2 once we exceed 3 options so chips
  // stay readable on phones.
  audienceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  audienceCard: {
    width: '48%',
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    padding: 10,
    alignItems: 'center',
    position: 'relative',
  },
  audienceCardOn: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  audienceIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  audienceIconOn: { backgroundColor: BRAND },
  audienceLabel: { fontSize: 13, fontWeight: '800', color: TEXT },
  audienceLabelOn: { color: BRAND },
  audienceSub: { fontSize: 10, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  audienceSubOn: { color: BRAND },
  audienceCount: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 24, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  audienceCountOn: { backgroundColor: BRAND },
  audienceCountText: { fontSize: 10, color: TEXT_MUTED, fontWeight: '800' },
  audienceCountTextOn: { color: '#fff' },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 110, paddingTop: 11 },
  hint: { fontSize: 11, color: TEXT_LIGHT, marginTop: 4, fontWeight: '600', textAlign: 'right' },

  // Preview
  previewCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4, borderLeftColor: BRAND,
    borderWidth: 1, borderColor: BORDER,
  },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: BRAND,
    borderRadius: 999,
    marginBottom: 8,
  },
  previewBadgeText: { fontSize: 9, color: '#fff', fontWeight: '900', letterSpacing: 0.8 },
  previewTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
  previewMessage: { fontSize: 13, color: TEXT_MUTED, marginTop: 4, fontWeight: '600', lineHeight: 18 },
  previewMeta: { marginTop: 8 },
  previewMetaText: { fontSize: 11, color: TEXT_LIGHT, fontWeight: '700' },

  // Footer / send bar
  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  deliveryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
    marginBottom: 10,
  },
  deliveryText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
  },
  btnPrimary: { backgroundColor: BRAND },
  btnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  btnGhost: { backgroundColor: BG },
  btnGhostText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },

  // Success
  successBody: { padding: 24, paddingTop: 80, alignItems: 'center' },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: { fontSize: 22, fontWeight: '900', color: TEXT, marginTop: 8 },
  successSub: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 8, lineHeight: 19,
    paddingHorizontal: 20,
  },
});
