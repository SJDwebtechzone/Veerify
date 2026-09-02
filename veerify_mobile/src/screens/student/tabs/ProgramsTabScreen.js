// src/screens/student/tabs/ProgramsTabScreen.js
//
// Programs tab — every program offered by the currently-selected academy.
//
// Layout:
//   1. Header with academy selector (taps to SelectInstitution)
//   2. Search bar
//   3. Horizontal category chips (filter)
//   4. Featured Programs row
//   5. All Programs grid (2 columns)
//
// Each program card: thumbnail, title, trainer, duration, price, Preview +
// Enroll actions. Guests can browse; Enroll triggers a login/subscription
// popup (to be wired in Phase 2).

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  TextInput, ActivityIndicator, StyleSheet, Image, FlatList, Alert,
  StatusBar, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search, ChevronDown, ChevronRight, PlayCircle, Clock, Sparkles,
  GraduationCap, Building2, User,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import { useBellScrollHandler } from '../../../components/bellScrollBus';
import { confirm } from '../../../components/ConfirmDialog';

// Shared resolver — strips legacy embedded dev hosts (10.0.2.2:5000,
// localhost:5000, 127.0.0.1:5000) that got baked into DB rows before
// we started storing relative /uploads/ paths, and rewrites them to
// the current API base. Same helper used everywhere else so the
// legacy behavior only lives in one place.
import resolveAssetUrl from '../../../utils/assetUrl';
import CourseImage from '../../../components/CourseImage';

const ACCENTS = [palette.purple, palette.blue, palette.green, palette.orange, palette.pink, palette.teal];
const cycleAccent = (i) => ACCENTS[i % ACCENTS.length];

