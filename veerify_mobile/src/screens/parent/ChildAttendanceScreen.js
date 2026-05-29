// src/screens/parent/ChildAttendanceScreen.js
//
// Parent Step 3 - Attendance Module.
//
// Layout (top to bottom):
//   1. Header with back, child name, "Attendance" title.
//   2. Month picker chip strip (current month + 5 prior).
//   3. Summary card - big % for selected month, P/A/Lt/Lv counts.
//   4. Mini calendar grid - 7 columns x 5-6 rows, each day cell colored
//      by attendance status when a record exists.
//   5. Status filter chips - All / Present / Absent / Late / Leave.
//   6. List of records for the selected month + status filter:
//        - Date badge
//        - Status pill
//        - Batch name
//        - Trainer remarks (placeholder until attendance.remark column)
//
// Data:
//   GET /api/parents/children/:id/attendance  - records for this child.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Check, X as XIcon, Clock, Plane, Calendar,
  ChevronLeft, ChevronRight, ClipboardCheck, MessageSquare,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  present: { label: 'Present', short: 'P',  icon: Check, accent: palette.green  },
  absent:  { label: 'Absent',  short: 'A',  icon: XIcon, accent: palette.rose   },
  late:    { label: 'Late',    short: 'L',  icon: Clock, accent: palette.orange },
  leave:   { label: 'Leave',   short: 'Lv', icon: Plane, accent: palette.blue   },
};
const STATUS_KEYS = ['present', 'absent', 'late', 'leave'];

const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_SHORT = ['S','M','T','W','T','F','S'];

function isoDay(s) { if (!s) return ''; return String(s).slice(0, 10); }
function ymKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}
function startOfMonth(year, monthIndex) { return new Date(year, monthIndex, 1); }
function endOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0); }

