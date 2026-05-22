// src/screens/admin/tabs/BatchesTabScreen.js
//
// Batches tab — every batch the institution runs (current + planned + finished).
//
// Layout:
//   1. Header — "Batches" title + count + filter icon
//   2. Search bar (name / course / trainer)
//   3. Four-segment tabs: All / Running / Upcoming / Completed (live counts)
//   4. Scrollable list of batch cards (name, status badge, course pill, trainer,
//      timing, days, capacity progress bar, chevron)
//   5. FAB (+) for creating a batch
//
// Placeholder dataset; backend wiring comes later when we standardize the
// /batches GET endpoint shape across the institution-admin flow.

import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import {
  Search, SlidersHorizontal, ChevronRight, CalendarRange,
  Clock, User, Users, CalendarPlus,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';

// ─── Placeholder data ────────────────────────────────────────────────────────
const BATCHES = [
  {
    id: 'B-12', name: 'Karate Beginners B-12', course: 'Karate',
    trainer: 'Suresh Sensei', timing: '6:00 PM – 7:30 PM',
    days: 'Mon, Wed, Fri', enrolled: 18, capacity: 25,
    status: 'running', accent: palette.purple,
  },
  {
    id: 'B-15', name: 'Taekwondo Intermediate', course: 'Taekwondo',
    trainer: 'Anita Reddy', timing: '5:00 PM – 6:30 PM',
    days: 'Tue, Thu, Sat', enrolled: 22, capacity: 24,
    status: 'running', accent: palette.blue,
  },
  {
    id: 'B-18', name: 'BJJ Fundamentals', course: 'BJJ',
    trainer: 'Mike Thompson', timing: '7:00 PM – 8:30 PM',
    days: 'Mon, Wed, Fri', enrolled: 10, capacity: 20,
    status: 'running', accent: palette.green,
  },
  {
    id: 'B-21', name: 'Boxing Basics — Summer', course: 'Boxing',
    trainer: 'Rajesh Kumar', timing: '6:30 PM – 7:30 PM',
    days: 'Mon to Fri', enrolled: 0, capacity: 30,
    status: 'upcoming', accent: palette.orange, startDate: '01 Jun',
  },
  {
    id: 'B-22', name: 'Karate Advanced — Black Belt Prep', course: 'Karate',
    trainer: 'Suresh Sensei', timing: '7:00 AM – 8:30 AM',
    days: 'Tue, Thu, Sat', enrolled: 3, capacity: 12,
    status: 'upcoming', accent: palette.pink, startDate: '08 Jun',
  },
  {
    id: 'B-09', name: 'Kickboxing Cardio Bootcamp', course: 'Kickboxing',
    trainer: 'Priya Iyer', timing: '6:00 AM – 7:00 AM',
    days: 'Mon to Sat', enrolled: 18, capacity: 20,
    status: 'completed', accent: palette.teal, endDate: '30 Apr',
  },
  {
    id: 'B-07', name: 'Taekwondo Beginners — Winter Cohort', course: 'Taekwondo',
    trainer: 'Anita Reddy', timing: '5:30 PM – 6:30 PM',
    days: 'Mon, Wed, Fri', enrolled: 25, capacity: 25,
    status: 'completed', accent: palette.rose, endDate: '15 Mar',
  },
];

const TABS = ['All', 'Running', 'Upcoming', 'Completed'];

const STATUS_META = {
  running:   { color: palette.green,  label: 'Running'   },
  upcoming:  { color: palette.blue,   label: 'Upcoming'  },
  completed: { color: palette.textLight ? palette.purple : palette.purple, label: 'Completed' },
};
// Note: completed uses a desaturated treatment — overridden below where needed.

export default function BatchesTabScreen() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('All');

  const counts = useMemo(() => ({
    All:       BATCHES.length,
    Running:   BATCHES.filter(b => b.status === 'running').length,
    Upcoming:  BATCHES.filter(b => b.status === 'upcoming').length,
    Completed: BATCHES.filter(b => b.status === 'completed').length,
  }), []);

  const visible = useMemo(() => {
    let arr = BATCHES;
    if (tab !== 'All') arr = arr.filter(b => b.status === tab.toLowerCase());
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(b =>
        b.name.toLowerCase().includes(q) ||
        b.course.toLowerCase().includes(q) ||
        b.trainer.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [search, tab]);

  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Batches</Text>
          <Text style={styles.subtitle}>
            {counts.All} total • {counts.Running} running now
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => placeholder('Filter')}
          style={styles.iconButton}
          activeOpacity={0.8}
        >
          <SlidersHorizontal size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by batch, course, or trainer"
          placeholderTextColor={palette.textLight}
          style={styles.searchInput}
        />
      </View>

      {/* Tabs */}
      <View style={styles.tabsWrap}>
        <FlatList
          data={TABS}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
          keyExtractor={(t) => t}
          renderItem={({ item: t }) => {
            const focused = tab === t;
            return (
              <TouchableOpacity
                onPress={() => setTab(t)}
                activeOpacity={0.85}
                style={[styles.tab, focused && styles.tabFocused]}
              >
                <Text style={[styles.tabText, focused && styles.tabTextFocused]}>
                  {t}
                </Text>
                <View style={[styles.tabBadge, focused && styles.tabBadgeFocused]}>
                  <Text style={[styles.tabBadgeText, focused && styles.tabBadgeTextFocused]}>
                    {counts[t]}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* List */}
      <FlatList
        data={visible}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <CalendarRange size={36} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyTitle}>
              {search ? 'No matching batches' : 'No batches yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {search ? 'Try a different search term.' : 'Tap + to create your first batch.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <BatchCard batch={item} onPress={() => placeholder(item.name)} />
        )}
        showsVerticalScrollIndicator={false}
      />

      <FAB
        icon={CalendarPlus}
        bottom={92}
        onPress={() => placeholder('Create Batch')}
        accent={palette.purple}
      />
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
function BatchCard({ batch, onPress }) {
  const fillRatio = batch.capacity > 0 ? Math.min(batch.enrolled / batch.capacity, 1) : 0;
  const nearlyFull = fillRatio >= 0.85;

  const status = STATUS_META[batch.status] || STATUS_META.running;
  // Override 'completed' visual to a desaturated treatment.
  const statusVisual = batch.status === 'completed'
    ? { soft: palette.borderSoft, vivid: palette.textMuted, on: palette.textMuted }
    : status.color;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      {/* Top row: name + status badge */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={styles.batchId}>{batch.id}</Text>
          <Text style={styles.batchName} numberOfLines={2}>{batch.name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusVisual.soft }]}>
          <View style={[styles.statusDot, { backgroundColor: statusVisual.vivid }]} />
          <Text style={[styles.statusBadgeText, { color: statusVisual.on }]}>
            {status.label}
          </Text>
        </View>
      </View>

      {/* Course pill */}
      <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
        <View style={[styles.coursePill, { backgroundColor: batch.accent.soft }]}>
          <Text style={[styles.coursePillText, { color: batch.accent.on }]}>
            {batch.course}
          </Text>
        </View>
      </View>

      {/* Trainer + Timing + Days */}
      <View style={styles.metaGrid}>
        <MetaItem icon={User}          label="Trainer" value={batch.trainer} />
        <MetaItem icon={Clock}         label="Timing"  value={batch.timing} />
        <MetaItem icon={CalendarRange} label="Days"    value={batch.days} />
      </View>

      {/* Capacity progress bar */}
      <View style={styles.capacityWrap}>
        <View style={styles.capacityRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Users size={14} color={palette.textMuted} strokeWidth={2.2} />
            <Text style={styles.capacityText}>
              {batch.enrolled} / {batch.capacity} students
            </Text>
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
                backgroundColor: nearlyFull ? palette.orange.vivid : batch.accent.vivid,
              },
            ]}
          />
        </View>
      </View>

      {/* Footer note + chevron */}
      <View style={styles.footerRow}>
        <Text style={styles.footerNote}>
          {batch.status === 'upcoming'  && batch.startDate && `Starts ${batch.startDate}`}
          {batch.status === 'completed' && batch.endDate   && `Ended ${batch.endDate}`}
          {batch.status === 'running'   && 'In session'}
        </Text>
        <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
      </View>
    </TouchableOpacity>
  );
}

