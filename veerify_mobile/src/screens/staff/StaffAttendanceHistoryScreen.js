// src/screens/staff/StaffAttendanceHistoryScreen.js
//
// Step 3 of the Staff module - attendance records for the trainer's batches.
//
// Layout:
//   1. Header  back, title, edit hint.
//   2. Batch filter chips - switch between assigned batches.
//   3. Top summary card - overall %, total sessions, students.
//   4. Status-count strip - mini tiles for Present/Absent/Late/Leave totals.
//   5. Month filter chip strip - "All", current month, last few months.
//   6. Timeline of per-date cards. Each card:
//        - Big day number + month
//        - Per-status mini counts + a thin colored bar
//        - Tap -> opens StaffAttendance for that batch + date for editing.
//
// Data:
//   GET /api/attendance/batch/:id              - all records for a batch
//   GET /api/batches/trainer/my                - my batches (chip selector)

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Calendar, ChevronRight, Pencil, Users, Percent,
  Check, X as XIcon, Clock, Plane, CalendarRange,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  present: { label: 'Present', short: 'P',  icon: Check,  accent: palette.green  },
  absent:  { label: 'Absent',  short: 'A',  icon: XIcon,  accent: palette.rose   },
  late:    { label: 'Late',    short: 'L',  icon: Clock,  accent: palette.orange },
  leave:   { label: 'Leave',   short: 'Lv', icon: Plane,  accent: palette.blue   },
};

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function isoDate(d) { return d.toISOString().split('T')[0]; }
function parseISO(s) {
  // Postgres can return either '2026-05-23' or '2026-05-23T00:00:00.000Z' - both work with new Date.
  return new Date(s);
}

