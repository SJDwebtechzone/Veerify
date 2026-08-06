// src/screens/staff/StaffDashboardScreen.js
//
// Step 1 of the Staff (trainer) module — premium dashboard for academy
// trainers logging in via the mobile app.
//
// Layout (top to bottom):
//   1. Header — greeting with the trainer's name + avatar, a notification bell
//      with unread dot.
//   2. Stat cards (2x2 grid): Today's Classes, Total Students,
//      Pending Leave, Attendance %.
//   3. Quick Actions (2x2 grid): Mark Attendance, View Students,
//      Approve Leave, Send Announcement.
//   4. Today's Classes — horizontal scroll of class timing cards.
//   5. Upcoming Batches — vertical list of compact batch rows.
//
// Data:
//   GET /api/batches/trainer/my  → my assigned batches (real)
//   Today's classes derived from those batches' days_of_week.
//   Total students = sum of enrolled_count across my batches.
//   Pending Leave + Attendance % use placeholders until the real endpoints
//   are wired in subsequent steps.

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, ClipboardCheck, Users, CalendarClock, Percent,
  UserCheck, MessageSquare, BookOpen, Clock, ChevronRight, Video,
  GraduationCap, CalendarOff, Star, Award,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import NotificationBellButton from '../../components/NotificationBellButton';
