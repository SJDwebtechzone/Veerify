// src/screens/parent/InformLeaveScreen.js
//
// Parent Step 6 - Leave Management.
//
// Layout (top to bottom):
//   1. Header  back, "Inform Leave" title, child name subtitle.
//   2. Active child chip (read-only - the dashboard / context controls this).
//   3. Date range picker - From + To, each opens an in-place 30-day strip.
//      Auto-flips if To is before From.
//   4. Batch selector (auto-picks first enrolled batch; chip selector if many).
//   5. Reason textarea.
//   6. Submit button (sticky bottom).
//   7. Recent leave-request history for this child.
//
// Data:
//   GET  /api/parents/children/:id/enrollments        - batches the child is in
//   GET  /api/leave-requests/parent/my-children?child_id=:id  - history
//   POST /api/leave-requests                           - submit a new one

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, TextInput, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Calendar, ChevronRight, ChevronDown,
  Plane, MessageSquare, Send, Check, X as XIcon, Clock,
  Users, BookOpen,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATUS_META = {
  pending:  { label: 'Pending',  color: palette.orange, icon: Clock },
  approved: { label: 'Approved', color: palette.green,  icon: Check },
  rejected: { label: 'Rejected', color: palette.rose,   icon: XIcon },
  cancelled:{ label: 'Cancelled',color: palette.purple, icon: XIcon },
};

