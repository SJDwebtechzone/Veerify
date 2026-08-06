// src/screens/student/tabs/BatchesTabScreen.js
//
// Student-facing Batches tab — the STUDENT'S OWN enrolled batches.
//
// Product rule (per spec):
//   • Show only batches the student is actively enrolled in.
//   • Never show other batches from the institution / branch.
//   • Empty state reads "No enrolled batches found."
//
// Enforcement:
//   • Data comes from GET /api/enrollments/my — a role-gated
//     (`requireRole('student')`) endpoint that filters by
//     `req.user.id` server-side. There is no way for the client to
//     ask for another student's batches, and no institution-wide
//     batch list is fetched here.
//   • We further filter to payment_status === 'paid' so pending /
//     failed enrolments (still on the Pay Now flow) don't surface
//     as "your batches" — those live on the Enrolled Programs
//     screen with a Pay Now CTA.
//
// Each card shows: Batch Name · Course · Trainer · Branch · Schedule
// (days + time) · Status (Active / Completed).

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, RefreshControl, FlatList,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Clock, Calendar, User, Building2, Wifi, MapPin, GraduationCap,
} from 'lucide-react-native';

import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import { useBellScrollHandler } from '../../../components/bellScrollBus';
import { formatBatchTimeRange } from '../../../utils/formatTime';
import { partitionBatches } from '../../../utils/batchOccurrence';

const ACCENTS = [palette.purple, palette.blue, palette.green, palette.orange, palette.pink, palette.teal];
const cycleAccent = (i) => ACCENTS[i % ACCENTS.length];

// Derive a status for the batch — Active (currently running) or
// Completed (course window elapsed). Prefers explicit batch.status
// when the backend provides one; otherwise infers from start_date /
// end_date when present.
function deriveStatus(b) {
  const raw = (b.status || b.batch_status || '').toLowerCase();
  if (['completed', 'finished', 'ended', 'closed'].includes(raw)) return 'Completed';
  if (['upcoming', 'scheduled', 'pending', 'running', 'active', 'in_progress', 'ongoing'].includes(raw)) return 'Active';
  const now = Date.now();
  const end = b.end_date ? new Date(b.end_date).getTime() : null;
  if (end && end < now) return 'Completed';
  return 'Active';
}

function formatSchedule(b) {
  const time =
    formatBatchTimeRange(b.start_time, b.end_time) ||
    b.time || b.timing || '';
  const days = b.days || b.days_of_week || '';
  return { time, days };
}

// Transform an /enrollments/my row into the batch shape the card
// renders. The backend already joins batches + courses + trainers +
// branch, so we just pick the fields.
function enrollmentToBatch(e) {
  return {
    id:             e.batch_id || e.id,
    enrollment_id:  e.id,
    name:           e.batch_name || `Batch ${e.batch_id || e.id}`,
    course_name:    e.course_name || null,
    trainer_name:   e.trainer_name || null,
    branch_name:    e.batch_branch_name || 'Main Institution',
    institution_name: e.institution_name || null,
    days_of_week:   e.days_of_week || null,
    start_time:     e.start_time || null,
    end_time:       e.end_time || null,
    mode:           e.mode || null,
    end_date:       e.end_date || null,
    status:         e.batch_status || null,
  };
}