// Shared resolver — strips embedded localhost / 10.0.2.2 hosts from
// legacy DB rows so uploads written before the bug fix still render
// on any client.
import resolveAssetUrl from '../../utils/assetUrl';
// Shared 12-hour clock formatter — the spec mandates AM/PM everywhere,
// so batch timings must never render the raw 24h TIME from Postgres.
import { formatBatchTime, formatBatchTimeRange } from '../../utils/formatTime';
// Recurring-schedule maths — computes the next real occurrence of a
// batch from days_of_week + start/end time so "Upcoming" never shows a
// slot whose scheduled datetime has already passed.
import { partitionBatches } from '../../utils/batchOccurrence';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function StaffDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Institution branding banners are GUEST-ONLY per the branding
  // spec — trainers must never see them. The BannerCarousel below
  // has been removed; keeping the local state as an empty constant
  // means the rest of the file compiles unchanged if a future refactor
  // reintroduces the carousel.
  const banners = [];

  // `myLeaves` is the trainer's OWN leave history (from /trainer-leave-requests/my,
  // backed by the trainer_leave_requests table). We compute how many days
  // this trainer has been on leave during the current calendar month from
  // every approved request and surface that as the "Leave this month" stat.
  // (Previously this card read /leave-requests/trainer/my, which is the
  // STUDENT leave review queue — not the trainer's own time off.)
  const [myLeaves, setMyLeaves] = useState([]);
  // Trainer's own joined profile — used to render the avatar photo + the
  // pretty name in the header. Falls back to `user` from AuthContext when
  // the fetch hasn't returned yet so the header never flashes empty.
  const [me, setMe] = useState(null);
  // Unread notifications count — powers the bell badge. Refetched on
  // focus so the dot / number always reflects reality when the trainer
  // returns to the dashboard. GET /notifications?limit=1 gives us the
  // `counts.unread` field cheaply.
  const [unreadCount, setUnreadCount] = useState(0);
  const loadUnread = useCallback(async () => {
    try {
      const r = await apiClient.get('/notifications?limit=1');
      setUnreadCount(Number(r.data?.counts?.unread) || 0);
    } catch { /* keep last value */ }
  }, []);
  useFocusEffect(useCallback(() => { loadUnread(); }, [loadUnread]));
  // Upcoming institution events — published by the academy admin via
  // /institutions/me/events, fanned out to every linked trainer here.
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    try {
      const [batchRes, leaveRes, meRes, eventsRes] = await Promise.all([
        apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } })),
        apiClient.get('/trainer-leave-requests/my').catch(() => ({ data: { leave_requests: [] } })),
        apiClient.get('/trainers/me').catch(() => ({ data: { trainer: null } })),
        apiClient.get('/institutions/me/events').catch(() => ({ data: { events: [] } })),
      ]);
      setBatches(batchRes.data?.batches || []);
      setMyLeaves(leaveRes.data?.leave_requests || []);
      setMe(meRes.data?.trainer || meRes.data || null);
      setEvents(eventsRes.data?.events || []);
    } catch (err) {
      console.log('[StaffDashboard] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Nudge every minute so a session that just ended / just started
  // moves between Today's Classes and Upcoming without waiting for a
  // full refresh. Cheap because the calculation is pure JS over the
  // already-loaded batches list.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Partition into "in progress right now" (Today's Classes) and
  // "next session strictly in the future" (Upcoming Batches). The
  // helper computes the real datetime of each batch's next occurrence
  // from days_of_week + start_time, so a slot whose end time has
  // already passed today is automatically kicked forward to next
  // week — matching the spec.
  const { ongoing: todayClasses, upcoming: upcomingBatchList } = useMemo(
    () => partitionBatches(batches, new Date(nowTick)),
    [batches, nowTick],
  );
  const totalStudents = useMemo(
    () => batches.reduce((sum, b) => sum + (Number(b.enrolled_count) || 0), 0),
    [batches],
  );

  // Leave days this month — sum the day count of every APPROVED leave
  // request whose range intersects the current calendar month. Handles
  // requests that span across month boundaries by clamping start/end to
  // the month window before counting.
  const leaveDaysThisMonth = useMemo(() => {
    const now    = new Date();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const mEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0); // inclusive
    let total = 0;
    myLeaves.forEach((lr) => {
      if (lr.status !== 'approved') return;
      const s = new Date(lr.start_date);
      const e = new Date(lr.end_date);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
      const clampedStart = s < mStart ? mStart : s;
      const clampedEnd   = e > mEnd   ? mEnd   : e;
      if (clampedEnd < clampedStart) return;
      // +1 because both endpoints are inclusive.
      total += Math.round((clampedEnd - clampedStart) / 86400000) + 1;
    });
    return total;
  }, [myLeaves]);

  const attendancePct = batches.length ? 92 : 0;

  const displayName = me?.name || user?.name || 'Trainer';
  const photoUrl = resolveAssetUrl(me?.photo_url);
  const initials = (displayName || 'T')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'T';

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <ScrollView
        style={styles.screen}
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
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <View style={styles.greetRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('StaffProfile')}
            activeOpacity={0.85}
          >
            <View style={styles.avatar}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('StaffProfile')}
            activeOpacity={0.85}
          >
            <Text style={styles.eyebrow}>Welcome back</Text>
            <Text style={styles.greetName} numberOfLines={1}>{displayName}</Text>
          </TouchableOpacity>
          {/* Notification bell sits in the top-right of the Welcome
              card so the bell reads as part of the greeting rather
              than a floating overlay. Kept unread badge + tap-to-open
              behavior identical to the shared button. */}
          <NotificationBellButton showBackground={false} />
        </View>
        <Text style={styles.headerSub}>
          {todayClasses.length > 0
            ? `You have ${todayClasses.length} ${todayClasses.length === 1 ? 'class' : 'classes'} today.`
            : 'No classes scheduled for today.'}
        </Text>
      </View>

      {/* ───── Stat cards ───── */}
      <View style={styles.statsGrid}>
        <StatCard
          icon={CalendarClock}
          label="Today's Classes"
          value={todayClasses.length}
          accent={palette.purple}
        />
        <StatCard
          icon={Users}
          label="Total Students"
          value={totalStudents}
          accent={palette.blue}
        />
        <StatCard
          icon={ClipboardCheck}
          label="My Leave (mo)"
          value={leaveDaysThisMonth}
          accent={palette.orange}
        />
        <StatCard
          icon={Percent}
          label="Attendance"
          value={`${attendancePct}%`}
          accent={palette.green}
        />
      </View>

      {/* Institution branding banner removed per spec — branding is
          reserved for the Guest User marketing flow. Logged-in
          trainers no longer see the auto-scrolling carousel here. */}


      {/* ───── Quick Actions ───── */}
      <SectionHeader title="Quick Actions" />
      <View style={styles.actionsGrid}>
        <ActionButton
          icon={UserCheck}
          label="Mark Attendance"
          accent={palette.purple}
          onPress={() => navigation.navigate('StaffAttendance')}
        />
        <ActionButton
          icon={GraduationCap}
          label="View Students"
          accent={palette.blue}
          onPress={() => navigation.navigate('StaffStudents')}
        />
        <ActionButton
          icon={ClipboardCheck}
          label="Approve Leave"
          accent={palette.orange}
          onPress={() => navigation.navigate('StaffLeaveRequests')}
        />
        <ActionButton
          icon={MessageSquare}
          label="Send Announcement"
          accent={palette.green}
          onPress={() => navigation.navigate('TrainerSendAnnouncement')}
        />
        <ActionButton
          icon={Award}
          label="Completed Students"
          accent={palette.rose}
          onPress={() => navigation.navigate('StaffCompletedStudents')}
        />
        <ActionButton
          icon={Video}
          label="Share Videos"
          accent={palette.rose}
          onPress={() => navigation.navigate('StaffVideos')}
        />
        <ActionButton
          icon={CalendarOff}
          label="Request Leave"
          accent={palette.teal}
          onPress={() => navigation.navigate('TrainerRequestLeave')}
        />
        <ActionButton
          icon={Star}
          label="Performance"
          accent={palette.pink}
          onPress={() => navigation.navigate('StaffPerformanceReports')}
        />
        {/* Promote Belt was here — moved off the Home dashboard per
            spec. Belt promotions now happen ONLY from:
              Home → View Students → student → Curriculum → Promote Belt
            The StaffPromoteStudent screen + backend endpoint are
            deliberately left in place so any existing deep link (a
            stale push notification, a bookmarked route) still works;
            we just don't offer the shortcut from the dashboard grid
            anymore. */}
      </View>

      {/* ───── Today's Classes ───── */}
      {todayClasses.length > 0 && (
        <>
          <SectionHeader title="Today's Classes" subtitle={DAYS[new Date().getDay()]} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
          >
            {todayClasses.map((b) => (
              <ClassTimingCard
                key={b.id}
                batch={b}
                onPress={() => navigation.navigate('StaffAttendance', { batchId: b.id })}
              />
            ))}
          </ScrollView>
        </>
      )}

      {/* ───── Upcoming Batches ─────
          Only batches whose next scheduled session is strictly in the
          future (device-local). Anything happening RIGHT NOW is above
          under Today's Classes. `partitionBatches` handles the roll-
          forward automatically once a slot's end time passes. */}
      <SectionHeader
        title="Upcoming Batches"
        actionLabel="See all"
        onAction={() => navigation.navigate('StaffStudents')}
      />
      {batches.length === 0 ? (
        <View style={styles.emptyCard}>
          <BookOpen size={28} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No batches assigned</Text>
          <Text style={styles.emptySub}>
            Ask your academy admin to add you to a batch.
          </Text>
        </View>
      ) : upcomingBatchList.length === 0 ? (
        <View style={styles.emptyCard}>
          <BookOpen size={28} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No upcoming sessions</Text>
          <Text style={styles.emptySub}>
            All your batches for today are done. Check back later.
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
          {upcomingBatchList.slice(0, 5).map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              onPress={() => navigation.navigate('StaffAttendance', { batchId: b.id })}
            />
          ))}
        </View>
      )}

      {/* ───── Upcoming events ─────
          Published by the academy admin via /institutions/me/events.
          Includes globally-curated events too (super-admin rows where
          institution_id IS NULL). */}
      {events.length > 0 ? (
        <>
          <SectionHeader title="Upcoming Events" />
          <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
            {events.slice(0, 5).map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                onPress={() => navigation.navigate('EventDetail', { event: ev })}
              />
            ))}
          </View>
        </>
      ) : null}
      </ScrollView>
    </View>
  );
}

