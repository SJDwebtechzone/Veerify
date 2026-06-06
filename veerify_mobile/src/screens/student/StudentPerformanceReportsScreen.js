// src/screens/student/StudentPerformanceReportsScreen.js
//
// Student's read-only Performance Reports list.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, ClipboardList, Star, ChevronRight, Award, Calendar,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function avgRating(r) {
  const keys = ['discipline_rating', 'attendance_rating', 'technique_rating',
                'fitness_rating', 'sparring_rating', 'behaviour_rating'];
  const vals = keys.map((k) => Number(r[k]) || 0).filter((v) => v > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function StudentPerformanceReportsScreen({ navigation }) {
  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/performance-reports/my');
      setReports(res.data?.reports || []);
    } catch (err) {
      console.log('[StudentReports] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Performance</Text>
          <Text style={styles.headerSubtitle}>Reports published by your trainer</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.purple.vivid} />
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.empty}>
            <ClipboardList size={36} color={palette.textLight} />
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptyBody}>
              When your trainer publishes a report, it will appear here.
            </Text>
          </View>
        ) : (
          reports.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.card}
              onPress={() => navigation.navigate('StudentPerformanceReportDetail', { report: r })}
              activeOpacity={0.85}
            >
              <View style={styles.cardTop}>
                <View style={styles.iconWrap}>
                  <Award size={18} color={palette.purple.vivid} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {fmtDate(r.report_date)}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {r.course_name || '—'}{r.batch_name ? ` · ${r.batch_name}` : ''}
                  </Text>
                  {r.belt_level ? (
                    <Text style={styles.cardBelt}>Belt: {r.belt_level}</Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={palette.textLight} />
              </View>

              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const a = avgRating(r);
                  return (
                    <Star
                      key={n}
                      size={14}
                      color={n <= Math.round(a) ? '#F59E0B' : palette.borderSoft}
                      fill={n <= Math.round(a) ? '#F59E0B' : 'transparent'}
                      strokeWidth={2}
                    />
                  );
                })}
                <Text style={styles.avgText}>
                  {avgRating(r).toFixed(1)} avg
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
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
  headerTitle: { fontSize: 18, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },

  scrollContent: { padding: spacing.xl },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: palette.dark, marginTop: 6 },
  emptyBody: { fontSize: 12, color: palette.textLight, textAlign: 'center', maxWidth: 280 },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    ...shadows.soft,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: palette.dark },
  cardMeta: { fontSize: 12, color: palette.textLight, marginTop: 1 },
  cardBelt: { fontSize: 11, color: palette.purple.vivid, fontWeight: '700', marginTop: 2 },

  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 10 },
  avgText: { fontSize: 11, color: palette.textLight, marginLeft: 6, fontWeight: '700' },
});
