// src/screens/staff/StaffAttendanceScreen.js
//
// Step 2 of the Staff module — fast attendance marking.
//
// Layout (top to bottom):
//   1. Header — back button, "Mark Attendance" title, View History link.
//   2. Batch chip selector — horizontal scroll of my batches; tap to switch.
//   3. Date strip — last 7 days, today selected by default; tap to switch.
//   4. Live counter strip — Present / Absent / Late / Leave counts update as
//      the trainer taps.
//   5. Quick-action row — "All Present" button + search input.
//   6. Student list — modern card rows with avatar (initial), name, age,
//      a row of 4 status pills (P/A/L/Lv). Tapping a pill sets it instantly.
//   7. Sticky bottom save bar with current count and Save button.
//
// Data flow:
//   GET /api/batches/trainer/my    → list batches for the selector
//   GET /api/enrollments/batch/:id → students in the selected batch
//   POST /api/attendance/bulk      → save the records
//
// Status codes match the (newly widened) attendance.status CHECK constraint:
// 'present' | 'absent' | 'late' | 'leave'.

import React, { createContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, StyleSheet, FlatList,
} from 'react-native';
import {
  ArrowLeft, Search, Check, X as XIcon, Clock, Plane, History,
  CalendarDays, Users, ChevronDown, ChevronLeft, ChevronRight, Download,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ExportAttendanceModal from '../../components/ExportAttendanceModal';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. The Branch Attendance flow reuses this
// screen with mode='branch', so restyling here brings both the
// trainer and branch admin attendance surfaces onto the same
// visual language as Institution Home.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const AttendanceCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:         { backgroundColor: pal.bg },
    header:         { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle:    { color: pal.text },
    headerSub:      { color: pal.textMuted },
    iconBtn:        { backgroundColor: pal.border },
    card:           { backgroundColor: pal.surface, borderColor: pal.border },
    batchCard:      { backgroundColor: pal.surface, borderColor: pal.border },
    studentCard:    { backgroundColor: pal.surface, borderColor: pal.border },
    section:        { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:   { color: pal.textMuted },
    label:          { color: pal.textMuted },
  });
}

// ── Status config ─────────────────────────────────────────────────────────
// Single source of truth — order here drives both the live-counter strip and
// the per-row pill row.
const STATUSES = [
  { key: 'present', label: 'Present', short: 'P', icon: Check,    accent: palette.green  },
  { key: 'absent',  label: 'Absent',  short: 'A', icon: XIcon,    accent: palette.rose   },
  { key: 'late',    label: 'Late',    short: 'L', icon: Clock,    accent: palette.orange },
  { key: 'leave',   label: 'Leave',   short: 'Lv', icon: Plane,   accent: palette.blue   },
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ABBR   = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Parse the batch's days_of_week string ("Mon,Wed,Fri" / "monday, wed"
// / etc) into a Set of 3-letter lowercase day abbreviations. Returns
// null when the field is empty — callers treat that as "any day".
function parseScheduleDays(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.toLowerCase().split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const days = new Set();
  for (const p of parts) {
    const abbr = p.slice(0, 3);
    if (DAY_ABBR.includes(abbr)) days.add(abbr);
  }
  return days.size > 0 ? days : null;
}

// Build the date strip: last N calendar days FILTERED to the batch's
// scheduled class days. If no schedule is set (legacy batch) we fall
// back to the last 7 days so the screen doesn't render empty.
// window=28 by default so the strip picks up at least a few sessions
// even for a batch that meets weekly.
function scheduledDaysInWindow(daysOfWeek, windowDays = 28) {
  const out = [];
  const today = new Date();
  const scheduled = parseScheduleDays(daysOfWeek);
  const limit = scheduled ? windowDays : 7;
  for (let i = limit - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const abbr = DAY_ABBR[d.getDay()];
    if (!scheduled || scheduled.has(abbr)) out.push(d);
  }
  return out;
}
// Format a Date as YYYY-MM-DD using the LOCAL calendar, not UTC.
// The naive `.toISOString().split('T')[0]` route drops back a day
// whenever the device's timezone is east of UTC (IST is UTC+5:30):
// midnight local on Jul 20 is 18:30 UTC on Jul 19, so the backend
// received the wrong day and rejected the write as NOT_A_CLASS_DAY.
// Formatting from local getters keeps the ISO string aligned with
// what the trainer sees on the calendar and the save bar.
function isoDate(d) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}
function sameDate(a, b) {
  return isoDate(a) === isoDate(b);
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Build the 6×7 (or 5×7) matrix of calendar cells for the given month.
// The returned array is FLAT: 42 cells starting from the Sunday on or
// before the first of the month. Cells outside the current month have
// `inMonth: false` so the renderer greys them out.
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
function buildMonthGrid(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const firstWeekday = firstOfMonth.getDay(); // 0..6, Sun-first
  const gridStart = new Date(year, monthIndex, 1 - firstWeekday);
  const cells = [];
  // 6 rows × 7 cols covers every possible month layout (28..31 days
  // starting anywhere from Sun to Sat).
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      date:    d,
      inMonth: d.getMonth() === monthIndex,
      iso:     isoDate(d),
    });
  }
  // Trim trailing all-out-of-month rows so the grid is 5 rows when
  // the month fits (looks tighter than a fixed 6-row block).
  while (cells.length >= 7 && cells.slice(-7).every((c) => !c.inMonth)) {
    cells.splice(-7);
  }
  return cells;
}

