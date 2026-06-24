// src/screens/admin/StudentDetailScreen.js
//
// Detail screen for a single student. Pushed over the bottom tab bar from
// StudentsTabScreen.
//
// Layout (top → bottom):
//   1. Gradient header strip with back / edit / more buttons
//   2. Profile section overlapping the header — avatar, name, ID, status pill
//   3. Quick stats row: attendance %, batches enrolled, fees status
//   4. Contact info card
//   5. Enrollment card (course, level, join date, current batch)
//   6. Attendance summary — total/present/absent/late counters + mini bar chart
//   7. Recent attendance timeline (last 7 sessions, vertical timeline)
//   8. Payment summary card (paid / pending / next due amounts)
//   9. Recent payments list (status pills)
//
// All numbers/dates are placeholder. The student object is read from
// route.params.student (passed from the Students list); if absent we render
// a friendly empty state instead of crashing.

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, StatusBar, Alert,
} from 'react-native';
import apiClient from '../../api/client';
import {
  ArrowLeft, MoreHorizontal, Edit3, Phone, Mail, MapPin,
  CalendarRange, GraduationCap, ClipboardCheck, Wallet, TrendingUp,
  ChevronRight, MessageCircle, Award, CheckCircle2, XCircle, Clock,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../theme';

// ─── Placeholder timeline / payments — replaced when wired to backend ────────
// Placeholder rows have been removed. Until the real
// /attendance/student/:id and /payments/student/:id endpoints are
// wired, these arrays stay empty so newly-enrolled students don't
// see fabricated history (the previous defaults claimed "86% attendance"
// and "Mr. Sharma (Father)" for every student regardless of who they
// were). The summary cards now correctly render zeros.
const ATTENDANCE = [];
const ATTENDANCE_BARS = [0, 0, 0, 0, 0, 0, 0, 0];

// Display labels for the payment_mode column written by the enrollment form.
const PAYMENT_MODE_LABELS = {
  cash:   'Cash',
  online: 'Online',
  upi:    'UPI',
  card:   'Card',
  bank:   'Bank Transfer',
};

export default function StudentDetailScreen({ navigation, route }) {
  const student = route?.params?.student;

  // Live payment rows for THIS student, derived from
  // /enrollments/institution/me. Replaces the empty PAYMENTS placeholder
  // so cash/online payments captured on the enrollment form actually
  // appear in the Recent Payments card and the Year-to-date summary.
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!student) return;
      try {
        const res  = await apiClient.get('/enrollments/institution/me');
        const rows = res.data?.enrollments || [];
        const sid  = student.id ?? student.student_id ?? student.user_id;
        const mine = rows.filter((e) => e.student_id === sid);
        const mapped = mine.map((e) => ({
          id:     e.id,
          course: e.course_name || '—',
          amount: Number(e.payment_amount) || 0,
          status: e.payment_status || 'pending',
          mode:   e.payment_mode || null,
          date:   e.paid_at
            ? new Date(e.paid_at).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })
            : null,
        }));
        if (!cancelled) setPayments(mapped);
      } catch (err) {
        console.log('[StudentDetail] payments load error:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [student]);

  // Defensive fallback so a fresh route doesn't crash if we forgot to pass data.
  if (!student) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.muted}>No student selected.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={{ color: palette.purple.vivid, fontWeight: '700' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const accent = student.accent || palette.purple;
  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");

  const attendanceStats = computeAttendanceStats(ATTENDANCE);
  const paymentStats    = computePaymentStats(payments);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.surface} />

      {/* ───── Top app bar — sits ABOVE the coloured header band ───── */}
      <View style={styles.topBar}>
        <RoundButton icon={ArrowLeft} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Student Details</Text>
        <RoundButton
          icon={Edit3}
          onPress={() => navigation.navigate('EditStudent', { student })}
        />
      </View>

      {/* Coloured background band — visible behind the profile section,
          starts BELOW the top bar so the title doesn't sit on the pink. */}
      <View style={[styles.headerBand, { backgroundColor: accent.soft }]} />

      {/* Status pill — pinned to the bottom-right of the pink header band.
          Lives outside the ScrollView so its absolute position is relative
          to the screen, not the scrolling content. */}
      <View
        pointerEvents="none"
        style={[
          styles.statusPillFloating,
          {
            backgroundColor: student.active ? palette.green.soft : palette.borderSoft,
          },
        ]}
      >
        <View
          style={[
            styles.statusDot,
            { backgroundColor: student.active ? palette.green.vivid : palette.textLight },
          ]}
        />
        <Text
          style={[
            styles.statusPillText,
            { color: student.active ? palette.green.on : palette.textMuted },
          ]}
        >
          {student.active ? 'Active' : 'Inactive'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Profile section ───── */}
        <View style={styles.profileSection}>
          <View style={styles.avatarWrap}>
            {student.avatar || student.photo_url ? (
              <Image
                source={{ uri: student.avatar || student.photo_url }}
                style={styles.avatar}
              />
            ) : (
              <View style={[styles.avatar, { backgroundColor: accent.vivid }]}>
                <Text style={styles.avatarInitial}>
                  {student.name?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.name}>{student.name}</Text>
          {student.course ? (
            <Text style={styles.studentId}>{student.course}</Text>
          ) : null}
        </View>

        {/* ───── Quick stats (3-up) ───── */}
        <View style={styles.quickStats}>
          <QuickStat
            value={`${attendanceStats.percent}%`}
            label="Attendance"
            accent={palette.green}
            icon={ClipboardCheck}
          />
          <QuickStat
            value="2"
            label="Batches"
            accent={palette.blue}
            icon={CalendarRange}
          />
          <QuickStat
            value={paymentStats.pendingCount > 0 ? 'Due' : 'Clear'}
            label="Fees"
            accent={paymentStats.pendingCount > 0 ? palette.orange : palette.green}
            icon={Wallet}
          />
        </View>

        {/* ───── Contact info ─────
            Everything below now reads from the real student row from
            /enrollments/institution/me (which carries student_email,
            student_phone, address, father_name, mother_name etc). Falls
            back to "—" when the field is empty so we never invent a
            value like the previous Mr. Sharma / Bengaluru hard-codes. */}
        <Card title="Contact" subtitle="Reach out if needed">
          <InfoRow
            icon={Phone}
            label="Phone"
            value={student.phone || '—'}
            onPress={student.phone ? (() => placeholder('Call')) : undefined}
          />
          <Divider />
          <InfoRow icon={Mail}   label="Email"   value={student.email || '—'} />
          <Divider />
          <InfoRow icon={MapPin} label="Address" value={student.address || '—'} />
          <Divider />
          <InfoRow
            icon={MessageCircle}
            label="Guardian"
            value={
              student.father_name
                ? `${student.father_name} (Father)`
                : student.mother_name
                  ? `${student.mother_name} (Mother)`
                  : '—'
            }
          />
        </Card>

        {/* ───── Enrollment ───── */}
        <Card title="Enrollment" subtitle="Course and batch details">
          <InfoRow icon={GraduationCap} label="Course" value={student.course || '—'} accent={accent} />
          <Divider />
          <InfoRow icon={Award} label="Level" value={student.level || student.belt_category || '—'} />
          <Divider />
          <InfoRow
            icon={CalendarRange}
            label="Joined"
            value={
              student.enrolled_at
                ? new Date(student.enrolled_at).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })
                : '—'
            }
          />
          <Divider />
          <InfoRow
            icon={CalendarRange}
            label="Current Batch"
            value={student.batch || '—'}
          />
        </Card>

        {/* ───── Attendance summary ───── */}
        <Card title="Attendance Summary" subtitle="Last 8 weeks">
          <View style={styles.attRow}>
            <AttendancePill label="Present" value={attendanceStats.present} color={palette.green} />
            <AttendancePill label="Late"    value={attendanceStats.late}    color={palette.orange} />
            <AttendancePill label="Absent"  value={attendanceStats.absent}  color={palette.rose} />
          </View>
          <View style={styles.barChart}>
            {ATTENDANCE_BARS.map((v, i) => (
              <View key={i} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: 8 + v * 20,
                      backgroundColor: i === ATTENDANCE_BARS.length - 1
                        ? palette.purple.vivid
                        : palette.purple.soft,
                    },
                  ]}
                />
                <Text style={styles.barLabel}>W{i + 1}</Text>
              </View>
            ))}
          </View>
          <View style={styles.progressNote}>
            <TrendingUp size={14} color={palette.green.vivid} strokeWidth={2.4} />
            <Text style={[styles.progressNoteText, { color: palette.green.on }]}>
              Consistent attendance — keep it up!
            </Text>
          </View>
        </Card>

        {/* ───── Recent attendance timeline ───── */}
        <Card title="Recent Attendance" subtitle="Last 7 sessions">
          <View style={{ gap: spacing.md }}>
            {ATTENDANCE.map((a, idx) => (
              <TimelineRow
                key={idx}
                date={a.date}
                day={a.day}
                status={a.status}
                isLast={idx === ATTENDANCE.length - 1}
              />
            ))}
          </View>
        </Card>

        {/* ───── Payment summary ───── */}
        <Card title="Payment Summary" subtitle="All enrollments">
          <View style={styles.paySummary}>
            <PaySummaryItem label="Paid"    value={formatRupees(paymentStats.paid)}    color={palette.green} />
            <View style={styles.paySplit} />
            <PaySummaryItem label="Pending" value={formatRupees(paymentStats.pending)} color={palette.orange} />
            <View style={styles.paySplit} />
            <PaySummaryItem label="Enrolments" value={String(payments.length)} color={palette.blue} />
          </View>
        </Card>

        {/* ───── Recent payments ───── */}
        <Card title="Recent Payments" subtitle={payments.length ? 'Most recent first' : 'No payments yet'}>
          {payments.map((p, idx) => (
            <View key={p.id}>
              <PaymentRow payment={p} />
              {idx < payments.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

// ─── Small reusable cells ────────────────────────────────────────────────────
function RoundButton({ icon: Icon, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.roundBtn} activeOpacity={0.85}>
      <Icon size={20} color={palette.text} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function InfoRow({ icon: Icon, label, value, onPress, accent }) {
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container onPress={onPress} activeOpacity={0.7} style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: (accent || palette.purple).soft }]}>
        <Icon size={16} color={(accent || palette.purple).vivid} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
      </View>
      {onPress ? <ChevronRight size={16} color={palette.textLight} strokeWidth={2} /> : null}
    </Container>
  );
}

function Divider() { return <View style={styles.divider} />; }

function QuickStat({ value, label, accent, icon: Icon }) {
  return (
    <View style={[styles.quickStat, { backgroundColor: accent.soft }]}>
      <Icon size={18} color={accent.vivid} strokeWidth={2.2} />
      <Text style={[styles.quickStatValue, { color: accent.on }]}>{value}</Text>
      <Text style={[styles.quickStatLabel, { color: accent.on }]}>{label}</Text>
    </View>
  );
}

function AttendancePill({ label, value, color }) {
  return (
    <View style={[styles.attPill, { backgroundColor: color.soft }]}>
      <Text style={[styles.attValue, { color: color.on }]}>{value}</Text>
      <Text style={[styles.attLabel, { color: color.on }]}>{label}</Text>
    </View>
  );
}

function TimelineRow({ date, day, status, isLast }) {
  const meta =
    status === 'present' ? { icon: CheckCircle2, color: palette.green, label: 'Present' } :
    status === 'late'    ? { icon: Clock,        color: palette.orange, label: 'Late'   } :
                           { icon: XCircle,      color: palette.rose,   label: 'Absent' };
  const Icon = meta.icon;
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineLeft}>
        <View style={[styles.timelineDot, { backgroundColor: meta.color.vivid }]} />
        {!isLast ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.timelineDate}>{date} · {day}</Text>
        <View style={styles.timelineStatusRow}>
          <Icon size={14} color={meta.color.vivid} strokeWidth={2.4} />
          <Text style={[styles.timelineStatus, { color: meta.color.on }]}>{meta.label}</Text>
        </View>
      </View>
    </View>
  );
}