// Build the last `n` months as [{year, monthIndex, label}] newest-first.
function lastNMonths(n) {
  const now = new Date();
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({
      year: d.getFullYear(),
      monthIndex: d.getMonth(),
      label: `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return arr;
}

export default function ChildAttendanceScreen({ navigation, route }) {
  const { activeChild } = useChild();
  // childId can come from route.params (deep-link) or from ChildContext.
  const childId = route?.params?.childId ?? activeChild?.child_id ?? null;
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Month + status filters
  const months = useMemo(() => lastNMonths(6), []);
  const [selectedMonth, setSelectedMonth] = useState({
    year: new Date().getFullYear(),
    monthIndex: new Date().getMonth(),
  });
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    if (!childId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await apiClient.get(`/parents/children/${childId}/attendance`).catch(() => ({ data: { attendance: [] } }));
      setRecords(res.data?.attendance || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Index records by ISO date for the calendar grid ──
  const recordsByDate = useMemo(() => {
    const m = new Map();
    records.forEach((r) => {
      const iso = isoDay(r.date);
      if (iso) m.set(iso, r);
    });
    return m;
  }, [records]);

  // ── Records in the selected month ──
  const monthKey = ymKey(selectedMonth.year, selectedMonth.monthIndex);
  const monthRecords = useMemo(() => {
    return records.filter((r) => isoDay(r.date).startsWith(monthKey));
  }, [records, monthKey]);

  // ── Summary for the selected month ──
  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, leave: 0 };
    monthRecords.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total = monthRecords.length;
    const pct = total > 0 ? Math.round((counts.present / total) * 100) : null;
    return { total, pct, ...counts };
  }, [monthRecords]);

  // ── Visible records (apply status filter) ──
  const visible = useMemo(() => {
    let arr = [...monthRecords];
    if (statusFilter !== 'all') arr = arr.filter((r) => r.status === statusFilter);
    arr.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return arr;
  }, [monthRecords, statusFilter]);

  // ── Calendar grid cells ──
  // Build a 6-row x 7-col grid covering the selected month with leading/trailing
  // empty cells. Each cell knows its date (Date) and (optionally) a record.
  const calendarCells = useMemo(() => {
    const first = startOfMonth(selectedMonth.year, selectedMonth.monthIndex);
    const last = endOfMonth(selectedMonth.year, selectedMonth.monthIndex);
    const firstDow = first.getDay();             // 0 (Sun) - 6 (Sat)
    const daysInMonth = last.getDate();
    const cells = [];
    // Leading blanks
    for (let i = 0; i < firstDow; i++) cells.push(null);
    // Real days
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = ymKey(selectedMonth.year, selectedMonth.monthIndex) + '-' + String(d).padStart(2, '0');
      cells.push({ day: d, iso, record: recordsByDate.get(iso) || null });
    }
    // Trailing blanks to fill the last week
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [selectedMonth, recordsByDate]);

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        {navigation.canGoBack?.() ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{childName}</Text>
        </View>
        <View style={styles.headerPill}>
          <ClipboardCheck size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{records.length}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
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
        {/* Month chip strip */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>MONTH</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
        >
          {months.map((m) => {
            const active = m.year === selectedMonth.year && m.monthIndex === selectedMonth.monthIndex;
            return (
              <TouchableOpacity
                key={`${m.year}-${m.monthIndex}`}
                style={[styles.monthChip, active && styles.monthChipActive]}
                onPress={() => setSelectedMonth({ year: m.year, monthIndex: m.monthIndex })}
                activeOpacity={0.85}
              >
                <Text style={[styles.monthChipText, active && styles.monthChipTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHero}>
            <View>
              <Text style={styles.summaryMonth}>{MONTH_FULL[selectedMonth.monthIndex]} {selectedMonth.year}</Text>
              <Text style={styles.summaryPct}>{summary.pct === null ? '—' : `${summary.pct}%`}</Text>
              <Text style={styles.summaryPctLabel}>Attendance rate</Text>
            </View>
            <View style={styles.summaryTotalCol}>
              <Text style={styles.summaryTotalNumber}>{summary.total}</Text>
              <Text style={styles.summaryTotalLabel}>{summary.total === 1 ? 'session' : 'sessions'}</Text>
            </View>
          </View>
          <View style={styles.summaryStatusRow}>
            {STATUS_KEYS.map((k) => {
              const meta = STATUS_META[k];
              return (
                <View key={k} style={[styles.summaryStatTile, { backgroundColor: meta.accent.soft }]}>
                  <Text style={[styles.summaryStatValue, { color: meta.accent.on }]}>{summary[k] || 0}</Text>
                  <Text style={[styles.summaryStatLabel, { color: meta.accent.on }]}>{meta.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Calendar grid */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>CALENDAR</Text>
        </View>
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity
              style={styles.calNavBtn}
              onPress={() => {
                const d = new Date(selectedMonth.year, selectedMonth.monthIndex - 1, 1);
                setSelectedMonth({ year: d.getFullYear(), monthIndex: d.getMonth() });
              }}
            >
              <ChevronLeft size={16} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
            <Text style={styles.calendarTitle}>
              {MONTH_FULL[selectedMonth.monthIndex]} {selectedMonth.year}
            </Text>
            <TouchableOpacity
              style={styles.calNavBtn}
              onPress={() => {
                const d = new Date(selectedMonth.year, selectedMonth.monthIndex + 1, 1);
                const today = new Date();
                if (d > today) return; // don't jump past today
                setSelectedMonth({ year: d.getFullYear(), monthIndex: d.getMonth() });
              }}
            >
              <ChevronRight size={16} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week labels */}
          <View style={styles.calRow}>
            {DAYS_SHORT.map((d, i) => (
              <View key={i} style={styles.calCell}>
                <Text style={styles.calDow}>{d}</Text>
              </View>
            ))}
          </View>

          {/* Day cells */}
          {Array.from({ length: Math.ceil(calendarCells.length / 7) }, (_, rowIdx) => (
            <View key={rowIdx} style={styles.calRow}>
              {calendarCells.slice(rowIdx * 7, rowIdx * 7 + 7).map((cell, colIdx) => {
                if (!cell) return <View key={colIdx} style={styles.calCell} />;
                const meta = cell.record ? STATUS_META[cell.record.status] : null;
                const isToday = isoDay(new Date().toISOString()) === cell.iso;
                return (
                  <TouchableOpacity
                    key={colIdx}
                    style={[
                      styles.calCell,
                      styles.calDayCell,
                      meta && { backgroundColor: meta.accent.soft, borderColor: meta.accent.vivid },
                      isToday && !meta && styles.calDayToday,
                    ]}
                    onPress={() => cell.record && setStatusFilter(cell.record.status)}
                    activeOpacity={cell.record ? 0.75 : 1}
                  >
                    <Text
                      style={[
                        styles.calDayNum,
                        meta && { color: meta.accent.on, fontWeight: '800' },
                        isToday && !meta && { color: palette.purple.vivid, fontWeight: '800' },
                      ]}
                    >
                      {cell.day}
                    </Text>
                    {meta ? (
                      <View style={[styles.calDot, { backgroundColor: meta.accent.vivid }]} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {/* Legend */}
          <View style={styles.legendRow}>
            {STATUS_KEYS.map((k) => {
              const meta = STATUS_META[k];
              return (
                <View key={k} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: meta.accent.vivid }]} />
                  <Text style={styles.legendText}>{meta.label}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Filter chips */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <ClipboardCheck size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>FILTER</Text>
        </View>
        <View style={styles.filterRow}>
          <FilterChip
            label="All"
            count={summary.total}
            active={statusFilter === 'all'}
            onPress={() => setStatusFilter('all')}
          />
          {STATUS_KEYS.map((k) => {
            const meta = STATUS_META[k];
            return (
              <FilterChip
                key={k}
                label={meta.label}
                count={summary[k] || 0}
                accent={meta.accent}
                active={statusFilter === k}
                onPress={() => setStatusFilter(k)}
              />
            );
          })}
        </View>

        {/* Records list */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>RECORDS</Text>
        </View>
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Calendar size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {monthRecords.length === 0 ? 'No records this month' : 'No matches'}
            </Text>
            <Text style={styles.emptySub}>
              {monthRecords.length === 0
                ? 'Attendance entries appear here once the trainer marks them.'
                : 'Try a different status filter.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
            {visible.map((r) => (
              <RecordRow key={r.id || `${r.batch_id}-${r.date}`} record={r} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────
function FilterChip({ label, count, active, accent, onPress }) {
  const fg = active ? '#fff' : (accent ? accent.vivid : palette.text);
  const bg = active ? (accent ? accent.vivid : palette.text) : palette.surface;
  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        { backgroundColor: bg, borderColor: active ? bg : palette.borderSoft },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.filterChipLabel, { color: fg }]}>{label}</Text>
      <Text style={[
        styles.filterChipCount,
        active
          ? { backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff' }
          : { backgroundColor: palette.borderSoft, color: palette.textMuted },
      ]}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

function RecordRow({ record }) {
  const d = new Date(record.date);
  const day = isNaN(d) ? '?' : d.getDate();
  const month = isNaN(d) ? '?' : MONTH_SHORT[d.getMonth()];
  const dayName = isNaN(d) ? '' : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];

  const meta = STATUS_META[record.status] || STATUS_META.present;
  const StatusIcon = meta.icon;

  return (
    <View style={styles.recordCard}>
      <View style={[styles.recordDate, { backgroundColor: meta.accent.soft }]}>
        <Text style={[styles.recordDateDay, { color: meta.accent.on }]}>{day}</Text>
        <Text style={[styles.recordDateMonth, { color: meta.accent.on }]}>{month}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.recordTopRow}>
          <Text style={styles.recordDayName}>{dayName}</Text>
          <View style={[styles.statusBadge, { backgroundColor: meta.accent.soft }]}>
            <StatusIcon size={11} color={meta.accent.on} strokeWidth={2.4} />
            <Text style={[styles.statusBadgeText, { color: meta.accent.on }]}>{meta.label}</Text>
          </View>
        </View>
        {record.batch_name ? (
          <Text style={styles.recordBatch} numberOfLines={1}>{record.batch_name}</Text>
        ) : null}
        {/* Trainer remarks — placeholder until attendance.remark column lands. */}
        <View style={styles.remarkRow}>
          <MessageSquare size={11} color={palette.textLight} strokeWidth={2.2} />
          <Text style={styles.remarkText} numberOfLines={2}>
            {record.remark || 'No trainer remarks for this session.'}
          </Text>
        </View>
      </View>
    </View>
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
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  headerPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },

  // Month chip
  monthChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  monthChipActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  monthChipText: { ...type.caption, color: palette.text, fontWeight: '700' },
  monthChipTextActive: { color: '#fff' },

  // Summary card
  summaryCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  summaryHero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryMonth: { ...type.caption, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  summaryPct: { ...type.display, color: palette.purple.vivid, fontSize: 36, marginTop: 2 },
  summaryPctLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  summaryTotalCol: { alignItems: 'flex-end' },
  summaryTotalNumber: { ...type.h1, color: palette.text, fontSize: 28 },
  summaryTotalLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  summaryStatusRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginTop: spacing.md,
  },
  summaryStatTile: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  summaryStatValue: { ...type.h2, fontSize: 18 },
  summaryStatLabel: { ...type.micro, fontWeight: '700', marginTop: 1 },

  // Calendar
  calendarCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  calendarHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  calendarTitle: { ...type.bodyBold, color: palette.text },
  calNavBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  calRow: { flexDirection: 'row' },
  calCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
  },
  calDow: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  calDayCell: {
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: 'transparent',
  },
  calDayToday: {
    borderColor: palette.purple.vivid,
    borderWidth: 1.5,
  },
  calDayNum: { ...type.caption, color: palette.text, fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },

  // Legend
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterChipLabel: { ...type.caption, fontWeight: '700' },
  filterChipCount: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    minWidth: 22, textAlign: 'center',
  },

  // Record row
  recordCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  recordDate: {
    width: 50, height: 50, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  recordDateDay: { ...type.h1, fontSize: 20 },
  recordDateMonth: { ...type.micro, fontWeight: '800', marginTop: -2 },
  recordTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordDayName: { ...type.bodyBold, color: palette.text },
  recordBatch: { ...type.caption, color: palette.purple.vivid, fontWeight: '700', marginTop: 1 },
  remarkRow: { flexDirection: 'row', gap: 4, alignItems: 'flex-start', marginTop: spacing.sm },
  remarkText: { flex: 1, ...type.micro, color: palette.textMuted, lineHeight: 14 },

  // Status badge
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusBadgeText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

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
