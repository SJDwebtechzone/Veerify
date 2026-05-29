// src/screens/staff/StaffAttendanceScreen.js
//
// Step 2 of the Staff module — fast attendance marking.
//
// Layout (top to bottom):
//   1. Header — back button, "Mark Attendance" title, View History link.
//   2. Batch chip selector — horizontal scroll of my batches; tap to switch.
//   3. Date strip — last 7 days, today selected by default; tap to switch.
//   4. Live counter strip — Present / Absent / Late / Leave counts update as
//      the trainer taps.
//   5. Quick-action row — "All Present" button + search input.
//   6. Student list — modern card rows with avatar (initial), name, age,
//      a row of 4 status pills (P/A/L/Lv). Tapping a pill sets it instantly.
//   7. Sticky bottom save bar with current count and Save button.
//
// Data flow:
//   GET /api/batches/trainer/my    → list batches for the selector
//   GET /api/enrollments/batch/:id → students in the selected batch
//   POST /api/attendance/bulk      → save the records
//
// Status codes match the (newly widened) attendance.status CHECK constraint:
// 'present' | 'absent' | 'late' | 'leave'.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, StyleSheet, FlatList,
} from 'react-native';
import {
  ArrowLeft, Search, Check, X as XIcon, Clock, Plane, History,
  CalendarDays, Users, ChevronDown,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

// ── Status config ─────────────────────────────────────────────────────────
// Single source of truth — order here drives both the live-counter strip and
// the per-row pill row.
const STATUSES = [
  { key: 'present', label: 'Present', short: 'P', icon: Check,    accent: palette.green  },
  { key: 'absent',  label: 'Absent',  short: 'A', icon: XIcon,    accent: palette.rose   },
  { key: 'late',    label: 'Late',    short: 'L', icon: Clock,    accent: palette.orange },
  { key: 'leave',   label: 'Leave',   short: 'Lv', icon: Plane,   accent: palette.blue   },
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build [today-6, today-5, ..., today] dates for the date strip.
function lastSevenDays() {
  const out = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d);
  }
  return out;
}
function isoDate(d) {
  return d.toISOString().split('T')[0];
}
function sameDate(a, b) {
  return isoDate(a) === isoDate(b);
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function StaffAttendanceScreen({ navigation, route }) {
  // Optional preselect via route param when arriving from the dashboard
  // or from Attendance History (which passes batchId + date for edit-flow).
  const preselectBatchId = route?.params?.batchId ?? null;
  const preselectDate    = route?.params?.date ? new Date(route.params.date) : new Date();

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(preselectBatchId);
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({}); // { studentId: 'present'|... }
  const [date, setDate] = useState(preselectDate);

  // Inside a bottom-tab navigator the screen can stay mounted while the user
  // switches between tabs. When the dashboard fires
  // navigation.navigate('StaffAttendance', { batchId, date }), the new params
  // arrive but useState's initial value was captured on the first mount —
  // so we explicitly react to route.params changes here.
  useEffect(() => {
    if (route?.params?.batchId != null && Number(route.params.batchId) !== Number(selectedBatchId)) {
      setSelectedBatchId(route.params.batchId);
    }
    if (route?.params?.date) {
      const d = new Date(route.params.date);
      if (!isNaN(d) && isoDate(d) !== isoDate(date)) setDate(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.batchId, route?.params?.date]);
  const [search, setSearch] = useState('');
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);

  const dates = useMemo(lastSevenDays, []);

  // ── Fetch my batches once ──
  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const res = await apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } }));
      const list = res.data?.batches || [];
      setBatches(list);
      // Auto-select the first batch if nothing preselected.
      if (!selectedBatchId && list.length > 0) {
        setSelectedBatchId(list[0].id);
      }
    } finally {
      setLoadingBatches(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  // ── Fetch students + any existing attendance for the selected date ──
  // The existing-attendance fetch lets the History "Edit" flow open this
  // screen pre-populated so the trainer sees what was previously marked.
  const loadStudents = useCallback(async (batchId, forDate) => {
    if (!batchId) {
      setStudents([]);
      setAttendance({});
      return;
    }
    setLoadingStudents(true);
    try {
      const [enrollRes, existingRes] = await Promise.all([
        apiClient.get(`/enrollments/batch/${batchId}`).catch(() => ({ data: { enrollments: [] } })),
        apiClient.get(`/attendance/batch/${batchId}?date=${isoDate(forDate)}`).catch(() => ({ data: { attendance: [] } })),
      ]);
      const list = enrollRes.data?.enrollments || [];
      const existing = existingRes.data?.attendance || [];
      setStudents(list);

      // Default everyone to "present", then overlay any existing statuses
      // recorded for this date — that way the trainer is editing live data
      // rather than starting from scratch on a previously-marked day.
      const next = {};
      list.forEach((s) => { next[s.student_id] = 'present'; });
      existing.forEach((rec) => { next[rec.student_id] = rec.status; });
      setAttendance(next);
    } finally {
      setLoadingStudents(false);
    }
  }, []);
  useEffect(() => { loadStudents(selectedBatchId, date); }, [selectedBatchId, date, loadStudents]);

  const setStatus = (studentId, status) => {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  };
  const markAllPresent = () => {
    const next = {};
    students.forEach((s) => { next[s.student_id] = 'present'; });
    setAttendance(next);
  };

  // ── Live counters ──
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    Object.values(attendance).forEach((s) => { if (c[s] !== undefined) c[s]++; });
    return c;
  }, [attendance]);

  // ── Filtered student list ──
  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      (s.student_name || '').toLowerCase().includes(q) ||
      (s.student_email || '').toLowerCase().includes(q),
    );
  }, [students, search]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  const submit = async () => {
    if (!selectedBatchId) {
      Alert.alert('Pick a batch first.');
      return;
    }
    setSaving(true);
    try {
      const records = Object.entries(attendance).map(([studentId, status]) => ({
        student_id: parseInt(studentId, 10),
        status,
      }));
      await apiClient.post('/attendance/bulk', {
        batch_id: selectedBatchId,
        date: isoDate(date),
        records,
      });
      Alert.alert(
        'Attendance saved',
        `${records.length} students marked for ${fmtDate(date)}.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Could not save', err.response?.data?.message || err.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Mark Attendance</Text>
          {selectedBatch ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {selectedBatch.name}
              {selectedBatch.course_name ? ` · ${selectedBatch.course_name}` : ''}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('StaffAttendanceHistory', { batchId: selectedBatchId })}
          style={styles.historyBtn}
        >
          <History size={16} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Batch chips */}
        <View style={styles.sectionLabel}>
          <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>BATCH</Text>
        </View>
        {loadingBatches ? (
          <ActivityIndicator color={palette.purple.vivid} style={{ marginVertical: spacing.md }} />
        ) : batches.length === 0 ? (
          <Text style={styles.emptyLine}>No batches assigned to you yet.</Text>
        ) : (
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
                  <Text style={[styles.batchChipMeta, active && styles.batchChipMetaActive]}>
                    {b.enrolled_count || 0} students
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Date strip */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <CalendarDays size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>DATE</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
        >
          {dates.map((d) => {
            const active = sameDate(d, date);
            return (
              <TouchableOpacity
                key={isoDate(d)}
                style={[styles.dateCard, active && styles.dateCardActive]}
                onPress={() => setDate(new Date(d))}
                activeOpacity={0.85}
              >
                <Text style={[styles.dateDay, active && styles.dateDayActive]}>{DAYS_SHORT[d.getDay()]}</Text>
                <Text style={[styles.dateNum, active && styles.dateNumActive]}>{d.getDate()}</Text>
                {sameDate(d, new Date()) ? (
                  <View style={[styles.todayDot, active && { backgroundColor: '#fff' }]} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Live counters */}
        {students.length > 0 && (
          <View style={styles.counterStrip}>
            {STATUSES.map((s) => (
              <View key={s.key} style={[styles.counterTile, { backgroundColor: s.accent.soft }]}>
                <Text style={[styles.counterValue, { color: s.accent.on }]}>{counts[s.key] || 0}</Text>
                <Text style={[styles.counterLabel, { color: s.accent.on }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Search + Quick action */}
        {students.length > 0 && (
          <View style={styles.toolsRow}>
            <View style={styles.searchWrap}>
              <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search student"
                placeholderTextColor={palette.textLight}
                style={styles.searchInput}
              />
            </View>
            <TouchableOpacity style={styles.allPresentBtn} onPress={markAllPresent} activeOpacity={0.85}>
              <Check size={14} color={palette.green.on} strokeWidth={2.6} />
              <Text style={styles.allPresentText}>All Present</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Student list */}
        {loadingStudents ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {selectedBatchId ? 'No students in this batch' : 'Pick a batch above'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedBatchId
                ? 'Once students are enrolled, they\'ll show up here.'
                : 'Choose one of your batches to mark attendance.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm, marginTop: spacing.md }}>
            {visibleStudents.map((s) => (
              <StudentRow
                key={s.student_id}
                student={s}
                status={attendance[s.student_id] || 'present'}
                onSet={(status) => setStatus(s.student_id, status)}
              />
            ))}
            {visibleStudents.length === 0 ? (
              <Text style={styles.emptyLine}>No students match "{search}".</Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Sticky save bar */}
      {students.length > 0 && (
        <View style={styles.saveBar}>
          <View>
            <Text style={styles.saveBarLabel}>{fmtDate(date)}</Text>
            <Text style={styles.saveBarCount}>{Object.keys(attendance).length} students marked</Text>
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={submit}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Save attendance</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Student row ──────────────────────────────────────────────────────────
function StudentRow({ student, status, onSet }) {
  const initials = (student.student_name || 'S')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const current = STATUSES.find((s) => s.key === status) || STATUSES[0];

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.avatar, { backgroundColor: current.accent.soft }]}>
          <Text style={[styles.avatarText, { color: current.accent.on }]}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>{student.student_name}</Text>
          <Text style={styles.studentMeta} numberOfLines={1}>
            {student.student_email || `#${student.student_id}`}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: current.accent.vivid }]}>
          <Text style={styles.statusBadgeText}>{current.short}</Text>
        </View>
      </View>

      {/* Status pills */}
      <View style={styles.pillRow}>
        {STATUSES.map((s) => {
          const active = s.key === status;
          const Icon = s.icon;
          return (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.pill,
                active && { backgroundColor: s.accent.vivid, borderColor: s.accent.vivid },
              ]}
              onPress={() => onSet(s.key)}
              activeOpacity={0.85}
            >
              <Icon size={13} color={active ? '#fff' : s.accent.vivid} strokeWidth={2.4} />
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
  },
  historyBtnText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },
  emptyLine: { ...type.caption, color: palette.textMuted, paddingHorizontal: spacing.xl, marginVertical: spacing.sm },

  // Batch chip
  batchChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
    minWidth: 140,
  },
  batchChipActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  batchChipText: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  batchChipTextActive: { color: '#fff' },
  batchChipMeta: { ...type.micro, color: palette.textMuted, marginTop: 2 },
  batchChipMetaActive: { color: 'rgba(255,255,255,0.85)' },

  // Date card
  dateCard: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    alignItems: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  dateCardActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  dateDay: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  dateDayActive: { color: 'rgba(255,255,255,0.9)' },
  dateNum: { ...type.h1, color: palette.text, fontSize: 20, marginTop: 2 },
  dateNumActive: { color: '#fff' },
  todayDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: palette.purple.vivid,
    marginTop: 2,
  },

  // Counter strip
  counterStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  counterTile: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  counterValue: { ...type.h1, fontSize: 18 },
  counterLabel: { ...type.micro, fontWeight: '700', marginTop: 1 },

  // Tools
  toolsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  searchInput: { flex: 1, ...type.body, paddingVertical: 10, color: palette.text },
  allPresentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.green.soft,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.green.vivid,
  },
  allPresentText: { ...type.caption, color: palette.green.on, fontWeight: '700' },

  // Student row
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
  avatarText: { ...type.bodyBold, fontWeight: '800' },
  studentName: { ...type.bodyBold, color: palette.text },
  studentMeta: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  statusBadge: {
    minWidth: 30, height: 24,
    paddingHorizontal: 8, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  statusBadgeText: { ...type.micro, color: '#fff', fontWeight: '800' },

  pillRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
  },
  pill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  pillText: { ...type.micro, color: palette.text, fontWeight: '700' },
  pillTextActive: { color: '#fff' },

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

  // Save bar
  saveBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
    ...shadows.raised,
  },
  saveBarLabel: { ...type.bodyBold, color: palette.text },
  saveBarCount: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  saveBtn: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  saveBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '700' },
});