function PaySummaryItem({ label, value, color }) {
  return (
    <View style={styles.paySummaryItem}>
      <Text style={[styles.paySummaryValue, { color: color.on }]}>{value}</Text>
      <Text style={styles.paySummaryLabel}>{label}</Text>
    </View>
  );
}

function PaymentRow({ payment }) {
  const map = {
    paid:    { color: palette.green,  label: 'Paid'    },
    pending: { color: palette.orange, label: 'Pending' },
    overdue: { color: palette.rose,   label: 'Overdue' },
    failed:  { color: palette.rose,   label: 'Failed'  },
  };
  const m = map[payment.status] || map.pending;
  const modeLabel = payment.mode ? (PAYMENT_MODE_LABELS[payment.mode] || payment.mode) : null;
  const subtitle = payment.status === 'paid'
    ? `${modeLabel ? `${modeLabel} • ` : ''}${payment.date ? `Paid on ${payment.date}` : 'Paid'}`
    : 'Due';
  return (
    <View style={styles.payRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.payMonth}>{payment.course || 'Enrolment'}</Text>
        <Text style={styles.payDate}>{subtitle}</Text>
      </View>
      <Text style={styles.payAmount}>{formatRupees(payment.amount)}</Text>
      <View style={[styles.payPill, { backgroundColor: m.color.soft }]}>
        <Text style={[styles.payPillText, { color: m.color.on }]}>{m.label}</Text>
      </View>
    </View>
  );
}

