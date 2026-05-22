// src/screens/student/tabs/HomeTabScreen.js
//
// Student-facing Home screen — institution-scoped, guest-friendly.
//
// Sections (top → bottom):
//   1. Header with institution selector + bell
//   2. Banner carousel (CMS)
//   3. Categories quick chips (CMS)
//   4. Featured Programs (institution-scoped)
//   5. Upcoming Live Classes
//   6. Nearby Branches (link to picker)
//   7. Continue Learning (paid users only — placeholder for now)
//   8. Upcoming Events
//   9. Subscription banner (only for non-paid users)
//
// Guests can browse everything. Premium actions (Enroll, Join Live, full
// course playback) will trigger login/subscription popups in a later step.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Dimensions, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, ChevronDown, MapPin, ChevronRight, Sparkles, Building2,
  Calendar, PlayCircle, Lock, Radio, GraduationCap,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
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

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function formatEventDate(iso) {
  if (!iso) return { day: '--', month: '---' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { day: '--', month: '---' };
  return { day: String(d.getDate()).padStart(2, '0'), month: MONTHS[d.getMonth()] };
}

export default function HomeTabScreen({ navigation }) {
  const { user } = useAuth();
  const { selectedInstitution, loading: instLoading } = useInstitution();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [banners, setBanners] = useState([]);
  const [categories, setCategories] = useState([]);
  const [featuredPrograms, setFeaturedPrograms] = useState([]);
  const [events, setEvents] = useState([]);
  const [nearbyAcademies, setNearbyAcademies] = useState([]);

  const isGuest = !user;
  // Subscription state will land in Phase 2; for now assume non-paid.
  const isPaid = false;

  const load = useCallback(async () => {
    try {
      // Global CMS (banners, categories, events list — not institution-scoped yet)
      const [bannersRes, catsRes] = await Promise.all([
        apiClient.get('/cms/banners?active=true').catch(() => ({ data: { items: [] } })),
        apiClient.get('/cms/categories?active=true').catch(() => ({ data: { items: [] } })),
      ]);
      setBanners(bannersRes.data.items || []);
      setCategories(catsRes.data.items || []);

      if (selectedInstitution?.id) {
        // Institution-scoped: programs (featured first), events
        const [progRes, evtRes, nearbyRes] = await Promise.all([
          apiClient.get(`/institutions/${selectedInstitution.id}/programs?featured=true&limit=10`).catch(() => ({ data: { programs: [] } })),
          apiClient.get(`/institutions/${selectedInstitution.id}/events`).catch(() => ({ data: { events: [] } })),
          apiClient.get('/institutions/nearby?limit=8').catch(() => ({ data: { institutions: [] } })),
        ]);
        let featured = progRes.data.programs || [];
        // If no featured set yet, fall back to recent programs so the section
        // doesn't render empty during early data entry.
        if (featured.length === 0) {
          const all = await apiClient
            .get(`/institutions/${selectedInstitution.id}/programs?limit=6`)
            .catch(() => ({ data: { programs: [] } }));
          featured = all.data.programs || [];
        }
        setFeaturedPrograms(featured);
        setEvents(evtRes.data.events || []);
        // Filter the currently-selected academy out of "Nearby Branches"
        setNearbyAcademies(
          (nearbyRes.data.institutions || []).filter((i) => i.id !== selectedInstitution.id),
        );
      } else {
        setFeaturedPrograms([]);
        setEvents([]);
        setNearbyAcademies([]);
      }
    } catch (err) {
      console.log('[Home] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id]);

  // Re-load whenever the screen comes back into focus OR the selected
  // institution changes.
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useEffect(() => { setLoading(true); load(); }, [selectedInstitution?.id, load]);

  // ─── Empty state: no institution chosen ───
  if (!instLoading && !selectedInstitution) {
    return (
      <View style={styles.screen}>
        <ChooseInstitutionEmpty
          onPress={() => navigation.navigate('SelectInstitution')}
        />
      </View>
    );
  }

  if (loading && featuredPrograms.length === 0 && banners.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{isGuest ? 'Welcome to Veerify' : `Hi, ${user.name.split(' ')[0]} 👋`}</Text>
            <TouchableOpacity
              style={styles.instSelector}
              onPress={() => navigation.navigate('SelectInstitution')}
              activeOpacity={0.85}
            >
              <Text style={styles.instSelectorText} numberOfLines={1}>
                {selectedInstitution?.name || 'Choose academy'}
              </Text>
              <ChevronDown size={16} color={palette.purple.vivid} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.bellButton} activeOpacity={0.85}>
            <Bell size={20} color={palette.text} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* ── Banner carousel ─────────────────────────────────── */}
        {banners.length > 0 && (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
            style={{ marginBottom: spacing.lg }}
          >
            {banners.map((b) => (
              <BannerCard key={b.id} banner={b} />
            ))}
          </ScrollView>
        )}

        {/* ── Categories ──────────────────────────────────────── */}
        {categories.length > 0 && (
          <Section title="Browse by Category">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            >
              {categories.map((c, i) => (
                <CategoryChip
                  key={c.id}
                  category={c}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('Programs')}
                />
              ))}
            </ScrollView>
          </Section>
        )}

        {/* ── Featured Programs ───────────────────────────────── */}
        <Section
          title="Featured Programs"
          subtitle={selectedInstitution?.name}
          actionLabel="See all"
          onAction={() => navigation.navigate('Programs')}
        >
          {featuredPrograms.length === 0 ? (
            <EmptyInline icon={GraduationCap} text="No programs yet" />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
            >
              {featuredPrograms.map((p, i) => (
                <ProgramCard
                  key={p.id}
                  program={p}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('CourseDetail', { courseId: p.id })}
                />
              ))}
            </ScrollView>
          )}
        </Section>

        {/* ── Upcoming Live Classes ───────────────────────────── */}
        <Section
          title="Upcoming Live Classes"
          actionLabel="See all"
          onAction={() => navigation.navigate('Live')}
        >
          <EmptyInline icon={Radio} text="No live classes scheduled — check back soon" />
        </Section>

        {/* ── Nearby Branches ─────────────────────────────────── */}
        {nearbyAcademies.length > 0 && (
          <Section title="Other Academies Near You">
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
              {nearbyAcademies.slice(0, 3).map((a, i) => (
                <NearbyAcademyRow
                  key={a.id}
                  academy={a}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('SelectInstitution')}
                />
              ))}
            </View>
          </Section>
        )}

        {/* ── Continue Learning (paid users only) ─────────────── */}
        {isPaid && (
          <Section title="Continue Learning">
            <EmptyInline icon={PlayCircle} text="Start a course to see it here" />
          </Section>
        )}

        {/* ── Upcoming Events ─────────────────────────────────── */}
        {events.length > 0 && (
          <Section title="Upcoming Events">
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
              {events.slice(0, 4).map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </View>
          </Section>
        )}

        {/* ── Subscription banner (non-paid only) ─────────────── */}
        {!isPaid && (
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.xl }}>
            <SubscriptionBanner
              onPress={() => {
                if (isGuest) {
                  navigation.getParent()?.navigate('Login');
                } else {
                  // Wired to plan selection / paywall in Phase 2
                  navigation.navigate('Profile');
                }
              }}
              isGuest={isGuest}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function ChooseInstitutionEmpty({ onPress }) {
  return (
    <View style={[styles.center, { flex: 1, padding: spacing.xxl }]}>
      <View style={styles.emptyIconWrap}>
        <Building2 size={36} color={palette.purple.vivid} strokeWidth={2.2} />
      </View>
      <Text style={styles.emptyTitle}>Choose your academy</Text>
      <Text style={styles.emptyBody}>
        Pick the academy you train at so we can show you the right programs and live classes.
      </Text>
      <TouchableOpacity style={styles.ctaButton} onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.ctaButtonText}>Browse academies</Text>
        <ChevronRight size={16} color="#fff" strokeWidth={2.6} />
      </TouchableOpacity>
    </View>
  );
}

function Section({ title, subtitle, actionLabel, onAction, children }) {
  return (
    <View style={{ marginBottom: spacing.xxl }}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {actionLabel ? (
          <TouchableOpacity onPress={onAction} style={styles.sectionAction}>
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
            <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function BannerCard({ banner }) {
  const img = resolveAssetUrl(banner.image_url);
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[styles.banner, { width: SCREEN_WIDTH - spacing.xl * 2 }]}
    >
      {img ? <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={styles.bannerOverlay} />
      <View style={styles.bannerContent}>
        {banner.label ? <Text style={styles.bannerLabel}>{banner.label}</Text> : null}
        <Text style={styles.bannerTitle} numberOfLines={2}>{banner.title}</Text>
        {banner.subtitle ? (
          <Text style={styles.bannerSubtitle} numberOfLines={2}>{banner.subtitle}</Text>
        ) : null}
        {banner.cta ? (
          <View style={styles.bannerCta}>
            <Text style={styles.bannerCtaText}>{banner.cta}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function CategoryChip({ category, accent, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.catChip, { backgroundColor: accent.soft }]}>
      <Text style={{ fontSize: 18 }}>{category.emoji || '🥋'}</Text>
      <Text style={[styles.catText, { color: accent.on }]}>{category.name}</Text>
    </TouchableOpacity>
  );
}

function ProgramCard({ program, accent, onPress }) {
  const img = resolveAssetUrl(program.image_url || program.thumbnail_url);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.programCard}>
      <View style={[styles.programImage, { backgroundColor: accent.soft }]}>
        {img ? (
          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[styles.center, { flex: 1 }]}>
            <Sparkles size={28} color={accent.vivid} strokeWidth={2.2} />
          </View>
        )}
        {program.is_featured ? (
          <View style={styles.featuredTag}>
            <Sparkles size={10} color="#fff" strokeWidth={2.6} />
            <Text style={styles.featuredTagText}>Featured</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.programInfo}>
        <Text style={styles.programTitle} numberOfLines={2}>{program.title || program.name}</Text>
        <Text style={styles.programTrainer} numberOfLines={1}>
          {program.trainer_name || program.trainer || '—'}
        </Text>
        <View style={styles.programFooter}>
          <Text style={styles.programPrice}>
            {program.price ? `₹${parseInt(program.price).toLocaleString('en-IN')}` : 'Free'}
          </Text>
          <View style={styles.previewBtn}>
            <PlayCircle size={14} color={palette.purple.vivid} strokeWidth={2.2} />
            <Text style={styles.previewBtnText}>Preview</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function NearbyAcademyRow({ academy, accent, onPress }) {
  const logo = resolveAssetUrl(academy.logo_url);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.nearbyRow}>
      {logo ? (
        <Image source={{ uri: logo }} style={styles.nearbyLogo} resizeMode="cover" />
      ) : (
        <View style={[styles.nearbyLogo, { backgroundColor: accent.soft, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ ...type.h3, color: accent.on }}>{academy.name?.charAt(0)}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.nearbyName} numberOfLines={1}>{academy.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <MapPin size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.nearbyMeta} numberOfLines={1}>
            {academy.city || 'India'}
            {Number.isFinite(academy.distance_km) ? ` • ${academy.distance_km.toFixed(1)} km` : ''}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function EventRow({ event }) {
  const d = formatEventDate(event.event_date);
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventDate}>
        <Text style={styles.eventMonth}>{d.month}</Text>
        <Text style={styles.eventDay}>{d.day}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        {event.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <MapPin size={11} color="#a0a0c0" strokeWidth={2.2} />
            <Text style={styles.eventLocation} numberOfLines={1}>{event.location}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SubscriptionBanner({ onPress, isGuest }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.subBanner}>
      <View style={styles.subIconBubble}>
        <Lock size={20} color="#fff" strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.subBannerTitle}>Unlock Premium Access</Text>
        <Text style={styles.subBannerBody}>
          {isGuest
            ? 'Sign in and subscribe to access full courses, live classes, and certificates.'
            : 'Subscribe to unlock full courses, live classes, and digital certificates.'}
        </Text>
      </View>
      <ChevronRight size={18} color="#fff" strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

function EmptyInline({ icon: Icon, text }) {
  return (
    <View style={styles.emptyInline}>
      <Icon size={22} color={palette.textLight} strokeWidth={2} />
      <Text style={styles.emptyInlineText}>{text}</Text>
    </View>
  );
}

const ACCENTS = [palette.purple, palette.blue, palette.green, palette.orange, palette.pink, palette.teal];
function cycleAccent(i) { return ACCENTS[i % ACCENTS.length]; }

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  greeting: { ...type.caption, color: palette.textMuted },
  instSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    alignSelf: 'flex-start',
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  instSelectorText: { ...type.bodyBold, color: palette.purple.on, fontSize: 14 },
  bellButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },

  // Section
  sectionHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...type.h2, color: palette.text },
  sectionSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  sectionActionText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Banner
  banner: {
    height: 160,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.4)',
  },
  bannerContent: { position: 'relative', zIndex: 2 },
  bannerLabel: { ...type.micro, color: '#fff', marginBottom: 4, letterSpacing: 1 },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  bannerSubtitle: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  bannerCta: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  bannerCtaText: { ...type.caption, color: palette.text, fontWeight: '700' },

  // Category chip
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  catText: { ...type.bodyBold, fontWeight: '700' },

  // Program card
  programCard: {
    width: 200,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  programImage: { width: '100%', height: 110, position: 'relative' },
  featuredTag: {
    position: 'absolute',
    top: spacing.sm, left: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  featuredTagText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  programInfo: { padding: spacing.md, gap: 4 },
  programTitle: { ...type.h3, color: palette.text, fontSize: 14 },
  programTrainer: { ...type.caption, color: palette.textMuted },
  programFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  programPrice: { ...type.bodyBold, color: palette.purple.on, fontSize: 15 },
  previewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  previewBtnText: { fontSize: 10, color: palette.purple.on, fontWeight: '700' },

  // Nearby
  nearbyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg, padding: spacing.md,
    ...shadows.card,
  },
  nearbyLogo: { width: 44, height: 44, borderRadius: 22 },
  nearbyName: { ...type.bodyBold, color: palette.text },
  nearbyMeta: { ...type.caption, color: palette.textMuted, flex: 1 },

  // Event
  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.text,
    padding: spacing.md, borderRadius: radius.md,
  },
  eventDate: { alignItems: 'center', minWidth: 44 },
  eventMonth: { fontSize: 10, color: '#a0a0c0', fontWeight: '700', letterSpacing: 1 },
  eventDay: { fontSize: 22, fontWeight: '800', color: '#fff' },
  eventTitle: { ...type.bodyBold, color: '#fff' },
  eventLocation: { fontSize: 11, color: '#a0a0c0' },

  // Subscription
  subBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.raised,
  },
  subIconBubble: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  subBannerTitle: { ...type.h3, color: '#fff', fontSize: 15 },
  subBannerBody: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Empty states
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
  ctaButtonText: { ...type.bodyBold, color: '#fff' },

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
