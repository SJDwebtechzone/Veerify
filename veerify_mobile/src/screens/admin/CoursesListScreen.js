// src/screens/admin/CoursesListScreen.js
//
// Admin's master list of all courses published by their academy. Hit from
// More tab → "Courses".
//
// Each row supports:
//   View   → opens the same student-facing CourseDetail (admin preview mode)
//   Edit   → opens CreateCourse pre-filled with the course (route param)
//   Delete → soft confirm + DELETE /api/courses/:id
//
// Pulls from GET /api/courses (admin auth, returns this institution's courses).

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, RefreshControl,
  ActivityIndicator, Image, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  BookOpen, Eye, Pencil, Trash2, Plus, Clock, Users, Globe2, Star,
  GraduationCap,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { useBellScrollHandler } from '../../components/bellScrollBus';
import CourseImage from '../../components/CourseImage';
import { billingCycleLabel } from '../../utils/billingCycle';

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

const MODE_LABEL = { online: 'Online', offline: 'Offline', hybrid: 'Hybrid' };
const BADGE_STYLE = {
  popular:      { label: 'Popular',      bg: palette.purple.vivid },
  new:          { label: 'New',          bg: palette.green.vivid  },
  kids_special: { label: 'Kids Special', bg: palette.orange.vivid },
};
const STATUS_STYLE = {
  active:   { label: 'Active',   bg: palette.green.soft,  fg: palette.green.on  },
  draft:    { label: 'Draft',    bg: palette.orange.soft, fg: palette.orange.on },
  inactive: { label: 'Inactive', bg: palette.rose.soft,   fg: palette.rose.on   },
};

export default function CoursesListScreen({ navigation }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Sub-branch admins get a read-only view of the courses their branch
  // handles (courses that have at least one batch pinned to their
  // branch). No Edit / Delete / FAB — the catalog is owned by the main
  // institution and edits ripple across branches, so branch admins
  // shouldn't be able to change it.
  const [isSubBranch, setIsSubBranch] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/courses');
      setCourses(res.data.courses || []);
      setIsSubBranch(!!res.data.is_sub_branch);
    } catch (err) {
      console.log('[CoursesList] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onView = (course) => {
    // Admin gets the operational detail screen (batches, students, revenue),
    // not the student-facing CourseDetail. `readOnly` mirrors the list-side
    // flag so a sub-branch admin who tapped View doesn't get an Edit /
    // Delete option on the detail screen either.
    navigation.navigate('AdminCourseDetail', {
      courseId: course.id,
      readOnly: isSubBranch,
    });
  };
  const onEdit = (course) => {
    navigation.navigate('CreateCourse', { courseId: course.id, course });
  };
  const onDelete = (course) => {
    Alert.alert(
      'Delete course?',
      `"${course.name}" will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/courses/${course.id}`);
              setCourses((prev) => prev.filter((c) => c.id !== course.id));
            } catch (err) {
              Alert.alert('Could not delete', err.response?.data?.message || err.message || 'Try again');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{isSubBranch ? 'Courses at this branch' : 'My Courses'}</Text>
          <Text style={styles.subtitle}>
            {isSubBranch
              ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'} handled here`
              : `${courses.length} ${courses.length === 1 ? 'course' : 'courses'} published`}
          </Text>
        </View>
      </View>

      <FlatList
        data={courses}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <BookOpen size={32} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {isSubBranch ? 'No courses assigned' : 'No courses yet'}
            </Text>
            <Text style={styles.emptySub}>
              {isSubBranch
                ? 'Courses show up here once a batch under one of them is pinned to this branch.'
                : 'Tap the + button to publish your first course.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <CourseRow
            course={item}
            readOnly={isSubBranch}
            onView={() => onView(item)}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
          />
        )}
      />

      {/* FAB is main-admin only. Branch admins can't publish courses. */}
      {isSubBranch ? null : (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('CreateCourse')}
          activeOpacity={0.9}
        >
          <Plus size={24} color="#fff" strokeWidth={2.6} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────
function CourseRow({ course, onView, onEdit, onDelete, readOnly }) {
  const badge  = BADGE_STYLE[course.badge];
  const status = STATUS_STYLE[course.status] || STATUS_STYLE.active;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <CourseImage
          uri={course.image_url}
          size={64}
          radius={radius.md}
        />

        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.courseName} numberOfLines={1}>{course.name}</Text>
            <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
            </View>
          </View>
          {course.category ? <Text style={styles.category}>{course.category}</Text> : null}

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Globe2 size={11} color={palette.textMuted} />
              <Text style={styles.metaText}>{MODE_LABEL[course.mode] || 'Offline'}</Text>
            </View>
            {course.level ? (
              <View style={styles.metaItem}>
                <Star size={11} color={palette.textMuted} />
                <Text style={styles.metaText}>{course.level}</Text>
              </View>
            ) : null}
            {course.duration_months ? (
              <View style={styles.metaItem}>
                <Clock size={11} color={palette.textMuted} />
                <Text style={styles.metaText}>{course.duration_months}mo</Text>
              </View>
            ) : null}
            {course.age_group ? (
              <View style={styles.metaItem}>
                <Users size={11} color={palette.textMuted} />
                <Text style={styles.metaText}>{course.age_group}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {badge ? (
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={styles.badgeText}>{badge.label}</Text>
        </View>
      ) : null}

      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>{billingCycleLabel(course.billing_cycle)}</Text>
        <Text style={styles.priceValue}>
          {course.price ? `₹${Number(course.price).toLocaleString('en-IN')}` : 'Free'}
        </Text>
      </View>

      <View style={styles.actions}>
        {/* Sub-branch admins only see View — the catalog is owned by
            the main institution, so Edit/Delete are hidden here. */}
        <ActionButton icon={Eye}    label="View"   accent={palette.blue}   onPress={onView} />
        {readOnly ? null : (
          <>
            <ActionButton icon={Pencil} label="Edit"   accent={palette.purple} onPress={onEdit} />
            <ActionButton icon={Trash2} label="Delete" accent={palette.rose}   onPress={onDelete} />
          </>
        )}
      </View>
    </View>
  );
}

function ActionButton({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: accent.soft }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon size={14} color={accent.on} strokeWidth={2.4} />
      <Text style={[styles.actionText, { color: accent.on }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // Empty
  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 8,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: palette.borderSoft },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  courseName: { ...type.h2, color: palette.text, flex: 1 },
  category: { ...type.caption, color: palette.purple.vivid, fontWeight: '600', marginTop: 2 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { ...type.micro, color: palette.textMuted, fontWeight: '600' },

  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  statusPillText: { ...type.micro, fontWeight: '700' },

  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  badgeText: { ...type.micro, color: '#fff', fontWeight: '700' },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    marginTop: spacing.sm,
  },
  priceLabel: { ...type.caption, color: palette.textMuted },
  priceValue: { ...type.h2, color: palette.purple.vivid, fontWeight: '800' },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  actionText: { ...type.caption, fontWeight: '700' },

  // FAB — sits above the bottom tab bar. spacing.xl alone (~20pt) was
  // hidden behind the tabs (≈60–80pt) so the user couldn't see the +
  // button at all on the Courses tab. Bumping to ~90pt clears the bar
  // on both Android and iOS without overlapping the last list row.
  fab: {
    position: 'absolute',
    bottom: 90,
    right: spacing.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.fab,
  },
});
