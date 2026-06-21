// src/screens/student/tabs/BatchesTabScreen.js
//
// Student-facing Batches tab — every batch at the currently-selected academy.
//
// Layout:
//   1. Header with academy selector
//   2. Search bar (name / program / trainer)
//   3. Status filter pills (All / Upcoming / Running / Completed)
//   4. Batch cards (program pill, name, trainer, schedule, online/offline mode,
//      capacity progress, Join button)
//
// Guests can view schedules; Join triggers a login popup. Free users get a
// "subscribe to enroll" popup. Real enrollment lands in Phase 2.

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  TextInput, FlatList, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Search, ChevronDown, ChevronRight, Clock, Calendar, User,
  Users, Building2, Wifi, MapPin, GraduationCap,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';

const ACCENTS = [palette.purple, palette.blue, palette.green, palette.orange, palette.pink, palette.teal];
const cycleAccent = (i) => ACCENTS[i % ACCENTS.length];

const FILTERS = ['All', 'Upcoming', 'Running', 'Completed'];

// Derive a status bucket from the batch row. Tries common shapes:
//   - explicit status field ('upcoming'/'running'/'active'/'completed'/'ended')
//   - falls back to date comparison if start_date/end_date exist.
function deriveStatus(b) {
  const raw = (b.status || b.batch_status || '').toLowerCase();
  if (['upcoming', 'scheduled', 'pending'].includes(raw)) return 'Upcoming';
  if (['running', 'active', 'in_progress', 'ongoing'].includes(raw)) return 'Running';
  if (['completed', 'finished', 'ended', 'closed'].includes(raw)) return 'Completed';

  const now = Date.now();
  const start = b.start_date ? new Date(b.start_date).getTime() : null;
  const end   = b.end_date   ? new Date(b.end_date).getTime()   : null;
  if (start && start > now) return 'Upcoming';
  if (end && end < now) return 'Completed';
  if (start && start <= now && (!end || end >= now)) return 'Running';
  return 'Upcoming';
}

function formatSchedule(b) {
  // Try several common time-shape conventions.
  const time =
    (b.start_time && b.end_time && `${b.start_time} – ${b.end_time}`) ||
    b.time ||
    b.timing ||
    '';
  const days = b.days || b.days_of_week || '';
  return { time, days };
}

