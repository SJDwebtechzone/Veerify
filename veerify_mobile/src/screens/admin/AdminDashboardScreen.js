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
  Linking, Modal, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, Users, GraduationCap, Calendar, Wallet,
  TrendingUp, ClipboardCheck, UserPlus, CalendarPlus,
  Megaphone, BellPlus, ChevronRight, BookOpen,
  Clock, AlertTriangle, Lock, CheckCircle2,
  CalendarOff, Gift, Building2, ChevronDown, X as XIcon,
} from 'lucide-react-native';
import { LineChart } from 'react-native-chart-kit';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import StatCard from '../../components/StatCard';
import QuickAction from '../../components/QuickAction';
import { useBellScrollHandler } from '../../components/bellScrollBus';
import FAB from '../../components/FAB';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - spacing.xl * 2;

// Belt-rank distribution palette. Shares sum to 1.0 and match what a
// healthy real-world academy looks like — most students are white, far
// fewer reach black. The strap widths come straight from these shares
// until/unless we wire up a real belt_level column on students.
const BELT_RANKS = [
  { key: 'white',  bg: '#FFFFFF', fg: '#111827', share: 0.32 },
  { key: 'yellow', bg: '#FACC15', fg: '#5C3D04', share: 0.18 },
  { key: 'orange', bg: '#F97316', fg: '#4A1B0C', share: 0.14 },
  { key: 'green',  bg: '#22C55E', fg: '#173404', share: 0.12 },
  { key: 'blue',   bg: '#3B82F6', fg: '#042C53', share: 0.10 },
  { key: 'brown',  bg: '#92400E', fg: '#FFFFFF', share: 0.08 },
  { key: 'black',  bg: '#111111', fg: '#FFFFFF', share: 0.06 },
];

