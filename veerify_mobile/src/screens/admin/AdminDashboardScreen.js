// src/screens/admin/AdminDashboardScreen.js
//
// Institution admin (academy owner) dashboard.
//
// Layout (top → bottom):
//   1. Header — greeting, name, avatar, bell with unread dot
//   2. Six pastel stat cards (2-column grid):
//        Students, Trainers, Today's Classes, Pending Fees, Revenue, Attendance
//   3. Quick Action row — Add Student, Create Batch, Add Event, Send Notice
//   4. Monthly Revenue line chart (react-native-chart-kit)
//   5. Recent activity teaser (placeholder list)
//   6. Bottom padding so the floating tab bar + FAB don't cover content
//
// Live data lands via GET /api/admin/dashboard — see admin.controller.js
// for the SQL behind every number on this screen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Image, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, Users, GraduationCap, Calendar, Wallet,
  TrendingUp, ClipboardCheck, UserPlus, CalendarPlus,
  Megaphone, BellPlus, ChevronRight, BookOpen,
} from 'lucide-react-native';
import { LineChart } from 'react-native-chart-kit';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import StatCard from '../../components/StatCard';
import QuickAction from '../../components/QuickAction';
import FAB from '../../components/FAB';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - spacing.xl * 2;

// Compact currency formatter — ₹1,250 → "₹1.25k", ₹98,000 → "₹98k",
// ₹2,40,000 → "₹2.4L". Keeps stat-card values readable at small widths.
function fmtINRShort(n) {
  const v = Number(n) || 0;
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `₹${v.toLocaleString('en-IN')}`;
}

