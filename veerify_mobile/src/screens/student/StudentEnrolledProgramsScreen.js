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
// Empty state renders a friendly nudge to browse academies.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, BookOpen, GraduationCap, Building2, User,
  Calendar, Award, ChevronRight,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
import DownloadInvoiceButton from '../../components/DownloadInvoiceButton';

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

export default function StudentEnrolledProgramsScreen({ navigation }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progressById, setProgressById] = useState({});
  const [beltName, setBeltName] = useState(null);

  const load = useCallback(async () => {
    try {
      const [enrolls, journey] = await Promise.all([
        apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } })),
        apiClient.get('/belts/journey').catch(() => ({ data: null })),
      ]);
      const list = enrolls.data?.enrollments || [];
      setRows(list);
      setBeltName(journey.data?.current_belt?.name || null);

      // Best-effort curriculum progress per unique course. Failures
      // (no curriculum, network hiccup) collapse to 0/0 so the UI
      // shows an empty bar instead of throwing.
      const uniqueCourses = Array.from(new Set(list.map((e) => e.course_id).filter(Boolean)));
      const progResults = await Promise.all(
        uniqueCourses.map((cid) =>
          apiClient.get(`/curriculum-progress?course_id=${cid}`)
            .then((r) => ({ cid, done: r.data?.progress?.length || 0, total: r.data?.lessons?.length || 0 }))
            .catch(() => ({ cid, done: 0, total: 0 })),
        ),
      );
      const byCid = {};
      progResults.forEach((p) => { byCid[p.cid] = p; });
      setProgressById(byCid);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
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
            {rows.length === 0 ? 'None yet' : `${rows.length} program${rows.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : rows.length === 0 ? (
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
          {rows.map((row) => (
            <ProgramCard
              key={row.id}
              row={row}
              beltName={beltName}
              progress={progressById[row.course_id]}
              onPress={() => navigation.navigate('EnrolledCourse', { enrollmentId: row.id })}
            />
          ))}
        </ScrollView>
      )}
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
  const [loading, setLoading] = React.useState(true);
  const [courseErr, setCourseErr] = React.useState(false);
  const [logoErr,   setLogoErr]   = React.useState(false);

  const courseUrl = courseImage && !courseErr ? resolveAssetUrl(courseImage) : null;
  const logoUrl   = institutionLogo && !logoErr ? resolveAssetUrl(institutionLogo) : null;
  const src = courseUrl || logoUrl || null;

  if (!src) {
    return (
      <View style={styles.thumbPlaceholder}>
        <BookOpen size={18} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
    );
  }

  return (
    <View style={styles.thumbWrap}>
      <Image
        source={{ uri: src }}
        style={styles.thumb}
        resizeMode="cover"
        onLoadStart={() => setLoading(true)}
        onLoadEnd={()   => setLoading(false)}
        onError={() => {
          setLoading(false);
          // Downgrade: fail the current step in the ladder so the
          // next render tries the next source.
          if (src === courseUrl) setCourseErr(true);
          else                    setLogoErr(true);
        }}
      />
      {loading ? (
        <View style={styles.thumbSpinner}>
          <ActivityIndicator size="small" color={palette.purple.vivid} />
        </View>
      ) : null}
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

      <View style={styles.detailGrid}>
        <Detail
          icon={User}
          label="Trainer"
          value={row.trainer_name || 'To be assigned'}
        />
        <Detail
          icon={Award}
          label="Belt / Level"
          value={beltName || row.batch_name || '—'}
        />
      </View>
      <View style={[styles.detailGrid, { marginTop: 4 }]}>
        <Detail
          icon={Calendar}
          label="Enrolled"
          value={fmtDate(row.enrolled_at)}
        />
        <Detail
          icon={BookOpen}
          label="Batch"
          value={row.batch_name || '—'}
        />
      </View>

      {/* Progress bar */}
      <View style={styles.progressBlock}>
        <View style={styles.progressHead}>
          <Text style={styles.progressLabel}>Curriculum progress</Text>
          <Text style={styles.progressValue}>
            {total > 0 ? `${done}/${total} · ${pct}%` : '—'}
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

  progressBlock: { marginTop: spacing.md },
  progressHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  progressLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  progressValue: {
    ...type.micro, color: palette.text, fontWeight: '800',
  },
  progressTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    marginTop: spacing.md, gap: 3,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  footerText: { ...type.micro, color: palette.purple.vivid, fontWeight: '800' },
});
