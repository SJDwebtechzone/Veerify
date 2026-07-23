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
//   GET /api/enrollments/trainer/my-students — one-shot: every student
//        across every batch the trainer teaches, with name / phone /
//        photo / course / batch / branch / payment fields.
//   GET /api/attendance/batch/:id            — records for computing
//        attendance % per student.
//
// Fallback:
//   If the trainer has no batches at all (`has_batches === false`), we
//   show the "No students assigned" empty state so the trainer knows
//   the reason — no batches yet vs batches exist but empty.
//
// Placeholder fields (belt, age, performance) are still derived client-
// side until the belt-promotion + DOB fields fully replace them.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, Alert, Image,
} from 'react-native';
import {
  ArrowLeft, Search, Users, Phone, ChevronRight,
  TrendingUp, TrendingDown, Minus, Award, Filter,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';

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
  { key: 'gray',   label: 'Gray',   bg: '#F3F4F6', fg: '#374151', border: '#9CA3AF' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
// "New student" / "Other" / unset fallback tile — greyed out so the
// UI doesn't imply a belt the student hasn't actually earned.
const BELT_NONE = {
  key: 'none', label: 'New student',
  bg: '#F9FAFB', fg: '#6B7280', border: '#D1D5DB',
};

// Aliases so common variations of a belt name all resolve to the
// same tile. Handles British / American spelling ("grey" / "gray"),
// legacy labels ("half-blue" → blue), and the "New student" opt-out.
// Keys are lowercase, no punctuation. Every alias points at either a
// BELT key or the string 'none' for the greyed BELT_NONE tile.
const BELT_ALIASES = {
  white:      'white',
  yellow:     'yellow',
  orange:     'orange',
  green:      'green',
  blue:       'blue',
  gray:       'gray',
  grey:       'gray',   // British spelling → American key
  brown:      'brown',
  black:      'black',
  none:       'none',
  'new':      'none',
  beginner:   'none',
};

// Resolve the real belt from student_profiles.belt_category — a
// value the admin picks from a curated list ("White", "Yellow",
// "Blue I", "Brown III", "Black", "Grey", ...) or types via the
// "Other" free-text option.
//
// Matcher:
//   1. Trim + lowercase the value.
//   2. Strip a trailing " belt" suffix so "Grey Belt" and "Grey"
//      both resolve.
//   3. Take the first word (so "Blue I", "Brown III", "Blue Belt"
//      all reduce to their base colour).
//   4. Look that word up in BELT_ALIASES.
//   5. If no alias matches, fall back to the Black tile with the
//      original label — for "Other" values like "Assistant
//      Instructor" or a custom dan grade, this honestly shows the
//      exact text the admin typed instead of guessing a colour.
function beltFor(row) {
  const raw = (row && row.belt_category) || null;
  if (!raw) return BELT_NONE;
  // Normalise: lowercase → strip trailing " belt" → take first word.
  let key = String(raw).trim().toLowerCase();
  key = key.replace(/\s+belt$/i, '').trim();
  const firstWord = key.split(/\s+/)[0];
  if (!firstWord || firstWord === 'new' || firstWord === 'none') return BELT_NONE;
  const canonical = BELT_ALIASES[firstWord];
  if (canonical === 'none') return BELT_NONE;
  if (canonical) {
    const match = BELTS.find((b) => b.key === canonical);
    if (match) return { ...match, label: String(raw) };
  }
  // Custom "Other" label — surface the exact text (e.g. "Assistant
  // Instructor") over the black tile so the badge reads honestly
  // instead of masquerading as a lookalike colour.
  return { ...BELTS[BELTS.length - 1], label: String(raw) };
}

// Synthesized age (12-35) and gender pattern from id so the visual feels
// alive. Real values will replace these once the migration adds them.
const genderFor = (id) => (Math.abs(Number(id) || 0) % 2 === 0 ? 'Male' : 'Female');

// Pretty-prints a skill name from the trainer's lowercased specialisation
// for the cross-branch hint: "karate" → "Karate", "self defense" →
// "Self Defense". Falls back to the raw string when input is empty.
const titleCase = (s) =>
  String(s || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
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
  // Cross-branch view metadata — surfaces the skill-filter hint when
  // the trainer has switched to another branch. The hint reads:
  // "Showing batches matching: Karate · Yoga" (or "No matching courses
  // here" when the filter zeroes the list).
  const [crossBranch, setCrossBranch] = useState(false);
  const [trainerSkills, setTrainerSkills] = useState([]);
  const [filteredBySkills, setFilteredBySkills] = useState(false);
  const [activeBatch, setActiveBatch] = useState('all'); // 'all' | batchId
  const [studentsByBatch, setStudentsByBatch] = useState({}); // { batchId: [{...}] }
  const [pctByStudent, setPctByStudent] = useState({});       // { student_id: percentage }
  const [search, setSearch] = useState('');
  const [beltFilter, setBeltFilter] = useState(null); // null = all
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Branch picker ──
  // Lists every institution under the same main-branch group as the
  // trainer's home institution. Selecting a non-home branch re-fetches
  // batches/enrollments scoped to that branch (cross-branch mode) — the
  // trainer can mark attendance / performance there exactly like their
  // own institution.
  const [accessibleBranches, setAccessibleBranches] = useState([]);
  const [homeBranchId, setHomeBranchId]             = useState(null);
  const [selectedBranchId, setSelectedBranchId]     = useState(null);
  const [branchPickerOpen, setBranchPickerOpen]     = useState(false);

  // Fetch the list of branches accessible to this trainer once. Used to
  // populate the dropdown above the search bar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiClient.get('/branches/accessible');
        if (cancelled) return;
        const branches = Array.isArray(r.data?.branches) ? r.data.branches : [];
        setAccessibleBranches(branches);
        const home = r.data?.home_institution_id || null;
        setHomeBranchId(home);
        // Default to viewing the trainer's home institution.
        if (home) setSelectedBranchId(home);
      } catch (_e) { /* keep dropdown empty — picker just won't show */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Whether the trainer actually has any batches assigned — powers the
  // "No batches assigned" empty state message vs "No students yet".
  const [hasBatches, setHasBatches] = useState(true);

  // ── Load everything ──
  //
  // Cross-branch path (viewing a sister branch) keeps the legacy fetch:
  //   /batches/trainer/my?institution_id=X + /enrollments/batch/:id.
  //
  // Home-branch path (default) uses the one-shot
  //   /enrollments/trainer/my-students
  // endpoint, which returns every student across every batch the trainer
  // teaches with the full detail (photo, phone, course, batch, branch)
  // in a single query. Attendance % is still computed per-batch in
  // parallel from /attendance/batch/:id.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const isCrossBranch = selectedBranchId && selectedBranchId !== homeBranchId;

      if (isCrossBranch) {
        // ── Cross-branch (sister branch) — legacy path ────────────
        const batchRes = await apiClient
          .get(`/batches/trainer/my?institution_id=${selectedBranchId}`)
          .catch(() => ({ data: { batches: [] } }));
        const list = batchRes.data?.batches || [];
        setBatches(list);
        setCrossBranch(!!batchRes.data?.cross_branch);
        setTrainerSkills(Array.isArray(batchRes.data?.trainer_skills) ? batchRes.data.trainer_skills : []);
        setFilteredBySkills(!!batchRes.data?.filtered_by_skills);
        setHasBatches(list.length > 0);
        setActiveBatch('all');

        if (list.length === 0) {
          setStudentsByBatch({});
          setPctByStudent({});
          return;
        }

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
          sbb[b.id] = (enrollResults[i].data?.enrollments || []).map((e) => ({
            ...e,
            batch_id:    b.id,
            batch_name:  b.name,
            course_id:   b.course_id,
            course_name: b.course_name,
          }));
        });
        setStudentsByBatch(sbb);

        const totals = {};
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
        return;
      }

      // ── Home branch — one-shot trainer roster ────────────────
      const rosterRes = await apiClient
        .get('/enrollments/trainer/my-students')
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.log('[StaffStudents] trainer roster load error:',
            err?.response?.status, err?.response?.data);
          return { data: { students: [], has_batches: false, diagnostic: 'request_failed' } };
        });
      const students = rosterRes.data?.students || [];
      setCrossBranch(false);
      setTrainerSkills([]);
      setFilteredBySkills(false);
      setHasBatches(!!rosterRes.data?.has_batches);
      setActiveBatch('all');

      // Group the roster back into a { batchId: [rows] } shape so the
      // Batch tabs keep working (same downstream code path).
      const sbb = {};
      const seenBatch = new Map();
      students.forEach((s) => {
        const bid = s.batch_id;
        if (!sbb[bid]) sbb[bid] = [];
        sbb[bid].push(s);
        if (!seenBatch.has(bid)) {
          seenBatch.set(bid, {
            id: bid,
            name: s.batch_name,
            course_id: s.course_id,
            course_name: s.course_name,
            branch_name: s.batch_branch_name,
            branch_id:   s.batch_branch_id,
          });
        }
      });
      setBatches(Array.from(seenBatch.values()));
      setStudentsByBatch(sbb);

      // Fetch attendance for each batch in parallel to compute %.
      const batchIds = Array.from(seenBatch.keys());
      const attendanceResults = await Promise.all(
        batchIds.map((bid) =>
          apiClient.get(`/attendance/batch/${bid}`)
            .catch(() => ({ data: { attendance: [] } })),
        ),
      );
      const totals = {};
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
  }, [selectedBranchId, homeBranchId]);
  useEffect(() => { load(); }, [load]);
  // Auto-refresh when the trainer navigates back to this tab (e.g. after
  // an admin assigns them a new batch). Prevents needing a manual pull.
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      arr = arr.filter((s) => beltFor(s).key === beltFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter((s) =>
        (s.student_name  || '').toLowerCase().includes(q) ||
        (s.student_email || '').toLowerCase().includes(q) ||
        (s.student_phone || '').toLowerCase().includes(q) ||
        (s.course_name   || '').toLowerCase().includes(q) ||
        (s.batch_name    || '').toLowerCase().includes(q),
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
        {/* Branch picker — sits above the search bar. Only renders when
            the trainer's group has more than one institution (main branch
            + at least one sub-branch). Selecting a different branch
            re-fetches batches scoped to that branch via the new
            cross-branch path in /batches/trainer/my. */}
        {accessibleBranches.length > 1 ? (
          <View style={styles.branchPickerWrap}>
            <Text style={styles.branchPickerLabel}>BRANCH</Text>
            <TouchableOpacity
              style={[styles.branchPickerTrigger, branchPickerOpen && styles.branchPickerTriggerOpen]}
              onPress={() => setBranchPickerOpen((o) => !o)}
              activeOpacity={0.85}
            >
              <Users size={14} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.branchPickerTriggerText} numberOfLines={1}>
                {(() => {
                  const cur = accessibleBranches.find((b) => b.id === selectedBranchId);
                  if (!cur) return 'Choose a branch';
                  const tag = cur.is_main ? 'Main' : 'Sub-branch';
                  const home = cur.is_home ? ' · My institution' : '';
                  return `${cur.name} · ${tag}${home}`;
                })()}
              </Text>
              <Text style={styles.branchPickerCaret}>{branchPickerOpen ? '▴' : '▾'}</Text>
            </TouchableOpacity>

            {branchPickerOpen ? (
              <View style={styles.branchPickerPanel}>
                {accessibleBranches.map((b) => {
                  const on = b.id === selectedBranchId;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.branchPickerItem, on && styles.branchPickerItemActive]}
                      onPress={() => {
                        setSelectedBranchId(b.id);
                        setBranchPickerOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.branchPickerItemText,
                            on && styles.branchPickerItemTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {b.name}
                          {b.is_home ? '  · My institution' : ''}
                        </Text>
                        {b.city || b.pincode ? (
                          <Text style={styles.branchPickerItemSub} numberOfLines={1}>
                            {[b.city, b.pincode].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                      <View
                        style={[
                          styles.branchPickerBadge,
                          { backgroundColor: b.is_main ? palette.purple.soft : palette.blue.soft },
                        ]}
                      >
                        <Text style={[styles.branchPickerBadgeText, { color: b.is_main ? palette.purple.on : palette.blue.on }]}>
                          {b.is_main ? 'Main' : 'Sub'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Skill-filter hint — only visible when the trainer is viewing
            a sister branch's roster. Tells them WHY the batch list looks
            short: it's been filtered to course categories that match
            their specialisation. Hides when they're on their home branch
            (which already shows trainer-assigned batches only). */}
        {crossBranch && filteredBySkills ? (
          <View style={styles.skillHintWrap}>
            <Text style={styles.skillHintText}>
              {batches.length === 0
                ? `No matching courses here. None of this branch's course categories match your skills (${trainerSkills.map(titleCase).join(' · ')}).`
                : `Showing batches matching your skills · ${trainerSkills.map(titleCase).join(' · ')}`}
            </Text>
          </View>
        ) : null}

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, phone, course or batch"
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
              {!hasBatches
                ? 'No batches assigned to you yet'
                : allStudents.length === 0
                  ? 'No students yet'
                  : 'No matches'}
            </Text>
            <Text style={styles.emptySub}>
              {!hasBatches
                ? 'Ask your institution admin to open Batches → Edit and pick you as the trainer. Once a batch is assigned, its students will appear here automatically.'
                : allStudents.length === 0
                  ? 'Your batches don’t have anyone enrolled yet. New enrollments show up here automatically.'
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
  const belt = beltFor(student);
  const gender = student.student_gender || genderFor(student.student_id);
  const age = ageFor(student.student_id);
  // Photo — the new /trainer/my-students endpoint returns photo_url when
  // student_profiles has one. Falls back to initials-in-purple avatar.
  const photoUrl = student.student_photo_url
    ? resolveAssetUrl(student.student_photo_url)
    : null;
  // Branch label — "Main Institution" for main-institution batches,
  // else the sub-branch's name. Only display when present so we don't
  // clutter the card with an empty pill on legacy data.
  const branchName = student.batch_branch_name || null;

  const pct = attendancePct === null || attendancePct === undefined ? null : attendancePct;
  const pctLabel = pct === null ? 'No data' : `${pct}%`;
  const perf = perfFor(pct ?? 0);
  const PerfIcon = perf.icon;

  const callStudent = () => {
    // Prefer phone — the trainer wants to actually call. Fall back to
    // email if we don't have a number, and to a friendly message if
    // neither is on file.
    if (student.student_phone) {
      const cleaned = String(student.student_phone).replace(/[^0-9+]/g, '');
      if (cleaned) {
        Linking.openURL(`tel:${cleaned}`).catch(() =>
          Alert.alert('Could not place call', 'Your device did not accept the dialer link.'),
        );
        return;
      }
    }
    if (student.student_email) {
      Linking.openURL(`mailto:${student.student_email}`).catch(() =>
        Alert.alert('Could not open email', 'No email client found.'),
      );
      return;
    }
    Alert.alert('No contact on file', 'This student has no phone or email saved.');
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.cardTop}>
        <View style={styles.cardAvatar}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.cardAvatarImg}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.cardAvatarText}>{initials}</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); callStudent(); }}
          style={styles.emergencyBtn}
          activeOpacity={0.75}
        >
          <Phone size={12} color={palette.rose.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardName} numberOfLines={1}>{student.student_name || 'Student'}</Text>
      <Text style={styles.cardMeta}>{gender} · {age} yrs</Text>

      {/* Course · Batch line — the two things the trainer most needs
          to know at a glance. */}
      {(student.course_name || student.batch_name) ? (
        <Text style={styles.cardCourseLine} numberOfLines={2}>
          {[student.course_name, student.batch_name].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {/* Branch pill — only when present. */}
      {branchName ? (
        <View style={styles.branchPill}>
          <Text style={styles.branchPillText} numberOfLines={1}>{branchName}</Text>
        </View>
      ) : null}

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

  // ── Branch picker (above search) ──────────────────────────────────────
  branchPickerWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  branchPickerLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  branchPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  branchPickerTriggerOpen: {
    borderColor: palette.purple.vivid,
  },
  branchPickerTriggerText: {
    flex: 1,
    ...type.body,
    fontWeight: '700',
    color: palette.text,
  },
  branchPickerCaret: {
    fontSize: 12,
    color: palette.textMuted,
    fontWeight: '800',
  },
  branchPickerPanel: {
    marginTop: 6,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    overflow: 'hidden',
  },
  branchPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  branchPickerItemActive: {
    backgroundColor: palette.purple.soft,
  },
  branchPickerItemText: {
    ...type.body,
    fontWeight: '700',
    color: palette.text,
  },
  branchPickerItemTextActive: {
    color: palette.purple.on,
  },
  branchPickerItemSub: {
    ...type.micro,
    color: palette.textMuted,
    marginTop: 2,
  },
  branchPickerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  branchPickerBadgeText: {
    ...type.micro,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // ── Skill-filter hint (cross-branch only) ─────────────────────────
  skillHintWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
  },
  skillHintText: {
    ...type.micro,
    color: palette.purple.on,
    fontWeight: '700',
    lineHeight: 16,
  },

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
  cardAvatarImg: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: palette.purple.soft,
  },
  cardCourseLine: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '700',
    marginTop: 4,
    lineHeight: 14,
  },
  branchPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: palette.blue.soft,
    borderWidth: 1,
    borderColor: palette.blue.soft,
    maxWidth: '100%',
  },
  branchPillText: {
    ...type.micro,
    fontWeight: '800',
    color: palette.blue.on,
    letterSpacing: 0.3,
  },
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
