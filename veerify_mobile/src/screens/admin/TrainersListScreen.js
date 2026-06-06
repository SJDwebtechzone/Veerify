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
  ActivityIndicator, Image, StyleSheet, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Phone, Mail, MoreHorizontal, Plus, Trash2, Award, Briefcase,
  GraduationCap, ChevronRight, Users, Edit3,
} from 'lucide-react-native';
// MoreVertical not in older lucide versions; MoreHorizontal works the same.
const MoreVertical = MoreHorizontal;

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

// ─── Asset host helper (re-uses the mobile API base) ───────────────────
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

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

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/trainers');
      setTrainers(res.data.trainers || []);
    } catch (err) {
      console.log('[TrainersList] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = (trainer) => {
    Alert.alert(
      'Remove trainer?',
      `${trainer.name} will lose access to your academy. Existing batches they were assigned to stay but become unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await apiClient.delete(`/trainers/${trainer.id}`);
            load();
          } catch (err) {
            Alert.alert('Error', err.response?.data?.message || 'Failed');
          }
        } }
      ]
    );
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
            {trainers.length === 0
              ? 'Enroll your first trainer'
              : `${trainers.length} ${trainers.length === 1 ? 'trainer' : 'trainers'} on staff`}
          </Text>
        </View>
        <View style={styles.headerPill}>
          <Users size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{trainers.length}</Text>
        </View>
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
              onPress={() => navigation.navigate('CreateTrainer')}
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
          />
        )}
      />

      {/* Floating Add button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateTrainer')}
        activeOpacity={0.85}
      >
        <Plus size={22} color="#fff" strokeWidth={2.8} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────
function TrainerCard({ trainer, onCall, onMail, onEdit, onDelete }) {
  const belt = beltForLabel(trainer.belt_level);
  const photoUrl = resolveAssetUrl(trainer.photo_url);
  const initials = (trainer.name || '?')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const handleMore = () => {
    Alert.alert(
      trainer.name,
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        ...(trainer.phone ? [{ text: 'Call', onPress: onCall }] : []),
        ...(trainer.email ? [{ text: 'Email', onPress: onMail }] : []),
        { text: 'Edit', onPress: onEdit },
        { text: 'Remove', style: 'destructive', onPress: onDelete },
      ],
      { cancelable: true },
    );
  };

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
          <Text style={styles.name} numberOfLines={1}>{trainer.name}</Text>
          {trainer.specialization ? (
            <View style={styles.specRow}>
              <Briefcase size={11} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.specText} numberOfLines={1}>
                {trainer.specialization}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Edit pill - one-tap entry into the trainer form in edit mode. */}
        <TouchableOpacity
          onPress={onEdit}
          style={styles.editBtn}
          hitSlop={6}
          activeOpacity={0.85}
        >
          <Edit3 size={13} color="#fff" strokeWidth={2.6} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>

        {/* Kebab still exposes Call / Email / Remove. */}
        <TouchableOpacity
          onPress={handleMore}
          style={styles.kebab}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <MoreVertical size={18} color={palette.textMuted} strokeWidth={2.2} />
        </TouchableOpacity>
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

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 8,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  headerTitle: { ...type.h1, color: palette.text, fontSize: 18 },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: 1, fontWeight: '600' },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.pill,
  },
  headerPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
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
});
