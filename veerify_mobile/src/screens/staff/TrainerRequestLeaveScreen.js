// src/screens/staff/TrainerRequestLeaveScreen.js
//
// Trainer-side leave request screen. Two panes stacked on one ScrollView:
//
//   1. New request form
//        - Start date (DateField)
//        - End date   (DateField)
//        - Reason (multiline TextInput)
//        - Submit button → POST /api/trainer-leave-requests
//
//   2. History list (most recent first)
//        - GET /api/trainer-leave-requests/my
//        - Status pill (pending / approved / rejected) + reviewer note when set
//
// Notification: the backend fans out a "Trainer leave request" notification
// to the institution admin on create, and a decision notification back to
// the trainer on approve / reject.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, CalendarOff, Send, Check, X as XIcon, Clock,
  FileText, MessageCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  pending:  { label: 'Pending',  color: palette.orange.vivid, bg: palette.orange.soft, icon: Clock },
  approved: { label: 'Approved', color: palette.green.vivid,  bg: palette.green.soft,  icon: Check },
  rejected: { label: 'Rejected', color: palette.rose.vivid,   bg: palette.rose.soft,   icon: XIcon },
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  return start === end || String(start).slice(0,10) === String(end).slice(0,10)
    ? s.toLocaleDateString(undefined, opts)
    : `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} → ${e.toLocaleDateString(undefined, opts)}`;
}

