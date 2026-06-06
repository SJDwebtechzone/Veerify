// src/screens/staff/StaffPerformanceReportFormScreen.js
//
// Create or edit a student performance report. The full 10-section form
// from the spec. Route params:
//   { mode: 'create' | 'edit', report?, prefilledStudent? }
//
// 'prefilledStudent' lets the screen open from StaffStudentDetail with the
// student already chosen; otherwise the trainer picks from their roster.
//
// Media upload (Section 8) is deferred — the field accepts pasted URLs for
// now; native file picker integration will land in v2.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Save, Send, Star, User, ChevronDown, X, Plus,
  CheckSquare, Square, Trash2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const STAR_ON     = '#F59E0B';
const STAR_OFF    = '#E5E7EB';

const BELT_LEVELS = [
  'White Belt', 'Yellow Belt', 'Orange Belt', 'Green Belt',
  'Blue Belt', 'Brown Belt', 'Black Belt',
];

const RATING_FIELDS = [
  { key: 'discipline_rating', label: 'Discipline' },
  { key: 'attendance_rating', label: 'Attendance' },
  { key: 'technique_rating',  label: 'Technique' },
  { key: 'fitness_rating',    label: 'Fitness' },
  { key: 'sparring_rating',   label: 'Sparring' },
  { key: 'behaviour_rating',  label: 'Focus & Behaviour' },
];

