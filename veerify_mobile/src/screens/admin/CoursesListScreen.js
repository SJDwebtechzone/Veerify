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

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/courses');
      setCourses(res.data.courses || []);
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
    // not the student-facing CourseDetail.
    navigation.navigate('AdminCourseDetail', { courseId: course.id });
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
          <Text style={styles.title}>My Courses</Text>
          <Text style={styles.subtitle}>
            {courses.length} {courses.length === 1 ? 'course' : 'courses'} published
          </Text>
        </View>
      </View>

      <FlatList
        data={courses}
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
            <BookOpen size={32} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No courses yet</Text>
            <Text style={styles.emptySub}>Tap the + button to publish your first course.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <CourseRow
            course={item}
            onView={() => onView(item)}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
          />
        )}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateCourse')}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" strokeWidth={2.6} />
      </TouchableOpacity>
    </View>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────
function CourseRow({ course, onView, onEdit, onDelete }) {
  const badge  = BADGE_STYLE[course.badge];
  const status = STATUS_STYLE[course.status] || STATUS_STYLE.active;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {course.image_url ? (
          <Image source={{ uri: resolveAssetUrl(course.image_url) }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <GraduationCap size={26} color={palette.purple.vivid} strokeWidth={1.8} />
          </View>
        )}

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
        <Text style={styles.priceLabel}>Monthly fee</Text>
        <Text style={styles.priceValue}>
          {course.price ? `₹${Number(course.price).toLocaleString('en-IN')}` : 'Free'}
        </Text>
      </View>

      <View style={styles.actions}>
        <ActionButton icon={Eye}    label="View"   accent={palette.blue}   onPress={onView} />
        <ActionButton icon={Pencil} label="Edit"   accent={palette.purple} onPress={onEdit} />
        <ActionButton icon={Trash2} label="Delete" accent={palette.rose}   onPress={onDelete} />
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

  // FAB
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.xl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.fab,
  },
});
