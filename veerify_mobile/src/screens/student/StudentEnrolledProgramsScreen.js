// src/screens/student/StudentEnrolledProgramsScreen.js
//
// Student → More → Enrolled Programs. Lists every course the student
// is enrolled in with:
//   • Course name + institution + trainer
//   • Belt / level chip
//   • Enrollment date
//   • Payment / activation status pill
//   • Progress bar (from /curriculum-progress, best-effort per row)
//
// Access rule: a row only appears in the main "Enrolled Programs"
// list once its payment_status is 'paid' (webhook-verified). Pending
// / failed / cancelled enrolments surface in a separate "Pending
// payments" section at the top of the same screen with a Pay Now
// CTA so the student can resume the Razorpay flow. Course content
// (EnrolledCourse) is only reachable via the paid list — the pending
// section only exposes Pay Now, never the course itself.
//
// Empty state renders a friendly nudge to browse academies.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, BookOpen, GraduationCap, Building2, User,
  Calendar, Award, ChevronRight, Clock, CreditCard,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
import DownloadInvoiceButton from '../../components/DownloadInvoiceButton';
import { confirm } from '../../components/ConfirmDialog';
import CourseImage from '../../components/CourseImage';
import { useAuth } from '../../context/AuthContext';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const STATUS_META = {
  paid:    { label: 'Active',   fg: '#065F46', bg: '#D1FAE5' },
  pending: { label: 'Pending',  fg: '#92400E', bg: '#FEF3C7' },
  failed:  { label: 'Failed',   fg: '#991B1B', bg: '#FEE2E2' },
};

// Belt-colour resolver — first colour word wins so "Blue II" and
// "Brown III" still get their canonical swatch. Keeps the belt chip
// consistent with the Belt Journey screen.
const BELT_COLOR_BY_KEY = {
  white:  '#FFFFFF', yellow: '#F59E0B', orange: '#F97316', green:  '#22C55E',
  blue:   '#3B82F6', gray:   '#9CA3AF', grey:   '#9CA3AF', brown:  '#A16207',
  black:  '#0F172A', red:    '#DC2626', purple: '#8B5CF6',
};
function beltSwatch(label) {
  const first = String(label || '').trim().toLowerCase().split(/\s+/)[0];
  return BELT_COLOR_BY_KEY[first] || palette.borderSoft;
}