function MetaItem({ icon: Icon, label, value }) {
  return (
    <View style={styles.metaItem}>
      <Icon size={14} color={palette.textMuted} strokeWidth={2.2} />
      <View style={{ flex: 1 }}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },

  searchWrap: {
    marginHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  tabsWrap: { paddingVertical: spacing.lg },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  tabFocused: { backgroundColor: palette.purple.vivid },
  tabText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  tabTextFocused: { color: '#fff' },
  tabBadge: {
    minWidth: 22, height: 20, paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeFocused: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { ...type.micro, color: palette.textMuted },
  tabBadgeTextFocused: { color: '#fff' },

  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 140 },
  empty: { alignItems: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyTitle: { ...type.h2, color: palette.text, marginTop: spacing.md },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  batchId: { ...type.micro, color: palette.textMuted, marginBottom: 4 },
  batchName: { ...type.h3, color: palette.text },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { ...type.micro, fontWeight: '700' },

  coursePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  coursePillText: { ...type.micro, fontWeight: '700' },

  metaGrid: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaLabel: { ...type.micro, color: palette.textMuted },
  metaValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },

  capacityWrap: { marginTop: spacing.lg },
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  capacityText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  capacityPercent: { ...type.caption, fontWeight: '700' },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  footerNote: { ...type.caption, color: palette.textMuted },
});
