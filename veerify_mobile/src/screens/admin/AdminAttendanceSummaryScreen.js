// src/screens/admin/AdminAttendanceSummaryScreen.js
//
// Institution admin's READ-ONLY attendance summary for a batch.
// Reached from AdminBatchStudentsScreen → "Attendance" button in the
// header. Marking stays trainer + branch-admin only; institution
// admins land here instead and see the aggregated numbers only.
//
// Displays two percentages:
//   • Today's attendance (%) — how many enrolled students were
//     marked present today / total enrolled.
//   • Current-month attendance (%) — share of present records this
//     month across all marked records for this batch.
//
// Pull-to-refresh re-fetches so the number stays live as the trainer
// updates marks throughout the day.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Animated, Easing,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  ArrowLeft, ClipboardCheck, Calendar, Users, Info, Download,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import ExportAttendanceModal from '../../components/ExportAttendanceModal';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Animated version of react-native-svg's Circle so we can animate the
// strokeDashoffset for the "fills up to X%" reveal.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function AdminAttendanceSummaryScreen({ route, navigation }) {
  const { batchId, batchName } = route?.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!batchId) { setLoading(false); return; }
    try {
      setError('');
      const r = await apiClient.get(`/attendance/batch/${batchId}/summary`);
      setData(r.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load attendance summary.');
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [batchId]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Attendance Summary</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {batchName || 'Batch'} · Read-only
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setExportOpen(true)}
          style={styles.exportHeaderBtn}
          activeOpacity={0.85}
        >
          <Download size={13} color="#fff" strokeWidth={2.4} />
          <Text style={styles.exportHeaderBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {error ? (
            <View style={styles.errorCard}>
              <Info size={14} color={palette.rose.on} strokeWidth={2.4} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Today's card */}
          <SummaryCard
            icon={ClipboardCheck}
            title="Today's Attendance"
            percentage={data?.today?.percentage ?? 0}
            breakdown={
              data?.today
                ? `${data.today.present} of ${data.today.total_enrolled} enrolled · ${data.today.marked} marked`
                : '—'
            }
            accent={palette.green}
          />

          {/* Month card */}
          <SummaryCard
            icon={Calendar}
            title="This Month"
            percentage={data?.month?.percentage ?? 0}
            breakdown={
              data?.month
                ? `${data.month.present} present out of ${data.month.marked} records`
                : '—'
            }
            accent={palette.blue}
          />

          {/* Info footer — signals the read-only nature so admins know
              they're not looking at a marking screen. */}
          <View style={styles.footerNote}>
            <Users size={12} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.footerNoteText}>
              Attendance is marked by the trainer or branch admin. Institution admins have read-only access.
            </Text>
          </View>
        </ScrollView>
      )}
      <ExportAttendanceModal
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        initialBranchId={null}
      />
    </View>
  );
}

function SummaryCard({ icon: Icon, title, percentage, breakdown, accent }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: accent.soft }]}>
          <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>

      {/* Circular percentage ring — the number sits in the middle,
          the ring fills clockwise up to the current percentage. */}
      <View style={styles.ringWrap}>
        <CircularPercentage
          percentage={percentage}
          size={140}
          strokeWidth={12}
          color={accent.vivid}
          trackColor={accent.soft}
        />
      </View>

      <Text style={styles.breakdown}>{breakdown}</Text>
    </View>
  );
}

// ── CircularPercentage ─────────────────────────────────────────────
// Uses two concentric SVG circles:
//   • track (background) — full ring at low opacity
//   • fill  (foreground) — same ring, but its stroke-dasharray is
//     the full circumference and its stroke-dashoffset is the portion
//     of that circumference that should be HIDDEN. Setting offset =
//     circumference * (1 - percentage/100) reveals the correct arc.
// The offset animates from `circumference` (0%) → target on every
// percentage change, giving the "fills up to X%" feel the spec asks for.
function CircularPercentage({
  percentage, size = 140, strokeWidth = 12, color, trackColor,
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage) || 0));
  const radius  = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Animated dashoffset — the numeric driver of the ring fill.
  const anim = useRef(new Animated.Value(circumference)).current;
  // Displayed integer that animates in step with the ring so the
  // number counts up as the arc grows.
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const target = circumference * (1 - clamped / 100);
    Animated.timing(anim, {
      toValue:         target,
      duration:        900,
      easing:          Easing.out(Easing.cubic),
      // strokeDashoffset can't run on the native driver in RN Reanimated-
      // free mode, so we stay on the JS driver here.
      useNativeDriver: false,
    }).start();

    // Count-up label. Uses the same easing curve as the ring by
    // driving a separate interval that reads the current animated
    // value — no complex maths, just poll and setState.
    let frame;
    const start = Date.now();
    const from  = displayValue;
    const step = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / 900);
      const eased = 1 - Math.pow(1 - t, 3); // matches Easing.out(cubic)
      const v = Math.round(from + (clamped - from) * eased);
      setDisplayValue(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped, circumference]);

  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {/* Track — the muted ring that shows the full loop */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Fill — rotate -90° so the arc starts at 12 o'clock and
            fills clockwise, matching every progress ring convention. */}
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={anim}
          rotation="-90"
          origin={`${cx}, ${cy}`}
        />
      </Svg>
      {/* Percentage label centered inside the ring */}
      <View style={styles.ringLabelWrap}>
        <Text style={[styles.ringLabel, { color }]}>{displayValue}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: {
    ...type.h2,
    color: palette.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Circular progress ring
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
  },
  ringLabelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabel: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
  },

  breakdown: {
    ...type.caption,
    color: palette.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.rose.soft,
    marginBottom: spacing.md,
  },
  errorText: {
    flex: 1,
    ...type.caption,
    color: palette.rose.on,
    fontWeight: '600',
  },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  footerNoteText: {
    flex: 1,
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '600',
    lineHeight: 15,
  },

  exportHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.md,
  },
  exportHeaderBtnText: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