function isoDate(d) { return d.toISOString().split('T')[0]; }
function sameDay(a, b) { return isoDate(a) === isoDate(b); }
function nextDays(n, from = new Date()) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    arr.push(d);
  }
  return arr;
}
function dayCount(start, end) {
  const s = new Date(isoDate(start));
  const e = new Date(isoDate(end));
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}
function fmtRange(start, end) {
  if (sameDay(start, end)) {
    return start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} → ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default function InformLeaveScreen({ navigation, route }) {
  const { activeChild } = useChild();
  const childId = route?.params?.childId ?? activeChild?.child_id ?? null;
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';

  const [enrollments, setEnrollments] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [reason, setReason] = useState('');
  const [openPicker, setOpenPicker] = useState(null); // 'from' | 'to' | null

  // ── Load enrollments + history ──
  const load = useCallback(async () => {
    if (!childId) { setLoading(false); setRefreshing(false); return; }
    try {
      const [enrollRes, histRes] = await Promise.all([
        apiClient.get(`/parents/children/${childId}/enrollments`)
          .catch(() => ({ data: { enrollments: [] } })),
        apiClient.get(`/leave-requests/parent/my-children?child_id=${childId}`)
          .catch(() => ({ data: { leave_requests: [] } })),
      ]);
      const enrolls = enrollRes.data?.enrollments || [];
      setEnrollments(enrolls);
      // Auto-pick first batch if none chosen yet
      if (!batchId && enrolls.length > 0) {
        setBatchId(enrolls[0].batch_id || enrolls[0].id);
      }
      setHistory(histRes.data?.leave_requests || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId, batchId]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // Auto-correct: if user picks an end date before start, swap.
  useEffect(() => {
    if (endDate < startDate) setEndDate(new Date(startDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate]);

  const submit = async () => {
    if (!childId) {
      Alert.alert('No active child', 'Pick a linked child first.');
      return;
    }
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Tell the trainer briefly why your child needs leave.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/leave-requests', {
        student_id: childId,
        batch_id:   batchId || null,
        start_date: isoDate(startDate),
        end_date:   isoDate(endDate),
        reason:     reason.trim(),
      });
      Alert.alert(
        'Request submitted',
        `Leave for ${childName} (${fmtRange(startDate, endDate)}) sent to the trainer.`,
        [{ text: 'OK', onPress: () => {
          setReason('');
          load();
        } }],
      );
    } catch (err) {
      Alert.alert(
        'Could not submit',
        err.response?.data?.message || err.message || 'Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const days = dayCount(startDate, endDate);
  const selectedBatch = enrollments.find((e) => (e.batch_id || e.id) === batchId);

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Inform Leave</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{childName}</Text>
        </View>
        <View style={styles.headerPill}>
          <Plane size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerPillText}>{history.length}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Active child card */}
        <View style={styles.childCard}>
          <View style={styles.childAvatar}>
            <Text style={styles.childInitials}>
              {(childName || 'C').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childChipLabel}>SUBMITTING FOR</Text>
            <Text style={styles.childChipName}>{childName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('LinkedChildren')}
            style={styles.childChipChange}
          >
            <Text style={styles.childChipChangeText}>Change</Text>
            <ChevronRight size={12} color={palette.purple.vivid} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        {/* Dates */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>LEAVE DATES</Text>
        </View>
        <View style={styles.dateRow}>
          <DatePicker
            label="From"
            value={startDate}
            open={openPicker === 'from'}
            onToggle={() => setOpenPicker(openPicker === 'from' ? null : 'from')}
            onPick={(d) => { setStartDate(d); setOpenPicker('to'); }}
          />
          <DatePicker
            label="To"
            value={endDate}
            minDate={startDate}
            open={openPicker === 'to'}
            onToggle={() => setOpenPicker(openPicker === 'to' ? null : 'to')}
            onPick={(d) => { setEndDate(d); setOpenPicker(null); }}
          />
        </View>
        <View style={styles.daysPillRow}>
          <View style={styles.daysPill}>
            <Calendar size={11} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.daysPillText}>
              {fmtRange(startDate, endDate)} · {days} day{days === 1 ? '' : 's'}
            </Text>
          </View>
        </View>

        {/* Batch (auto, but selectable when multiple) */}
        {enrollments.length > 1 ? (
          <>
            <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
              <BookOpen size={12} color={palette.textMuted} strokeWidth={2.2} />
              <Text style={styles.sectionLabelText}>BATCH</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
            >
              {enrollments.map((e) => {
                const id = e.batch_id || e.id;
                const active = batchId === id;
                return (
                  <TouchableOpacity
                    key={id}
                    style={[styles.batchChip, active && styles.batchChipActive]}
                    onPress={() => setBatchId(id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.batchChipText, active && styles.batchChipTextActive]} numberOfLines={1}>
                      {e.batch_name || e.name || 'Batch'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        ) : selectedBatch ? (
          <View style={styles.singleBatchLine}>
            <BookOpen size={12} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.singleBatchText}>
              Batch: <Text style={{ color: palette.text, fontWeight: '700' }}>{selectedBatch.batch_name || selectedBatch.name}</Text>
            </Text>
          </View>
        ) : null}

        {/* Reason */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <MessageSquare size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>REASON</Text>
        </View>
        <View style={styles.reasonCard}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Family event, illness, school exam..."
            placeholderTextColor={palette.textLight}
            multiline
            style={styles.reasonInput}
          />
          <Text style={styles.reasonHint}>
            The trainer sees this so they can plan around the absence.
          </Text>
        </View>

        {/* Recent requests */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <Clock size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>RECENT REQUESTS</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={palette.purple.vivid} />
        ) : history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Plane size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No leave requests yet</Text>
            <Text style={styles.emptySub}>Submitted requests will appear here with their status.</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}>
            {history.map((lr) => <HistoryRow key={lr.id} lr={lr} />)}
          </View>
        )}
      </ScrollView>

      {/* Sticky submit */}
      <View style={styles.submitBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.submitLabel}>{days} day{days === 1 ? '' : 's'} leave</Text>
          <Text style={styles.submitSub}>{fmtRange(startDate, endDate)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.submitBtn, (submitting || !reason.trim()) && { opacity: 0.55 }]}
          onPress={submit}
          disabled={submitting || !reason.trim()}
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={14} color="#fff" strokeWidth={2.4} />
              <Text style={styles.submitBtnText}>Submit</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function DatePicker({ label, value, minDate, open, onToggle, onPick }) {
  const days = useMemo(() => nextDays(30, minDate ? new Date(minDate) : new Date()), [minDate]);
  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={styles.dateBtn} onPress={onToggle} activeOpacity={0.85}>
        <View>
          <Text style={styles.dateBtnLabel}>{label}</Text>
          <Text style={styles.dateBtnValue}>
            {value.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </Text>
          <Text style={styles.dateBtnDow}>
            {DAYS_SHORT[value.getDay()]} · {value.getFullYear()}
          </Text>
        </View>
        <ChevronDown
          size={16}
          color={palette.purple.vivid}
          strokeWidth={2.4}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>
      {open ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: spacing.sm, gap: 6 }}
        >
          {days.map((d) => {
            const active = sameDay(d, value);
            const isToday = sameDay(d, new Date());
            return (
              <TouchableOpacity
                key={isoDate(d)}
                style={[styles.dayCell, active && styles.dayCellActive]}
                onPress={() => onPick(new Date(d))}
                activeOpacity={0.85}
              >
                <Text style={[styles.dayCellDow, active && { color: 'rgba(255,255,255,0.85)' }]}>
                  {DAYS_SHORT[d.getDay()].slice(0, 1)}
                </Text>
                <Text style={[styles.dayCellNum, active && { color: '#fff' }]}>{d.getDate()}</Text>
                {isToday && !active ? <View style={styles.todayDot} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function HistoryRow({ lr }) {
  const meta = STATUS_META[lr.status] || STATUS_META.pending;
  const StatusIcon = meta.icon;
  return (
    <View style={styles.historyRow}>
      <View style={[styles.historyIcon, { backgroundColor: meta.color.soft }]}>
        <StatusIcon size={14} color={meta.color.on} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.historyTop}>
          <Text style={styles.historyDates} numberOfLines={1}>
            {fmtRange(new Date(lr.start_date), new Date(lr.end_date))}
          </Text>
          <View style={[styles.historyStatus, { backgroundColor: meta.color.soft }]}>
            <Text style={[styles.historyStatusText, { color: meta.color.on }]}>{meta.label}</Text>
          </View>
        </View>
        {lr.reason ? <Text style={styles.historyReason} numberOfLines={2}>{lr.reason}</Text> : null}
        {lr.batch_name ? <Text style={styles.historyBatch}>{lr.batch_name}</Text> : null}
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
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

  // Active child card
  childCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    ...shadows.card,
  },
  childAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  childInitials: { color: '#fff', fontWeight: '800', fontSize: 14 },
  childChipLabel: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  childChipName: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  childChipChange: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  childChipChangeText: { ...type.micro, color: palette.purple.vivid, fontWeight: '700' },

  // Date row
  dateRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  dateBtn: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...shadows.card,
  },
  dateBtnLabel: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  dateBtnValue: { ...type.h2, color: palette.text, marginTop: 2 },
  dateBtnDow: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Day picker cells
  dayCell: {
    width: 44, height: 56,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
    marginHorizontal: 2,
  },
  dayCellActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  dayCellDow: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  dayCellNum: { ...type.h2, color: palette.text, fontSize: 16, marginTop: 2 },
  todayDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: palette.purple.vivid,
    marginTop: 2,
  },

  // Days pill
  daysPillRow: { paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  daysPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
    alignSelf: 'flex-start',
  },
  daysPillText: { ...type.caption, color: palette.purple.on, fontWeight: '800' },

  // Batch
  batchChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  batchChipActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  batchChipText: { ...type.caption, color: palette.text, fontWeight: '700', maxWidth: 200 },
  batchChipTextActive: { color: '#fff' },
  singleBatchLine: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  singleBatchText: { ...type.caption, color: palette.textMuted },

  // Reason
  reasonCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  reasonInput: {
    minHeight: 80,
    ...type.body,
    color: palette.text,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  reasonHint: { ...type.micro, color: palette.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },

  // History
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  historyIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyDates: { ...type.bodyBold, color: palette.text, flex: 1 },
  historyStatus: {
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  historyStatusText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  historyReason: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  historyBatch: { ...type.micro, color: palette.purple.vivid, fontWeight: '700', marginTop: 2 },

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

  // Sticky submit bar
  submitBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
    ...shadows.raised,
  },
  submitLabel: { ...type.bodyBold, color: palette.text },
  submitSub: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: palette.purple.vivid,
  },
  submitBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
});
