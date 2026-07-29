// src/screens/admin/AdminAttendanceOverviewScreen.js
//
// Institution Login → Home → Attendance tile → this screen.
// Read-only, batch-wise attendance summary for a picked date (defaults
// to TODAY). Shows one row per batch under the institution's scope
// with:
//   • Batch name + Course
//   • Trainer
//   • Total scheduled students
//   • Present / Absent counts (Late + Leave surfaced as small pills)
//   • Attendance percentage
//
// Tap a row → AdminAttendanceDetailScreen for the per-student roster.
//
// Filters (top of screen):
//   • Date (opens native picker via DateField)
//   • Course chip row
//   • Trainer chip row
//   • Batch search input
//
// Data source: GET /api/attendance/institution/by-batch?date=YYYY-MM-DD
// The backend auto-scopes to the caller's institution tree so a main
// admin sees all batches; a sub-branch admin sees only their own.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
  StyleSheet, RefreshControl, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Calendar, ChevronRight, Search, User, GraduationCap,
  ClipboardCheck, Percent, Users,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import { palette, spacing, radius, shadows, type } from '../../theme';

function todayIso() {
  const d = new Date();
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
}

export default function AdminAttendanceOverviewScreen({ navigation, route }) {
  // Institution Home → Branch View passes { branchId, branchName } so
  // this screen shows only that branch's batches. Absent → default
  // scope (main-institution batches for a main admin, own-branch for
  // sub-branch admin).
  const branchIdParam   = route?.params?.branchId ?? null;
  const branchNameParam = route?.params?.branchName ?? null;

  const [date, setDate]       = useState(todayIso());
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState('');

  // Filters
  const [courseFilter,  setCourseFilter]  = useState(null); // course_id or null
  const [trainerFilter, setTrainerFilter] = useState(null); // trainer_id or null
  const [query,         setQuery]         = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const branchQs = branchIdParam != null
        ? `&branch_id=${encodeURIComponent(branchIdParam)}`
        : '';
      const r = await apiClient.get(
        `/attendance/institution/by-batch?date=${encodeURIComponent(date)}${branchQs}`,
      );
      setRows(r.data?.batches || []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not load attendance.');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, branchIdParam]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Derive filter options from the loaded rows so the chips always
  // reflect what's actually on screen (empty scope → no chips).
  const courses = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (r.course_id && !map.has(r.course_id)) {
        map.set(r.course_id, r.course_name);
      }
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [rows]);

  const trainers = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      if (r.trainer_id && !map.has(r.trainer_id)) {
        map.set(r.trainer_id, r.trainer_name || 'Trainer');
      }
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [rows]);

  const visible = useMemo(() => {
    let out = rows;
    if (courseFilter)  out = out.filter((r) => r.course_id  === courseFilter);
    if (trainerFilter) out = out.filter((r) => r.trainer_id === trainerFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.course_name || '').toLowerCase().includes(q) ||
        (r.trainer_name || '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [rows, courseFilter, trainerFilter, query]);

  // Roll-up totals across the currently-visible rows.
  const rollup = useMemo(() => {
    let marked = 0, present = 0, students = 0;
    for (const r of visible) {
      marked   += r.marked   || 0;
      present  += r.present  || 0;
      students += r.total_students || 0;
    }
    const pct = marked > 0 ? Math.round((present / marked) * 100) : 0;
    return { marked, present, students, pct, batches: visible.length };
  }, [visible]);

  const openBatch = (row) => {
    navigation.navigate('AdminAttendanceDetail', {
      batchId:     row.batch_id,
      batchName:   row.name,
      courseName:  row.course_name,
      trainerName: row.trainer_name,
      date,
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {branchNameParam ? `${branchNameParam} — Attendance` : 'Attendance'}
          </Text>
          <Text style={styles.subtitle}>Batch-wise summary · {fmtDate(date)}</Text>
        </View>
        <View style={styles.headerBadge}>
          <ClipboardCheck size={14} color={palette.teal.on} strokeWidth={2.4} />
          <Text style={styles.headerBadgeText}>{rollup.pct}%</Text>
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.batch_id)}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Roll-up strip */}
            <View style={styles.rollupCard}>
              <RollupTile
                icon={Users}
                label="Students"
                value={rollup.students}
                accent={palette.purple}
              />
              <RollupTile
                icon={ClipboardCheck}
                label="Present"
                value={rollup.present}
                accent={palette.green}
              />
              <RollupTile
                icon={Percent}
                label="Overall"
                value={`${rollup.pct}%`}
                accent={palette.teal}
              />
            </View>

            {/* Date picker */}
            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>DATE</Text>
              <DateField
                value={date}
                onChange={(iso) => setDate(iso || todayIso())}
                placeholder="Pick a date"
              />
            </View>

            {/* Course chips */}
            {courses.length > 1 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>COURSE</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6 }}
                >
                  <FilterChip
                    label="All"
                    active={courseFilter == null}
                    onPress={() => setCourseFilter(null)}
                  />
                  {courses.map((c) => (
                    <FilterChip
                      key={c.id}
                      label={c.name}
                      active={courseFilter === c.id}
                      onPress={() => setCourseFilter(courseFilter === c.id ? null : c.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Trainer chips */}
            {trainers.length > 1 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>TRAINER</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6 }}
                >
                  <FilterChip
                    label="All"
                    active={trainerFilter == null}
                    onPress={() => setTrainerFilter(null)}
                  />
                  {trainers.map((t) => (
                    <FilterChip
                      key={t.id}
                      label={t.name}
                      active={trainerFilter === t.id}
                      onPress={() => setTrainerFilter(trainerFilter === t.id ? null : t.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Batch search */}
            <View style={styles.searchWrap}>
              <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search batch, course or trainer"
                placeholderTextColor={palette.textLight}
                style={styles.searchInput}
              />
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xl }} />
            ) : error ? (
              <Text style={styles.errorLine}>{error}</Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <BatchRow row={item} onPress={() => openBatch(item)} />}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyCard}>
              <ClipboardCheck size={30} color={palette.textLight} strokeWidth={1.8} />
              <Text style={styles.emptyTitle}>Nothing to show</Text>
              <Text style={styles.emptySub}>
                {rows.length === 0
                  ? 'No batches under your scope, or nothing marked for the picked date.'
                  : 'No batches match your filters.'}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

function RollupTile({ icon: Icon, label, value, accent }) {
  return (
    <View style={[styles.rollupTile, { backgroundColor: accent.soft }]}>
      <Icon size={14} color={accent.on} strokeWidth={2.4} />
      <Text style={[styles.rollupVal, { color: accent.on }]}>{value}</Text>
      <Text style={[styles.rollupLbl, { color: accent.on }]}>{label}</Text>
    </View>
  );
}

function FilterChip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function BatchRow({ row, onPress }) {
  const marked = row.marked || 0;
  const pctLbl = marked > 0 ? `${row.percentage}%` : '—';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.batchCard}>
      <View style={styles.batchTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.batchName} numberOfLines={1}>{row.name}</Text>
          <View style={styles.batchMetaRow}>
            <GraduationCap size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.batchMeta} numberOfLines={1}>{row.course_name}</Text>
          </View>
          <View style={styles.batchMetaRow}>
            <User size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.batchMeta} numberOfLines={1}>
              {row.trainer_name || 'No trainer assigned'}
            </Text>
          </View>
        </View>
        <View style={[
          styles.pctPill,
          {
            backgroundColor: marked === 0
              ? palette.borderSoft
              : row.percentage >= 75 ? palette.green.soft
                : row.percentage >= 40 ? palette.orange.soft
                  : palette.rose.soft,
          },
        ]}>
          <Text style={[
            styles.pctText,
            {
              color: marked === 0
                ? palette.textMuted
                : row.percentage >= 75 ? palette.green.on
                  : row.percentage >= 40 ? palette.orange.on
                    : palette.rose.on,
            },
          ]}>
            {pctLbl}
          </Text>
        </View>
      </View>

      <View style={styles.batchStats}>
        <MiniStat label="Students"  value={row.total_students} />
        <MiniStat label="Marked"    value={row.marked} />
        <MiniStat label="Present"   value={row.present}  accent={palette.green.on} />
        <MiniStat label="Absent"    value={row.absent}   accent={palette.rose.on} />
        {row.late  > 0 ? <MiniStat label="Late"  value={row.late}  accent={palette.orange.on} /> : null}
        {row.leave > 0 ? <MiniStat label="Leave" value={row.leave} accent={palette.blue.on} /> : null}
      </View>

      <View style={styles.batchFooter}>
        <Text style={styles.footerLink}>View student attendance</Text>
        <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
    </TouchableOpacity>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniVal, accent && { color: accent }]}>{value}</Text>
      <Text style={styles.miniLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
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
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: palette.teal.soft,
  },
  headerBadgeText: { ...type.micro, color: palette.teal.on, fontWeight: '800' },

  rollupCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  rollupTile: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  rollupVal: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  rollupLbl: { fontSize: 10, fontWeight: '800', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  filterBlock: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  filterLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.6, marginBottom: 6,
  },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  chipActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  chipText:  { ...type.caption, color: palette.text, fontWeight: '700' },
  chipTextActive: { color: '#fff' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 46,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  errorLine: {
    ...type.caption, color: palette.rose.on,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },

  batchCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  batchTop: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginBottom: spacing.sm,
  },
  batchName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  batchMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  batchMeta: { ...type.caption, color: palette.textMuted, flexShrink: 1 },

  pctPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  pctText: { fontSize: 13, fontWeight: '800' },

  batchStats: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  miniStat: { minWidth: 60 },
  miniVal: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  miniLbl: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 2 },

  batchFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    gap: 3, marginTop: spacing.sm,
  },
  footerLink: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },

  emptyCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },
});
