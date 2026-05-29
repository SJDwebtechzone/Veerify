// src/screens/parent/ChildAchievementsScreen.js
//
// Parent Step 5 - Belt & Achievement.
//
// Layout (top to bottom):
//   1. Header  back, "Achievements" title, child name subtitle.
//   2. Current belt hero  big belt-coloured card with belt label, next belt
//      target, grading eligibility pill (derived from attendance %).
//   3. Belt progression timeline  horizontal scroll with all 7 belts; the
//      ones reached are filled with their strap colour and an Award icon,
//      current is scaled up with a "Current" pill, the next belt has a
//      "Next" pill.
//   4. Certificates  list of certificate cards (placeholder data) with
//      View / Share buttons.
//   5. Tournament achievements + Medals  placeholder card.
//
// Real data:
//   GET /api/parents/children/:id/attendance  -> attendance % for the
//                                                grading-eligibility check.
// Everything else (certificates, tournaments) renders from a small in-memory
// sample list since the backing tables aren't built yet.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Share, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, ChevronRight, ChevronLeft, CheckCircle2,
  AlertTriangle, FileText, Share2, Download, Trophy, Medal,
  Calendar, Star,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Belts (same table the other screens share).
const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltIndexFor = (id) => Math.abs(Number(id) || 0) % BELTS.length;

// Sample certificates / tournament cards until the backend tables ship.
// Stable per student_id (so the same child always sees the same list).
function sampleCertificates(studentId, currentBelt) {
  const seed = Math.abs(Number(studentId) || 0);
  const out = [];
  // Belt grading certificates for every belt up to and including current.
  for (let i = 0; i <= beltIndexFor(studentId); i++) {
    const b = BELTS[i];
    // Use a deterministic date band per belt slot.
    const d = new Date();
    d.setMonth(d.getMonth() - (beltIndexFor(studentId) - i) * 4);
    out.push({
      id: `belt-${i}`,
      kind: 'belt-grading',
      title: `${b.label} Belt Grading`,
      subtitle: `Certified ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`,
      issued_at: d,
      icon: Award,
      bg: b.bg,
      fg: b.fg,
      border: b.border,
    });
  }
  // A general "Year completed" certificate so the list isn't sparse.
  if (seed % 3 !== 0) {
    out.push({
      id: 'year',
      kind: 'milestone',
      title: '1-Year Training Milestone',
      subtitle: 'Awarded for sustained training commitment',
      issued_at: new Date(),
      icon: Star,
      bg: palette.purple.soft,
      fg: palette.purple.on,
      border: palette.purple.vivid,
    });
  }
  return out.reverse(); // newest first
}

function sampleTournaments(studentId) {
  const seed = Math.abs(Number(studentId) || 0);
  if (seed % 4 === 0) return []; // some kids have nothing yet
  const set = [
    { id: 't1', title: 'State Karate Open',     placement: 'Gold',   date: 'Mar 2026', icon: Trophy, color: palette.orange },
    { id: 't2', title: 'Inter-Academy Cup',     placement: 'Silver', date: 'Nov 2025', icon: Medal,  color: palette.blue   },
    { id: 't3', title: 'Junior District Meet',  placement: 'Bronze', date: 'Aug 2025', icon: Medal,  color: palette.rose   },
  ];
  return set.slice(0, (seed % 3) + 1);
}