export default function BatchesTabScreen({ navigation }) {
  const { user } = useAuth();
  const { selectedInstitution, loading: instLoading } = useInstitution();

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  const isGuest = !user;

  const load = useCallback(async () => {
    try {
      if (!selectedInstitution?.id) {
        setBatches([]);
        return;
      }
      const res = await apiClient
        .get(`/institutions/${selectedInstitution.id}/batches`)
        .catch(() => ({ data: { batches: [] } }));
      setBatches(res.data.batches || []);
    } catch (err) {
      console.log('[StudentBatches] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useEffect(() => { setLoading(true); load(); }, [selectedInstitution?.id, load]);

  const counts = useMemo(() => {
    const c = { All: batches.length, Upcoming: 0, Running: 0, Completed: 0 };
    batches.forEach((b) => { c[deriveStatus(b)] = (c[deriveStatus(b)] || 0) + 1; });
    return c;
  }, [batches]);

  const visible = useMemo(() => {
    let arr = batches;
    if (filter !== 'All') {
      arr = arr.filter((b) => deriveStatus(b) === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((b) =>
        (b.name || b.batch_name || '').toLowerCase().includes(q) ||
        (b.course_name || b.program || '').toLowerCase().includes(q) ||
        (b.trainer_name || b.trainer || '').toLowerCase().includes(q),
      );
    }
    return arr;
  }, [batches, search, filter]);

  const handleJoin = (batch) => {
    if (isGuest) {
      Alert.alert(
        'Login + Subscription Required',
        'Sign in and subscribe to join this batch.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Login', onPress: () => navigation.getParent()?.navigate('Login') },
        ],
      );
      return;
    }
    Alert.alert(
      'Subscribe to Join',
      'You need an active subscription to enroll in a batch. Pick a plan from your Profile.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'View Plans', onPress: () => navigation.navigate('Profile') },
      ],
    );
  };

  // ─── No academy chosen ───
  if (!instLoading && !selectedInstitution) {
    return (
      <View style={[styles.screen, styles.center, { padding: spacing.xxl }]}>
        <View style={styles.emptyIconWrap}>
          <Building2 size={36} color={palette.purple.vivid} strokeWidth={2.2} />
        </View>
        <Text style={styles.emptyTitle}>Pick your academy first</Text>
        <Text style={styles.emptyBody}>
          Batches are scheduled per academy. Choose one to see what's running.
        </Text>
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('SelectInstitution')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Choose academy</Text>
          <ChevronRight size={16} color="#fff" strokeWidth={2.6} />
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && batches.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header — just academy name + dropdown. Eyebrow line dropped to
          match the simplified Programs tab layout; bottom padding bumped
          so the search bar below has clear breathing room. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('SelectInstitution')}
          activeOpacity={0.85}
          style={styles.instSelector}
        >
          <Text style={styles.instText} numberOfLines={1}>
            {selectedInstitution?.name}
          </Text>
          <ChevronDown size={20} color={palette.purple.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by batch, program, or trainer"
          placeholderTextColor={palette.textLight}
          style={styles.searchInput}
        />
      </View>

      {/* Filter pills */}
      <View style={styles.filtersWrap}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
          keyExtractor={(f) => f}
          renderItem={({ item: f }) => {
            const focused = filter === f;
            return (
              <TouchableOpacity
                onPress={() => setFilter(f)}
                activeOpacity={0.85}
                style={[styles.filterPill, focused && styles.filterPillFocused]}
              >
                <Text style={[styles.filterText, focused && styles.filterTextFocused]}>
                  {f}
                </Text>
                <View style={[styles.filterBadge, focused && styles.filterBadgeFocused]}>
                  <Text style={[styles.filterBadgeText, focused && styles.filterBadgeTextFocused]}>
                    {counts[f] || 0}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyInline}>
            <Calendar size={22} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyInlineText}>
              {search || filter !== 'All'
                ? 'No batches match your filters. Try clearing them.'
                : 'No batches scheduled yet. Check back soon.'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <BatchCard
            batch={item}
            accent={cycleAccent(index)}
            onJoin={() => handleJoin(item)}
          />
        )}
      />
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
function BatchCard({ batch, accent, onJoin }) {
  const status = deriveStatus(batch);
  const { time, days } = formatSchedule(batch);
  const capacity = Number(batch.capacity || batch.max_students || 0);
  const enrolled = Number(batch.enrolled || batch.current_students || 0);
  const fillRatio = capacity > 0 ? Math.min(enrolled / capacity, 1) : 0;
  const nearlyFull = fillRatio >= 0.85;

  const isOnline = (batch.mode || '').toLowerCase().includes('online');

  const statusVisual = status === 'Running'
    ? palette.green
    : status === 'Upcoming'
      ? palette.blue
      : { soft: palette.borderSoft, vivid: palette.textMuted, on: palette.textMuted };

  return (
    <View style={styles.card}>
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={styles.batchName} numberOfLines={2}>
            {batch.name || batch.batch_name || `Batch ${batch.id}`}
          </Text>
          {batch.course_name || batch.program ? (
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <View style={[styles.coursePill, { backgroundColor: accent.soft }]}>
                <Text style={[styles.coursePillText, { color: accent.on }]}>
                  {batch.course_name || batch.program}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusVisual.soft }]}>
          <View style={[styles.statusDot, { backgroundColor: statusVisual.vivid }]} />
          <Text style={[styles.statusBadgeText, { color: statusVisual.on }]}>{status}</Text>
        </View>
      </View>

      {/* Meta */}
      <View style={styles.metaList}>
        {batch.trainer_name || batch.trainer ? (
          <MetaRow icon={User} label="Trainer" value={batch.trainer_name || batch.trainer} />
        ) : null}
        {time ? <MetaRow icon={Clock} label="Time" value={time} /> : null}
        {days ? <MetaRow icon={Calendar} label="Days" value={days} /> : null}
        <View style={styles.modeRow}>
          {isOnline ? (
            <View style={[styles.modePill, { backgroundColor: palette.blue.soft }]}>
              <Wifi size={11} color={palette.blue.on} strokeWidth={2.4} />
              <Text style={[styles.modePillText, { color: palette.blue.on }]}>Online</Text>
            </View>
          ) : (
            <View style={[styles.modePill, { backgroundColor: palette.orange.soft }]}>
              <MapPin size={11} color={palette.orange.on} strokeWidth={2.4} />
              <Text style={[styles.modePillText, { color: palette.orange.on }]}>In-person</Text>
            </View>
          )}
        </View>
      </View>

      {/* Capacity */}
      {capacity > 0 ? (
        <View style={styles.capacityWrap}>
          <View style={styles.capacityRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.capacityText}>{enrolled} / {capacity} students</Text>
            </View>
            <Text
              style={[
                styles.capacityPercent,
                { color: nearlyFull ? palette.orange.on : palette.textMuted },
              ]}
            >
              {Math.round(fillRatio * 100)}%
            </Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${fillRatio * 100}%`,
                  backgroundColor: nearlyFull ? palette.orange.vivid : accent.vivid,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {/* Join action */}
      <TouchableOpacity
        onPress={onJoin}
        activeOpacity={0.85}
        style={[
          styles.joinBtn,
          status === 'Completed' && { backgroundColor: palette.borderSoft },
        ]}
        disabled={status === 'Completed'}
      >
        <Text style={[
          styles.joinBtnText,
          status === 'Completed' && { color: palette.textMuted },
        ]}>
          {status === 'Completed' ? 'Ended' : 'Join Batch'}
        </Text>
        {status !== 'Completed' && <ChevronRight size={14} color="#fff" strokeWidth={2.6} />}
      </TouchableOpacity>
    </View>
  );
}

function MetaRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.metaRow}>
      <Icon size={13} color={palette.textMuted} strokeWidth={2.2} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  eyebrow: { ...type.caption, color: palette.textMuted },
  instSelector: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  instText: { ...type.display, color: palette.text, maxWidth: 260 },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg,
    height: 48, ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  // Filters
  filtersWrap: { paddingVertical: spacing.lg },
  filterPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, height: 36,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  filterPillFocused: { backgroundColor: palette.purple.vivid },
  filterText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  filterTextFocused: { color: '#fff' },
  filterBadge: {
    minWidth: 22, height: 20, paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeFocused: { backgroundColor: 'rgba(255,255,255,0.25)' },
  filterBadgeText: { ...type.micro, color: palette.textMuted },
  filterBadgeTextFocused: { color: '#fff' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  batchName: { ...type.h3, color: palette.text },
  coursePill: {
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  coursePillText: { ...type.micro, fontWeight: '700' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { ...type.micro, fontWeight: '700' },

  metaList: { marginTop: spacing.md, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaLabel: { ...type.micro, color: palette.textMuted, width: 56 },
  metaValue: { ...type.caption, color: palette.text, flex: 1, fontWeight: '600' },
  modeRow: { flexDirection: 'row', marginTop: 6 },
  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  modePillText: { fontSize: 10, fontWeight: '700' },

  // Capacity
  capacityWrap: { marginTop: spacing.md },
  capacityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  capacityText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  capacityPercent: { ...type.caption, fontWeight: '700' },
  barTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  joinBtnText: { ...type.bodyBold, color: '#fff' },

  // Empty
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...type.h1, color: palette.text, marginBottom: spacing.sm, textAlign: 'center' },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center', maxWidth: 320 },
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill, marginTop: spacing.xl,
    ...shadows.raised,
  },
  ctaText: { ...type.bodyBold, color: '#fff' },

  emptyInline: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  emptyInlineText: { ...type.body, color: palette.textMuted, flex: 1 },
});