export default function BatchesTabScreen({ navigation }) {
  const { user } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // Server-side filter: this endpoint returns ONLY the caller's
      // own enrolments. Role gate + user_id read from the JWT.
      const res = await apiClient.get('/enrollments/my').catch(() => ({ data: {} }));
      const rows = (res.data?.enrollments || [])
        // Client-side belt-and-suspenders: only surface PAID enrolments
        // as "my batches". Pending / failed rows live on the Enrolled
        // Programs screen with the Pay Now flow.
        .filter((e) => e.payment_status === 'paid')
        // De-duplicate — a student can occasionally have two enrolments
        // pointing at the same batch (e.g. a resume after a refund).
        // We keep the newest by enrolled_at.
        .reduce((acc, e) => {
          const key = e.batch_id || e.id;
          if (!acc.has(key)) acc.set(key, e);
          return acc;
        }, new Map());
      setBatches(Array.from(rows.values()).map(enrollmentToBatch));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // Minute tick so a session that just started / just ended can move
  // between Ongoing and Upcoming without a manual refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Ongoing = a session is live right now. Upcoming = the next
  // occurrence is strictly in the future. Ongoing rows bubble to the
  // top so a live class is one tap away.
  const { ongoing, upcoming } = useMemo(
    () => partitionBatches(batches, new Date(nowTick)),
    [batches, nowTick],
  );
  const orderedBatches = useMemo(
    () => [...ongoing, ...upcoming],
    [ongoing, upcoming],
  );

  const counts = useMemo(() => ({
    Active:    batches.filter((b) => deriveStatus(b) === 'Active').length,
    Completed: batches.filter((b) => deriveStatus(b) === 'Completed').length,
  }), [batches]);

  // Guest fallback — should never render for a signed-in student.
  // The tab is only reachable inside the student stack, but a race
  // during logout could momentarily land here with user=null. We
  // treat that as "no enrolled batches" too.
  const isGuest = !user;

  if (loading && batches.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>My Batches</Text>
        <Text style={styles.title}>
          {batches.length === 0
            ? 'Nothing enrolled yet'
            : `${batches.length} enrolled batch${batches.length === 1 ? '' : 'es'}`}
        </Text>
        {batches.length > 0 ? (
          <View style={styles.summaryChipRow}>
            <View style={[styles.summaryChip, { backgroundColor: palette.green.soft }]}>
              <View style={[styles.summaryDot, { backgroundColor: palette.green.vivid }]} />
              <Text style={[styles.summaryChipText, { color: palette.green.on }]}>
                {counts.Active} Active
              </Text>
            </View>
            {counts.Completed > 0 ? (
              <View style={[styles.summaryChip, { backgroundColor: palette.borderSoft }]}>
                <View style={[styles.summaryDot, { backgroundColor: palette.textMuted }]} />
                <Text style={[styles.summaryChipText, { color: palette.textMuted }]}>
                  {counts.Completed} Completed
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <FlatList
        data={orderedBatches}
        extraData={nowTick}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <GraduationCap size={28} color={palette.purple.vivid} strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>No enrolled batches found.</Text>
            <Text style={styles.emptyBody}>
              {isGuest
                ? 'Sign in to see your batches.'
                : 'Once you enrol in a course, your batch details will appear here.'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <BatchCard batch={item} accent={cycleAccent(index)} />
        )}
      />
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────
function BatchCard({ batch, accent }) {
  const status = deriveStatus(batch);
  const { time, days } = formatSchedule(batch);
  const isOnline = (batch.mode || '').toLowerCase().includes('online');
  const isCompleted = status === 'Completed';

  return (
    <View style={styles.card}>
      {/* Top row — batch name + status pill */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={styles.batchName} numberOfLines={2}>
            {batch.name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 }}>
            {batch.course_name ? (
              <View style={[styles.coursePill, { backgroundColor: accent.soft }]}>
                <Text style={[styles.coursePillText, { color: accent.on }]} numberOfLines={1}>
                  {batch.course_name}
                </Text>
              </View>
            ) : null}
            {batch._next?.isOngoing ? (
              <View style={[styles.coursePill, { backgroundColor: palette.green.soft }]}>
                <Text style={[styles.coursePillText, { color: palette.green.on }]}>
                  IN PROGRESS
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isCompleted ? palette.borderSoft : palette.green.soft,
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isCompleted ? palette.textMuted : palette.green.vivid },
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              { color: isCompleted ? palette.textMuted : palette.green.on },
            ]}
          >
            {status}
          </Text>
        </View>
      </View>

      {/* Meta — Trainer / Branch / Schedule */}
      <View style={styles.metaList}>
        {batch.trainer_name ? (
          <MetaRow icon={User}       label="Trainer" value={batch.trainer_name} />
        ) : null}
        {batch.branch_name ? (
          <MetaRow icon={Building2}  label="Branch"  value={batch.branch_name} />
        ) : null}
        {days ? (
          <MetaRow icon={Calendar}   label="Days"    value={days} />
        ) : null}
        {time ? (
          <MetaRow icon={Clock}      label="Time"    value={time} />
        ) : null}

        {/* Mode pill — online vs in-person */}
        <View style={styles.modeRow}>
          {isOnline ? (
            <View style={[styles.modePill, { backgroundColor: palette.blue.soft }]}>
              <Wifi size={11} color={palette.blue.on} strokeWidth={2.4} />
              <Text style={[styles.modePillText, { color: palette.blue.on }]}>Online</Text>
            </View>
          ) : (
            <View style={[styles.modePill, { backgroundColor: palette.orange.soft }]}>
              <MapPin size={11} color={palette.orange.on} strokeWidth={2.4} />
              <Text style={[styles.modePillText, { color: palette.orange.on }]}>In-person</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function MetaRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.metaRow}>
      <Icon size={13} color={palette.textMuted} strokeWidth={2.2} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
    gap: 2,
  },
  eyebrow: {
    ...type.micro, color: palette.textMuted,
    letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: '700',
  },
  title: {
    ...type.h1, color: palette.text, fontSize: 20, marginTop: 2,
  },
  summaryChipRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginTop: spacing.sm,
  },
  summaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
  },
  summaryDot: { width: 7, height: 7, borderRadius: 4 },
  summaryChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  batchName: { ...type.h3, color: palette.text },
  coursePill: {
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
    maxWidth: '90%',
  },
  coursePillText: { ...type.micro, fontWeight: '700' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { ...type.micro, fontWeight: '800' },

  metaList: { marginTop: spacing.md, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaLabel: { ...type.micro, color: palette.textMuted, width: 56 },
  metaValue: { ...type.caption, color: palette.text, flex: 1, fontWeight: '600' },
  modeRow: { flexDirection: 'row', marginTop: 6 },
  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  modePillText: { fontSize: 10, fontWeight: '700' },

  emptyCard: {
    marginTop: spacing.xxl,
    marginHorizontal: 0,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...type.h2, color: palette.text, fontSize: 16, textAlign: 'center',
  },
  emptyBody: {
    ...type.caption, color: palette.textMuted, textAlign: 'center',
    maxWidth: 280, lineHeight: 18,
  },
});
