// src/screens/staff/StaffCompletedStudentsScreen.js
//
// Trainer's post-curriculum queue. Every student who finished the
// full curriculum on any of the trainer's courses lands here after
// the "Course completed. Proceed to Belt Test?" dialog resolves Yes.
//
// Fields per card:
//   • Student Name              (read-only)
//   • Course Name               (read-only)
//   • Course Completed Date     (read-only, auto-stamped)
//   • Belt Test Completed Date  (read-only, auto-stamped on submit)
//   • Test Remarks              (EDITABLE — the trainer types + saves)
//
// Rules:
//   • Submitting Test Remarks auto-stamps belt_test_completed_at and
//     flips the row's status to 'awaiting_certificate'. From that point
//     the row also shows up on the Institution admin's Certificates queue.
//   • Once status = 'certificate_sent', the remarks are locked.
//   • Nothing else on the card can be edited (spec: "All fields are
//     read-only except Test Remarks.").

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, CheckCircle2, Clock, ClipboardCheck,
  BookOpen, Save, Trophy, ShieldCheck, XCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const STATUS_META = {
  awaiting_test: {
    label:  'Awaiting Belt Test',
    accent: palette.orange,
    icon:   Clock,
  },
  awaiting_certificate: {
    label:  'Awaiting Certificate',
    accent: palette.blue,
    icon:   ShieldCheck,
  },
  certificate_sent: {
    label:  'Certificate Sent',
    accent: palette.green,
    icon:   Trophy,
  },
};