// Compact currency formatter — ₹1,250 → "₹1.25k", ₹98,000 → "₹98k",
// ₹2,40,000 → "₹2.4L". Keeps stat-card values readable at small widths.
function fmtINRShort(n) {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000)   return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)     return `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
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
  // Trial/grace/locked phase for the institution. Populated by
  // /onboarding/subscription-status; drives the banner shown right under
  // the hero.
  const [subscription, setSubscription] = useState(null);

  // Today's institution-wide attendance %, powering the dedicated
  // dashboard card. Kept separate from `data` so a failure fetching
  // it doesn't wipe out the other stats.
  const [todayAtt, setTodayAtt] = useState(null);

  // ── Branch view state (spec: Institution Home Dashboard – Branch View) ─
  // `branches` — the list of sub-branches under this academy. Populated
  //   lazily; only fetched when the dashboard tells us the plan supports
  //   branches AND the academy actually has at least one branch.
  // `selectedBranch` — { id, name } | null. NULL means the default
  //   "whole academy" view (all sections visible). Non-null triggers
  //   the branch-only view — analytics tiles ONLY, no charts / no
  //   quick actions.
  // `branchPickerOpen` — modal visibility for the branch picker sheet.
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  const load = useCallback(async (branchIdArg) => {
    try {
      // Resolve the branch filter — arg wins so the picker's onChange
      // can pass a fresh id without waiting for setState.
      const filterId = branchIdArg !== undefined
        ? branchIdArg
        : (selectedBranch?.id ?? null);
      const dashUrl = filterId != null
        ? `/admin/dashboard?branch_id=${encodeURIComponent(filterId)}`
        : '/admin/dashboard';
      // All three ride the same refresh so pull-to-refresh updates
      // everything at once. .catch on the non-critical ones keeps the
      // dashboard from failing entirely if any single endpoint hiccups.
      const [dashRes, subRes, attRes] = await Promise.all([
        apiClient.get(dashUrl),
        apiClient.get('/onboarding/subscription-status').catch((err) => {
          console.log('[AdminDashboard] subscription-status error:', err.message);
          return null;
        }),
        apiClient.get('/attendance/institution/today').catch((err) => {
          console.log('[AdminDashboard] today attendance error:', err.message);
          return null;
        }),
      ]);
      setData(dashRes.data || {});
      if (subRes && subRes.data) setSubscription(subRes.data);
      setTodayAtt(attRes?.data?.today || null);

      // Populate the branch list when the dashboard says branches are
      // enabled AND we don't already have them. Sub-branch admins
      // never see the picker so we skip the fetch for them.
      const d = dashRes.data || {};
      const branchesEnabled = !d.is_sub_branch
        && Number(d.plan_max_branches || 1) > 1
        && Number(d.branch_count || 0) > 0;
      if (branchesEnabled && branches.length === 0) {
        try {
          const br = await apiClient.get('/branches');
          // Only sub-branches (they own batches). Satellite locations
          // are just extra map pins — irrelevant here.
          const subs = (br.data?.branches || []).filter(
            (b) => b.branch_kind === 'sub_branch',
          );
          setBranches(subs);
        } catch (err) {
          console.log('[AdminDashboard] branches fetch error:', err.message);
        }
      } else if (!branchesEnabled) {
        // Plan downgraded or all branches removed → wipe local state
        // so the dropdown never lingers with stale rows.
        if (branches.length > 0) setBranches([]);
        if (selectedBranch) setSelectedBranch(null);
      }
    } catch (err) {
      // Leave the previous snapshot in place on transient errors so the
      // screen doesn't flash zeros.
      console.log('[AdminDashboard] load error:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedBranch, branches.length]);

  // Refetch when the screen regains focus (after Add Course / Add Batch etc.)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Whether the branch picker should render at all. Derived from the
  // last dashboard response — the same signals the load() effect
  // consults, so the two stay in sync.
  const branchesEnabled = !data.is_sub_branch
    && Number(data.plan_max_branches || 1) > 1
    && Number(data.branch_count || 0) > 0
    && branches.length > 0;

  // Whether we're currently rendering the "single branch analytics"
  // view. Branch view is the trimmed layout — five tiles only, no
  // trainers card, no charts, no quick actions.
  const branchView = !!selectedBranch;

  const onPickBranch = useCallback((branch) => {
    // Collapse the inline dropdown, apply the new branch, kick a
    // fresh fetch. Passing branchId explicitly avoids a stale-
    // selection race with setState batching.
    setBranchPickerOpen(false);
    setSelectedBranch(branch);
    load(branch?.id ?? null);
  }, [load]);

  // Greeting prefers the academy name; falls back to the owner's first name
  // if for any reason the institution row hasn't loaded yet.
  const academyName = institution?.name || (user?.name || 'Academy').split(' ')[0];

  // Resolve the institution's logo to a renderable URL. The DB usually
  // stores "/uploads/foo.png" (relative); we prepend the current api
  // base so the emulator + production both work.
  const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const rawLogo = institution?.logo_url || null;
  const institutionLogo = rawLogo
    ? (rawLogo.startsWith('http') ? rawLogo : ASSET_HOST + rawLogo)
    : null;

  // Time-of-day greeting used by the dashboard header so the page feels
  // personal. Falls back to "Welcome" if for any reason the hour can't
  // be read. Tamil Nadu is the primary market so this uses local time.
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

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
      // Jumps to the Students bottom-tab so the admin sees the
      // full enrolled-student list.
      onPress: () => navigation.navigate('Students'),
    },
    {
      label: 'Active Trainers',
      value: String(counts.trainers || 0),
      delta: counts.trainers === 0 ? 'Add your first trainer' : 'On the team',
      accent: palette.blue,
      icon: GraduationCap,
      onPress: () => navigation.navigate('TrainersList'),
    },
    {
      label: "Today's Classes",
      value: String(counts.today_classes || 0),
      delta: counts.today_classes === 0 ? 'No classes today' : 'Scheduled today',
      accent: palette.green,
      icon: Calendar,
      // Batches are the closest equivalent to "today's classes" in the
      // current information architecture — opens the batch list where
      // each batch shows its schedule and student count.
      onPress: () => navigation.navigate('BatchesList'),
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
      // Earnings tab houses both Pending Fees and Revenue breakdowns.
      onPress: () => navigation.navigate('Earnings'),
    },
    {
      label: 'Revenue',
      value: fmtINRShort(counts.revenue_this_month || 0),
      delta: 'This month',
      accent: palette.pink,
      icon: TrendingUp,
      onPress: () => navigation.navigate('Earnings'),
    },
    {
      // Today's attendance % across every active batch/branch. The
      // number is derived from live attendance records marked by
      // trainers / branch admins so it refreshes the moment marks land.
      // Delta line surfaces the raw counts so admins can eyeball what
      // the % actually represents ("12 of 20 marked today").
      label: "Today's Attendance",
      value: todayAtt == null
        ? '—'
        : `${todayAtt.percentage}%`,
      delta: todayAtt == null
        ? 'No data yet'
        : todayAtt.marked === 0
          ? 'Nothing marked yet today'
          : `${todayAtt.present} / ${todayAtt.marked} marked today`,
      accent: palette.teal,
      icon: ClipboardCheck,
      // Main-institution admin: open the read-only batch-wise
      // Attendance Overview (batch summary → tap → student roster
      // for the picked date).
      // Sub-branch admin: open BranchAttendance so they can MARK
      // attendance for their own branch's batches.
      onPress: () => navigation.navigate(
        data.is_sub_branch ? 'BranchAttendance' : 'AdminAttendanceOverview',
      ),
    },
  ]), [counts, navigation, todayAtt, data.is_sub_branch]);

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

  const bellScroll = useBellScrollHandler();

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
        // Auto-hide the floating notification bell on scroll down,
        // slide it back in on scroll up.
        onScroll={bellScroll}
        scrollEventThrottle={16}
      >
        {/* ───── Header — polished logo + academy name card ─────
            Soft greeting line + a floating white card that holds the
            institution logo, the academy name with a live status pill,
            a member-since line, and the notification bell. Replaces the
            old solid-red hero. */}
        <View style={styles.topBar}>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.greetingName} numberOfLines={1}>
            {(user?.name || 'Admin').split(' ')[0]} 👋
          </Text>

          <View style={styles.identityCard}>
            <View style={styles.logoWrap}>
              <View style={styles.logoRing}>
                {institutionLogo ? (
                  <Image source={{ uri: institutionLogo }} style={styles.topBarLogo} />
                ) : (
                  <View style={styles.topBarLogoFallback}>
                    <Text style={styles.topBarLogoInitial}>
                      {(academyName || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.topBarName} numberOfLines={1}>
                  {academyName}
                </Text>
                <View style={styles.activePill}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activePillText}>Active</Text>
                </View>
              </View>
              {institution?.city ? (
                <Text style={styles.topBarSub} numberOfLines={1}>
                  {institution.city}
                  {institution?.institution_type ? ` · ${institution.institution_type}` : ''}
                </Text>
              ) : (
                <Text style={styles.topBarSub} numberOfLines={1}>Tap the bell for updates</Text>
              )}
            </View>
            {/* Inline bell removed — see GlobalNotificationBell which
                floats over every screen. Left the wrapping <View>
                unchanged so the topbar layout still spaces correctly.
                Unread badge is intentionally dropped here; only the
                floating global bell is the canonical notification
                affordance across the app now. */}
          </View>
        </View>

        {/* ───── Branch dropdown ─────
            Renders ONLY when the plan supports branches AND the
            academy actually has at least one sub-branch. Tapping the
            trigger EXPANDS an inline dropdown right below the row
            (no bottom sheet) so the branch list appears exactly
            where the eye is. Selecting a branch flips the dashboard
            into "branch view" — five analytics tiles only, everything
            else (chart, activity, quick actions, subscription banner)
            collapses. Selecting "All (whole academy)" restores the
            default layout without reloading the page. */}
        {branchesEnabled ? (
          <BranchPickerBar
            selected={selectedBranch}
            open={branchPickerOpen}
            branches={branches}
            onToggle={() => setBranchPickerOpen((v) => !v)}
            onClear={() => onPickBranch(null)}
            onPick={onPickBranch}
          />
        ) : null}

        {/* ───── Subscription banner (trial / grace / locked) ─────
            Hidden when the academy has already paid (phase === 'paid') or
            isn't yet approved (phase === 'pending' / 'registered'). Inside
            the trial it's an informational blue strip; in grace it turns
            amber + adds Pay Now; after grace it goes red + locks the CTA.
            Also hidden in Branch View so the trimmed layout only has
            analytics on-screen. */}
        {branchView ? null : (
          <SubscriptionBanner
            subscription={subscription}
          />
        )}

        {/* ───── Stats grid ─────
            Default view: all 6 tiles (Total Students, Trainers,
            Today's Classes, Pending Fees, Revenue, Today's Attendance).
            Branch view: only the 5 tiles the spec calls out —
            Total Students, Attendance %, Today's Classes, Revenue,
            Pending Fees. We swap "Today's Attendance" for the
            Attendance % counts.attendance_pct so the tile matches
            what the picked branch actually reported this month. */}
        <View style={styles.statsGrid}>
          {(() => {
            // Branch View: rebuild the 5 tiles so each carries the
            // picked branchId as a route param — the destination
            // screens honour it and re-query with ?branch_id=X so the
            // list they show contains ONLY that branch's rows.
            const b = selectedBranch;
            const brRoute = b ? { branchId: b.id, branchName: b.name } : {};
            const branchTiles = [
              {
                label: 'Total Students',
                value: String(counts.students || 0),
                delta: counts.students === 0 ? 'No enrollments yet' : `In ${b?.name || 'this branch'}`,
                accent: palette.purple,
                icon: Users,
                onPress: () => navigation.navigate('Students', brRoute),
              },
              {
                label: 'Attendance %',
                value: counts.attendance_pct == null ? '—' : `${counts.attendance_pct}%`,
                delta: counts.attendance_pct == null
                  ? 'No attendance marked yet'
                  : 'This month',
                accent: palette.teal,
                icon: ClipboardCheck,
                onPress: () => navigation.navigate('AdminAttendanceOverview', brRoute),
              },
              {
                label: "Today's Classes",
                value: String(counts.today_classes || 0),
                delta: counts.today_classes === 0 ? 'No classes today' : `In ${b?.name || 'this branch'}`,
                accent: palette.green,
                icon: Calendar,
                onPress: () => navigation.navigate('BatchesList', brRoute),
              },
              {
                label: 'Revenue',
                value: fmtINRShort(counts.revenue_this_month || 0),
                delta: 'This month',
                accent: palette.pink,
                icon: TrendingUp,
                onPress: () => navigation.navigate('Earnings', { ...brRoute, focus: 'revenue' }),
              },
              {
                label: 'Pending Fees',
                value: fmtINRShort(counts.pending_fees_total || 0),
                delta: counts.pending_fees_count > 0
                  ? `${counts.pending_fees_count} ${counts.pending_fees_count === 1 ? 'student' : 'students'}`
                  : 'All up to date',
                accent: palette.orange,
                icon: Wallet,
                onPress: () => navigation.navigate('Earnings', { ...brRoute, focus: 'pending' }),
              },
            ];
            return branchView ? branchTiles : stats;
          })().reduce((rows, stat, idx) => {
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
                  onPress={s.onPress}
                />
              ))}
              {/* Pad odd-count rows so the last tile keeps its width. */}
              {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
        </View>

        {/* ───── Quick actions (hidden in Branch View) ───── */}
        {/* Branch View intentionally shows only the 5 analytics tiles
            per spec, so Quick Actions collapse. Sub-branch admins and
            the default main view keep the full six-tile row of 3. */}
        {branchView ? null : (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          <View style={styles.quickActions}>
            {[
              {
                icon: UserPlus,
                label: 'Add Student',
                accent: palette.purple,
                // Opens the same student enrollment form that a student
                // fills when buying a course. The form handles the
                // admin-initiated path by showing an inline batch picker
                // at the top when no batch_id was passed in.
                onPress: () => navigation.navigate('EnrollmentForm', { adminMode: true }),
              },
              // Add Course / Create Batch / Trainer Approvals / Refer & Earn
              // are main-institution operations. Sub-branch admins only
              // manage their own branch's day-to-day, so we hide them
              // when the caller is a sub-branch admin (see the
              // `mainOnly` flag — filtered out below).
              { icon: BookOpen,     label: 'Add Course',       accent: palette.teal,   mainOnly: true, onPress: () => navigation.navigate('CreateCourse') },
              { icon: CalendarPlus, label: 'Create Batch',     accent: palette.blue,   mainOnly: true, onPress: () => navigation.navigate('CreateBatch') },
              { icon: BellPlus,     label: 'Add Event',        accent: palette.green,  onPress: () => navigation.navigate('CreateEvent') },
              { icon: Megaphone,    label: 'Send Notice',      accent: palette.orange, onPress: () => navigation.navigate('SendAnnouncement') },
              // Trainer Leaves — main-institution only. Leave
              // approval / rejection is a parent-academy
              // responsibility, so the tile is hidden for
              // sub-branch admins (the existing mainOnly filter
              // below drops the row entirely, and the grid
              // reflows automatically because it's built by
              // chunking the surviving actions into rows of 3).
              { icon: CalendarOff,  label: 'Trainer Leaves',   accent: palette.rose,   mainOnly: true, onPress: () => navigation.navigate('AdminTrainerLeaves') },
              { icon: Megaphone,    label: 'Trainer Approvals', accent: palette.purple, mainOnly: true, onPress: () => navigation.navigate('PendingAnnouncements') },
              { icon: Gift,         label: 'Refer & Earn',     accent: palette.green,  mainOnly: true, onPress: () => navigation.navigate('AdminReferEarn') },
            ].filter((qa) => !(qa.mainOnly && data.is_sub_branch))
             .reduce((rows, qa, idx) => {
              if (idx % 3 === 0) rows.push([qa]);
              else rows[rows.length - 1].push(qa);
              return rows;
            }, []).map((row, ri) => (
              <View key={ri} style={styles.quickActionsRow}>
                {row.map((qa) => (
                  <QuickAction
                    key={qa.label}
                    icon={qa.icon}
                    label={qa.label}
                    accent={qa.accent}
                    onPress={qa.onPress}
                  />
                ))}
                {/* Pad short trailing rows so the last tile doesn't stretch to
                    full width. Spacer copies the same flex:1 the tile uses. */}
                {Array.from({ length: 3 - row.length }, (_, i) => (
                  <View key={`pad-${i}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))}
          </View>
        </View>
        )}

        {/* ───── Monthly revenue chart (hidden in Branch View) ───── */}
        {branchView ? null : (
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
        )}

        {/* ───── Recent activity teaser (hidden in Branch View) ───── */}
        {branchView ? null : (
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
        )}

        {/* Footer spacer so content clears the floating tab bar + FAB */}
        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Branch picker is now an inline expanding dropdown rendered
          inside BranchPickerBar above — no bottom-sheet modal. */}

      {/* Floating + button hidden — the placeholder "Quick Create" wasn't
          wired to anything useful and was confusing admins. The Quick
          Actions grid above already covers every add path. */}
      {/*
      <FAB
        bottom={92}
        onPress={() => placeholder('Quick Create')}
        accent={palette.purple}
      />
      */}
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

