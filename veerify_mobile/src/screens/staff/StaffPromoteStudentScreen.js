// src/screens/staff/StaffPromoteStudentScreen.js
//
// Trainer / admin flow to promote a student to the next belt. Submitting
// creates the promotion + auto-generates a 'belt' certificate, then fires
// notifications to the student + parents.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, User, Award, Send, ChevronDown, X, Search,
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

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function StaffPromoteStudentScreen({ navigation, route }) {
  const prefilledStudent = route?.params?.student || null;

  const [students, setStudents] = useState([]);
  const [belts,    setBelts]    = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(true);

  const [form, setForm] = useState({
    student_id:        prefilledStudent?.id || null,
    student_name:      prefilledStudent?.name || '',
    belt_level_id:     null,
    belt_level_name:   '',
    promoted_at:       todayISO(),
    instructor_name:   '',
    performance_notes: '',
    remarks:           '',
  });

  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [beltPickerOpen,    setBeltPickerOpen]    = useState(false);
  const [studentSearch,     setStudentSearch]     = useState('');
  const [submitting,        setSubmitting]        = useState(false);

  // Load the trainer's batch roster + the institution's belt levels.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Batches → expand to enrollments to get students.
        const seen = new Map();
        try {
          const bRes = await apiClient.get('/batches/trainer/my');
          for (const b of bRes.data?.batches || []) {
            try {
              const er = await apiClient.get(`/enrollments/batch/${b.id}`);
              (er.data?.enrollments || []).forEach((e) => {
                if (!seen.has(e.student_id)) {
                  seen.set(e.student_id, {
                    id: e.student_id, name: e.student_name, email: e.student_email,
                    batch_name: b.name, course_name: b.course_name,
                  });
                }
              });
            } catch {}
          }
        } catch (err) {
          console.log('[Promote] roster failed:', err?.message);
        }
        if (!cancelled) setStudents(Array.from(seen.values()));

        // 2. Belts list.
        try {
          const lr = await apiClient.get('/belts/levels');
          if (!cancelled) setBelts(lr.data?.belts || []);
        } catch (err) {
          console.log('[Promote] belts failed:', err?.message);
        }
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q),
    );
  }, [students, studentSearch]);

  const submit = async () => {
    if (!form.student_id) {
      Alert.alert('Pick a student', 'Choose which student you want to promote.');
      return;
    }
    if (!form.belt_level_id) {
      Alert.alert('Pick a belt', 'Select the new belt level for this student.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/belts/promote', {
        student_id:        form.student_id,
        belt_level_id:     form.belt_level_id,
        promoted_at:       form.promoted_at,
        instructor_name:   form.instructor_name.trim() || null,
        performance_notes: form.performance_notes.trim() || null,
        remarks:           form.remarks.trim() || null,
      });
      Alert.alert(
        'Promotion published 🎉',
        `${form.student_name} has been promoted to ${form.belt_level_name}. A certificate has been generated and the student + parents have been notified.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert(
        'Could not promote',
        err?.response?.data?.message || err?.message || 'Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

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
          <Text style={styles.headerTitle}>Promote student</Text>
          <Text style={styles.headerSubtitle}>Award the next belt + certificate</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Student */}
        <Field label="Student" required>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setStudentPickerOpen(true)}
            activeOpacity={0.85}
          >
            <User size={14} color={TEXT_MUTED} />
            <Text style={[styles.inputText, !form.student_name && styles.placeholder]}>
              {form.student_name || 'Choose a student'}
            </Text>
            <ChevronDown size={16} color={TEXT_MUTED} />
          </TouchableOpacity>
        </Field>

        {/* Belt level */}
        <Field label="New belt" required>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setBeltPickerOpen(true)}
            activeOpacity={0.85}
            disabled={belts.length === 0}
          >
            <Award size={14} color={TEXT_MUTED} />
            <Text style={[styles.inputText, !form.belt_level_name && styles.placeholder]}>
              {form.belt_level_name || (belts.length === 0 ? 'Loading belt levels…' : 'Choose a belt')}
            </Text>
            <ChevronDown size={16} color={TEXT_MUTED} />
          </TouchableOpacity>
        </Field>

        {/* Date */}
        <Field label="Promotion date">
          <DateField
            value={form.promoted_at}
            onChange={(v) => setForm((p) => ({ ...p, promoted_at: v }))}
            accent={BRAND}
          />
        </Field>

        {/* Instructor name */}
        <Field label="Instructor name" hint="Appears on the certificate.">
          <TextInput
            value={form.instructor_name}
            onChangeText={(v) => setForm((p) => ({ ...p, instructor_name: v }))}
            placeholder="e.g. Sensei Rahul"
            placeholderTextColor={TEXT_LIGHT}
            style={styles.textInput}
          />
        </Field>

        {/* Performance notes */}
        <Field label="Performance notes">
          <TextInput
            value={form.performance_notes}
            onChangeText={(v) => setForm((p) => ({ ...p, performance_notes: v }))}
            placeholder="Test results, key strengths, areas demonstrated..."
            placeholderTextColor={TEXT_LIGHT}
            style={[styles.textInput, styles.textarea]}
            multiline
          />
        </Field>

        {/* Remarks */}
        <Field label="Remarks">
          <TextInput
            value={form.remarks}
            onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))}
            placeholder="Congratulatory note for the student / family."
            placeholderTextColor={TEXT_LIGHT}
            style={[styles.textInput, styles.textarea]}
            multiline
          />
        </Field>

        <TouchableOpacity
          onPress={submit}
          disabled={submitting}
          style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Send size={14} color="#fff" strokeWidth={2.4} />
              <Text style={styles.submitText}>Promote student</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Student picker */}
      {studentPickerOpen ? (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick a student</Text>
              <TouchableOpacity onPress={() => setStudentPickerOpen(false)} hitSlop={8}>
                <X size={18} color={TEXT_MUTED} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Search size={14} color={TEXT_MUTED} />
              <TextInput
                value={studentSearch}
                onChangeText={setStudentSearch}
                placeholder="Search name or email"
                placeholderTextColor={TEXT_LIGHT}
                style={styles.searchInput}
              />
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              {loadingRoster ? (
                <View style={{ padding: 14, alignItems: 'center' }}>
                  <ActivityIndicator color={BRAND} />
                </View>
              ) : filteredStudents.length === 0 ? (
                <Text style={styles.placeholder}>
                  {students.length === 0
                    ? 'No enrolled students in your batches yet.'
                    : 'No matches.'}
                </Text>
              ) : (
                filteredStudents.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.pickItem}
                    onPress={() => {
                      setForm((p) => ({
                        ...p,
                        student_id: s.id,
                        student_name: s.name,
                      }));
                      setStudentPickerOpen(false);
                      setStudentSearch('');
                    }}
                  >
                    <User size={14} color={TEXT_MUTED} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName}>{s.name}</Text>
                      <Text style={styles.pickMeta}>
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

      {/* Belt picker */}
      {beltPickerOpen ? (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick belt level</Text>
              <TouchableOpacity onPress={() => setBeltPickerOpen(false)} hitSlop={8}>
                <X size={18} color={TEXT_MUTED} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              {belts.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.pickItem}
                  onPress={() => {
                    setForm((p) => ({
                      ...p,
                      belt_level_id: b.id,
                      belt_level_name: b.name,
                    }));
                    setBeltPickerOpen(false);
                  }}
                >
                  <View style={[styles.beltChip, { backgroundColor: b.color_hex }]}>
                    <Text style={{ fontSize: 14 }}>{b.emoji || '🥋'}</Text>
                  </View>
                  <Text style={styles.pickName}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}{required ? <Text style={{ color: BRAND }}> *</Text> : null}
      </Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: BG, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSubtitle: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },

  scrollContent: { padding: 16 },

  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  fieldHint: { fontSize: 11, color: TEXT_LIGHT, marginBottom: 6 },

  input: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE, minHeight: 44,
  },
  inputText: { flex: 1, fontSize: 14, color: TEXT },
  placeholder: { color: TEXT_LIGHT },

  textInput: {
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE,
    fontSize: 14, color: TEXT, minHeight: 44,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14,
    backgroundColor: BRAND,
    borderRadius: 12, marginTop: 8,
  },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // Modals
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 18,
  },
  modalCard: {
    width: '100%', backgroundColor: SURFACE,
    borderRadius: 14, padding: 16, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, paddingHorizontal: 10, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: TEXT, paddingVertical: 8 },

  pickItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 6,
    borderRadius: 8,
  },
  pickName: { fontSize: 14, fontWeight: '700', color: TEXT },
  pickMeta: { fontSize: 11, color: TEXT_MUTED, marginTop: 1 },

  beltChip: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
});
