// src/screens/admin/tabs/StudentsTabScreen.js
//
// Students tab — every learner enrolled in this institution.
//
// Data: GET /api/enrollments/institution/me, then de-duplicated by student_id
//       (one row per student even if they're enrolled in multiple batches).
//       The same endpoint feeds the Payments tab, so a single fetch covers
//       both tabs in practice.
//
// Status: 'Active' = student has at least one paid enrollment; 'Inactive' =
//         everyone else (pending / failed payments).
//
// Empty state: shows when the institution has no enrolments yet.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, Image, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Search, SlidersHorizontal, ChevronRight, Users, UserPlus,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';
import PlanLimitModal from '../../../components/PlanLimitModal';

const TABS = ['All', 'Active', 'Inactive'];

// Rotate through theme accents so cards in the list have visual variety
// without needing a real per-student accent column on the DB.
const ACCENT_CYCLE = [
  palette.purple, palette.blue, palette.green, palette.orange,
  palette.pink, palette.teal, palette.rose,
];

// Resolve a backend-relative photo URL to something the device can render.
function resolvePhoto(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  const base = apiClient?.defaults?.baseURL?.replace(/\/api\/?$/, '') || '';
  return base + url;
}

export default function StudentsTabScreen({ navigation }) {
  const [search,     setSearch]     = useState('');
  const [tab,        setTab]        = useState('All');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [students,   setStudents]   = useState([]);

  // ── Plan-limit gate ─────────────────────────────────────────────
  // Same shape as TrainersListScreen: cache the latest usage so the
  // FAB can render a chip when capped, then re-check on every tap so
  // a stale cache can never let an admin slip past the limit.
  const [studentUsage,  setStudentUsage]  = useState(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [checkingCap,   setCheckingCap]   = useState(false);

  const refreshUsage = useCallback(async () => {
    try {
      const r = await apiClient.get('/plans/usage');
      const u = r?.data?.students || null;
      if (u) setStudentUsage(u);
      return u;
    } catch (err) {
      console.log('[StudentsTab] usage refresh failed:', err?.message);
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/enrollments/institution/me');
      const rows = res.data?.enrollments || [];

      // Collapse multiple enrolments into one student row each. We keep the
      // most recent enrolment's course/batch (newest-first ordering from the
      // backend means the first hit per student_id is the most recent).
      const byStudent = new Map();
      rows.forEach((e, idx) => {
        if (byStudent.has(e.student_id)) {
          const prev = byStudent.get(e.student_id);
          // Promote to active if ANY of their enrolments is paid.
          if (e.payment_status === 'paid') prev.active = true;
          return;
        }
        byStudent.set(e.student_id, {
          id:        e.student_id,
          name:      e.student_name || 'Unnamed student',
          email:     e.student_email || null,
          phone:     e.student_phone || null,
          course:    e.course_name || '—',
          batch:     e.batch_name || '',
          enrolled_at: e.enrolled_at,
          photo_url: resolvePhoto(e.student_photo_url),
          active:    e.payment_status === 'paid',
          accent:    ACCENT_CYCLE[idx % ACCENT_CYCLE.length],
        });
      });
      setStudents(Array.from(byStudent.values()));
    } catch (err) {
      console.log('[StudentsTab] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    refreshUsage();
  }, [load, refreshUsage]));

  // FAB tap — re-check /plans/usage synchronously so a stale cache or
  // late-arriving initial fetch can never let an admin past the cap.
  // Server-side enrolment still returns 402 PLAN_LIMIT_REACHED as the
  // ultimate safety net, but blocking here keeps the user from filling
  // out the whole enrolment form before being told there's no room.
  const handleAddStudentPress = async () => {
    if (checkingCap) return;
    setCheckingCap(true);
    try {
      const u = await refreshUsage();
      if (u && !u.unlimited && u.current >= u.limit) {
        setPlanModalOpen(true);
        return;
      }
    } finally {
      setCheckingCap(false);
    }
    navigation.navigate('EnrollmentForm', { adminMode: true });
  };

  const counts = useMemo(() => ({
    All:      students.length,
    Active:   students.filter((s) => s.active).length,
    Inactive: students.filter((s) => !s.active).length,
  }), [students]);

  const visible = useMemo(() => {
    let arr = students;
    if (tab === 'Active')   arr = arr.filter((s) => s.active);
    if (tab === 'Inactive') arr = arr.filter((s) => !s.active);
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.id).toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        s.course.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [search, tab, students]);

  const placeholder = (msg) => Alert.alert(msg, "We'll wire this up next.");

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Students</Text>
          <Text style={styles.subtitle}>{counts.All} total • {counts.Active} active</Text>
        </View>
        {/* Filter icon hidden — it just fired a placeholder alert and
            confused admins. Bring it back once the filter panel
            (by batch / payment status / etc.) is built.
        <TouchableOpacity
          onPress={() => placeholder('Filter')}
          style={styles.iconButton}
          activeOpacity={0.8}
        >
          <SlidersHorizontal size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        */}
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
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={palette.purple.vivid} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Users size={36} color={palette.textLight} strokeWidth={2} />
              <Text style={styles.emptyTitle}>
                {search
                  ? 'No matching students'
                  : students.length === 0
                    ? 'No enrolments yet'
                    : `No ${tab.toLowerCase()} students`}
              </Text>
              <Text style={styles.emptyBody}>
                {search
                  ? 'Try a different search term.'
                  : students.length === 0
                    ? 'Students will appear here once they enrol in one of your courses.'
                    : 'Switch tabs to see other students.'}
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
      )}

      {/* Opens the same EnrollmentForm a student fills when buying a
          course. adminMode: true tells the form to show an inline batch
          picker at the top so the admin can pick the batch first.

          handleAddStudentPress re-fetches /plans/usage on every tap;
          when the institution is already at its cap it pops the
          PlanLimitModal instead of opening the form, so the admin
          can't even start filling fields before being told to upgrade. */}
      <FAB
        icon={UserPlus}
        bottom={92}
        onPress={handleAddStudentPress}
        accent={palette.purple}
      />

      {/* Upgrade-plan modal — fires when /plans/usage shows the
          institution at or over its student cap. Mirrors the
          equivalent flow in TrainersListScreen. */}
      <PlanLimitModal
        visible={planModalOpen}
        kind="student"
        limit={studentUsage?.limit}
        current={studentUsage?.current}
        planName={studentUsage?.plan_name}
        onClose={() => setPlanModalOpen(false)}
        onUpgrade={() => {
          try { navigation.navigate('PlanSelection'); }
          catch { navigation.getParent()?.navigate('PlanSelection'); }
        }}
      />
    </View>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function StudentRow({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      <Avatar photoUrl={item.photo_url} name={item.name} accent={item.accent} />
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
        {item.email ? (
          <Text style={styles.studentId} numberOfLines={1}>{item.email}</Text>
        ) : null}
        <View style={styles.metaRow}>
          <View style={[styles.coursePill, { backgroundColor: item.accent.soft }]}>
            <Text style={[styles.coursePillText, { color: item.accent.on }]}>
              {item.course}
            </Text>
          </View>
          {item.batch ? (
            <Text style={styles.levelText} numberOfLines={1}>• {item.batch}</Text>
          ) : null}
        </View>
      </View>
      <ChevronRight size={18} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function Avatar({ photoUrl, name, accent }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, { backgroundColor: accent.soft, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={[styles.avatarInitial, { color: accent.on }]}>
        {(name || '?').charAt(0).toUpperCase()}
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
