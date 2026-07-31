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
  // Academies the student has enrolled in (or paid for). Each entry is
  // { id, name, logo_url, city, programs: [] } — the programs array is
  // hydrated with the FULL course catalogue offered by that academy so
  // the student sees every course, not just the ones they enrolled in.
  const [enrolledAcademies, setEnrolledAcademies] = useState([]);

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

      // ── Enrolled academies section ───────────────────────────────
      // Guests don't have enrollments — skip the fetch and render only
      // the browse-by-academy path below. For logged-in students, pull
      // /enrollments/my, collapse to unique institutions, then fetch
      // each academy's full course catalogue so we can list ALL their
      // courses under the academy header (not just the enrolled ones).
      if (!isGuest) {
        try {
          const enrRes = await apiClient.get('/enrollments/my');
          const enrollments = enrRes.data?.enrollments || [];
          // Collapse to unique academies. Prefer the enrolment's
          // root_institution_id when present (sub-branch enrolments
          // still map to the parent academy on the student's Courses
          // screen); fall back to institution_id.
          const byId = new Map();
          for (const e of enrollments) {
            const id = e.root_institution_id || e.institution_id;
            if (!id || byId.has(id)) continue;
            byId.set(id, {
              id,
              name:     e.institution_name || 'Academy',
              logo_url: e.institution_logo_url || null,
              city:     e.institution_city || null,
            });
          }
          const uniques = Array.from(byId.values());
          // Hydrate each academy with its full course list — one call
          // per academy, run in parallel. Silent .catch keeps a single
          // 404 from tanking the whole section.
          const hydrated = await Promise.all(uniques.map(async (a) => {
            try {
              const r = await apiClient.get(`/institutions/${a.id}/programs?limit=50`);
              return { ...a, programs: r.data?.programs || [] };
            } catch {
              return { ...a, programs: [] };
            }
          }));
          setEnrolledAcademies(hydrated);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log('[Programs] enrolled-academies fetch failed:', err?.message);
          setEnrolledAcademies([]);
        }
      } else {
        setEnrolledAcademies([]);
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

  const featured = visible.filter((p) => p.is_featured);
  const allRest  = visible.filter((p) => !p.is_featured);

  // Apply the same category + search filter to each enrolled-academy
  // section so the student's chip / query choice narrows every row on
  // the screen consistently. Academies whose section ends up empty are
  // still shown (with a soft "No courses match" note) so the student
  // can see the academy is still there when they clear the filter.
  const filterForAcademy = (arr) => {
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

  // Institutions the student has already picked (selectedInstitution)
  // shouldn't be duplicated in both "My Academies" AND "Featured/All
  // courses" — hide the browse section when the currently-selected
  // academy is one they're already enrolled in.
  const selectedIsEnrolled = enrolledAcademies.some(
    (a) => a.id === selectedInstitution?.id,
  );

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

  // ─── No institution chosen yet ───
  if (!instLoading && !selectedInstitution) {
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
            {selectedInstitution?.name}
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

        {/* ── My Academies ────────────────────────────────────────
            One section per academy the student has enrolled in. Each
            section shows the academy name + logo and every course
            that academy offers (not just the enrolled ones), so the
            student can discover what else is on the menu without
            leaving their Courses tab. */}
        {enrolledAcademies.length > 0 && (
          <View style={{ marginTop: spacing.xl }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Academies</Text>
              <Text style={styles.countText}>
                {enrolledAcademies.length} enrolled
              </Text>
            </View>

            {enrolledAcademies.map((academy) => {
              const filtered = filterForAcademy(academy.programs);
              return (
                <EnrolledAcademySection
                  key={`enr-${academy.id}`}
                  academy={academy}
                  filtered={filtered}
                  hasFilter={!!(search || activeCategory)}
                  onOpenCourse={(cid) => navigation.navigate('CourseDetail', { courseId: cid })}
                  onEnroll={handleEnroll}
                />
              );
            })}
          </View>
        )}

        {/* Featured */}
        {featured.length > 0 && !selectedIsEnrolled && (
          <View style={{ marginTop: spacing.xl }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Featured</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Sparkles size={14} color={palette.purple.vivid} strokeWidth={2.4} />
                <Text style={styles.featuredHint}>Editor's pick</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
            >
              {featured.map((p, i) => (
                <FeaturedProgramCard
                  key={p.id}
                  program={p}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('CourseDetail', { courseId: p.id })}
                  onEnroll={() => handleEnroll(p)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* All courses — hidden when the currently-selected academy is
            already listed above under "My Academies" (avoids showing
            the same programs twice on a single screen). */}
        {!selectedIsEnrolled && (
        <View style={{ marginTop: spacing.xl }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {enrolledAcademies.length > 0
                ? `Browse ${selectedInstitution?.name || 'other academies'}`
                : (activeCategory ? `${activeCategory.name} courses` : 'All courses')}
            </Text>
            <Text style={styles.countText}>{visible.length} result{visible.length === 1 ? '' : 's'}</Text>
          </View>

          {allRest.length === 0 && featured.length === 0 ? (
            <View style={styles.emptyInline}>
              <GraduationCap size={22} color={palette.textLight} strokeWidth={2} />
              <Text style={styles.emptyInlineText}>
                {search || activeCategory
                  ? 'No programs match your filters. Try clearing them.'
                  : 'No programs published yet. Check back soon.'}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {allRest.map((p, i) => (
                <GridProgramCard
                  key={p.id}
                  program={p}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('CourseDetail', { courseId: p.id })}
                  onEnroll={() => handleEnroll(p)}
                />
              ))}
            </View>
          )}
        </View>
        )}
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