// Tiny event card used in the trainer dashboard. Renders the date as a
// red-tinted block on the left + title/subtitle/location to the right.
// Tap to open the shared EventDetail screen.
function EventRow({ event, onPress }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const day = d ? String(d.getDate()).padStart(2, '0') : '--';
  const mon = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: 12, marginBottom: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1, borderColor: '#E5E7EB',
      }}
    >
      <View
        style={{
          width: 48, height: 56, borderRadius: 10,
          backgroundColor: '#FFE4E6',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#E63946' }}>{day}</Text>
        <Text style={{ fontSize: 9, fontWeight: '800', color: '#E63946', letterSpacing: 0.5 }}>{mon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827' }} numberOfLines={1}>
          {event.title}
        </Text>
        {event.subtitle ? (
          <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2, fontWeight: '600' }} numberOfLines={1}>
            {event.subtitle}
          </Text>
        ) : null}
        {event.location ? (
          <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }} numberOfLines={1}>
            📍 {event.location}
          </Text>
        ) : null}
      </View>
      {/* Fee / Paid chip — same rule as student HomeTab: unpaid paid
          event shows the amount, paid event shows a PAID label. */}
      {event.payment_required && !event.has_paid ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#10B981' }}>
            ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')}
          </Text>
        </View>
      ) : event.payment_required && event.has_paid ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#10B981', letterSpacing: 0.4 }}>
            PAID
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