export default function ProgramsTabScreen({ navigation }) {
  const { user } = useAuth();
  const { selectedInstitution, loading: instLoading } = useInstitution();
  // Push the header below the Android status bar / iOS notch.
  const insets = useSafeAreaInsets();

  const [programs, setPrograms] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Every course the student is currently enrolled in, DEDUPED by
  // course id (a student can hold multiple enrolments in the same
  // course via different batches — the Courses tab should still
  // show that course as one card). Each entry mirrors the shape of
  // a /institutions/:id/programs row so the shared GridProgramCard
  // renders it verbatim.
  const [enrolledCourses, setEnrolledCourses] = useState([]);

  const isGuest = !user;

  const load = useCallback(async () => {
    try {
      // Global CMS categories — same chips across institutions.
      const catsRes = await apiClient.get('/cms/categories?active=true').catch(() => ({ data: { items: [] } }));
      setCategories(catsRes.data.items || []);

      if (selectedInstitution?.id) {
        const progRes = await apiClient
          .get(`/institutions/${selectedInstitution.id}/programs?limit=50`)
          .catch(() => ({ data: { programs: [] } }));
        setPrograms(progRes.data.programs || []);
      } else {
        setPrograms([]);
      }

      // ── Enrolled courses section ───────────────────────────────
      // Flat list of every course the student is enrolled in across
      // ANY institution — deduped by course_id so multiple batches
      // in the same course still show up as one card. Guests have
      // no enrolments so we skip the fetch.
      if (!isGuest) {
        try {
          const enrRes = await apiClient.get('/enrollments/my');
          const enrollments = enrRes.data?.enrollments || [];
          const byCourseId = new Map();
          for (const e of enrollments) {
            const cid = e.course_id;
            if (!cid || byCourseId.has(cid)) continue;
            byCourseId.set(cid, {
              // Shape matches /institutions/:id/programs so the
              // shared GridProgramCard renders it without a fork.
              id:                     cid,
              title:                  e.course_name || 'Course',
              image_url:              e.course_image_url || null,
              price:                  e.course_price || 0,
              trainer_name:           e.trainer_name || null,
              // Institution attribution for the sub-line beneath
              // the card title so the student sees WHICH academy
              // each enrolled course belongs to.
              institution_id:         e.institution_id,
              institution_name:       e.institution_name || null,
              institution_logo_url:   e.institution_logo_url || null,
              // The enrolment row's own id — needed to open the
              // shared EnrolledCourseScreen (used by Home → My
              // Courses) which is enrolment-scoped, not course-
              // scoped. Duplicate enrolments in the same course
              // resolve to the first row encountered so the tap
              // always navigates somewhere valid.
              enrollment_id:          e.id,
            });
          }
          setEnrolledCourses(Array.from(byCourseId.values()));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log('[Programs] enrolled-courses fetch failed:', err?.message);
          setEnrolledCourses([]);
        }
      } else {
        setEnrolledCourses([]);
      }
    } catch (err) {
      console.log('[Programs] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id, isGuest]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useEffect(() => { setLoading(true); load(); }, [selectedInstitution?.id, load]);

  // Filter + search
  const visible = useMemo(() => {
    let arr = programs;
    if (activeCategory) {
      arr = arr.filter((p) =>
        (p.category_id && Number(p.category_id) === Number(activeCategory.id)) ||
        (p.category && p.category.toLowerCase() === activeCategory.name?.toLowerCase()),
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((p) =>
        (p.title || p.name || '').toLowerCase().includes(q) ||
        (p.trainer_name || p.trainer || '').toLowerCase().includes(q),
      );
    }
    return arr;
  }, [programs, activeCategory, search]);

  // Featured section is no longer rendered on the new two-section
  // layout — the enrolled/other split subsumes it. Retained the
  // `visible` memo above only because a couple of unrelated
  // downstream consumers still reference it in this file.
  // eslint-disable-next-line no-unused-vars
  const _visibleUnused = visible;

  // Reusable filter — the search box + category chip drive both the
  // Enrolled Courses AND the More-at-institution sections so the
  // student's query narrows the whole screen consistently.
  const applyFilter = (arr) => {
    let out = arr || [];
    if (activeCategory) {
      out = out.filter((p) =>
        (p.category_id && Number(p.category_id) === Number(activeCategory.id)) ||
        (p.category && p.category.toLowerCase() === activeCategory.name?.toLowerCase()),
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((p) =>
        (p.title || p.name || '').toLowerCase().includes(q) ||
        (p.trainer_name || p.trainer || '').toLowerCase().includes(q),
      );
    }
    return out;
  };

  // Enrolled course ids — used to filter the "other courses" section
  // so nothing shows up twice on the same screen.
  const enrolledIdSet = useMemo(
    () => new Set(enrolledCourses.map((c) => Number(c.id))),
    [enrolledCourses],
  );
  const visibleEnrolled = useMemo(
    () => applyFilter(enrolledCourses),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [enrolledCourses, activeCategory, search]);
  // Programs at the currently-selected academy EXCLUDING every
  // course the student is already enrolled in. This is the "Other
  // courses offered by the student's own institution" bucket.
  const otherAtInstitution = useMemo(
    () => applyFilter(programs).filter((p) => !enrolledIdSet.has(Number(p.id))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [programs, enrolledIdSet, activeCategory, search]);

  const handleEnroll = (program) => {
    if (isGuest) {
      confirm({
        title: 'Login to Continue Learning',
        message: 'Sign in to enroll in this program and start your journey.',
        variant: 'destructive',
        confirmText: 'Login',
        cancelText: 'Not now',
        onConfirm: () => {
          try { navigation.navigate('Login'); return; } catch {}
          try { navigation.getParent()?.navigate('Login'); } catch {}
        },
      });
      return;
    }
    confirm({
      title: 'Subscribe to Unlock',
      message: 'You need an active subscription to enroll. Pick a plan from your Profile.',
      variant: 'warning',
      confirmText: 'View Plans',
      cancelText: 'Not now',
      onConfirm: () => navigation.navigate('Profile'),
    });
  };

  // ─── No institution chosen yet AND no enrolments to show ───
  // Students who ARE enrolled somewhere should always see their
  // enrolled courses on this tab, even before they pick a specific
  // academy to browse. Guests and never-enrolled users still land
  // on the "Pick your academy" nudge.
  if (!instLoading && !selectedInstitution && enrolledCourses.length === 0) {
    return (
      <View style={[styles.screen, styles.center, { padding: spacing.xxl }]}>
        <View style={styles.emptyIconWrap}>
          <Building2 size={36} color={palette.purple.vivid} strokeWidth={2.2} />
        </View>
        <Text style={styles.emptyTitle}>Pick your academy first</Text>
        <Text style={styles.emptyBody}>
          Programs are listed per academy. Choose one to see what's available.
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

  // ─── Initial load spinner ───
  if (loading && programs.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header — just the academy name + dropdown. The eyebrow line was
          dropped at the user's request so the header reads cleaner and
          there's nothing left to clip behind the status bar. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('SelectInstitution')}
          activeOpacity={0.85}
          style={styles.instSelector}
        >
          <Text style={styles.instText} numberOfLines={1}>
            {selectedInstitution?.name || 'My Courses'}
          </Text>
          <ChevronDown size={20} color={palette.purple.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search programs or trainers"
            placeholderTextColor={palette.textLight}
            style={styles.searchInput}
          />
        </View>

        {/* Categories */}
        {categories.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            >
              <CategoryChip
                label="All"
                emoji="✨"
                active={!activeCategory}
                onPress={() => setActiveCategory(null)}
                accent={palette.purple}
              />
              {categories.map((c, i) => (
                <CategoryChip
                  key={c.id}
                  label={c.name}
                  // Prefer the web-admin-uploaded image (mobile_categories.
                  // image_url) — resolveAssetUrl expands the relative
                  // "/uploads/…" path to a device-reachable URL. Falls
                  // back to the row's emoji, then a default 🥋 so the
                  // chip never renders blank.
                  imageUrl={c.image_url}
                  emoji={c.emoji || '🥋'}
                  active={activeCategory?.id === c.id}
                  onPress={() => setActiveCategory(c)}
                  accent={cycleAccent(i + 1)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Section 1 · My Enrolled Courses ─────────────────────
            Flat list of every course the student is currently
            enrolled in across ANY institution, deduped by course id.
            Shows a per-card institution attribution line so the
            student sees WHICH academy each enrolled course belongs
            to. Silent for guests (no enrolments). */}
        {enrolledCourses.length > 0 ? (
          <View style={{ marginTop: spacing.xl }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Enrolled Courses</Text>
              <Text style={styles.countText}>
                {enrolledCourses.length} course{enrolledCourses.length === 1 ? '' : 's'}
              </Text>
            </View>
            {visibleEnrolled.length === 0 ? (
              <View style={styles.emptyInlineTight}>
                <GraduationCap size={18} color={palette.textLight} strokeWidth={2} />
                <Text style={styles.emptyInlineText}>
                  No enrolled courses match your filter. Clear the search to see them all.
                </Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {visibleEnrolled.map((p, i) => (
                  <EnrolledCourseCard
                    key={`enr-${p.id}`}
                    program={p}
                    accent={cycleAccent(i)}
                    // Route to the same EnrolledCourseScreen used by
                    // Home → My Courses so the UX and functionality
                    // stay identical across both entry points. The
                    // enrolment id (not the course id) is what the
                    // shared screen expects. Falls back to
                    // CourseDetail if the row somehow lacked an
                    // enrolment id — defensive, shouldn't happen.
                    onPress={() => {
                      if (p.enrollment_id) {
                        navigation.navigate('EnrolledCourse', { enrollmentId: p.enrollment_id });
                      } else {
                        navigation.navigate('CourseDetail', { courseId: p.id });
                      }
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* Visual divider between the two sections so the student
            can immediately tell "enrolled" apart from "explore more".
            Silent when there's no enrolled section rendered above. */}
        {enrolledCourses.length > 0 ? <View style={styles.sectionDivider} /> : null}

        {/* ── Section 2 · Other Courses at [Own Institution] ──────
            Programs offered by the student's OWN academy that they
            aren't already enrolled in. Titled with the academy name
            so it's clear where these are coming from. When the
            student hasn't picked an academy yet we render a small
            "pick an academy to explore more" nudge INSTEAD of the
            regular grid, so the enrolled-courses section still
            reads as a complete answer above. */}
        <View style={{ marginTop: spacing.xl }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {selectedInstitution
                ? (enrolledCourses.length > 0
                    ? `More at ${selectedInstitution.name}`
                    : (activeCategory ? `${activeCategory.name} courses` : 'Available courses'))
                : 'Explore other courses'}
            </Text>
            {selectedInstitution ? (
              <Text style={styles.countText}>
                {otherAtInstitution.length} course{otherAtInstitution.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>

          {!selectedInstitution ? (
            <TouchableOpacity
              onPress={() => navigation.navigate('SelectInstitution')}
              activeOpacity={0.85}
              style={styles.emptyInline}
            >
              <Building2 size={22} color={palette.purple.vivid} strokeWidth={2} />
              <Text style={styles.emptyInlineText}>
                Pick an academy to browse the rest of their courses.
              </Text>
              <ChevronRight size={16} color={palette.textMuted} strokeWidth={2.4} />
            </TouchableOpacity>
          ) : otherAtInstitution.length === 0 ? (
            <View style={styles.emptyInline}>
              <GraduationCap size={22} color={palette.textLight} strokeWidth={2} />
              <Text style={styles.emptyInlineText}>
                {search || activeCategory
                  ? 'No other courses match your filters. Try clearing them.'
                  : (enrolledCourses.length > 0
                      ? "You're enrolled in every course this academy currently offers."
                      : 'No courses published yet. Check back soon.')}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {otherAtInstitution.map((p, i) => (
                <GridProgramCard
                  key={`other-${p.id}`}
                  program={p}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('CourseDetail', { courseId: p.id })}
                  onEnroll={() => handleEnroll(p)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EnrolledAcademySection — one row per academy the student has
// enrolled in. Shows the academy's name + logo (Home tab now renders
// for a deep dive) and every course the academy offers, filtered by
// the same search/category chips at the top of the screen.
// ─────────────────────────────────────────────────────────────────────
function EnrolledAcademySection({ academy, filtered, hasFilter, onOpenCourse, onEnroll }) {
  const [logoErr, setLogoErr] = useState(false);
  const logo = academy.logo_url && !logoErr
    ? resolveAssetUrl(academy.logo_url)
    : null;
  return (
    <View style={styles.academyBlock}>
      <View style={styles.academyHeader}>
        <View style={styles.academyLogo}>
          {logo ? (
            <Image
              source={{ uri: logo }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setLogoErr(true)}
            />
          ) : (
            <Building2 size={20} color={palette.purple.vivid} strokeWidth={2.2} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.academyName} numberOfLines={1}>{academy.name}</Text>
          <Text style={styles.academySub} numberOfLines={1}>
            {academy.city
              ? `${academy.city} · ${academy.programs?.length || 0} course${(academy.programs?.length || 0) === 1 ? '' : 's'}`
              : `${academy.programs?.length || 0} course${(academy.programs?.length || 0) === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyInlineTight}>
          <GraduationCap size={18} color={palette.textLight} strokeWidth={2} />
          <Text style={styles.emptyInlineText}>
            {hasFilter
              ? 'No courses match your filters at this academy.'
              : 'This academy has not published any courses yet.'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {filtered.map((p, i) => (
            <GridProgramCard
              key={`${academy.id}-${p.id}`}
              program={p}
              accent={cycleAccent(i)}
              onPress={() => onOpenCourse(p.id)}
              onEnroll={() => onEnroll(p)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function CategoryChip({ label, emoji, imageUrl, active, onPress, accent }) {
  // Track image load failure so a broken URL falls back gracefully to
  // the emoji instead of leaving a blank square. resolveAssetUrl already
  // handles /uploads/, localhost, and 127.0.0.1 rewrites.
  const [imgError, setImgError] = React.useState(false);
  const img = imageUrl && !imgError ? resolveAssetUrl(imageUrl) : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.catChip,
        { backgroundColor: active ? accent.vivid : accent.soft },
      ]}
    >
      {img ? (
        <Image
          source={{ uri: img }}
          onError={() => setImgError(true)}
          style={{
            width: 22, height: 22, borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.4)',
          }}
          resizeMode="cover"
        />
      ) : (
        <Text style={{ fontSize: 16 }}>{emoji}</Text>
      )}
      <Text style={[styles.catText, { color: active ? '#fff' : accent.on }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function FeaturedProgramCard({ program, accent, onPress, onEnroll }) {
  const coverUri = program.image_url || program.thumbnail_url;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.featuredCard}>
      <View style={[styles.featuredImage, { backgroundColor: accent.soft }]}>
        <CourseImage
          uri={coverUri}
          width="100%"
          height="100%"
          radius={0}
          fit="contain"
          icon="course"
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.featuredBadge, { backgroundColor: accent.vivid }]}>
          <Sparkles size={10} color="#fff" strokeWidth={2.6} />
          <Text style={styles.featuredBadgeText}>Featured</Text>
        </View>
      </View>
      <View style={{ padding: spacing.md, gap: 4 }}>
        <Text style={styles.programTitle} numberOfLines={2}>{program.title || program.name}</Text>
        <ProgramMeta program={program} />
        <View style={styles.programFooter}>
          <Text style={styles.programPrice}>
            {program.price ? `₹${parseInt(program.price).toLocaleString('en-IN')}` : 'Free'}
          </Text>
          <TouchableOpacity onPress={onEnroll} activeOpacity={0.85} style={[styles.enrollBtn, { backgroundColor: accent.vivid }]}>
            <Text style={styles.enrollBtnText}>Enroll</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function GridProgramCard({ program, accent, onPress, onEnroll }) {
  const coverUri = program.image_url || program.thumbnail_url;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.gridCard}>
      <View style={[styles.gridImage, { backgroundColor: accent.soft }]}>
        <CourseImage
          uri={coverUri}
          width="100%"
          height="100%"
          radius={0}
          fit="contain"
          icon="course"
          style={StyleSheet.absoluteFill}
        />
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onPress(); }}
          style={styles.previewBtn}
        >
          <PlayCircle size={14} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
      <View style={{ padding: spacing.sm, gap: 2 }}>
        <Text style={styles.gridTitle} numberOfLines={2}>{program.title || program.name}</Text>
        <Text style={styles.gridTrainer} numberOfLines={1}>
          {program.trainer_name || program.trainer || 'Veerify Trainer'}
        </Text>
        <View style={styles.gridFooter}>
          <Text style={styles.gridPrice}>
            {program.price ? `₹${parseInt(program.price).toLocaleString('en-IN')}` : 'Free'}
          </Text>
          <TouchableOpacity onPress={onEnroll} activeOpacity={0.85} style={[styles.gridEnroll, { backgroundColor: accent.soft }]}>
            <Text style={[styles.gridEnrollText, { color: accent.on }]}>Enroll</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// EnrolledCourseCard — dedicated card for the "My Enrolled Courses"
// grid. Same visual footprint as GridProgramCard so both grids
// tile cleanly, but purposely trades the Price + Enroll pair
// (irrelevant once you're already enrolled) for:
//   • an "Enrolled" pill, and
//   • the organising institution line right inside the card, so
//     the student sees "at {academy}" without a floating caption
//     underneath the card breaking the grid rhythm.
function EnrolledCourseCard({ program, accent, onPress }) {
  const coverUri = program.image_url || program.thumbnail_url;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.gridCard}>
      <View style={[styles.gridImage, { backgroundColor: accent.soft }]}>
        <CourseImage
          uri={coverUri}
          width="100%"
          height="100%"
          radius={0}
          fit="contain"
          icon="course"
          style={StyleSheet.absoluteFill}
        />
        {/* Enrolled ribbon sits top-left so it doesn't collide with
            the play button in the bottom-right. */}
        <View style={styles.enrolledRibbon}>
          <Text style={styles.enrolledRibbonText}>Enrolled</Text>
        </View>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onPress(); }}
          style={styles.previewBtn}
        >
          <PlayCircle size={14} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
      <View style={{ padding: spacing.sm, gap: 2 }}>
        <Text style={styles.gridTitle} numberOfLines={2}>{program.title || program.name}</Text>
        {program.trainer_name ? (
          <Text style={styles.gridTrainer} numberOfLines={1}>
            {program.trainer_name}
          </Text>
        ) : null}
        {program.institution_name ? (
          <View style={styles.enrolledInstRow}>
            <Building2 size={10} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.enrolledInstText} numberOfLines={1}>
              {program.institution_name}
            </Text>
          </View>
        ) : null}
        {/* Continue button intentionally removed — the whole card is
            already tappable via the outer TouchableOpacity, so a
            dedicated CTA was redundant. Tap anywhere on the card to
            open the course detail. */}
      </View>
    </TouchableOpacity>
  );
}

function ProgramMeta({ program }) {
  return (
    <View style={styles.metaRow}>
      <View style={styles.metaItem}>
        <User size={11} color={palette.textMuted} strokeWidth={2.2} />
        <Text style={styles.metaText} numberOfLines={1}>
          {program.trainer_name || program.trainer || 'Veerify Trainer'}
        </Text>
      </View>
      {program.duration ? (
        <View style={styles.metaItem}>
          <Clock size={11} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.metaText}>{program.duration}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header — generous bottom padding so the search bar below it has
  // clear breathing room from the academy name.
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  // Explicit large, bold, brand-coloured eyebrow so "PROGRAMS AT" can't
  // be missed. The previous 12 px muted grey was effectively invisible.
  eyebrow: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    color: palette.purple.vivid,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  instSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  instText: { ...type.display, color: palette.text, maxWidth: 260 },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    // Small top gap so the search bar is clearly separate from the
    // institution-selector header above it.
    marginTop: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  // Section
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...type.h2, color: palette.text },
  featuredHint: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },
  countText: { ...type.caption, color: palette.textMuted },

  // Category chip
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
  },
  catText: { ...type.bodyBold, fontWeight: '700' },

  // Featured card
  featuredCard: {
    width: 240,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  featuredImage: { width: '100%', height: 130, position: 'relative' },
  featuredBadge: {
    position: 'absolute',
    top: spacing.sm, left: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  featuredBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  // Generic program info
  programTitle: { ...type.h3, color: palette.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...type.caption, color: palette.textMuted },
  programFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  programPrice: { ...type.bodyBold, fontSize: 16, color: palette.purple.on },
  enrollBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  enrollBtnText: { ...type.caption, color: '#fff', fontWeight: '700' },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  gridCard: {
    width: '47%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  gridImage: { width: '100%', height: 110, position: 'relative' },
  previewBtn: {
    position: 'absolute',
    bottom: spacing.sm, right: spacing.sm,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  gridTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  gridTrainer: { ...type.caption, color: palette.textMuted, fontSize: 11 },
  gridFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 6,
  },
  gridPrice: { ...type.bodyBold, color: palette.purple.on, fontSize: 13 },
  gridEnroll: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  gridEnrollText: { fontSize: 10, fontWeight: '700' },

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
    borderRadius: radius.pill,
    marginTop: spacing.xl,
    ...shadows.raised,
  },
  ctaText: { ...type.bodyBold, color: '#fff' },

  emptyInline: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  emptyInlineText: { ...type.body, color: palette.textMuted, flex: 1 },
  emptyInlineTight: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl,
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    marginBottom: spacing.sm,
  },

  // Per-card institution attribution under enrolled courses.
  enrolledAt: {
    ...type.caption, color: palette.purple.on, fontWeight: '700',
    marginTop: 6, marginLeft: 4,
  },
  // Enrolled ribbon in the top-left of the card image.
  enrolledRibbon: {
    position: 'absolute',
    top: spacing.sm, left: spacing.sm,
    backgroundColor: palette.green.vivid,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  enrolledRibbonText: {
    fontSize: 10, fontWeight: '800', color: '#fff',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  // Institution attribution row inside the enrolled card.
  enrolledInstRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 2,
  },
  enrolledInstText: {
    ...type.caption, fontSize: 11, fontWeight: '700',
    color: palette.purple.on, flex: 1,
  },
  // Continue CTA replaces Price + Enroll on enrolled cards.
  continueBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  continueBtnText: {
    fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3,
  },
  // Divider between "My Enrolled Courses" and "More at [Institution]".
  sectionDivider: {
    height: 1, marginTop: spacing.xl,
    backgroundColor: palette.borderSoft,
    marginHorizontal: spacing.xl,
  },

  // ── Enrolled academy section (per academy under "My Academies") ──
  academyBlock: {
    marginBottom: spacing.lg,
  },
  academyHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.lg,
  },
  academyLogo: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  academyName: { ...type.h3, color: palette.text, fontSize: 15, fontWeight: '800' },
  academySub:  { ...type.caption, color: palette.textMuted, marginTop: 2, fontWeight: '600' },
});
