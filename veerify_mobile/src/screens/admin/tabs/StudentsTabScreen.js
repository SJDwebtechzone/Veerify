// src/screens/admin/tabs/StudentsTabScreen.js
//
// Students tab — list every learner enrolled in the institution.
//
// Layout:
//   1. Header — "Students" title + count + filter icon button
//   2. Search bar (name / ID / course)
//   3. Segmented tabs: All / Active / Inactive (with live counts)
//   4. Scrollable list of student cards (avatar, name + ID, course + level
//      pill, status dot, chevron)
//   5. Floating action button (+) for adding a new student
//
// Placeholder dataset for now — we'll swap to GET /students once the screen
// design is locked across the rest of the institution-admin flow.

import React, { useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, Image, Alert,
} from 'react-native';
import {
  Search, SlidersHorizontal, ChevronRight, Users, UserPlus,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';

// ─── Placeholder data ────────────────────────────────────────────────────────
const STUDENTS = [
  { id: 'STU-1042', name: 'Aarav Sharma',    course: 'Karate',     level: 'Yellow Belt', active: true,  avatar: null, accent: palette.purple },
  { id: 'STU-1043', name: 'Priya Iyer',      course: 'Taekwondo',  level: 'Green Belt',  active: true,  avatar: null, accent: palette.blue },
  { id: 'STU-1044', name: 'Rohan Mehta',     course: 'BJJ',        level: 'White Belt',  active: true,  avatar: null, accent: palette.green },
  { id: 'STU-1045', name: 'Diya Krishnan',   course: 'Boxing',     level: 'Beginner',    active: false, avatar: null, accent: palette.orange },
  { id: 'STU-1046', name: 'Ishaan Kapoor',   course: 'Karate',     level: 'Orange Belt', active: true,  avatar: null, accent: palette.pink },
  { id: 'STU-1047', name: 'Ananya Reddy',    course: 'Kickboxing', level: 'Intermediate',active: true,  avatar: null, accent: palette.teal },
  { id: 'STU-1048', name: 'Kabir Singh',     course: 'BJJ',        level: 'Blue Belt',   active: true,  avatar: null, accent: palette.purple },
  { id: 'STU-1049', name: 'Saanvi Patel',    course: 'Taekwondo',  level: 'White Belt',  active: false, avatar: null, accent: palette.rose },
  { id: 'STU-1050', name: 'Vihaan Joshi',    course: 'Karate',     level: 'Yellow Belt', active: true,  avatar: null, accent: palette.blue },
  { id: 'STU-1051', name: 'Myra Choudhary',  course: 'Boxing',     level: 'Advanced',    active: true,  avatar: null, accent: palette.green },
];

const TABS = ['All', 'Active', 'Inactive'];

export default function StudentsTabScreen({ navigation }) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('All');

  const counts = useMemo(() => ({
    All:      STUDENTS.length,
    Active:   STUDENTS.filter(s => s.active).length,
    Inactive: STUDENTS.filter(s => !s.active).length,
  }), []);

  const visible = useMemo(() => {
    let arr = STUDENTS;
    if (tab === 'Active')   arr = arr.filter(s => s.active);
    if (tab === 'Inactive') arr = arr.filter(s => !s.active);
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.course.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [search, tab]);

  const placeholder = (msg) => Alert.alert(msg, "We'll wire this up next.");

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Students</Text>
          <Text style={styles.subtitle}>{counts.All} total • {counts.Active} active</Text>
        </View>
        <TouchableOpacity
          onPress={() => placeholder('Filter')}
          style={styles.iconButton}
          activeOpacity={0.8}
        >
          <SlidersHorizontal size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* ───── Search ───── */}
      <View style={styles.searchWrap}>
        <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, ID, or course"
          placeholderTextColor={palette.textLight}
          style={styles.searchInput}
        />
      </View>

      {/* ───── Tabs ───── */}
      <View style={styles.tabsWrap}>
        {TABS.map((t) => {
          const focused = tab === t;
          return (
            <TouchableOpacity
              key={t}
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
        })}
      </View>

      {/* ───── List ───── */}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Users size={36} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyTitle}>
              {search ? 'No matching students' : 'No students yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {search ? 'Try a different search term.' : 'Tap + to add your first student.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <StudentRow
            item={item}
            onPress={() => navigation.navigate('StudentDetail', { student: item })}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <FAB
        icon={UserPlus}
        bottom={92}
        onPress={() => placeholder('Add Student')}
        accent={palette.purple}
      />
    </View>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function StudentRow({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      <Avatar avatar={item.avatar} name={item.name} accent={item.accent} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.active ? palette.success : palette.textLight },
            ]}
          />
        </View>
        <Text style={styles.studentId}>{item.id}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.coursePill, { backgroundColor: item.accent.soft }]}>
            <Text style={[styles.coursePillText, { color: item.accent.on }]}>
              {item.course}
            </Text>
          </View>
          <Text style={styles.levelText}>• {item.level}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function Avatar({ avatar, name, accent }) {
  if (avatar) {
    return <Image source={{ uri: avatar }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, { backgroundColor: accent.soft, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={[styles.avatarInitial, { color: accent.on }]}>
        {name?.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
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

  // Search
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
  searchInput: {
    flex: 1,
    ...type.body,
    color: palette.text,
    padding: 0,
  },

  // Tabs
  tabsWrap: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
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

  // List
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 140,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 80,
    gap: spacing.sm,
  },
  emptyTitle: { ...type.h2, color: palette.text, marginTop: spacing.md },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: palette.purple.soft,
  },
  avatarInitial: { ...type.h2, fontWeight: '700' },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  statusDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  studentId: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  coursePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  coursePillText: { ...type.micro, fontWeight: '700' },
  levelText: { ...type.caption, color: palette.textMuted },
});