export default function StaffCompletedStudentsScreen({ navigation }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]             = useState('all');
  // Per-row editable remarks + save state.
  const [drafts, setDrafts]       = useState({}); // { id: 'text' }
  const [savingId, setSavingId]   = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/course-completions/trainer/mine');
      const list = r.data?.completions || [];
      setRows(list);
      // Seed drafts from server so the trainer sees whatever remarks
      // were previously typed.
      const seed = {};
      list.forEach((row) => { seed[row.id] = row.test_remarks || ''; });
      setDrafts(seed);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[CompletedStudents] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => {
    if (tab === 'all') return rows;
    return rows.filter((r) => r.status === tab);
  }, [rows, tab]);

  const counts = useMemo(() => ({
    all:                   rows.length,
    awaiting_test:         rows.filter((r) => r.status === 'awaiting_test').length,
    awaiting_certificate:  rows.filter((r) => r.status === 'awaiting_certificate').length,
    certificate_sent:      rows.filter((r) => r.status === 'certificate_sent').length,
  }), [rows]);

  const setDraft = (id, text) => setDrafts((prev) => ({ ...prev, [id]: text }));

  const submitRemarks = async (row) => {
    const remarks = (drafts[row.id] || '').trim();
    if (!remarks) {
      confirm({
        title: 'Add remarks first',
        message: 'Type a brief note about the belt-test outcome before saving.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      return;
    }
    setSavingId(row.id);
    try {
      const r = await apiClient.patch(`/course-completions/${row.id}/remarks`, {
        test_remarks: remarks,
      });
      const updated = r.data?.completion;
      if (updated) {
        setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, ...updated } : x)));
      }
      setTimeout(() => {
        confirm({
          title:       'Remarks saved',
          message:     'Belt test date recorded. The row now appears on your institution\'s Certificates queue.',
          variant:     'success',
          confirmText: 'Done',
          hideCancel:  true,
        });
      }, 260);
    } catch (err) {
      const msg = err?.response?.data?.message ||
                  'Could not save remarks. Please try again.';
      confirm({
        title: 'Save failed',
        message: msg,
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
          activeOpacity={0.85}
        >
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Completed Students</Text>
          <Text style={styles.subtitle}>
            {rows.length === 0 ? 'No completions yet' : `${rows.length} in the pipeline`}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Trophy size={13} color={palette.orange.on} strokeWidth={2.4} />
          <Text style={styles.headerBadgeText}>{counts.all}</Text>
        </View>
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        <TabPill label="All"                   count={counts.all}                  active={tab === 'all'}                  onPress={() => setTab('all')} />
        <TabPill label="Awaiting Test"         count={counts.awaiting_test}        active={tab === 'awaiting_test'}        onPress={() => setTab('awaiting_test')}        tone={palette.orange} />
        <TabPill label="Awaiting Certificate"  count={counts.awaiting_certificate} active={tab === 'awaiting_certificate'} onPress={() => setTab('awaiting_certificate')} tone={palette.blue} />
        <TabPill label="Certificate Sent"      count={counts.certificate_sent}     active={tab === 'certificate_sent'}     onPress={() => setTab('certificate_sent')}     tone={palette.green} />
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <ClipboardCheck size={32} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptySub}>
            Tick the last curriculum lesson from a student's profile to send them
            into this queue.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {visible.map((row) => (
            <CompletionCard
              key={row.id}
              row={row}
              draft={drafts[row.id] || ''}
              setDraft={(t) => setDraft(row.id, t)}
              saving={savingId === row.id}
              onSubmit={() => submitRemarks(row)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Card ───────────────────────────────────────────────────────────
function CompletionCard({ row, draft, setDraft, saving, onSubmit }) {
  const meta = STATUS_META[row.status] || STATUS_META.awaiting_test;
  const StatusIcon = meta.icon;
  const remarksLocked = row.status === 'certificate_sent';

  return (
    <View style={styles.card}>
      {/* Status ribbon */}
      <View style={[styles.ribbon, { backgroundColor: meta.accent.soft }]}>
        <StatusIcon size={12} color={meta.accent.on} strokeWidth={2.6} />
        <Text style={[styles.ribbonText, { color: meta.accent.on }]}>
          {meta.label}
        </Text>
      </View>

      {/* Student + course header */}
      <View style={styles.cardHeader}>
        <View style={styles.avatarPlaceholder}>
          <Award size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.studentName} numberOfLines={1}>{row.student_name}</Text>
          <View style={styles.courseRow}>
            <BookOpen size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.courseName} numberOfLines={1}>{row.course_name}</Text>
          </View>
        </View>
      </View>

      {/* Read-only detail grid */}
      <View style={styles.grid}>
        <ReadOnlyField
          label="Course Completed"
          value={fmtDate(row.course_completed_at)}
        />
        <ReadOnlyField
          label="Belt Test Completed"
          value={fmtDate(row.belt_test_completed_at)}
          hint={!row.belt_test_completed_at ? 'Auto-fills on submit' : null}
        />
      </View>

      {row.certificate_sent_at ? (
        <View style={styles.certSentPill}>
          <ShieldCheck size={11} color={palette.green.on} strokeWidth={2.6} />
          <Text style={styles.certSentPillText}>
            Certificate dispatched · {fmtDate(row.certificate_sent_at)}
          </Text>
        </View>
      ) : null}

      {/* Test Remarks — the ONLY editable field */}
      <View style={styles.remarksBlock}>
        <View style={styles.remarksHead}>
          <Text style={styles.remarksLabel}>Test Remarks</Text>
          {remarksLocked ? (
            <Text style={styles.lockedNote}>Locked · certificate sent</Text>
          ) : null}
        </View>
        <TextInput
          style={[
            styles.remarksInput,
            remarksLocked && styles.remarksInputLocked,
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder="e.g. Excellent form on kata; ready for orange belt."
          placeholderTextColor={palette.textLight}
          multiline
          editable={!remarksLocked}
          maxLength={500}
        />

        {!remarksLocked ? (
          <TouchableOpacity
            onPress={onSubmit}
            disabled={saving}
            activeOpacity={0.85}
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save size={14} color="#fff" strokeWidth={2.6} />
                <Text style={styles.saveBtnText}>
                  {row.status === 'awaiting_test' ? 'Submit & mark test done' : 'Update remarks'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function ReadOnlyField({ label, value, hint }) {
  return (
    <View style={styles.roField}>
      <Text style={styles.roLabel}>{label}</Text>
      <Text style={styles.roValue}>{value}</Text>
      {hint ? <Text style={styles.roHint}>{hint}</Text> : null}
    </View>
  );
}

function TabPill({ label, count, active, onPress, tone }) {
  const accent = tone || palette.purple;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.tabPill,
        active && { backgroundColor: accent.vivid, borderColor: accent.vivid },
      ]}
    >
      <Text
        style={[
          styles.tabPillText,
          active && { color: '#fff' },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.tabCount,
          active && { backgroundColor: 'rgba(255,255,255,0.2)' },
        ]}
      >
        <Text style={[styles.tabCountText, active && { color: '#fff' }]}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: palette.bg },
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
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.orange.soft,
  },
  headerBadgeText: { ...type.micro, color: palette.orange.on, fontWeight: '800' },

  tabsRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  tabPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  tabPillText: { ...type.caption, color: palette.text, fontWeight: '700' },
  tabCount:    {
    minWidth: 22, paddingHorizontal: 6, height: 18,
    borderRadius: 9, backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tabCountText: { ...type.micro, color: palette.text, fontWeight: '800' },

  emptyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  ribbon: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.md,
  },
  ribbonText: { ...type.micro, fontWeight: '800', letterSpacing: 0.4 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  avatarPlaceholder: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  studentName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  courseRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  courseName:  { ...type.caption, color: palette.textMuted, fontWeight: '700', flexShrink: 1 },

  grid: {
    flexDirection: 'row', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roField: {
    flex: 1,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  roLabel: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  roValue: {
    ...type.bodyBold, color: palette.text,
    fontSize: 13, marginTop: 4,
  },
  roHint: {
    ...type.micro, color: palette.textLight,
    fontWeight: '600', marginTop: 2,
  },

  certSentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.green.soft,
    marginBottom: spacing.md,
  },
  certSentPillText: { ...type.micro, color: palette.green.on, fontWeight: '800' },

  remarksBlock: { gap: spacing.sm },
  remarksHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  remarksLabel: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  lockedNote: { ...type.micro, color: palette.textLight, fontWeight: '700' },
  remarksInput: {
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    padding: spacing.sm,
    fontSize: 14, color: palette.text,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  remarksInputLocked: {
    backgroundColor: palette.bg,
    color: palette.textMuted,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: 4,
  },
  saveBtnText: {
    color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3,
  },
});
