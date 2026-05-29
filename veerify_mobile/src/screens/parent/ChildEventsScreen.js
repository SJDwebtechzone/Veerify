// src/screens/parent/ChildEventsScreen.js
//
// Parent Step 9 - Events & Announcements.
//
// Layout:
//   1. Header  back, "Events & Announcements" title, child's academy name.
//   2. Tab toggle - Events / Announcements with live counts.
//   3a. EVENTS tab - rich cards:
//        - Banner image at the top (or pastel gradient placeholder)
//        - Date badge overlapping top-left
//        - Title, subtitle, date+time, venue, description
//        - "Register" button (opens event.link via Linking)
//        - Closing-in pill when registration window is set + still open
//   3b. ANNOUNCEMENTS tab - inbox-style cards filtered to category=
//        'announcement' (and 'emergency' which we surface together).
//
// Data:
//   GET /api/institutions/:id/events                  -> upcoming events
//   GET /api/notifications?category=announcement      -> announcements
//   GET /api/notifications?category=emergency         -> emergency alerts
//   (We merge announcement + emergency for the second tab.)

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Calendar, MapPin, Clock, ChevronRight, Megaphone,
  CalendarRange, Trophy, GraduationCap, BookOpen, Siren, AlertTriangle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Resolve a relative /uploads/<file> path to a full URL the emulator can fetch.
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveImg(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

// Lightweight "what kind of event is this" guesser based on title keywords.
// Real categories belong on the events table; this is a UX nicety for the
// pastel pill on the card.
function guessEventCategory(title = '') {
  const t = String(title).toLowerCase();
  if (/(belt|grading|exam|test)/.test(t))           return { label: 'Belt grading', icon: GraduationCap, accent: palette.purple };
  if (/(tournament|championship|competition|cup)/.test(t)) return { label: 'Competition', icon: Trophy,        accent: palette.orange };
  if (/(seminar|workshop|masterclass|camp)/.test(t)) return { label: 'Seminar',      icon: BookOpen,       accent: palette.blue };
  return                                                 { label: 'Event',        icon: CalendarRange,  accent: palette.green };
}

export default function ChildEventsScreen({ navigation, route }) {
  const { activeChild } = useChild();
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';
  const institutionId = activeChild?.institution_id ?? null;
  const institutionName = activeChild?.institution_name ?? '';

  const [tab, setTab] = useState('events'); // 'events' | 'announcements'
  const [events, setEvents] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [evtRes, annRes, emrRes] = await Promise.all([
        institutionId
          ? apiClient.get(`/institutions/${institutionId}/events`).catch(() => ({ data: { events: [] } }))
          : Promise.resolve({ data: { events: [] } }),
        apiClient.get('/notifications?category=announcement').catch(() => ({ data: { notifications: [] } })),
        apiClient.get('/notifications?category=emergency').catch(() => ({ data: { notifications: [] } })),
      ]);
      setEvents(evtRes.data?.events || []);

      // Merge announcement + emergency into one stream, newest first.
      const a = annRes.data?.notifications || [];
      const e = emrRes.data?.notifications || [];
      const merged = [...a, ...e].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
      setAnnouncements(merged);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [institutionId]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Actions ──
  const handleRegister = async (event) => {
    const raw = (event?.link || '').trim();
    if (!raw) {
      Alert.alert('Coming soon', 'Registration for this event is not open online yet. Contact the academy.');
      return;
    }
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) { Alert.alert('Cannot open link', url); return; }
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Could not open link', err?.message || 'Try again.');
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Events & Announcements</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{institutionName || childName}</Text>
        </View>
      </View>

      {/* Tab toggle */}
      <View style={styles.tabBar}>
        <TabBtn
          label="Events"
          icon={CalendarRange}
          count={events.length}
          active={tab === 'events'}
          onPress={() => setTab('events')}
        />
        <TabBtn
          label="Announcements"
          icon={Megaphone}
          count={announcements.length}
          active={tab === 'announcements'}
          onPress={() => setTab('announcements')}
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : tab === 'events' ? (
          events.length === 0 ? (
            <View style={styles.emptyCard}>
              <CalendarRange size={28} color={palette.textLight} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No upcoming events</Text>
              <Text style={styles.emptySub}>
                Belt gradings, tournaments and seminars will show up here as the
                academy publishes them.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg, marginTop: spacing.md }}>
              {events.map((e) => (
                <EventCard key={e.id} event={e} onRegister={() => handleRegister(e)} />
              ))}
            </View>
          )
        ) : (
          announcements.length === 0 ? (
            <View style={styles.emptyCard}>
              <Megaphone size={28} color={palette.textLight} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No announcements yet</Text>
              <Text style={styles.emptySub}>
                Academy-wide notices, emergency alerts and trainer updates land here.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm, marginTop: spacing.md }}>
              {announcements.map((n) => (
                <AnnouncementCard key={n.id} notif={n} />
              ))}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

// ─── Components ────────────────────────────────────────────────────────

