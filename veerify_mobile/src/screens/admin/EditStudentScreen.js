// src/screens/admin/EditStudentScreen.js
//
// Institution-admin form for editing an existing student's profile.
// Reached by tapping the pencil icon on StudentDetailScreen.
//
// Fields:
//   - Name
//   - Phone
//   - Email
//   - Date of Birth (wheel picker)
//   - Gender (chip select)
//   - Address (multiline)
//   - Father's name
//   - Mother's name
//
// Submits PATCH /api/enrollments/student/:userId. On success, the
// previous screen receives a refresh signal via route.params.updated and
// pops back via navigation.goBack().

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Calendar, Save,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';

const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

export default function EditStudentScreen({ route, navigation }) {
  const student = route?.params?.student || {};
  const studentId =
    student.user_id || student.student_id || student.id;

  // Seed each field from whatever shape the student object arrived in.
  // The student list / detail screens hydrate from a few different
  // endpoints so we accept both `name` and `student_name` etc.
  const [name,         setName]         = useState(student.name || student.student_name || student.full_name || '');
  const [phone,        setPhone]        = useState(student.phone || student.student_phone || student.contact_number || '');
  const [email,        setEmail]        = useState(student.email || student.student_email || '');
  const [dob,          setDob]          = useState(student.date_of_birth || student.dob || '');
  const [gender,       setGender]       = useState(student.gender || student.student_gender || '');
  const [address,      setAddress]      = useState(student.address || '');
  const [fatherName,   setFatherName]   = useState(student.father_name || '');
  const [motherName,   setMotherName]   = useState(student.mother_name || '');

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!studentId) {
      Alert.alert('Cannot save', 'Student id is missing.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name:          name.trim(),
        phone:         phone.trim(),
        email:         email.trim(),
        date_of_birth: dob || null,
        gender:        gender || '',
        address:       address.trim(),
        father_name:   fatherName.trim(),
        mother_name:   motherName.trim(),
      };
      const { data } = await apiClient.patch(
        `/enrollments/student/${studentId}`,
        payload,
      );
      Alert.alert('Saved', 'Student details updated.', [
        {
          text: 'OK',
          onPress: () => {
            // Bubble the merged record back so the detail screen can
            // re-render without a network fetch.
            navigation.navigate({
              name: 'StudentDetail',
              params: { student: { ...student, ...(data?.student || {}) } },
              merge: true,
            });
          },
        },
      ]);
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Save failed';
      Alert.alert('Could not save', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Student</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Section title="Basic info">
            <Field label="Full name" icon={User}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Student's full name"
                placeholderTextColor={TEXT_LIGHT}
              />
            </Field>

            <Field label="Phone" icon={Phone}>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="10-digit mobile number"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </Field>

            <Field label="Email" icon={Mail}>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="email@example.com"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </Field>
          </Section>

          <Section title="Personal">
            <Field label="Date of birth" icon={Calendar}>
              <DateField
                value={dob}
                onChange={setDob}
                placeholder="Pick date of birth"
              />
            </Field>

            <Text style={styles.fieldLabel}>Gender</Text>
            <View style={styles.chipRow}>
              {GENDERS.map((g) => {
                const active = gender === g;
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setGender(g)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {g}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          <Section title="Family">
            <Field label="Father's name" icon={User}>
              <TextInput
                style={styles.input}
                value={fatherName}
                onChangeText={setFatherName}
                placeholder="Father's name"
                placeholderTextColor={TEXT_LIGHT}
              />
            </Field>

            <Field label="Mother's name" icon={User}>
              <TextInput
                style={styles.input}
                value={motherName}
                onChangeText={setMotherName}
                placeholder="Mother's name"
                placeholderTextColor={TEXT_LIGHT}
              />
            </Field>
          </Section>

          <Section title="Address">
            <Field label="Address" icon={MapPin}>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={address}
                onChangeText={setAddress}
                placeholder="Street, city, state, pincode"
                placeholderTextColor={TEXT_LIGHT}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </Field>
          </Section>

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* Footer button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save size={16} color="#fff" strokeWidth={2.4} />
                <Text style={styles.saveBtnText}>Save changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ───── helpers ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        {Icon ? <Icon size={13} color={BRAND} strokeWidth={2.4} /> : null}
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

// ───── styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BG,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },

  scroll: { padding: 16, paddingBottom: 24 },

  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 11, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  card: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },

  field: { marginBottom: 12 },
  fieldLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: TEXT_MUTED,
  },

  input: {
    backgroundColor: BG, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14, color: TEXT,
    borderWidth: 1, borderColor: BORDER,
  },
  inputMultiline: {
    minHeight: 80, paddingTop: 12,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: BG, borderWidth: 1, borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: BRAND_SOFT, borderColor: BRAND,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  chipTextActive: { color: BRAND },

  footer: {
    padding: 16, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: SURFACE,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: BRAND, paddingVertical: 14, borderRadius: 12,
  },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
