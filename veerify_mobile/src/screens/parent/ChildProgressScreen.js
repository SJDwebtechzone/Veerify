// src/screens/parent/ChildProgressScreen.js
//
// Parent Step 4 - Performance analytics.
//
// Layout (top to bottom):
//   1. Header  back, "Performance" title, child name subtitle.
//   2. Composite score hero card  big number out of 100, breakdown chip strip.
//   3. Metric rings (2 x 2)  Discipline / Skills / Stamina / Form.
//   4. Monthly attendance trend  6-month bar chart, real from records.
//   5. Recent assessments  placeholder list.
//   6. Trainer feedback  placeholder card.
//
// Real data:
//   GET /api/parents/children/:id/attendance  -> discipline score + monthly chart
//   Skills / Stamina / Form / assessments / feedback are placeholders until
//   the assessment_reports + trainer_feedback tables land.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, TrendingUp, Award, Activity, Target, Shield,
  MessageSquare, ClipboardList, Calendar, Star,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ymKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function isoDay(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}

// Build [oldest, ..., newest] last-6-months keys.
function last6Months() {
  const now = new Date();
  const arr = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({ ym: ymKey(d), label: MONTH_SHORT[d.getMonth()], year: d.getFullYear() });
  }
  return arr;
}

export default function ChildProgressScreen({ navigation, route }) {
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

  // ── Discipline score = overall attendance % (real) ──
  const discipline = useMemo(() => {
    const total = records.length;
    const present = records.filter((r) => r.status === 'present').length;
    return total > 0 ? Math.round((present / total) * 100) : null;
  }, [records]);

  // ── Synthesized placeholders, biased by attendance so they don't feel random ──
  const skills  = discipline === null ? null : Math.max(0, Math.min(100, discipline - 10));
  const stamina = discipline === null ? null : Math.max(0, Math.min(100, discipline - 20));
  const form    = discipline === null ? null : Math.max(0, Math.min(100, discipline - 5));

  // ── Composite score: weighted average ──
  const composite = useMemo(() => {
    const vals = [discipline, skills, stamina, form].filter((v) => v !== null && !isNaN(v));
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [discipline, skills, stamina, form]);

  // ── Monthly attendance % (last 6 months) ──
  const monthlyTrend = useMemo(() => {
    const buckets = last6Months();
    return buckets.map((b) => {
      const monthRecs = records.filter((r) => isoDay(r.date).startsWith(b.ym));
      const total = monthRecs.length;
      const present = monthRecs.filter((r) => r.status === 'present').length;
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      return { ...b, pct, total };
    });
  }, [records]);
  const trendMax = Math.max(100, ...monthlyTrend.map((m) => m.pct)); // y-axis cap

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        {navigation.canGoBack?.() ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Performance</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{childName}</Text>
        </View>
        <View style={styles.headerPill}>
          <TrendingUp size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{composite === null ? '—' : composite}</Text>
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
        {/* Composite score hero */}
        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Text style={styles.heroEyebrow}>OVERALL PERFORMANCE</Text>
            <Text style={styles.heroValue}>{composite === null ? '—' : composite}</Text>
            <Text style={styles.heroOf}>/ 100</Text>
            <Text style={styles.heroSub}>{composite === null ? 'Not enough data yet' : compositeBand(composite)}</Text>
          </View>
          <View style={styles.heroRing}>
            <ProgressRing size={120} thickness={10} value={composite ?? 0} color="#fff" trackColor="rgba(255,255,255,0.25)" />
            <View style={styles.heroRingInner}>
              <Star size={22} color="#fff" strokeWidth={2.4} />
            </View>
          </View>
        </View>

        {/* Metric rings */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Activity size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>METRICS</Text>
        </View>
        <View style={styles.metricsGrid}>
          <MetricCard icon={Shield}   label="Discipline" value={discipline} accent={palette.green}  isReal />
          <MetricCard icon={Target}   label="Skills"     value={skills}     accent={palette.purple} />
          <MetricCard icon={Activity} label="Stamina"    value={stamina}    accent={palette.orange} />
          <MetricCard icon={Award}    label="Form"       value={form}       accent={palette.blue} />
        </View>

        {/* Monthly trend */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <TrendingUp size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>ATTENDANCE TREND (6 MONTHS)</Text>
        </View>
        <View style={styles.trendCard}>
          {loading ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : (
            <>
              <View style={styles.trendChart}>
                {monthlyTrend.map((m) => {
                  const barH = m.pct > 0 ? Math.max(6, (m.pct / trendMax) * 100) : 4;
                  const color =
                    m.pct >= 85 ? palette.green.vivid :
                    m.pct >= 65 ? palette.orange.vivid :
                    m.pct > 0   ? palette.rose.vivid  :
                                  palette.borderSoft;
                  return (
                    <View key={m.ym} style={styles.trendBarWrap}>
                      <Text style={styles.trendBarValue}>{m.pct ? `${m.pct}%` : '—'}</Text>
                      <View style={[styles.trendBar, { height: barH, backgroundColor: color }]} />
                      <Text style={styles.trendBarLabel}>{m.label}</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.trendFooter}>
                Bars show monthly attendance %. Green ≥ 85, orange ≥ 65, red below.
              </Text>
            </>
          )}
        </View>

        {/* Assessments */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <ClipboardList size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>RECENT ASSESSMENTS</Text>
        </View>
        <View style={styles.placeholderCard}>
          <View style={styles.placeholderIcon}>
            <ClipboardList size={20} color={palette.purple.vivid} strokeWidth={2.2} />
          </View>
          <Text style={styles.placeholderTitle}>No assessments yet</Text>
          <Text style={styles.placeholderText}>
            Trainer-led skill assessments and belt-grading scores will appear
            here once they're recorded.
          </Text>
        </View>

        {/* Trainer feedback */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <MessageSquare size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>TRAINER FEEDBACK</Text>
        </View>
        <View style={styles.placeholderCard}>
          <View style={[styles.placeholderIcon, { backgroundColor: palette.blue.soft }]}>
            <MessageSquare size={20} color={palette.blue.vivid} strokeWidth={2.2} />
          </View>
          <Text style={styles.placeholderTitle}>No feedback recorded</Text>
          <Text style={styles.placeholderText}>
            When your child's trainer leaves a note or rating, you'll see it here.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function compositeBand(score) {
  if (score >= 90) return 'Outstanding — keep it up!';
  if (score >= 75) return 'Strong performance';
  if (score >= 60) return 'On track with room to grow';
  if (score >= 40) return 'Building consistency';
  return 'Needs attention';
}

function MetricCard({ icon: Icon, label, value, accent, isReal }) {
  return (
    <View style={[styles.metricCard, { borderColor: accent.soft }]}>
      <View style={[styles.metricIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <ProgressRing
        size={64} thickness={6}
        value={value ?? 0}
        color={accent.vivid}
        trackColor={palette.borderSoft}
        innerLabel={value === null ? '—' : String(value)}
      />
      <Text style={styles.metricLabel}>{label}</Text>
      {!isReal ? <Text style={styles.metricBadge}>Coming soon</Text> : null}
    </View>
  );
}

// Pure-React-Native ring (no SVG dependency) — uses overlapping conic-like
// rotated semicircles. For values 0-100 we render a clamped arc by stacking
// two rotated half-rings (left + right). Simple, dependency-free, good enough
// for a dashboard meter.
function ProgressRing({ size, thickness, value, color, trackColor, innerLabel }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = size / 2;
  // Convert percentage to rotation: 100% = 360deg arc.
  const leftRot = v <= 50 ? -180 : (v - 50) / 50 * 180 - 180;     // -180..0
  const rightRot = v <= 50 ? v / 50 * 180 - 180 : 0;              // -180..0 (full when v=50)

  const halfMask = {
    position: 'absolute',
    width: size / 2,
    height: size,
    backgroundColor: trackColor,
  };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Background track */}
      <View style={{
        position: 'absolute',
        width: size, height: size, borderRadius: r,
        borderWidth: thickness, borderColor: trackColor,
      }} />
      {/* Animated arc — built from two half-circle overlays. Approximate but
          inexpensive and matches the visual the staff dashboard uses. */}
      {v > 0 ? (
        <>
          {/* right half */}
          <View style={{
            position: 'absolute',
            width: size, height: size, borderRadius: r,
            borderWidth: thickness, borderColor: 'transparent',
            borderRightColor: color,
            borderTopColor: v >= 25 ? color : 'transparent',
            transform: [{ rotate: '45deg' }],
          }} />
          {v >= 50 ? (
            <View style={{
              position: 'absolute',
              width: size, height: size, borderRadius: r,
              borderWidth: thickness, borderColor: 'transparent',
              borderLeftColor: color,
              borderBottomColor: v >= 75 ? color : 'transparent',
              transform: [{ rotate: '45deg' }],
            }} />
          ) : null}
        </>
      ) : null}
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...type.h1, color: palette.text, fontSize: size * 0.28 }}>{innerLabel ?? `${v}`}</Text>
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

  // Hero
  hero: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...shadows.raised,
  },
  heroLeft: { flex: 1 },
  heroEyebrow: { ...type.micro, color: 'rgba(255,255,255,0.85)', fontWeight: '800', letterSpacing: 1 },
  heroValue: { color: '#fff', fontSize: 52, fontWeight: '900', marginTop: 4 },
  heroOf: { color: 'rgba(255,255,255,0.85)', ...type.caption, fontWeight: '700', marginTop: -8 },
  heroSub: { color: '#fff', ...type.bodyBold, fontWeight: '700', marginTop: spacing.sm },
  heroRing: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  heroRingInner: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
  },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },

  // Metrics grid
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  metricCard: {
    width: '47.5%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    ...shadows.card,
  },
  metricIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  metricLabel: { ...type.bodyBold, color: palette.text, fontSize: 13, marginTop: 4 },
  metricBadge: {
    ...type.micro, color: palette.textMuted, fontWeight: '700',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.borderSoft,
  },

  // Trend
  trendCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  trendChart: {
    flexDirection: 'row', alignItems: 'flex-end',
    height: 130, gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  trendBarWrap: { flex: 1, alignItems: 'center', gap: 4 },
  trendBarValue: { ...type.micro, color: palette.textMuted, fontWeight: '800', minHeight: 12 },
  trendBar: { width: '70%', borderRadius: 4 },
  trendBarLabel: { ...type.micro, color: palette.text, fontWeight: '700' },
  trendFooter: { ...type.micro, color: palette.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },

  // Placeholder card
  placeholderCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  placeholderIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  placeholderTitle: { ...type.bodyBold, color: palette.text },
  placeholderText: { ...type.caption, color: palette.textMuted, textAlign: 'center', lineHeight: 18 },
});
