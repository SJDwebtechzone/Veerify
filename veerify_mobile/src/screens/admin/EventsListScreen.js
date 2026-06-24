// src/screens/admin/EventsListScreen.js
//
// Admin "Events" tile in the More tab opens this screen. Lists every
// event the institution has ever published — upcoming first, past
// below — with a FAB to jump into the CreateEvent form. Same look-and-
// feel as BatchesList / TrainersList so the admin doesn't have to learn
// a new layout.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Calendar, MapPin, CalendarPlus, CheckCircle2, Clock,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import FAB from '../../components/FAB';
import resolveAssetUrl from '../../utils/assetUrl';
import { palette, spacing, radius, type } from '../../theme';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';

// Format an ISO date as "22 Jun 2026" — short month + 4-digit year.
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function EventsListScreen({ navigation }) {
  const [events, setEvents]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/institutions/me/events/all');
      setEvents(r.data?.events || []);
    } catch (err) {
      console.log('[EventsList] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch every time the screen is focused — covers the "admin just
  // published a new event, comes back to this screen" path.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Split into upcoming + past so the active stuff sits at the top.
  const { upcoming, past } = useMemo(() => {
    const u = [];
    const p = [];
    events.forEach((e) => {
      if (e.status === 'past') p.push(e); else u.push(e);
    });
    // Upcoming sorted soonest first, past newest first (already DESC from API).
    u.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
    return { upcoming: u, past: p };
  }, [events]);

  // Flatten into a single list with section headers so we get one
  // smooth FlatList instead of two stacked ScrollViews.
  const data = useMemo(() => {
    const rows = [];
    if (upcoming.length) {
      rows.push({ type: 'header', label: `Upcoming · ${upcoming.length}` });
      upcoming.forEach((e) => rows.push({ type: 'event', event: e }));
    }
    if (past.length) {
      rows.push({ type: 'header', label: `Past · ${past.length}` });
      past.forEach((e) => rows.push({ type: 'event', event: e }));
    }
    return rows;
  }, [upcoming, past]);

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return <Text style={styles.sectionTitle}>{item.label}</Text>;
    }
    return (
      <EventCard
        event={item.event}
        onPress={() => navigation.navigate('EventDetail', { event: item.event })}
      />
    );
  };

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Events</Text>
          <Text style={styles.headerSub}>
            {events.length} total · {upcoming.length} upcoming
          </Text>
        </View>
      </View>

      {/* ───── List / loading / empty ───── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Calendar size={32} color={BRAND} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptySub}>
            Tap the + button to publish your first event. It'll show up on
            every student and trainer's home screen straight away.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item, i) =>
            item.type === 'header' ? `h-${i}` : `e-${item.event.id}`
          }
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={BRAND}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ───── FAB to add a new event ───── */}
      <FAB
        icon={CalendarPlus}
        bottom={32}
        onPress={() => navigation.navigate('CreateEvent')}
        accent={palette.rose || { vivid: BRAND, soft: BRAND_SOFT, on: '#fff' }}
      />
    </View>
  );
}

// ─── Event card ─────────────────────────────────────────────────────────
function EventCard({ event, onPress }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const day = d ? String(d.getDate()).padStart(2, '0') : '--';
  const mon = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';
  const isPast = event.status === 'past';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, isPast && styles.cardPast]}
    >
      {/* Top row: date block + title block */}
      <View style={styles.cardTop}>
        <View
          style={[
            styles.dateBlock,
            isPast ? { backgroundColor: '#F1F5F9' } : { backgroundColor: BRAND_SOFT },
          ]}
        >
          <Text style={[
            styles.dateDay,
            { color: isPast ? TEXT_MUTED : BRAND },
          ]}>
            {day}
          </Text>
          <Text style={[
            styles.dateMonth,
            { color: isPast ? TEXT_MUTED : BRAND },
          ]}>
            {mon}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
          {event.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>{event.subtitle}</Text>
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaPiece}>
              <Calendar size={11} color={TEXT_MUTED} strokeWidth={2.2} />
              <Text style={styles.metaText}>{formatDate(event.event_date)}</Text>
            </View>
            {event.location ? (
              <View style={styles.metaPiece}>
                <MapPin size={11} color={TEXT_MUTED} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>{event.location}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Status pill */}
        <View
          style={[
            styles.statusPill,
            isPast
              ? { backgroundColor: '#F1F5F9' }
              : { backgroundColor: GREEN + '22' },
          ]}
        >
          {isPast ? (
            <Clock size={10} color={TEXT_MUTED} strokeWidth={2.4} />
          ) : (
            <CheckCircle2 size={10} color={GREEN} strokeWidth={2.4} />
          )}
          <Text
            style={[
              styles.statusText,
              { color: isPast ? TEXT_MUTED : GREEN },
            ]}
          >
            {isPast ? 'Past' : 'Live'}
          </Text>
        </View>
      </View>

      {/* Banner image (if any) */}
      {event.image_url ? (
        <Image
          source={{ uri: resolveAssetUrl(event.image_url) }}
          style={styles.banner}
          resizeMode="cover"
        />
      ) : null}

      {/* Description preview */}
      {event.description ? (
        <Text style={styles.description} numberOfLines={3}>
          {event.description}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginBottom: 6 },
  emptySub: {
    fontSize: 13, color: TEXT_MUTED, textAlign: 'center',
    lineHeight: 19, paddingHorizontal: 12,
  },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: 12, marginBottom: 8,
  },

  // Event card
  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 12,
  },
  cardPast: { opacity: 0.85 },

  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },

  dateBlock: {
    width: 52, height: 60, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  dateDay: { fontSize: 18, fontWeight: '900' },
  dateMonth: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: -2 },

  title: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 3 },
  subtitle: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600', marginBottom: 6 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  metaPiece: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  metaText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  banner: {
    width: '100%', height: 140, borderRadius: 10,
    marginTop: 12,
    backgroundColor: BG,
  },

  description: {
    fontSize: 12, color: TEXT_MUTED,
    lineHeight: 17, marginTop: 10,
  },
});