// Banner carousel — auto-scrolls through every trainer-targeted
// institution banner uploaded via Institution Login → More → Branding.
// When no banner exists we show a single branded default so the strip
// never disappears (spec: "If no banner is uploaded, display the
// default banner.").
function BannerCarousel({ banners, trainerName }) {
  const SCREEN_WIDTH = Dimensions.get('window').width;
  const CARD_WIDTH = SCREEN_WIDTH - spacing.lg * 2;
  const PAGE = CARD_WIDTH + 10;

  const scrollRef = useRef(null);
  const indexRef  = useRef(0);
  const [activeIdx, setActiveIdx] = useState(0);

  // If no institution banners exist, render a single branded default.
  // Marked with `isDefault: true` so styling can differ from real
  // uploaded imagery.
  const list = banners && banners.length > 0
    ? banners
    : [{
        id: 'default',
        isDefault: true,
        title: trainerName ? `Welcome back, ${String(trainerName).split(' ')[0]}!` : 'Welcome to your dashboard',
        subtitle: 'Uploaded banners from your institution will appear here.',
      }];

  useEffect(() => {
    if (list.length < 2) return undefined;
    const id = setInterval(() => {
      const next = (indexRef.current + 1) % list.length;
      indexRef.current = next;
      scrollRef.current?.scrollTo({ x: next * PAGE, animated: true });
      setActiveIdx(next);
    }, 4000);
    return () => clearInterval(id);
  }, [list.length, PAGE]);

  const onMomentumScrollEnd = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / PAGE);
    indexRef.current = i;
    setActiveIdx(i);
  };

  return (
    <View style={{ marginTop: spacing.lg }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={PAGE}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 10 }}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {list.map((b) => {
          const uri = b.image_url ? resolveAssetUrl(b.image_url) : null;
          return (
            <View key={b.id} style={[dashStyles.banner, { width: CARD_WIDTH }]}>
              {uri ? (
                <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                // Default banner background — soft brand gradient via
                // a solid tint since we don't have a linear-gradient
                // dep on this screen. Reads as an intentional "empty"
                // state rather than a broken image.
                <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.purple.vivid }]} />
              )}
              <View style={dashStyles.bannerScrim} />
              <View style={dashStyles.bannerContent}>
                {b.title ? (
                  <Text style={dashStyles.bannerTitle} numberOfLines={1}>{b.title}</Text>
                ) : null}
                {b.subtitle ? (
                  <Text style={dashStyles.bannerSub} numberOfLines={2}>{b.subtitle}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Pagination dots — only when there's more than one banner. */}
      {list.length > 1 ? (
        <View style={dashStyles.dotsRow}>
          {list.map((_, i) => (
            <View
              key={i}
              style={[
                dashStyles.dot,
                i === activeIdx && dashStyles.dotActive,
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: accent.soft }]}>
        <Icon size={18} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.actionIcon, { backgroundColor: accent.soft }]}>
        <Icon size={20} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title, subtitle, actionLabel, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
      {actionLabel ? (
        <TouchableOpacity onPress={onAction} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function ClassTimingCard({ batch, onPress }) {
  const time = batch.start_time
    ? formatBatchTimeRange(batch.start_time, batch.end_time) || 'Time not set'
    : 'Time not set';
  return (
    <TouchableOpacity style={styles.classCard} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.classTimePill}>
        <Clock size={11} color="#fff" strokeWidth={2.6} />
        <Text style={styles.classTimeText}>{time}</Text>
      </View>
      <Text style={styles.className} numberOfLines={2}>{batch.name}</Text>
      {batch.course_name ? (
        <Text style={styles.classCourse} numberOfLines={1}>{batch.course_name}</Text>
      ) : null}
      <View style={styles.classFooter}>
        <View style={styles.classMeta}>
          <Users size={11} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.classMetaText}>{batch.enrolled_count || 0}</Text>
        </View>
        <Text style={styles.classCta}>Mark ›</Text>
      </View>
    </TouchableOpacity>
  );
}

function BatchRow({ batch, onPress }) {
  return (
    <TouchableOpacity style={styles.batchRow} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.batchIcon}>
        <BookOpen size={18} color={palette.purple.vivid} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.batchName} numberOfLines={1}>{batch.name}</Text>
        <View style={styles.batchMetaRow}>
          {batch.days_of_week ? (
            <Text style={styles.batchMetaText}>{batch.days_of_week}</Text>
          ) : null}
          {batch.start_time ? (
            <Text style={styles.batchMetaText}>· {formatBatchTime(batch.start_time)}</Text>
          ) : null}
          <Text style={styles.batchMetaText}>· {batch.enrolled_count || 0} students</Text>
        </View>
      </View>
      <ChevronRight size={16} color={palette.textLight} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl + spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: palette.surface,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    ...shadows.card,
  },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  avatarImg: { width: '100%', height: '100%' },
  eyebrow: { ...type.caption, color: palette.textMuted },
  greetName: { ...type.h1, color: palette.text, marginTop: 1 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.bg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: palette.rose.vivid,
    borderWidth: 1.5, borderColor: palette.surface,
  },
  // Numeric badge — shown when unreadCount > 0. Auto-widens for
  // multi-digit counts and caps at "99+".
  bellBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: palette.rose.vivid,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  bellBadgeText: {
    fontSize: 10, fontWeight: '900', color: '#fff',
    lineHeight: 12, letterSpacing: 0.3,
  },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: spacing.md },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  statCard: {
    width: '47.5%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  statIcon: {
    width: 32, height: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statValue: { ...type.display, fontSize: 22, color: palette.text },
  statLabel: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // Quick actions
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  actionBtn: {
    width: '47.5%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  actionIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...type.bodyBold, color: palette.text, textAlign: 'center', fontSize: 13 },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...type.h2, color: palette.text, fontWeight: '700' },
  sectionSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Class timing card
  classCard: {
    width: 200,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  classTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.vivid,
    marginBottom: spacing.sm,
  },
  classTimeText: { ...type.micro, color: '#fff', fontWeight: '700' },
  className: { ...type.h3, color: palette.text, fontSize: 14 },
  classCourse: { ...type.caption, color: palette.purple.vivid, marginTop: 2 },
  classFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  classMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  classMetaText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  classCta: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Batch row
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  batchIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  batchName: { ...type.bodyBold, color: palette.text },
  batchMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  batchMetaText: { ...type.caption, color: palette.textMuted },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 120,
  },
});

// Institution-banner styles split out so the dashboard's main `styles`
// stays clean. Width matches the screen minus side gutters so each
// banner snaps as one full page in the horizontal pager.
const SCREEN_W = require('react-native').Dimensions.get('window').width;
const dashStyles = StyleSheet.create({
  banner: {
    width: SCREEN_W - spacing.lg * 2,
    height: 130,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.purple.soft,
  },
  bannerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.32)',
  },
  bannerContent: {
    position: 'absolute',
    left: 14, right: 14, bottom: 12,
  },
  bannerTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '600',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },

  // Pagination dots below the carousel — one per banner. The active
  // dot is wider + brand-red so the current slide is obvious.
  dotsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: palette.borderSoft,
  },
  dotActive: {
    width: 16,
    backgroundColor: palette.purple.vivid,
  },
});
