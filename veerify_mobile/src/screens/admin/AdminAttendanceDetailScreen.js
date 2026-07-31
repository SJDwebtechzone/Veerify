// src/screens/admin/AdminAttendanceDetailScreen.js
//
// Institution admin's read-only per-student attendance detail for a
// single batch on a specific date. Reached from
// AdminAttendanceOverviewScreen → batch row.
//
// Shows one row per student in the batch with:
//   • Name + avatar initial
//   • Attendance status pill (Present / Absent / Late / Leave, or
//     Not Marked when no row exists for the date)
//   • Check-in time (when the attendance schema carries one; the
//     current schema stores only date, so the column renders "—")
//   • Remarks (when captured on the attendance row)
//
// Header carries a summary strip so the admin sees present/absent
// counts without scrolling.
//
// Data:
//   GET /api/enrollments/batch/:id       — full roster
//   GET /api/attendance/batch/:id?date=  — that day's marks
// Both endpoints already exist and are trainer/admin-scoped.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
  StyleSheet, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Search, Check, X as XIcon, Clock, Plane, MessageSquare,
  User, GraduationCap, CalendarDays,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Same status catalogue the trainer marking screen uses so the pill
// colours stay consistent across every attendance surface.
const STATUS_META = {
  present: { label: 'Present', short: 'P',  icon: Check,  accent: palette.green  },
  absent:  { label: 'Absent',  short: 'A',  icon: XIcon,  accent: palette.rose   },
  late:    { label: 'Late',    short: 'L',  icon: Clock,  accent: palette.orange },
  leave:   { label: 'Leave',   short: 'Lv', icon: Plane,  accent: palette.blue   },
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}