const COMMON_GOALS = [
  'Improve kicking technique',
  'Increase stamina',
  'Prepare for next belt test',
  'Improve flexibility',
];

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function StaffPerformanceReportFormScreen({ navigation, route }) {
  const mode = route?.params?.mode || 'create';
  const prefillReport = route?.params?.report || null;
  const prefilledStudent = route?.params?.prefilledStudent || null;

  // ── Form state ─────────────────────────────────────────────────────────
  const [form, setForm] = useState(() => ({
    student_id:        prefillReport?.student_id || prefilledStudent?.id || null,
    student_name:      prefillReport?.student_name || prefilledStudent?.name || '',
    batch_id:          prefillReport?.batch_id || null,
    batch_name:        prefillReport?.batch_name || '',
    course_name:       prefillReport?.course_name || '',
    report_date:       prefillReport?.report_date
                         ? String(prefillReport.report_date).slice(0, 10)
                         : todayISO(),
    belt_level:        prefillReport?.belt_level || '',
    discipline_rating: prefillReport?.discipline_rating || 0,
    attendance_rating: prefillReport?.attendance_rating || 0,
    technique_rating:  prefillReport?.technique_rating  || 0,
    fitness_rating:    prefillReport?.fitness_rating    || 0,
    sparring_rating:   prefillReport?.sparring_rating   || 0,
    behaviour_rating:  prefillReport?.behaviour_rating  || 0,
    strengths:         prefillReport?.strengths       || '',
    improvements:      prefillReport?.improvements    || '',
    trainer_remarks:   prefillReport?.trainer_remarks || '',
    next_goals:        Array.isArray(prefillReport?.next_goals) ? prefillReport.next_goals
                          : (typeof prefillReport?.next_goals === 'string'
                              ? safeParse(prefillReport.next_goals) : []),
    classes_attended:  prefillReport?.classes_attended != null ? String(prefillReport.classes_attended) : '',
    classes_missed:    prefillReport?.classes_missed   != null ? String(prefillReport.classes_missed)   : '',
    media_urls:        Array.isArray(prefillReport?.media_urls) ? prefillReport.media_urls
                          : (typeof prefillReport?.media_urls === 'string'
                              ? safeParse(prefillReport.media_urls) : []),
    visible_to_student: prefillReport ? !!prefillReport.visible_to_student : true,
    visible_to_parent:  prefillReport ? !!prefillReport.visible_to_parent  : true,
  }));

  const [students,  setStudents]  = useState([]);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [beltPickerOpen, setBeltPickerOpen] = useState(false);

  const [goalDraft, setGoalDraft] = useState('');
  const [mediaDraft, setMediaDraft] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // ── Load students for the picker ───────────────────────────────────────
  useEffect(() => {
    if (prefilledStudent || prefillReport) return; // no need to pick
    let cancelled = false;
    (async () => {
      try {
        // Use the trainer's enrolled-students view via batches/trainer/my
        // expanded to student roster.
        const res = await apiClient.get('/batches/trainer/my');
        const batches = res.data?.batches || [];
        // Build a quick set of student stubs from each batch's enrollments
        // by hitting /enrollments/batch/:id. We avoid N round-trips by
        // doing it sequentially below.
        const seen = new Map();
        for (const b of batches) {
          try {
            const er = await apiClient.get(`/enrollments/batch/${b.id}`);
            (er.data?.enrollments || []).forEach((e) => {
              if (!seen.has(e.student_id)) {
                seen.set(e.student_id, {
                  id: e.student_id,
                  name: e.student_name,
                  email: e.student_email,
                  batch_id: b.id,
                  batch_name: b.name,
                  course_name: b.course_name,
                });
              }
            });
          } catch {}
        }
        if (!cancelled) setStudents(Array.from(seen.values()));
      } catch (err) {
        console.log('[ReportForm] roster load failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [prefilledStudent, prefillReport]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q),
    );
  }, [students, studentSearch]);

  // ── Save handlers ──────────────────────────────────────────────────────
  const buildBody = () => ({
    student_id:        form.student_id,
    batch_id:          form.batch_id,
    report_date:       form.report_date,
    belt_level:        form.belt_level || null,
    discipline_rating: form.discipline_rating || null,
    attendance_rating: form.attendance_rating || null,
    technique_rating:  form.technique_rating  || null,
    fitness_rating:    form.fitness_rating    || null,
    sparring_rating:   form.sparring_rating   || null,
    behaviour_rating:  form.behaviour_rating  || null,
    strengths:         form.strengths.trim()      || null,
    improvements:      form.improvements.trim()   || null,
    trainer_remarks:   form.trainer_remarks.trim()|| null,
    next_goals:        form.next_goals,
    classes_attended:  form.classes_attended === '' ? null : Number(form.classes_attended),
    classes_missed:    form.classes_missed   === '' ? null : Number(form.classes_missed),
    media_urls:        form.media_urls,
    visible_to_student: form.visible_to_student,
    visible_to_parent:  form.visible_to_parent,
  });

  const validate = () => {
    if (!form.student_id) {
      Alert.alert('Pick a student', 'Please choose which student this report is for.');
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (mode === 'edit' && prefillReport?.id) {
        await apiClient.put(`/performance-reports/${prefillReport.id}`, buildBody());
      } else {
        await apiClient.post('/performance-reports', buildBody());
      }
      Alert.alert('Saved', 'Report saved as draft.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Save failed',
        err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const publish = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      let reportId = prefillReport?.id;
      if (mode === 'edit' && reportId) {
        await apiClient.put(`/performance-reports/${reportId}`, buildBody());
      } else {
        const r = await apiClient.post('/performance-reports', buildBody());
        reportId = r.data?.report?.id;
      }
      if (reportId) {
        await apiClient.post(`/performance-reports/${reportId}/publish`, {});
      }
      Alert.alert(
        'Published',
        'The report is now visible to the student' +
          (form.visible_to_parent ? ' and their parent' : '') + '.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Publish failed',
        err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field setters ──────────────────────────────────────────────────────
  const setRating = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const addGoal = (label) => {
    const v = (label || goalDraft).trim();
    if (!v) return;
    if (form.next_goals.includes(v)) return;
    setForm((p) => ({ ...p, next_goals: [...p.next_goals, v] }));
    setGoalDraft('');
  };
  const toggleGoal = (label) => {
    setForm((p) => p.next_goals.includes(label)
      ? { ...p, next_goals: p.next_goals.filter((g) => g !== label) }
      : { ...p, next_goals: [...p.next_goals, label] });
  };
  const removeGoal = (label) => {
    setForm((p) => ({ ...p, next_goals: p.next_goals.filter((g) => g !== label) }));
  };

  const addMedia = () => {
    const url = mediaDraft.trim();
    if (!url) return;
    const kind = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? 'video' : 'image';
    setForm((p) => ({ ...p, media_urls: [...p.media_urls, { url, kind }] }));
    setMediaDraft('');
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {mode === 'edit' ? 'Edit performance report' : 'Create performance report'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {mode === 'edit' && prefillReport?.status === 'published'
              ? 'Published — edits create a new revision'
              : 'Draft — save and publish when ready'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section 1: Student Information ── */}
        <Section title="Student information">
          <Field label="Student" required>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setStudentPickerOpen(true)}
              disabled={!!prefilledStudent}
              activeOpacity={0.85}
            >
              <Text style={[styles.inputText, !form.student_name && styles.placeholder]}>
                {form.student_name || 'Choose a student'}
              </Text>
              {!prefilledStudent ? <ChevronDown size={16} color={TEXT_MUTED} /> : null}
            </TouchableOpacity>
          </Field>

          {form.course_name || form.batch_name ? (
            <Field label="Course / Batch">
              <View style={styles.readOnlyChip}>
                <Text style={styles.readOnlyText}>
                  {form.course_name}{form.batch_name ? ` · ${form.batch_name}` : ''}
                </Text>
              </View>
            </Field>
          ) : null}

          <Field label="Report date">
            <DateField
              value={form.report_date}
              onChange={(v) => setForm((p) => ({ ...p, report_date: v }))}
              accent={BRAND}
            />
          </Field>

          <Field label="Belt level">
            <TouchableOpacity
              style={styles.input}
              onPress={() => setBeltPickerOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.inputText, !form.belt_level && styles.placeholder]}>
                {form.belt_level || 'Choose belt'}
              </Text>
              <ChevronDown size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
            {beltPickerOpen ? (
              <View style={styles.beltOptions}>
                {BELT_LEVELS.map((b) => (
                  <TouchableOpacity
                    key={b}
                    style={styles.beltOption}
                    onPress={() => {
                      setForm((p) => ({ ...p, belt_level: b }));
                      setBeltPickerOpen(false);
                    }}
                  >
                    <Text style={styles.beltOptionText}>{b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </Field>
        </Section>

        {/* ── Section 2: Performance Ratings ── */}
        <Section title="Performance ratings">
          {RATING_FIELDS.map(({ key, label }) => (
            <View key={key} style={styles.ratingRow}>
              <Text style={styles.ratingLabel}>{label}</Text>
              <StarRow
                value={form[key]}
                onChange={(v) => setRating(key, v)}
              />
            </View>
          ))}
        </Section>

        {/* ── Section 3, 4, 5: Text sections ── */}
        <Section title="Strengths">
          <TextInput
            value={form.strengths}
            onChangeText={(v) => setForm((p) => ({ ...p, strengths: v }))}
            placeholder="Good discipline, quick learning ability, strong focus..."
            placeholderTextColor={TEXT_LIGHT}
            style={[styles.input, styles.textarea]}
            multiline
          />
        </Section>

        <Section title="Areas for improvement">
          <TextInput
            value={form.improvements}
            onChangeText={(v) => setForm((p) => ({ ...p, improvements: v }))}
            placeholder="Improve sparring confidence, stamina, posture during forms..."
            placeholderTextColor={TEXT_LIGHT}
            style={[styles.input, styles.textarea]}
            multiline
          />
        </Section>

        <Section title="Trainer remarks">
          <TextInput
            value={form.trainer_remarks}
            onChangeText={(v) => setForm((p) => ({ ...p, trainer_remarks: v }))}
            placeholder="Excellent progress this month."
            placeholderTextColor={TEXT_LIGHT}
            style={[styles.input, styles.textarea]}
            multiline
          />
        </Section>

        {/* ── Section 6: Next Goals ── */}
        <Section title="Next goals">
          <View style={styles.goalChips}>
            {COMMON_GOALS.map((g) => {
              const on = form.next_goals.includes(g);
              return (
                <TouchableOpacity
                  key={g}
                  onPress={() => toggleGoal(g)}
                  style={[styles.chipToggle, on && styles.chipToggleOn]}
                  activeOpacity={0.85}
                >
                  {on
                    ? <CheckSquare size={13} color="#fff" strokeWidth={2.4} />
                    : <Square size={13} color={TEXT_MUTED} strokeWidth={2.2} />}
                  <Text style={[styles.chipToggleText, on && styles.chipToggleTextOn]}>{g}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.addRow}>
            <TextInput
              value={goalDraft}
              onChangeText={setGoalDraft}
              placeholder="Add a custom goal"
              placeholderTextColor={TEXT_LIGHT}
              style={[styles.input, { flex: 1 }]}
              returnKeyType="done"
              onSubmitEditing={() => addGoal()}
            />
            <TouchableOpacity onPress={() => addGoal()} style={styles.addBtn} activeOpacity={0.85}>
              <Plus size={16} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {form.next_goals.filter((g) => !COMMON_GOALS.includes(g)).map((g) => (
            <View key={g} style={styles.customGoalRow}>
              <Text style={styles.customGoalText}>{g}</Text>
              <TouchableOpacity onPress={() => removeGoal(g)} hitSlop={8}>
                <X size={14} color={TEXT_MUTED} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          ))}
        </Section>

        {/* ── Section 7: Attendance summary ── */}
        <Section title="Attendance summary">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="Classes attended" style={{ flex: 1 }}>
              <TextInput
                value={form.classes_attended}
                onChangeText={(v) => setForm((p) => ({ ...p, classes_attended: v.replace(/[^0-9]/g, '') }))}
                placeholder="18"
                placeholderTextColor={TEXT_LIGHT}
                style={styles.input}
                keyboardType="number-pad"
              />
            </Field>
            <Field label="Classes missed" style={{ flex: 1 }}>
              <TextInput
                value={form.classes_missed}
                onChangeText={(v) => setForm((p) => ({ ...p, classes_missed: v.replace(/[^0-9]/g, '') }))}
                placeholder="2"
                placeholderTextColor={TEXT_LIGHT}
                style={styles.input}
                keyboardType="number-pad"
              />
            </Field>
          </View>
        </Section>

        {/* ── Section 8: Media (URLs only for now) ── */}
        <Section title="Media (optional)" hint="Paste image / video URLs students will see on the report.">
          <View style={styles.addRow}>
            <TextInput
              value={mediaDraft}
              onChangeText={setMediaDraft}
              placeholder="https://..."
              placeholderTextColor={TEXT_LIGHT}
              style={[styles.input, { flex: 1 }]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity onPress={addMedia} style={styles.addBtn} activeOpacity={0.85}>
              <Plus size={16} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          {form.media_urls.map((m, idx) => (
            <View key={idx} style={styles.customGoalRow}>
              <Text style={styles.customGoalText} numberOfLines={1}>
                {m.kind === 'video' ? '🎬' : '🖼️'} {m.url}
              </Text>
              <TouchableOpacity
                onPress={() => setForm((p) => ({ ...p, media_urls: p.media_urls.filter((_, i) => i !== idx) }))}
                hitSlop={8}
              >
                <Trash2 size={14} color={BRAND} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          ))}
        </Section>

        {/* ── Section 9: Visibility ── */}
        <Section title="Visibility">
          <CheckboxRow
            label="Visible to student"
            checked={form.visible_to_student}
            onChange={(v) => setForm((p) => ({ ...p, visible_to_student: v }))}
          />
          <CheckboxRow
            label="Visible to parent"
            checked={form.visible_to_parent}
            onChange={(v) => setForm((p) => ({ ...p, visible_to_parent: v }))}
          />
        </Section>

        {/* ── Actions ── */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={saveDraft}
            disabled={submitting}
            style={[styles.btn, styles.btnGhost, submitting && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={BRAND} size="small" />
            ) : (
              <>
                <Save size={14} color={BRAND} strokeWidth={2.4} />
                <Text style={[styles.btnText, { color: BRAND }]}>Save draft</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={publish}
            disabled={submitting}
            style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Send size={14} color="#fff" strokeWidth={2.4} />
                <Text style={[styles.btnText, { color: '#fff' }]}>Publish report</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Student picker modal (inline) */}
      {studentPickerOpen ? (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick a student</Text>
              <TouchableOpacity onPress={() => setStudentPickerOpen(false)} hitSlop={8}>
                <X size={18} color={TEXT_MUTED} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={studentSearch}
              onChangeText={setStudentSearch}
              placeholder="Search by name or email..."
              placeholderTextColor={TEXT_LIGHT}
              style={styles.input}
              autoCapitalize="none"
            />
            <ScrollView style={{ maxHeight: 320, marginTop: 8 }}>
              {filteredStudents.length === 0 ? (
                <Text style={styles.placeholder}>
                  {students.length === 0 ? 'Loading...' : 'No matching students.'}
                </Text>
              ) : (
                filteredStudents.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.studentOption}
                    onPress={() => {
                      setForm((p) => ({
                        ...p,
                        student_id:   s.id,
                        student_name: s.name,
                        batch_id:     s.batch_id,
                        batch_name:   s.batch_name,
                        course_name:  s.course_name,
                      }));
                      setStudentPickerOpen(false);
                      setStudentSearch('');
                    }}
                  >
                    <User size={14} color={TEXT_MUTED} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName}>{s.name}</Text>
                      <Text style={styles.studentMeta}>
                        {s.course_name}{s.batch_name ? ` · ${s.batch_name}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function safeParse(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Section({ title, hint, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Field({ label, required, children, style }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>
        {label}{required ? <Text style={{ color: BRAND }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function StarRow({ value, onChange }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onChange(value === n ? 0 : n)}
          hitSlop={4}
        >
          <Star
            size={22}
            color={n <= value ? STAR_ON : STAR_OFF}
            fill={n <= value ? STAR_ON : 'transparent'}
            strokeWidth={2}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function CheckboxRow({ label, checked, onChange }) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={() => onChange(!checked)}
      activeOpacity={0.85}
    >
      {checked
        ? <CheckSquare size={18} color={BRAND} strokeWidth={2.4} />
        : <Square size={18} color={TEXT_MUTED} strokeWidth={2.2} />}
      <Text style={styles.checkboxLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: SURFACE,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSubtitle: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },

  scrollContent: { padding: 16 },

  section: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: TEXT, marginBottom: 10 },
  sectionHint:  { fontSize: 11, color: TEXT_MUTED, marginTop: -6, marginBottom: 10 },

  field: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: TEXT,
    minHeight: 42,
  },
  inputText: { flex: 1, fontSize: 14, color: TEXT },
  placeholder: { color: TEXT_LIGHT },
  textarea: { minHeight: 90, textAlignVertical: 'top' },

  readOnlyChip: {
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: BRAND_SOFT,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  readOnlyText: { fontSize: 12, color: BRAND, fontWeight: '700' },

  beltOptions: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: BG,
    overflow: 'hidden',
  },
  beltOption: { paddingVertical: 10, paddingHorizontal: 14 },
  beltOptionText: { fontSize: 13, color: TEXT, fontWeight: '600' },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  ratingLabel: { fontSize: 13, color: TEXT, fontWeight: '600' },
  starRow: { flexDirection: 'row', gap: 4 },

  goalChips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10,
  },
  chipToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BG,
  },
  chipToggleOn: { backgroundColor: BRAND },
  chipToggleText: { fontSize: 12, color: TEXT, fontWeight: '600' },
  chipToggleTextOn: { color: '#fff' },

  addRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  addBtn: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  customGoalRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, gap: 8,
  },
  customGoalText: { flex: 1, fontSize: 13, color: TEXT },

  checkboxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8,
  },
  checkboxLabel: { fontSize: 14, color: TEXT, fontWeight: '600' },

  actionsRow: {
    flexDirection: 'row', gap: 8, marginTop: 8,
  },
  btn: {
    flex: 1, paddingVertical: 13,
    borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  btnGhost: {
    backgroundColor: BRAND_SOFT,
  },
  btnPrimary: { backgroundColor: BRAND },
  btnText: { fontSize: 14, fontWeight: '800' },

  // Modal
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 18,
  },
  modalCard: {
    width: '100%',
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 16,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
  studentOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 8,
  },
  studentName: { fontSize: 14, fontWeight: '700', color: TEXT },
  studentMeta: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },
});
