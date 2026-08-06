// src/screens/trainer/BatchStudentsScreen.js
//
// Bulk attendance-marking sheet used by BOTH trainers (their own
// assigned batches) and branch / main admins (batches under their
// branch scope — the backend enforces the boundary).
//
// Layout:
//   1. Sticky top bar — back arrow + batch name + right-side "History"
//      pill that jumps to the audit trail screen.
//   2. Compact batch summary — date + student count.
//   3. Optional "already saved for today" hint when we prefilled from
//      an existing attendance snapshot.
//   4. Scrollable student list. Each card has:
//        • Round initials avatar + name + email
//        • Segmented Present / Absent / Late toggle
//        • Audit strip (Original marker + Last updater) when the row
//          was already marked
//   5. Sticky bottom Save Attendance CTA with a live "N marked" hint.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  StatusBar, StyleSheet, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, ClipboardList, CheckCircle2, XCircle, Clock,
  Calendar, Users, History, Save, ShieldCheck, RefreshCw,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

// ─── Palette ─────────────────────────────────────────────────────────
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';
const GREEN_SOFT  = '#D1FAE5';
const AMBER       = '#F59E0B';
const AMBER_SOFT  = '#FEF3C7';
const ROSE        = '#F43F5E';
const ROSE_SOFT   = '#FFE4E6';

// ─── Helpers ─────────────────────────────────────────────────────────
const STATUS_META = {
  present: { label: 'Present', color: GREEN, bg: GREEN_SOFT, icon: CheckCircle2 },
  absent:  { label: 'Absent',  color: ROSE,  bg: ROSE_SOFT,  icon: XCircle },
  late:    { label: 'Late',    color: AMBER, bg: AMBER_SOFT, icon: Clock },
};

// 'admin' → 'Branch Admin' etc. so the audit strip reads naturally.
function roleLabel(role) {
  if (!role) return '';
  const r = String(role).toLowerCase();
  if (r === 'admin')   return 'Branch Admin';
  if (r === 'trainer') return 'Trainer';
  if (r === 'student') return 'Student';
  return role;
}