function TabBtn({ label, icon: Icon, count, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon size={14} color={active ? '#fff' : palette.textMuted} strokeWidth={2.4} />
      <Text style={[styles.tabBtnText, active && { color: '#fff' }]}>{label}</Text>
      <View style={[styles.tabBtnCount, active && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
        <Text style={[styles.tabBtnCountText, active && { color: '#fff' }]}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
}

function EventCard({ event, onRegister }) {
  const d = new Date(event.event_date);
  const day = isNaN(d) ? '?' : d.getDate();
  const month = isNaN(d) ? '?' : MONTH_SHORT[d.getMonth()];
  const dayName = isNaN(d) ? '' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  const cat = guessEventCategory(event.title);
  const Icon = cat.icon;
  const img = resolveImg(event.image_url);

  return (
    <View style={styles.eventCard}>
      {/* Banner */}
      <View style={styles.eventBanner}>
        {img ? (
          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: cat.accent.vivid }]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: cat.accent.on, opacity: 0.15 }]} />
          </View>
        )}
        {/* Date badge */}
        <View style={styles.eventDateBadge}>
          <Text style={styles.eventDateDay}>{day}</Text>
          <Text style={styles.eventDateMonth}>{month}</Text>
        </View>
        {/* Category pill */}
        <View style={[styles.eventCatPill, { backgroundColor: cat.accent.vivid }]}>
          <Icon size={10} color="#fff" strokeWidth={2.6} />
          <Text style={styles.eventCatText}>{cat.label}</Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        {event.subtitle ? (
          <Text style={styles.eventSubtitle} numberOfLines={2}>{event.subtitle}</Text>
        ) : null}

        <View style={styles.eventMetaRow}>
          <View style={styles.eventMetaItem}>
            <Clock size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.eventMetaText}>
              {dayName}, {d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
          {event.location ? (
            <View style={styles.eventMetaItem}>
              <MapPin size={11} color={palette.textMuted} strokeWidth={2.4} />
              <Text style={styles.eventMetaText} numberOfLines={1}>{event.location}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.registerBtn, !event.link && styles.registerBtnDimmed]}
          onPress={onRegister}
          activeOpacity={0.9}
        >
          <Text style={styles.registerBtnText}>
            {event.link ? 'Register' : 'View details'}
          </Text>
          <ChevronRight size={14} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AnnouncementCard({ notif }) {
  const isEmergency = notif.category === 'emergency';
  const Icon = isEmergency ? Siren : Megaphone;
  const accent = isEmergency ? palette.rose : palette.purple;

  const created = new Date(notif.created_at);
  const ageHrs = (Date.now() - created.getTime()) / 3600000;
  const relative =
    ageHrs < 1 ? `${Math.floor(ageHrs * 60)}m ago` :
    ageHrs < 24 ? `${Math.floor(ageHrs)}h ago` :
    created.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <View style={[styles.annCard, isEmergency && { borderLeftWidth: 3, borderLeftColor: palette.rose.vivid }]}>
      <View style={[styles.annIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.annTopRow}>
          <Text style={[styles.annTitle, !notif.read_at && { fontWeight: '800' }]} numberOfLines={2}>
            {notif.title}
          </Text>
          {isEmergency ? (
            <View style={[styles.annUrgent, { backgroundColor: palette.rose.soft }]}>
              <AlertTriangle size={9} color={palette.rose.on} strokeWidth={2.6} />
              <Text style={[styles.annUrgentText, { color: palette.rose.on }]}>URGENT</Text>
            </View>
          ) : null}
        </View>
        {notif.message ? (
          <Text style={styles.annMsg} numberOfLines={3}>{notif.message}</Text>
        ) : null}
        <Text style={styles.annTime}>{relative}</Text>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  headerTitle: { ...type.h1, color: palette.text, fontSize: 18 },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  tabBtnActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  tabBtnText: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  tabBtnCount: {
    minWidth: 22, paddingHorizontal: 6, height: 18,
    borderRadius: 9,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBtnCountText: { ...type.micro, color: palette.text, fontWeight: '800' },

  // Event card
  eventCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  eventBanner: {
    height: 140,
    position: 'relative',
    backgroundColor: palette.borderSoft,
  },
  eventDateBadge: {
    position: 'absolute',
    top: spacing.sm, left: spacing.sm,
    width: 52, height: 56, borderRadius: radius.md,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  eventDateDay: { ...type.h1, color: palette.text, fontSize: 20 },
  eventDateMonth: { ...type.micro, color: palette.text, fontWeight: '800', marginTop: -2, letterSpacing: 0.5 },
  eventCatPill: {
    position: 'absolute',
    top: spacing.sm, right: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  eventCatText: { ...type.micro, color: '#fff', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  eventBody: { padding: spacing.md },
  eventTitle: { ...type.h2, color: palette.text, fontSize: 16 },
  eventSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 4, lineHeight: 18 },
  eventMetaRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  eventMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '60%' },
  eventMetaText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },

  registerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  registerBtnDimmed: { backgroundColor: palette.purple.on },
  registerBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },

  // Announcement
  annCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  annIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  annTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  annTitle: { flex: 1, ...type.bodyBold, color: palette.text, fontSize: 14 },
  annUrgent: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  annUrgentText: { ...type.micro, fontWeight: '800', letterSpacing: 0.5 },
  annMsg: { ...type.caption, color: palette.textMuted, marginTop: 4, lineHeight: 18 },
  annTime: { ...type.micro, color: palette.textLight, fontWeight: '700', marginTop: spacing.sm },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center', lineHeight: 18 },
});