export default function AdminAttendanceDetailScreen({ route, navigation }) {
  const {
    batchId, batchName, courseName, trainerName, date,
  } = route?.params || {};

  const [students, setStudents] = useState([]);
  const [marks, setMarks]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState('');
  const [query, setQuery]       = useState('');

  const load = useCallback(async () => {
    if (!batchId) { setLoading(false); return; }
    try {
      setError('');
      const [rosterRes, markRes] = await Promise.all([
        apiClient.get(`/enrollments/batch/${batchId}`).catch(() => ({ data: { enrollments: [] } })),
        apiClient.get(`/attendance/batch/${batchId}?date=${encodeURIComponent(date)}`).catch(() => ({ data: { attendance: [] } })),
      ]);
      setStudents(rosterRes.data?.enrollments || []);
      setMarks(markRes.data?.attendance || []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not load attendance.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [batchId, date]);
  useEffect(() => { load(); }, [load]);

  // Fast lookup: student_id → attendance record for the date.
  const marksById = useMemo(() => {
    const m = new Map();
    marks.forEach((r) => m.set(Number(r.student_id), r));
    return m;
  }, [marks]);

  // Join roster + marks. Students without a mark for the date land
  // in the "Not marked" bucket so the admin can see who's still
  // outstanding.
  const rows = useMemo(() => {
    return students.map((s) => {
      const mk = marksById.get(Number(s.student_id));
      return {
        student_id:   s.student_id,
        name:         s.student_name || s.name || `#${s.student_id}`,
        email:        s.student_email || s.email || '',
        status:       mk?.status || null,
        remarks:      mk?.remarks || mk?.notes || '',
        updated_at:   mk?.updated_at || null,
      };
    });
  }, [students, marksById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Aggregate for the header strip.
  const summary = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 };
    for (const r of rows) {
      if (r.status && c[r.status] !== undefined) c[r.status]++;
      else if (!r.status) c.unmarked++;
    }
    const marked = c.present + c.absent + c.late + c.leave;
    const pct = marked > 0 ? Math.round((c.present / marked) * 100) : 0;
    return { ...c, marked, total: rows.length, pct };
  }, [rows]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{batchName || 'Batch'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {courseName ? `${courseName} · ` : ''}{fmtDate(date)}
          </Text>
        </View>
        <View style={styles.pctBadge}>
          <Text style={styles.pctBadgeText}>
            {summary.marked > 0 ? `${summary.pct}%` : '—'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Context strip — trainer + date */}
        <View style={styles.contextCard}>
          <View style={styles.contextRow}>
            <User size={13} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.contextText}>
              Trainer: <Text style={styles.contextValue}>{trainerName || 'Not assigned'}</Text>
            </Text>
          </View>
          <View style={styles.contextRow}>
            <CalendarDays size={13} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.contextText}>
              Date: <Text style={styles.contextValue}>{fmtDate(date)}</Text>
            </Text>
          </View>
        </View>

        {/* Summary tiles */}
        <View style={styles.summaryStrip}>
          {[
            { key: 'present', label: 'Present', v: summary.present },
            { key: 'absent',  label: 'Absent',  v: summary.absent  },
            { key: 'late',    label: 'Late',    v: summary.late    },
            { key: 'leave',   label: 'Leave',   v: summary.leave   },
          ].map((s) => {
            const meta = STATUS_META[s.key];
            return (
              <View key={s.key} style={[styles.summaryTile, { backgroundColor: meta.accent.soft }]}>
                <Text style={[styles.summaryVal, { color: meta.accent.on }]}>{s.v}</Text>
                <Text style={[styles.summaryLbl, { color: meta.accent.on }]}>{s.label}</Text>
              </View>
            );
          })}
        </View>

        {summary.unmarked > 0 ? (
          <View style={styles.unmarkedBanner}>
            <Text style={styles.unmarkedText}>
              {summary.unmarked} student{summary.unmarked === 1 ? '' : 's'} not marked for this date yet.
            </Text>
          </View>
        ) : null}

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search student"
            placeholderTextColor={palette.textLight}
            style={styles.searchInput}
          />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.errorLine}>{error}</Text>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <GraduationCap size={30} color={palette.textLight} strokeWidth={1.8} />
            <Text style={styles.emptyTitle}>No students</Text>
            <Text style={styles.emptySub}>
              {rows.length === 0
                ? 'This batch has no enrolled students yet.'
                : 'No matches for your search.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.md }}>
            {filtered.map((r) => (
              <StudentRow key={r.student_id} row={r} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StudentRow({ row }) {
  const meta   = row.status ? STATUS_META[row.status] : null;
  const initial = (row.name || 'S')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const StatusIcon = meta?.icon;

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[
          styles.avatar,
          { backgroundColor: meta ? meta.accent.soft : palette.borderSoft },
        ]}>
          <Text style={[
            styles.avatarText,
            { color: meta ? meta.accent.on : palette.textMuted },
          ]}>{initial}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.studentName} numberOfLines={1}>{row.name}</Text>
          {row.email ? (
            <Text style={styles.studentMeta} numberOfLines={1}>{row.email}</Text>
          ) : null}
        </View>
        {meta ? (
          <View style={[styles.statusPill, { backgroundColor: meta.accent.vivid }]}>
            <StatusIcon size={11} color="#fff" strokeWidth={2.6} />
            <Text style={styles.statusPillText}>{meta.label}</Text>
          </View>
        ) : (
          <View style={styles.notMarkedPill}>
            <Text style={styles.notMarkedText}>Not marked</Text>
          </View>
        )}
      </View>

      {/* Remarks — surfaced when the row carries them. */}
      {row.remarks ? (
        <View style={styles.rowFoot}>
          <View style={[styles.footChip, { flex: 1 }]}>
            <MessageSquare size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={[styles.footChipText, { flex: 1 }]} numberOfLines={2}>
              {row.remarks}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 17 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  pctBadge: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: palette.teal.soft,
  },
  pctBadgeText: { ...type.micro, color: palette.teal.on, fontWeight: '800' },

  contextCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contextText: { ...type.caption, color: palette.textMuted },
  contextValue: { ...type.bodyBold, color: palette.text },

  summaryStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  summaryTile: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  summaryVal: { fontSize: 18, fontWeight: '900' },
  summaryLbl: { fontSize: 10, fontWeight: '800', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  unmarkedBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  unmarkedText: { fontSize: 12, color: '#78350F', fontWeight: '700', textAlign: 'center' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 46,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  errorLine: {
    ...type.caption, color: palette.rose.on,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },

  row: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800' },
  studentName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  studentMeta: { ...type.micro, color: palette.textMuted, marginTop: 2 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
  },
  statusPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  notMarkedPill: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.borderSoft,
  },
  notMarkedText: { ...type.micro, color: palette.textMuted, fontWeight: '800' },

  rowFoot: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  footChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
  },
  footChipText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  emptyCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