// Pretty long date — "Sat, 6 Jul 2026" — for the summary strip.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fmtTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function initialsFor(name) {
  return (name || '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// ─── Audit strip ─────────────────────────────────────────────────────
// Shown under a student card when the row already has an attendance
// record. Renders "Originally marked by X (Trainer)" plus (when it
// differs from the creator) "Last updated by Y (Branch Admin) · <date>".
function AuditStrip({ record }) {
  if (!record) return null;
  const creator     = record.created_by_name;
  const updater     = record.updated_by_name;
  const creatorRole = roleLabel(record.created_by_role);
  const updaterRole = roleLabel(record.updated_by_role);
  const when        = fmtTimestamp(record.updated_at);
  const editedByAnotherActor =
    record.created_by && record.updated_by && record.created_by !== record.updated_by;

  return (
    <View style={styles.auditWrap}>
      {creator ? (
        <View style={styles.auditRow}>
          <ShieldCheck size={11} color={BRAND} strokeWidth={2.4} />
          <Text style={styles.auditText}>
            Originally marked by <Text style={styles.auditName}>{creator}</Text>
            {creatorRole ? <Text style={styles.auditRole}>{`  ${creatorRole}`}</Text> : null}
          </Text>
        </View>
      ) : null}
      {editedByAnotherActor && updater ? (
        <View style={styles.auditRow}>
          <RefreshCw size={11} color={TEXT_MUTED} strokeWidth={2.4} />
          <Text style={styles.auditText}>
            Last updated by <Text style={styles.auditName}>{updater}</Text>
            {updaterRole ? <Text style={styles.auditRole}>{`  ${updaterRole}`}</Text> : null}
            {when ? <Text style={styles.auditDate}>{`  ·  ${when}`}</Text> : null}
          </Text>
        </View>
      ) : when ? (
        <View style={styles.auditRow}>
          <Clock size={11} color={TEXT_LIGHT} strokeWidth={2.4} />
          <Text style={styles.auditText}>
            <Text style={styles.auditDate}>{`Updated ${when}`}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Status pill (Present / Absent / Late) ───────────────────────────
function StatusPill({ status, active, onPress }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.pill,
        {
          backgroundColor: active ? meta.color : meta.bg + '77',
          borderColor: active ? meta.color : meta.bg,
        },
      ]}
    >
      <Icon size={13} color={active ? '#fff' : meta.color} strokeWidth={2.4} />
      <Text style={[styles.pillText, { color: active ? '#fff' : meta.color }]}>
        {meta.label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Student card ────────────────────────────────────────────────────
function StudentCard({ student, status, existing, onChange }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(student.student_name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.studentName} numberOfLines={1}>
            {student.student_name || 'Unnamed student'}
          </Text>
          {student.student_email ? (
            <Text style={styles.studentEmail} numberOfLines={1}>
              {student.student_email}
            </Text>
          ) : null}
        </View>
        {/* Compact status badge showing the currently selected value
            — so the state is legible before/after the pill row. */}
        <View style={[styles.statusBadge, { backgroundColor: STATUS_META[status].bg }]}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_META[status].color }]} />
          <Text style={[styles.statusBadgeText, { color: STATUS_META[status].color }]}>
            {STATUS_META[status].label}
          </Text>
        </View>
      </View>

      <View style={styles.pillRow}>
        <StatusPill status="present" active={status === 'present'} onPress={() => onChange('present')} />
        <StatusPill status="absent"  active={status === 'absent'}  onPress={() => onChange('absent')} />
        <StatusPill status="late"    active={status === 'late'}    onPress={() => onChange('late')} />
      </View>

      <AuditStrip record={existing} />
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────
export default function BatchStudentsScreen({ route, navigation }) {
  const { batchId, batchName } = route.params;
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});   // { studentId: 'present'|'absent'|'late' }
  const [existingByStudent, setExistingByStudent] = useState({});
  const [date] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [enrollRes, attendRes] = await Promise.all([
        apiClient.get(`/enrollments/batch/${batchId}`),
        apiClient.get(`/attendance/batch/${batchId}?date=${date}`)
          .catch(() => ({ data: { attendance: [] } })),
      ]);
      const enrolled = enrollRes.data.enrollments || [];
      const existing = {};
      (attendRes.data.attendance || []).forEach((row) => {
        existing[row.student_id] = row;
      });
      setExistingByStudent(existing);
      setStudents(enrolled);
      // Prefill from today's existing marks so we don't silently
      // overwrite them; new students default to 'present'.
      const initial = {};
      enrolled.forEach((e) => {
        initial[e.student_id] = existing[e.student_id]?.status || 'present';
      });
      setAttendance(initial);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[BatchStudents] load error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [batchId, date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = (studentId, status) => {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const records = Object.entries(attendance).map(([studentId, status]) => ({
        student_id: parseInt(studentId, 10),
        status,
      }));
      await apiClient.post('/attendance/bulk', {
        batch_id: batchId,
        date,
        records,
      });
      confirm({
        title:       'Attendance saved',
        message:     `${records.length} student${records.length === 1 ? '' : 's'} marked for ${fmtDate(date)}.`,
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      confirm({
        title:       'Could not save',
        message:     err?.response?.data?.message || err?.message || 'Something went wrong. Try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setSaving(false);
    }
  };

  // Small counters shown in the sticky footer — "18 present · 2 absent · 1 late".
  const counters = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    Object.values(attendance).forEach((s) => { if (c[s] !== undefined) c[s]++; });
    return c;
  }, [attendance]);

  // Existing count (for the summary strip) — tells the marker how many
  // rows already have a record for today.
  const existingCount = Object.keys(existingByStudent).length;

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={SURFACE} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {batchName || 'Attendance'}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {fmtDate(date)}  ·  {students.length} student{students.length === 1 ? '' : 's'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('AttendanceHistory', { batchId, batchName })}
          style={styles.historyBtn}
          activeOpacity={0.85}
        >
          <History size={12} color={BRAND} strokeWidth={2.6} />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      {/* Prefill hint — visible only when we loaded from an existing snapshot */}
      {existingCount > 0 ? (
        <View style={styles.prefillHint}>
          <ClipboardList size={12} color={BRAND} strokeWidth={2.4} />
          <Text style={styles.prefillHintText}>
            {existingCount === students.length
              ? 'All students already marked for today — edit and save to update.'
              : `${existingCount} of ${students.length} already marked — the rest default to Present.`}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={students}
        keyExtractor={(item) => String(item.student_id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Users size={22} color={TEXT_LIGHT} strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>No students enrolled</Text>
            <Text style={styles.emptySub}>
              Once students enroll into this batch, they'll appear here for attendance marking.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <StudentCard
            student={item}
            status={attendance[item.student_id] || 'present'}
            existing={existingByStudent[item.student_id]}
            onChange={(s) => setStatus(item.student_id, s)}
          />
        )}
      />

      {/* ── Sticky footer ── */}
      {students.length > 0 ? (
        <View style={styles.footer}>
          <View style={styles.footerCounters}>
            <View style={styles.counterChip}>
              <View style={[styles.counterDot, { backgroundColor: GREEN }]} />
              <Text style={styles.counterText}>{counters.present} present</Text>
            </View>
            <View style={styles.counterChip}>
              <View style={[styles.counterDot, { backgroundColor: ROSE }]} />
              <Text style={styles.counterText}>{counters.absent} absent</Text>
            </View>
            <View style={styles.counterChip}>
              <View style={[styles.counterDot, { backgroundColor: AMBER }]} />
              <Text style={styles.counterText}>{counters.late} late</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={submit}
            disabled={saving}
            activeOpacity={0.88}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save size={16} color="#fff" strokeWidth={2.6} />
                <Text style={styles.saveBtnText}>Save attendance</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BG,
  },
  headerTitle: {
    fontSize: 16, fontWeight: '800', color: TEXT, letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginTop: 2,
  },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
  },
  historyBtnText: {
    fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.2,
  },

  // Prefill hint
  prefillHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BRAND_SOFT + 'CC',
    borderWidth: 1,
    borderColor: BRAND_SOFT,
  },
  prefillHintText: {
    fontSize: 11, fontWeight: '700', color: TEXT, flexShrink: 1,
  },

  // Student card
  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14, fontWeight: '800', color: BRAND,
  },
  studentName: {
    fontSize: 14, fontWeight: '800', color: TEXT, letterSpacing: -0.1,
  },
  studentEmail: {
    fontSize: 11, fontWeight: '600', color: TEXT_MUTED, marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Status pills
  pillRow: {
    flexDirection: 'row', gap: 8,
  },
  pill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12, fontWeight: '800', letterSpacing: 0.2,
  },

  // Audit strip
  auditWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    gap: 4,
  },
  auditRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
  },
  auditText: {
    flex: 1,
    fontSize: 10.5, fontWeight: '600', color: TEXT_MUTED, lineHeight: 14,
  },
  auditName: { color: TEXT, fontWeight: '800' },
  auditRole: {
    color: BRAND, fontWeight: '800',
  },
  auditDate: {
    color: TEXT_LIGHT, fontWeight: '600',
  },

  // Empty
  empty: {
    alignItems: 'center',
    padding: 32,
    gap: 6,
    marginTop: 40,
  },
  emptyIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 6,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: TEXT },
  emptySub: {
    fontSize: 12, fontWeight: '600', color: TEXT_MUTED,
    textAlign: 'center', lineHeight: 16,
  },

  // Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    gap: 10,
  },
  footerCounters: {
    flexDirection: 'row', gap: 6, flexWrap: 'wrap',
  },
  counterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: BG,
  },
  counterDot: { width: 6, height: 6, borderRadius: 3 },
  counterText: {
    fontSize: 10.5, fontWeight: '800', color: TEXT, letterSpacing: 0.2,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: BRAND,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  saveBtnText: {
    color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3,
  },
});