// Formats a rupee amount with thousand separators. ₹0 stays as ₹0 so an
// unpaid enrolment doesn't render as "₹—".
function formatRupees(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function computeAttendanceStats(rows) {
  const present = rows.filter(r => r.status === 'present').length;
  const late    = rows.filter(r => r.status === 'late').length;
  const absent  = rows.filter(r => r.status === 'absent').length;
  const total = rows.length || 1;
  const percent = Math.round(((present + late) / total) * 100);
  return { present, late, absent, percent };
}

function computePaymentStats(rows) {
  const paid    = rows.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const pending = rows.filter(p => p.status !== 'paid').reduce((s, p) => s + p.amount, 0);
  const pendingCount = rows.filter(p => p.status !== 'paid').length;
  return { paid, pending, pendingCount };
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  muted: { ...type.body, color: palette.textMuted },

  // Top app bar — solid white surface above the coloured band so the
  // back / title / edit buttons sit on a clean header strip.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: (StatusBar.currentHeight || 24) + spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    zIndex: 2,
  },
  headerTitle: {
    ...type.h3,
    color: palette.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },

  // Coloured band sits BELOW the top bar (no longer absolute‑positioned at y=0)
  headerBand: {
    position: 'absolute',
    left: 0, right: 0,
    top: (StatusBar.currentHeight || 24) + 60,
    height: 180,
  },

  scrollContent: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  roundBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },

  // Profile section
  profileSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  avatarWrap: { position: 'relative', marginBottom: spacing.md },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3,
    borderColor: palette.surface,
    ...shadows.raised,
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
  },
  avatarEditButton: {
    position: 'absolute',
    right: -2, bottom: -2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  name: { ...type.h1, color: palette.text },
  studentId: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  // Floating variant — pinned to the bottom-right of the pink header band.
  statusPillFloating: {
    position: 'absolute',
    right: spacing.xl,
    // top = (StatusBar height + topBar inner height + band height) - pill height/2
    // approx: matches the `headerBand.top` + `headerBand.height` minus a bit
    top: (StatusBar.currentHeight || 24) + 60 + 180 - 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    zIndex: 3,
    ...shadows.card,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { ...type.caption, fontWeight: '700' },

  // Quick stats
  quickStats: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  quickStat: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
    gap: 4,
  },
  quickStatValue: { ...type.h1, fontSize: 20 },
  quickStatLabel: { ...type.caption, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  cardHeader: { marginBottom: spacing.md },
  cardTitle: { ...type.h2 },
  cardSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // Info row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoIcon: {
    width: 34, height: 34, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { ...type.caption, color: palette.textMuted },
  infoValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  divider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: 2 },

  // Attendance
  attRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  attPill: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  attValue: { ...type.h2 },
  attLabel: { ...type.caption, fontWeight: '600', marginTop: 2 },

  // Bar chart
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
    paddingVertical: spacing.md,
  },
  barColumn: { alignItems: 'center', gap: 6 },
  bar: { width: 14, borderRadius: 7 },
  barLabel: { ...type.micro, color: palette.textMuted },

  progressNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  progressNoteText: { ...type.caption, fontWeight: '600' },

  // Timeline
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 36 },
  timelineLeft: { alignItems: 'center', width: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, backgroundColor: palette.borderSoft, marginTop: 2 },
  timelineDate: { ...type.bodyBold, color: palette.text },
  timelineStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  timelineStatus: { ...type.caption, fontWeight: '600' },

  // Payment summary
  paySummary: { flexDirection: 'row', alignItems: 'center' },
  paySummaryItem: { flex: 1, alignItems: 'center' },
  paySummaryValue: { ...type.h2 },
  paySummaryLabel: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  paySplit: { width: 1, height: 36, backgroundColor: palette.borderSoft },

  // Payment row
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  payMonth: { ...type.bodyBold, color: palette.text },
  payDate: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  payAmount: { ...type.bodyBold, color: palette.text },
  payPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  payPillText: { ...type.micro, fontWeight: '700' },
});
