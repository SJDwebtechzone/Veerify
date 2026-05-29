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

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, ClipboardCheck, Users, CalendarClock, Percent,
  UserCheck, MessageSquare, BookOpen, Clock, ChevronRight,
  GraduationCap,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Tiny string-distance helper for matching days_of_week to today.
function classesToday(batches) {
  const today = DAYS[new Date().getDay()];
  return batches.filter((b) => {
    const days = (b.days_of_week || '').toLowerCase();
    return days.includes(today.toLowerCase().slice(0, 3));
  });
}

export default function StaffDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [leaveCounts, setLeaveCounts] = useState({ pending: 0 });

  const load = useCallback(async () => {
    try {
      const [batchRes, leaveRes] = await Promise.all([
        apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } })),
        apiClient.get('/leave-requests/trainer/my?status=pending').catch(() => ({ data: { counts: { pending: 0 } } })),
      ]);
      setBatches(batchRes.data?.batches || []);
      setLeaveCounts(leaveRes.data?.counts || { pending: 0 });
    } catch (err) {
      console.log('[StaffDashboard] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const todayClasses = useMemo(() => classesToday(batches), [batches]);
  const totalStudents = useMemo(
    () => batches.reduce((sum, b) => sum + (Number(b.enrolled_count) || 0), 0),
    [batches],
  );

  // Real pending leave count (Step 6 endpoint). Attendance % remains a
  // synthetic baseline until we add an aggregate endpoint.
  const pendingLeave = leaveCounts.pending || 0;
  const attendancePct = batches.length ? 92 : 0;

  const initials = (user?.name || 'S')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
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
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => navigation.navigate('StaffProfile')}
            activeOpacity={0.85}
          >
            <Text style={styles.eyebrow}>Welcome back</Text>
            <Text style={styles.greetName} numberOfLines={1}>{user?.name || 'Trainer'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => navigation.navigate('StaffNotifications')}
            activeOpacity={0.85}
          >
            <Bell size={20} color={palette.text} strokeWidth={2.2} />
            <View style={styles.bellDot} />
          </TouchableOpacity>
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
          label="Pending Leave"
          value={pendingLeave}
          accent={palette.orange}
        />
        <StatCard
          icon={Percent}
          label="Attendance"
          value={`${attendancePct}%`}
          accent={palette.green}
        />
      </View>

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
          onPress={() => navigation.navigate('StaffNotifications')}
        />
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

      {/* ───── Upcoming Batches ───── */}
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
      ) : (
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
          {batches.slice(0, 5).map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              onPress={() => navigation.navigate('StaffAttendance', { batchId: b.id })}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

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
    ? `${batch.start_time.slice(0, 5)}${batch.end_time ? ' – ' + batch.end_time.slice(0, 5) : ''}`
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
            <Text style={styles.batchMetaText}>· {batch.start_time.slice(0, 5)}</Text>
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
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
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
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
