// src/screens/staff/StaffStudentsScreen.js
//
// Step 4 of the Staff module - batch-wise students roster.
//
// Layout (top to bottom):
//   1. Header - back arrow + "Students" + roster size badge.
//   2. Search bar - filter by name / email.
//   3. Batch tabs - horizontal chips, all-batches plus one per assigned batch.
//   4. Belt filter pills - White / Yellow / Orange / Green / Blue / Brown / Black + All.
//   5. Grid of student cards - avatar, name, gender + age, belt badge,
//      attendance % bar, emergency icon, performance dot.
//
// Data:
//   GET /api/batches/trainer/my       - the batch tabs
//   GET /api/enrollments/batch/:id    - students per batch (name + email)
//   GET /api/attendance/batch/:id     - records for computing attendance %
//
// Placeholder fields:
//   gender, age, belt_level, emergency_contact, performance are not in the DB
//   yet. We derive a stable belt-by-student-id so the UI looks populated, and
//   show "-" / default icons for the others. Wire real columns once the
//   student profile migration lands.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, Alert,
} from 'react-native';
import {
  ArrowLeft, Search, Users, Phone, ChevronRight,
  TrendingUp, TrendingDown, Minus, Award, Filter,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

// ── Belt catalog ──────────────────────────────────────────────────────────
// Color tokens mirror the literal belt strap colors. We pick one belt per
// student deterministically from their id so the UI doesn't feel random
// between renders.
const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltFor = (id) => BELTS[Math.abs(Number(id) || 0) % BELTS.length];

// Synthesized age (12-35) and gender pattern from id so the visual feels
// alive. Real values will replace these once the migration adds them.
const genderFor = (id) => (Math.abs(Number(id) || 0) % 2 === 0 ? 'Male' : 'Female');
const ageFor    = (id) => 12 + (Math.abs(Number(id) || 0) % 24);

// Performance bucket from attendance %.
//   >=85 -> rising green, 65-84 -> flat amber, <65 -> declining rose.
function perfFor(pct) {
  if (pct >= 85) return { icon: TrendingUp,   color: palette.green.vivid, label: 'Rising' };
  if (pct >= 65) return { icon: Minus,        color: palette.orange.vivid, label: 'Steady' };
  return            { icon: TrendingDown, color: palette.rose.vivid,   label: 'At risk' };
}

export default function StaffStudentsScreen({ navigation }) {
  const [batches, setBatches] = useState([]);
  const [activeBatch, setActiveBatch] = useState('all'); // 'all' | batchId
  const [studentsByBatch, setStudentsByBatch] = useState({}); // { batchId: [{...}] }
  const [pctByStudent, setPctByStudent] = useState({});       // { student_id: percentage }
  const [search, setSearch] = useState('');
  const [beltFilter, setBeltFilter] = useState(null); // null = all
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Load everything ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const batchRes = await apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } }));
      const list = batchRes.data?.batches || [];
      setBatches(list);

      if (list.length === 0) {
        setStudentsByBatch({});
        setPctByStudent({});
        return;
      }

      // Fetch enrollments + attendance for every batch in parallel.
      const enrollResults = await Promise.all(
        list.map((b) =>
          apiClient.get(`/enrollments/batch/${b.id}`).catch(() => ({ data: { enrollments: [] } })),
        ),
      );
      const attendanceResults = await Promise.all(
        list.map((b) =>
          apiClient.get(`/attendance/batch/${b.id}`).catch(() => ({ data: { attendance: [] } })),
        ),
      );

      const sbb = {};
      list.forEach((b, i) => {
        sbb[b.id] = (enrollResults[i].data?.enrollments || []).map((e) => ({ ...e, batch_id: b.id, batch_name: b.name }));
      });
      setStudentsByBatch(sbb);

      // Compute attendance % per student across all their records.
      const totals = {}; // { sid: { present: 0, total: 0 } }
      attendanceResults.forEach((r) => {
        (r.data?.attendance || []).forEach((rec) => {
          const t = totals[rec.student_id] || (totals[rec.student_id] = { present: 0, total: 0 });
          t.total++;
          if (rec.status === 'present') t.present++;
        });
      });
      const pct = {};
      Object.entries(totals).forEach(([sid, { present, total }]) => {
        pct[sid] = total > 0 ? Math.round((present / total) * 100) : null;
      });
      setPctByStudent(pct);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Build a unified student list (de-duped by id when activeBatch === 'all') ──
  const allStudents = useMemo(() => {
    const flat = [];
    if (activeBatch === 'all') {
      const seen = new Set();
      Object.values(studentsByBatch).forEach((arr) => {
        arr.forEach((s) => {
          if (seen.has(s.student_id)) return;
          seen.add(s.student_id);
          flat.push(s);
        });
      });
    } else {
      (studentsByBatch[activeBatch] || []).forEach((s) => flat.push(s));
    }
    return flat;
  }, [studentsByBatch, activeBatch]);

  // ── Search + belt filter ──
  const visibleStudents = useMemo(() => {
    let arr = allStudents;
    if (beltFilter) {
      arr = arr.filter((s) => beltFor(s.student_id).key === beltFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((s) =>
        (s.student_name || '').toLowerCase().includes(q) ||
        (s.student_email || '').toLowerCase().includes(q),
      );
    }
    return arr;
  }, [allStudents, beltFilter, search]);

  // ── Top counter for the header ──
  const totalCount = allStudents.length;

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Students</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Loading...' : `${totalCount} ${totalCount === 1 ? 'student' : 'students'} across your batches`}
          </Text>
        </View>
        <View style={styles.headerCountPill}>
          <Users size={12} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.headerCountText}>{totalCount}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or email"
            placeholderTextColor={palette.textLight}
            style={styles.searchInput}
          />
        </View>

        {/* Batch tabs */}
        <View style={styles.sectionLabel}>
          <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>BATCH</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
        >
          <BatchTab
            label="All batches"
            count={Object.values(studentsByBatch).reduce((acc, arr) => {
              arr.forEach((s) => acc.add(s.student_id));
              return acc;
            }, new Set()).size}
            active={activeBatch === 'all'}
            onPress={() => setActiveBatch('all')}
          />
          {batches.map((b) => (
            <BatchTab
              key={b.id}
              label={b.name}
              count={(studentsByBatch[b.id] || []).length}
              active={activeBatch === b.id}
              onPress={() => setActiveBatch(b.id)}
            />
          ))}
        </ScrollView>

        {/* Belt filter */}
        <View style={styles.sectionLabel}>
          <Filter size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>BELT</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.xs }}
        >
          <BeltChip
            label="All"
            active={!beltFilter}
            onPress={() => setBeltFilter(null)}
          />
          {BELTS.map((b) => (
            <BeltChip
              key={b.key}
              label={b.label}
              belt={b}
              active={beltFilter === b.key}
              onPress={() => setBeltFilter(b.key)}
            />
          ))}
        </ScrollView>

        {/* Students grid / list */}
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : visibleStudents.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {allStudents.length === 0 ? 'No students yet' : 'No matches'}
            </Text>
            <Text style={styles.emptySub}>
              {allStudents.length === 0
                ? 'Once students enroll into your batches, they appear here.'
                : 'Try clearing the search or belt filter.'}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {visibleStudents.map((s) => (
              <StudentCard
                key={`${s.student_id}-${s.batch_id}`}
                student={s}
                attendancePct={pctByStudent[s.student_id]}
                onPress={() => navigation.navigate('StaffStudentDetail', { studentId: s.student_id, batchId: s.batch_id, student: s })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function BatchTab({ label, count, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.batchTab, active && styles.batchTabActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.batchTabLabel, active && styles.batchTabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.batchTabCount, active && styles.batchTabCountActive]}>
        <Text style={[styles.batchTabCountText, active && styles.batchTabCountTextActive]}>{count}</Text>
      </View>
    </TouchableOpacity>
  );
}

function BeltChip({ label, belt, active, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.beltChip,
        active && (belt
          ? { backgroundColor: belt.bg, borderColor: belt.border }
          : { backgroundColor: palette.text, borderColor: palette.text }),
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {belt && active ? <View style={[styles.beltSwatch, { backgroundColor: belt.border }]} /> : null}
      <Text
        style={[
          styles.beltChipText,
          active && belt && { color: belt.fg },
          active && !belt && { color: '#fff' },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StudentCard({ student, attendancePct, onPress }) {
  const initials = (student.student_name || 'S')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const belt = beltFor(student.student_id);
  const gender = genderFor(student.student_id);
  const age = ageFor(student.student_id);

  const pct = attendancePct === null || attendancePct === undefined ? null : attendancePct;
  const pctLabel = pct === null ? 'No data' : `${pct}%`;
  const perf = perfFor(pct ?? 0);
  const PerfIcon = perf.icon;

  const callEmergency = () => {
    if (!student.student_email) {
      Alert.alert('Emergency contact', 'No emergency contact saved for this student yet.');
      return;
    }
    Alert.alert(
      'Emergency contact',
      `Reach out via ${student.student_email}.\n(Phone contact will be added once the student profile fields land.)`,
    );
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.cardTop}>
        <View style={styles.cardAvatar}>
          <Text style={styles.cardAvatarText}>{initials}</Text>
        </View>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); callEmergency(); }}
          style={styles.emergencyBtn}
          activeOpacity={0.75}
        >
          <Phone size={12} color={palette.rose.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardName} numberOfLines={1}>{student.student_name || 'Student'}</Text>
      <Text style={styles.cardMeta}>{gender} · {age} yrs</Text>

      {/* Belt badge */}
      <View
        style={[
          styles.beltBadge,
          { backgroundColor: belt.bg, borderColor: belt.border },
        ]}
      >
        <Award size={10} color={belt.fg} strokeWidth={2.4} />
        <Text style={[styles.beltBadgeText, { color: belt.fg }]}>{belt.label} Belt</Text>
      </View>

      {/* Attendance bar */}
      <View style={styles.pctRow}>
        <Text style={styles.pctLabel}>Attendance</Text>
        <Text style={[styles.pctValue, pct === null && { color: palette.textLight }]}>{pctLabel}</Text>
      </View>
      <View style={styles.pctBarTrack}>
        <View
          style={[
            styles.pctBarFill,
            {
              width: `${pct === null ? 0 : pct}%`,
              backgroundColor:
                pct === null ? palette.borderSoft :
                pct >= 85 ? palette.green.vivid :
                pct >= 65 ? palette.orange.vivid :
                palette.rose.vivid,
            },
          ]}
        />
      </View>

      {/* Footer: performance + chevron */}
      <View style={styles.cardFooter}>
        <View style={styles.perfRow}>
          <View style={[styles.perfDot, { backgroundColor: perf.color }]} />
          <PerfIcon size={11} color={perf.color} strokeWidth={2.6} />
          <Text style={[styles.perfText, { color: perf.color }]}>{perf.label}</Text>
        </View>
        <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
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
  headerCountPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  headerCountText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Search
  searchWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  searchInput: { flex: 1, ...type.body, paddingVertical: 10, color: palette.text },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },

  // Batch tab
  batchTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  batchTabActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  batchTabLabel: { ...type.caption, color: palette.text, fontWeight: '700', maxWidth: 140 },
  batchTabLabelActive: { color: '#fff' },
  batchTabCount: {
    minWidth: 22, paddingHorizontal: 6, height: 18,
    borderRadius: 9,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  batchTabCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  batchTabCountText: { ...type.micro, color: palette.text, fontWeight: '800' },
  batchTabCountTextActive: { color: '#fff' },

  // Belt chip
  beltChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  beltChipText: { ...type.caption, color: palette.text, fontWeight: '700' },
  beltSwatch: { width: 8, height: 8, borderRadius: 4 },

  // Grid
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  card: {
    width: '47.5%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardAvatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.vivid,
  },
  cardAvatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  emergencyBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.rose.soft,
  },
  cardName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  cardMeta: { ...type.micro, color: palette.textMuted, marginTop: 1, fontWeight: '700' },

  beltBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  beltBadgeText: { ...type.micro, fontWeight: '700' },

  pctRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.md,
  },
  pctLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  pctValue: { ...type.bodyBold, color: palette.text },
  pctBarTrack: {
    height: 4, borderRadius: 2, marginTop: 4,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
  },
  pctBarFill: { height: '100%', borderRadius: 2 },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  perfRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  perfDot: { width: 6, height: 6, borderRadius: 3 },
  perfText: { ...type.micro, fontWeight: '700' },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
