// src/screens/admin/CreateBatchScreen.js
//
// Polished form for institution admins to create a batch. Course and
// trainer pickers are proper dropdowns that auto-populate from the
// institution's existing courses (GET /courses) and trainers
// (GET /trainers). All other fields are unchanged from the previous
// version — backend wiring is untouched per the user's instruction
// ("first do UI and finally we will backend").

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, StatusBar, Modal, FlatList, Platform,
} from 'react-native';
import {
  ArrowLeft, BookOpen, Users, Calendar, Clock,
  IndianRupee, MapPin, ChevronDown, Check, X, Building2, Search, AlertCircle,
} from 'lucide-react-native';
import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

// ─── Trainer ↔ Course skill matching ───────────────────────────────────
// A trainer is "eligible" for a course when at least one of their skills
// (or their legacy specialization tokens) matches the course's category.
// We normalise both sides — lowercase, trim, ignore punctuation — so
// "Karate", " karate ", and "KARATE" all collapse to the same token.
const normaliseSkillToken = (raw) =>
  String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

// Extract every skill token a trainer has, drawing from both the
// structured `skills` JSONB array (new schema) and the legacy
// `specialization` comma-separated string so older trainers still
// resolve correctly.
function trainerSkillTokens(trainer) {
  const set = new Set();
  const skillsArr = Array.isArray(trainer?.skills) ? trainer.skills : [];
  skillsArr.forEach((s) => {
    const t = normaliseSkillToken(s?.name);
    if (t) set.add(t);
  });
  String(trainer?.specialization || '')
    .split(',')
    .forEach((raw) => {
      const t = normaliseSkillToken(raw);
      if (t) set.add(t);
    });
  return set;
}

// Course → the tokens we compare against. We use the course's `category`
// first; if a course has no category, we fall back to matching by its
// own name so the picker doesn't blank out entirely.
function courseSkillTokens(course) {
  const set = new Set();
  const cat = normaliseSkillToken(course?.category);
  if (cat) set.add(cat);
  // Fall back to name tokens when there's no explicit category on the
  // course. Splits on whitespace so multi-word course names still land.
  if (!cat) {
    normaliseSkillToken(course?.name)
      .split(' ')
      .forEach((tok) => tok && set.add(tok));
  }
  return set;
}

// Returns true when the trainer has at least one skill that matches
// one of the course's tokens. Partial substring match (either way) is
// allowed so "Karate" matches "Karate Beginner" and vice versa.
function trainerMatchesCourse(trainer, course) {
  if (!course) return true; // no course picked yet — show everyone
  const tSkills = trainerSkillTokens(trainer);
  const cTokens = courseSkillTokens(course);
  if (tSkills.size === 0 || cTokens.size === 0) return false;
  for (const c of cTokens) {
    for (const t of tSkills) {
      if (t === c || t.includes(c) || c.includes(t)) return true;
    }
  }
  return false;
}

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';

const MODE_OPTIONS = [
  { key: 'offline', label: 'Offline', hint: 'In-person at academy' },
  { key: 'online',  label: 'Online',  hint: 'Live virtual class' },
];

// Ordered list of weekdays. `key` is what the backend understands
// (Mon/Tue/…); `short` is what we show on the chip; `full` is for
// the section title when expanded.
const WEEKDAYS = [
  { key: 'Mon', short: 'Mon', full: 'Monday' },
  { key: 'Tue', short: 'Tue', full: 'Tuesday' },
  { key: 'Wed', short: 'Wed', full: 'Wednesday' },
  { key: 'Thu', short: 'Thu', full: 'Thursday' },
  { key: 'Fri', short: 'Fri', full: 'Friday' },
  { key: 'Sat', short: 'Sat', full: 'Saturday' },
  { key: 'Sun', short: 'Sun', full: 'Sunday' },
];

