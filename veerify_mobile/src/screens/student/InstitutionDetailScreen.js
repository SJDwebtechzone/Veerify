// src/screens/student/InstitutionDetailScreen.js
//
// Guest / student lands here after tapping an academy from the Home tab.
// Shows the academy header + the full list of courses that academy has
// published (status='active' on the server side).
//
// Each course card surfaces:
//   - Optional badge (Popular / New / Kids Special) in the corner
//   - Mode pill (Online / Offline / Hybrid)
//   - Title + category
//   - Short description (or first line of full description)
//   - Level, Age group, Duration meta row
//   - Monthly fee + chevron
//
// Tap → CourseDetail.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import {
  MapPin, Phone, Mail, ChevronRight, Star, Clock,
  Users, GraduationCap, Globe2, Building2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  if (src.includes('://localhost:') || src.includes('://127.0.0.1:')) {
    return src.replace(/:\/\/(localhost|127\.0\.0\.1)(?=[:\/])/, '://10.0.2.2');
  }
  return src;
}

const BADGE_STYLE = {
  popular:      { label: 'Popular',      bg: '#ef4444', fg: '#fff' },
  new:          { label: 'New',          bg: palette.green.vivid, fg: '#fff' },
  kids_special: { label: 'Kids Special', bg: palette.orange.vivid, fg: '#fff' },
};

const MODE_STYLE = {
  online:  { label: 'Online',  accent: palette.blue   },
  offline: { label: 'Offline', accent: palette.purple },
  hybrid:  { label: 'Hybrid',  accent: palette.teal   },
};

