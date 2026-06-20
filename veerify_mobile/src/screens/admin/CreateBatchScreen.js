// src/screens/admin/CreateBatchScreen.js
//
// Polished form for institution admins to create a batch. Course and
// trainer pickers are proper dropdowns that auto-populate from the
// institution's existing courses (GET /courses) and trainers
// (GET /trainers). All other fields are unchanged from the previous
// version — backend wiring is untouched per the user's instruction
// ("first do UI and finally we will backend").

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, StatusBar, Modal, FlatList, Platform,
} from 'react-native';
import {
  ArrowLeft, BookOpen, Users, Calendar, Clock,
  IndianRupee, MapPin, ChevronDown, Check, X,
} from 'lucide-react-native';
import apiClient from '../../api/client';

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

export default function CreateBatchScreen({ navigation }) {
  const [courses,  setCourses]  = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);

  const [form, setForm] = useState({
    course_id:    null,
    trainer_id:   null,
    name:         '',
    days_of_week: 'Mon,Wed,Fri',  // derived from `schedule` on submit
    start_time:   '06:00',         // derived (earliest selected start)
    end_time:     '07:00',         // derived (latest  selected end)
    capacity:     '20',
    mode:         'offline',
  });

  // Per-day schedule. Each weekday holds { enabled, start, end }. Only
  // enabled days are rolled into the legacy days_of_week / start_time /
  // end_time fields when submitting. Defaults preserve the old behaviour
  // (Mon + Wed + Fri at 06:00 – 07:00) so existing tests still work.
  const [schedule, setSchedule] = useState(() => {
    const initial = {};
    WEEKDAYS.forEach((d) => {
      const preset = ['Mon', 'Wed', 'Fri'].includes(d.key);
      initial[d.key] = {
        enabled: preset,
        start: '06:00',
        end:   '07:00',
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
        const [c, t] = await Promise.all([
          apiClient.get('/courses'),
          apiClient.get('/trainers'),
        ]);
        setCourses(c?.data?.courses || []);
        setTrainers(t?.data?.trainers || []);
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

  const submit = async () => {
    if (!form.course_id) {
      Alert.alert('Required', 'Please pick a course.');
      return;
    }
    if (!form.name.trim()) {
      Alert.alert('Required', 'Batch name is required.');
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
      Alert.alert('Pick at least one day', 'Choose the days the batch runs and set their times.');
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
      Alert.alert(
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
      await apiClient.post('/batches', {
        ...form,
        days_of_week: daysCsv,
        start_time:   fmt(startMin),
        end_time:     fmt(endMin),
        schedule:     scheduleByDay,
        capacity:     parseInt(form.capacity, 10) || 20,
      });
      Alert.alert('Success', 'Batch created!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed');
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
          <Text style={styles.headerTitle}>New Batch</Text>
          <Text style={styles.headerSub}>Schedule a class under one of your courses</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
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
        <Section title="Trainer" icon={Users}>
          <Text style={styles.label}>Assign a trainer (optional)</Text>
          <InlineDropdown
            icon={Users}
            placeholder={
              loadingLists
                ? 'Loading your trainers…'
                : trainers.length === 0
                  ? 'No trainers yet — leave unassigned'
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
            items={trainers}
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
            <Text style={styles.submitBtnText}>Create Batch</Text>
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
}) {
  const hasValue = !!value;
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
          {(items || []).length === 0 && !leadingNone ? (
            <Text style={styles.inlineEmpty}>Nothing here yet.</Text>
          ) : null}
          {(items || []).map((item) => {
            const sel = item.id === selectedId;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.inlineRow, sel && styles.inlineRowSelected]}
                onPress={() => onSelect(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.inlineRowText} numberOfLines={1}>
                  {item.name}
                </Text>
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
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  inlineEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 12,
    color: TEXT_LIGHT,
    fontStyle: 'italic',
    textAlign: 'center',
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
});
