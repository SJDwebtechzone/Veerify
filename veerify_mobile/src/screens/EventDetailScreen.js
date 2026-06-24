// src/screens/EventDetailScreen.js
//
// Shared event detail view — used by admin EventsList, trainer
// dashboard, and student MyDashboard / HomeTab. The whole event row is
// passed in via route params so the screen renders instantly without
// another network round-trip. (mobile_events is small enough that the
// list response already carries every field we render here.)
//
// Sections (top to bottom):
//   1. Hero banner (if image_url) with title overlay
//   2. Date + location chips
//   3. Long description
//   4. "Open link" CTA (if link is set — registration form, ticket page,
//      Google Meet, etc.)
//   5. Status pill — Live / Past
//
// Route params:
//   event   the full event row (or at least { title, event_date })

import React from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, Linking, StyleSheet,
} from 'react-native';
import {
  ArrowLeft, Calendar, MapPin, Clock, ExternalLink,
  CheckCircle2, Share2,
} from 'lucide-react-native';

import resolveAssetUrl from '../utils/assetUrl';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';

// "Mon, 22 Jun 2026" — long-form display used in the detail card.
function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function EventDetailScreen({ route, navigation }) {
  const event = route?.params?.event || {};
  const isPast = event.status === 'past'
    || (event.event_date && new Date(event.event_date) < new Date(new Date().toDateString()));

  const eventDate = event.event_date ? new Date(event.event_date) : null;
  const day = eventDate ? String(eventDate.getDate()).padStart(2, '0') : '--';
  const mon = eventDate ? eventDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';

  const openLink = () => {
    if (!event.link) return;
    Linking.openURL(event.link).catch(() => {});
  };

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Event</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero banner */}
        {event.image_url ? (
          <Image
            source={{ uri: resolveAssetUrl(event.image_url) }}
            style={styles.banner}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.banner, styles.bannerEmpty]}>
            <Calendar size={56} color={BRAND} strokeWidth={1.8} />
          </View>
        )}

        {/* Title block — overlaps the banner with a card lift */}
        <View style={styles.titleCard}>
          <View style={styles.titleRow}>
            <View style={[styles.dateBlock, isPast ? styles.dateBlockPast : styles.dateBlockLive]}>
              <Text style={[styles.dateDay, { color: isPast ? TEXT_MUTED : BRAND }]}>{day}</Text>
              <Text style={[styles.dateMonth, { color: isPast ? TEXT_MUTED : BRAND }]}>{mon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{event.title || 'Event'}</Text>
              {event.subtitle ? (
                <Text style={styles.subtitle}>{event.subtitle}</Text>
              ) : null}
            </View>
          </View>

          {/* Status pill */}
          <View style={styles.pillRow}>
            <View style={[
              styles.statusPill,
              isPast ? { backgroundColor: '#F1F5F9' } : { backgroundColor: GREEN + '22' },
            ]}>
              {isPast ? (
                <Clock size={11} color={TEXT_MUTED} strokeWidth={2.4} />
              ) : (
                <CheckCircle2 size={11} color={GREEN} strokeWidth={2.4} />
              )}
              <Text style={[styles.statusText, { color: isPast ? TEXT_MUTED : GREEN }]}>
                {isPast ? 'Past event' : 'Upcoming'}
              </Text>
            </View>
          </View>
        </View>

        {/* Meta facts — date / location / registration cut-off */}
        <View style={styles.metaCard}>
          <MetaRow
            icon={Calendar}
            label="Date"
            value={formatFullDate(event.event_date)}
          />
          {event.registration_closing_date ? (
            <>
              <Divider />
              <MetaRow
                icon={Clock}
                label="Registration closes"
                value={formatFullDate(event.registration_closing_date)}
              />
            </>
          ) : null}
          {event.location ? (
            <>
              <Divider />
              <MetaRow
                icon={MapPin}
                label="Location"
                value={event.location}
              />
            </>
          ) : null}
        </View>

        {/* Description */}
        {event.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About this event</Text>
            <Text style={styles.body}>{event.description}</Text>
          </View>
        ) : null}

        {/* External link CTA */}
        {event.link ? (
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={openLink}
            activeOpacity={0.85}
          >
            <ExternalLink size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.linkBtnText}>Open registration / details</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function MetaRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.metaRow}>
      <View style={styles.metaIconWrap}>
        <Icon size={14} color={BRAND} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header
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
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: TEXT, textAlign: 'center' },

  // Banner
  banner: {
    width: '100%', height: 200,
    backgroundColor: BRAND_SOFT,
  },
  bannerEmpty: {
    alignItems: 'center', justifyContent: 'center',
  },

  // Title card — sits under the banner with a slight lift
  titleCard: {
    backgroundColor: SURFACE,
    marginHorizontal: 16,
    marginTop: -22,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dateBlock: {
    width: 56, height: 64, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  dateBlockLive: { backgroundColor: BRAND_SOFT },
  dateBlockPast: { backgroundColor: '#F1F5F9' },
  dateDay: { fontSize: 20, fontWeight: '900' },
  dateMonth: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: -2 },

  title: { fontSize: 18, fontWeight: '900', color: TEXT, letterSpacing: -0.2 },
  subtitle: { fontSize: 13, color: TEXT_MUTED, marginTop: 4, fontWeight: '600', lineHeight: 18 },

  pillRow: { marginTop: 12, flexDirection: 'row' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  // Meta facts card
  metaCard: {
    backgroundColor: SURFACE,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 6,
    borderWidth: 1, borderColor: BORDER,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  metaIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  metaLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700', letterSpacing: 0.4 },
  metaValue: { fontSize: 14, color: TEXT, fontWeight: '700', marginTop: 1 },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 14 },

  // Description
  section: {
    backgroundColor: SURFACE,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  body: { fontSize: 14, color: TEXT, lineHeight: 21, fontWeight: '500' },

  // External link CTA
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: BRAND,
    shadowColor: BRAND, shadowOpacity: 0.3, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  linkBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
});
