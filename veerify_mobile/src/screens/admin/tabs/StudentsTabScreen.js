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
  Search, SlidersHorizontal, ChevronRight, Users, UserPlus, Trash2,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import FAB from '../../../components/FAB';
import PlanLimitModal from '../../../components/PlanLimitModal';
import { confirm } from '../../../components/ConfirmDialog';
// Shared Institution-admin ambient background — light-blue wash
// + soft blue glow blobs. Same visual atmosphere as the Home
// screen so tabs read as one unified glassmorphism environment.
import InstitutionScreenBackground from '../../../components/InstitutionScreenBackground';

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

export default function StudentsTabScreen({ navigation, route }) {
  // Institution Home → Branch View passes { branchId, branchName } so
  // this tab renders only that branch's students. Falls back to the
  // whole-academy roster when the params are absent.
  const branchIdParam  = route?.params?.branchId ?? null;
  const branchNameParam = route?.params?.branchName ?? null;
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
      // Forward the branch filter when it was passed in. `null` → the
      // default (main / sub-branch-only) scope; a positive int locks
      // to that branch; `0` maps to "Main institution".
      const qs = branchIdParam != null
        ? `?branch_id=${encodeURIComponent(branchIdParam)}`
        : '';
      const res = await apiClient.get(`/enrollments/institution/me${qs}`);
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
  }, [branchIdParam]);

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

  // ── Delete student (institution + branch login) ──
  //
  // Opens the branded destructive confirm. On confirm, fires
  // DELETE /enrollments/student/:userId, which now PERMANENTLY removes
  // the student and every row linked to them (profile, enrolments,
  // attendance, payments, certificates, etc.) inside a transaction.
  // The confirmation copy is deliberately blunt so no admin
  // triggers the wipe accidentally.
  //
  // We drop the row from local state immediately for instant feedback
  // and show a success dialog. Any confirm() opened from within
  // another confirm's onConfirm is delayed by ~260ms so Android's
  // Modal animation doesn't swallow it.
  const handleDeleteStudent = (student) => {
    confirm({
      title: 'Permanently delete student?',
      message:
        `This will PERMANENTLY delete ${student.name} and every record ` +
        `linked to them — profile, enrolments, attendance, payments, ` +
        `certificates, and progress. This cannot be undone. ` +
        `Their email and phone become free for reuse afterwards.`,
      variant: 'destructive',
      confirmText: 'Delete permanently',
      cancelText: 'Cancel',
      onConfirm: () => {
        (async () => {
          try {
            await apiClient.delete(`/enrollments/student/${student.id}`);
            setStudents((prev) => prev.filter((s) => s.id !== student.id));
            // Free up a plan-slot on the cap counter.
            refreshUsage();
            setTimeout(() => {
              confirm({
                title: 'Student deleted',
                message: `${student.name} and all their data have been permanently removed.`,
                variant: 'success',
                confirmText: 'Done',
                hideCancel: true,
              });
            }, 260);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.log('[StudentsTab] delete failed:',
              err?.response?.status, err?.response?.data);
            setTimeout(() => {
              confirm({
                title: 'Could not delete',
                message:
                  err?.response?.data?.message ||
                  err?.message ||
                  'Something went wrong. Nothing was changed — please try again.',
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

  const placeholder = (msg) => Alert.alert(msg, "We'll wire this up next.");

  return (
    <View style={styles.screen}>
      {/* Shared ambient background — SVG wash + glow blobs painted
          behind everything. pointerEvents="none" inside, so taps
          continue to reach the header, search, list, and FAB. */}
      <InstitutionScreenBackground layer />
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Students</Text>
          <Text style={styles.subtitle}>
            {branchNameParam
              ? `${counts.All} total • ${branchNameParam}`
              : `${counts.All} total • ${counts.Active} active`}
          </Text>
        </View>
        {/* Branch filter reset — appears only when we've been passed a
            branchId. Tapping clears the params so the tab reloads with
            the full academy roster. */}
        {branchIdParam != null ? (
          <TouchableOpacity
            onPress={() => navigation.setParams({ branchId: null, branchName: null })}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1F5F9' }}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 11, color: '#334155', fontWeight: '800' }}>Clear branch</Text>
          </TouchableOpacity>
        ) : null}
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
              onDelete={() => handleDeleteStudent(item)}
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
function StudentRow({ item, onPress, onDelete }) {
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
      {/* Right-side actions. Delete stops propagation so tapping it
          doesn't drill into the profile. The chevron stays as the
          "tap the row to open" affordance for the rest of the card. */}
      <View style={styles.rowActions}>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onDelete && onDelete(); }}
          hitSlop={6}
          activeOpacity={0.75}
          style={styles.rowDeleteBtn}
        >
          <Trash2 size={14} color={palette.rose.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
        <ChevronRight size={18} color={palette.textLight} strokeWidth={2} />
      </View>
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
  // Base fill matches the shared Institution ambient background
  // so there's no flash of the old grey/white before the SVG layer
  // paints on first frame.
  screen: { flex: 1, backgroundColor: '#F1F6FB' },

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
  // Icon button — glass chip so it matches the Home identity card's
  // premium blue-tinted glass language rather than reading as a
  // solid white circle.
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderRightColor: 'rgba(255,255,255,0.6)',
    borderBottomColor: 'rgba(255,255,255,0.6)',
    borderLeftColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
    // Cool blue shadow — reads as glass caught in ambient light
    // (matches the shadow language on Home's stat cards).
    shadowColor: '#1E40AF',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  // Search — frosted glass bar. The ambient blue background shows
  // through faintly so the bar reads as a translucent panel rather
  // than a solid white pill.
  searchWrap: {
    marginHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderRightColor: 'rgba(255,255,255,0.6)',
    borderBottomColor: 'rgba(255,255,255,0.6)',
    borderLeftColor: 'rgba(255,255,255,0.6)',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    shadowColor: '#1E40AF',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
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
  // Inactive tab — translucent glass pill so the ambient background
  // shows through. Active tab keeps the brand red so the Students
  // section's identity color still leads the eye.
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  tabFocused: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  tabText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  tabTextFocused: { color: '#fff' },
  tabBadge: {
    minWidth: 22, height: 20, paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(148,163,184,0.22)',
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

  // Student row — premium glass card. Translucent white surface so
  // the ambient light-blue background bleeds through and the card
  // reads as genuine glass, not a flat white panel. Bright glossy
  // top-edge highlight, cool-blue drop-shadow, softer sides.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderRightColor: 'rgba(255,255,255,0.6)',
    borderBottomColor: 'rgba(255,255,255,0.6)',
    borderLeftColor: 'rgba(255,255,255,0.6)',
    borderRadius: radius.xl,
    padding: spacing.lg,
    // Cool-blue drop-shadow so the card feels lifted off the
    // ambient blue background — same shadow language as the Home
    // stat cards.
    shadowColor: '#1E40AF',
    shadowOpacity: 0.11,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
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

  // Right side of the card — trash button + chevron. Stacked with a
  // small gap so the trash target stays comfortably far from the tap-
  // to-open row target.
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowDeleteBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: palette.rose.soft,
    alignItems: 'center', justifyContent: 'center',
  },
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