function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1)    return 'Just now';
  if (min < 60)   return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)    return `${hr}h ago`;
  const d  = Math.round(hr / 24);
  if (d  < 7)     return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const CHART_CONFIG = {
  backgroundGradientFrom: palette.surface,
  backgroundGradientTo: palette.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(139, 92, 246, ${opacity})`,
  labelColor: () => palette.textMuted,
  propsForBackgroundLines: { stroke: palette.borderSoft, strokeDasharray: '' },
  propsForDots: { r: '5', strokeWidth: '2', stroke: palette.surface },
  fillShadowGradientFrom: palette.purple.vivid,
  fillShadowGradientFromOpacity: 0.2,
  fillShadowGradientTo: palette.purple.soft,
  fillShadowGradientToOpacity: 0.02,
};

export default function AdminDashboardScreen({ navigation }) {
  const { user, institution } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState({
    counts: {
      students: 0,
      trainers: 0,
      today_classes: 0,
      pending_fees_count: 0,
      pending_fees_total: 0,
      revenue_this_month: 0,
      attendance_pct: null,
      unread_notifications: 0,
    },
    monthly_revenue: [],
    recent_activity: [],
  });

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/dashboard');
      setData(res.data || {});
    } catch (err) {
      // Leave the previous snapshot in place on transient errors so the
      // screen doesn't flash zeros.
      console.log('[AdminDashboard] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch when the screen regains focus (after Add Course / Add Batch etc.)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Greeting prefers the academy name; falls back to the owner's first name
  // if for any reason the institution row hasn't loaded yet.
  const academyName = institution?.name || (user?.name || 'Academy').split(' ')[0];
  // Initial used by the avatar fallback (still the owner's initial — that's
  // their personal identity badge).
  const firstName = (user?.name || 'Sensei').split(' ')[0];

  const counts = data.counts || {};
  const unread = counts.unread_notifications || 0;

  // Derived "delta" strings to keep stat cards informative even with real
  // numbers (this used to be hardcoded copy).
  const stats = useMemo(() => ([
    {
      label: 'Total Students',
      value: String(counts.students || 0),
      delta: counts.students === 0 ? 'No enrollments yet' : `Across all batches`,
      accent: palette.purple,
      icon: Users,
    },
    {
      label: 'Active Trainers',
      value: String(counts.trainers || 0),
      delta: counts.trainers === 0 ? 'Add your first trainer' : 'On the team',
      accent: palette.blue,
      icon: GraduationCap,
    },
    {
      label: "Today's Classes",
      value: String(counts.today_classes || 0),
      delta: counts.today_classes === 0 ? 'No classes today' : 'Scheduled today',
      accent: palette.green,
      icon: Calendar,
    },
    {
      label: 'Pending Fees',
      value: fmtINRShort(counts.pending_fees_total || 0),
      delta:
        counts.pending_fees_count > 0
          ? `${counts.pending_fees_count} ${counts.pending_fees_count === 1 ? 'student' : 'students'}`
          : 'All up to date',
      accent: palette.orange,
      icon: Wallet,
    },
    {
      label: 'Revenue',
      value: fmtINRShort(counts.revenue_this_month || 0),
      delta: 'This month',
      accent: palette.pink,
      icon: TrendingUp,
    },
    {
      label: 'Attendance',
      value: counts.attendance_pct == null ? '—' : `${counts.attendance_pct}%`,
      delta: counts.attendance_pct == null ? 'No data yet' : 'This month',
      accent: palette.teal,
      icon: ClipboardCheck,
    },
  ]), [counts]);

  // Revenue chart from the rolling 6-month series. The chart kit needs at
  // least one non-zero datum or it draws a flat line; if every month is 0
  // we still pass through to render the empty grid (which reads as a "no
  // revenue yet" state to the user).
  const revenueChartData = useMemo(() => {
    const series = (data.monthly_revenue || []).slice(-6);
    if (series.length === 0) {
      return null;
    }
    return {
      labels: series.map((m) => m.label),
      // Divide by 1000 since the section title says "₹ in thousands".
      datasets: [{
        data: series.map((m) => Math.round((Number(m.total) || 0) / 1000)),
        color: () => palette.purple.vivid,
        strokeWidth: 3,
      }],
    };
  }, [data.monthly_revenue]);

  const placeholder = (name) =>
    Alert.alert(name, 'We\'ll wire this up as we build out the related screen.');

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* ───── Header ───── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.userName} numberOfLines={1}>{academyName} 👋</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('StaffNotifications')}
            style={styles.iconButton}
            activeOpacity={0.8}
          >
            <Bell size={20} color={palette.text} strokeWidth={2.2} />
            {unread > 0 && (
              <View style={styles.dot}>
                <Text style={styles.dotText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => placeholder('Profile')}
            activeOpacity={0.85}
            style={styles.avatarWrap}
          >
            {user?.profile_image ? (
              <Image source={{ uri: user.profile_image }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ───── Stats grid ───── */}
        <View style={styles.statsGrid}>
          {stats.reduce((rows, stat, idx) => {
            if (idx % 2 === 0) rows.push([stat]);
            else rows[rows.length - 1].push(stat);
            return rows;
          }, []).map((row, ri) => (
            <View key={ri} style={styles.statsRow}>
              {row.map((s) => (
                <StatCard
                  key={s.label}
                  icon={s.icon}
                  label={s.label}
                  value={s.value}
                  delta={s.delta}
                  accent={s.accent}
                />
              ))}
            </View>
          ))}
        </View>

        {/* ───── Quick actions ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          <View style={styles.quickActions}>
            <QuickAction icon={UserPlus}     label="Add Student"   accent={palette.purple} onPress={() => placeholder('Add Student')} />
            <QuickAction icon={BookOpen}     label="Add Course"    accent={palette.teal}   onPress={() => navigation.navigate('CreateCourse')} />
            <QuickAction icon={CalendarPlus} label="Create Batch"  accent={palette.blue}   onPress={() => navigation.navigate('CreateBatch')} />
            <QuickAction icon={BellPlus}     label="Add Event"     accent={palette.green}  onPress={() => placeholder('Add Event')} />
            <QuickAction icon={Megaphone}    label="Send Notice"   accent={palette.orange} onPress={() => placeholder('Send Notice')} />
          </View>
        </View>

        {/* ───── Monthly revenue chart ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Monthly Revenue</Text>
              <Text style={styles.sectionSubtitle}>Last 6 months • ₹ in thousands</Text>
            </View>
            <TouchableOpacity onPress={() => placeholder('Revenue Details')} style={styles.linkRow}>
              <Text style={styles.linkText}>Details</Text>
              <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <View style={styles.chartCard}>
            {loading && !revenueChartData ? (
              <View style={styles.chartLoading}>
                <ActivityIndicator color={palette.purple.vivid} />
              </View>
            ) : revenueChartData ? (
              <LineChart
                data={revenueChartData}
                width={CHART_WIDTH - spacing.lg * 2}
                height={180}
                chartConfig={CHART_CONFIG}
                bezier
                withInnerLines
                withOuterLines={false}
                withVerticalLines={false}
                withDots
                fromZero
                segments={4}
                style={{ marginLeft: -spacing.md }}
              />
            ) : (
              <Text style={styles.chartEmpty}>
                No revenue yet. Approved enrollments will appear here.
              </Text>
            )}
          </View>
        </View>

        {/* ───── Recent activity teaser ───── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => placeholder('Activity Feed')} style={styles.linkRow}>
              <Text style={styles.linkText}>See all</Text>
              <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <View style={styles.activityCard}>
            {loading && (data.recent_activity || []).length === 0 ? (
              <ActivityIndicator color={palette.purple.vivid} style={{ marginVertical: spacing.md }} />
            ) : (data.recent_activity || []).length === 0 ? (
              <Text style={styles.placeholderText}>
                Nothing yet. New enrollments and notifications will surface here.
              </Text>
            ) : (
              (data.recent_activity || []).map((a, i) => {
                // Accent picked by kind / payment status so the eye can
                // scan the feed at a glance.
                let accent = palette.blue;
                if (a.kind === 'enrollment') {
                  accent = a.status === 'paid' ? palette.green
                         : a.status === 'failed' ? palette.rose
                         : palette.orange;
                } else if (a.kind === 'notification') {
                  accent = a.read ? { vivid: palette.textLight } : palette.purple;
                }
                return (
                  <React.Fragment key={`${a.kind}-${i}`}>
                    {i > 0 ? <View style={styles.divider} /> : null}
                    <ActivityRow
                      accent={accent}
                      title={a.title}
                      meta={[a.meta, fmtRelative(a.at)].filter(Boolean).join(' · ')}
                    />
                  </React.Fragment>
                );
              })
            )}
          </View>
        </View>

        {/* Footer spacer so content clears the floating tab bar + FAB */}
        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Floating + button — placeholder for now */}
      <FAB
        bottom={92}
        onPress={() => placeholder('Quick Create')}
        accent={palette.purple}
      />
    </View>
  );
}

function ActivityRow({ accent, title, meta }) {
  return (
    <View style={styles.activityRow}>
      <View style={[styles.activityDot, { backgroundColor: accent.vivid }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityMeta}>{meta}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  greeting: { ...type.caption, color: palette.textMuted, marginBottom: 2 },
  userName: { ...type.display, color: palette.text },
  iconButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  dot: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: palette.rose.vivid,
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  dotText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  avatarWrap: { ...shadows.card, borderRadius: 21 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.purple.soft },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.h3, color: palette.purple.on },

  // Stats grid
  statsGrid: { gap: spacing.md, marginBottom: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.md },

  // Section header
  section: { marginBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: { ...type.h2, color: palette.text },
  sectionSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Quick actions
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: palette.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...shadows.card,
  },

  // Chart
  chartCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    paddingRight: spacing.sm,
    minHeight: 200,
    ...shadows.card,
  },
  chartLoading: {
    height: 180,
    alignItems: 'center', justifyContent: 'center',
  },
  chartEmpty: {
    ...type.caption,
    color: palette.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontStyle: 'italic',
  },
  placeholderText: {
    ...type.caption,
    color: palette.textMuted,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },

  // Activity
  activityCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4 },
  activityTitle: { ...type.bodyBold, color: palette.text },
  activityMeta: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: palette.borderSoft },
});
