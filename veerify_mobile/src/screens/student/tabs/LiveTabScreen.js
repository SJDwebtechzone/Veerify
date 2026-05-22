// src/screens/student/tabs/LiveTabScreen.js
//
// Student-facing Live Classes tab — institution-scoped.
//
// Sections:
//   1. Header with academy selector
//   2. "Live now" hero card (only if a class is currently live)
//   3. Toggle: Upcoming / Recordings
//   4. List of upcoming OR recorded sessions
//
// Each card: thumbnail (or color block), title, trainer, scheduled time,
// duration, Join (opens the YouTube Live URL) / Watch Recording.
//
// Guest taps Join → "Login + Subscription Required" popup.
// Free taps Join → "Subscribe to Unlock" popup.
//
// Backend live_classes table doesn't exist yet — endpoint returns []. UI is
// fully wired so it'll work the moment we add real rows.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, FlatList, Linking, Alert, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ChevronDown, ChevronRight, Radio, PlayCircle, Clock,
  User, Calendar, Building2,
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

  const [classes, setClasses] = useState([]);
  const [tab, setTab] = useState('Upcoming'); // 'Upcoming' | 'Recordings'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isGuest = !user;

  const load = useCallback(async () => {
    try {
      if (!selectedInstitution?.id) {
        setClasses([]);
        return;
      }
      const res = await apiClient
        .get(`/institutions/${selectedInstitution.id}/live-classes`)
        .catch(() => ({ data: { live_classes: [] } }));
      setClasses(res.data.live_classes || []);
    } catch (err) {
      console.log('[Live] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedInstitution?.id]);

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

  const requireUpgrade = (action) => {
    if (isGuest) {
      Alert.alert(
        'Login + Subscription Required',
        'Sign in and subscribe to join live classes.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Login', onPress: () => navigation.getParent()?.navigate('Login') },
        ],
      );
      return true;
    }
    Alert.alert(
      'Subscribe to ' + action,
      'You need an active subscription to ' + action.toLowerCase() + ' live classes. Pick a plan from your Profile.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'View Plans', onPress: () => navigation.navigate('Profile') },
      ],
    );
    return true;
  };

  const handleJoinLive = (c) => {
    if (requireUpgrade('Join')) return;
    // (unreachable for guest/free — actual join is gated. For paid users we'd
    // hit Linking.openURL(c.youtube_url) here.)
    if (c.youtube_url) Linking.openURL(c.youtube_url).catch(() => {});
  };
  const handleWatchRecording = (c) => {
    if (requireUpgrade('Watch')) return;
    if (c.recording_url) Linking.openURL(c.recording_url).catch(() => {});
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

  const list = tab === 'Upcoming' ? buckets.upcoming : buckets.recordings;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Live at</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('SelectInstitution')}
            activeOpacity={0.85}
            style={styles.instSelector}
          >
            <Text style={styles.instText} numberOfLines={1}>
              {selectedInstitution?.name}
            </Text>
            <ChevronDown size={16} color={palette.purple.vivid} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
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
        {/* Live now hero */}
        {liveNow ? (
          <LiveNowHero live={liveNow} onJoin={() => handleJoinLive(liveNow)} />
        ) : null}

        {/* Tab toggle */}
        <View style={styles.tabsWrap}>
          {['Upcoming', 'Recordings'].map((t) => {
            const focused = tab === t;
            const count = t === 'Upcoming' ? buckets.upcoming.length : buckets.recordings.length;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                activeOpacity={0.85}
                style={[styles.tabPill, focused && styles.tabPillFocused]}
              >
                <Text style={[styles.tabText, focused && styles.tabTextFocused]}>{t}</Text>
                <View style={[styles.tabBadge, focused && styles.tabBadgeFocused]}>
                  <Text style={[styles.tabBadgeText, focused && styles.tabBadgeTextFocused]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* List */}
        {list.length === 0 ? (
          <View style={styles.emptyInline}>
            {tab === 'Upcoming' ? (
              <>
                <Radio size={22} color={palette.textLight} strokeWidth={2} />
                <Text style={styles.emptyInlineText}>
                  No upcoming live classes — check back soon.
                </Text>
              </>
            ) : (
              <>
                <PlayCircle size={22} color={palette.textLight} strokeWidth={2} />
                <Text style={styles.emptyInlineText}>
                  No recordings yet. Past sessions will show up here.
                </Text>
              </>
            )}
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
            {list.map((c, i) => (
              <LiveCard
                key={c.id || i}
                liveClass={c}
                accent={cycleAccent(i)}
                mode={tab}
                onJoin={() => handleJoinLive(c)}
                onWatch={() => handleWatchRecording(c)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
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

  // Header
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.md },
  eyebrow: { ...type.caption, color: palette.textMuted },
  instSelector: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  instText: { ...type.display, color: palette.text, maxWidth: 260 },

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