export default function StaffAttendanceHistoryScreen({ navigation, route }) {
  const preselectBatchId = route?.params?.batchId ?? null;

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(preselectBatchId);
  const [records, setRecords] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [monthFilter, setMonthFilter] = useState('all'); // 'all' | 'YYYY-MM'

  // ── Fetch batches ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } }));
        const list = res.data?.batches || [];
        if (!cancelled) {
          setBatches(list);
          if (!selectedBatchId && list.length > 0) setSelectedBatchId(list[0].id);
        }
      } finally {
        if (!cancelled) setLoadingBatches(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch attendance for the selected batch ──
  const loadRecords = useCallback(async (batchId) => {
    if (!batchId) { setRecords([]); return; }
    setLoadingRecords(true);
    try {
      const res = await apiClient.get(`/attendance/batch/${batchId}`).catch(() => ({ data: { attendance: [] } }));
      setRecords(res.data?.attendance || []);
    } finally {
      setLoadingRecords(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { loadRecords(selectedBatchId); }, [selectedBatchId, loadRecords]);

  // ── Group by date ──
  // Output: [{ dateIso, dateObj, counts: {present, absent, late, leave}, total }]
  const sessionsByDate = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const iso = isoDate(parseISO(r.date));
      if (!map.has(iso)) {
        map.set(iso, { dateIso: iso, dateObj: parseISO(r.date), counts: { present: 0, absent: 0, late: 0, leave: 0 }, total: 0 });
      }
      const slot = map.get(iso);
      const status = r.status;
      if (slot.counts[status] !== undefined) slot.counts[status]++;
      slot.total++;
    });
    return Array.from(map.values()).sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  }, [records]);

  // ── Month chips ──
  // List of unique YYYY-MM keys in the sessions, with the all-time chip first.
  const monthChips = useMemo(() => {
    const set = new Set();
    sessionsByDate.forEach((s) => {
      set.add(s.dateIso.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [sessionsByDate]);

  // ── Filtered sessions by month ──
  const visibleSessions = useMemo(() => {
    if (monthFilter === 'all') return sessionsByDate;
    return sessionsByDate.filter((s) => s.dateIso.startsWith(monthFilter));
  }, [sessionsByDate, monthFilter]);

  // ── Overall summary across visible sessions ──
  const summary = useMemo(() => {
    let p = 0, a = 0, l = 0, lv = 0, total = 0;
    visibleSessions.forEach((s) => {
      p  += s.counts.present;
      a  += s.counts.absent;
      l  += s.counts.late;
      lv += s.counts.leave;
      total += s.total;
    });
    const pct = total > 0 ? Math.round((p / total) * 100) : 0;
    return { p, a, l, lv, total, pct };
  }, [visibleSessions]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance History</Text>
          {selectedBatch ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {selectedBatch.name}{selectedBatch.course_name ? ` · ${selectedBatch.course_name}` : ''}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadRecords(selectedBatchId); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Batch chips */}
        {loadingBatches ? null : batches.length === 0 ? (
          <Text style={styles.emptyLine}>No batches assigned to you yet.</Text>
        ) : (
          <>
            <View style={styles.sectionLabel}>
              <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.sectionLabelText}>BATCH</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            >
              {batches.map((b) => {
                const active = b.id === selectedBatchId;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.batchChip, active && styles.batchChipActive]}
                    onPress={() => setSelectedBatchId(b.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.batchChipText, active && styles.batchChipTextActive]} numberOfLines={1}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHero}>
            <View style={styles.summaryPctWrap}>
              <Text style={styles.summaryPctValue}>{summary.pct}%</Text>
              <Text style={styles.summaryPctLabel}>Average attendance</Text>
            </View>
            <View style={styles.summaryMetaCol}>
              <SummaryStat
                icon={CalendarRange}
                label="Sessions"
                value={visibleSessions.length}
                accent={palette.purple}
              />
              <SummaryStat
                icon={Users}
                label="Total marks"
                value={summary.total}
                accent={palette.blue}
              />
            </View>
          </View>

          {/* Status mini-tiles */}
          <View style={styles.statusRow}>
            <MiniTile status="present" value={summary.p} />
            <MiniTile status="absent"  value={summary.a} />
            <MiniTile status="late"    value={summary.l} />
            <MiniTile status="leave"   value={summary.lv} />
          </View>
        </View>

        {/* Month filter chips */}
        {monthChips.length > 0 && (
          <>
            <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
              <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.sectionLabelText}>FILTER BY MONTH</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            >
              <MonthChip
                label="All time"
                active={monthFilter === 'all'}
                onPress={() => setMonthFilter('all')}
              />
              {monthChips.map((m) => {
                const [y, mo] = m.split('-');
                return (
                  <MonthChip
                    key={m}
                    label={`${MONTH_SHORT[Number(mo) - 1]} ${y}`}
                    active={monthFilter === m}
                    onPress={() => setMonthFilter(m)}
                  />
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Timeline */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <CalendarRange size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>SESSIONS</Text>
        </View>

        {loadingRecords ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : visibleSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <CalendarRange size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {selectedBatchId ? 'No sessions yet' : 'Pick a batch above'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedBatchId
                ? 'Mark attendance once and it\'ll appear here.'
                : 'Choose one of your batches to view history.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm, marginTop: spacing.sm }}>
            {visibleSessions.map((s) => (
              <SessionCard
                key={s.dateIso}
                session={s}
                onEdit={() => navigation.navigate('StaffAttendance', {
                  batchId: selectedBatchId,
                  date: s.dateIso,
                })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SummaryStat({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.summaryStat}>
      <View style={[styles.summaryStatIcon, { backgroundColor: accent.soft }]}>
        <Icon size={13} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <View>
        <Text style={styles.summaryStatValue}>{value}</Text>
        <Text style={styles.summaryStatLabel}>{label}</Text>
      </View>
    </View>
  );
}

function MiniTile({ status, value }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <View style={[styles.miniTile, { backgroundColor: meta.accent.soft }]}>
      <Icon size={13} color={meta.accent.on} strokeWidth={2.4} />
      <Text style={[styles.miniTileValue, { color: meta.accent.on }]}>{value}</Text>
      <Text style={[styles.miniTileLabel, { color: meta.accent.on }]}>{meta.label}</Text>
    </View>
  );
}

function MonthChip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.monthChip, active && styles.monthChipActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.monthChipText, active && styles.monthChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SessionCard({ session, onEdit }) {
  const d = session.dateObj;
  const dayNum = d.getDate();
  const monthLbl = MONTH_SHORT[d.getMonth()];
  const dayName = d.toLocaleDateString(undefined, { weekday: 'short' });

  const pct = session.total > 0
    ? Math.round((session.counts.present / session.total) * 100)
    : 0;

  // Build the colored proportion bar across the bottom of the card.
  const segments = [
    { key: 'present', flex: session.counts.present, color: STATUS_META.present.accent.vivid },
    { key: 'late',    flex: session.counts.late,    color: STATUS_META.late.accent.vivid },
    { key: 'leave',   flex: session.counts.leave,   color: STATUS_META.leave.accent.vivid },
    { key: 'absent',  flex: session.counts.absent,  color: STATUS_META.absent.accent.vivid },
  ].filter((s) => s.flex > 0);

  return (
    <TouchableOpacity style={styles.sessionCard} onPress={onEdit} activeOpacity={0.9}>
      <View style={styles.sessionRow}>
        <View style={styles.dateBadge}>
          <Text style={styles.dateBadgeDay}>{dayNum}</Text>
          <Text style={styles.dateBadgeMonth}>{monthLbl}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.sessionTop}>
            <Text style={styles.sessionDay}>{dayName}</Text>
            <View style={styles.sessionPctWrap}>
              <Percent size={11} color={palette.green.on} strokeWidth={2.4} />
              <Text style={styles.sessionPct}>{pct}</Text>
            </View>
          </View>
          <Text style={styles.sessionCount}>{session.total} students marked</Text>

          {/* Per-status counts */}
          <View style={styles.sessionStats}>
            {(['present','absent','late','leave']).map((k) => {
              if (session.counts[k] === 0) return null;
              const meta = STATUS_META[k];
              return (
                <View key={k} style={styles.sessionStat}>
                  <View style={[styles.sessionDot, { backgroundColor: meta.accent.vivid }]} />
                  <Text style={styles.sessionStatText}>
                    {session.counts[k]} {meta.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.editBtn}>
          <Pencil size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
      </View>

      {/* Proportion bar */}
      <View style={styles.bar}>
        {segments.map((seg) => (
          <View key={seg.key} style={{ flex: seg.flex, backgroundColor: seg.color }} />
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
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

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },
  emptyLine: { ...type.caption, color: palette.textMuted, paddingHorizontal: spacing.xl, marginVertical: spacing.sm },

  // Batch chips
  batchChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  batchChipActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  batchChipText: { ...type.caption, color: palette.text, fontWeight: '700' },
  batchChipTextActive: { color: '#fff' },

  // Summary card
  summaryCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  summaryHero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  summaryPctWrap: { alignItems: 'flex-start' },
  summaryPctValue: { ...type.display, color: palette.purple.vivid, fontSize: 38 },
  summaryPctLabel: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  summaryMetaCol: { flex: 1, gap: spacing.sm },
  summaryStat: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryStatIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryStatValue: { ...type.h2, color: palette.text },
  summaryStatLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  miniTile: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  miniTileValue: { ...type.h2, marginTop: 2 },
  miniTileLabel: { ...type.micro, fontWeight: '700', marginTop: 1 },

  // Month chips
  monthChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  monthChipActive: { backgroundColor: palette.text, borderColor: palette.text },
  monthChipText: { ...type.caption, color: palette.text, fontWeight: '700' },
  monthChipTextActive: { color: '#fff' },

  // Session card
  sessionCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  dateBadge: {
    width: 50, height: 50, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },
  dateBadgeDay: { ...type.h1, color: palette.purple.on, fontSize: 20 },
  dateBadgeMonth: { ...type.micro, color: palette.purple.on, fontWeight: '800', marginTop: -2 },

  sessionTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sessionDay: { ...type.bodyBold, color: palette.text },
  sessionPctWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.green.soft,
  },
  sessionPct: { ...type.micro, color: palette.green.on, fontWeight: '800' },
  sessionCount: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  sessionStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  sessionStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },
  sessionStatText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  editBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },

  bar: { flexDirection: 'row', height: 4, width: '100%' },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