export default function StaffAttendanceScreen({ navigation, route }) {
  // Optional preselect via route param when arriving from the dashboard
  // or from Attendance History (which passes batchId + date for edit-flow).
  const preselectBatchId = route?.params?.batchId ?? null;
  const preselectDate    = route?.params?.date ? new Date(route.params.date) : new Date();

  // ── Mode swap (trainer / branch admin) ───────────────────────────
  // Same screen powers two roles:
  //   • trainer      → GET /batches/trainer/my (only own batches),
  //                    History nav name StaffAttendanceHistory.
  //   • branch admin → GET /batches (admin endpoint auto-scopes to
  //                    the caller's branch server-side for sub-branch
  //                    logins), History nav name BranchAttendanceHistory.
  // Backend attendance/bulk already accepts both roles and enforces
  // ownership; we just point the mobile at the right list endpoint
  // and route names.
  const mode = route?.params?.mode === 'branch' ? 'branch' : 'trainer';
  const batchesEndpoint = mode === 'branch' ? '/batches' : '/batches/trainer/my';
  const historyRoute    = mode === 'branch' ? 'BranchAttendanceHistory' : 'StaffAttendanceHistory';
  const headerTitle     = mode === 'branch' ? 'Branch Attendance' : 'Mark Attendance';

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(preselectBatchId);
  const [students, setStudents] = useState([]);
  // Export modal — branch admins get an Export chip in the header.
  // The shared ExportAttendanceModal talks to /attendance/export,
  // which uses getBranchScope() to restrict rows to the caller's
  // branch automatically for sub-branch admins.
  const [exportOpen, setExportOpen] = useState(false);
  const [attendance, setAttendance] = useState({}); // { studentId: 'present'|... }
  const [date, setDate] = useState(preselectDate);

  // Inside a bottom-tab navigator the screen can stay mounted while the user
  // switches between tabs. When the dashboard fires
  // navigation.navigate('StaffAttendance', { batchId, date }), the new params
  // arrive but useState's initial value was captured on the first mount —
  // so we explicitly react to route.params changes here.
  useEffect(() => {
    if (route?.params?.batchId != null && Number(route.params.batchId) !== Number(selectedBatchId)) {
      setSelectedBatchId(route.params.batchId);
    }
    if (route?.params?.date) {
      const d = new Date(route.params.date);
      if (!isNaN(d) && isoDate(d) !== isoDate(date)) setDate(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.batchId, route?.params?.date]);
  const [search, setSearch] = useState('');
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);

  // Calendar view — trainer picks a class day from a MONTHLY grid
  // where non-scheduled days are visibly disabled. The visibleMonth
  // state drives which month the grid is showing; prev / next arrows
  // step it by one month. Selecting a scheduled cell updates `date`.
  const selectedBatchForStrip = batches.find((b) => b.id === selectedBatchId);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = preselectDate || new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Scheduled-days set for the current batch. null = no schedule set
  // (legacy row) — the calendar treats every day as tappable in that
  // case so attendance still works.
  const scheduledSet = useMemo(
    () => parseScheduleDays(selectedBatchForStrip?.days_of_week),
    [selectedBatchForStrip?.days_of_week],
  );
  const monthGrid = useMemo(
    () => buildMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );
  const isDayScheduled = useCallback(
    (d) => !scheduledSet || scheduledSet.has(DAY_ABBR[d.getDay()]),
    [scheduledSet],
  );

  // When the trainer switches batches, if the currently-picked date
  // isn't a class day for the NEW batch, snap the picker to the
  // most recent scheduled day so the header + student list stay in
  // sync. Also flip visibleMonth to the new date so the calendar
  // grid follows the selection.
  useEffect(() => {
    if (!selectedBatchForStrip) return;
    if (!isDayScheduled(date)) {
      const recent = scheduledDaysInWindow(selectedBatchForStrip.days_of_week);
      if (recent.length > 0) {
        const next = recent[recent.length - 1];
        setDate(next);
        setVisibleMonth({ year: next.getFullYear(), month: next.getMonth() });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, selectedBatchForStrip?.days_of_week]);

  const shiftMonth = (delta) => {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  // ── Fetch my batches once ──
  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const res = await apiClient.get(batchesEndpoint).catch(() => ({ data: { batches: [] } }));
      const list = res.data?.batches || [];
      setBatches(list);
      // Auto-select the first batch if nothing preselected.
      if (!selectedBatchId && list.length > 0) {
        setSelectedBatchId(list[0].id);
      }
    } finally {
      setLoadingBatches(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchesEndpoint]);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  // ── Fetch students + any existing attendance for the selected date ──
  // The existing-attendance fetch lets the History "Edit" flow open this
  // screen pre-populated so the trainer sees what was previously marked.
  const loadStudents = useCallback(async (batchId, forDate) => {
    if (!batchId) {
      setStudents([]);
      setAttendance({});
      return;
    }
    setLoadingStudents(true);
    try {
      const [enrollRes, existingRes] = await Promise.all([
        apiClient.get(`/enrollments/batch/${batchId}`).catch(() => ({ data: { enrollments: [] } })),
        apiClient.get(`/attendance/batch/${batchId}?date=${isoDate(forDate)}`).catch(() => ({ data: { attendance: [] } })),
      ]);
      const list = enrollRes.data?.enrollments || [];
      const existing = existingRes.data?.attendance || [];
      setStudents(list);

      // Default everyone to "present", then overlay any existing statuses
      // recorded for this date — that way the trainer is editing live data
      // rather than starting from scratch on a previously-marked day.
      const next = {};
      list.forEach((s) => { next[s.student_id] = 'present'; });
      existing.forEach((rec) => { next[rec.student_id] = rec.status; });
      setAttendance(next);
      // Reset dirty / submitted state whenever the working set
      // changes (batch or date switched, or edit-flow re-hydrated).
      // Rows that came back from the server are considered "already
      // saved" — an unedited screen isn't a pending submission.
      setDirty(false);
      setSubmitted(existing.length > 0);
      // Snapshot the current state so the beforeRemove guard can
      // deep-compare and let the user leave silently if they haven't
      // actually touched anything since load.
      baselineRef.current = next;
    } finally {
      setLoadingStudents(false);
    }
  }, []);
  useEffect(() => { loadStudents(selectedBatchId, date); }, [selectedBatchId, date, loadStudents]);

  // ── Dirty tracking ───────────────────────────────────────────────
  //   • dirty      → true once the trainer has changed any pill from
  //                  the loaded baseline. Enables the Save button and
  //                  arms the beforeRemove guard.
  //   • submitted  → true after a successful save. Reset when the
  //                  batch or date changes so a fresh session starts
  //                  clean. Blocks duplicate submissions.
  //   • baselineRef → snapshot of the initial attendance map for the
  //                  current (batch, date). We compare against this
  //                  on every tap rather than dead-reckoning from a
  //                  separate flag, so undoing a change back to the
  //                  original clears the dirty state cleanly.
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Compute where the save bar sits vertically. The trainer's bottom
  // tab bar is a FLOATING pill: `position:'absolute'`, 64pt tall,
  // inset from the screen edges with `bottom = Math.max(insets.bottom, 8)`
  // (see StaffTabNavigator.styles.tabBar). The save bar has to clear
  // that pill entirely — otherwise it's rendered UNDER the floating
  // strip and looks invisible. Total clearance:
  //   safe-area bottom inset + 64 (tab height) + 8 (breathing room)
  const insets = useSafeAreaInsets();
  const saveBarBottom = Math.max(insets.bottom, 8) + 64 + 8;
  const baselineRef = useRef({});

  const setStatus = (studentId, status) => {
    setAttendance((prev) => {
      const next = { ...prev, [studentId]: status };
      // Recompute dirty by comparing every key to the baseline. Cheap
      // — the map only holds one enum value per student, worst case
      // ~40 comparisons per tap.
      const base = baselineRef.current || {};
      const changed = Object.keys(next).some((k) => next[k] !== base[k]);
      setDirty(changed);
      // Touching any pill after a submitted save moves the row back
      // into "unsaved edits" territory. We reset `submitted` so the
      // beforeRemove guard fires again if the trainer walks away.
      if (changed && submitted) setSubmitted(false);
      return next;
    });
  };
  const markAllPresent = () => {
    const next = {};
    students.forEach((s) => { next[s.student_id] = 'present'; });
    setAttendance(next);
  };

  // ── Live counters ──
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    Object.values(attendance).forEach((s) => { if (c[s] !== undefined) c[s]++; });
    return c;
  }, [attendance]);

  // ── Filtered student list ──
  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      (s.student_name || '').toLowerCase().includes(q) ||
      (s.student_email || '').toLowerCase().includes(q),
    );
  }, [students, search]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  const submit = async () => {
    if (!selectedBatchId) {
      confirm({
        title:       'Pick a batch first',
        message:     'Choose a batch from the row above before marking attendance.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }
    // Duplicate-submit guards. `saving` is the network-in-flight flag;
    // `submitted` is the "already saved on this batch/date" flag —
    // together they short-circuit a second tap on the same button
    // and a re-render that momentarily re-enables the button.
    if (saving || submitted) return;
    setSaving(true);
    try {
      const records = Object.entries(attendance).map(([studentId, status]) => ({
        student_id: parseInt(studentId, 10),
        status,
      }));
      await apiClient.post('/attendance/bulk', {
        batch_id: selectedBatchId,
        date: isoDate(date),
        records,
      });
      // Flip both flags BEFORE the success dialog so if the trainer
      // taps quickly the button stays disabled.
      setSubmitted(true);
      setDirty(false);
      baselineRef.current = { ...attendance };

      // Branded success card + a "View history" shortcut so the
      // trainer can immediately confirm the write landed.
      confirm({
        title:       'Attendance saved',
        message:
          `${records.length} students marked for ${fmtDate(date)}. ` +
          `Records are available in Attendance History.`,
        variant:     'success',
        confirmText: 'View history',
        cancelText:  'Done',
        onConfirm: () => {
          // Trainer: History lives on the OUTER trainer stack; this
          // Attendance screen is inside StaffTabs, so hop via the
          // parent stack. Branch admin: History is a sibling stack
          // screen, so a direct navigate works.
          const params = { mode };
          if (mode === 'branch') {
            try { navigation.navigate(historyRoute, params); return; } catch (_) {}
            try { navigation.getParent()?.navigate(historyRoute, params); } catch (__) {}
            return;
          }
          try {
            navigation.getParent()?.navigate(historyRoute, params);
          } catch (_) {
            try { navigation.navigate(historyRoute, params); } catch (__) {}
          }
        },
        onCancel:  () => { try { navigation.goBack(); } catch (_) {} },
      });
    } catch (err) {
      // Surface the schedule guard's specific error code with a clear
      // hint so the trainer knows to switch dates instead of thinking
      // the network is broken.
      const code = err.response?.data?.code;
      if (code === 'NOT_A_CLASS_DAY') {
        confirm({
          title:       'Not a scheduled class day',
          message:     `${fmtDate(date)} isn't in this batch's schedule (${selectedBatchForStrip?.days_of_week || 'not set'}). Pick a scheduled day and try again.`,
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      } else {
        confirm({
          title:       'Could not save',
          message:     err.response?.data?.message || err.message || 'Try again.',
          variant:     'destructive',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Before-leave guard ───────────────────────────────────────────
  // Refuses to let the trainer walk away with unsaved changes. Only
  // arms when `dirty` is true AND the trainer hasn't just successfully
  // submitted — so a clean landing (or a fresh submit) never blocks
  // the back arrow. Uses navigation.addListener('beforeRemove') so it
  // catches header back, hardware back, and swipe-back all at once.
  useEffect(() => {
    const beforeRemove = (e) => {
      if (!dirty || submitted) return;
      e.preventDefault();
      confirm({
        title:       'Discard unsaved attendance?',
        message:     'You marked attendance but haven\'t saved yet. Leaving now will lose your changes.',
        variant:     'warning',
        confirmText: 'Discard',
        cancelText:  'Keep editing',
        onConfirm: () => {
          // Flip submitted so the re-dispatched action isn't blocked
          // by this same listener recursively.
          setSubmitted(true);
          navigation.dispatch(e.data.action);
        },
      });
    };
    const unsub = navigation.addListener('beforeRemove', beforeRemove);
    return unsub;
  }, [navigation, dirty, submitted]);

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode: themeMode, palette: themePalette } = useTheme();
  const isDark = themeMode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  // ── Render ──
  return (
    <AttendanceCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      {/* Header */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : HEADER_NAVY} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>{headerTitle}</Text>
          {selectedBatch ? (
            <Text style={[styles.headerSub, isDark && dark.headerSub]} numberOfLines={1}>
              {selectedBatch.name}
              {selectedBatch.course_name ? ` · ${selectedBatch.course_name}` : ''}
            </Text>
          ) : null}
        </View>
        {/* Branch admins get an Export chip alongside History. Trainers
            don't — they don't own the attendance ledger for a whole
            branch, and the backend export route requires role='admin'
            anyway. */}
        {mode === 'branch' ? (
          <TouchableOpacity
            onPress={() => setExportOpen(true)}
            style={[styles.historyBtn, styles.exportBtn]}
            activeOpacity={0.85}
          >
            <Download size={14} color={palette.green.on} strokeWidth={2.4} />
            <Text style={[styles.historyBtnText, styles.exportBtnText]}>Export</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => {
            // Trainer History sits on the outer stack (parent hop);
            // Branch History is a sibling stack screen (direct hop).
            const params = { batchId: selectedBatchId, mode };
            if (mode === 'branch') {
              try { navigation.navigate(historyRoute, params); return; } catch (_) {}
              try { navigation.getParent()?.navigate(historyRoute, params); } catch (__) {}
              return;
            }
            try {
              navigation.getParent()?.navigate(historyRoute, params);
            } catch (_) {
              try { navigation.navigate(historyRoute, params); } catch (__) {}
            }
          }}
          style={styles.historyBtn}
        >
          <History size={16} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      {/* Branch attendance export modal. `isBranchAdmin` hides the
          branch chip picker (server enforces the scope anyway) and
          the modal appends the JWT to the URL so Linking.openURL
          hits the backend authenticated. */}
      {mode === 'branch' ? (
        <ExportAttendanceModal
          visible={exportOpen}
          onClose={() => setExportOpen(false)}
          isBranchAdmin
        />
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        // Padding needs to clear BOTH the floating save bar (~68pt)
        // AND the floating tab pill below it (see saveBarBottom
        // calc above) so the last student row isn't hidden under
        // either.
        contentContainerStyle={{ paddingBottom: saveBarBottom + 80 }}
      >
        {/* Batch chips */}
        <View style={styles.sectionLabel}>
          <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>BATCH</Text>
        </View>
        {loadingBatches ? (
          <ActivityIndicator color={palette.purple.vivid} style={{ marginVertical: spacing.md }} />
        ) : batches.length === 0 ? (
          <Text style={styles.emptyLine}>No batches assigned to you yet.</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm }}
          >
            {batches.map((b) => {
              const active = b.id === selectedBatchId;
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.batchChip, active && styles.batchChipActive]}
                  onPress={() => setSelectedBatchId(b.id)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.batchChipText, active && styles.batchChipTextActive]} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={[styles.batchChipMeta, active && styles.batchChipMetaActive]}>
                    {b.enrolled_count || 0} students
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Class Days — monthly calendar view. Scheduled batch days
            are the ONLY tappable cells; non-scheduled days render
            greyed out and are inert. The header shows the batch's
            configured meeting days as a hint. */}
        <View style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          <CalendarDays size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.sectionLabelText}>CLASS DAYS</Text>
          {selectedBatchForStrip?.days_of_week ? (
            <Text style={[styles.sectionLabelText, {
              marginLeft: 'auto', color: palette.text, fontWeight: '800',
            }]}>
              {selectedBatchForStrip.days_of_week}
            </Text>
          ) : null}
        </View>

        <CalendarMonth
          year={visibleMonth.year}
          monthIndex={visibleMonth.month}
          grid={monthGrid}
          selectedIso={isoDate(date)}
          isDayScheduled={isDayScheduled}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          onPick={(d) => setDate(new Date(d))}
        />

        {!selectedBatchForStrip?.days_of_week ? (
          <View style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.sm }}>
            <Text style={{
              fontSize: 12, color: palette.textMuted, fontStyle: 'italic',
            }}>
              Class days aren't configured for this batch. Set{' '}
              <Text style={{ fontWeight: '800' }}>Days of Week</Text> on the
              batch to lock the calendar to scheduled days only.
            </Text>
          </View>
        ) : null}

        {/* Live counters */}
        {students.length > 0 && (
          <View style={styles.counterStrip}>
            {STATUSES.map((s) => (
              <View key={s.key} style={[styles.counterTile, { backgroundColor: s.accent.soft }]}>
                <Text style={[styles.counterValue, { color: s.accent.on }]}>{counts[s.key] || 0}</Text>
                <Text style={[styles.counterLabel, { color: s.accent.on }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Search + Quick action */}
        {students.length > 0 && (
          <View style={styles.toolsRow}>
            <View style={styles.searchWrap}>
              <Search size={16} color={palette.textMuted} strokeWidth={2.2} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search student"
                placeholderTextColor={palette.textLight}
                style={styles.searchInput}
              />
            </View>
            <TouchableOpacity style={styles.allPresentBtn} onPress={markAllPresent} activeOpacity={0.85}>
              <Check size={14} color={palette.green.on} strokeWidth={2.6} />
              <Text style={styles.allPresentText}>All Present</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Student list */}
        {loadingStudents ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : students.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>
              {selectedBatchId ? 'No students in this batch' : 'Pick a batch above'}
            </Text>
            <Text style={styles.emptySub}>
              {selectedBatchId
                ? 'Once students are enrolled, they\'ll show up here.'
                : 'Choose one of your batches to mark attendance.'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm, marginTop: spacing.md }}>
            {visibleStudents.map((s) => (
              <StudentRow
                key={s.student_id}
                student={s}
                status={attendance[s.student_id] || 'present'}
                onSet={(status) => setStatus(s.student_id, status)}
              />
            ))}
            {visibleStudents.length === 0 ? (
              <Text style={styles.emptyLine}>No students match "{search}".</Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Sticky save bar — ALWAYS rendered so the button is visible
          even before a batch is picked. Per the Attendance Enhancement
          spec, Submit is enabled and highlighted BY DEFAULT whenever
          attendance can be submitted — dropping the earlier
          "must-tap-something-first" rule. Every student already has
          a default status ('present') at load, so the trainer can
          submit immediately if that's what they want.
          Button state contract:
            • disabled while the network write is in flight (saving)
            • disabled after a successful save (submitted) — prevents
              duplicate submissions on double-taps or re-renders
            • disabled when there are no students to mark
            • otherwise ENABLED (highlighted brand color) */}
      <View style={[styles.saveBar, { bottom: saveBarBottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.saveBarLabel} numberOfLines={1}>{fmtDate(date)}</Text>
          <Text style={styles.saveBarCount} numberOfLines={1}>
            {students.length === 0
              ? 'No students to mark'
              : `${Object.keys(attendance).length} students${
                  dirty ? ' · unsaved changes' : (submitted ? ' · saved ✓' : ' · ready to submit')
                }`}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.saveBtn,
            (saving || submitted || students.length === 0) && styles.saveBtnDisabled,
            submitted && styles.saveBtnDone,
          ]}
          onPress={submit}
          disabled={saving || submitted || students.length === 0}
          activeOpacity={0.9}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : submitted ? (
            <Text style={styles.saveBtnText}>Saved ✓</Text>
          ) : (
            <Text style={styles.saveBtnText}>Submit attendance</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
    </AttendanceCtx.Provider>
  );
}

// ─── Monthly calendar ─────────────────────────────────────────────────────
// Renders a 7-column grid for the given month. Scheduled batch days
// are the only tappable cells; non-scheduled days display greyed out
// and are inert. Today's date carries a small dot; the selected date
// gets a filled purple pill so it stays visible even after the trainer
// scrolls through the student list.
function CalendarMonth({
  year, monthIndex, grid, selectedIso, isDayScheduled,
  onPrev, onNext, onPick,
}) {
  const todayIso = isoDate(new Date());
  return (
    <View style={styles.calendarWrap}>
      {/* Month header with prev/next arrows */}
      <View style={styles.calendarHead}>
        <TouchableOpacity onPress={onPrev} style={styles.calendarNav} activeOpacity={0.85} hitSlop={8}>
          <ChevronLeft size={18} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={styles.calendarTitle}>
          {MONTH_NAMES[monthIndex]} {year}
        </Text>
        <TouchableOpacity onPress={onNext} style={styles.calendarNav} activeOpacity={0.85} hitSlop={8}>
          <ChevronRight size={18} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      {/* Weekday header */}
      <View style={styles.calendarDaysRow}>
        {DAYS_SHORT.map((d) => (
          <Text key={d} style={styles.calendarDayLabel}>{d}</Text>
        ))}
      </View>

      {/* 7-col grid, chunked into rows */}
      {Array.from({ length: Math.ceil(grid.length / 7) }).map((_, rowIdx) => {
        const row = grid.slice(rowIdx * 7, rowIdx * 7 + 7);
        return (
          <View key={rowIdx} style={styles.calendarRow}>
            {row.map((cell) => {
              const inMonth  = cell.inMonth;
              const scheduled = inMonth && isDayScheduled(cell.date);
              const selected  = cell.iso === selectedIso;
              const isToday   = cell.iso === todayIso;
              const tappable  = scheduled && inMonth;
              return (
                <TouchableOpacity
                  key={cell.iso}
                  disabled={!tappable}
                  activeOpacity={0.75}
                  onPress={() => tappable && onPick(cell.date)}
                  style={[
                    styles.calendarCell,
                    !inMonth && styles.calendarCellOutside,
                    selected && styles.calendarCellSelected,
                    tappable && !selected && styles.calendarCellTappable,
                  ]}
                >
                  <Text style={[
                    styles.calendarCellText,
                    !inMonth && styles.calendarCellTextOutside,
                    !scheduled && inMonth && styles.calendarCellTextDisabled,
                    selected && styles.calendarCellTextSelected,
                  ]}>
                    {cell.date.getDate()}
                  </Text>
                  {isToday && !selected ? (
                    <View style={styles.calendarTodayDot} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}

      {/* Legend */}
      <View style={styles.calendarLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: palette.purple.vivid }]} />
          <Text style={styles.legendText}>Selected</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: palette.purple.soft, borderWidth: 1, borderColor: palette.purple.soft }]} />
          <Text style={styles.legendText}>Class day</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: palette.borderSoft }]} />
          <Text style={styles.legendText}>Disabled</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Student row ──────────────────────────────────────────────────────────
function StudentRow({ student, status, onSet }) {
  const initials = (student.student_name || 'S')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const current = STATUSES.find((s) => s.key === status) || STATUSES[0];

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.avatar, { backgroundColor: current.accent.soft }]}>
          <Text style={[styles.avatarText, { color: current.accent.on }]}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>{student.student_name}</Text>
          <Text style={styles.studentMeta} numberOfLines={1}>
            {student.student_email || `#${student.student_id}`}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: current.accent.vivid }]}>
          <Text style={styles.statusBadgeText}>{current.short}</Text>
        </View>
      </View>

      {/* Status pills */}
      <View style={styles.pillRow}>
        {STATUSES.map((s) => {
          const active = s.key === status;
          const Icon = s.icon;
          return (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.pill,
                active && { backgroundColor: s.accent.vivid, borderColor: s.accent.vivid },
              ]}
              onPress={() => onSet(s.key)}
              activeOpacity={0.85}
            >
              <Icon size={13} color={active ? '#fff' : s.accent.vivid} strokeWidth={2.4} />
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Institution Home ambient page base — the wash SVG paints on top.
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },

  // Header — glass slab with a navy title and soft blue lift shadow.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.md,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { ...type.h1, color: HEADER_NAVY, fontSize: 18, letterSpacing: 0.2 },
  headerSub:   { ...type.caption, color: palette.textMuted, marginTop: 1, fontWeight: '600' },
  historyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
  },
  historyBtnText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },
  // Export chip — same shape as History, tinted green so the branch
  // admin's two header actions are visually distinct at a glance.
  exportBtn: {
    marginRight: 6,
    backgroundColor: palette.green.soft,
  },
  exportBtnText: { color: palette.green.on },

  // Section label
  sectionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabelText: { ...type.micro, color: palette.textMuted, fontWeight: '800', letterSpacing: 1 },
  emptyLine: { ...type.caption, color: palette.textMuted, paddingHorizontal: spacing.xl, marginVertical: spacing.sm },

  // Batch chip
  batchChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1, borderColor: palette.borderSoft,
    minWidth: 140,
  },
  batchChipActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  batchChipText: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  batchChipTextActive: { color: '#fff' },
  batchChipMeta: { ...type.micro, color: palette.textMuted, marginTop: 2 },
  batchChipMetaActive: { color: 'rgba(255,255,255,0.85)' },

  // Date card
  dateCard: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    alignItems: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  dateCardActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  dateDay: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  dateDayActive: { color: 'rgba(255,255,255,0.9)' },
  dateNum: { ...type.h1, color: palette.text, fontSize: 20, marginTop: 2 },
  dateNumActive: { color: '#fff' },
  todayDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: palette.purple.vivid,
    marginTop: 2,
  },

  // Counter strip
  counterStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
  },
  counterTile: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  counterValue: { ...type.h1, fontSize: 18 },
  counterLabel: { ...type.micro, fontWeight: '700', marginTop: 1 },

  // Tools
  toolsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  searchInput: { flex: 1, ...type.body, paddingVertical: 10, color: palette.text },
  allPresentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.green.soft,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.green.vivid,
  },
  allPresentText: { ...type.caption, color: palette.green.on, fontWeight: '700' },

  // Student row
  row: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...type.bodyBold, fontWeight: '800' },
  studentName: { ...type.bodyBold, color: palette.text },
  studentMeta: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  statusBadge: {
    minWidth: 30, height: 24,
    paddingHorizontal: 8, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  statusBadgeText: { ...type.micro, color: '#fff', fontWeight: '800' },

  pillRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
  },
  pill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  pillText: { ...type.micro, color: palette.text, fontWeight: '700' },
  pillTextActive: { color: '#fff' },

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

  // Save bar — absolute positioned so it floats above the tab pill
  // instead of being pushed off the screen. The `bottom` offset is
  // set at render time to (safe-area + tab-height + breathing room)
  // so the bar clears the trainer's floating tab bar cleanly.
  saveBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    // bottom is set inline via saveBarBottom
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: palette.borderSoft,
    ...shadows.raised,
  },
  saveBarLabel: { ...type.bodyBold, color: palette.text },
  saveBarCount: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  saveBtn: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    minWidth: 160,
    alignItems: 'center', justifyContent: 'center',
  },
  // Disabled state — solid grey, not translucent. Makes "you can't
  // tap this yet" visually obvious instead of looking absent.
  saveBtnDisabled: {
    backgroundColor: palette.borderSoft,
  },
  // Post-save state — green fill so the trainer sees success at a
  // glance in the sticky bar as well as the dialog.
  saveBtnDone: {
    backgroundColor: palette.green.vivid,
  },
  saveBtnText: { ...type.bodyBold, color: '#fff', fontWeight: '700' },

  // ── Monthly calendar ─────────────────────────────────────────
  calendarWrap: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  calendarHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  calendarNav: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  calendarTitle: { ...type.bodyBold, color: palette.text, fontSize: 15, fontWeight: '800' },

  calendarDaysRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calendarDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    color: palette.textMuted,
    letterSpacing: 0.5,
    paddingVertical: 4,
  },

  calendarRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  calendarCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 2,
    backgroundColor: 'transparent',
  },
  calendarCellOutside: {
    opacity: 0.4,
  },
  calendarCellTappable: {
    backgroundColor: palette.purple.soft,
  },
  calendarCellSelected: {
    backgroundColor: palette.purple.vivid,
  },
  calendarCellText: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.text,
  },
  calendarCellTextDisabled: {
    color: palette.textLight,
    fontWeight: '600',
  },
  calendarCellTextOutside: {
    color: palette.textLight,
  },
  calendarCellTextSelected: {
    color: '#fff',
    fontWeight: '800',
  },
  calendarTodayDot: {
    position: 'absolute',
    bottom: 4,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: palette.purple.vivid,
  },
  calendarLegend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: {
    width: 10, height: 10, borderRadius: 5,
  },
  legendText: { fontSize: 10, color: palette.textMuted, fontWeight: '700' },
});
