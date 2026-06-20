// src/screens/SentNotificationsScreen.js
//
// Shows the current user's notification send history — what they've
// dispatched, when, to how many recipients, and a per-role breakdown.
// Used by:
//   • Institution admin (sends to students / trainers / institution-wide)
//   • Trainer (sends to students in own batches)
//   • Super admin (sends to institutions and platform-wide broadcasts)
//
// Reads GET /api/notifications/sent and renders a chronological feed.
// Tapping a card expands the message body and the per-role breakdown.

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet, StatusBar, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Bell, Users, GraduationCap, ShieldCheck,
  Calendar, MessageSquare, ChevronDown, ChevronUp,
} from 'lucide-react-native';

import apiClient from '../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';

const CATEGORY_LABEL = {
  class_cancelled: 'Class Cancelled',
  leave:           'Leave',
  attendance:      'Attendance',
  announcement:    'Announcement',
  emergency:       'Emergency',
  system:          'System',
};

function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'Just now';
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function roleSummary(breakdown) {
  if (!breakdown) return '';
  const parts = [];
  const order = [
    ['student', 'student', 'students'],
    ['trainer', 'trainer', 'trainers'],
    ['admin',   'admin',   'admins'],
    ['parent',  'parent',  'parents'],
  ];
  for (const [key, sing, plur] of order) {
    const n = breakdown[key];
    if (n > 0) parts.push(`${n} ${n === 1 ? sing : plur}`);
  }
  return parts.join(' · ');
}

function CategoryPill({ category }) {
  const label = CATEGORY_LABEL[category] || category || 'Notice';
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function SentCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const Icon =
    (item.role_breakdown?.student && Object.keys(item.role_breakdown).length === 1)
      ? GraduationCap
      : (item.role_breakdown?.trainer && Object.keys(item.role_breakdown).length === 1)
        ? ShieldCheck
        : Users;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded((s) => !s)}
      activeOpacity={0.92}
    >
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardIconWrap}>
          <Icon size={16} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title || 'Untitled notice'}
          </Text>
          <View style={styles.metaRow}>
            <CategoryPill category={item.category} />
            <Text style={styles.metaText}>
              {item.recipient_count} {item.recipient_count === 1 ? 'recipient' : 'recipients'}
            </Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{fmtRelative(item.created_at)}</Text>
          </View>
        </View>
        {expanded ? (
          <ChevronUp size={16} color={TEXT_LIGHT} strokeWidth={2.4} />
        ) : (
          <ChevronDown size={16} color={TEXT_LIGHT} strokeWidth={2.4} />
        )}
      </View>

      {expanded ? (
        <View style={styles.cardBody}>
          {item.message ? (
            <Text style={styles.cardMessage}>{item.message}</Text>
          ) : (
            <Text style={styles.cardMessageEmpty}>No body — title only.</Text>
          )}
          <View style={styles.breakdownBox}>
            <View style={styles.breakdownHeader}>
              <Users size={11} color={TEXT_MUTED} strokeWidth={2.4} />
              <Text style={styles.breakdownHeaderText}>Sent to</Text>
            </View>
            <Text style={styles.breakdownText}>
              {roleSummary(item.role_breakdown) || 'No recipients found'}
            </Text>
            {item.sample_names?.length > 0 ? (
              <Text style={styles.sampleNames} numberOfLines={2}>
                {item.sample_names.join(', ')}
                {item.recipient_count > item.sample_names.length
                  ? ` & ${item.recipient_count - item.sample_names.length} more`
                  : ''}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SentNotificationsScreen({ navigation }) {
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/notifications/sent');
      setItems(res?.data?.sent || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[SentNotifications] failed to load:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={SURFACE} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Sent History</Text>
          <Text style={styles.headerSub}>
            {items.length === 0
              ? 'Nothing sent yet'
              : `${items.length} ${items.length === 1 ? 'notice' : 'notices'} dispatched`}
          </Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Bell size={28} color={BRAND} strokeWidth={1.8} />
            </View>
            <Text style={styles.emptyTitle}>No notifications sent yet</Text>
            <Text style={styles.emptySub}>
              Once you send announcements to students or trainers, they'll appear
              here with the recipient breakdown and timestamp.
            </Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => <SentCard item={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 10,
  },
  backBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: TEXT, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  metaText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },
  metaDot: { fontSize: 11, color: TEXT_LIGHT },

  pill: {
    paddingHorizontal: 8, paddingVertical: 2,
    backgroundColor: BRAND_SOFT,
    borderRadius: 999,
  },
  pillText: { fontSize: 10, fontWeight: '800', color: BRAND, letterSpacing: 0.4, textTransform: 'uppercase' },

  cardBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  cardMessage: { fontSize: 13, color: TEXT, lineHeight: 19 },
  cardMessageEmpty: { fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic' },

  breakdownBox: {
    marginTop: 10,
    backgroundColor: BG,
    borderRadius: 10,
    padding: 10,
  },
  breakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  breakdownHeaderText: {
    fontSize: 10, fontWeight: '800', color: TEXT_MUTED,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  breakdownText: { fontSize: 13, color: TEXT, fontWeight: '700', marginTop: 2 },
  sampleNames: { fontSize: 11, color: TEXT_MUTED, fontWeight: '500', marginTop: 4 },

  // Empty state
  emptyCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 4 },
  emptySub: { fontSize: 12, color: TEXT_MUTED, fontWeight: '500', textAlign: 'center', lineHeight: 17 },
});
