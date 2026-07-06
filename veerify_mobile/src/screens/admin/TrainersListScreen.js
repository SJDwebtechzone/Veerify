// src/screens/admin/TrainersListScreen.js
//
// Institution admin's "My Trainers" roster. Rich card per trainer:
//   - Circular photo (or initials fallback colored by belt level)
//   - Name + specialization line
//   - Belt-level + experience chips
//   - Tappable email row  -> mailto:
//   - Tappable phone row  -> tel: (opens the dialer)
//   - Kebab menu with Remove
//
// Floating + button bottom-right opens CreateTrainer.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, RefreshControl,
  ActivityIndicator, Image, StyleSheet, Linking, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Phone, Mail, MoreHorizontal, Plus, Trash2, Award, Briefcase,
  GraduationCap, ChevronRight, Users, Edit3, Eye, X, Calendar, FileText,
  Crown,
} from 'lucide-react-native';
import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import PlanLimitModal from '../../components/PlanLimitModal';
import { confirm } from '../../components/ConfirmDialog';
// Shared resolver — repairs legacy DB rows that baked in 10.0.2.2:5000
// or localhost from the Android emulator, and prepends the current
// api host to plain /uploads/... paths. See src/utils/assetUrl.js.
import resolveAssetUrl from '../../utils/assetUrl';

// MoreVertical not in older lucide versions; MoreHorizontal works the same.
const MoreVertical = MoreHorizontal;

