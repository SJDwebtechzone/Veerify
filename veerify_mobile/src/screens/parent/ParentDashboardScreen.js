// src/screens/parent/ParentDashboardScreen.js
//
// Step 2 of the Parent module - the parent's home tab.
//
// Layout (top to bottom):
//   1. Red header with greeting, active-child chip (tap to switch), bell.
//   2. Stat strip - Today's class / Attendance % / Pending fees / Belt.
//   3. Quick Actions grid (5) - Attendance / Progress / Inform Leave /
//      Pay Fees / Certificates.
//   4. Today's Class card - batch name, time, trainer.
//   5. Attendance summary - %, last 14 sessions as mini bars.
//   6. Performance overview placeholder.
//   7. Pending fees card.
//   8. Recent notifications list (top 3).
//   9. Upcoming events row.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, ChevronDown, ChevronRight, Calendar, ClipboardCheck,
  TrendingUp, Wallet, Award, Clock, User,
  FileText, Plane, Users, Trophy,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { useBellScrollHandler } from '../../components/bellScrollBus';

const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltFor = (id) => BELTS[Math.abs(Number(id) || 0) % BELTS.length];

const STATUS_COLOR = {
  present: palette.green.vivid,
  absent:  palette.rose.vivid,
  late:    palette.orange.vivid,
  leave:   palette.blue.vivid,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

export default function ParentDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const { activeChild, list, loading: childLoading } = useChild();

  const [data, setData] = useState({
    enrollments: [], attendance: [], payments: [], notifications: [], events: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeChild?.child_id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const cid = activeChild.child_id;
    const instId = activeChild.institution_id;
    try {
      const [enrollRes, attRes, payRes, notifRes, evtRes] = await Promise.all([
        apiClient.get(`/parents/children/${cid}/enrollments`).catch(() => ({ data: { enrollments: [] } })),
        apiClient.get(`/parents/children/${cid}/attendance`).catch(() => ({ data: { attendance: [] } })),
        apiClient.get(`/parents/children/${cid}/payments`).catch(() => ({ data: { payments: [] } })),
        apiClient.get('/notifications?limit=3').catch(() => ({ data: { notifications: [] } })),
        instId
          ? apiClient.get(`/institutions/${instId}/events`).catch(() => ({ data: { events: [] } }))
          : Promise.resolve({ data: { events: [] } }),
      ]);
      setData({
        enrollments:   enrollRes.data?.enrollments || [],
        attendance:    attRes.data?.attendance || [],
        payments:      payRes.data?.payments || [],
        notifications: notifRes.data?.notifications || [],
        events:        evtRes.data?.events || [],
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeChild?.child_id, activeChild?.institution_id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Derived ──
  const todayName = DAYS[new Date().getDay()];
  const todayClass = useMemo(() => {
    return data.enrollments.find((e) => {
      const days = (e.days_of_week || '').toLowerCase();
      return days.includes(todayName.toLowerCase().slice(0, 3));
    });
  }, [data.enrollments, todayName]);

  const attendanceStats = useMemo(() => {
    const arr = data.attendance || [];
    const total = arr.length;
    const present = arr.filter((r) => r.status === 'present').length;
    const pct = total > 0 ? Math.round((present / total) * 100) : null;
    const recent = arr.slice(0, 14).reverse();
    return { total, present, pct, recent };
  }, [data.attendance]);

  const pendingFees = useMemo(() => {
    const arr = data.payments || [];
    const pending = arr.filter((p) =>
      p.status === 'pending' || p.payment_status === 'pending',
    );
    const total = pending.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return { count: pending.length, total };
  }, [data.payments]);

  // ── Loading + no-child state ──
  if (childLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  if (!activeChild) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <View style={styles.noChildCard}>
            <Users size={36} color={palette.purple.vivid} strokeWidth={1.6} />
            <Text style={styles.noChildTitle}>Link your first child</Text>
            <Text style={styles.noChildSub}>
              Add your child's student account to start tracking their attendance,
              progress and fees.
            </Text>
            <TouchableOpacity
              style={styles.noChildBtn}
              onPress={() => navigation.navigate('LinkChild')}
              activeOpacity={0.9}
            >
              <Text style={styles.noChildBtnText}>Link a child</Text>
            </TouchableOpacity>
            {list.length > 0 ? (
              <TouchableOpacity
                style={styles.noChildSecondary}
                onPress={() => navigation.navigate('LinkedChildren')}
              >
                <Text style={styles.noChildSecondaryText}>
                  {list.length} linked — tap to manage
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  const belt = beltFor(activeChild.child_id);
  const childInitials = (activeChild.child_name || 'C')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const hasUnread = data.notifications.some((n) => !n.read_at);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
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
        {/* ───── Hero ───── */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>Welcome back</Text>
              <Text style={styles.parentName} numberOfLines={1}>{user?.name || 'Parent'}</Text>
            </View>
            {/* Inline bell removed — GlobalNotificationBell renders
                globally now so it stays visible across every screen. */}
          </View>

          {/* Active child chip. Tapping the avatar opens the full profile;
              tapping the rest of the chip opens the child switcher. */}
          <View style={styles.childChip}>
            <TouchableOpacity
              onPress={() => navigation.navigate('ChildProfile', { childId: activeChild.child_id })}
              activeOpacity={0.85}
              style={[styles.childAvatar, { backgroundColor: belt.bg, borderColor: belt.border }]}
            >
              <Text style={[styles.childInitials, { color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg }]}>
                {childInitials}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => navigation.navigate('LinkedChildren')}
              activeOpacity={0.85}
            >
              <Text style={styles.childChipLabel}>VIEWING · TAP TO SWITCH</Text>
              <View style={styles.childNameRow}>
                <Text style={styles.childName} numberOfLines={1}>{activeChild.child_name}</Text>
                {list.filter((c) => c.status === 'active').length > 1 ? (
                  <ChevronDown size={16} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />
                ) : null}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.childBeltPill}
              onPress={() => navigation.navigate('ChildProfile', { childId: activeChild.child_id })}
              activeOpacity={0.85}
            >
              <Award size={11} color="#fff" strokeWidth={2.4} />
              <Text style={styles.childBeltText}>{belt.label}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ───── Stat strip ───── */}
        <View style={styles.statStrip}>
          <StatTile
            icon={Calendar}
            label="Today's class"
            value={todayClass ? 'Yes' : '—'}
            accent={palette.purple}
          />
          <StatTile
            icon={ClipboardCheck}
            label="Attendance"
            value={attendanceStats.pct === null ? '—' : `${attendanceStats.pct}%`}
            accent={palette.green}
          />
          <StatTile
            icon={Wallet}
            label="Pending"
            value={pendingFees.total > 0 ? fmtINR(pendingFees.total) : '₹0'}
            accent={pendingFees.total > 0 ? palette.orange : palette.blue}
          />
          <StatTile
            icon={Trophy}
            label="Belt"
            value={belt.label}
            accent={palette.pink}
          />
        </View>

        {/* ───── Quick Actions ───── */}
        <SectionHeader title="Quick actions" />
        <View style={styles.actionsGrid}>
          <ActionTile
            icon={ClipboardCheck} label="Attendance" accent={palette.green}
            onPress={() => navigation.navigate('ChildAttendance', { childId: activeChild.child_id })}
          />
          <ActionTile
            icon={TrendingUp} label="Progress" accent={palette.purple}
            onPress={() => navigation.navigate('ChildProgress', { childId: activeChild.child_id })}
          />
          <ActionTile
            icon={Plane} label="Inform Leave" accent={palette.blue}
            onPress={() => navigation.navigate('InformLeave', { childId: activeChild.child_id })}
          />
          <ActionTile
            icon={Wallet} label="Pay Fees" accent={palette.orange}
            onPress={() => navigation.navigate('ChildPayments', { childId: activeChild.child_id })}
          />
          <ActionTile
            icon={FileText} label="Certificates" accent={palette.pink}
            onPress={() => navigation.navigate('ChildCertificates', { childId: activeChild.child_id })}
          />
        </View>

        {loading ? (
          <ActivityIndicator color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : (
          <>
            {/* ───── Today's class ───── */}
            <SectionHeader title="Today's class" subtitle={todayName} />
            {todayClass ? (
              <View style={styles.classCard}>
                <View style={styles.classTime}>
                  <Clock size={11} color="#fff" strokeWidth={2.4} />
                  <Text style={styles.classTimeText}>
                    {todayClass.start_time?.slice(0, 5) || '—'}
                    {todayClass.end_time ? ` – ${todayClass.end_time.slice(0, 5)}` : ''}
                  </Text>
                </View>
                <Text style={styles.classBatch} numberOfLines={2}>{todayClass.batch_name || 'Class'}</Text>
                {todayClass.course_name ? <Text style={styles.classCourse} numberOfLines={1}>{todayClass.course_name}</Text> : null}
                {todayClass.trainer_name ? (
                  <View style={styles.classTrainerRow}>
                    <User size={11} color={palette.textMuted} strokeWidth={2.4} />
                    <Text style={styles.classTrainerText}>{todayClass.trainer_name}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyInline}>
                <Calendar size={20} color={palette.textLight} strokeWidth={2} />
                <Text style={styles.emptyInlineText}>No class scheduled for today.</Text>
              </View>
            )}

            {/* ───── Attendance summary ───── */}
            <SectionHeader
              title="Attendance"
              actionLabel="See all"
              onAction={() => navigation.navigate('ChildAttendance', { childId: activeChild.child_id })}
            />
            <View style={styles.attendanceCard}>
              <View style={styles.attendanceHeader}>
                <View>
                  <Text style={styles.attendancePct}>{attendanceStats.pct === null ? '—' : `${attendanceStats.pct}%`}</Text>
                  <Text style={styles.attendanceLabel}>This year</Text>
                </View>
                <View style={styles.attendanceBadgeCol}>
                  <Text style={styles.attendanceSmall}>{attendanceStats.present}/{attendanceStats.total}</Text>
                  <Text style={styles.attendanceSmallLabel}>Present</Text>
                </View>
              </View>
              {attendanceStats.recent.length > 0 ? (
                <View style={styles.miniChart}>
                  {attendanceStats.recent.map((r, i) => {
                    const c = STATUS_COLOR[r.status] || palette.borderSoft;
                    const h = r.status === 'present' ? 32 : r.status === 'late' ? 24 : r.status === 'leave' ? 20 : 12;
                    return <View key={i} style={[styles.miniBar, { height: h, backgroundColor: c }]} />;
                  })}
                </View>
              ) : (
                <Text style={styles.placeholderInline}>No attendance recorded yet.</Text>
              )}
            </View>

            {/* ───── Performance overview ───── */}
            <SectionHeader
              title="Performance"
              actionLabel="See more"
              onAction={() => navigation.navigate('ChildProgress', { childId: activeChild.child_id })}
            />
            <View style={styles.perfCard}>
              <View style={styles.perfRow}>
                <PerfDot label="Discipline" value={92} color={palette.green.vivid} />
                <PerfDot label="Skills"     value={78} color={palette.blue.vivid} />
                <PerfDot label="Stamina"    value={65} color={palette.orange.vivid} />
              </View>
              <Text style={styles.perfHint}>
                Detailed analytics + trainer feedback land on the Progress tab.
              </Text>
            </View>

            {/* ───── Pending fees ───── */}
            <SectionHeader
              title="Pending fees"
              actionLabel="View all"
              onAction={() => navigation.navigate('ChildPayments', { childId: activeChild.child_id })}
            />
            {pendingFees.count === 0 ? (
              <View style={styles.emptyInline}>
                <Wallet size={20} color={palette.green.vivid} strokeWidth={2} />
                <Text style={[styles.emptyInlineText, { color: palette.green.on }]}>All fees up to date.</Text>
              </View>
            ) : (
              <View style={styles.feesCard}>
                <View style={styles.feesTop}>
                  <View>
                    <Text style={styles.feesLabel}>Total due</Text>
                    <Text style={styles.feesAmount}>{fmtINR(pendingFees.total)}</Text>
                  </View>
                  <View style={styles.feesCountPill}>
                    <Text style={styles.feesCountText}>
                      {pendingFees.count} {pendingFees.count === 1 ? 'invoice' : 'invoices'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => navigation.navigate('ChildPayments', { childId: activeChild.child_id })}
                  activeOpacity={0.9}
                >
                  <Wallet size={14} color="#fff" strokeWidth={2.4} />
                  <Text style={styles.payBtnText}>Pay now</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ───── Recent notifications ───── */}
            {data.notifications.length > 0 ? (
              <>
                <SectionHeader
                  title="Recent notifications"
                  actionLabel="View all"
                  onAction={() => navigation.navigate('StaffNotifications')}
                />
                <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
                  {data.notifications.slice(0, 3).map((n) => (
                    <View key={n.id} style={[styles.notifCard, !n.read_at && styles.notifUnread]}>
                      <View style={[styles.notifDot, !n.read_at && { backgroundColor: palette.purple.vivid }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.notifTitle, !n.read_at && { fontWeight: '800' }]} numberOfLines={1}>{n.title}</Text>
                        {n.message ? <Text style={styles.notifMsg} numberOfLines={1}>{n.message}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* ───── Upcoming events ───── */}
            {data.events.length > 0 ? (
              <>
                <SectionHeader
                  title="Upcoming events"
                  actionLabel="View all"
                  onAction={() => navigation.navigate('ChildEvents')}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
                >
                  {data.events.slice(0, 5).map((e) => (
                    <TouchableOpacity
                      key={e.id}
                      style={styles.eventCard}
                      onPress={() => navigation.navigate('ChildEvents')}
                      activeOpacity={0.9}
                    >
                      <View style={styles.eventDateBadge}>
                        <Text style={styles.eventDay}>{new Date(e.event_date).getDate()}</Text>
                        <Text style={styles.eventMonth}>
                          {new Date(e.event_date).toLocaleDateString(undefined, { month: 'short' })}
                        </Text>
                      </View>
                      <Text style={styles.eventTitle} numberOfLines={2}>{e.title}</Text>
                      {e.location ? <Text style={styles.eventLocation} numberOfLines={1}>📍 {e.location}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────
function StatTile({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionTile({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity style={styles.actionTile} onPress={onPress} activeOpacity={0.85}>
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
        <TouchableOpacity onPress={onAction} style={styles.sectionAction} activeOpacity={0.85}>
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function PerfDot({ label, value, color }) {
  return (
    <View style={styles.perfItem}>
      <View style={[styles.perfRing, { borderColor: color }]}>
        <Text style={[styles.perfValue, { color }]}>{value}</Text>
      </View>
      <Text style={styles.perfLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // No-child state
  noChildCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  noChildTitle: { ...type.h1, color: palette.text, marginTop: spacing.sm, textAlign: 'center' },
  noChildSub: { ...type.body, color: palette.textMuted, textAlign: 'center' },
  noChildBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },
  noChildBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
  noChildSecondary: { marginTop: spacing.sm },
  noChildSecondaryText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Hero
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl + 6,
    paddingBottom: spacing.xl + spacing.sm,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  eyebrow: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  parentName: { ...type.h1, color: '#fff', fontSize: 22, marginTop: 1 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  bellDot: {
    position: 'absolute', top: 9, right: 10,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#fff',
  },

  // Active child chip
  childChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  childAvatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  childInitials: { fontSize: 16, fontWeight: '800' },
  childChipLabel: { ...type.micro, color: 'rgba(255,255,255,0.75)', fontWeight: '700', letterSpacing: 1 },
  childNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  childName: { ...type.bodyBold, color: '#fff', fontSize: 15, flexShrink: 1 },
  childBeltPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  childBeltText: { ...type.micro, color: '#fff', fontWeight: '800' },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: -spacing.md,
  },
  statTile: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    ...shadows.card,
  },
  statIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  statLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 1 },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...type.h2, color: palette.text },
  sectionSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  // Quick actions
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  actionTile: {
    width: '18.5%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  actionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { ...type.micro, color: palette.text, textAlign: 'center', fontWeight: '700' },

  // Class card
  classCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  classTime: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.vivid,
    marginBottom: 6,
  },
  classTimeText: { ...type.micro, color: '#fff', fontWeight: '800' },
  classBatch: { ...type.h3, color: palette.text },
  classCourse: { ...type.caption, color: palette.purple.vivid, marginTop: 2, fontWeight: '700' },
  classTrainerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  classTrainerText: { ...type.caption, color: palette.textMuted, fontWeight: '700' },

  // Empty inline
  emptyInline: {
    marginHorizontal: spacing.xl,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  emptyInlineText: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  placeholderInline: { ...type.caption, color: palette.textMuted, fontStyle: 'italic', marginTop: spacing.sm },

  // Attendance
  attendanceCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  attendanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attendancePct: { ...type.display, color: palette.purple.vivid, fontSize: 32 },
  attendanceLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  attendanceBadgeCol: { alignItems: 'flex-end' },
  attendanceSmall: { ...type.bodyBold, color: palette.text },
  attendanceSmallLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  miniChart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 36, gap: 3, marginTop: spacing.sm,
  },
  miniBar: { flex: 1, borderRadius: 2 },

  // Performance
  perfCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  perfRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  perfItem: { alignItems: 'center' },
  perfRing: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  perfValue: { fontSize: 16, fontWeight: '800' },
  perfLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 4 },
  perfHint: { ...type.micro, color: palette.textMuted, textAlign: 'center', marginTop: spacing.sm, fontStyle: 'italic' },

  // Fees
  feesCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderLeftWidth: 3, borderLeftColor: palette.orange.vivid,
    ...shadows.card,
  },
  feesTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feesLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  feesAmount: { ...type.display, color: palette.text, fontSize: 22, marginTop: 2 },
  feesCountPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.orange.soft,
  },
  feesCountText: { ...type.micro, color: palette.orange.on, fontWeight: '800' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: 10, borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  payBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },

  // Notifications
  notifCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    ...shadows.card,
  },
  notifUnread: { borderLeftWidth: 2, borderLeftColor: palette.purple.vivid },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.borderSoft },
  notifTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  notifMsg: { ...type.micro, color: palette.textMuted, marginTop: 1 },

  // Events
  eventCard: {
    width: 180,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  eventDateBadge: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  eventDay: { ...type.h2, color: palette.purple.on, fontSize: 16 },
  eventMonth: { ...type.micro, color: palette.purple.on, fontWeight: '800', marginTop: -2 },
  eventTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  eventLocation: { ...type.micro, color: palette.textMuted, marginTop: 4 },
});
