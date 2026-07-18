// src/screens/student/tabs/LiveTabScreen.js
//
// Student-facing Sessions tab.
//
// Two views, switched by a toggle near the top:
//   Live sessions   → upcoming + currently-live classes (institution-scoped)
//   Recorded videos → on-demand recordings posted by trainers (per batch)
//
// Recorded videos come from /api/students/my-videos (already scoped to the
// student's PAID enrolments). The toggle / tab is hidden for users who
// don't have a paid enrolment — they get a gentle upsell screen instead.
//
// Live classes still use the existing /institutions/:id/live-classes
// endpoint; it returns [] until that table is populated.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, Linking, Alert, Image,
  StatusBar, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronDown, ChevronRight, Radio, PlayCircle, Clock,
  User, Calendar, Building2, Video, Tv,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import { useBellScrollHandler } from '../../../components/bellScrollBus';

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

// Pulls a YouTube thumbnail from a watch / live URL, if possible.
function youtubeThumb(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function formatScheduledTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function isLiveNow(c) {
  const start = c.start_time ? new Date(c.start_time).getTime() : null;
  const end   = c.end_time   ? new Date(c.end_time).getTime()   : null;
  const now = Date.now();
  if (start && end) return now >= start && now <= end;
  return (c.status || '').toLowerCase() === 'live';
}

export default function LiveTabScreen({ navigation }) {
  const { user } = useAuth();
  const { selectedInstitution, loading: instLoading } = useInstitution();
  const insets = useSafeAreaInsets();

  // 'live' = upcoming + currently-live classes view
  // 'recorded' = on-demand recordings posted by the trainer
  const [mode, setMode] = useState('live');

  const [classes, setClasses] = useState([]);     // /institutions/:id/live-classes
  const [videos,  setVideos]  = useState([]);     // /students/my-videos
  const [hasPaidEnrolment, setHasPaidEnrolment] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isGuest = !user;
  // Students unlock recorded videos + live sessions only after paying for an
  // enrolment. Guests + free-tier accounts see the upsell screen below.
  const hasAccess = !!user && hasPaidEnrolment;

  const load = useCallback(async () => {
    try {
      // 1. Live classes (institution scope)
      let live = [];
      if (selectedInstitution?.id) {
        const liveRes = await apiClient
          .get(`/institutions/${selectedInstitution.id}/live-classes`)
          .catch(() => ({ data: { live_classes: [] } }));
        live = liveRes.data.live_classes || [];
      }
      setClasses(live);

      // 2. Determine paid-enrolment access via the same /enrollments/my
      //    check the HomeTab uses. This is the gate for the whole tab.
      let paid = false;
      let myVideos = [];
      if (user) {
        try {
          const eRes = await apiClient.get('/enrollments/my');
          const enrols = eRes.data?.enrollments || [];
          paid = enrols.some((e) => e.payment_status === 'paid');
        } catch (err) {
          console.log('[Sessions] my enrolments load skipped:', err?.message);
        }
        if (paid) {
          try {
            const vRes = await apiClient.get('/students/my-videos');
            myVideos = vRes.data?.videos || [];
          } catch (err) {
            console.log('[Sessions] my-videos load skipped:', err?.message);
          }
        }
      }
      setVideos(myVideos);
      setHasPaidEnrolment(paid);
    } catch (err) {
      console.log('[Sessions] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id, user]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useEffect(() => { setLoading(true); load(); }, [selectedInstitution?.id, load]);

  const liveNow = useMemo(() => classes.find(isLiveNow), [classes]);

  const buckets = useMemo(() => {
    const upcoming = [];
    const recordings = [];
    classes.forEach((c) => {
      if (isLiveNow(c)) return; // shown in hero
      const start = c.start_time ? new Date(c.start_time).getTime() : null;
      const hasRecording = !!(c.recording_url || c.recording);
      if (start && start > Date.now()) {
        upcoming.push(c);
      } else if (hasRecording) {
        recordings.push(c);
      } else if (start) {
        // Past with no recording — drop into Recordings list with disabled CTA
        recordings.push(c);
      } else {
        upcoming.push(c);
      }
    });
    // Sort upcoming chronologically
    upcoming.sort((a, b) =>
      (new Date(a.start_time || 0)).getTime() - (new Date(b.start_time || 0)).getTime(),
    );
    return { upcoming, recordings };
  }, [classes]);

  // Only fires for users who reached the Live list, which already requires
  // hasAccess === true. No more "Subscribe" interstitial — the upsell card
  // takes care of unpaid users now. We just open the URL directly.
  const handleJoinLive = (c) => {
    if (!c.youtube_url) {
      Alert.alert('Join link unavailable',
        'The trainer hasn\'t posted a join link for this session yet.');
      return;
    }
    Linking.openURL(c.youtube_url).catch(() => {
      Alert.alert('Could not open link', 'Please copy the link from your email or notifications.');
    });
  };
  const handleWatchRecording = (c) => {
    if (!c.recording_url) return;
    Linking.openURL(c.recording_url).catch(() => {});
  };

  // No academy chosen
  if (!instLoading && !selectedInstitution) {
    return (
      <View style={[styles.screen, styles.center, { padding: spacing.xxl }]}>
        <View style={styles.emptyIconWrap}>
          <Building2 size={36} color={palette.purple.vivid} strokeWidth={2.2} />
        </View>
        <Text style={styles.emptyTitle}>Pick your academy first</Text>
        <Text style={styles.emptyBody}>
          Live classes are organized per academy. Choose one to see today's sessions.
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

  if (loading && classes.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  // Split the my-videos payload by kind. The trainer Sessions screen now
  // posts BOTH recorded videos (kind='recorded') and live-session join
  // links (kind='live') into course_videos, so this single endpoint feeds
  // both modes on the student side.
  const recordedVideos = videos.filter((v) => (v.kind || 'recorded') === 'recorded');
  const trainerLiveSessions = videos
    .filter((v) => v.kind === 'live')
    // Map each into the same shape the existing LiveCard renderer expects.
    .map((v) => ({
      id:           `cv-${v.id}`,
      title:        v.title,
      trainer_name: v.uploaded_by_name,
      start_time:   v.scheduled_at,
      youtube_url:  v.video_url,
      thumbnail_url: v.thumbnail_url,
      duration:     v.duration_seconds ? `${Math.round(v.duration_seconds / 60)} min` : null,
    }));

  // Live tab list: upcoming classes from the institution endpoint plus any
  // trainer-posted live sessions, sorted chronologically.
  const liveList = [...buckets.upcoming, ...trainerLiveSessions].sort(
    (a, b) => new Date(a.start_time || 0).getTime() - new Date(b.start_time || 0).getTime(),
  );

  // Header padding budget. We pick the LARGEST of:
  //   - 56px floor   (covers the worst case where every inset reads 0)
  //   - insets.top   (true safe-area inset when SafeAreaProvider is happy)
  //   - StatusBar.currentHeight (Android-native fallback)
  // Then add spacing.md on top for breathing room. The aggressive floor
  // means the title always clears the system clock even on emulators where
  // both inset readings come back as 0.
  const headerPadTop = Math.max(
    56,
    (insets.top || 0),
    Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
  ) + spacing.md;

  return (
    <View style={styles.screen}>
      {/* Header — just academy name + dropdown, matching the simplified
          Programs + Batches layout. Eyebrow line dropped; bottom padding
          bumped so the mode toggle below sits clear of the academy name. */}
      <View style={[styles.header, { paddingTop: headerPadTop }]}>
        <TouchableOpacity
          onPress={() => navigation.navigate('SelectInstitution')}
          activeOpacity={0.85}
          style={styles.instSelector}
        >
          <Text style={styles.instText} numberOfLines={1}>
            {selectedInstitution?.name || 'Pick academy'}
          </Text>
          <ChevronDown size={20} color={palette.purple.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      {/* Mode toggle — a single pill split between Live / Recorded. Hidden
          when the user isn't paid-enrolled (the upsell screen handles that
          case below). */}
      {hasAccess ? (
        <View style={styles.modeToggleWrap}>
          <View style={styles.modeToggle}>
            <ModeOption
              focused={mode === 'live'}
              icon={Tv}
              label="Live sessions"
              count={(liveNow ? 1 : 0) + liveList.length}
              onPress={() => setMode('live')}
            />
            <ModeOption
              focused={mode === 'recorded'}
              icon={Video}
              label="Recorded videos"
              count={recordedVideos.length}
              onPress={() => setMode('recorded')}
            />
          </View>
        </View>
      ) : null}

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
        {/* Access gate — students who haven't paid for an enrolment see an
            upsell instead of the lists. */}
        {!hasAccess ? (
          <View style={styles.upsell}>
            <View style={styles.emptyIconWrap}>
              <Tv size={32} color={palette.purple.vivid} strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>Unlock sessions</Text>
            <Text style={styles.emptyBody}>
              {isGuest
                ? 'Sign in and enrol in an online course to watch live and recorded sessions.'
                : 'Enrol in any online course to watch its live sessions and recorded videos.'}
            </Text>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => navigation.navigate(isGuest ? 'Login' : 'Programs')}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaText}>
                {isGuest ? 'Sign in' : 'Browse courses'}
              </Text>
              <ChevronRight size={16} color="#fff" strokeWidth={2.6} />
            </TouchableOpacity>
          </View>
        ) : mode === 'live' ? (
          // ── LIVE SESSIONS ────────────────────────────────────────────────
          <>
            {liveNow ? (
              <LiveNowHero live={liveNow} onJoin={() => handleJoinLive(liveNow)} />
            ) : null}
            {liveList.length === 0 ? (
              <View style={styles.emptyInline}>
                <Radio size={22} color={palette.textLight} strokeWidth={2} />
                <Text style={styles.emptyInlineText}>
                  No upcoming live sessions — check back soon.
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
                {liveList.map((c, i) => (
                  <LiveCard
                    key={c.id || i}
                    liveClass={c}
                    accent={cycleAccent(i)}
                    mode="Upcoming"
                    onJoin={() => handleJoinLive(c)}
                    onWatch={() => handleWatchRecording(c)}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          // ── RECORDED VIDEOS ─────────────────────────────────────────────
          recordedVideos.length === 0 ? (
            <View style={styles.emptyInline}>
              <PlayCircle size={22} color={palette.textLight} strokeWidth={2} />
              <Text style={styles.emptyInlineText}>
                Your trainer hasn't posted any recordings yet.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
              {recordedVideos.map((v, i) => (
                <RecordedVideoCard
                  key={v.id || i}
                  video={v}
                  accent={cycleAccent(i)}
                  onPress={() => {
                    if (v.video_url) Linking.openURL(v.video_url).catch(() => {});
                  }}
                />
              ))}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

// ─── Mode toggle option ─────────────────────────────────────────────────────
function ModeOption({ focused, icon: Icon, label, count, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.modeOption, focused && styles.modeOptionFocused]}
    >
      <Icon size={14} color={focused ? '#fff' : palette.textMuted} strokeWidth={2.4} />
      <Text style={[styles.modeOptionText, focused && styles.modeOptionTextFocused]}>
        {label}
      </Text>
      <View style={[styles.modeBadge, focused && styles.modeBadgeFocused]}>
        <Text style={[styles.modeBadgeText, focused && styles.modeBadgeTextFocused]}>
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Recorded-video card ────────────────────────────────────────────────────
function RecordedVideoCard({ video, accent, onPress }) {
  const thumb = resolveAssetUrl(video.thumbnail_url) || youtubeThumb(video.video_url);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.cardThumb, { backgroundColor: accent.soft }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[styles.center, { flex: 1 }]}>
            <Video size={26} color={accent.vivid} strokeWidth={2.2} />
          </View>
        )}
        {video.duration_seconds ? (
          <View style={styles.durationPill}>
            <Text style={styles.durationText}>
              {Math.round((Number(video.duration_seconds) || 0) / 60)} min
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {video.title || 'Untitled recording'}
        </Text>
        {video.batch_name ? (
          <View style={styles.cardMeta}>
            <User size={11} color={palette.textMuted} strokeWidth={2.2} />
            <Text style={styles.cardMetaText} numberOfLines={1}>{video.batch_name}</Text>
          </View>
        ) : null}
        {video.created_at ? (
          <View style={styles.cardMeta}>
            <Clock size={11} color={palette.textMuted} strokeWidth={2.2} />
            <Text style={styles.cardMetaText}>{formatScheduledTime(video.created_at)}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: spacing.sm }}>
          <View style={[styles.actionBtn, { backgroundColor: accent.vivid }]}>
            <PlayCircle size={13} color="#fff" strokeWidth={2.4} />
            <Text style={styles.actionBtnText}>Watch</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Live-now hero ───────────────────────────────────────────────────────────
function LiveNowHero({ live, onJoin }) {
  const thumb = resolveAssetUrl(live.thumbnail_url) || youtubeThumb(live.youtube_url);
  return (
    <View style={styles.heroWrap}>
      <View style={styles.hero}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        <View style={styles.heroOverlay} />
        <View style={{ position: 'relative', zIndex: 2 }}>
          <View style={styles.liveBadge}>
            <View style={styles.livePulse} />
            <Text style={styles.liveBadgeText}>LIVE NOW</Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>{live.title}</Text>
          <Text style={styles.heroTrainer}>
            with {live.trainer_name || live.trainer || 'Veerify Trainer'}
          </Text>
          <TouchableOpacity onPress={onJoin} activeOpacity={0.85} style={styles.heroJoinBtn}>
            <Radio size={14} color={palette.rose.vivid} strokeWidth={2.6} />
            <Text style={styles.heroJoinText}>Join now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
function LiveCard({ liveClass, accent, mode, onJoin, onWatch }) {
  const thumb = resolveAssetUrl(liveClass.thumbnail_url) || youtubeThumb(liveClass.youtube_url || liveClass.recording_url);
  const isPastNoRecording = mode === 'Recordings' && !liveClass.recording_url;

  return (
    <View style={styles.card}>
      <View style={[styles.cardThumb, { backgroundColor: accent.soft }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[styles.center, { flex: 1 }]}>
            {mode === 'Upcoming'
              ? <Radio size={26} color={accent.vivid} strokeWidth={2.2} />
              : <PlayCircle size={28} color={accent.vivid} strokeWidth={2.2} />}
          </View>
        )}
        {liveClass.duration ? (
          <View style={styles.durationPill}>
            <Text style={styles.durationText}>{liveClass.duration}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={2}>{liveClass.title}</Text>
        <View style={styles.cardMeta}>
          <User size={11} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.cardMetaText} numberOfLines={1}>
            {liveClass.trainer_name || liveClass.trainer || 'Veerify Trainer'}
          </Text>
        </View>
        {liveClass.start_time ? (
          <View style={styles.cardMeta}>
            {mode === 'Upcoming'
              ? <Calendar size={11} color={palette.textMuted} strokeWidth={2.2} />
              : <Clock size={11} color={palette.textMuted} strokeWidth={2.2} />}
            <Text style={styles.cardMetaText}>{formatScheduledTime(liveClass.start_time)}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: spacing.sm }}>
          {mode === 'Upcoming' ? (
            <TouchableOpacity
              onPress={onJoin}
              activeOpacity={0.85}
              style={[styles.actionBtn, { backgroundColor: accent.vivid }]}
            >
              <Radio size={13} color="#fff" strokeWidth={2.6} />
              <Text style={styles.actionBtnText}>Join</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={isPastNoRecording ? undefined : onWatch}
              disabled={isPastNoRecording}
              activeOpacity={0.85}
              style={[
                styles.actionBtn,
                { backgroundColor: isPastNoRecording ? palette.borderSoft : accent.vivid },
              ]}
            >
              <PlayCircle size={13} color={isPastNoRecording ? palette.textMuted : '#fff'} strokeWidth={2.4} />
              <Text style={[
                styles.actionBtnText,
                { color: isPastNoRecording ? palette.textMuted : '#fff' },
              ]}>
                {isPastNoRecording ? 'No recording' : 'Watch'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header — paddingTop is overridden at render time with the safe-area
  // inset so the academy-name pill never sits behind the status bar.
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  eyebrow: { ...type.caption, color: palette.textMuted },
  instSelector: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  instText: { ...type.display, color: palette.text, maxWidth: 260 },

  // Mode toggle (Live sessions / Recorded videos)
  modeToggleWrap: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    padding: 4,
    ...shadows.card,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  modeOptionFocused: {
    backgroundColor: palette.purple.vivid,
  },
  modeOptionText: {
    ...type.caption,
    color: palette.textMuted,
    fontWeight: '700',
  },
  modeOptionTextFocused: {
    color: '#fff',
  },
  modeBadge: {
    minWidth: 20, height: 18, paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  modeBadgeFocused: { backgroundColor: 'rgba(255,255,255,0.28)' },
  modeBadgeText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  modeBadgeTextFocused: { color: '#fff' },

  // Upsell screen for non-paid users
  upsell: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl + 40,
  },

  // Live-now hero
  heroWrap: { paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
  hero: {
    height: 180, borderRadius: radius.xl, overflow: 'hidden',
    backgroundColor: palette.rose.vivid,
    padding: spacing.lg,
    justifyContent: 'flex-end',
    ...shadows.raised,
  },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: palette.rose.vivid,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  livePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  liveBadgeText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 1 },
  heroTitle: { ...type.h1, color: '#fff', marginTop: spacing.sm },
  heroTrainer: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  heroJoinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  heroJoinText: { ...type.bodyBold, color: palette.rose.on },

  // Tabs
  tabsWrap: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  tabPillFocused: { backgroundColor: palette.purple.vivid },
  tabText: { ...type.caption, color: palette.textMuted, fontWeight: '700' },
  tabTextFocused: { color: '#fff' },
  tabBadge: {
    minWidth: 22, height: 20, paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeFocused: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { ...type.micro, color: palette.textMuted },
  tabBadgeTextFocused: { color: '#fff' },

  // Card
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardThumb: {
    width: 110, height: 110,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  durationPill: {
    position: 'absolute', bottom: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.sm,
  },
  durationText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  cardTitle: { ...type.h3, color: palette.text, fontSize: 14 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardMetaText: { ...type.caption, color: palette.textMuted, flex: 1 },
  actionBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  actionBtnText: { ...type.caption, color: '#fff', fontWeight: '700' },

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
