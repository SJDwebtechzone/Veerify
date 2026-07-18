// src/screens/student/tabs/HomeTabScreen.js
//
// Student-facing Home screen — institution-scoped, guest-friendly.
//
// Sections (top → bottom):
//   1. Header with institution selector + bell
//   2. Banner carousel (CMS)
//   3. Categories quick chips (CMS)
//   4. Featured Courses (institution-scoped)
//   5. Upcoming Live Classes
//   6. Nearby Branches (link to picker)
//   7. Continue Learning (paid users only — placeholder for now)
//   8. Upcoming Events
//   9. Subscription banner (only for non-paid users)
//
// Guests can browse everything. Premium actions (Enroll, Join Live, full
// course playback) will trigger login/subscription popups in a later step.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Dimensions, Image, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, ChevronDown, MapPin, ChevronRight, Sparkles, Building2,
  Calendar, PlayCircle, Lock, Radio, GraduationCap, Navigation2,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import MyDashboard from '../MyDashboard';
import NearbyLocationPicker from '../../../components/NearbyLocationPicker';
import { useBellScrollHandler } from '../../../components/bellScrollBus';
import { confirm } from '../../../components/ConfirmDialog';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Shared resolver — also strips legacy embedded 10.0.2.2:5000 hosts
// that got baked into DB rows before we started storing relative
// /uploads/ paths. Keeping the legacy behavior in one place means old
// course rows still render correctly.
import resolveAssetUrl from '../../../utils/assetUrl';

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
  // Origin the student picked (GPS coords or pincode-resolved coords).
  // null until the picker hydrates from AsyncStorage or the student
  // makes a fresh choice. We re-fetch the nearby list whenever it
  // changes.
  const [nearbyOrigin, setNearbyOrigin] = useState(null);

  // ── Personalized home pivot ──
  // After a logged-in student has at least one PAID enrollment we switch
  // the entire Home tab over to MyDashboard (banner + My Courses + videos)
  // instead of the browse-academies view. This effect probes the
  // enrollments endpoint on every focus and flips the flag. Guests and
  // students with only pending enrollments still see the browse content.
  const [hasPaidEnrollment, setHasPaidEnrollment] = useState(null); // null = unknown
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!user) {
      setHasPaidEnrollment(false);
      return undefined;
    }
    apiClient
      .get('/enrollments/my')
      .then((r) => {
        if (cancelled) return;
        const enrolls = r.data?.enrollments || [];
        setHasPaidEnrollment(enrolls.some((e) => e.payment_status === 'paid'));
      })
      .catch(() => {
        if (!cancelled) setHasPaidEnrollment(false);
      });
    return () => { cancelled = true; };
  }, [user]));

  const isGuest = !user;
  // Subscription state will land in Phase 2; for now assume non-paid.
  const isPaid = false;

  const load = useCallback(async () => {
    try {
      // ── Global content (always loads, even without an institution) ──
      // mobile_events is currently a global table so we surface its rows
      // regardless of selection. Nearby academies is naturally guest-friendly.
      const [bannersRes, catsRes, evtRes, nearbyRes, instBannersRes] = await Promise.all([
        apiClient.get('/cms/banners?active=true').catch(() => ({ data: { items: [] } })),
        apiClient.get('/cms/categories?active=true').catch(() => ({ data: { items: [] } })),
        // Events:
        //   - Logged-in users hit /institutions/me/events which resolves the
        //     institution from their JWT (covers students who never used the
        //     academy picker — their user.institution_id is the source of truth).
        //   - Guests fall back to the academy they picked, or stub id=1 for
        //     globals-only when nothing is picked.
        user
          ? apiClient.get('/institutions/me/events').catch(() => ({ data: { events: [] } }))
          : apiClient.get(`/institutions/${selectedInstitution?.id || 1}/events`).catch(() => ({ data: { events: [] } })),
        // Hybrid academies/nearby — accepts either GPS coords or a
        // pincode-derived origin from NearbyLocationPicker. When no
        // origin is set yet the backend falls back to a "newest first"
        // list so the section is never empty.
        apiClient.get('/academies/nearby?' + new URLSearchParams(
          nearbyOrigin
            ? (nearbyOrigin.source === 'pincode'
                ? { pincode: nearbyOrigin.pincode, limit: 8 }
                : { lat: nearbyOrigin.lat, lng: nearbyOrigin.lng, limit: 8 })
            : { limit: 8 },
        ).toString()).catch(() => ({ data: { results: [] } })),
        // Academy branding banners:
        //   • Logged-in student → /for-me returns published banners
        //     targeted at the student's own institution (auth-gated).
        //   • Guest with a picked academy → /public/:institutionId
        //     bypasses auth so the branded hero still loads. The
        //     public endpoint returns the same active banners any
        //     guest browsing this academy is meant to see.
        //   • Guest with no academy picked → empty. The default hero
        //     copy takes over below.
        user
          ? apiClient.get('/institution-banners/for-me').catch(() => ({ data: { banners: [] } }))
          : selectedInstitution?.id
            ? apiClient.get(`/institution-banners/public/${selectedInstitution.id}`).catch(() => ({ data: { banners: [] } }))
            : Promise.resolve({ data: { banners: [] } }),
      ]);
      // Merge institution-specific banners in front of the global CMS
      // banners so the academy's own promos lead the carousel.
      const instBanners = (instBannersRes?.data?.banners || []).map((b) => ({
        id:       `inst-${b.id}`,
        image_url: b.image_url,
        title:    b.title,
        subtitle: b.subtitle,
        cta:      null,
        label:    null,
      }));
      setBanners([...instBanners, ...(bannersRes.data.items || [])]);
      setCategories(catsRes.data.items || []);
      setEvents(evtRes.data.events || []);
      // /academies/nearby returns { results: [{ id, name, kind,
      // institution_id, distance_km, ... }] }. We still drop the
      // currently-picked academy from the list so it doesn't appear
      // in "Other Academies Near You". Branches keep their own
      // institution_id, so the filter applies to both.
      const rows = nearbyRes.data?.results || nearbyRes.data?.institutions || [];
      setNearbyAcademies(
        rows.filter((r) => {
          const instId = r.kind === 'branch' ? r.institution_id : r.id;
          return instId !== selectedInstitution?.id;
        }),
      );

      // ── Institution-scoped (only when one is picked) ──
      if (selectedInstitution?.id) {
        const progRes = await apiClient
          .get(`/institutions/${selectedInstitution.id}/programs?featured=true&limit=10`)
          .catch(() => ({ data: { programs: [] } }));
        let featured = progRes.data.programs || [];
        // Fallback so the Featured section doesn't render empty on a fresh academy.
        if (featured.length === 0) {
          const all = await apiClient
            .get(`/institutions/${selectedInstitution.id}/programs?limit=6`)
            .catch(() => ({ data: { programs: [] } }));
          featured = all.data.programs || [];
        }
        setFeaturedPrograms(featured);
      } else {
        setFeaturedPrograms([]);
      }
    } catch (err) {
      console.log('[Home] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id, nearbyOrigin]);

  // Re-load whenever the screen comes back into focus OR the selected
  // institution / picked origin changes.
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useEffect(() => { setLoading(true); load(); }, [selectedInstitution?.id, nearbyOrigin, load]);

  // We no longer block the entire Home tab when no institution is picked.
  // The user can still browse banners, categories and nearby academies; only
  // the institution-scoped sections (Featured Courses, Events) hide themselves
  // and a soft inline banner near the top nudges them to pick one.
  const noInstitution = !instLoading && !selectedInstitution;

  // ── Personalized dashboard pivot ──
  // Logged-in students with at least one paid enrollment skip the entire
  // browse view and get MyDashboard instead. We wait for the probe to
  // settle (hasPaidEnrollment !== null) before deciding, so the screen
  // doesn't flicker between the two layouts.
  if (hasPaidEnrollment === true) {
    return <MyDashboard navigation={navigation} />;
  }

  if (loading && featuredPrograms.length === 0 && banners.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  const bellScroll = useBellScrollHandler();

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
        // Auto-hide the floating notification bell as the viewer
        // scrolls down; slide it back in on scroll up. Handler is
        // stateless — no re-renders on scroll frames.
        onScroll={bellScroll}
        scrollEventThrottle={16}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        {/* Bell removed from the header — it now floats globally via
            <GlobalNotificationBell/> so it stays visible on every
            screen. The spacer keeps the greeting from butting up
            against the floating bell in the top-right corner. */}
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 54 }}>
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
        </View>

        {/* ── Banner carousel ─────────────────────────────────── */}
        {/* Banner strip — always renders. When neither the institution
            nor the CMS has any active banners the carousel shows a
            single branded default so the surface isn't empty (spec:
            "If no banner is uploaded, display the default banner."). */}
        <BannerCarousel
          banners={banners.length > 0 ? banners : [{
            id:       'default',
            image_url: null,
            title:    'Welcome to Veerify',
            subtitle: 'Explore martial arts academies near you.',
            cta:      null,
            label:    'NEW HERE?',
          }]}
        />

        {/* ── Categories ──────────────────────────────────────── */}
        {/* Horizontal card carousel matching the design reference.
            Extra vertical padding (paddingVertical: 8) ensures the
            card shadows aren't clipped by the ScrollView's own bounds
            on either platform. gap: spacing.md keeps consistent
            breathing room between cards regardless of screen size. */}
        {categories.length > 0 && (
          <Section title="Browse by Category">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: spacing.xl,
                paddingVertical: 8,
                gap: spacing.md,
              }}
            >
              {categories.map((c, i) => (
                <CategoryChip
                  key={c.id}
                  category={c}
                  accent={cycleAccent(i)}
                  onPress={() =>
                    navigation.navigate('CategoryAcademies', { category: c })
                  }
                />
              ))}
            </ScrollView>
          </Section>
        )}

        {/* ── Pick-an-academy soft prompt (only when none selected) ── */}
        {noInstitution ? (
          <TouchableOpacity
            style={styles.pickAcademyCard}
            onPress={() => navigation.navigate('SelectInstitution')}
            activeOpacity={0.85}
          >
            <View style={styles.pickAcademyIcon}>
              <Building2 size={20} color={palette.purple.on} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickAcademyTitle}>Pick your academy</Text>
              <Text style={styles.pickAcademyHint}>
                Get personalised programs, batches and live classes.
              </Text>
            </View>
            <ChevronRight size={18} color={palette.purple.vivid} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}

        {/* ── Featured Courses (institution-scoped — hides when none picked) ── */}
        {selectedInstitution?.id ? (
          <Section
            title="Featured Courses"
            subtitle={selectedInstitution?.name}
            actionLabel="See all"
            onAction={() => {
            // jumpTo is the bottom-tab navigator's dedicated tab-switch API.
            // navigation.navigate() can be ambiguous when both stack and tab
            // navigators exist in the tree; jumpTo always lands on the tab.
            if (typeof navigation.jumpTo === 'function') {
              navigation.jumpTo('Programs');
            } else {
              navigation.navigate('Programs');
            }
          }}
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
        ) : null}

        {/* ── Upcoming Live Classes ───────────────────────────── */}
        {/* Hidden for guest users — they have no enrolled batches yet,
            so the section would render permanently empty and create
            confusion. Logged-in students still see it so the "No live
            classes" message has context. */}
        {!isGuest ? (
          <Section
            title="Upcoming Live Classes"
            actionLabel="See all"
            onAction={() => navigation.navigate('Live')}
          >
            <EmptyInline icon={Radio} text="No live classes scheduled — check back soon" />
          </Section>
        ) : null}

        {/* ── Nearby Academies — hybrid (GPS or pincode) ──────── */}
        <Section title="Other Academies Near You">
          <NearbyLocationPicker
            origin={nearbyOrigin}
            onChange={setNearbyOrigin}
          />
          {nearbyAcademies.length > 0 ? (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
              {nearbyAcademies.slice(0, 5).map((a, i) => (
                <NearbyAcademyRow
                  key={`${a.kind || 'inst'}-${a.id}`}
                  academy={a}
                  accent={cycleAccent(i)}
                  onPress={() => navigation.navigate('SelectInstitution')}
                />
              ))}
            </View>
          ) : (
            <EmptyInline
              icon={Building2}
              text={
                nearbyOrigin
                  ? 'No academies in this area yet — check back as more sign up.'
                  : 'Pick GPS or enter a pincode above to see academies near you.'
              }
            />
          )}
        </Section>

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

        {/* ── Subscription banner ─────────────────────────────
            Fully hidden — the "Unlock Premium Access" pitch used to
            render for signed-in-but-unpaid students; guests never saw
            it. We've since removed it from every audience: enrolment
            happens per-course via the course detail screen instead,
            so a generic paywall on the home tab was redundant. */}
        {false && (
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.xl }}>
            <SubscriptionBanner
              onPress={() => {
                navigation.navigate('Profile');
              }}
              isGuest={false}
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

// BannerCarousel — auto-advances through CMS banner cards every few seconds.
//
// Behaviour:
//   • Snaps page-by-page (pagingEnabled) so each banner fully fills the slot.
//   • Every AUTO_MS the current index is bumped forward (with wrap-around)
//     and scrollTo() animates to it.
//   • If the user drags the carousel manually, onMomentumScrollEnd writes
//     the new index back into our ref so the next auto-tick starts from
//     where they stopped rather than yanking them back.
//   • Single-banner case skips the timer entirely.
//   • The interval is cleared on unmount so nothing fires on a stale ref.
function BannerCarousel({ banners }) {
  const scrollRef = useRef(null);
  const indexRef  = useRef(0);
  // Page step = card width + the gap between cards. Matches BannerCard's
  // width formula so scrollTo() lands cleanly on each card.
  const PAGE = (SCREEN_WIDTH - spacing.xl * 2) + spacing.md;
  const AUTO_MS = 4000;

  useEffect(() => {
    if (!banners || banners.length < 2) return undefined;
    const id = setInterval(() => {
      const next = (indexRef.current + 1) % banners.length;
      indexRef.current = next;
      scrollRef.current?.scrollTo({ x: next * PAGE, animated: true });
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [banners, PAGE]);

  const onMomentumScrollEnd = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    indexRef.current = Math.round(x / PAGE);
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
      style={{ marginBottom: spacing.lg }}
      onMomentumScrollEnd={onMomentumScrollEnd}
    >
      {banners.map((b) => (
        <BannerCard key={b.id} banner={b} />
      ))}
    </ScrollView>
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
  // Rebuilt to match the reference: vertical white card, big circular
  // cover-cropped image on top, dark bold name below, optional count.
  //
  // Image resolution ladder (unchanged from the old horizontal pill):
  //   1. uploaded image (mobile_categories.image_url via /cms/categories)
  //   2. emoji if the row carries one
  //   3. default 🥋 fallback so the tile is never blank
  // onError downgrades to the emoji if the URL 404s.
  //
  // `accent.soft` tints the circular halo behind the image so different
  // categories still feel visually distinct without breaking the white-
  // card grid. Course/item count renders only when the API supplies it.
  const [imgError, setImgError] = React.useState(false);
  const img = category.image_url && !imgError
    ? resolveAssetUrl(category.image_url)
    : null;
  const count = category.course_count ?? category.item_count ?? category.count;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.catCard}>
      <View style={[styles.catImageWrap, { backgroundColor: accent.soft }]}>
        {img ? (
          <Image
            source={{ uri: img }}
            style={styles.catImage}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <Text style={styles.catEmoji}>{category.emoji || '🥋'}</Text>
        )}
      </View>
      <Text style={styles.catText} numberOfLines={1}>{category.name}</Text>
      {count != null && Number.isFinite(Number(count)) ? (
        <Text style={styles.catCount}>
          {Number(count)} {Number(count) === 1 ? 'item' : 'items'}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

function ProgramCard({ program, accent, onPress }) {
  // Track load failure so a bad URL falls back to the branded sparkle
  // placeholder rather than leaving a blank tile.
  const [imgError, setImgError] = React.useState(false);
  const rawUrl = program.image_url || program.thumbnail_url;
  const img = rawUrl && !imgError ? resolveAssetUrl(rawUrl) : null;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.programCard}>
      <View style={[styles.programImage, { backgroundColor: accent.soft }]}>
        {img ? (
          <Image
            source={{ uri: img }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
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
  // Three flavors coexist in results:
  //   'institution' — main head office
  //   'branch'      — institution_branches satellite location
  //   'sub_branch'  — child institution with own admin login
  const isSatellite = academy.kind === 'branch';
  const isSubBranch = academy.kind === 'sub_branch';
  const isBranchy   = isSatellite || isSubBranch;
  // For both branch shapes, the card title reads "Parent Academy · Branch",
  // which lets the student see who owns this pin at a glance.
  const titleLine = isBranchy && academy.institution_name
    ? `${academy.institution_name} · ${academy.name}`
    : academy.name;
  // Backend returns seats_available: false when the parent institution
  // has hit its plan's max_students cap. We render the row dimmed and
  // show a red "No seats" pill so students know not to bother enrolling.
  const isFull = academy.seats_available === false;

  // Directions — hand off to Google Maps if we have coords, otherwise
  // to a text search. Doesn't require the Maps app to be installed;
  // the OS resolves it.
  const openDirections = () => {
    if (academy.latitude != null && academy.longitude != null) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${academy.latitude},${academy.longitude}`,
      ).catch(() => {});
    } else {
      const q = encodeURIComponent(
        [academy.name, academy.address, academy.city, academy.pincode]
          .filter(Boolean).join(' '),
      );
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
    }
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.nearbyRow}>
      {logo ? (
        <Image source={{ uri: logo }} style={styles.nearbyLogo} resizeMode="cover" />
      ) : (
        <View style={[styles.nearbyLogo, { backgroundColor: accent.soft, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ ...type.h3, color: accent.on }}>{(academy.institution_name || academy.name || '?').charAt(0)}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={styles.nearbyName} numberOfLines={1}>{titleLine}</Text>
          {isSatellite ? (
            <View style={{
              paddingHorizontal: 6, paddingVertical: 1,
              borderRadius: 999, backgroundColor: '#FFE4E6',
            }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#E63946', letterSpacing: 0.4 }}>
                BRANCH
              </Text>
            </View>
          ) : null}
          {isSubBranch ? (
            <View style={{
              paddingHorizontal: 6, paddingVertical: 1,
              borderRadius: 999, backgroundColor: '#E0E7FF',
            }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#3730A3', letterSpacing: 0.4 }}>
                SUB-BRANCH
              </Text>
            </View>
          ) : null}
          {isFull ? (
            <View style={{
              paddingHorizontal: 6, paddingVertical: 1,
              borderRadius: 999, backgroundColor: '#FEE2E2',
            }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.4 }}>
                NO SEATS
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <MapPin size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.nearbyMeta} numberOfLines={1}>
            {academy.address || academy.city || academy.pincode || 'India'}
            {Number.isFinite(Number(academy.distance_km)) ? ` • ${Number(academy.distance_km).toFixed(1)} km` : ''}
          </Text>
        </View>
      </View>
      {/* Directions — jumps to Google Maps with the branch as the
          destination so the student can navigate without extra taps.
          Kept as a distinct touch target so tapping it doesn't open
          the academy detail page. */}
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation?.(); openDirections(); }}
        hitSlop={8}
        style={{
          width: 32, height: 32, borderRadius: 16,
          backgroundColor: '#EFF6FF',
          alignItems: 'center', justifyContent: 'center',
          marginRight: 6,
        }}
      >
        <Navigation2 size={14} color="#2563EB" strokeWidth={2.4} />
      </TouchableOpacity>
      <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function EventRow({ event }) {
  const d = formatEventDate(event.event_date);
  // Small pay hint on the right side of the row so a student sees the
  // fee before tapping into the detail screen.
  const showFee = event.payment_required && !event.has_paid;
  const paid    = event.payment_required && event.has_paid;
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
      {showFee ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#10B981' }}>
            ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')}
          </Text>
        </View>
      ) : paid ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#10B981', letterSpacing: 0.4 }}>
            PAID
          </Text>
        </View>
      ) : null}
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

  // Pick-academy soft prompt (shown when no institution is selected).
  // Vertical margins bumped so the "Other Academies Near You" section
  // below breathes — previously the card had marginTop but no
  // marginBottom, so the two sections looked visually stuck together
  // for guest users (where nothing renders between them).
  pickAcademyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    padding: spacing.md,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.purple.vivid,
  },
  pickAcademyIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  pickAcademyTitle: { ...type.bodyBold, color: palette.text },
  pickAcademyHint: { ...type.caption, color: palette.textMuted, marginTop: 2 },

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

  // Category card (vertical layout — matches reference design)
  // White rounded card, ~110 wide, with a circular image on top and
  // the category name centered below. Sits in a horizontal ScrollView
  // (see the `Browse by Category` section render). marginRight is set
  // to spacing.sm; contentContainerStyle keeps consistent side padding.
  catCard: {
    width: 110,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: 8,
    alignItems: 'center',
    // Subtle shadow so cards visually lift off the tab background;
    // matches the reference's floating-card feel without going heavy.
    ...shadows.card,
  },
  catImageWrap: {
    // Soft accent halo behind the image so different categories still
    // feel visually distinct — the card itself stays white.
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  catImage: {
    // Cover-cropped photo. Fills the 72×72 circle exactly.
    width: '100%', height: '100%',
  },
  catEmoji: { fontSize: 32 },
  catText: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  catCount: {
    ...type.caption,
    color: palette.textMuted,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },

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