// ─── Belt → color palette mapping (matches student/parent screens) ────
const BELT_COLORS = {
  white:  { bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  yellow: { bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  orange: { bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  green:  { bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  blue:   { bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  brown:  { bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  black:  { bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
};
function beltForLabel(label) {
  if (!label) return BELT_COLORS.white;
  const k = String(label).toLowerCase();
  for (const key of Object.keys(BELT_COLORS)) {
    if (k.includes(key)) return BELT_COLORS[key];
  }
  return BELT_COLORS.white;
}

export default function TrainersListScreen({ navigation }) {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Selected trainer for the View modal (null = closed)
  const [viewing, setViewing] = useState(null);
  // Plan-limit info — { limit, current, plan_name, unlimited, exceeded }
  const [trainerUsage, setTrainerUsage] = useState(null);
  // Whether the Upgrade Plan modal is currently visible.
  const [planModalOpen, setPlanModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tRes, uRes] = await Promise.all([
        apiClient.get('/trainers'),
        apiClient.get('/plans/usage').catch(() => null),
      ]);
      setTrainers(tRes.data.trainers || []);
      const usage = uRes?.data?.trainers;
      if (usage) setTrainerUsage(usage);
    } catch (err) {
      console.log('[TrainersList] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Whether we're re-checking the plan cap right now (FAB tap).
  const [checkingCap, setCheckingCap] = useState(false);

  // Tap handler for every "+ Add" entry point on this screen.
  //
  // We re-fetch /plans/usage on each tap so the modal fires reliably
  // even when the cached usage is stale (admin removed/added someone
  // in another session, or the initial fetch hasn't returned yet on a
  // slow network). The /plans/usage endpoint is cheap and the FAB tap
  // is a low-frequency action, so the latency cost is worth the UX.
  const handleAddTrainerPress = async () => {
    if (checkingCap) return;
    setCheckingCap(true);
    try {
      const r = await apiClient.get('/plans/usage');
      const u = r?.data?.trainers || null;
      if (u) setTrainerUsage(u);
      if (u && !u.unlimited && u.current >= u.limit) {
        setPlanModalOpen(true);
        return;
      }
    } catch (err) {
      // Network or auth blip — fall through and let CreateTrainer's
      // own 402 handler catch the cap server-side as a safety net.
      console.log('[TrainersList] usage check failed:', err?.message);
    } finally {
      setCheckingCap(false);
    }
    navigation.navigate('CreateTrainer');
  };

  const onDelete = (trainer) => {
    // Branded destructive confirm — pink hero, shield icon, glow'd Remove
    // button. Replaces the stock OS AlertDialog which felt off-brand
    // against the rest of the trainer management flow.
    confirm({
      title: 'Remove trainer?',
      message: `${trainer.name} will lose access to your academy. Existing batches they were assigned to stay but become unassigned.`,
      variant: 'destructive',
      confirmText: 'Remove',
      cancelText: 'Keep trainer',
      onConfirm: () => {
        // The confirm dialog closes immediately when Remove is tapped;
        // we run the API call afterwards. If we open another confirm
        // synchronously (for success / error feedback) while the first
        // dialog is still animating out, Android may swallow it — so
        // we wait a beat before showing the follow-up.
        (async () => {
          try {
            await apiClient.delete(`/trainers/${trainer.id}`);
            // Refresh list so the removed trainer disappears.
            await load();
            setTimeout(() => {
              confirm({
                title: 'Trainer removed',
                message: `${trainer.name} no longer has access to your academy.`,
                variant: 'success',
                confirmText: 'Done',
                hideCancel: true,
              });
            }, 260);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.log('[TrainersList] delete failed:', err?.response?.status, err?.response?.data);
            setTimeout(() => {
              confirm({
                title: 'Could not remove',
                message:
                  err?.response?.data?.message ||
                  err?.message ||
                  'Something went wrong. Please try again.',
                variant: 'warning',
                confirmText: 'OK',
                hideCancel: true,
              });
            }, 260);
          }
        })();
      },
    });
  };

  // ── Tap-to-call ─ open the system dialer with the trainer's number ──
  const handleCall = (phone) => {
    if (!phone) return;
    const cleaned = String(phone).replace(/[^0-9+]/g, '');
    if (!cleaned) return;
    const url = `tel:${cleaned}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not place call', 'Your device did not accept the dialer link.');
    });
  };

  const handleMail = (email) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Could not open email', 'No email client found on this device.');
    });
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Trainers</Text>
          <Text style={styles.headerSub}>
            {trainerUsage && !trainerUsage.unlimited
              ? `${trainerUsage.current}/${trainerUsage.limit} used` +
                (trainerUsage.plan_name ? ` · ${trainerUsage.plan_name} plan` : '')
              : trainers.length === 0
                ? 'Enroll your first trainer'
                : `${trainers.length} ${trainers.length === 1 ? 'trainer' : 'trainers'} on staff`}
          </Text>
        </View>
        {/* Usage chip — shows "current / limit" against the plan. If the
            usage call hasn't loaded yet, we fall back to the bare count
            pill so the header still renders. Tap to open the Upgrade
            modal even before hitting the cap. */}
        {trainerUsage && !trainerUsage.unlimited ? (
          <TouchableOpacity
            style={[
              styles.usagePill,
              trainerUsage.current >= trainerUsage.limit && styles.usagePillFull,
            ]}
            onPress={() => setPlanModalOpen(true)}
            activeOpacity={0.85}
          >
            <Users size={12} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.usagePillText}>
              {trainerUsage.current}/{trainerUsage.limit}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerPill}>
            <Users size={12} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.headerPillText}>{trainers.length}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={trainers}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <GraduationCap size={32} color={palette.purple.vivid} strokeWidth={1.5} />
            </View>
            <Text style={styles.emptyTitle}>No trainers yet</Text>
            <Text style={styles.emptySub}>
              Enroll your first trainer to start assigning them to batches.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={handleAddTrainerPress}
              activeOpacity={0.85}
            >
              <Plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.emptyCtaText}>Enroll Trainer</Text>
            </TouchableOpacity>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <TrainerCard
            trainer={item}
            onCall={() => handleCall(item.phone)}
            onMail={() => handleMail(item.email)}
            onEdit={() => navigation.navigate('CreateTrainer', { trainer: item })}
            onDelete={() => onDelete(item)}
            onView={() => setViewing(item)}
          />
        )}
      />

      {/* Floating Add button — guarded by plan cap. While we re-check
          /plans/usage we show a spinner; when we know the cap is hit
          the icon flips to a Crown so the limit is visible at a glance. */}
      <TouchableOpacity
        style={[
          styles.fab,
          trainerUsage && !trainerUsage.unlimited && trainerUsage.current >= trainerUsage.limit && styles.fabCapped,
        ]}
        onPress={handleAddTrainerPress}
        activeOpacity={0.85}
        disabled={checkingCap}
      >
        {checkingCap ? (
          <ActivityIndicator color="#fff" />
        ) : trainerUsage && !trainerUsage.unlimited && trainerUsage.current >= trainerUsage.limit ? (
          <Crown size={20} color="#fff" strokeWidth={2.6} />
        ) : (
          <Plus size={22} color="#fff" strokeWidth={2.8} />
        )}
      </TouchableOpacity>

      {/* Full-screen "View Trainer" modal */}
      <TrainerDetailModal
        trainer={viewing}
        onClose={() => setViewing(null)}
        onCall={(phone) => handleCall(phone)}
        onMail={(email) => handleMail(email)}
        onEdit={(t) => {
          setViewing(null);
          navigation.navigate('CreateTrainer', { trainer: t });
        }}
      />

      {/* Upgrade Plan modal — fired both proactively (FAB / empty CTA
          when usage.current ≥ limit) and as a fallback when the create
          screen surfaces a 402 it can't handle locally. */}
      <PlanLimitModal
        visible={planModalOpen}
        kind="trainer"
        limit={trainerUsage?.limit}
        current={trainerUsage?.current}
        planName={trainerUsage?.plan_name}
        onClose={() => setPlanModalOpen(false)}
        onUpgrade={() => {
          try { navigation.navigate('PlanSelection'); }
          catch { /* PlanSelection isn't always in this stack */ }
        }}
      />
    </View>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────
function TrainerCard({ trainer, onCall, onMail, onEdit, onDelete, onView }) {
  const belt = beltForLabel(trainer.belt_level);
  const photoUrl = resolveAssetUrl(trainer.photo_url);
  const initials = (trainer.name || '?')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <View style={styles.card}>
      {/* Top row: avatar + name + kebab */}
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { borderColor: belt.border }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatarImg} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: belt.bg }]}>
              <Text style={[
                styles.avatarText,
                { color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg },
              ]}>
                {initials}
              </Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Name + specialization get the whole header row width now
              that Edit/View/Delete have moved into their own row above
              the contact list. Both wrap to multiple lines so long
              names and multi-skill specialisations stay readable. */}
          <Text style={styles.name}>{trainer.name}</Text>
          {trainer.specialization ? (
            <View style={styles.specRow}>
              <Briefcase size={11} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.specText}>
                {trainer.specialization}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Chip row: belt + experience */}
      {(trainer.belt_level || trainer.experience_years != null) ? (
        <View style={styles.chipRow}>
          {trainer.belt_level ? (
            <View style={[styles.beltChip, { backgroundColor: belt.bg, borderColor: belt.border }]}>
              <Award size={10} color={belt.fg} strokeWidth={2.4} />
              <Text style={[styles.beltChipText, { color: belt.fg }]} numberOfLines={1}>
                {trainer.belt_level}
              </Text>
            </View>
          ) : null}
          {trainer.experience_years != null ? (
            <View style={styles.expChip}>
              <Text style={styles.expChipText}>
                {trainer.experience_years} yr{trainer.experience_years === 1 ? '' : 's'} experience
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Action row — Edit / View / Delete sit just above the call &
          email contact rows now. They used to crowd the header, which
          was forcing the name + specialisation to truncate on the first
          line. Equal-width buttons with a small icon + label each. */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onEdit}
          style={[styles.actionBtn, styles.actionEdit]}
          activeOpacity={0.85}
        >
          <Edit3 size={13} color={palette.purple.vivid} strokeWidth={2.6} />
          <Text style={[styles.actionBtnText, { color: palette.purple.vivid }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onView}
          style={[styles.actionBtn, styles.actionView]}
          activeOpacity={0.85}
        >
          <Eye size={13} color={palette.blue.vivid} strokeWidth={2.6} />
          <Text style={[styles.actionBtnText, { color: palette.blue.vivid }]}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          style={[styles.actionBtn, styles.actionDelete]}
          activeOpacity={0.85}
        >
          <Trash2 size={13} color="#B91C1C" strokeWidth={2.6} />
          <Text style={[styles.actionBtnText, { color: '#B91C1C' }]}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Contact rows - tappable */}
      <View style={styles.contactBlock}>
        {trainer.phone ? (
          <TouchableOpacity
            style={styles.contactRow}
            onPress={onCall}
            activeOpacity={0.7}
          >
            <View style={[styles.contactIcon, styles.contactIconCall]}>
              <Phone size={14} color="#fff" strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>Call</Text>
              <Text style={styles.contactValue} numberOfLines={1}>{trainer.phone}</Text>
            </View>
            <ChevronRight size={14} color={palette.textLight} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}

        {trainer.email ? (
          <TouchableOpacity
            style={[styles.contactRow, trainer.phone ? styles.contactRowBorder : null]}
            onPress={onMail}
            activeOpacity={0.7}
          >
            <View style={[styles.contactIcon, styles.contactIconMail]}>
              <Mail size={14} color="#fff" strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactLabel}>Email</Text>
              <Text style={styles.contactValue} numberOfLines={1}>{trainer.email}</Text>
            </View>
            <ChevronRight size={14} color={palette.textLight} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ─── TrainerDetailModal — full-screen profile sheet ────────────────────
function TrainerDetailModal({ trainer, onClose, onCall, onMail, onEdit }) {
  if (!trainer) return null;
  const belt = beltForLabel(trainer.belt_level);
  const photoUrl = resolveAssetUrl(trainer.photo_url);
  const certUrl  = resolveAssetUrl(trainer.certificate_url);
  const initials = (trainer.name || '?')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <Modal
      visible={!!trainer}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.modalScreen}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Trainer Profile</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn} hitSlop={8}>
            <X size={18} color={palette.text} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          {/* Hero — avatar, name, specialization, belt */}
          <View style={styles.modalHero}>
            <View style={[styles.modalAvatar, { borderColor: belt.border }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.modalAvatarImg} />
              ) : (
                <View style={[styles.modalAvatarFallback, { backgroundColor: belt.bg }]}>
                  <Text style={[
                    styles.modalAvatarText,
                    { color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg },
                  ]}>
                    {initials}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.modalName}>{trainer.name}</Text>
            {trainer.specialization ? (
              <Text style={styles.modalSubtitle}>{trainer.specialization}</Text>
            ) : null}
            {trainer.belt_level ? (
              <View style={[styles.modalBeltPill, { backgroundColor: belt.bg, borderColor: belt.border }]}>
                <Award size={11} color={belt.fg} strokeWidth={2.4} />
                <Text style={[styles.modalBeltText, { color: belt.fg }]}>
                  {trainer.belt_level}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Contact */}
          <DetailSection title="Contact">
            <DetailRow icon={Phone} label="Phone" value={trainer.phone || '—'}
              onPress={trainer.phone ? () => onCall(trainer.phone) : undefined} />
            <DetailRow icon={Mail} label="Email" value={trainer.email || '—'}
              onPress={trainer.email ? () => onMail(trainer.email) : undefined} />
          </DetailSection>

          {/* Professional */}
          <DetailSection title="Professional">
            <DetailRow icon={Briefcase} label="Specialization"
              value={trainer.specialization || '—'} />
            <DetailRow icon={GraduationCap} label="Experience"
              value={trainer.experience_years != null
                ? `${trainer.experience_years} ${trainer.experience_years === 1 ? 'year' : 'years'}`
                : '—'} />
            <DetailRow icon={Award} label="Belt level"
              value={trainer.belt_level || '—'} />
            {trainer.bio ? (
              <DetailRow icon={FileText} label="Bio" value={trainer.bio} multiline />
            ) : null}
          </DetailSection>

          {/* Personal */}
          {(trainer.gender || trainer.date_of_birth) ? (
            <DetailSection title="Personal">
              {trainer.gender ? (
                <DetailRow icon={Users} label="Gender" value={trainer.gender} />
              ) : null}
              {trainer.date_of_birth ? (
                <DetailRow icon={Calendar} label="Date of birth"
                  value={fmtDate(trainer.date_of_birth)} />
              ) : null}
            </DetailSection>
          ) : null}

          {/* Identity documents */}
          {(trainer.govt_proof_type || trainer.govt_proof_number || certUrl) ? (
            <DetailSection title="Identity & Documents">
              {trainer.govt_proof_type ? (
                <DetailRow icon={FileText} label="ID type"
                  value={trainer.govt_proof_type} />
              ) : null}
              {trainer.govt_proof_number ? (
                <DetailRow icon={FileText} label="ID number"
                  value={trainer.govt_proof_number} />
              ) : null}
              {certUrl ? (
                <DetailRow icon={FileText} label="Certificate"
                  value="Tap to open" onPress={() => Linking.openURL(certUrl)} />
              ) : null}
            </DetailSection>
          ) : null}
        </ScrollView>

        {/* Sticky bottom actions */}
        <View style={styles.modalActions}>
          {trainer.phone ? (
            <TouchableOpacity
              style={[styles.modalActionBtn, { backgroundColor: '#10B981' }]}
              onPress={() => onCall(trainer.phone)}
              activeOpacity={0.85}
            >
              <Phone size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.modalActionText}>Call</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.modalActionBtn, { backgroundColor: palette.purple.vivid }]}
            onPress={() => onEdit(trainer)}
            activeOpacity={0.85}
          >
            <Edit3 size={14} color="#fff" strokeWidth={2.6} />
            <Text style={styles.modalActionText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function DetailSection({ title, children }) {
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{title}</Text>
      <View style={styles.detailCard}>{children}</View>
    </View>
  );
}

function DetailRow({ icon: Icon, label, value, onPress, multiline }) {
  const body = (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        {Icon ? <Icon size={14} color={palette.purple.vivid} strokeWidth={2.2} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text
          style={[styles.detailValue, onPress && { color: palette.purple.vivid }]}
          numberOfLines={multiline ? undefined : 1}
        >
          {value}
        </Text>
      </View>
      {onPress ? (
        <ChevronRight size={14} color={palette.textLight} strokeWidth={2.2} />
      ) : null}
    </View>
  );
  return onPress
    ? <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{body}</TouchableOpacity>
    : body;
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header — refined for a cleaner, more modern look.
  //   • Larger title, tighter subtitle
  //   • Extra top-padding so it breathes below the status bar
  //   • Hairline divider instead of a solid border for a lighter feel
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 12,
    paddingBottom: spacing.lg,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.borderSoft,
  },
  headerTitle: { ...type.h1, color: palette.text, fontSize: 20, letterSpacing: -0.3 },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: 2, fontWeight: '600' },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.pill,
  },
  headerPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Usage pill (replaces the bare count when a plan cap is in effect).
  // Tappable; turns red when at the cap to draw the eye.
  usagePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.pill,
  },
  usagePillFull: { backgroundColor: '#FFE4E6' },
  usagePillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Card — tightened for a cleaner card feel.
  //   • Slightly rounder corners
  //   • Fine border in addition to the shadow so cards read distinctly
  //     against the bg without needing heavier drop-shadows
  card: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    ...shadows.card,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: palette.surface,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800' },

  name: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  specText: { ...type.micro, color: palette.purple.vivid, fontWeight: '700', flex: 1 },

  kebab: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  // Visible Edit pill - sits to the LEFT of the kebab in the card header.
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.pill,
  },
  editBtnText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 0.4 },

  // Visible Delete pill - same dimensions as editBtn so they line up
  // neatly side by side. Brand-red so it's clearly destructive.
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
    backgroundColor: '#E63946',
    borderRadius: radius.pill,
    marginLeft: 6,
  },
  deleteBtnText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 0.4 },

  // View pill - opens the full trainer profile modal. Slate/blue so it
  // visually reads as "info" next to the action-y Edit and Delete pills.
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
    backgroundColor: '#475569',
    borderRadius: radius.pill,
    marginLeft: 6,
  },
  viewBtnText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 0.4 },

  // ── Full-screen trainer profile modal ──────────────────────────────
  modalScreen: { flex: 1, backgroundColor: palette.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 48,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.divider || '#E5E7EB',
  },
  modalHeaderTitle: { ...type.h3, flex: 1, color: palette.text, fontWeight: '800' },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  modalHero: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  modalAvatar: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  modalAvatarImg: { width: '100%', height: '100%' },
  modalAvatarFallback: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  modalAvatarText: { fontSize: 32, fontWeight: '800' },
  modalName: { ...type.h2, color: palette.text, fontWeight: '800' },
  modalSubtitle: { ...type.body, color: palette.textMuted, marginTop: 4 },
  modalBeltPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  modalBeltText: { ...type.micro, fontWeight: '800' },

  detailSection: { marginBottom: spacing.lg },
  detailSectionTitle: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  detailCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.card,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider || '#E5E7EB',
    gap: spacing.md,
  },
  detailIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  detailLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  detailValue: { ...type.body, color: palette.text, fontWeight: '600', marginTop: 1 },

  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.divider || '#E5E7EB',
  },
  modalActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  modalActionText: { ...type.body, color: '#fff', fontWeight: '800' },

  // Chip row
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    marginTop: spacing.sm + 2,
  },
  beltChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  beltChipText: { ...type.micro, fontWeight: '800', maxWidth: 140 },
  expChip: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: palette.bg,
    borderRadius: radius.pill,
  },
  expChipText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // ── Action row (Edit / View / Delete) — sits just above the contact
  //    block so the header row can give name + specialisation full width.
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: spacing.md,
  },
  // Softer, more modern action pills — outlined with a subtle tinted
  // background instead of solid colored buttons. Reads as calmer while
  // still keeping the color-code (purple = edit, blue = view, red = delete).
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnText: {
    ...type.micro,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  actionEdit:   {
    backgroundColor: palette.purple.soft,
    borderColor:    palette.purple.vivid + '55',
  },
  actionView:   {
    backgroundColor: palette.blue.soft,
    borderColor:    palette.blue.vivid + '55',
  },
  actionDelete: {
    backgroundColor: '#FEE2E2',
    borderColor:    '#FCA5A5',
  },

  // Contact rows
  contactBlock: {
    marginTop: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 10,
  },
  contactRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.borderSoft,
  },
  contactIcon: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  contactIconCall: { backgroundColor: palette.green.vivid },
  contactIconMail: { backgroundColor: palette.blue.vivid },
  contactLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.4 },
  contactValue: { ...type.caption, color: palette.text, fontWeight: '700', marginTop: 1 },

  // Empty
  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    ...shadows.card,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { ...type.h2, color: palette.text, marginTop: spacing.sm },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl, paddingVertical: 10,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  emptyCtaText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },

  // Floating action button
  fab: {
    position: 'absolute',
    right: spacing.lg, bottom: spacing.xl + 4,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.raised,
  },
  // Plan-cap reached → FAB turns brand red and swaps the + for a Crown
  // so the constraint reads at a glance from anywhere on the screen.
  fabCapped: { backgroundColor: '#E63946' },
});
