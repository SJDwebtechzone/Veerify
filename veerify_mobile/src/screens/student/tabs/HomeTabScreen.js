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
import MyDashboard from '../MyDashboard';
import NearbyLocationPicker from '../../../components/NearbyLocationPicker';

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
      const [bannersRes, catsRes, evtRes, nearbyRes] = await Promise.all([
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
      ]);
      setBanners(bannersRes.data.items || []);
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
  // the institution-scoped sections (Featured Programs, Events) hide themselves
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
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => navigation.navigate('StaffNotifications')}
            activeOpacity={0.85}
          >
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

        {/* ── Featured Programs (institution-scoped — hides when none picked) ── */}
        {selectedInstitution?.id ? (
          <Section
            title="Featured Programs"
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
  const isBranch = academy.kind === 'branch';
  // For a branch row, the user-facing card title reads "Parent Academy
  // · Branch Name", which is more useful than the bare branch name.
  const titleLine = isBranch && academy.institution_name
    ? `${academy.institution_name} · ${academy.name}`
    : academy.name;
  // Backend returns seats_available: false when the parent institution
  // has hit its plan's max_students cap. We render the row dimmed and
  // show a red "No seats" pill so students know not to bother enrolling.
  const isFull = academy.seats_available === false;
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
          {isBranch ? (
            <View style={{
              paddingHorizontal: 6, paddingVertical: 1,
              borderRadius: 999, backgroundColor: '#FFE4E6',
            }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: '#E63946', letterSpacing: 0.4 }}>
                BRANCH
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
            {academy.city || academy.pincode || 'India'}
            {Number.isFinite(Number(academy.distance_km)) ? ` • ${Number(academy.distance_km).toFixed(1)} km` : ''}
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

  // Pick-academy soft prompt (shown when no institution is selected)
  pickAcademyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
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