function daysBetween(start, end) {
  const s = new Date(String(start).slice(0, 10));
  const e = new Date(String(end).slice(0, 10));
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

export default function TrainerRequestLeaveScreen({ navigation }) {
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // History state
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/trainer-leave-requests/my');
      setItems(res.data?.leave_requests || []);
      setCounts(res.data?.counts || { pending: 0, approved: 0, rejected: 0, total: 0 });
    } catch (err) {
      console.log('[TrainerRequestLeave] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Submit handler — basic client-side validation then POST.
  const submit = async () => {
    if (!startDate || !endDate) {
      Alert.alert('Missing dates', 'Please pick both start and end dates.');
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      Alert.alert('Invalid range', 'End date cannot be before start date.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/trainer-leave-requests', {
        start_date: startDate,
        end_date:   endDate,
        reason:     reason.trim() || null,
      });
      setStartDate('');
      setEndDate('');
      setReason('');
      Alert.alert('Submitted', 'Your leave request was sent to the institution admin.');
      await load();
    } catch (err) {
      Alert.alert('Submit failed',
        err?.response?.data?.message || err?.message || 'Could not submit leave request.');
    } finally {
      setSubmitting(false);
    }
  };

  const totalDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    return daysBetween(startDate, endDate);
  }, [startDate, endDate]);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Leave</Text>
          <Text style={styles.headerSubtitle}>Request time off from work</Text>
        </View>
        <View style={[styles.headerIcon, { backgroundColor: palette.teal.soft }]}>
          <CalendarOff size={18} color={palette.teal.vivid} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.teal.vivid}
          />
        }
      >
        {/* ── New request form ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New leave request</Text>
          <Text style={styles.cardSubtitle}>
            Your institution admin will be notified instantly.
          </Text>

          <View style={styles.formRow}>
            <Text style={styles.label}>Start date</Text>
            <DateField
              value={startDate}
              onChange={setStartDate}
              placeholder="Pick start date"
              minYear={new Date().getFullYear() - 1}
              accent={palette.teal.vivid}
            />
          </View>

          <View style={styles.formRow}>
            <Text style={styles.label}>End date</Text>
            <DateField
              value={endDate}
              onChange={setEndDate}
              placeholder="Pick end date"
              minYear={new Date().getFullYear() - 1}
              accent={palette.teal.vivid}
            />
          </View>

          {totalDays > 0 ? (
            <View style={styles.totalDaysPill}>
              <Text style={styles.totalDaysText}>
                {totalDays} day{totalDays === 1 ? '' : 's'} of leave
              </Text>
            </View>
          ) : null}

          <View style={styles.formRow}>
            <Text style={styles.label}>Reason (optional)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              placeholder="E.g. Family function, medical appointment..."
              placeholderTextColor={palette.textLight}
              style={styles.textArea}
              maxLength={500}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Send size={16} color="#fff" strokeWidth={2.4} />
                <Text style={styles.submitText}>Submit request</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Counts strip ── */}
        <View style={styles.countsRow}>
          <CountPill label="Pending"  value={counts.pending}  color={palette.orange.vivid} bg={palette.orange.soft} />
          <CountPill label="Approved" value={counts.approved} color={palette.green.vivid}  bg={palette.green.soft} />
          <CountPill label="Rejected" value={counts.rejected} color={palette.rose.vivid}   bg={palette.rose.soft} />
        </View>

        {/* ── History list ── */}
        <Text style={styles.sectionTitle}>My requests</Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.teal.vivid} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <FileText size={28} color={palette.textLight} />
            <Text style={styles.emptyTitle}>No leave requests yet</Text>
            <Text style={styles.emptySubtitle}>
              Your submitted requests will show up here.
            </Text>
          </View>
        ) : (
          items.map((lr) => <HistoryCard key={lr.id} item={lr} />)
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function CountPill({ label, value, color, bg }) {
  return (
    <View style={[styles.countPill, { backgroundColor: bg }]}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={[styles.countLabel, { color }]}>{label}</Text>
    </View>
  );
}

function HistoryCard({ item }) {
  const meta = STATUS_META[item.status] || STATUS_META.pending;
  const StatusIcon = meta.icon;
  const days = daysBetween(item.start_date, item.end_date);

  return (
    <View style={styles.histCard}>
      <View style={styles.histTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.histRange}>{fmtRange(item.start_date, item.end_date)}</Text>
          <Text style={styles.histDays}>{days} day{days === 1 ? '' : 's'}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <StatusIcon size={12} color={meta.color} strokeWidth={2.4} />
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {item.reason ? (
        <View style={styles.histRow}>
          <FileText size={13} color={palette.textLight} />
          <Text style={styles.histReason}>{item.reason}</Text>
        </View>
      ) : null}

      {item.review_note ? (
        <View style={styles.histRow}>
          <MessageCircle size={13} color={palette.textLight} />
          <Text style={styles.histReason}>
            <Text style={styles.histReasonLabel}>Admin note: </Text>
            {item.review_note}
          </Text>
        </View>
      ) : null}

      {item.reviewed_by_name ? (
        <Text style={styles.histMeta}>
          Reviewed by {item.reviewed_by_name}
          {item.reviewed_at ? ` · ${new Date(item.reviewed_at).toLocaleDateString()}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.surfaceAlt,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  scrollContent: { padding: spacing.xl },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadows.soft,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: palette.dark },
  cardSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 2, marginBottom: 14 },

  formRow: { marginBottom: 12 },
  label: {
    fontSize: 11, fontWeight: '700', color: palette.textLight,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  textArea: {
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 14,
    color: palette.dark,
    backgroundColor: palette.surfaceAlt,
    textAlignVertical: 'top',
    minHeight: 90,
  },
  totalDaysPill: {
    alignSelf: 'flex-start',
    backgroundColor: palette.teal.soft,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    marginTop: 4, marginBottom: 6,
  },
  totalDaysText: {
    fontSize: 11, fontWeight: '700', color: palette.teal.vivid,
  },

  submitBtn: {
    backgroundColor: palette.teal.vivid,
    paddingVertical: 14,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  countsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.lg,
  },
  countPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  countValue: { fontSize: 18, fontWeight: '800' },
  countLabel: { fontSize: 10, fontWeight: '700', marginTop: 1, letterSpacing: 0.4 },

  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: palette.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 10,
  },

  loading: { paddingVertical: 32, alignItems: 'center' },

  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl + 6,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: palette.dark, marginTop: 4 },
  emptySubtitle: { fontSize: 12, color: palette.textLight, textAlign: 'center' },

  histCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    ...shadows.soft,
  },
  histTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  histRange: { fontSize: 14, fontWeight: '700', color: palette.dark },
  histDays: { fontSize: 11, color: palette.textLight, marginTop: 1 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999, gap: 4,
  },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  histRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
  },
  histReason: { flex: 1, fontSize: 12, color: palette.text, lineHeight: 17 },
  histReasonLabel: { fontWeight: '700', color: palette.textLight },
  histMeta: { fontSize: 11, color: palette.textLight, marginTop: 6 },
});
