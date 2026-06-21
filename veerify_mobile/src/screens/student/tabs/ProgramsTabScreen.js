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
    } catch (err) {
      console.log('[Programs] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id]);

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

  const handleEnroll = (program) => {
    if (isGuest) {
      Alert.alert(
        'Login to Continue Learning',
        'Sign in to enroll in this program and start your journey.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Login', onPress: () => navigation.getParent()?.navigate('Login') },
        ],
      );
      return;
    }
    Alert.alert(
      'Subscribe to Unlock',
      'You need an active subscription to enroll. Pick a plan from your Profile.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'View Plans', onPress: () => navigation.navigate('Profile') },
      ],
    );
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
                  emoji={c.emoji || '🥋'}
                  active={activeCategory?.id === c.id}
                  onPress={() => setActiveCategory(c)}
                  accent={cycleAccent(i + 1)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Featured */}
        {featured.length > 0 && (
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

        {/* All programs */}
        <View style={{ marginTop: spacing.xl }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {activeCategory ? `${activeCategory.name} programs` : 'All programs'}
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
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function CategoryChip({ label, emoji, active, onPress, accent }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.catChip,
        { backgroundColor: active ? accent.vivid : accent.soft },
      ]}
    >
      <Text style={{ fontSize: 16 }}>{emoji}</Text>
      <Text style={[styles.catText, { color: active ? '#fff' : accent.on }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function FeaturedProgramCard({ program, accent, onPress, onEnroll }) {
  const img = resolveAssetUrl(program.image_url || program.thumbnail_url);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.featuredCard}>
      <View style={[styles.featuredImage, { backgroundColor: accent.soft }]}>
        {img ? (
          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[styles.center, { flex: 1 }]}>
            <Sparkles size={36} color={accent.vivid} strokeWidth={2.2} />
          </View>
        )}
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
  const img = resolveAssetUrl(program.image_url || program.thumbnail_url);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.gridCard}>
      <View style={[styles.gridImage, { backgroundColor: accent.soft }]}>
        {img ? (
          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[styles.center, { flex: 1 }]}>
            <GraduationCap size={28} color={accent.vivid} strokeWidth={2.2} />
          </View>
        )}
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
});
