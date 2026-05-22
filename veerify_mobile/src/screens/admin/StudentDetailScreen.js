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

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, StatusBar, Alert,
} from 'react-native';
import {
  ArrowLeft, MoreHorizontal, Edit3, Phone, Mail, MapPin,
  CalendarRange, GraduationCap, ClipboardCheck, Wallet, TrendingUp,
  ChevronRight, MessageCircle, Award, CheckCircle2, XCircle, Clock,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../theme';

// ─── Placeholder timeline / payments — replaced when wired to backend ────────
const ATTENDANCE = [
  { date: '17 May',  day: 'Sat', status: 'present' },
  { date: '15 May',  day: 'Thu', status: 'present' },
  { date: '13 May',  day: 'Tue', status: 'late'    },
  { date: '11 May',  day: 'Sun', status: 'present' },
  { date: '10 May',  day: 'Sat', status: 'absent'  },
  { date: '08 May',  day: 'Thu', status: 'present' },
  { date: '06 May',  day: 'Tue', status: 'present' },
];

const PAYMENTS = [
  { id: 1, month: 'May 2026',   amount: 2500, status: 'paid',    date: '05 May' },
  { id: 2, month: 'Apr 2026',   amount: 2500, status: 'paid',    date: '04 Apr' },
  { id: 3, month: 'Mar 2026',   amount: 2500, status: 'paid',    date: '06 Mar' },
  { id: 4, month: 'Feb 2026',   amount: 2500, status: 'pending', date: '— ' },
];

// 8-week attendance counts (placeholder for the mini chart)
const ATTENDANCE_BARS = [3, 2, 3, 3, 1, 3, 2, 3];

export default function StudentDetailScreen({ navigation, route }) {
  const student = route?.params?.student;

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
  const paymentStats    = computePaymentStats(PAYMENTS);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.bg} />

      {/* ───── Gradient header strip ───── */}
      <View style={[styles.headerBand, { backgroundColor: accent.soft }]} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Top action row ───── */}
        <View style={styles.actionRow}>
          <RoundButton icon={ArrowLeft} onPress={() => navigation.goBack()} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <RoundButton icon={Edit3} onPress={() => placeholder('Edit Student')} />
            <RoundButton icon={MoreHorizontal} onPress={() => placeholder('More actions')} />
          </View>
        </View>

        {/* ───── Profile section ───── */}
        <View style={styles.profileSection}>
          <View style={styles.avatarWrap}>
            {student.avatar ? (
              <Image source={{ uri: student.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: accent.vivid }]}>
                <Text style={styles.avatarInitial}>
                  {student.name?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.avatarEditButton}
              activeOpacity={0.85}
              onPress={() => placeholder('Change Photo')}
            >
              <Edit3 size={12} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <Text style={styles.name}>{student.name}</Text>
          <Text style={styles.studentId}>{student.id}</Text>
          <View
            style={[
              styles.statusPill,
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

        {/* ───── Contact info ───── */}
        <Card title="Contact" subtitle="Reach out if needed">
          <InfoRow icon={Phone}  label="Phone"   value="+91 98765 43210" onPress={() => placeholder('Call')} />
          <Divider />
          <InfoRow icon={Mail}   label="Email"   value={`${student.name?.split(' ')[0].toLowerCase()}@example.com`} />
          <Divider />
          <InfoRow icon={MapPin} label="Address" value="Bengaluru, KA — 560001" />
          <Divider />
          <InfoRow icon={MessageCircle} label="Guardian" value="Mr. Sharma (Father) — +91 98765 12345" />
        </Card>

        {/* ───── Enrollment ───── */}
        <Card title="Enrollment" subtitle="Course and batch details">
          <InfoRow icon={GraduationCap} label="Course" value={student.course} accent={accent} />
          <Divider />
          <InfoRow icon={Award}        label="Level"  value={student.level} />
          <Divider />
          <InfoRow icon={CalendarRange} label="Joined" value="12 Jan 2026" />
          <Divider />
          <InfoRow
            icon={CalendarRange}
            label="Current Batch"
            value="Batch B-12 • Mon/Wed/Fri • 6:00 PM"
            onPress={() => placeholder('Open Batch')}
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
        <Card title="Payment Summary" subtitle="Year-to-date">
          <View style={styles.paySummary}>
            <PaySummaryItem label="Paid"     value={`₹${(paymentStats.paid / 1000).toFixed(0)}k`} color={palette.green} />
            <View style={styles.paySplit} />
            <PaySummaryItem label="Pending"  value={`₹${(paymentStats.pending / 1000).toFixed(1)}k`} color={palette.orange} />
            <View style={styles.paySplit} />
            <PaySummaryItem label="Next Due" value="05 Jun" color={palette.blue} />
          </View>
        </Card>

        {/* ───── Recent payments ───── */}
        <Card title="Recent Payments" subtitle="Most recent first">
          {PAYMENTS.map((p, idx) => (
            <View key={p.id}>
              <PaymentRow payment={p} />
              {idx < PAYMENTS.length - 1 ? <Divider /> : null}
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
  };
  const m = map[payment.status] || map.pending;
  return (
    <View style={styles.payRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.payMonth}>{payment.month}</Text>
        <Text style={styles.payDate}>{payment.status === 'paid' ? `Paid on ${payment.date}` : 'Due'}</Text>
      </View>
      <Text style={styles.payAmount}>₹{payment.amount.toLocaleString()}</Text>
      <View style={[styles.payPill, { backgroundColor: m.color.soft }]}>
        <Text style={[styles.payPillText, { color: m.color.on }]}>{m.label}</Text>
      </View>
    </View>
  );
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

  headerBand: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 220,
  },

  scrollContent: {
    paddingTop: spacing.xxl + 10,
    paddingHorizontal: spacing.xl,
  },

  // Top action row
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
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
