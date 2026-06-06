// src/screens/staff/StaffPerformanceReportsScreen.js
//
// Trainer's performance reports history.
// Route params: { studentId?, studentName? } — when supplied, the list is
// pre-scoped to that student. Otherwise it shows everything the trainer
// has authored across all students.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Plus, ClipboardList, FileText, Edit3, Send,
  Trash2, CheckCircle2, Clock, Star, User,
} from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND      = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT       = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = '#FFFFFF';
const BG         = '#F4F4F8';
const BORDER     = '#E5E7EB';
const STAR_ON    = '#F59E0B';
const STAR_OFF   = '#E5E7EB';

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

export default function StaffPerformanceReportsScreen({ navigation, route }) {
  const studentId   = route?.params?.studentId   || null;
  const studentName = route?.params?.studentName || null;

  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]         = useState(null);

  const load = useCallback(async () => {
    try {
      const url = studentId
        ? `/performance-reports?student_id=${studentId}`
        : `/performance-reports`;
      const res = await apiClient.get(url);
      setReports(res.data?.reports || []);
    } catch (err) {
      console.log('[ReportsList] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const publish = async (r) => {
    setBusyId(r.id);
    try {
      await apiClient.post(`/performance-reports/${r.id}/publish`, {});
      await load();
    } catch (err) {
      Alert.alert('Publish failed',
        err?.response?.data?.message || err?.message || 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = (r) => {
    Alert.alert('Delete report?',
      `This will remove the report dated ${fmtDate(r.report_date)} for ${r.student_name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setBusyId(r.id);
          try {
            await apiClient.delete(`/performance-reports/${r.id}`);
            await load();
          } catch (err) {
            Alert.alert('Delete failed',
              err?.response?.data?.message || err?.message || 'Try again.');
          } finally {
            setBusyId(null);
          }
        }},
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Performance Reports</Text>
          <Text style={styles.headerSubtitle}>
            {studentName ? `For ${studentName}` : 'Across all your students'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('StaffPerformanceReportForm', {
            mode: 'create',
            prefilledStudent: studentId ? { id: studentId, name: studentName } : null,
          })}
          activeOpacity={0.85}
        >
          <Plus size={18} color="#fff" strokeWidth={2.6} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
      >
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={BRAND} />
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.empty}>
            <ClipboardList size={36} color={TEXT_LIGHT} />
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptyBody}>
              Tap the + button to create your first performance report.
            </Text>
          </View>
        ) : (
          reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={busyId === r.id}
              onEdit={() => navigation.navigate('StaffPerformanceReportForm', {
                mode: 'edit',
                report: r,
              })}
              onPublish={() => publish(r)}
              onDelete={() => remove(r)}
            />
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function ReportCard({ report, busy, onEdit, onPublish, onDelete }) {
  const published = report.status === 'published';
  const avg       = avgRating(report);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.studentBadge}>
          <User size={14} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>{report.student_name}</Text>
          <Text style={styles.studentMeta} numberOfLines={1}>
            {report.course_name || '—'}{report.batch_name ? ` · ${report.batch_name}` : ''}
          </Text>
        </View>
        {published ? (
          <View style={[styles.statusPill, { backgroundColor: '#DCFCE7' }]}>
            <CheckCircle2 size={11} color="#15803D" strokeWidth={2.4} />
            <Text style={[styles.statusText, { color: '#15803D' }]}>PUBLISHED</Text>
          </View>
        ) : (
          <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
            <Clock size={11} color="#B45309" strokeWidth={2.4} />
            <Text style={[styles.statusText, { color: '#B45309' }]}>DRAFT</Text>
          </View>
        )}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Report date:</Text>
        <Text style={styles.metaValue}>{fmtDate(report.report_date)}</Text>
      </View>
      {report.belt_level ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Belt:</Text>
          <Text style={styles.metaValue}>{report.belt_level}</Text>
        </View>
      ) : null}

      {avg > 0 ? (
        <View style={styles.avgRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={14}
              color={n <= Math.round(avg) ? STAR_ON : STAR_OFF}
              fill={n <= Math.round(avg) ? STAR_ON : 'transparent'}
              strokeWidth={2}
            />
          ))}
          <Text style={styles.avgText}>{avg.toFixed(1)} avg</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onEdit}
          disabled={busy}
          style={[styles.actionBtn, styles.actionGhost]}
          activeOpacity={0.85}
        >
          <Edit3 size={13} color={BRAND} strokeWidth={2.4} />
          <Text style={[styles.actionText, { color: BRAND }]}>Edit</Text>
        </TouchableOpacity>

        {!published ? (
          <TouchableOpacity
            onPress={onPublish}
            disabled={busy}
            style={[styles.actionBtn, styles.actionPrimary]}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Send size={13} color="#fff" strokeWidth={2.4} />
                <Text style={[styles.actionText, { color: '#fff' }]}>Publish</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={onDelete}
          disabled={busy}
          style={[styles.actionBtn, styles.actionDestructive]}
          activeOpacity={0.85}
        >
          <Trash2 size={13} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle:   { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSubtitle:{ fontSize: 11, color: TEXT_MUTED, marginTop: 1 },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },

  scrollContent: { padding: 14 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: TEXT, marginTop: 6 },
  emptyBody:  { fontSize: 12, color: TEXT_MUTED, textAlign: 'center', maxWidth: 280 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  studentBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  studentName: { fontSize: 14, fontWeight: '800', color: TEXT },
  studentMeta: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
  },
  statusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  metaRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  metaLabel:{ fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },
  metaValue:{ fontSize: 11, color: TEXT, fontWeight: '700' },

  avgRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    marginTop: 8,
  },
  avgText: { fontSize: 11, color: TEXT_MUTED, marginLeft: 4, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: 6, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8,
  },
  actionGhost: { flex: 1, backgroundColor: BRAND_SOFT },
  actionPrimary: { flex: 1, backgroundColor: BRAND },
  actionDestructive: { width: 36, backgroundColor: '#94A3B8' },
  actionText: { fontSize: 12, fontWeight: '800' },
});