export default function InstitutionDetailScreen({ route, navigation }) {
  const { institutionId } = route.params;
  const [institution, setInstitution] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [instRes, coursesRes] = await Promise.all([
        apiClient.get(`/institutions/${institutionId}`),
        apiClient.get(`/courses/institution/${institutionId}`),
      ]);
      setInstitution(instRes.data.institution);
      setCourses(coursesRes.data.courses || []);
    } catch (err) {
      console.log('[InstitutionDetail] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }
  if (!institution) {
    return <View style={styles.center}><Text style={styles.notFoundText}>Academy not found</Text></View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.purple.vivid} />}
    >
      {/* ───── Academy header card ───── */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          {institution.logo_url ? (
            <Image source={{ uri: resolveAssetUrl(institution.logo_url) }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoPlaceholder]}>
              <Building2 size={28} color={palette.purple.vivid} strokeWidth={2.2} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.academyName} numberOfLines={2}>{institution.name}</Text>
            {institution.city ? (
              <View style={styles.metaRow}>
                <MapPin size={12} color={palette.textMuted} />
                <Text style={styles.metaText}>{institution.city}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {institution.description ? (
          <Text style={styles.description} numberOfLines={3}>{institution.description}</Text>
        ) : null}

        <View style={styles.contactRow}>
          {institution.phone ? (
            <View style={styles.contactItem}>
              <Phone size={13} color={palette.purple.vivid} strokeWidth={2.2} />
              <Text style={styles.contactText} numberOfLines={1}>{institution.phone}</Text>
            </View>
          ) : null}
          {institution.email ? (
            <View style={styles.contactItem}>
              <Mail size={13} color={palette.purple.vivid} strokeWidth={2.2} />
              <Text style={styles.contactText} numberOfLines={1}>{institution.email}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ───── Courses ───── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Courses Offered</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{courses.length}</Text>
        </View>
      </View>

      {courses.length === 0 ? (
        <View style={styles.emptyCard}>
          <GraduationCap size={28} color={palette.textLight} strokeWidth={2} />
          <Text style={styles.emptyTitle}>No courses yet</Text>
          <Text style={styles.emptySub}>This academy hasn't published any courses.</Text>
        </View>
      ) : (
        courses.map((c) => (
          <CourseCard key={c.id} course={c} onPress={() => navigation.navigate('CourseDetail', { courseId: c.id })} />
        ))
      )}
    </ScrollView>
  );
}

// ── Course card ──────────────────────────────────────────────────────────────
function CourseCard({ course, onPress }) {
  const badge = BADGE_STYLE[course.badge];
  const mode = MODE_STYLE[course.mode] || MODE_STYLE.offline;
  const ageGroup = course.age_group || null;
  const fee = course.price ? `₹${Number(course.price).toLocaleString('en-IN')}` : 'Free';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.courseCard}>
      {/* Cover image / placeholder banner */}
      {course.image_url ? (
        <Image source={{ uri: resolveAssetUrl(course.image_url) }} style={styles.courseImage} />
      ) : (
        <View style={[styles.courseImage, styles.courseImagePlaceholder]}>
          <GraduationCap size={36} color={palette.purple.vivid} strokeWidth={1.6} />
        </View>
      )}

      {/* Badge corner */}
      {badge ? (
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      ) : null}

      <View style={styles.courseBody}>
        {/* Title row + price */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.courseTitle} numberOfLines={1}>{course.name}</Text>
            {course.category ? <Text style={styles.courseCategory}>{course.category}</Text> : null}
          </View>
          <View style={styles.priceWrap}>
            <Text style={styles.priceValue}>{fee}</Text>
            {course.price ? <Text style={styles.pricePer}>/month</Text> : null}
          </View>
        </View>

        {/* Description */}
        {course.short_description || course.description ? (
          <Text style={styles.courseDesc} numberOfLines={2}>
            {course.short_description || course.description}
          </Text>
        ) : null}

        {/* Meta pills */}
        <View style={styles.pillRow}>
          <View style={[styles.modePill, { backgroundColor: mode.accent.soft }]}>
            <Globe2 size={11} color={mode.accent.on} strokeWidth={2.4} />
            <Text style={[styles.modePillText, { color: mode.accent.on }]}>{mode.label}</Text>
          </View>
          {course.level ? (
            <View style={styles.levelPill}>
              <Star size={11} color={palette.purple.on} strokeWidth={2.4} />
              <Text style={styles.levelPillText}>{course.level}</Text>
            </View>
          ) : null}
        </View>

        {/* Bottom meta row */}
        <View style={styles.bottomMeta}>
          {ageGroup ? (
            <View style={styles.metaIconRow}>
              <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.metaIconText}>{ageGroup}</Text>
            </View>
          ) : null}
          {course.duration_months ? (
            <View style={styles.metaIconRow}>
              <Clock size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.metaIconText}>{course.duration_months} {course.duration_months === 1 ? 'Month' : 'Months'}</Text>
            </View>
          ) : null}
          <ChevronRight size={16} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg },
  notFoundText: { ...type.body, color: palette.textMuted },

  // Header card
  headerCard: {
    backgroundColor: palette.surface,
    margin: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  logo: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.borderSoft },
  logoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  academyName: { ...type.h1, color: palette.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  metaText: { ...type.caption, color: palette.textMuted },

  description: {
    ...type.body,
    color: palette.text,
    lineHeight: 22,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  contactRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap', marginTop: 4 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contactText: { ...type.caption, color: palette.textMuted, maxWidth: 180 },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitle: { ...type.h2, color: palette.text, fontWeight: '700' },
  countPill: {
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  countPillText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  // Empty
  emptyCard: {
    backgroundColor: palette.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 8,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // Course card
  courseCard: {
    backgroundColor: palette.surface,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  courseImage: { width: '100%', height: 140, backgroundColor: palette.borderSoft },
  courseImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },

  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { ...type.micro, fontWeight: '700', textTransform: 'uppercase' },

  courseBody: { padding: spacing.md },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: 6 },
  courseTitle: { ...type.h2, color: palette.text, fontWeight: '700' },
  courseCategory: { ...type.caption, color: palette.purple.vivid, fontWeight: '600', marginTop: 2 },
  priceWrap: { alignItems: 'flex-end' },
  priceValue: { ...type.h2, color: palette.text, fontWeight: '800' },
  pricePer: { ...type.micro, color: palette.textMuted, marginTop: -2 },

  courseDesc: { ...type.caption, color: palette.textMuted, lineHeight: 18, marginBottom: spacing.sm },

  pillRow: { flexDirection: 'row', gap: 6, marginBottom: spacing.sm, flexWrap: 'wrap' },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  modePillText: { ...type.micro, fontWeight: '700' },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  levelPillText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  bottomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  metaIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  metaIconText: { ...type.caption, color: palette.textMuted },
});