export default function StudentEnrolledProgramsScreen({ navigation }) {
  // Logged-in student — used for the /curriculum-progress query
  // string. The backend rejects the request with 400 when
  // student_id is missing (see curriculum.controller#getProgress),
  // which is why the previous version showed 0% on every card.
  const { user } = useAuth();
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progressById, setProgressById] = useState({});
  const [beltName, setBeltName] = useState(null);

  const load = useCallback(async () => {
    try {
      // /belts/my-journey is the STUDENT convenience alias for
      // /belts/journey/:studentId. The old code hit /belts/journey
      // (no id) which 404s → beltName stayed null and the card fell
      // back to batch_name, which read like the wrong belt. Backend
      // journey already picks the latest approved belt via
      // belt_history so this always reflects the current rank
      // (updates the moment the institution approves a promotion).
      const [enrolls, journey] = await Promise.all([
        apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } })),
        apiClient.get('/belts/my-journey').catch(() => ({ data: null })),
      ]);
      const list = enrolls.data?.enrollments || [];
      setRows(list);
      setBeltName(journey.data?.current_belt?.name || null);

      // Best-effort curriculum progress per unique course. Only fetch
      // for PAID rows — pending / failed enrolments don't grant
      // access to lessons, so their progress is by definition 0/0
      // and asking the backend would just spam useless requests.
      //
      // student_id IS required by the backend — omitting it 400s and
      // the card fell back to done=0/total=0, which is why every
      // program used to render "0%" even after the student had
      // completed lessons. We now pull the logged-in student id from
      // auth context and pass it explicitly.
      const studentId = user?.id;
      const uniqueCourses = Array.from(new Set(
        list
          .filter((e) => e.payment_status === 'paid')
          .map((e) => e.course_id)
          .filter(Boolean),
      ));
      const progResults = studentId
        ? await Promise.all(
            uniqueCourses.map((cid) =>
              apiClient
                .get(`/curriculum-progress?course_id=${cid}&student_id=${studentId}`)
                .then((r) => ({
                  cid,
                  done:  r.data?.progress?.length || 0,
                  total: r.data?.lessons?.length  || 0,
                }))
                .catch(() => ({ cid, done: 0, total: 0 })),
            ),
          )
        : [];
      const byCid = {};
      progResults.forEach((p) => { byCid[p.cid] = p; });
      setProgressById(byCid);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  // Split rows into paid (grants access to course content) vs pending
  // / failed / cancelled (only exposes Pay Now). Cancelled and any
  // unrecognised payment_status fall into the pending bucket so the
  // student can always see and resume the payment.
  const paidRows    = React.useMemo(
    () => rows.filter((r) => r.payment_status === 'paid'),
    [rows],
  );
  const pendingRows = React.useMemo(
    () => rows.filter((r) => r.payment_status !== 'paid'),
    [rows],
  );

  // Hand the row off to EnrollmentPaymentScreen — same payload shape
  // it expects on the happy path from the enrolment form so it can
  // render the summary card and open Razorpay.
  const handlePayNow = (row) => {
    const amount = Number(row.payment_amount) || Number(row.course_price) || 0;
    if (amount <= 0) {
      confirm({
        title:       'No amount to pay',
        message:     'This enrolment has no price set. Please contact your academy.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }
    const payload = {
      enrollment: { id: row.id, payment_amount: amount },
      batch: {
        id:              row.batch_id,
        name:            row.batch_name,
        course_id:       row.course_id,
        course_name:     row.course_name,
        course_price:    row.course_price,
        institution_name:row.institution_name,
        days_of_week:    row.days_of_week,
        start_time:      row.start_time,
        end_time:        row.end_time,
      },
      course: {
        id:               row.course_id,
        name:             row.course_name,
        price:            row.course_price,
        institution_name: row.institution_name,
      },
      amount,
    };
    try {
      navigation.navigate('EnrollmentPayment', payload);
    } catch (_) {
      try { navigation.getParent()?.navigate('EnrollmentPayment', payload); } catch (_) {}
    }
  };
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Enrolled Programs</Text>
          <Text style={styles.subtitle}>
            {paidRows.length === 0
              ? (pendingRows.length > 0 ? 'Complete payment to activate' : 'None yet')
              : `${paidRows.length} active program${paidRows.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (paidRows.length === 0 && pendingRows.length === 0) ? (
        <View style={styles.emptyCard}>
          <GraduationCap size={40} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No enrollments yet</Text>
          <Text style={styles.emptySub}>
            Explore academies from the Home tab and pick a course to enrol.
          </Text>
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
          {/* ── Pending payments — only Pay Now is exposed, never the
              course itself. A row can only cross into the paid list
              below once the Razorpay webhook has flipped its
              payment_status server-side. */}
          {pendingRows.length > 0 && (
            <View style={{ marginBottom: spacing.lg }}>
              <View style={styles.sectionHeaderRow}>
                <Clock size={14} color={palette.textMuted} strokeWidth={2.4} />
                <Text style={styles.sectionHeaderText}>Pending payments</Text>
              </View>
              <Text style={styles.sectionHint}>
                These enrolments will move to your active list once payment
                is successful.
              </Text>
              {pendingRows.map((row) => (
                <PendingCard
                  key={row.id}
                  row={row}
                  onPayNow={() => handlePayNow(row)}
                />
              ))}
            </View>
          )}

          {/* ── Active (paid) programs — the only entry point that can
              route into EnrolledCourse and unlock lessons, videos,
              curriculum progress, certificates, etc. */}
          {paidRows.length > 0 && (
            <>
              {pendingRows.length > 0 && (
                <View style={styles.sectionHeaderRow}>
                  <GraduationCap size={14} color={palette.textMuted} strokeWidth={2.4} />
                  <Text style={styles.sectionHeaderText}>Active programs</Text>
                </View>
              )}
              {paidRows.map((row) => (
                <ProgramCard
                  key={row.id}
                  row={row}
                  beltName={beltName}
                  progress={progressById[row.course_id]}
                  onPress={() => navigation.navigate('EnrolledCourse', { enrollmentId: row.id })}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Pending payment card ───────────────────────────────────────────
// Reduced-affordance row for a not-yet-paid enrolment. Deliberately
// does NOT route into EnrolledCourse — only the Pay Now button is
// interactive. Once the Razorpay webhook flips the row to paid, it
// disappears from here and shows up in the active list above.
function PendingCard({ row, onPayNow }) {
  const amount = Number(row.payment_amount) || Number(row.course_price) || 0;
  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingHead}>
        <View style={styles.pendingIcon}>
          <BookOpen size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingCourse} numberOfLines={1}>
            {row.course_name || 'Course'}
          </Text>
          <Text style={styles.pendingAcademy} numberOfLines={1}>
            {row.institution_name || 'Academy'}
            {row.batch_name ? ` · ${row.batch_name}` : ''}
          </Text>
        </View>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>
            {row.payment_status === 'failed' ? 'FAILED' : 'PENDING'}
          </Text>
        </View>
      </View>

      <View style={styles.pendingFooter}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pendingAmountLabel}>Amount due</Text>
          <Text style={styles.pendingAmount}>
            {amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : '—'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.payNowBtn}
          onPress={onPayNow}
          activeOpacity={0.85}
        >
          <CreditCard size={14} color="#fff" strokeWidth={2.4} />
          <Text style={styles.payNowBtnText}>Pay Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Course thumbnail with fallback ladder ────────────────────────
// Ladder:
//   1. course.image_url (if present + loads)
//   2. institution.logo_url (if present + loads)
//   3. Branded purple placeholder tile with the BookOpen icon
//
// resolveAssetUrl handles the emulator / prod host swap and legacy
// embedded hosts (10.0.2.2, localhost, 127.0.0.1). We track two
// separate error flags so a broken course image cleanly downgrades to
// the institution logo rather than skipping straight to the icon.
// A tiny spinner shows while the image is loading so a slow network
// doesn't leave the card looking blank.
function CourseThumb({ courseImage, institutionLogo }) {
  // Prefer the course cover; fall back to the institution logo. The
  // shared CourseImage handles the resolve + contain-fit + placeholder
  // for us, so the ladder here is just "which source do we hand off".
  const primary = courseImage || institutionLogo || null;
  return (
    <View style={styles.thumbWrap}>
      <CourseImage
        uri={primary}
        width="100%"
        height="100%"
        radius={0}
        fit="contain"
        icon="course"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function ProgramCard({ row, beltName, progress, onPress }) {
  const statusMeta = STATUS_META[row.payment_status] || STATUS_META.pending;
  const total = progress?.total || 0;
  const done  = progress?.done  || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={styles.card}>
      <View style={styles.cardHead}>
        <CourseThumb
          courseImage={row.course_image_url}
          institutionLogo={row.institution_logo_url}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.courseName} numberOfLines={1}>{row.course_name}</Text>
          <View style={styles.metaRow}>
            <Building2 size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.metaText} numberOfLines={1}>
              {row.institution_name || '—'}
            </Text>
          </View>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
          <Text style={[styles.statusPillText, { color: statusMeta.fg }]}>{statusMeta.label}</Text>
        </View>
      </View>

      {/* ── Belt badge row ─────────────────────────────────────
          Prominent coloured chip for the student's CURRENT belt
          (fetched from /belts/my-journey → current_belt, which the
          backend keeps in sync with the latest approved promotion).
          Renders even without a promotion — the student's initial
          enrolment belt shows here until the first approval. */}
      {beltName ? (
        <View style={styles.beltBadgeRow}>
          <View style={styles.beltBadge}>
            <View
              style={[
                styles.beltBadgeDot,
                {
                  backgroundColor: beltSwatch(beltName),
                  borderColor: beltSwatch(beltName).toLowerCase() === '#ffffff'
                    ? '#D1D5DB' : beltSwatch(beltName),
                },
              ]}
            />
            <Text style={styles.beltBadgeText} numberOfLines={1}>{beltName}</Text>
          </View>
          <Text style={styles.beltBadgeCaption}>Current belt</Text>
        </View>
      ) : null}

      {/* Meta grid — Trainer / Batch on row 1, Enrolled date on
          row 2 (full-width). Removed the "Lessons" tile per spec;
          per-lesson counts now live only in the caption under the
          progress bar so there's no duplicate. */}
      <View style={styles.detailGrid}>
        <Detail
          icon={User}
          label="Trainer"
          value={row.trainer_name || 'To be assigned'}
        />
        <Detail
          icon={BookOpen}
          label="Batch"
          value={row.batch_name || '—'}
        />
      </View>
      <View style={{ marginTop: 4 }}>
        <Detail
          icon={Calendar}
          label="Enrolled"
          value={fmtDate(row.enrolled_at)}
        />
      </View>

      {/* ── Progress bar ────────────────────────────────────────
          Curriculum completion — real numbers from
          /curriculum-progress. Refreshes on every screen focus so a
          just-ticked lesson (in EnrolledCourse) reflects immediately
          when the student swipes back here. */}
      <View style={styles.progressBlock}>
        <View style={styles.progressHead}>
          <Text style={styles.progressLabel}>Curriculum progress</Text>
          <Text style={[
            styles.progressValue,
            pct >= 100 && { color: palette.green.vivid },
          ]}>
            {total > 0 ? `${pct}%` : '—'}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${pct}%`, backgroundColor: pct >= 100 ? palette.green.vivid : palette.purple.vivid },
            ]}
          />
        </View>
        {total > 0 ? (
          <Text style={styles.progressSubtle}>
            {done} of {total} lesson{total === 1 ? '' : 's'} completed
          </Text>
        ) : null}
      </View>

      {/* Download Invoice — only shows on paid enrolments. Backend
          returns 404 for pending / offline-not-yet-invoiced rows and
          the button surfaces a friendly hint instead of erroring. */}
      {row.payment_status === 'paid' ? (
        <View style={styles.invoiceRow}>
          <DownloadInvoiceButton kind="enrollment" refId={row.id} compact />
        </View>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Open</Text>
        <ChevronRight size={13} color={palette.purple.vivid} strokeWidth={2.6} />
      </View>
    </TouchableOpacity>
  );
}

function Detail({ icon: Icon, label, value }) {
  return (
    <View style={styles.detailBox}>
      <View style={styles.detailLabelRow}>
        <Icon size={10} color={palette.textMuted} strokeWidth={2.4} />
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
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
    ...shadows.card,
    gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  emptyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    backgroundColor: palette.surface, borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // ── Section header (Pending / Active) ─────────────────────────────
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 4, marginTop: spacing.xs,
  },
  sectionHeaderText: {
    ...type.caption, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  sectionHint: {
    ...type.caption, color: palette.textMuted,
    marginBottom: spacing.sm,
  },

  // ── Pending payment card ──────────────────────────────────────────
  pendingCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: '#FED7AA',
    ...shadows.card,
  },
  pendingHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginBottom: spacing.sm,
  },
  pendingIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingCourse: { ...type.bodyBold, color: palette.text },
  pendingAcademy: {
    ...type.caption, color: palette.textMuted, marginTop: 2,
  },
  pendingBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
  },
  pendingBadgeText: {
    fontSize: 10, fontWeight: '900', color: '#92400E',
    letterSpacing: 0.6,
  },
  pendingFooter: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
    gap: spacing.md,
  },
  pendingAmountLabel: {
    ...type.caption, color: palette.textMuted, fontWeight: '700',
  },
  pendingAmount: {
    ...type.bodyBold, color: palette.text, marginTop: 2, fontSize: 16,
  },
  payNowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: radius.md,
  },
  payNowBtnText: {
    color: '#fff', fontWeight: '800', fontSize: 13,
  },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  // Course thumbnail — same 40×40 footprint as iconTile so the header
  // stays visually aligned across cards with and without images.
  thumbWrap: {
    width: 44, height: 44, borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: palette.borderSoft,   // shows through if the PNG has alpha
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%' },
  thumbSpinner: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  thumbPlaceholder: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  courseName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { ...type.micro, color: palette.textMuted, fontWeight: '700', flexShrink: 1 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  detailGrid: {
    flexDirection: 'row', gap: 6,
    marginTop: spacing.md,
  },
  detailBox: {
    flex: 1,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  detailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  detailValue: {
    ...type.bodyBold, color: palette.text, fontSize: 12,
    marginTop: 3,
  },

  invoiceRow: { marginTop: spacing.md },

  // ── Belt badge (current-belt chip on the card) ──────────────
  beltBadgeRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  beltBadge: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8,
    paddingLeft: 8, paddingRight: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  beltBadgeDot: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 1.5,
  },
  beltBadgeText: {
    ...type.body, color: palette.text, fontWeight: '800', fontSize: 13,
  },
  beltBadgeCaption: {
    ...type.micro, color: palette.textLight,
    letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: '700',
  },

  progressBlock: { marginTop: spacing.md },
  progressHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  progressValue: {
    ...type.body, color: palette.text, fontWeight: '900', fontSize: 15,
  },
  progressTrack: {
    height: 8, borderRadius: 4,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4 },
  progressSubtle: {
    ...type.micro, color: palette.textMuted, marginTop: 6,
    fontWeight: '600',
  },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    marginTop: spacing.md, gap: 3,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  footerText: { ...type.micro, color: palette.purple.vivid, fontWeight: '800' },
});