// Parse "HH:MM" → minutes since midnight, returning NaN for invalid input.
function timeToMinutes(s) {
  if (!s || typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}

// Format minutes-since-midnight back to "HH:MM" with hard 12-hour fall-back
// for the duration display.
function minutesToDurationLabel(start, end) {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  const total = b - a;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

// Light HH:MM mask — keeps digits and a single colon so users can't
// accidentally type letters into the time field.
function maskTime(v) {
  const digits = (v || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// 12-hour conversion helpers — internally we keep "HH:MM" 24h so the
// derived days_of_week / start_time / end_time submit payload stays
// stable. The picker UI works in 12h with AM/PM, and the chip label
// displays that too.
function to12h(time24) {
  if (!time24) return { h12: 6, m: 0, period: 'AM' };
  const m = String(time24).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h12: 6, m: 0, period: 'AM' };
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return { h12, m: mins, period };
}

function to24h(h12, m, period) {
  let h = h12 % 12;
  if (period === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTime12(time24) {
  const { h12, m, period } = to12h(time24);
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES_STEP = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55

export default function CreateBatchScreen({ navigation, route }) {
  // Route may carry an existing batch when opened from the "Edit" action
  // on BatchesListScreen. When present, we pre-fill the form and submit
  // via PUT /batches/:id instead of POST /batches.
  const editingBatch = route?.params?.batch || null;
  const isEditing    = !!editingBatch;

  const [courses,  setCourses]  = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);
  // Search text for filtering the trainer picker (matches on name +
  // skill labels). Empty string = no filter beyond the course match.
  const [trainerSearch, setTrainerSearch] = useState('');

  const [form, setForm] = useState({
    course_id:    editingBatch?.course_id ?? null,
    trainer_id:   editingBatch?.trainer_id ?? null,
    name:         editingBatch?.name ?? '',
    days_of_week: editingBatch?.days_of_week || 'Mon,Wed,Fri',
    start_time:   editingBatch?.start_time?.slice(0, 5) || '06:00',
    end_time:     editingBatch?.end_time?.slice(0, 5)   || '07:00',
    capacity:     String(editingBatch?.capacity ?? '20'),
    mode:         editingBatch?.mode || 'offline',
    // Branch scope: null = main institution (the default the dropdown
    // starts on). Non-null = a sub-branch's institution_id.
    branch_id:    editingBatch?.branch_id ?? null,
  });

  // Populated from GET /branches — union of the main institution's
  // sub-branches (institutions rows with parent_institution_id) and
  // any satellite locations. Only sub-branches make sense as batch
  // hosts, so we filter to branch_kind === 'sub_branch' before
  // rendering the dropdown.
  const [branches, setBranches] = useState([]);
  const [mainInstitutionName, setMainInstitutionName] = useState('Main Institution');
  const [isSubBranchAdmin, setIsSubBranchAdmin] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  // Per-day schedule. Each weekday holds { enabled, start, end }. Only
  // enabled days are rolled into the legacy days_of_week / start_time /
  // end_time fields when submitting. When editing, we hydrate from the
  // batch's `schedule` JSONB map if present, otherwise fall back to the
  // legacy `days_of_week` + `start_time`/`end_time` triple.
  const [schedule, setSchedule] = useState(() => {
    const initial = {};
    const activeDays = new Set(
      (editingBatch?.days_of_week || 'Mon,Wed,Fri').split(',').map((d) => d.trim()),
    );
    const scheduleMap = editingBatch?.schedule && typeof editingBatch.schedule === 'object'
      ? editingBatch.schedule
      : null;
    const fallbackStart = editingBatch?.start_time?.slice(0, 5) || '06:00';
    const fallbackEnd   = editingBatch?.end_time?.slice(0, 5)   || '07:00';
    WEEKDAYS.forEach((d) => {
      const dayEntry = scheduleMap?.[d.key];
      const preset = editingBatch
        ? activeDays.has(d.key)
        : ['Mon', 'Wed', 'Fri'].includes(d.key);
      initial[d.key] = {
        enabled: preset,
        start: dayEntry?.start || fallbackStart,
        end:   dayEntry?.end   || fallbackEnd,
      };
    });
    return initial;
  });

  const setDayField = (dayKey, patch) =>
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], ...patch },
    }));
  const [loading, setLoading] = useState(false);

  // Picker modal state
  const [courseOpen,  setCourseOpen]  = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);

  // Time picker modal — { dayKey, field: 'start'|'end' } when open.
  const [timePicker, setTimePicker] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Four parallel fetches:
        //   /courses          → the course picker
        //   /trainers         → the trainer picker
        //   /branches         → the Branch dropdown (union of sub-branches
        //                       + satellite locations; we filter to
        //                       sub-branches for batch scoping)
        //   /me/details       → the main institution's own name for the
        //                       "Main Institution" row label + to know
        //                       whether the caller is a sub-branch admin.
        const [c, t, b, me] = await Promise.all([
          apiClient.get('/courses'),
          apiClient.get('/trainers'),
          apiClient.get('/branches').catch(() => ({ data: { branches: [] } })),
          apiClient.get('/institutions/me/details').catch(() => ({ data: { institution: null } })),
        ]);
        setCourses(c?.data?.courses || []);
        setTrainers(t?.data?.trainers || []);

        // Only sub-branch academies show up in the picker — satellite
        // locations don't hold their own batches.
        const subBranches = (b?.data?.branches || []).filter(
          (row) => row.branch_kind === 'sub_branch',
        );
        setBranches(subBranches);

        const inst = me?.data?.institution;
        if (inst) {
          const parentId = inst.parent_institution_id;
          setIsSubBranchAdmin(!!parentId);
          if (parentId) {
            // Sub-branch admin — pin the form to their own branch id so
            // the locked dropdown displays their branch's name, not
            // "Main Institution", and the payload is correct on save.
            // (Backend also force-normalises this — belt + braces.)
            setForm((p) => ({ ...p, branch_id: inst.id }));
            // Ensure this branch appears in the dropdown row list even
            // though sub-branch admins can't change it — the picker
            // needs to be able to look up the name.
            setBranches((prev) =>
              prev.some((r) => r.id === inst.id)
                ? prev
                : [{ id: inst.id, name: inst.name || 'This branch', branch_kind: 'sub_branch', city: inst.city }, ...prev],
            );
          } else {
            setMainInstitutionName(inst.name || 'Main Institution');
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[CreateBatch] failed to load lists:', err?.message);
      } finally {
        setLoadingLists(false);
      }
    })();
  }, []);

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const selectedCourse  = courses.find((c) => c.id === form.course_id) || null;
  const selectedTrainer = trainers.find((t) => t.id === form.trainer_id) || null;

  // Trainers eligible for the currently-selected course — only those
  // whose skills / specialization match the course's category.
  // Falls through to the full trainer list when no course is picked yet.
  const eligibleTrainers = useMemo(() => {
    if (!selectedCourse) return trainers;
    return trainers.filter((t) => trainerMatchesCourse(t, selectedCourse));
  }, [trainers, selectedCourse]);

  // Then narrow down further by the search box — matches trainer name +
  // any of their skill names (case-insensitive substring).
  const filteredTrainers = useMemo(() => {
    const q = normaliseSkillToken(trainerSearch);
    if (!q) return eligibleTrainers;
    return eligibleTrainers.filter((t) => {
      const nameHit = normaliseSkillToken(t.name).includes(q);
      if (nameHit) return true;
      const skillNames = (Array.isArray(t.skills) ? t.skills : [])
        .map((s) => normaliseSkillToken(s?.name))
        .join(' ');
      if (skillNames.includes(q)) return true;
      const spec = normaliseSkillToken(t.specialization);
      return spec.includes(q);
    });
  }, [eligibleTrainers, trainerSearch]);

  // When the admin swaps to a course the currently-picked trainer no
  // longer qualifies for, silently clear the trainer so we don't submit
  // a mismatched pairing.
  useEffect(() => {
    if (!selectedTrainer || !selectedCourse) return;
    if (!trainerMatchesCourse(selectedTrainer, selectedCourse)) {
      update('trainer_id', null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.course_id]);

  // Styled dialog helper so every validation popup on this screen uses
  // the same amber-warning card that the rest of the app does.
  const showWarn = (title, message) => confirm({
    title, message,
    variant:     'warning',
    confirmText: 'Got it',
    hideCancel:  true,
  });

  const submit = async () => {
    if (!form.course_id) {
      showWarn('Check this detail', 'Please pick a course.');
      return;
    }
    if (!form.name.trim()) {
      showWarn('Check this detail', 'Batch name is required.');
      return;
    }

    // Roll the per-day schedule up into the legacy fields the backend
    // already accepts. `days_of_week` is the comma-joined active days
    // in the canonical Mon→Sun order; `start_time` / `end_time` are the
    // earliest start and latest end across selected days. The full
    // per-day map is also sent as `schedule` so future backend work can
    // honour different times per day without another migration churn.
    const activeDays = WEEKDAYS.filter((d) => schedule[d.key]?.enabled);
    if (activeDays.length === 0) {
      showWarn('Pick at least one day', 'Choose the days the batch runs and set their times.');
      return;
    }

    let invalidDay = null;
    activeDays.forEach((d) => {
      const s = schedule[d.key];
      const a = timeToMinutes(s.start);
      const b = timeToMinutes(s.end);
      if (Number.isNaN(a) || Number.isNaN(b) || b <= a) invalidDay = d;
    });
    if (invalidDay) {
      showWarn(
        'Check the times',
        `${invalidDay.full} needs a valid start and end time (end must be after start, format HH:MM).`,
      );
      return;
    }

    const daysCsv   = activeDays.map((d) => d.key).join(',');
    const startMin  = Math.min(...activeDays.map((d) => timeToMinutes(schedule[d.key].start)));
    const endMin    = Math.max(...activeDays.map((d) => timeToMinutes(schedule[d.key].end)));
    const fmt = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

    // Compact per-day map for the backend (and audit trail).
    const scheduleByDay = {};
    activeDays.forEach((d) => {
      scheduleByDay[d.key] = {
        start: schedule[d.key].start,
        end:   schedule[d.key].end,
      };
    });

    setLoading(true);
    try {
      const payload = {
        ...form,
        days_of_week: daysCsv,
        start_time:   fmt(startMin),
        end_time:     fmt(endMin),
        schedule:     scheduleByDay,
        capacity:     parseInt(form.capacity, 10) || 20,
        // Branch scope — null means "at the main institution". The
        // backend also accepts a truthy id whose parent_institution_id
        // matches the caller's root; anything else is 403'd.
        branch_id:    form.branch_id,
      };
      if (isEditing) {
        await apiClient.put(`/batches/${editingBatch.id}`, payload);
      } else {
        await apiClient.post('/batches', payload);
      }
      confirm({
        title:       isEditing ? 'Batch updated' : 'Batch created',
        message:     isEditing
          ? `${form.name.trim()} has been updated.`
          : `${form.name.trim()} is ready. Students can now enrol into it.`,
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      showWarn(
        isEditing ? 'Could not update batch' : 'Could not create batch',
        err.response?.data?.message || 'Something went wrong. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={SURFACE} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Batch' : 'New Batch'}</Text>
          <Text style={styles.headerSub}>
            {isEditing
              ? 'Update this batch’s course, trainer, or schedule'
              : 'Schedule a class under one of your courses'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
        {/* ── Branch dropdown (mandatory) ─────────────────────────────
            Main Institution is always the first row and the default
            selection. Sub-branches follow. Locked for sub-branch admins
            since they can only create batches at their own branch. */}
        <Section title="Branch" icon={Building2}>
          <Text style={styles.label}>Which branch is this batch at? *</Text>
          <BranchDropdown
            open={branchOpen}
            onToggle={() => {
              setBranchOpen((o) => !o);
              setCourseOpen(false);
              setTrainerOpen(false);
            }}
            disabled={loadingLists || isSubBranchAdmin}
            selectedId={form.branch_id}
            mainInstitutionName={mainInstitutionName}
            branches={branches}
            onSelect={(id) => {
              update('branch_id', id);
              setBranchOpen(false);
            }}
          />
          {isSubBranchAdmin ? (
            <Text style={styles.helperMuted}>
              Batches created from your sub-branch login are pinned to your own branch.
            </Text>
          ) : null}
        </Section>

        {/* ── Course dropdown (inline) ───────────────────────────────── */}
        <Section title="Course" icon={BookOpen}>
          <Text style={styles.label}>Pick a course *</Text>
          <InlineDropdown
            icon={BookOpen}
            placeholder={
              loadingLists
                ? 'Loading your courses…'
                : courses.length === 0
                  ? 'No courses yet — create one first'
                  : 'Select a course'
            }
            value={selectedCourse?.name || ''}
            disabled={loadingLists || courses.length === 0}
            open={courseOpen}
            onToggle={() => {
              setCourseOpen((o) => !o);
              setTrainerOpen(false);
            }}
            items={courses}
            selectedId={form.course_id}
            onSelect={(item) => {
              update('course_id', item.id);
              setCourseOpen(false);
            }}
          />
          {courses.length === 0 && !loadingLists ? (
            <Text style={styles.warning}>
              You need at least one course before you can create a batch. Go to
              Quick Actions → Add Course.
            </Text>
          ) : null}
        </Section>

        {/* ── Trainer dropdown (inline, optional) ────────────────────── */}
        {/*
            Trainers are now filtered by the selected course's category —
            only those whose skills / qualifications overlap with the
            course's skill token show up. A search box narrows further
            by trainer name or skill label. When nothing matches, we
            surface a friendly "No eligible trainers found" empty state.
        */}
        <Section title="Trainer" icon={Users}>
          <Text style={styles.label}>Assign a trainer (optional)</Text>
          {selectedCourse ? (
            <View style={styles.matchHint}>
              <Users size={11} color={BRAND} strokeWidth={2.6} />
              <Text style={styles.matchHintText}>
                Showing trainers skilled in{' '}
                <Text style={{ fontWeight: '800', color: BRAND }}>
                  {selectedCourse.category || selectedCourse.name}
                </Text>
              </Text>
            </View>
          ) : (
            <View style={styles.matchHint}>
              <BookOpen size={11} color={TEXT_MUTED} strokeWidth={2.6} />
              <Text style={[styles.matchHintText, { color: TEXT_MUTED }]}>
                Pick a course first to filter trainers by matching skills.
              </Text>
            </View>
          )}
          <InlineDropdown
            icon={Users}
            placeholder={
              loadingLists
                ? 'Loading your trainers…'
                : trainers.length === 0
                  ? 'No trainers yet — leave unassigned'
                  : eligibleTrainers.length === 0
                    ? 'No eligible trainers for this course'
                    : 'Select a trainer'
            }
            value={selectedTrainer?.name || ''}
            cleared={form.trainer_id == null && !loadingLists}
            clearedLabel="No trainer assigned"
            disabled={loadingLists}
            open={trainerOpen}
            onToggle={() => {
              setTrainerOpen((o) => !o);
              setCourseOpen(false);
            }}
            items={filteredTrainers}
            selectedId={form.trainer_id}
            leadingNone={{
              label: 'No trainer assigned',
              selected: form.trainer_id == null,
              onPress: () => {
                update('trainer_id', null);
                setTrainerOpen(false);
              },
            }}
            onSelect={(item) => {
              update('trainer_id', item.id);
              setTrainerOpen(false);
            }}
            searchable
            searchValue={trainerSearch}
            onSearchChange={setTrainerSearch}
            searchPlaceholder="Search by name or skill"
            emptyText={
              selectedCourse && eligibleTrainers.length === 0
                ? 'No eligible trainers found for this course.'
                : trainerSearch
                  ? 'No trainers match this search.'
                  : 'Nothing here yet.'
            }
            renderItemMeta={(item) => {
              const skills = (Array.isArray(item.skills) ? item.skills : [])
                .map((s) => s?.name).filter(Boolean);
              const legacy = String(item.specialization || '')
                .split(',').map((s) => s.trim()).filter(Boolean);
              const labels = (skills.length ? skills : legacy).slice(0, 3);
              return labels.length ? labels.join(' · ') : null;
            }}
          />
        </Section>

        {/* ── Batch details ──────────────────────────────────────────── */}
        <Section title="Details" icon={Calendar}>
          <Text style={styles.label}>Batch name *</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(v) => update('name', v)}
            placeholder="e.g. Morning Batch A"
            placeholderTextColor={TEXT_LIGHT}
            maxLength={80}
          />

          <Text style={styles.label}>Days & timings</Text>
          <Text style={styles.helperText}>
            Tap a day to add it to the schedule. Each day can have its own
            start and end time.
          </Text>

          {/* Day chips row — Mon → Sun. Tapping toggles `enabled`. */}
          <View style={styles.dayChipsRow}>
            {WEEKDAYS.map((d) => {
              const on = !!schedule[d.key]?.enabled;
              return (
                <TouchableOpacity
                  key={d.key}
                  style={[styles.dayChip, on && styles.dayChipActive]}
                  onPress={() => setDayField(d.key, { enabled: !on })}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextActive]}>
                    {d.short}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Per-day time editors — only rendered for enabled days. */}
          {WEEKDAYS.every((d) => !schedule[d.key]?.enabled) ? (
            <View style={styles.dayEmpty}>
              <Text style={styles.dayEmptyText}>
                No days picked yet. Tap Mon / Tue / Wed… above to add a slot.
              </Text>
            </View>
          ) : (
            WEEKDAYS.filter((d) => schedule[d.key]?.enabled).map((d) => {
              const s = schedule[d.key];
              const dur = minutesToDurationLabel(s.start, s.end);
              const bad = !dur && (s.start || s.end);
              return (
                <View key={d.key} style={styles.dayEditCard}>
                  <View style={styles.dayEditHeader}>
                    <Text style={styles.dayEditTitle}>{d.full}</Text>
                    <TouchableOpacity
                      onPress={() => setDayField(d.key, { enabled: false })}
                      style={styles.dayRemoveBtn}
                      hitSlop={8}
                      activeOpacity={0.7}
                    >
                      <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.row}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.miniLabel}>Start</Text>
                      <TouchableOpacity
                        style={styles.timeChip}
                        onPress={() => setTimePicker({ dayKey: d.key, field: 'start' })}
                        activeOpacity={0.85}
                      >
                        <Clock size={14} color={BRAND} strokeWidth={2.4} />
                        <Text style={styles.timeChipText}>
                          {formatTime12(s.start)}
                        </Text>
                        <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.4} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.miniLabel}>End</Text>
                      <TouchableOpacity
                        style={styles.timeChip}
                        onPress={() => setTimePicker({ dayKey: d.key, field: 'end' })}
                        activeOpacity={0.85}
                      >
                        <Clock size={14} color={BRAND} strokeWidth={2.4} />
                        <Text style={styles.timeChipText}>
                          {formatTime12(s.end)}
                        </Text>
                        <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.4} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* Live duration / error chip */}
                  {dur ? (
                    <View style={styles.durationChip}>
                      <Text style={styles.durationChipText}>Duration · {dur}</Text>
                    </View>
                  ) : bad ? (
                    <Text style={styles.durationError}>
                      End time must be after start (use 24-hour HH:MM).
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}

          <Text style={styles.label}>Capacity</Text>
          <TextInput
            style={styles.input}
            value={form.capacity}
            onChangeText={(v) => update('capacity', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={TEXT_LIGHT}
          />

          <Text style={styles.label}>Mode</Text>
          <View style={styles.modeRow}>
            {MODE_OPTIONS.map((m) => {
              const active = form.mode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeCard, active && styles.modeCardActive]}
                  onPress={() => update('mode', m.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
                    {m.label}
                  </Text>
                  <Text style={[styles.modeHint, active && styles.modeHintActive]}>
                    {m.hint}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.6 }]}
          onPress={submit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {isEditing ? 'Save changes' : 'Create Batch'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Course + trainer dropdowns now render inline in their sections
          above; the bottom-sheet PickerModal blocks were removed. */}

      {/* 12-hour time picker — opens from any day's Start/End chip. */}
      <TimePickerModal
        visible={!!timePicker}
        title={
          timePicker
            ? `${WEEKDAYS.find((d) => d.key === timePicker.dayKey)?.full || ''} · ${timePicker.field === 'start' ? 'Start time' : 'End time'}`
            : ''
        }
        value={
          timePicker
            ? schedule[timePicker.dayKey]?.[timePicker.field]
            : null
        }
        onCancel={() => setTimePicker(null)}
        onConfirm={(time24) => {
          setDayField(timePicker.dayKey, { [timePicker.field]: time24 });
          setTimePicker(null);
        }}
      />
    </View>
  );
}

// ─── TimePickerModal ───────────────────────────────────────────────────
// Three scrollable columns — Hour (1-12), Minute (5-min increments),
// AM/PM. Confirm writes the selection back as a 24h "HH:MM" string so
// downstream code (duration calc, days-of-week roll-up) stays unchanged.
function TimePickerModal({ visible, title, value, onCancel, onConfirm }) {
  const initial = to12h(value);
  const [h12,    setH12]    = useState(initial.h12);
  const [minute, setMinute] = useState(
    // snap to nearest 5-min step so the highlighted row matches.
    MINUTES_STEP.includes(initial.m)
      ? initial.m
      : MINUTES_STEP.reduce((p, c) => (Math.abs(c - initial.m) < Math.abs(p - initial.m) ? c : p), 0),
  );
  const [period, setPeriod] = useState(initial.period);

  // Reset the columns whenever the modal reopens for a different value.
  useEffect(() => {
    if (!visible) return;
    const v = to12h(value);
    setH12(v.h12);
    setMinute(MINUTES_STEP.includes(v.m)
      ? v.m
      : MINUTES_STEP.reduce((p, c) => (Math.abs(c - v.m) < Math.abs(p - v.m) ? c : p), 0));
    setPeriod(v.period);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.tpScrim}>
        <View style={styles.tpCard}>
          <View style={styles.tpHeader}>
            <Text style={styles.tpTitle} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={8} activeOpacity={0.7}>
              <X size={18} color={TEXT_MUTED} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {/* Big preview of the current selection */}
          <Text style={styles.tpPreview}>
            {`${h12}:${String(minute).padStart(2, '0')} ${period}`}
          </Text>

          {/* Three-column wheel */}
          <View style={styles.tpWheelRow}>
            <TimeColumn
              label="Hour"
              items={HOURS_12}
              value={h12}
              onSelect={setH12}
            />
            <TimeColumn
              label="Min"
              items={MINUTES_STEP}
              value={minute}
              format={(n) => String(n).padStart(2, '0')}
              onSelect={setMinute}
            />
            <View style={styles.tpPeriodCol}>
              <Text style={styles.tpColLabel}>Period</Text>
              {['AM', 'PM'].map((p) => {
                const on = period === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.tpPeriodBtn, on && styles.tpPeriodBtnActive]}
                    onPress={() => setPeriod(p)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.tpPeriodText, on && styles.tpPeriodTextActive]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.tpActions}>
            <TouchableOpacity
              style={[styles.tpBtn, styles.tpBtnGhost]}
              onPress={onCancel}
              activeOpacity={0.85}
            >
              <Text style={styles.tpBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tpBtn, styles.tpBtnPrimary]}
              onPress={() => onConfirm(to24h(h12, minute, period))}
              activeOpacity={0.85}
            >
              <Text style={styles.tpBtnPrimaryText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TimeColumn({ label, items, value, onSelect, format }) {
  return (
    <View style={styles.tpCol}>
      <Text style={styles.tpColLabel}>{label}</Text>
      <ScrollView
        style={styles.tpColScroll}
        contentContainerStyle={{ paddingVertical: 4 }}
        showsVerticalScrollIndicator={false}
      >
        {items.map((it) => {
          const on = it === value;
          return (
            <TouchableOpacity
              key={it}
              style={[styles.tpColItem, on && styles.tpColItemActive]}
              onPress={() => onSelect(it)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tpColItemText, on && styles.tpColItemTextActive]}>
                {format ? format(it) : it}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Icon size={14} color={BRAND} strokeWidth={2.4} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// Inline dropdown — trigger row + expanded menu rendered directly
// beneath the trigger (no bottom-sheet modal). Shows just the item name,
// no subtitle / description.
function InlineDropdown({
  icon: Icon, placeholder, value, disabled, cleared, clearedLabel,
  open, onToggle, items, selectedId, onSelect, leadingNone,
  // Search bar (optional) — shown inside the menu when `searchable` is
  // set. Value + change handler are lifted so the parent owns the query
  // and any filtered `items` derived from it.
  searchable, searchValue, onSearchChange, searchPlaceholder,
  // Custom empty state text — falls back to "Nothing here yet." for
  // pickers that don't want the branded copy.
  emptyText,
  // Optional per-item meta text (rendered under the item's name in a
  // dimmer font) — e.g. a trainer's skill chip summary.
  renderItemMeta,
}) {
  const hasValue = !!value;
  const list = items || [];
  return (
    <View>
      <TouchableOpacity
        style={[styles.dropdownTrigger, disabled && styles.dropdownTriggerDisabled]}
        onPress={onToggle}
        disabled={disabled}
        activeOpacity={0.85}
      >
        {Icon ? (
          <View style={styles.dropdownIconWrap}>
            <Icon size={14} color={BRAND} strokeWidth={2.4} />
          </View>
        ) : null}
        <Text
          style={[
            styles.dropdownText,
            (!hasValue && !cleared) && { color: TEXT_LIGHT, fontWeight: '500' },
            (cleared && !hasValue) && { color: TEXT_MUTED, fontStyle: 'italic' },
          ]}
          numberOfLines={1}
        >
          {hasValue ? value : (cleared ? clearedLabel : placeholder)}
        </Text>
        <ChevronDown
          size={16}
          color={TEXT_MUTED}
          strokeWidth={2.4}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.inlineMenu}>
          {searchable ? (
            <View style={styles.searchWrap}>
              <Search size={14} color={TEXT_MUTED} strokeWidth={2.4} />
              <TextInput
                style={styles.searchInput}
                value={searchValue}
                onChangeText={onSearchChange}
                placeholder={searchPlaceholder || 'Search…'}
                placeholderTextColor={TEXT_LIGHT}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchValue ? (
                <TouchableOpacity
                  onPress={() => onSearchChange && onSearchChange('')}
                  hitSlop={8}
                  activeOpacity={0.7}
                >
                  <X size={13} color={TEXT_MUTED} strokeWidth={2.4} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {leadingNone ? (
            <TouchableOpacity
              style={[styles.inlineRow, leadingNone.selected && styles.inlineRowSelected]}
              onPress={leadingNone.onPress}
              activeOpacity={0.85}
            >
              <Text style={styles.inlineRowText} numberOfLines={1}>
                {leadingNone.label}
              </Text>
              {leadingNone.selected ? (
                <Check size={14} color={BRAND} strokeWidth={2.6} />
              ) : null}
            </TouchableOpacity>
          ) : null}
          {list.length === 0 ? (
            <View style={styles.inlineEmptyWrap}>
              <AlertCircle size={14} color={TEXT_MUTED} strokeWidth={2.4} />
              <Text style={styles.inlineEmpty}>
                {emptyText || 'Nothing here yet.'}
              </Text>
            </View>
          ) : null}
          {list.map((item) => {
            const sel = item.id === selectedId;
            const meta = renderItemMeta ? renderItemMeta(item) : null;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.inlineRow, sel && styles.inlineRowSelected]}
                onPress={() => onSelect(item)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.inlineRowText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {meta ? (
                    <Text style={styles.inlineRowMeta} numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                {sel ? <Check size={14} color={BRAND} strokeWidth={2.6} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function DropdownTrigger({
  icon: Icon, placeholder, value, disabled, cleared, clearedLabel, onPress,
}) {
  const hasValue = !!value;
  return (
    <TouchableOpacity
      style={[styles.dropdownTrigger, disabled && styles.dropdownTriggerDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      {Icon ? (
        <View style={styles.dropdownIconWrap}>
          <Icon size={14} color={BRAND} strokeWidth={2.4} />
        </View>
      ) : null}
      <Text
        style={[
          styles.dropdownText,
          (!hasValue && !cleared) && { color: TEXT_LIGHT, fontWeight: '500' },
          (cleared && !hasValue) && { color: TEXT_MUTED, fontStyle: 'italic' },
        ]}
        numberOfLines={1}
      >
        {hasValue ? value : (cleared ? clearedLabel : placeholder)}
      </Text>
      <ChevronDown size={16} color={TEXT_MUTED} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

function PickerModal({
  visible, title, items, selectedId, leadingNone,
  renderRow, onSelect, onClose, emptyText,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalBackdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose} hitSlop={8}>
              <X size={16} color={TEXT} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={items || []}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 30 }}
            ListHeaderComponent={leadingNone ? (
              <TouchableOpacity
                style={[styles.modalRow, leadingNone.selected && styles.modalRowSelected]}
                onPress={leadingNone.onPress}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalItemTitle}>{leadingNone.label}</Text>
                  {leadingNone.sub ? (
                    <Text style={styles.modalItemSub}>{leadingNone.sub}</Text>
                  ) : null}
                </View>
                {leadingNone.selected ? (
                  <Check size={16} color={BRAND} strokeWidth={2.6} />
                ) : null}
              </TouchableOpacity>
            ) : null}
            ListEmptyComponent={
              <Text style={styles.modalEmpty}>{emptyText || 'Nothing here yet.'}</Text>
            }
            renderItem={({ item }) => {
              const sel = item.id === selectedId;
              return (
                <TouchableOpacity
                  style={[styles.modalRow, sel && styles.modalRowSelected]}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>{renderRow ? renderRow(item) : null}</View>
                  {sel ? <Check size={16} color={BRAND} strokeWidth={2.6} /> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Branch dropdown ───────────────────────────────────────────────────
// Compact inline dropdown that always lists Main Institution as the
// first row and every sub-branch after. Uses `null` for the main option
// so the backend payload maps cleanly (branch_id: null = at main).
function BranchDropdown({
  open, onToggle, disabled,
  selectedId, mainInstitutionName, branches, onSelect,
}) {
  const rows = [
    { id: null, name: `${mainInstitutionName || 'Main Institution'}`, meta: 'Main Institution', isMain: true },
    ...branches.map((b) => ({ id: b.id, name: b.name, meta: b.city || '', isMain: false })),
  ];
  const active = rows.find((r) => r.id === selectedId) || rows[0];
  return (
    <View style={styles.dropdownWrap}>
      <TouchableOpacity
        style={[styles.dropdownButton, disabled && { opacity: 0.6 }]}
        onPress={onToggle}
        disabled={disabled}
        activeOpacity={0.85}
      >
        <View style={styles.dropdownIconWrap}>
          <Building2 size={16} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.dropdownValue} numberOfLines={1}>{active.name}</Text>
          {active.isMain ? (
            <Text style={styles.dropdownMeta} numberOfLines={1}>Main Institution</Text>
          ) : active.meta ? (
            <Text style={styles.dropdownMeta} numberOfLines={1}>{active.meta}</Text>
          ) : null}
        </View>
        <ChevronDown
          size={16}
          color={TEXT_MUTED}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.dropdownList}>
          {rows.map((r, idx) => {
            const selected = r.id === selectedId;
            return (
              <TouchableOpacity
                key={String(r.id ?? 'main')}
                style={[
                  styles.dropdownRow,
                  idx !== rows.length - 1 && styles.dropdownRowDivider,
                  selected && { backgroundColor: BRAND_SOFT },
                ]}
                onPress={() => onSelect(r.id)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownRowTitle} numberOfLines={1}>{r.name}</Text>
                  {r.isMain ? (
                    <Text style={styles.dropdownRowSub}>Default — batch belongs to the main institution</Text>
                  ) : r.meta ? (
                    <Text style={styles.dropdownRowSub} numberOfLines={1}>{r.meta}</Text>
                  ) : null}
                </View>
                {selected ? (
                  <Check size={14} color={BRAND} strokeWidth={2.6} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 16,
    paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    gap: 10,
  },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  section: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: TEXT, textTransform: 'uppercase', letterSpacing: 0.4 },

  label: { fontSize: 11, fontWeight: '800', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  helperText: { fontSize: 12, color: TEXT_MUTED, marginBottom: 10, lineHeight: 17 },
  miniLabel: { fontSize: 10, fontWeight: '800', color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },

  // Day chip row
  dayChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: BORDER,
    minWidth: 48,
    alignItems: 'center',
  },
  dayChipActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  dayChipText: { fontSize: 12, fontWeight: '800', color: TEXT_MUTED, letterSpacing: 0.3 },
  dayChipTextActive: { color: '#fff' },

  dayEmpty: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  dayEmptyText: { fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic', textAlign: 'center' },

  dayEditCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    marginBottom: 10,
  },
  dayEditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dayEditTitle: { fontSize: 13, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  dayRemoveBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },

  // Tappable chip that opens the 12-hour TimePickerModal.
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  timeChipText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: 0.3,
  },

  // ── Time picker modal ──────────────────────────────────────
  tpScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  tpCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 18,
  },
  tpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  tpTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: -0.2,
  },
  tpPreview: {
    fontSize: 32,
    fontWeight: '900',
    color: BRAND,
    letterSpacing: -0.6,
    textAlign: 'center',
    marginVertical: 10,
  },
  tpWheelRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  tpCol: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  tpColLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: TEXT_MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  tpColScroll: {
    maxHeight: 180,
    alignSelf: 'stretch',
  },
  tpColItem: {
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    marginVertical: 2,
  },
  tpColItemActive: { backgroundColor: BRAND },
  tpColItemText: { fontSize: 16, fontWeight: '700', color: TEXT },
  tpColItemTextActive: { color: '#fff' },

  tpPeriodCol: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  tpPeriodBtn: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 8,
    marginVertical: 4,
  },
  tpPeriodBtnActive: { backgroundColor: BRAND },
  tpPeriodText: { fontSize: 14, fontWeight: '800', color: TEXT },
  tpPeriodTextActive: { color: '#fff' },

  tpActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  tpBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  tpBtnGhost: { backgroundColor: BG },
  tpBtnGhostText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '800' },
  tpBtnPrimary: { backgroundColor: BRAND },
  tpBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  durationChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: BRAND_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  durationChipText: { fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.3 },
  durationError: { marginTop: 8, fontSize: 11, color: BRAND, fontWeight: '700' },

  input: {
    backgroundColor: BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 6,
  },
  row: { flexDirection: 'row' },

  // Dropdown trigger
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  dropdownTriggerDisabled: { opacity: 0.6 },
  dropdownIconWrap: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  dropdownText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '700' },

  // Inline expanded menu — sits directly under the trigger, no overlay,
  // no bottom sheet. Just the course/trainer names.
  inlineMenu: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  inlineRowSelected: { backgroundColor: BRAND_SOFT },
  inlineRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  // Small dimmer meta line rendered under the trainer name — shows the
  // trainer's skill labels so the admin can eyeball the match.
  inlineRowMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: TEXT_MUTED,
    marginTop: 2,
  },
  inlineEmpty: {
    fontSize: 12,
    color: TEXT_LIGHT,
    fontStyle: 'italic',
    textAlign: 'center',
    flexShrink: 1,
  },
  // Container around the empty text so we can pair it with a soft icon
  // for a friendlier "No eligible trainers found" state.
  inlineEmptyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: '#FAFAFB',
  },

  // Search bar at the top of the inline menu — used by the trainer
  // picker so the admin can narrow the eligible list quickly.
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: '#FAFAFB',
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    padding: 0,
  },

  // Little hint under the "Assign a trainer" label that tells the admin
  // WHY the trainer list is filtered (skill match vs the picked course).
  matchHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BRAND_SOFT + '99',
    borderWidth: 1,
    borderColor: BRAND_SOFT,
  },
  matchHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: TEXT,
    flexShrink: 1,
  },

  warning: {
    marginTop: 8,
    fontSize: 11,
    color: BRAND,
    fontWeight: '700',
  },

  // Mode picker
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modeCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  modeCardActive: { backgroundColor: BRAND_SOFT, borderColor: BRAND },
  modeLabel: { fontSize: 14, fontWeight: '800', color: TEXT },
  modeLabelActive: { color: BRAND },
  modeHint: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },
  modeHintActive: { color: BRAND },

  // Submit
  submitBtn: {
    marginTop: 8,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },

  // ── Picker modal ───────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: TEXT },
  modalClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 4,
  },
  modalRowSelected: { backgroundColor: BRAND_SOFT },
  modalItemTitle: { fontSize: 14, fontWeight: '700', color: TEXT },
  modalItemSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },
  modalEmpty: {
    fontSize: 13,
    color: TEXT_LIGHT,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 40,
  },

  // ── Branch dropdown ─────────────────────────────────────────────
  helperMuted: {
    fontSize: 11, color: TEXT_MUTED, marginTop: 6, fontWeight: '500',
  },
  dropdownWrap: { marginTop: 4 },
  dropdownButton: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  dropdownIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  dropdownValue: { fontSize: 14, fontWeight: '800', color: TEXT },
  dropdownMeta: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  dropdownList: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  dropdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  dropdownRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  dropdownRowTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  dropdownRowSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
});
