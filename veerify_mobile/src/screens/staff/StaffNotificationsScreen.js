// src/screens/staff/StaffNotificationsScreen.js
//
// Step 7 of the Staff module - notifications inbox.
//
// Layout:
//   1. Header  back, "Notifications" title, unread count pill, "Mark all read".
//   2. Category tabs  All / Announcements / Leave / Attendance / Class / Emergency.
//   3. List of notification cards (newest first):
//        - Category icon + accent color
//        - Red unread dot for read_at IS NULL
//        - Title (bold) + message
//        - Relative time ("2h ago")
//        - Tap to mark read AND deep-link if `data.screen` is set.
//        - Long-press / X icon to delete.
//
// Data:
//   GET    /api/notifications?category=...
//   POST   /api/notifications/:id/read
//   POST   /api/notifications/read-all
//   DELETE /api/notifications/:id

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import {
  ArrowLeft, Bell, Megaphone, ClipboardList, CalendarCheck,
  CalendarX, Siren, Sparkles, X as XIcon, Check, CheckCheck,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

// ── Category metadata ──
const CATS = [
  { key: 'all',             label: 'All',           icon: Bell,           accent: palette.purple },
  { key: 'announcement',    label: 'Announcements', icon: Megaphone,      accent: palette.blue },
  { key: 'leave',           label: 'Leave',         icon: ClipboardList,  accent: palette.orange },
  { key: 'attendance',      label: 'Attendance',    icon: CalendarCheck,  accent: palette.green },
  { key: 'class_cancelled', label: 'Class',         icon: CalendarX,      accent: palette.rose },
  { key: 'emergency',       label: 'Alerts',        icon: Siren,          accent: palette.rose },
  { key: 'system',          label: 'System',        icon: Sparkles,       accent: palette.teal },
];

function metaFor(category) {
  return CATS.find((c) => c.key === category) || CATS[CATS.length - 1];
}

// Relative time helper.
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function StaffNotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [active, setActive] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = active === 'all' ? '' : `?category=${active}`;
      const res = await apiClient.get(`/notifications${qs}`).catch(() => ({ data: { notifications: [], counts: {} } }));
      setItems(res.data?.notifications || []);
      setCounts(res.data?.counts || {});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [active]);
  useEffect(() => { load(); }, [load]);

  const markRead = async (n) => {
    if (n.read_at) return; // already read
    try {
      await apiClient.post(`/notifications/${n.id}/read`);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setCounts((prev) => ({ ...prev, unread: Math.max(0, (prev.unread || 1) - 1) }));
    } catch {}
  };

  const onTap = async (n) => {
    await markRead(n);
    const screen = n.data?.screen;
    if (screen) {
      // Strip the reserved `screen` key — React Navigation v7 treats it as a
      // nested-navigator hint and can mis-route silently when we pass it as
      // params for a top-level Stack.Screen. Everything else in n.data is
      // safe to forward as route.params.
      const { screen: _drop, ...params } = n.data || {};
      try { navigation.navigate(screen, params); } catch (err) {
        console.log('[notif] navigate failed:', screen, err?.message);
      }
    }
  };

  const onDelete = (n) => {
    Alert.alert(
      'Delete notification?',
      n.title,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/notifications/${n.id}`);
              setItems((prev) => prev.filter((x) => x.id !== n.id));
            } catch (err) {
              Alert.alert('Could not delete', err.response?.data?.message || err.message || 'Try again.');
            }
          },
        },
      ],
    );
  };

  const markAllRead = async () => {
    if (!counts.unread) return;
    try {
      await apiClient.post('/notifications/read-all');
      setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
      setCounts((prev) => ({ ...prev, unread: 0 }));
    } catch {}
  };

  const unread = counts.unread || 0;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <Text style={styles.headerSub}>
            {unread > 0 ? `${unread} unread` : 'You\'re all caught up.'}
          </Text>
        </View>
        {/* Sent history — visible for any role that can dispatch
            notifications (trainer / admin). Reuses the same screen. */}
        <TouchableOpacity
          onPress={() => navigation.navigate('SentNotifications')}
          style={styles.sentBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.sentBtnText}>Sent</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={markAllRead}
          disabled={!unread}
          style={[styles.markAllBtn, !unread && { opacity: 0.4 }]}
          activeOpacity={0.85}
        >
          <CheckCheck size={14} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.markAllText}>Mark all</Text>
        </TouchableOpacity>
      </View>

      {/* Category tabs */}
      <View style={styles.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
        >
          {CATS.map((c) => {
            const Icon = c.icon;
            const isActive = active === c.key;
            const count = c.key === 'all' ? counts.total : counts[c.key];
            return (
              <TouchableOpacity
                key={c.key}
                style={[
                  styles.tab,
                  isActive && { backgroundColor: c.accent.vivid, borderColor: c.accent.vivid },
                ]}
                onPress={() => setActive(c.key)}
                activeOpacity={0.85}
              >
                <Icon size={13} color={isActive ? '#fff' : c.accent.vivid} strokeWidth={2.4} />
                <Text style={[styles.tabText, isActive && { color: '#fff' }]}>{c.label}</Text>
                {count ? (
                  <View style={[styles.tabCount, isActive && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                    <Text style={[styles.tabCountText, isActive && { color: '#fff' }]}>{count}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
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
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Bell size={32} color={palette.textLight} strokeWidth={1.4} />
            <Text style={styles.emptyTitle}>
              {active === 'all' ? 'No notifications yet' : `No ${metaFor(active).label.toLowerCase()} notifications`}
            </Text>
            <Text style={styles.emptySub}>
              You'll see academy updates, leave requests and reminders here.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md, gap: spacing.sm }}>
            {items.map((n) => (
              <NotificationCard
                key={n.id}
                n={n}
                onPress={() => onTap(n)}
                onDelete={() => onDelete(n)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────
function NotificationCard({ n, onPress, onDelete }) {
  const meta = metaFor(n.category);
  const Icon = meta.icon;
  const unread = !n.read_at;
  return (
    <TouchableOpacity
      style={[styles.card, unread && styles.cardUnread]}
      onPress={onPress}
      onLongPress={onDelete}
      activeOpacity={0.85}
    >
      {/* Category icon block */}
      <View style={[styles.cardIcon, { backgroundColor: meta.accent.soft }]}>
        <Icon size={18} color={meta.accent.vivid} strokeWidth={2.4} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.cardTopRow}>
          <Text
            style={[styles.cardTitle, unread && { color: palette.text, fontWeight: '800' }]}
            numberOfLines={2}
          >
            {n.title}
          </Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        {n.message ? (
          <Text style={styles.cardMsg} numberOfLines={2}>{n.message}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          <Text style={[styles.cardCategory, { color: meta.accent.on }]}>{meta.label}</Text>
          <Text style={styles.cardTime}>{relTime(n.created_at)}</Text>
        </View>
      </View>

      {/* Quick delete (small X) */}
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
        style={styles.deleteBtn}
        activeOpacity={0.6}
      >
        <XIcon size={12} color={palette.textLight} strokeWidth={2.4} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────
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
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  markAllText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Sent-history shortcut next to "Mark all". Small slate pill.
  sentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    marginRight: 6,
  },
  sentBtnText: {
    ...type.micro,
    color: palette.text,
    fontWeight: '800',
  },

  // Tabs
  tabsWrap: {
    backgroundColor: palette.surface,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  tabText: { ...type.caption, color: palette.text, fontWeight: '700' },
  tabCount: {
    minWidth: 20, paddingHorizontal: 6, height: 18,
    borderRadius: 9,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabCountText: { ...type.micro, color: palette.text, fontWeight: '800' },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: palette.purple.vivid,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { flex: 1, ...type.bodyBold, color: palette.text, fontSize: 14 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: palette.purple.vivid,
    marginTop: 6,
  },
  cardMsg: { ...type.caption, color: palette.textMuted, marginTop: 2, lineHeight: 18 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cardCategory: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTime: { ...type.micro, color: palette.textLight, fontWeight: '700' },

  deleteBtn: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 8,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
