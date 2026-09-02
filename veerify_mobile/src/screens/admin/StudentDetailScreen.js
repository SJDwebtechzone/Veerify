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

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, StatusBar, Alert, ActivityIndicator,
  Modal, FlatList, Pressable,
} from 'react-native';
import apiClient from '../../api/client';
import {
  ArrowLeft, MoreHorizontal, Edit3, Phone, Mail, MapPin,
  CalendarRange, GraduationCap, ClipboardCheck, Wallet, TrendingUp,
  ChevronRight, MessageCircle, Award, CheckCircle2, XCircle, Clock,
  Send, ArrowRightLeft, Layers3, X as XIcon,
} from 'lucide-react-native';

import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import Avatar from '../../components/Avatar';

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
  // Distinct batches this student is enrolled in — powers the "Batches"
  // quick-stat tile. Previously hard-coded to 2 for every student.
  const [batchCount, setBatchCount] = useState(0);
  // Which enrolment id is currently having its payment link resent
  // (drives the spinner + disabled state on the resend chip).
  const [resendingId, setResendingId] = useState(null);

  // Active enrollment for the transfer buttons on the Enrollment card
  // (Change Course / Transfer Batch). We take the newest enrolment as
  // the "current" one — a student can have multiple enrolments over
  // time; the last one is what the card renders.
  const [activeEnrollment, setActiveEnrollment] = useState(null);
  // Modal state for the two pickers + the reload bump.
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [batchModalOpen,  setBatchModalOpen]  = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const bumpReload = useCallback(() => setReloadTick((t) => t + 1), []);
  // Local overrides that give the UI an instant response to a
  // successful transfer while the backend refresh is in flight.
  const [overrides, setOverrides] = useState({ course: null, batch: null });

  // POST /api/enrollments/:id/resend-payment-link — regenerates the
  // Razorpay link and re-emails the student. Best-effort with a friendly
  // alert either way. Refreshes the local rows on success so the admin
  // sees the "Fresh link sent" state without a manual reload.
  const handleResend = async (enrollmentId, studentEmail) => {
    if (!enrollmentId || resendingId) return;
    setResendingId(enrollmentId);
    try {
      const r = await apiClient.post(
        `/enrollments/${enrollmentId}/resend-payment-link`,
      );
      confirm({
        title: 'Payment link sent',
        message:
          `A fresh payment link has been emailed${studentEmail ? ` to ${studentEmail}` : ''}. ` +
          `The previous link is now invalid — only the newest one accepts payment.`,
        variant:     'success',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      // Bump the local `date` so the UI reflects that we just resent,
      // even before the next enrollments refresh.
      setPayments((prev) => prev.map((p) => (
        p.id === enrollmentId
          ? { ...p, last_resent: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) }
          : p
      )));
    } catch (err) {
      confirm({
        title: 'Could not resend link',
        message: err?.response?.data?.message
          || 'The Razorpay call failed. Check the backend logs and try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setResendingId(null);
    }
  };

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
          // Extra fields for the Resend Payment Link action — only
          // exposed on pending rows where the admin toggled the
          // link path (payment_link_enabled=true).
          payment_link_enabled: !!e.payment_link_enabled,
          // Next Payment Date — surfaced in the payment card so the
          // admin can see when the student's next installment is
          // due. Read-only when the enrolment is link-driven per
          // spec ("payment scheduling is handled by payment links").
          next_payment_date: e.next_payment_date || null,
          date:   e.paid_at
            ? new Date(e.paid_at).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })
            : null,
        }));
        // Count unique batches. Fall back to enrollment count when
        // batch_id isn't present on the row (older records).
        const batchIds = new Set(
          mine
            .map((e) => e.batch_id)
            .filter((id) => id != null),
        );
        const uniqueBatches = batchIds.size > 0 ? batchIds.size : mine.length;
        // Newest enrollment = the one the Enrollment card renders.
        // /enrollments/institution/me is ordered DESC by enrolled_at,
        // but sort explicitly to be defensive against ordering
        // changes on the backend.
        const sorted = [...mine].sort((a, z) => {
          const ta = new Date(a.enrolled_at || 0).getTime();
          const tz = new Date(z.enrolled_at || 0).getTime();
          return tz - ta;
        });
        const current = sorted[0] || null;
        if (!cancelled) {
          setPayments(mapped);
          setBatchCount(uniqueBatches);
          setActiveEnrollment(current);
          // Clear any local overrides once the backend refresh has
          // landed — the source of truth is back in sync.
          setOverrides({ course: null, batch: null });
        }
      } catch (err) {
        console.log('[StudentDetail] payments load error:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [student, reloadTick]);

  // ── Change Course / Transfer Batch flows ────────────────────────
  // Both fetch the picker options from existing endpoints — no new
  // API surface introduced on the mobile side. Cross-cutting guards
  // (institution match, active status) all live on the backend so
  // the mobile stays simple.

  const openCourseModal = useCallback(async () => {
    if (!activeEnrollment) {
      confirm({
        title: 'No active enrollment',
        message: 'This student does not have an enrollment to modify.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      return;
    }
    setCourseModalOpen(true);
  }, [activeEnrollment]);

  const openBatchModal = useCallback(async () => {
    if (!activeEnrollment) {
      confirm({
        title: 'No active enrollment',
        message: 'This student does not have an enrollment to modify.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      return;
    }
    setBatchModalOpen(true);
  }, [activeEnrollment]);

  const submitCourseChange = useCallback((course) => {
    if (!activeEnrollment || !course) return;
    confirm({
      title: 'Change course?',
      message:
        `Move this student to "${course.name}"?\n\n`
        + `Attendance, payments, certificates, and belt history stay in place.`
        + (activeEnrollment.batch_id
          ? ` You may need to Transfer Batch after this to pick a batch under the new course.`
          : ''),
      variant: 'destructive',
      confirmText: 'Change course',
      cancelText:  'Cancel',
      onConfirm: async () => {
        try {
          const res = await apiClient.patch(
            `/enrollments/${activeEnrollment.id}/course`,
            { course_id: course.id },
          );
          setOverrides((prev) => ({
            ...prev,
            course: { id: course.id, name: res.data?.new_course_name || course.name },
          }));
          setCourseModalOpen(false);
          bumpReload();
          confirm({
            title: 'Course changed',
            message: res.data?.batch_mismatch
              ? `Course updated. The student's current batch runs a different course — tap Transfer Batch to pick a new batch under "${course.name}".`
              : `Course updated to "${course.name}".`,
            variant: 'success',
            confirmText: 'Done',
            hideCancel: true,
          });
        } catch (err) {
          confirm({
            title: 'Could not change course',
            message:
              err?.response?.data?.message
              || 'The transfer failed. Please try again.',
            variant: 'warning',
            confirmText: 'OK',
            hideCancel: true,
          });
        }
      },
    });
  }, [activeEnrollment, bumpReload]);

  const submitBatchTransfer = useCallback((batch) => {
    if (!activeEnrollment || !batch) return;
    confirm({
      title: 'Transfer batch?',
      message:
        `Move this student to "${batch.name}"?\n\n`
        + `Existing attendance, payments and certificates stay linked to the old batch as historical records.`,
      variant: 'destructive',
      confirmText: 'Transfer',
      cancelText:  'Cancel',
      onConfirm: async () => {
        try {
          const res = await apiClient.patch(
            `/enrollments/${activeEnrollment.id}/batch`,
            { batch_id: batch.id },
          );
          setOverrides((prev) => ({
            ...prev,
            batch: { id: batch.id, name: res.data?.new_batch_name || batch.name },
          }));
          setBatchModalOpen(false);
          bumpReload();
          confirm({
            title: 'Batch transferred',
            message: `Student is now in "${batch.name}".`,
            variant: 'success',
            confirmText: 'Done',
            hideCancel: true,
          });
        } catch (err) {
          confirm({
            title: 'Could not transfer batch',
            message:
              err?.response?.data?.message
              || 'The transfer failed. Please try again.',
            variant: 'warning',
            confirmText: 'OK',
            hideCancel: true,
          });
        }
      },
    });
  }, [activeEnrollment, bumpReload]);

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

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Premium martial-arts hero ─────
            Dark charcoal card. Decorative art is drawn with SVG:
              • Two organic brush-stroke paths (irregular red swipes
                across the middle band) instead of straight rounded
                rectangles.
              • A hand-drawn martial-arts flying-kick silhouette in
                dark grey that sits on the right side of the card.
            Both live behind the avatar/name/status foreground. */}
        <View style={styles.hero}>
          {/* Background brush-stroke accents — layered thin rotated
              rectangles that read as diagonal red brush swipes across
              the middle band. Kept as primitives (no SVG) so the
              layer can never render as an opaque box on any device.
              The `heroArtLayer` clips overflow so extra-wide bars
              don't spill beyond the hero card. */}
          <View style={styles.heroArtLayer} pointerEvents="none">
            <View style={[styles.brushStroke, styles.brushStrokeMain]} />
            <View style={[styles.brushStroke, styles.brushStrokeAccent]} />
            <View style={[styles.brushStroke, styles.brushStrokeThin]} />
          </View>

          {/* Active / Inactive pill — top-right of the hero. */}
          <View
            style={[
              styles.heroStatusPill,
              {
                backgroundColor: student.active ? 'rgba(16,185,129,0.16)' : 'rgba(148,163,184,0.18)',
                borderColor:     student.active ? 'rgba(16,185,129,0.55)' : 'rgba(148,163,184,0.5)',
              },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: student.active ? '#10B981' : '#94A3B8' },
              ]}
            />
            <Text
              style={[
                styles.heroStatusText,
                { color: student.active ? '#A7F3D0' : '#CBD5E1' },
              ]}
            >
              {student.active ? 'Active' : 'Inactive'}
            </Text>
          </View>

          {/* Circular profile photo — white outer border + red
              accent ring. The ring is a separate wrapper so both
              borders render crisply on Android. */}
          <View style={styles.heroAvatarRing}>
            <View style={styles.heroAvatarWhite}>
              <Avatar
                uri={student.avatar || student.photo_url}
                name={student.name}
                size={98}
                tone="purple"
              />
            </View>
          </View>

          {/* Name + course underneath. */}
          <Text style={styles.heroName} numberOfLines={1}>{student.name}</Text>
          {student.course ? (
            <Text style={styles.heroCourse} numberOfLines={1}>{student.course}</Text>
          ) : null}

          {/* Bottom belt bar — thin red band that echoes the brush
              strokes above and gives the card a defined foot. */}
          <View style={styles.heroBeltBar} pointerEvents="none" />
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
            value={String(batchCount)}
            label={batchCount === 1 ? 'Batch' : 'Batches'}
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
          {/* Course row + Change Course action.
              The picker expands inline directly below this row instead
              of opening a bottom-sheet, so the admin stays in context
              on the Enrollment card. The row's value prefers the local
              override (fresh response from PATCH /enrollments/:id/course)
              so the UI updates instantly, before the next backend
              refresh. */}
          <View style={styles.enrollmentRow}>
            <View style={{ flex: 1 }}>
              <InfoRow
                icon={GraduationCap}
                label="Course"
                value={overrides.course?.name || activeEnrollment?.course_name || student.course || '—'}
                accent={accent}
              />
            </View>
            <TouchableOpacity
              onPress={() => setCourseModalOpen((o) => !o)}
              style={[styles.transferBtn, courseModalOpen && styles.transferBtnActive]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Change course"
            >
              <ArrowRightLeft size={13} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.transferBtnText}>{courseModalOpen ? 'Close' : 'Change'}</Text>
            </TouchableOpacity>
          </View>
          {courseModalOpen ? (
            <InlineTransferPicker
              title="Change Course"
              subtitle="Pick a new course for this student"
              currentId={activeEnrollment?.course_id}
              loader={async () => {
                const r = await apiClient.get('/courses');
                const rows = Array.isArray(r.data?.courses) ? r.data.courses : (r.data || []);
                return rows
                  .filter((c) => (c.status || 'active') === 'active')
                  .map((c) => ({
                    id:       c.id,
                    name:     c.name,
                    subtitle: c.category || c.level || null,
                  }));
              }}
              onSubmit={submitCourseChange}
              icon={GraduationCap}
              emptyText="No active courses found for this institution."
            />
          ) : null}
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
          <View style={styles.enrollmentRow}>
            <View style={{ flex: 1 }}>
              <InfoRow
                icon={CalendarRange}
                label="Current Batch"
                value={overrides.batch?.name || activeEnrollment?.batch_name || student.batch || '—'}
              />
            </View>
            <TouchableOpacity
              onPress={() => setBatchModalOpen((o) => !o)}
              style={[styles.transferBtn, batchModalOpen && styles.transferBtnActive]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Transfer batch"
            >
              <ArrowRightLeft size={13} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.transferBtnText}>{batchModalOpen ? 'Close' : 'Transfer'}</Text>
            </TouchableOpacity>
          </View>
          {batchModalOpen ? (
            <InlineTransferPicker
              title="Transfer Batch"
              subtitle="Pick a new batch under the current course"
              currentId={activeEnrollment?.batch_id}
              loader={async () => {
                const courseId = activeEnrollment?.course_id;
                if (!courseId) return [];
                const r = await apiClient.get('/batches');
                const rows = Array.isArray(r.data?.batches) ? r.data.batches : [];
                return rows
                  .filter((b) => b.course_id === courseId)
                  .filter((b) => b.id !== activeEnrollment?.batch_id)
                  .map((b) => ({
                    id:       b.id,
                    name:     b.name,
                    subtitle: [b.days_of_week, b.branch_name].filter(Boolean).join(' · ') || null,
                  }));
              }}
              onSubmit={submitBatchTransfer}
              icon={Layers3}
              emptyText="No other batches available for this course."
            />
          ) : null}
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
              <PaymentRow
                payment={p}
                studentEmail={student?.email}
                onResend={handleResend}
                resending={resendingId === p.id}
              />
              {idx < payments.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

// ─── InlineTransferPicker ────────────────────────────────────────────
// Panel that expands INLINE inside the Enrollment card, directly
// beneath the row that opened it. Not a bottom-sheet Modal — the
// admin stays visually anchored to the row they're changing.
//
// Fetches its own options on mount (via the `loader` prop) so the
// parent doesn't need to preload them, and shows loading / empty /
// error states inline. Row taps forward the picked item to
// `onSubmit`, which is expected to open its own confirmation dialog
// and collapse the picker on success.
function InlineTransferPicker({
  title, subtitle, currentId, loader, onSubmit, icon: Icon, emptyText,
}) {
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rows = await loader();
        if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || err?.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once on mount — the picker is torn down + remounted every
    // time the admin toggles the row's button, so this gets a fresh
    // load per open without needing an explicit `visible` dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={pickerStyles.panel}>
      <View style={pickerStyles.header}>
        <Text style={pickerStyles.title}>{title}</Text>
        {subtitle ? <Text style={pickerStyles.subtitle}>{subtitle}</Text> : null}
      </View>

      {loading ? (
        <View style={pickerStyles.center}>
          <ActivityIndicator color={palette.purple.vivid} />
          <Text style={pickerStyles.muted}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={pickerStyles.center}>
          <Text style={pickerStyles.errorText}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={pickerStyles.center}>
          <Text style={pickerStyles.muted}>{emptyText || 'No options available.'}</Text>
        </View>
      ) : (
        // Rendered as a mapped list (not FlatList) so it sits
        // naturally inside the parent ScrollView without a nested
        // scroller stealing gestures.
        <View>
          {items.map((item, idx) => {
            const isCurrent = currentId != null && item.id === currentId;
            return (
              <View key={String(item.id)}>
                {idx > 0 ? <View style={pickerStyles.rowSep} /> : null}
                <TouchableOpacity
                  style={pickerStyles.row}
                  onPress={() => !isCurrent && onSubmit(item)}
                  activeOpacity={0.85}
                  disabled={isCurrent}
                >
                  <View style={pickerStyles.rowIcon}>
                    {Icon ? <Icon size={16} color={palette.purple.vivid} strokeWidth={2.2} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={pickerStyles.rowName} numberOfLines={1}>{item.name}</Text>
                    {item.subtitle ? (
                      <Text style={pickerStyles.rowMeta} numberOfLines={1}>{item.subtitle}</Text>
                    ) : null}
                  </View>
                  {isCurrent ? (
                    <Text style={pickerStyles.currentPill}>Current</Text>
                  ) : (
                    <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  panel: {
    marginTop: spacing?.sm ?? 8,
    marginBottom: spacing?.sm ?? 8,
    backgroundColor: palette.purple?.soft || '#FEE2E2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: (palette.purple?.vivid || '#EF4444') + '20',
    paddingHorizontal: spacing?.md ?? 12,
    paddingVertical: spacing?.sm ?? 8,
  },
  header: {
    marginBottom: 4,
  },
  title:    { fontSize: 13, fontWeight: '800', color: palette.text || '#111827', letterSpacing: 0.2 },
  subtitle: { fontSize: 11, color: palette.textMuted || '#6B7280', marginTop: 2 },
  center: { alignItems: 'center', paddingVertical: 18 },
  muted:  { fontSize: 12, color: palette.textMuted || '#6B7280', marginTop: 6 },
  errorText: { fontSize: 12, color: palette.rose?.on || '#991B1B', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  rowIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  rowName: { fontSize: 13, fontWeight: '700', color: palette.text || '#111827' },
  rowMeta: { fontSize: 11, color: palette.textMuted || '#6B7280', marginTop: 2 },
  rowSep:  { height: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
  currentPill: {
    fontSize: 10,
    fontWeight: '800',
    color: palette.textMuted || '#6B7280',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
});

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

function PaymentRow({ payment, studentEmail, onResend, resending }) {
  const map = {
    paid:    { color: palette.green,  label: 'Paid'    },
    pending: { color: palette.orange, label: 'Pending' },
    overdue: { color: palette.rose,   label: 'Overdue' },
    failed:  { color: palette.rose,   label: 'Failed'  },
    expired: { color: palette.rose,   label: 'Expired' },
  };
  const m = map[payment.status] || map.pending;
  const modeLabel = payment.mode ? (PAYMENT_MODE_LABELS[payment.mode] || payment.mode) : null;
  const subtitle = payment.status === 'paid'
    ? `${modeLabel ? `${modeLabel} • ` : ''}${payment.date ? `Paid on ${payment.date}` : 'Paid'}`
    : payment.last_resent
      ? `Due · Fresh link sent at ${payment.last_resent}`
      : 'Due';

  // Resend button only makes sense on rows that were minted with a
  // payment link AND are still awaiting payment. Offline payment_mode
  // rows or already-paid rows never show this action.
  const canResend =
    payment.payment_link_enabled &&
    (payment.status === 'pending' || payment.status === 'failed' || payment.status === 'expired');

  return (
    <View>
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
      {canResend ? (
        <TouchableOpacity
          onPress={() => onResend?.(payment.id, studentEmail)}
          disabled={resending}
          activeOpacity={0.85}
          style={[styles.resendBtn, resending && { opacity: 0.7 }]}
        >
          {resending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Send size={13} color="#fff" strokeWidth={2.6} />
          )}
          <Text style={styles.resendBtnText}>
            {resending ? 'Sending fresh link…' : 'Resend payment link'}
          </Text>
        </TouchableOpacity>
      ) : null}
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
    // 220 (was 180) — the pill row that now sits inside the scroll
    // content pushes the avatar + name + course-name block down a
    // touch. Extending the band ensures those three land INSIDE the
    // pink area at their original visual weight instead of spilling
    // onto the white background.
    height: 220,
  },

  // ── Premium martial-arts hero ─────────────────────────────────
  hero: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: '#0B0B0F',   // near-black charcoal
    overflow: 'hidden',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    minHeight: 260,
    ...shadows.raised,
  },
  // Absolute background layer that hosts the brush-stroke bars.
  // overflow:hidden clips the rotated bars so they don't stick out
  // past the hero card's rounded corners.
  heroArtLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    borderRadius: radius.xl,
  },
  brushStroke: {
    position: 'absolute',
    borderRadius: 999,
  },
  brushStrokeMain: {
    left: -30, right: -60,
    top: 140,
    height: 26,
    backgroundColor: '#DC2626',
    opacity: 0.75,
    transform: [{ rotate: '-7deg' }],
  },
  brushStrokeAccent: {
    left: -20, right: -40,
    top: 168,
    height: 14,
    backgroundColor: '#991B1B',
    opacity: 0.55,
    transform: [{ rotate: '-6deg' }],
  },
  brushStrokeThin: {
    left: 60, right: -80,
    top: 110,
    height: 8,
    backgroundColor: '#EF4444',
    opacity: 0.35,
    transform: [{ rotate: '-9deg' }],
  },

  // Brush-stroke accents — absolutely positioned diagonals that
  // sweep across the middle of the hero. Colours are tuned so they
  // read as "brushed red" without shouting.
  brushSlash: {
    position: 'absolute',
    height: 28,
    borderRadius: 999,
    left: -40, right: -40,
  },
  brushSlashA: {
    top: 120,
    backgroundColor: 'rgba(220, 38, 38, 0.55)',
    transform: [{ rotate: '-8deg' }],
  },
  brushSlashB: {
    top: 150,
    height: 14,
    backgroundColor: 'rgba(153, 27, 27, 0.85)',
    transform: [{ rotate: '-6deg' }],
  },
  brushSlashC: {
    top: 100,
    height: 8,
    left: 20, right: -80,
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
    transform: [{ rotate: '-12deg' }],
  },

  // Stylised martial-arts figure — head disc + torso block + limbs.
  silhouetteWrap: {
    position: 'absolute',
    right: -10,
    top: 30,
    width: 130,
    height: 210,
  },
  silhouetteHead: {
    position: 'absolute',
    right: 40, top: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(15,15,20,0.95)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  silhouetteTorso: {
    position: 'absolute',
    right: 32, top: 24,
    width: 38, height: 60, borderRadius: 8,
    backgroundColor: 'rgba(15,15,20,0.9)',
    transform: [{ rotate: '-6deg' }],
  },
  silhouetteArm: {
    position: 'absolute',
    right: 10, top: 40,
    width: 60, height: 12, borderRadius: 6,
    backgroundColor: 'rgba(15,15,20,0.9)',
    transform: [{ rotate: '25deg' }],
  },
  silhouetteLegBack: {
    position: 'absolute',
    right: 40, top: 82,
    width: 14, height: 70, borderRadius: 6,
    backgroundColor: 'rgba(15,15,20,0.9)',
  },
  // The dynamic "kicking" leg — angled outward for the flying-kick
  // pose the reference image uses.
  silhouetteLegKick: {
    position: 'absolute',
    right: 55, top: 78,
    width: 12, height: 90, borderRadius: 6,
    backgroundColor: 'rgba(15,15,20,0.9)',
    transform: [{ rotate: '-40deg' }],
  },

  // Active / Inactive pill in the top-right of the hero.
  heroStatusPill: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  heroStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  // Circular avatar treatment: outer red accent ring + inner white
  // border. Padding is what visually creates the ring gap.
  heroAvatarRing: {
    width: 118, height: 118, borderRadius: 59,
    borderWidth: 2,
    borderColor: '#DC2626',
    alignItems: 'center', justifyContent: 'center',
    padding: 4,
    marginTop: spacing.md,
  },
  heroAvatarWhite: {
    width: 106, height: 106, borderRadius: 53,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#0B0B0F',
  },

  heroName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  heroCourse: {
    color: '#F87171',    // red-400
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.4,
    textAlign: 'center',
  },

  // Thin red belt-like bar at the foot of the hero — small
  // decorative flourish that mirrors the brush strokes.
  heroBeltBar: {
    position: 'absolute',
    left: 40, right: 40, bottom: 10,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(220, 38, 38, 0.7)',
  },

  scrollContent: {
    // paddingTop trimmed to 0 — the status pill row below now carries
    // its own top spacing, so the avatar + name land at the same
    // vertical position they did before the pill moved inside the
    // ScrollView. Without this trim the whole profile block shifted
    // ~40pt down and the name/course text crossed the pink band
    // boundary into the white area.
    paddingTop: 0,
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

  // Enrollment card — row with an inline action button on the right
  // (Change Course / Transfer Batch).
  enrollmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  transferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
    borderWidth: 1,
    borderColor: palette.purple.vivid + '40',
  },
  transferBtnActive: {
    backgroundColor: palette.purple.vivid + '20',
    borderColor: palette.purple.vivid,
  },
  transferBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: palette.purple.vivid,
    letterSpacing: 0.3,
  },
  // Inline variant — sits inside the ScrollView at the top so the
  // Active/Inactive badge scrolls away with the header/profile
  // section instead of floating over every card below it.
  statusPillRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Enough top space to keep the pill visually inside the pink
    // header band; no bottom margin so the avatar block underneath
    // sits exactly where it did before the pill moved into the
    // scroll content.
    paddingTop: spacing.sm,
    marginBottom: 0,
  },
  statusPillInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
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

  // Resend Payment Link chip — sits under a pending row so the admin
  // can mint a fresh Razorpay URL without leaving the profile. Filled
  // vivid purple button reads as a clear CTA and matches every other
  // primary action across the admin screens.
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: palette.purple.vivid,
    ...shadows.card,
  },
  resendBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.3,
  },
});
