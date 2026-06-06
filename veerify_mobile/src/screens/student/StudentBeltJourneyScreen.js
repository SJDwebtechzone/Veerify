// src/screens/student/StudentBeltJourneyScreen.js
//
// Belt Badges & Certifications — student/parent view.
//
// Layout:
//   1. Hero — current belt with the big colored chip + emoji
//   2. Achievement summary tiles (belts earned, certificates, progress %)
//   3. Belt journey list — each belt with completed/current/locked status
//   4. Recent certificates grid — tap to open detail
//   5. Timeline — chronological feed of promotions + cert issuances
//
// Route params: { student_id?, student_name? } — when supplied, used for
// the parent flow viewing a child. Defaults to the logged-in student.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, Lock, CheckCircle2, Star, FileText, Calendar,
  TrendingUp, ChevronRight, Trophy,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function StudentBeltJourneyScreen({ navigation, route }) {
  const studentIdParam = route?.params?.student_id || null;
  const studentNameParam = route?.params?.student_name || null;

  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const url = studentIdParam
        ? `/belts/journey/${studentIdParam}`
        : '/belts/my-journey';
      const res = await apiClient.get(url);
      setData(res.data || null);
    } catch (err) {
      console.log('[BeltJourney] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentIdParam]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={palette.purple.vivid} />
      </View>
    );
  }

  const { belts = [], current_belt: current, certificates = [], summary = {}, timeline = [] } = data;
  const totalBelts = belts.length || 1;
  const completed = belts.filter((b) => b.status === 'completed' || b.status === 'current').length;
  const progressPct = Math.round((completed / totalBelts) * 100);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Belt Journey</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {studentNameParam || data.student?.name || 'Your progress'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Hero — current belt */}
        <View style={styles.hero}>
          <View style={styles.heroBlobA} />
          <View style={styles.heroBlobB} />
          <View style={styles.heroRow}>
            <View
              style={[
                styles.heroBeltChip,
                { backgroundColor: current?.color_hex || '#FFFFFF' },
              ]}
            >
              <Text style={styles.heroBeltEmoji}>{current?.emoji || '🥋'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>CURRENT BELT</Text>
              <Text style={styles.heroBeltName}>
                {current ? current.name : 'No belt yet'}
              </Text>
              {current?.earned_at ? (
                <Text style={styles.heroEarned}>Earned {fmtDate(current.earned_at)}</Text>
              ) : (
                <Text style={styles.heroEarned}>Your first belt is coming soon!</Text>
              )}
            </View>
          </View>
        </View>

        {/* Achievement summary */}
        <View style={styles.summaryRow}>
          <SummaryTile
            icon={Award}
            label="Belts Earned"
            value={summary.belts_earned || 0}
            accent={palette.purple}
          />
          <SummaryTile
            icon={FileText}
            label="Certificates"
            value={summary.certificates || 0}
            accent={palette.green}
          />
          <SummaryTile
            icon={TrendingUp}
            label="Progress"
            value={`${progressPct}%`}
            accent={palette.orange}
          />
        </View>

        {/* Belt journey */}
        <Text style={styles.sectionTitle}>Belt Journey</Text>
        <View style={styles.journeyCard}>
          {belts.map((b, i) => (
            <BeltRow
              key={b.id}
              belt={b}
              isFirst={i === 0}
              isLast={i === belts.length - 1}
            />
          ))}
        </View>

        {/* Certificates */}
        <Text style={styles.sectionTitle}>Certificates</Text>
        {certificates.length === 0 ? (
          <View style={styles.emptyCert}>
            <FileText size={24} color={palette.textLight} />
            <Text style={styles.emptyText}>No certificates yet.</Text>
          </View>
        ) : (
          certificates.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.certCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CertificateDetail', { certificate: c })}
            >
              <View style={styles.certIcon}>
                <Trophy
                  size={18}
                  color={c.kind === 'tournament' ? palette.orange.vivid : palette.purple.vivid}
                  strokeWidth={2.4}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.certTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.certMeta}>
                  {fmtDate(c.issue_date)} · #{c.certificate_no}
                </Text>
              </View>
              <View style={[
                styles.certStatus,
                c.status === 'verified' ? styles.certVerified : styles.certRevoked,
              ]}>
                <CheckCircle2 size={11} color={c.status === 'verified' ? '#15803D' : '#991B1B'} strokeWidth={2.4} />
                <Text style={[
                  styles.certStatusText,
                  { color: c.status === 'verified' ? '#15803D' : '#991B1B' },
                ]}>
                  {c.status === 'verified' ? 'VERIFIED' : 'REVOKED'}
                </Text>
              </View>
              <ChevronRight size={16} color={palette.textLight} />
            </TouchableOpacity>
          ))
        )}

        {/* Timeline */}
        {timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timelineCard}>
              {timeline.map((t, i) => (
                <View key={`${t.kind}-${i}`} style={styles.timelineRow}>
                  <View style={styles.timelineDot}>
                    <Text style={{ fontSize: 14 }}>{t.emoji || '•'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timelineTitle}>{t.title}</Text>
                    <Text style={styles.timelineDate}>{fmtDate(t.date)}</Text>
                    {t.notes ? (
                      <Text style={styles.timelineNotes} numberOfLines={2}>{t.notes}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function SummaryTile({ icon: Icon, label, value, accent }) {
  return (
    <View style={[styles.summaryTile, { borderColor: accent.soft }]}>
      <View style={[styles.summaryIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function BeltRow({ belt, isLast }) {
  const isCurrent   = belt.status === 'current';
  const isCompleted = belt.status === 'completed';
  const isLocked    = belt.status === 'locked';
  return (
    <View style={styles.beltRow}>
      <View style={styles.beltDotCol}>
        <View
          style={[
            styles.beltChip,
            { backgroundColor: belt.color_hex },
            isLocked && { opacity: 0.4 },
          ]}
        >
          <Text style={styles.beltChipEmoji}>{belt.emoji || '🥋'}</Text>
        </View>
        {!isLast ? <View style={[styles.beltConnector, isLocked && { opacity: 0.4 }]} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.beltName, isLocked && styles.beltNameLocked]}>{belt.name}</Text>
        {isCompleted ? (
          <View style={styles.beltStatusRow}>
            <CheckCircle2 size={11} color={palette.green.vivid} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.green.vivid }]}>
              Completed · {fmtDate(belt.earned_at)}
            </Text>
          </View>
        ) : isCurrent ? (
          <View style={styles.beltStatusRow}>
            <Star size={11} color={palette.purple.vivid} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.purple.vivid }]}>
              Current{belt.earned_at ? ` · earned ${fmtDate(belt.earned_at)}` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.beltStatusRow}>
            <Lock size={11} color={palette.textLight} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.textLight }]}>
              Locked
            </Text>
          </View>
        )}
      </View>
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
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },

  scrollContent: { padding: spacing.xl },

  hero: {
    overflow: 'hidden',
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: 16,
    marginBottom: spacing.lg,
    ...shadows.raised,
  },
  heroBlobA: {
    position: 'absolute', top: -30, right: -20,
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroBlobB: {
    position: 'absolute', bottom: -40, left: -20,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroBeltChip: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
  },
  heroBeltEmoji: { fontSize: 30 },
  heroEyebrow: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1 },
  heroBeltName: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  heroEarned: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  summaryTile: {
    flex: 1, backgroundColor: palette.surface,
    borderRadius: radius.lg, padding: 12,
    borderWidth: 1,
  },
  summaryIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: { fontSize: 18, fontWeight: '800', color: palette.dark },
  summaryLabel: { fontSize: 10, color: palette.textLight, marginTop: 2, fontWeight: '700' },

  sectionTitle: {
    fontSize: 12, color: palette.textLight, fontWeight: '800',
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: 8,
  },

  journeyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    ...shadows.soft,
  },
  beltRow: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  beltDotCol: { alignItems: 'center' },
  beltChip: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  beltChipEmoji: { fontSize: 18 },
  beltConnector: {
    width: 2, flex: 1, backgroundColor: palette.borderSoft,
    marginTop: 4, marginBottom: -4,
  },
  beltName: { fontSize: 14, fontWeight: '700', color: palette.dark, marginTop: 6 },
  beltNameLocked: { color: palette.textLight },
  beltStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 3,
  },
  beltStatusText: { fontSize: 11, fontWeight: '700' },

  certCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 8,
    ...shadows.soft,
  },
  certIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  certTitle: { fontSize: 14, fontWeight: '700', color: palette.dark },
  certMeta: { fontSize: 11, color: palette.textLight, marginTop: 2 },
  certStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999,
  },
  certVerified: { backgroundColor: '#DCFCE7' },
  certRevoked: { backgroundColor: '#FEE2E2' },
  certStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  emptyCert: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  emptyText: { fontSize: 12, color: palette.textLight },

  timelineCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    ...shadows.soft,
  },
  timelineRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  timelineDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineTitle: { fontSize: 13, fontWeight: '700', color: palette.dark },
  timelineDate: { fontSize: 11, color: palette.textLight, marginTop: 1 },
  timelineNotes: { fontSize: 11, color: palette.text, marginTop: 4, lineHeight: 16 },
});
