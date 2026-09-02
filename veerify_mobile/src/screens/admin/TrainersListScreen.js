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

import React, { useState, useCallback, useMemo, useContext, createContext } from 'react';
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
import { useBellScrollHandler } from '../../components/bellScrollBus';
import PlanLimitModal from '../../components/PlanLimitModal';
import { confirm } from '../../components/ConfirmDialog';
// Shared resolver — repairs legacy DB rows that baked in 10.0.2.2:5000
// or localhost from the Android emulator, and prepends the current
// api host to plain /uploads/... paths. See src/utils/assetUrl.js.
import resolveAssetUrl from '../../utils/assetUrl';
import Avatar from '../../components/Avatar';
// Institution Home visual system — ambient light-blue wash + glass
// cards + dark-blue primary. Reused verbatim so this screen belongs
// to the same design language.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens (mirror AdminDashboardScreen) ──
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local context so nested sub-components pick up dark-mode overrides
// without prop-drilling.
const TrainersCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:        { backgroundColor: pal.bg },
    header:        { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle:   { color: pal.text },
    headerSub:     { color: pal.textMuted },
    card:          { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    name:          { color: pal.text },
    contactBlock:  { backgroundColor: pal.border },
    contactLabel:  { color: pal.textMuted },
    contactValue:  { color: pal.text },
    expChip:       { backgroundColor: pal.border },
    expChipText:   { color: pal.textMuted },
    modalScreen:   { backgroundColor: pal.bg },
    modalHeader:   { backgroundColor: pal.surface, borderBottomColor: pal.border },
    modalHeaderTitle: { color: pal.text },
    modalCloseBtn: { backgroundColor: pal.border },
    modalName:     { color: pal.text },
    modalSubtitle: { color: pal.textMuted },
    detailSectionTitle: { color: pal.textMuted },
    detailCard:    { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    detailRow:     { borderBottomColor: pal.border },
    detailLabel:   { color: pal.textMuted },
    detailValue:   { color: pal.text },
    modalActions:  { backgroundColor: pal.surface, borderTopColor: pal.border },
    emptyCard:     { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    emptyTitle:    { color: pal.text },
    emptySub:      { color: pal.textMuted },
  });
}

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
  // Dark-mode adaptation (light: ambient wash + white glass; dark:
  // theme surface + dark text). Same pattern used across the rebrand.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => buildDarkOverrides(themePalette), [themePalette]);
  const ctxValue = useMemo(() => ({ isDark, dark }), [isDark, dark]);
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
      <View style={[styles.screen, isDark && dark.screen, styles.center]}>
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        <ActivityIndicator size="large" color={BRAND_DARK_BLUE} />
      </View>
    );
  }

  return (
    <TrainersCtx.Provider value={ctxValue}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Ambient Institution wash — light-blue vertical gradient +
          two low-opacity glow blobs. Painted behind everything with
          pointerEvents="none". Skipped in dark mode. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      {/* Header */}
      <View style={[styles.header, isDark && dark.header]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>My Trainers</Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>
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
            <Users size={12} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
            <Text style={styles.usagePillText}>
              {trainerUsage.current}/{trainerUsage.limit}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerPill}>
            <Users size={12} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
            <Text style={styles.headerPillText}>{trainers.length}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={trainers}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND_DARK_BLUE}
          />
        }
        ListEmptyComponent={
          <View style={[styles.emptyCard, isDark && dark.emptyCard]}>
            <View style={styles.emptyIcon}>
              <GraduationCap size={32} color={BRAND_DARK_BLUE} strokeWidth={1.5} />
            </View>
            <Text style={[styles.emptyTitle, isDark && dark.emptyTitle]}>No trainers yet</Text>
            <Text style={[styles.emptySub, isDark && dark.emptySub]}>
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
    </TrainersCtx.Provider>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────
function TrainerCard({ trainer, onCall, onMail, onEdit, onDelete, onView }) {
  const { isDark, dark } = useContext(TrainersCtx);
  const belt = beltForLabel(trainer.belt_level);
  const photoUrl = resolveAssetUrl(trainer.photo_url);
  const initials = (trainer.name || '?')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <View style={[styles.card, isDark && dark.card]}>
      {/* Top row: avatar + name + kebab */}
      <View style={styles.cardTop}>
        <Avatar
          uri={trainer.photo_url}
          name={trainer.name || initials}
          size={56}
          tone="purple"
          style={{ borderWidth: 2, borderColor: belt.border }}
        />

        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Name + specialization get the whole header row width now
              that Edit/View/Delete have moved into their own row above
              the contact list. Both wrap to multiple lines so long
              names and multi-skill specialisations stay readable. */}
          <Text style={[styles.name, isDark && dark.name]}>{trainer.name}</Text>
          {trainer.specialization ? (
            <View style={styles.specRow}>
              <Briefcase size={11} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
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
            <View style={[styles.expChip, isDark && dark.expChip]}>
              <Text style={[styles.expChipText, isDark && dark.expChipText]}>
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
      <View style={[styles.contactBlock, isDark && dark.contactBlock]}>
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
              <Text style={[styles.contactLabel, isDark && dark.contactLabel]}>Call</Text>
              <Text style={[styles.contactValue, isDark && dark.contactValue]} numberOfLines={1}>{trainer.phone}</Text>
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
              <Text style={[styles.contactLabel, isDark && dark.contactLabel]}>Email</Text>
              <Text style={[styles.contactValue, isDark && dark.contactValue]} numberOfLines={1}>{trainer.email}</Text>
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
  const { isDark, dark } = useContext(TrainersCtx);
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
      <View style={[styles.modalScreen, isDark && dark.modalScreen]}>
        {/* Ambient wash behind everything in light mode. */}
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        {/* Header */}
        <View style={[styles.modalHeader, isDark && dark.modalHeader]}>
          <Text style={[styles.modalHeaderTitle, isDark && dark.modalHeaderTitle]}>Trainer Profile</Text>
          <TouchableOpacity onPress={onClose} style={[styles.modalCloseBtn, isDark && dark.modalCloseBtn]} hitSlop={8}>
            <X size={18} color={isDark ? '#F8FAFC' : HEADER_NAVY} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          {/* Hero — avatar, name, specialization, belt */}
          <View style={styles.modalHero}>
            <Avatar
              uri={trainer.photo_url}
              name={trainer.name || initials}
              size={96}
              tone="purple"
              style={{ borderWidth: 3, borderColor: belt.border, marginBottom: spacing.sm }}
            />
            <Text style={[styles.modalName, isDark && dark.modalName]}>{trainer.name}</Text>
            {trainer.specialization ? (
              <Text style={[styles.modalSubtitle, isDark && dark.modalSubtitle]}>{trainer.specialization}</Text>
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
        <View style={[styles.modalActions, isDark && dark.modalActions]}>
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
            style={[styles.modalActionBtn, { backgroundColor: BRAND_DARK_BLUE }]}
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
  const { isDark, dark } = useContext(TrainersCtx);
  return (
    <View style={styles.detailSection}>
      <Text style={[styles.detailSectionTitle, isDark && dark.detailSectionTitle]}>{title}</Text>
      <View style={[styles.detailCard, isDark && dark.detailCard]}>{children}</View>
    </View>
  );
}

function DetailRow({ icon: Icon, label, value, onPress, multiline }) {
  const { isDark, dark } = useContext(TrainersCtx);
  const body = (
    <View style={[styles.detailRow, isDark && dark.detailRow]}>
      <View style={styles.detailIconWrap}>
        {Icon ? <Icon size={14} color={BRAND_DARK_BLUE} strokeWidth={2.2} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.detailLabel, isDark && dark.detailLabel]}>{label}</Text>
        <Text
          style={[
            styles.detailValue,
            isDark && dark.detailValue,
            onPress && { color: BRAND_DARK_BLUE },
          ]}
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
// Rebuilt to mirror the Institution Home (AdminDashboardScreen)
// design system: light-blue ambient wash + translucent white glass
// cards with glossy top-edge highlight + cool cobalt drop-shadow +
// dark-blue primary accent. All functionality (add/edit/view/delete,
// contact rows, plan-usage pill, FAB, detail modal) preserved.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header — clean white bar with a subtle bottom border so the
  // status bar and title sit crisply above the ambient wash below.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 12,
    paddingBottom: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
  },
  headerTitle: { ...type.h1, color: HEADER_NAVY, fontSize: 20, letterSpacing: -0.3, fontWeight: '800' },
  headerSub: { ...type.caption, color: '#64748B', marginTop: 2, fontWeight: '600' },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: BRAND_ACCENT_SOFT,
    borderRadius: radius.pill,
  },
  headerPillText: { ...type.micro, color: BRAND_DARK_BLUE, fontWeight: '800' },

  // Usage pill — same look as the header count pill but tappable.
  // Flips to a soft red when the plan cap is hit.
  usagePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: BRAND_ACCENT_SOFT,
    borderRadius: radius.pill,
  },
  usagePillFull: { backgroundColor: '#FEE2E2' },
  usagePillText: { ...type.micro, color: BRAND_DARK_BLUE, fontWeight: '800' },

  // Card — premium glass surface matching Institution Home cards.
  // Translucent white fill, 1.5px glossy top-edge border + hairline
  // sides, cool cobalt drop-shadow, generous corner radius.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
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

  name: { ...type.bodyBold, color: HEADER_NAVY, fontSize: 15, letterSpacing: 0.1 },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  specText: { ...type.micro, color: BRAND_DARK_BLUE, fontWeight: '700', flex: 1 },

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

  // ── Full-screen trainer profile modal — glass system ──────────────
  modalScreen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 48,
    paddingBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
  },
  modalHeaderTitle: { ...type.h3, flex: 1, color: HEADER_NAVY, fontWeight: '800', letterSpacing: 0.2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EEF2F7',
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
  modalName: { ...type.h2, color: HEADER_NAVY, fontWeight: '800', letterSpacing: 0.2 },
  modalSubtitle: { ...type.body, color: '#64748B', marginTop: 4 },
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
    color: '#64748B',
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  detailCard: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.22)',
    gap: spacing.md,
  },
  detailIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  detailLabel: { ...type.micro, color: '#64748B', fontWeight: '700' },
  detailValue: { ...type.body, color: HEADER_NAVY, fontWeight: '600', marginTop: 1 },

  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.22)',
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
    backgroundColor: 'rgba(241,246,251,0.9)',
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)',
  },
  expChipText: { ...type.micro, color: '#64748B', fontWeight: '700' },

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

  // Contact rows — inner tinted block matches the batch-row idiom
  // from Institution Home: a subtly tinted panel inside the glass
  // card so the two contacts read as a grouped unit.
  contactBlock: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(241,246,251,0.9)',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 10,
  },
  contactRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.22)',
  },
  contactIcon: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  contactIconCall: { backgroundColor: '#10B981' },
  contactIconMail: { backgroundColor: BRAND_DARK_BLUE },
  contactLabel: { ...type.micro, color: '#64748B', fontWeight: '700', letterSpacing: 0.4 },
  contactValue: { ...type.caption, color: HEADER_NAVY, fontWeight: '700', marginTop: 1 },

  // Empty — glass card matching the rest of the system.
  emptyCard: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { ...type.h2, color: HEADER_NAVY, marginTop: spacing.sm },
  emptySub: { ...type.caption, color: '#64748B', textAlign: 'center' },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl, paddingVertical: 10,
    backgroundColor: BRAND_DARK_BLUE,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    shadowColor: BRAND_DARK_BLUE,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyCtaText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },

  // Floating action button — dark-blue brand primary with a cobalt
  // glow shadow so it lifts off the ambient wash.
  fab: {
    position: 'absolute',
    right: spacing.lg, bottom: spacing.xl + 4,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND_DARK_BLUE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND_DARK_BLUE,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  // Plan-cap reached → FAB turns brand red + swaps the + for a Crown
  // so the constraint reads at a glance from anywhere on the screen.
  fabCapped: { backgroundColor: '#E63946', shadowColor: '#E63946' },
});