// ── Branch picker (inline dropdown) ─────────────────────────────────
// Rendered directly below the header. Tapping the trigger toggles an
// inline expanding panel that lists "All (whole academy)" as the
// reset row plus one entry per sub-branch. Same shape as the Skills
// picker on SetupInstitution: no Modal, no bottom sheet — the list
// simply appears anchored to the trigger and pushes the rest of the
// dashboard down until the admin picks a branch or taps the trigger
// again to collapse.
function BranchPickerBar({ selected, open, branches, onToggle, onClear, onPick }) {
  const rows = [{ id: null, name: 'All (whole academy)', reset: true }, ...branches];
  const selectedId = selected?.id ?? null;

  return (
    <View style={styles.branchBar}>
      <TouchableOpacity
        style={[styles.branchTrigger, open && styles.branchTriggerOpen]}
        activeOpacity={0.85}
        onPress={onToggle}
      >
        <View style={styles.branchIconWrap}>
          <Building2 size={16} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.branchLabel}>Branch</Text>
          <Text style={styles.branchValue} numberOfLines={1}>
            {selected ? selected.name : 'All (whole academy)'}
          </Text>
        </View>
        {selected ? (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.branchClear}
          >
            <XIcon size={14} color={palette.textMuted} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : (
          <ChevronDown
            size={16}
            color={palette.textMuted}
            strokeWidth={2.4}
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          />
        )}
      </TouchableOpacity>

      {open ? (
        <View style={styles.branchPanel}>
          {rows.map((item, idx) => {
            const isSel = (selectedId ?? null) === (item.id ?? null);
            return (
              <React.Fragment key={String(item.id ?? 'all')}>
                {idx > 0 ? <View style={styles.branchDivider} /> : null}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => onPick(item.reset ? null : item)}
                  style={[styles.branchRow, isSel && styles.branchRowActive]}
                >
                  <View style={styles.branchRowIcon}>
                    <Building2
                      size={14}
                      color={item.reset ? palette.textMuted : palette.purple.vivid}
                      strokeWidth={2.4}
                    />
                  </View>
                  <Text
                    style={[styles.branchRowName, isSel && styles.branchRowNameActive]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {isSel ? (
                    <CheckCircle2 size={16} color={palette.green.vivid} strokeWidth={2.4} />
                  ) : null}
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * SubscriptionBanner — surfaces the institution's lifecycle phase.
 *
 *   trial   : informational, no CTA. Counts down days left.
 *   grace   : amber, "Pay now to continue". Opens payment link.
 *   locked  : red, hard-lock messaging. Opens payment link.
 *   paid    : hidden (academy is fully active).
 *   pending : hidden (still awaiting super-admin approval).
 *
 * The discount, if enabled on the plan, is applied server-side and surfaces
 * here as plan.effective_price (the actual amount the academy will pay).
 */
function SubscriptionBanner({ subscription }) {
  if (!subscription) return null;
  const { phase, days_left_in_trial, days_left_in_grace,
          payment_link_url, plan } = subscription;

  // Nothing to show for already-active or not-yet-approved academies.
  if (phase === 'paid' || phase === 'pending' || phase === 'registered') {
    return null;
  }

  // Open the Razorpay link in the system browser. We don't have a deep
  // payment screen for the institution-admin yet; the link itself is the
  // hosted Razorpay page.
  const onPay = async () => {
    if (!payment_link_url) {
      Alert.alert('Payment link not ready',
        'Your payment link is still being generated. Please pull to refresh in a moment.');
      return;
    }
    try {
      const can = await Linking.canOpenURL(payment_link_url);
      if (!can) throw new Error('Cannot open URL');
      await Linking.openURL(payment_link_url);
    } catch {
      Alert.alert('Could not open payment page',
        'Please try again, or check your email for the payment link.');
    }
  };

  // Phase-specific copy + colour.
  let cfg;
  if (phase === 'trial') {
    const days = Number(days_left_in_trial) || 0;
    cfg = {
      tone: 'blue',
      Icon: Clock,
      title: `Free trial — ${days} day${days === 1 ? '' : 's'} left`,
      subtitle: `Enjoy all features. After your trial ends you'll have ${plan?.grace_days || 0} days to pay.`,
      ctaLabel: 'View plan',
      showCTA: !!payment_link_url,
    };
  } else if (phase === 'grace') {
    const days = Number(days_left_in_grace) || 0;
    cfg = {
      tone: 'amber',
      Icon: AlertTriangle,
      title: `Payment due — ${days} day${days === 1 ? '' : 's'} of grace left`,
      subtitle: `Pay ₹${(plan?.effective_price || plan?.price || 0).toLocaleString('en-IN')} to keep your academy active.`,
      ctaLabel: 'Pay now',
      showCTA: true,
    };
  } else {
    // 'locked' phase
    cfg = {
      tone: 'red',
      Icon: Lock,
      title: 'Subscription locked',
      subtitle: `Your grace period ended. Pay ₹${(plan?.effective_price || plan?.price || 0).toLocaleString('en-IN')} to restore access.`,
      ctaLabel: 'Pay now',
      showCTA: true,
    };
  }

  const toneStyles = subStyles.tones[cfg.tone];
  const Icon = cfg.Icon;
  return (
    <View style={[subStyles.card, toneStyles.card]}>
      <View style={[subStyles.iconWrap, toneStyles.iconWrap]}>
        <Icon size={18} color={toneStyles.iconColor} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[subStyles.title, toneStyles.title]}>{cfg.title}</Text>
        <Text style={[subStyles.subtitle, toneStyles.subtitle]}>{cfg.subtitle}</Text>
        {plan?.discount_enabled && plan?.discount_percent > 0 ? (
          <Text style={[subStyles.discount, toneStyles.subtitle]}>
            {plan.discount_percent}% discount applied (was ₹{(plan.price || 0).toLocaleString('en-IN')})
          </Text>
        ) : null}
      </View>
      {cfg.showCTA ? (
        <TouchableOpacity
          onPress={onPay}
          style={[subStyles.cta, toneStyles.cta]}
          activeOpacity={0.85}
        >
          <Text style={[subStyles.ctaText, toneStyles.ctaText]}>{cfg.ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const subStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  discount: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  cta: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md,
  },
  ctaText: { fontSize: 12, fontWeight: '700' },

  tones: {
    blue: {
      card:     { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
      iconWrap: { backgroundColor: '#DBEAFE' },
      iconColor:'#1D4ED8',
      title:    { color: '#1E3A8A' },
      subtitle: { color: '#1E40AF' },
      cta:      { backgroundColor: '#1D4ED8' },
      ctaText:  { color: '#FFFFFF' },
    },
    amber: {
      card:     { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
      iconWrap: { backgroundColor: '#FEF3C7' },
      iconColor:'#B45309',
      title:    { color: '#78350F' },
      subtitle: { color: '#92400E' },
      cta:      { backgroundColor: '#B45309' },
      ctaText:  { color: '#FFFFFF' },
    },
    red: {
      card:     { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
      iconWrap: { backgroundColor: '#FEE2E2' },
      iconColor:'#B91C1C',
      title:    { color: '#7F1D1D' },
      subtitle: { color: '#991B1B' },
      cta:      { backgroundColor: '#B91C1C' },
      ctaText:  { color: '#FFFFFF' },
    },
  },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: {
    // Hero bleeds to the very top of the screen — the hero itself
    // handles status-bar padding so the brand-red panel runs edge to
    // edge under the system clock.
    paddingTop: 0,
    paddingHorizontal: spacing.xl,
  },

  // ── Concept B hero block ─────────────────────────────────────────
  // Solid brand-red panel that anchors the top of the dashboard.
  // Polished card-style header: a soft gradient-feel container with a
  // friendly greeting, then a white "identity card" holding the logo,
  // academy name + Active pill, city/type sub-line, and the bell.
  topBar: {
    marginHorizontal: -spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: palette.purple.soft,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
  },
  greeting: {
    ...type.caption,
    color: palette.purple.on,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  greetingName: {
    ...type.h1,
    color: palette.text,
    marginTop: 2,
    marginBottom: spacing.lg,
  },

  // Identity card that holds the logo + name + bell
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  logoWrap: { padding: 0 },
  logoRing: {
    width: 56, height: 56, borderRadius: 28,
    padding: 3,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  topBarLogo: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: palette.borderSoft,
  },
  topBarLogoFallback: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  topBarLogoInitial: { fontSize: 20, fontWeight: '800', color: '#fff' },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topBarName: { ...type.h2, color: palette.text, flexShrink: 1 },
  topBarSub: {
    ...type.caption,
    color: palette.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },

  // Tiny green "Active" status pill beside the academy name.
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: palette.green.soft,
  },
  activeDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: palette.green.vivid,
  },
  activePillText: {
    fontSize: 10, fontWeight: '800',
    color: palette.green.on, letterSpacing: 0.3,
  },

  topBarBellBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },

  // Bleeds full-width by using negative horizontal margins to cancel
  // out the ScrollView's padding.
  hero: {
    backgroundColor: palette.rose.vivid,
    marginHorizontal: -spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl + spacing.md,
    paddingBottom: spacing.xl + spacing.sm,
    marginBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroEyebrow: {
    ...type.micro,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  heroDojo: {
    ...type.h1,
    color: '#fff',
    fontSize: 20,
    marginTop: 2,
  },
  heroBellBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: spacing.lg,
  },
  heroHeadlineNumber: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  heroHeadlineLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },

  // Notification dot (used by hero bell)
  dot: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  dotText: { color: palette.rose.vivid, fontSize: 9, fontWeight: '800' },

  // Stats grid (legacy - kept in case anything else references it)
  statsGrid: { gap: spacing.md, marginBottom: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.md },

  // ── Branch picker bar ──────────────────────────────────────────
  branchBar: {
    marginBottom: spacing.md,
  },
  branchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    ...shadows.card,
  },
  branchTriggerOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderColor: palette.purple.vivid + '55',
  },
  branchPanel: {
    marginTop: -1,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: palette.purple.vivid + '55',
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    overflow: 'hidden',
  },
  branchIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: (palette.purple?.soft || '#EDE9FE'),
  },
  branchLabel: {
    ...type.micro,
    color: palette.textMuted,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  branchValue: {
    ...type.body,
    color: palette.textStrong || palette.text,
    fontWeight: '800',
    marginTop: 1,
  },
  branchClear: {
    padding: 4,
    borderRadius: 999,
    backgroundColor: palette.borderSoft,
  },

  // ── Branch picker modal (bottom sheet) ────────────────────────
  branchModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  branchModalSheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  branchModalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  branchModalTitle: {
    ...type.h4,
    fontWeight: '900',
    color: palette.textStrong || palette.text,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  branchRowActive: {
    backgroundColor: (palette.purple?.soft || '#EDE9FE') + '55',
  },
  branchRowIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: (palette.purple?.soft || '#EDE9FE'),
  },
  branchRowName: {
    ...type.body,
    color: palette.text,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  branchRowNameActive: {
    color: palette.purple.vivid,
    fontWeight: '900',
  },
  branchDivider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginHorizontal: spacing.lg,
  },

  // ── Concept D: belt distribution hero ────────────────────────────────
  beltCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  beltHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm + 2,
  },
  beltHeading: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  beltCountLabel: {
    ...type.micro,
    color: palette.textLight,
    fontWeight: '700',
  },
  beltStrap: {
    flexDirection: 'row',
    height: 32,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  beltSegment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  beltSegmentText: {
    fontSize: 10,
    fontWeight: '800',
  },
  beltLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  beltLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  beltLegendDot: { width: 8, height: 8, borderRadius: 4 },
  beltLegendText: {
    ...type.micro,
    color: palette.textLight,
    fontWeight: '700',
  },

  // 2x2 pastel tile grid
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 2,
    marginBottom: spacing.xxl,
  },
  tile: {
    width: `${(100 - 4) / 2}%`,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  tileLabel: {
    ...type.micro,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: -0.3,
  },

  // Section header — title on the left, "See all" link on the right
  // pushed by justifyContent: 'space-between'. Title gets flex:1 with
  // shrinkable behaviour so it never collides with the link.
  section: { marginBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { ...type.h2, color: palette.text, flex: 1, flexShrink: 1 },
  sectionSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,   // bigger tap target without changing visual
    paddingLeft: spacing.sm,
  },
  linkText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Quick actions — outer card stacks the rows vertically.
  quickActions: {
    backgroundColor: palette.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.lg,
    ...shadows.card,
  },
  // Each row holds up to 3 QuickAction tiles. flex:1 on the tiles (set inside
  // the QuickAction component) gives every column equal width.
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
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
