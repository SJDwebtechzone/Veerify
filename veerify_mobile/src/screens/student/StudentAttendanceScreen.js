// src/screens/student/StudentAttendanceScreen.js
//
// Student → More → Attendance. Renders:
//   1. Hero card with the % pill + total / attended / missed roll-up
//   2. Legend chips (Present / Absent / Late / Leave counts)
//   3. Timeline list of every attendance record (newest first)
//
// Data: GET /api/attendance/my
//   → { summary: { total, present, absent, late, percentage },
//       attendance: [{ id, date, status, batch_name, course_name }, ...] }

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, ClipboardCheck, CheckCircle2, XCircle,
  Clock, Plane, TrendingUp, TrendingDown, Minus,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

const STATUS_META = {
  present: { label: 'Present', accent: palette.green,  icon: CheckCircle2 },
  absent:  { label: 'Absent',  accent: palette.rose,   icon: XCircle },
  late:    { label: 'Late',    accent: palette.orange, icon: Clock },
  leave:   { label: 'Leave',   accent: palette.blue,   icon: Plane },
};

function perfMeta(pct) {
  if (pct >= 85) return { label: 'Excellent', accent: palette.green,  icon: TrendingUp };
  if (pct >= 65) return { label: 'Steady',    accent: palette.orange, icon: Minus };
  return           { label: 'At risk',   accent: palette.rose,   icon: TrendingDown };
}

export default function StudentAttendanceScreen({ navigation }) {
  const [summary, setSummary]   = useState({ total: 0, present: 0, absent: 0, late: 0, percentage: 0 });
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/attendance/my');
      const s = r.data?.summary || {};
      const a = r.data?.attendance || [];
      // Leave isn't in the base summary; compute it client-side so the
      // roll-up legend is complete.
      const leave = a.filter((x) => x.status === 'leave').length;
      setSummary({
        total:      Number(s.total)      || a.length,
        present:    Number(s.present)    || 0,
        absent:     Number(s.absent)     || 0,
        late:       Number(s.late)       || 0,
        leave,
        percentage: Number(s.percentage) || 0,
      });
      setRecords(a);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[StudentAttendance] load error:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const missed = summary.absent + summary.leave;
  const perf = perfMeta(summary.percentage);
  const PerfIcon = perf.icon;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.subtitle}>{records.length} record{records.length === 1 ? '' : 's'}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {/* Hero summary */}
          <View style={styles.hero}>
            <View style={styles.heroPctBlock}>
              <Text style={styles.heroPctValue}>{summary.percentage}%</Text>
              <Text style={styles.heroPctLabel}>Attendance</Text>
              <View style={[styles.perfBadge, { backgroundColor: perf.accent.soft }]}>
                <PerfIcon size={11} color={perf.accent.on} strokeWidth={2.6} />
                <Text style={[styles.perfBadgeText, { color: perf.accent.on }]}>{perf.label}</Text>
              </View>
            </View>
            <View style={styles.heroDivider} />
            <View style={{ flex: 1 }}>
              <SummaryStat label="Total classes"  value={summary.total} />
              <SummaryStat label="Attended"       value={summary.present + summary.late} highlight={palette.green} />
              <SummaryStat label="Missed"         value={missed} highlight={palette.rose} />
            </View>
          </View>

          {/* Legend counts */}
          <View style={styles.legendRow}>
            {['present', 'late', 'leave', 'absent'].map((k) => {
              const meta = STATUS_META[k];
              return (
                <View key={k} style={[styles.legendChip, { backgroundColor: meta.accent.soft }]}>
                  <View style={[styles.legendDot, { backgroundColor: meta.accent.vivid }]} />
                  <Text style={[styles.legendText, { color: meta.accent.on }]}>
                    {summary[k] || 0} {meta.label}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Recent history */}
          <Text style={styles.sectionTitle}>RECENT ATTENDANCE</Text>
          {records.length === 0 ? (
            <View style={styles.emptyCard}>
              <ClipboardCheck size={32} color={palette.textLight} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>No attendance yet</Text>
              <Text style={styles.emptySub}>
                Your trainer will start marking attendance from your very first class.
              </Text>
            </View>
          ) : (
            records.map((r) => (
              <AttendanceRow key={r.id} row={r} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SummaryStat({ label, value, highlight }) {
  return (
    <View style={styles.summaryStatRow}>
      <Text style={styles.summaryStatLabel}>{label}</Text>
      <Text style={[styles.summaryStatValue, highlight && { color: highlight.on }]}>{value}</Text>
    </View>
  );
}

function AttendanceRow({ row }) {
  const meta = STATUS_META[row.status] || STATUS_META.absent;
  const Icon = meta.icon;
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: meta.accent.soft }]}>
        <Icon size={16} color={meta.accent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowDate}>{fmtDate(row.date)}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {row.course_name}{row.batch_name ? ` · ${row.batch_name}` : ''}
        </Text>
      </View>
      <View style={[styles.rowPill, { backgroundColor: meta.accent.soft }]}>
        <Text style={[styles.rowPillText, { color: meta.accent.on }]}>{meta.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card, gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title: { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  heroPctBlock: { alignItems: 'center', gap: 4 },
  heroPctValue: { fontSize: 34, fontWeight: '900', color: palette.text, letterSpacing: -1 },
  heroPctLabel: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.6 },
  perfBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 6,
  },
  perfBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  heroDivider: { width: 1, backgroundColor: palette.borderSoft, alignSelf: 'stretch' },

  summaryStatRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 4,
  },
  summaryStatLabel: { ...type.caption, color: palette.textMuted, fontWeight: '700' },
  summaryStatValue: { ...type.bodyBold, color: palette.text, fontSize: 15 },

  legendRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    marginTop: spacing.md,
  },
  legendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
  },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 11, fontWeight: '800' },

  sectionTitle: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: 8,
  },

  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: 8,
    ...shadows.card,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  rowDate: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  rowMeta: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 2 },
  rowPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  rowPillText: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase',
  },
});
