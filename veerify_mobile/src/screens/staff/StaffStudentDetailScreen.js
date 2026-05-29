// src/screens/staff/StaffStudentDetailScreen.js
//
// Step 5 of the Staff module - detailed student profile.
//
// Layout:
//   1. Hero - red gradient header with back button, big circular avatar,
//      name, gender + age, batch chip, belt category badge.
//   2. Stat strip - three pill cards (Attendance %, Sessions, Performance).
//   3. Recent attendance - mini bar chart of the last 14 sessions colored
//      per status.
//   4. Contact card - email, emergency contact icon (tap to call/email).
//   5. Parent details card - parent name + relationship + contact.
//   6. Belt progression - horizontal timeline with current belt highlighted.
//   7. Leave history - placeholder until /api/leave-requests lands.
//   8. Notes - inline editable section (saved to local state for now).
//
// Data:
//   Receives `student` and `batchId` via route params from StaffStudentsScreen.
//   GET /api/attendance/batch/:id  - records, filtered client-side to this
//                                    student for the chart + counters.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Linking, TextInput,
} from 'react-native';
import {
  ArrowLeft, Phone, Mail, Award, TrendingUp, TrendingDown, Minus,
  Calendar, Users, ClipboardList, FileText, Pencil,
  Plane, Clock, X as XIcon, Check,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];

// Stable belt index 0-6 derived from id - keeps the timeline consistent
// across screens until real belt levels are stored.
function beltIndexFor(id) {
  return Math.abs(Number(id) || 0) % BELTS.length;
}
function genderFor(id) { return Math.abs(Number(id) || 0) % 2 === 0 ? 'Male' : 'Female'; }
function ageFor(id)    { return 12 + (Math.abs(Number(id) || 0) % 24); }

const STATUS_META = {
  present: { color: palette.green.vivid,  bg: palette.green.soft,  label: 'Present', icon: Check  },
  absent:  { color: palette.rose.vivid,   bg: palette.rose.soft,   label: 'Absent',  icon: XIcon  },
  late:    { color: palette.orange.vivid, bg: palette.orange.soft, label: 'Late',    icon: Clock  },
  leave:   { color: palette.blue.vivid,   bg: palette.blue.soft,   label: 'Leave',   icon: Plane  },
};

function perfFor(pct) {
  if (pct >= 85) return { icon: TrendingUp,   color: palette.green.vivid,  bg: palette.green.soft,  label: 'Rising' };
  if (pct >= 65) return { icon: Minus,        color: palette.orange.vivid, bg: palette.orange.soft, label: 'Steady' };
  return            { icon: TrendingDown, color: palette.rose.vivid,   bg: palette.rose.soft,   label: 'At risk' };
}

function isoDate(d) { return d.toISOString().split('T')[0]; }

