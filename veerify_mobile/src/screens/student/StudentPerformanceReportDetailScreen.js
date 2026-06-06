// src/screens/student/StudentPerformanceReportDetailScreen.js
//
// Read-only view of a single performance report. Receives either the full
// report row via route.params.report (from the list) or just a report_id
// (from a deep-linked notification tap).

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Linking, Image,
} from 'react-native';
import {
  ArrowLeft, Star, Award, Calendar, CheckCircle2, Target,
  ClipboardCheck, FileText, MessageCircle, PlayCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const RATING_LABELS = {
  discipline_rating: 'Discipline',
  attendance_rating: 'Attendance',
  technique_rating:  'Technique',
  fitness_rating:    'Fitness',
  sparring_rating:   'Sparring',
  behaviour_rating:  'Focus & Behaviour',
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function StudentPerformanceReportDetailScreen({ navigation, route }) {
  const initial = route?.params?.report || null;
  const reportId = route?.params?.report_id || initial?.id;

  const [report, setReport] = useState(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return;
    if (!reportId) return;
    (async () => {
      try {
        const res = await apiClient.get(`/performance-reports/${reportId}`);
        setReport(res.data?.report || null);
      } catch (err) {
        console.log('[ReportDetail] load error:', err?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [reportId, initial]);

  if (loading || !report) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        {loading ? <ActivityIndicator color={palette.purple.vivid} />
                 : <Text>Report not available.</Text>}
      </View>
    );
  }

  const ratings = Object.keys(RATING_LABELS)
    .map((k) => ({ key: k, label: RATING_LABELS[k], value: Number(report[k]) || 0 }))
    .filter((r) => r.value > 0);

  const goals = Array.isArray(report.next_goals)
    ? report.next_goals
    : (typeof report.next_goals === 'string' ? safeParse(report.next_goals) : []);

  const media = Array.isArray(report.media_urls)
    ? report.media_urls
    : (typeof report.media_urls === 'string' ? safeParse(report.media_urls) : []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Performance Report</Text>
          <Text style={styles.headerSubtitle}>
            {fmtDate(report.report_date)}
            {report.trainer_name ? ` · by ${report.trainer_name}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Award size={22} color="#fff" strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{report.course_name || 'Performance Update'}</Text>
            {report.batch_name ? (
              <Text style={styles.heroSubtitle}>{report.batch_name}</Text>
            ) : null}
            {report.belt_level ? (
              <View style={styles.beltPill}>
                <Text style={styles.beltText}>{report.belt_level}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Ratings */}
        {ratings.length > 0 ? (
          <SectionCard title="Ratings" icon={Star}>
            {ratings.map((r) => (
              <View key={r.key} style={styles.ratingRow}>
                <Text style={styles.ratingLabel}>{r.label}</Text>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={16}
                      color={n <= r.value ? '#F59E0B' : palette.borderSoft}
                      fill={n <= r.value ? '#F59E0B' : 'transparent'}
                      strokeWidth={2}
                    />
                  ))}
                </View>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {/* Strengths */}
        {report.strengths ? (
          <SectionCard title="Strengths" icon={CheckCircle2} accent={palette.green}>
            <Text style={styles.bodyText}>{report.strengths}</Text>
          </SectionCard>
        ) : null}

        {/* Areas for improvement */}
        {report.improvements ? (
          <SectionCard title="Areas for improvement" icon={Target} accent={palette.orange}>
            <Text style={styles.bodyText}>{report.improvements}</Text>
          </SectionCard>
        ) : null}

        {/* Trainer remarks */}
        {report.trainer_remarks ? (
          <SectionCard title="Trainer remarks" icon={MessageCircle}>
            <Text style={styles.bodyText}>{report.trainer_remarks}</Text>
          </SectionCard>
        ) : null}

        {/* Next goals */}
        {goals.length > 0 ? (
          <SectionCard title="Next goals" icon={Target} accent={palette.purple}>
            {goals.map((g, i) => (
              <View key={i} style={styles.goalRow}>
                <View style={styles.goalDot} />
                <Text style={styles.goalText}>{g}</Text>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {/* Attendance summary */}
        {report.classes_attended != null || report.classes_missed != null ? (
          <SectionCard title="Attendance" icon={ClipboardCheck} accent={palette.blue}>
            <View style={styles.attendanceRow}>
              <AttendanceBlock label="Attended" value={report.classes_attended} color={palette.green.vivid} />
              <AttendanceBlock label="Missed"   value={report.classes_missed}   color={palette.rose.vivid} />
            </View>
          </SectionCard>
        ) : null}

        {/* Media */}
        {media.length > 0 ? (
          <SectionCard title="Media" icon={FileText}>
            <View style={{ gap: 8 }}>
              {media.map((m, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.mediaCard}
                  onPress={() => m.url && Linking.openURL(m.url).catch(() => {})}
                  activeOpacity={0.85}
                >
                  {m.kind === 'image' ? (
                    <Image source={{ uri: m.url }} style={styles.mediaImage} />
                  ) : (
                    <View style={styles.mediaVideo}>
                      <PlayCircle size={26} color="#fff" strokeWidth={2.4} />
                    </View>
                  )}
                  <Text style={styles.mediaUrl} numberOfLines={1}>{m.url}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </SectionCard>
        ) : null}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function safeParse(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

function SectionCard({ title, icon: Icon, accent = palette.purple, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: accent.soft }]}>
          <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function AttendanceBlock({ label, value, color }) {
  return (
    <View style={styles.attendanceBlock}>
      <Text style={[styles.attendanceValue, { color }]}>{value ?? '—'}</Text>
      <Text style={styles.attendanceLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48, paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 11, color: palette.textLight, marginTop: 1 },

  scrollContent: { padding: spacing.xl },

  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: palette.purple.vivid,
    padding: 16,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 16, color: '#fff', fontWeight: '800' },
  heroSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  beltPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  beltText: { fontSize: 11, color: '#fff', fontWeight: '800' },

  section: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    ...shadows.soft,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
  },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: palette.dark },

  ratingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 6,
  },
  ratingLabel: { fontSize: 13, color: palette.text, fontWeight: '600' },

  bodyText: { fontSize: 13, color: palette.text, lineHeight: 19 },

  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  goalDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: palette.purple.vivid,
  },
  goalText: { flex: 1, fontSize: 13, color: palette.text },

  attendanceRow: { flexDirection: 'row', gap: 10 },
  attendanceBlock: {
    flex: 1,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  attendanceValue: { fontSize: 22, fontWeight: '800' },
  attendanceLabel: { fontSize: 11, color: palette.textLight, marginTop: 2, fontWeight: '700' },

  mediaCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: palette.surfaceAlt,
  },
  mediaImage: { width: '100%', height: 160 },
  mediaVideo: {
    width: '100%', height: 140,
    backgroundColor: palette.dark,
    alignItems: 'center', justifyContent: 'center',
  },
  mediaUrl: { fontSize: 11, color: palette.textLight, padding: 8 },
});