export default function ChildAchievementsScreen({ navigation, route }) {
  const { activeChild } = useChild();
  const childId = route?.params?.childId ?? activeChild?.child_id ?? null;
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); setRefreshing(false); return; }
    try {
      const res = await apiClient.get(`/parents/children/${childId}/attendance`)
        .catch(() => ({ data: { attendance: [] } }));
      setRecords(res.data?.attendance || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const beltIdx = beltIndexFor(childId);
  const currentBelt = BELTS[beltIdx];
  const nextBelt = beltIdx + 1 < BELTS.length ? BELTS[beltIdx + 1] : null;

  // Attendance % drives grading eligibility:
  //   >= 85%  -> Eligible
  //   65-84%  -> Almost there
  //   < 65%   -> Not yet
  const attendancePct = useMemo(() => {
    const total = records.length;
    if (total === 0) return null;
    const present = records.filter((r) => r.status === 'present').length;
    return Math.round((present / total) * 100);
  }, [records]);

  const eligibility = useMemo(() => {
    if (attendancePct === null) return { state: 'unknown', label: 'Not enough data', color: palette.purple };
    if (attendancePct >= 85)    return { state: 'eligible',     label: 'Eligible for grading',  color: palette.green };
    if (attendancePct >= 65)    return { state: 'almost',       label: 'Almost there',          color: palette.orange };
    return                         { state: 'not_eligible', label: 'Not yet eligible',      color: palette.rose };
  }, [attendancePct]);

  const certificates = useMemo(() => sampleCertificates(childId, currentBelt), [childId, currentBelt]);
  const tournaments  = useMemo(() => sampleTournaments(childId), [childId]);

  // ── Actions ──
  const shareCertificate = async (cert) => {
    try {
      const lines = [
        'VEERIFY CERTIFICATE',
        '────────────────',
        `Awarded to: ${childName}`,
        `Title:      ${cert.title}`,
        cert.subtitle ? `Note:       ${cert.subtitle}` : '',
        '────────────────',
        'Issued by Veerify Martial Arts Academy.',
      ].filter(Boolean).join('\n');
      await Share.share({ message: lines, title: cert.title });
    } catch (err) {
      Alert.alert('Could not share', err.message || 'Try again.');
    }
  };
  const downloadCertificate = () => {
    Alert.alert(
      'Coming soon',
      'PDF download lands when we wire up the certificate-generation service.',
    );
  };
  const viewCertificate = (cert) => {
    Alert.alert(
      cert.title,
      `${childName}\n\n${cert.subtitle || ''}\n\nIssued by Veerify Martial Arts Academy.`,
    );
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Achievements</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{childName}</Text>
        </View>
        <View style={styles.headerPill}>
          <Trophy size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{certificates.length + tournaments.length}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Current belt hero */}
        <View style={[
          styles.beltHero,
          { backgroundColor: currentBelt.bg, borderColor: currentBelt.border },
        ]}>
          <View style={[
            styles.beltHeroIcon,
            { backgroundColor: currentBelt.fg === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : currentBelt.border + '30' },
          ]}>
            <Award
              size={32}
              color={currentBelt.fg === '#FFFFFF' ? '#fff' : currentBelt.fg}
              strokeWidth={2.4}
            />
          </View>
          <Text style={[styles.beltHeroEyebrow, { color: currentBelt.fg === '#FFFFFF' ? 'rgba(255,255,255,0.85)' : palette.textMuted }]}>
            CURRENT BELT
          </Text>
          <Text style={[styles.beltHeroValue, { color: currentBelt.fg === '#FFFFFF' ? '#fff' : currentBelt.fg }]}>
            {currentBelt.label} Belt
          </Text>

          {/* Grading eligibility pill */}
          <View style={[styles.eligibilityPill, { backgroundColor: eligibility.color.soft, borderColor: eligibility.color.vivid }]}>
            {eligibility.state === 'eligible' ? (
              <CheckCircle2 size={12} color={eligibility.color.on} strokeWidth={2.4} />
            ) : (
              <AlertTriangle size={12} color={eligibility.color.on} strokeWidth={2.4} />
            )}
            <Text style={[styles.eligibilityText, { color: eligibility.color.on }]}>
              {eligibility.label}
              {attendancePct !== null ? ` · ${attendancePct}%` : ''}
            </Text>
          </View>

          {nextBelt ? (
            <Text style={[styles.beltHeroNext, { color: currentBelt.fg === '#FFFFFF' ? 'rgba(255,255,255,0.85)' : palette.textMuted }]}>
              Next target: <Text style={{ fontWeight: '800' }}>{nextBelt.label} Belt</Text>
            </Text>
          ) : (
            <Text style={[styles.beltHeroNext, { color: currentBelt.fg === '#FFFFFF' ? 'rgba(255,255,255,0.85)' : palette.textMuted }]}>
              Top of the belt ladder! 🏆
            </Text>
          )}
        </View>

        {/* Belt progression timeline */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Award size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>BELT PROGRESSION</Text>
        </View>
        <View style={styles.timelineCard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.md }}
          >
            {BELTS.map((b, i) => {
              const reached = i <= beltIdx;
              const current = i === beltIdx;
              const next = i === beltIdx + 1;
              return (
                <View key={b.key} style={styles.beltStep}>
                  <View style={[
                    styles.beltCircle,
                    {
                      backgroundColor: reached ? b.bg : palette.bg,
                      borderColor: reached ? b.border : palette.borderSoft,
                    },
                    current && { transform: [{ scale: 1.15 }] },
                  ]}>
                    {reached
                      ? <Award size={14} color={b.fg === '#FFFFFF' ? '#111827' : b.fg} strokeWidth={2.4} />
                      : <Text style={styles.beltStepNum}>{i + 1}</Text>}
                  </View>
                  <Text style={[
                    styles.beltStepLabel,
                    current && { color: palette.text, fontWeight: '800' },
                    next    && { color: palette.purple.vivid, fontWeight: '700' },
                  ]}>
                    {b.label}
                  </Text>
                  {current ? <Text style={styles.beltCurrentPill}>Current</Text> : null}
                  {next    ? <Text style={styles.beltNextPill}>Next</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Certificates */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <FileText size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>CERTIFICATES EARNED</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={palette.purple.vivid} />
        ) : certificates.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileText size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No certificates yet</Text>
            <Text style={styles.emptySub}>Belt grading certificates appear here as your child progresses.</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
            {certificates.map((cert) => (
              <CertificateCard
                key={cert.id}
                cert={cert}
                onView={() => viewCertificate(cert)}
                onShare={() => shareCertificate(cert)}
                onDownload={downloadCertificate}
              />
            ))}
          </View>
        )}

        {/* Tournament achievements */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Trophy size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>TOURNAMENTS & MEDALS</Text>
        </View>
        {tournaments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Trophy size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No tournaments yet</Text>
            <Text style={styles.emptySub}>
              Medals, placements and event wins will be recorded here.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
            {tournaments.map((t) => (
              <TournamentRow key={t.id} t={t} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function CertificateCard({ cert, onView, onShare, onDownload }) {
  const Icon = cert.icon || Award;
  return (
    <View style={[styles.certCard, { backgroundColor: cert.bg, borderColor: cert.border }]}>
      <View style={styles.certTopRow}>
        <View style={[styles.certIcon, { backgroundColor: cert.border + '25' }]}>
          <Icon size={20} color={cert.fg === '#FFFFFF' ? '#111827' : cert.fg} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.certTitle, { color: cert.fg === '#FFFFFF' ? '#111827' : cert.fg }]} numberOfLines={2}>
            {cert.title}
          </Text>
          <Text style={[styles.certSub, { color: cert.fg === '#FFFFFF' ? '#374151' : (cert.fg + 'CC') }]} numberOfLines={1}>
            {cert.subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.certActions}>
        <CertActionBtn icon={FileText} label="View"     onPress={onView}     fg={cert.fg === '#FFFFFF' ? '#111827' : cert.fg} />
        <CertActionBtn icon={Share2}   label="Share"    onPress={onShare}    fg={cert.fg === '#FFFFFF' ? '#111827' : cert.fg} />
        <CertActionBtn icon={Download} label="Download" onPress={onDownload} fg={cert.fg === '#FFFFFF' ? '#111827' : cert.fg} />
      </View>
    </View>
  );
}

function CertActionBtn({ icon: Icon, label, onPress, fg }) {
  return (
    <TouchableOpacity style={styles.certActionBtn} onPress={onPress} activeOpacity={0.85}>
      <Icon size={13} color={fg} strokeWidth={2.4} />
      <Text style={[styles.certActionText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TournamentRow({ t }) {
  const Icon = t.icon;
  return (
    <View style={[styles.tournamentRow, { borderLeftColor: t.color.vivid }]}>
      <View style={[styles.tournamentIcon, { backgroundColor: t.color.soft }]}>
        <Icon size={18} color={t.color.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tournamentTitle} numberOfLines={1}>{t.title}</Text>
        <View style={styles.tournamentMeta}>
          <View style={[styles.placementPill, { backgroundColor: t.color.soft }]}>
            <Text style={[styles.placementText, { color: t.color.on }]}>{t.placement}</Text>
          </View>
          <Text style={styles.tournamentDate}>· {t.date}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
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
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  headerPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },

  // Belt hero
  beltHero: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    ...shadows.raised,
  },
  beltHeroIcon: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  beltHeroEyebrow: {
    ...type.micro,
    fontWeight: '800', letterSpacing: 1,
  },
  beltHeroValue: {
    fontSize: 26, fontWeight: '900',
    marginTop: 4,
  },
  eligibilityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  eligibilityText: { ...type.caption, fontWeight: '800' },
  beltHeroNext: {
    ...type.caption,
    marginTop: spacing.sm,
  },

  // Belt progression timeline
  timelineCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  beltStep: { width: 84, alignItems: 'center' },
  beltCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  beltStepNum: { ...type.bodyBold, color: palette.textMuted, fontSize: 13 },
  beltStepLabel: {
    ...type.caption, color: palette.textMuted, marginTop: 6,
    fontWeight: '700', textAlign: 'center',
  },
  beltCurrentPill: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.green.soft,
    color: palette.green.on,
    marginTop: 4,
    overflow: 'hidden',
  },
  beltNextPill: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
    color: palette.purple.on,
    marginTop: 4,
    overflow: 'hidden',
  },

  // Certificate
  certCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    ...shadows.card,
  },
  certTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  certIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  certTitle: { ...type.h3, fontSize: 14 },
  certSub: { ...type.caption, marginTop: 2 },
  certActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  certActionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  certActionText: { ...type.caption, fontWeight: '800' },

  // Tournament
  tournamentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderLeftWidth: 3,
    ...shadows.card,
  },
  tournamentIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  tournamentTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  tournamentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  placementPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  placementText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  tournamentDate: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