export default function StaffStudentDetailScreen({ navigation, route }) {
  const params = route?.params || {};
  const studentId = params.studentId;
  const batchId = params.batchId;
  const passedStudent = params.student || null;

  const [records, setRecords] = useState([]);    // attendance for this student
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');        // local-only for now
  const [editingNotes, setEditingNotes] = useState(false);

  // ── Pull attendance for this batch and filter client-side ──
  const load = useCallback(async () => {
    if (!batchId || !studentId) { setLoading(false); return; }
    try {
      const res = await apiClient.get(`/attendance/batch/${batchId}`).catch(() => ({ data: { attendance: [] } }));
      const mine = (res.data?.attendance || []).filter((r) => Number(r.student_id) === Number(studentId));
      // newest first by date
      mine.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      setRecords(mine);
    } finally {
      setLoading(false);
    }
  }, [batchId, studentId]);
  useEffect(() => { load(); }, [load]);

  // ── Derive everything from records + passed student ──
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    records.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
    return c;
  }, [records]);

  const totalSessions = records.length;
  const pct = totalSessions ? Math.round((counts.present / totalSessions) * 100) : null;
  const perf = perfFor(pct ?? 0);
  const PerfIcon = perf.icon;

  const recentSessions = records.slice(0, 14).reverse(); // for left-to-right chart

  const beltIdx = beltIndexFor(studentId);
  const currentBelt = BELTS[beltIdx];
  const nextBelt = BELTS[Math.min(beltIdx + 1, BELTS.length - 1)];

  const name = passedStudent?.student_name || passedStudent?.name || 'Student';
  const email = passedStudent?.student_email || passedStudent?.email || null;
  const gender = genderFor(studentId);
  const age = ageFor(studentId);
  const batchName = passedStudent?.batch_name || 'Batch';

  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // ── Actions ──
  const callOrAlert = () => {
    // Phone field will be added later. For now offer email if present.
    if (email) {
      Linking.openURL(`mailto:${email}`).catch(() => {});
    }
  };

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Hero header */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.heroIconBtn}>
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Student Profile</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.heroBody}>
          <View style={styles.heroAvatar}>
            <Text style={styles.heroAvatarText}>{initials}</Text>
          </View>
          <Text style={styles.heroName} numberOfLines={1}>{name}</Text>
          <View style={styles.heroMetaRow}>
            <Users size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
            <Text style={styles.heroMetaText}>{gender} · {age} yrs</Text>
            <View style={styles.heroDot} />
            <Calendar size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
            <Text style={styles.heroMetaText} numberOfLines={1}>{batchName}</Text>
          </View>
          <View style={[styles.heroBelt, { backgroundColor: currentBelt.bg, borderColor: currentBelt.border }]}>
            <Award size={11} color={currentBelt.fg} strokeWidth={2.4} />
            <Text style={[styles.heroBeltText, { color: currentBelt.fg }]}>{currentBelt.label} Belt</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Stat strip */}
        <View style={styles.statStrip}>
          <StatPill
            icon={Award}
            label="Attendance"
            value={pct === null ? '-' : `${pct}%`}
            accent={palette.green}
          />
          <StatPill
            icon={Calendar}
            label="Sessions"
            value={totalSessions}
            accent={palette.blue}
          />
          <StatPill
            icon={PerfIcon}
            label="Trend"
            value={perf.label}
            accent={{ soft: perf.bg, vivid: perf.color, on: perf.color }}
          />
        </View>

        {/* Recent attendance chart */}
        <Card title="Recent attendance" icon={ClipboardList}>
          {loading ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : recentSessions.length === 0 ? (
            <Text style={styles.placeholderText}>No attendance recorded yet.</Text>
          ) : (
            <>
              <View style={styles.chartRow}>
                {recentSessions.map((r, i) => {
                  const meta = STATUS_META[r.status] || STATUS_META.present;
                  const height = r.status === 'present' ? 36 : r.status === 'late' ? 26 : r.status === 'leave' ? 22 : 14;
                  return (
                    <View key={i} style={styles.chartBarWrap}>
                      <View style={[styles.chartBar, { height, backgroundColor: meta.color }]} />
                    </View>
                  );
                })}
              </View>
              {/* Legend with counts */}
              <View style={styles.legendRow}>
                <LegendItem label="Present" value={counts.present} status="present" />
                <LegendItem label="Late"    value={counts.late}    status="late"    />
                <LegendItem label="Leave"   value={counts.leave}   status="leave"   />
                <LegendItem label="Absent"  value={counts.absent}  status="absent"  />
              </View>
            </>
          )}
        </Card>

        {/* Contact card */}
        <Card title="Contact" icon={Phone}>
          <ContactRow
            icon={Mail}
            label="Email"
            value={email || 'Not provided'}
            onPress={email ? () => Linking.openURL(`mailto:${email}`).catch(() => {}) : null}
          />
          <View style={styles.divider} />
          <ContactRow
            icon={Phone}
            label="Emergency contact"
            value="Add a phone number to enable calling"
            muted
            onPress={callOrAlert}
            ctaLabel="Email"
          />
        </Card>

        {/* Parent details (placeholder) */}
        <Card title="Parent details" icon={Users}>
          <ContactRow icon={Users} label="Guardian" value="Not linked yet" muted />
          <Text style={styles.placeholderText}>
            Parent details appear once the student links a parent account.
          </Text>
        </Card>

        {/* Belt progression timeline */}
        <Card title="Belt progression" icon={Award}>
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
                  <View
                    style={[
                      styles.beltCircle,
                      {
                        backgroundColor: reached ? b.bg : palette.bg,
                        borderColor: reached ? b.border : palette.borderSoft,
                      },
                      current && { transform: [{ scale: 1.1 }] },
                    ]}
                  >
                    {reached ? (
                      <Award size={14} color={b.fg} strokeWidth={2.4} />
                    ) : (
                      <Text style={styles.beltStepNum}>{i + 1}</Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.beltStepLabel,
                      current && { color: palette.text, fontWeight: '800' },
                      next    && { color: palette.purple.vivid, fontWeight: '700' },
                    ]}
                  >
                    {b.label}
                  </Text>
                  {current ? <Text style={styles.beltStepPill}>Current</Text> : null}
                  {next    ? <Text style={[styles.beltStepPill, { color: palette.purple.on, backgroundColor: palette.purple.soft }]}>Next</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        </Card>

        {/* Leave history (placeholder) */}
        <Card title="Leave history" icon={Plane}>
          {counts.leave === 0 ? (
            <Text style={styles.placeholderText}>
              No sanctioned leave on record.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {records.filter((r) => r.status === 'leave').slice(0, 5).map((r, i) => (
                <View key={i} style={styles.leaveRow}>
                  <View style={styles.leaveDot} />
                  <Text style={styles.leaveDate}>{r.date?.slice?.(0, 10) || String(r.date)}</Text>
                  <Text style={styles.leaveLabel}>Marked as leave</Text>
                </View>
              ))}
              {counts.leave > 5 ? (
                <Text style={styles.placeholderText}>+ {counts.leave - 5} more</Text>
              ) : null}
            </View>
          )}
          <Text style={[styles.placeholderText, { marginTop: spacing.sm }]}>
            Formal leave requests appear here once approved in the Leave Requests screen.
          </Text>
        </Card>

        {/* Notes */}
        <Card
          title="Notes"
          icon={FileText}
          right={
            <TouchableOpacity
              onPress={() => setEditingNotes((v) => !v)}
              style={styles.cardActionBtn}
              activeOpacity={0.8}
            >
              <Pencil size={12} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.cardActionText}>{editingNotes ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          }
        >
          {editingNotes ? (
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note about this student..."
              placeholderTextColor={palette.textLight}
              multiline
              style={styles.notesInput}
            />
          ) : notes ? (
            <Text style={styles.notesText}>{notes}</Text>
          ) : (
            <Text style={styles.placeholderText}>
              No notes yet. Tap "Edit" to write something.
            </Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statPillIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statPillValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

function Card({ title, icon: Icon, right, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          {Icon ? (
            <View style={styles.cardHeaderIcon}>
              <Icon size={12} color={palette.purple.vivid} strokeWidth={2.4} />
            </View>
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        {right || null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function ContactRow({ icon: Icon, label, value, muted, onPress, ctaLabel }) {
  const Body = (
    <View style={styles.contactRow}>
      <View style={styles.contactIcon}>
        <Icon size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={[styles.contactValue, muted && { color: palette.textMuted }]} numberOfLines={1}>{value}</Text>
      </View>
      {onPress && ctaLabel ? (
        <View style={styles.contactCta}>
          <Text style={styles.contactCtaText}>{ctaLabel}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return Body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {Body}
    </TouchableOpacity>
  );
}

function LegendItem({ label, value, status }) {
  const meta = STATUS_META[status];
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Hero
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { ...type.h2, color: '#fff', fontWeight: '700' },
  heroBody: { alignItems: 'center', marginTop: spacing.lg },
  heroAvatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.md,
  },
  heroAvatarText: { color: palette.purple.vivid, fontSize: 28, fontWeight: '800' },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  heroMetaText: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  heroDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  heroBelt: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  heroBeltText: { ...type.caption, fontWeight: '800' },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: -spacing.md,
  },
  statPill: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'flex-start',
    ...shadows.card,
  },
  statPillIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statPillValue: { ...type.h1, color: palette.text, fontSize: 18 },
  statPillLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Card
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHeaderIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  cardActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  cardActionText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  placeholderText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },

  // Chart
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 40,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  chartBarWrap: { flex: 1, alignItems: 'center' },
  chartBar: { width: '100%', borderRadius: 3 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  legendValue: { ...type.micro, color: palette.text, fontWeight: '800' },

  // Contact
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  contactIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  contactLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  contactValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  contactCta: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  contactCtaText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },
  divider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.xs },

  // Belt timeline
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
  beltStepPill: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.green.soft,
    color: palette.green.on,
    marginTop: 4,
    overflow: 'hidden',
  },

  // Leave history
  leaveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leaveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue.vivid },
  leaveDate: { ...type.bodyBold, color: palette.text, minWidth: 80 },
  leaveLabel: { ...type.caption, color: palette.textMuted },

  // Notes
  notesInput: {
    minHeight: 80,
    ...type.body,
    color: palette.text,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  notesText: { ...type.body, color: palette.text, lineHeight: 22 },
});
