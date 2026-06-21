// src/screens/student/EnrollmentFormScreen.js
//
// Student fills this out when they tap "Enroll Now" on a batch. Captures
// the 14-field profile spec:
//   Name, Age (derived), DOB, Father/Guardian, Mother, Contact, Address,
//   Marital Status, Occupation, Height, Weight, Disabilities, Email, Photo
//
// On submit:
//   POST /api/enrollments  { batch_id, ...profile_fields }
//   navigation.replace('EnrollmentPayment', { enrollmentId, batch, course })
//
// On second + subsequent enrollments we pre-fill the form from
// GET /api/enrollments/my-profile so the student doesn't re-type everything.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Camera, User, Calendar, Users, Phone, Mail, MapPin,
  Briefcase, Heart, ChevronRight,
} from 'lucide-react-native';
// Older lucide versions don't have Ruler/Weight/Accessibility - they were
// only imported, never rendered, but removing them removes the failure
// mode entirely.
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

// Blood-group options for the dropdown picker. Standard eight ABO/Rh
// combinations.
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Current belt rank for an incoming student. "New student" is the default
// (no prior martial-arts training). "Other" reveals a free-text input
// for academies that use non-standard belt names.
const BELT_OPTIONS = [
  'New student',
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue I',
  'Blue II',
  'Gray',
  'Brown I',
  'Brown II',
  'Brown III',
  'Black',
  'Other',
];

function ageFromDob(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  const m0 = today.getMonth() + 1;
  const d0 = today.getDate();
  if (m0 < m || (m0 === m && d0 < d)) age -= 1;
  return age >= 0 ? age : null;
}

export default function EnrollmentFormScreen({ route, navigation }) {
  const { batch, course, adminMode, batchId: paramBatchId } = route?.params || {};

  // Admin-initiated path (from the Add Student quick action) doesn't
  // pre-bind to a batch — we let the admin pick one inside the form
  // with a small inline dropdown.
  const [pickedBatch, setPickedBatch] = useState(batch || null);
  const [adminBatches, setAdminBatches] = useState([]);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);

  const batchId = pickedBatch?.id || paramBatchId || batch?.id;
  const coursePrice = pickedBatch?.course_price || batch?.course_price || course?.price || 0;

  // When opened from admin "Add Student", fetch the institution's batches
  // so we can populate the inline picker.
  useEffect(() => {
    if (!adminMode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/batches');
        if (!cancelled) setAdminBatches(res?.data?.batches || []);
      } catch (err) {
        console.warn('[EnrollmentForm] failed to load batches for admin picker:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [adminMode]);

  const [form, setForm] = useState({
    full_name: '',
    date_of_birth: '',
    father_name: '',
    mother_name: '',
    contact_number: '',
    email: '',
    address: '',
    // marital_status removed per spec.
    occupation: '',
    height_cm: '',
    weight_kg: '',
    // blood_group — picked from the 8 standard ABO/Rh values.
    blood_group: '',
    // health_notes replaces the older 'disabilities' field. Covers
    // allergies, asthma, mobility considerations, dietary restrictions,
    // anything the trainer should know.
    health_notes: '',
    // belt_category — defaults to "New student" so brand-new joiners
    // don't have to pick anything. "Other" reveals belt_category_other.
    belt_category: 'New student',
    belt_category_other: '',
    photo_url: '',
    photo_uri: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Pre-fill from existing profile (subsequent enrollments)
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/enrollments/my-profile');
        const p = res.data?.profile;
        if (p) {
          // Round-trip the new field names. We also still read the
          // legacy `disabilities` column so old profiles seed health_notes
          // cleanly, and resolve a free-text belt back into the dropdown.
          const savedBelt = p.belt_category || '';
          const isStandardBelt = BELT_OPTIONS.includes(savedBelt);
          setForm((prev) => ({
            ...prev,
            full_name:      p.full_name || '',
            date_of_birth:  p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : '',
            father_name:    p.father_name || '',
            mother_name:    p.mother_name || '',
            contact_number: p.contact_number || '',
            email:          p.email || '',
            address:        p.address || '',
            occupation:     p.occupation || '',
            height_cm:      p.height_cm ? String(p.height_cm) : '',
            weight_kg:      p.weight_kg ? String(p.weight_kg) : '',
            blood_group:    p.blood_group || '',
            health_notes:   p.health_notes || p.disabilities || '',
            belt_category:  savedBelt
              ? (isStandardBelt ? savedBelt : 'Other')
              : 'New student',
            belt_category_other: savedBelt && !isStandardBelt ? savedBelt : '',
            photo_url:      p.photo_url || '',
          }));
        }
      } catch (err) {
        // First-time enroller; leave the form blank.
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  const age = useMemo(() => ageFromDob(form.date_of_birth), [form.date_of_birth]);

  // ── Photo upload ───────────────────────────────────────────────────
  const pickPhoto = () => {
    Alert.alert('Upload Photo', 'Choose how to upload your photo:', [
      { text: 'Gallery', onPress: () => fromGallery() },
      { text: 'Camera',  onPress: () => fromCamera() },
      { text: 'Cancel',  style: 'cancel' },
    ]);
  };
  const fromGallery = () => {
    launchImageLibrary(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
      (resp) => {
        if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) uploadAsset(resp.assets[0]);
      },
    );
  };
  const fromCamera = () => {
    launchCamera(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
      (resp) => {
        if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) uploadAsset(resp.assets[0]);
      },
    );
  };
  const uploadAsset = async (asset) => {
    setUploadingPhoto(true);
    set('photo_uri', asset.uri);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'photo.jpg',
      });
      // Pass the student's full name as the upload hint so the saved
      // filename reads as "priya-r-student-1738485293-xy12.jpg" on disk
      // — much easier to identify than the gallery's temp name.
      const hintName = (form.full_name || 'student').trim();
      const hint = encodeURIComponent(`${hintName}-student`);
      const resp = await apiClient.post(`/uploads?name_hint=${hint}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Store the RELATIVE /uploads/... path; the absolute `url` bakes
      // in 10.0.2.2:5000 from the Android emulator and is unreachable
      // from any browser or other device.
      set('photo_url', resp.data.path || resp.data.url);
    } catch (err) {
      Alert.alert('Upload failed', 'Please try a smaller image.');
      set('photo_uri', '');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── Validation ─────────────────────────────────────────────────────
  const validate = () => {
    if (!form.full_name?.trim()) return 'Full Name is required';
    if (form.email && !/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
    // In admin mode the email is the student's login id, so it can't
    // be skipped — we'd have nowhere to email the credentials.
    if (adminMode && !form.email?.trim()) {
      return 'Email is required so we can email the student their login.';
    }
    if (form.contact_number && form.contact_number.length < 10) {
      return 'Please enter a valid contact number';
    }
    if (form.belt_category === 'Other' && !form.belt_category_other.trim()) {
      return 'Please specify the belt level';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { Alert.alert('Required', err); return; }
    if (!batchId) { Alert.alert('Missing', 'No batch selected'); return; }

    setSubmitting(true);
    try {
      // Resolve the belt category: when "Other" is picked we send the
      // custom string. New student / standard belts go through as-is.
      const beltVal = form.belt_category === 'Other'
        ? (form.belt_category_other || '').trim() || 'Other'
        : (form.belt_category || 'New student');

      const res = await apiClient.post('/enrollments', {
        batch_id: batchId,
        // Tell the backend this is an admin-driven enrolment. When set,
        // the server creates a brand-new student user (or reuses the
        // existing email's account), emails the login credentials, then
        // links the enrolment to that user instead of the admin's id.
        admin_mode: !!adminMode,
        full_name:      form.full_name.trim(),
        date_of_birth:  form.date_of_birth || null,
        father_name:    form.father_name.trim() || null,
        mother_name:    form.mother_name.trim() || null,
        contact_number: form.contact_number.trim() || null,
        email:          form.email.trim() || null,
        address:        form.address.trim() || null,
        // marital_status removed from the form per spec.
        occupation:     form.occupation.trim() || null,
        height_cm:      form.height_cm ? Number(form.height_cm) : null,
        weight_kg:      form.weight_kg ? Number(form.weight_kg) : null,
        blood_group:    form.blood_group || null,
        health_notes:   form.health_notes.trim() || null,
        // Send the legacy `disabilities` key too so any old read path
        // keeps working until we migrate the column.
        disabilities:   form.health_notes.trim() || null,
        belt_category:  beltVal,
        photo_url:      form.photo_url || null,
      });
      const enrollment = res.data?.enrollment;
      navigation.replace('EnrollmentPayment', {
        enrollment, batch, course, amount: coursePrice,
      });
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (form.full_name || ' ').split(' ')
    .map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Enrollment Details</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {course?.name || batch?.course_name || 'Course'} · ₹{Number(coursePrice).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loadingProfile ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={BRAND} />
          </View>
        ) : null}

        {/* Admin-only: inline Batch picker. Only renders when the form
            was opened from the institution admin's "Add Student" quick
            action (adminMode=true) — students still get a pre-bound
            batch from the CourseDetail "Enroll Now" flow. */}
        {adminMode ? (
          <View style={styles.adminBatchCard}>
            <Text style={styles.adminBatchLabel}>Select Batch</Text>
            <TouchableOpacity
              style={styles.adminBatchTrigger}
              onPress={() => setBatchPickerOpen((o) => !o)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.adminBatchTriggerText,
                  !pickedBatch && { color: TEXT_LIGHT, fontWeight: '500' },
                ]}
                numberOfLines={1}
              >
                {pickedBatch
                  ? `${pickedBatch.name}${pickedBatch.course_name ? ` · ${pickedBatch.course_name}` : ''}`
                  : 'Choose the batch this student is joining'}
              </Text>
              <ChevronRight
                size={14}
                color={TEXT_MUTED}
                strokeWidth={2.2}
                style={{ transform: [{ rotate: batchPickerOpen ? '90deg' : '0deg' }] }}
              />
            </TouchableOpacity>

            {batchPickerOpen ? (
              <View style={styles.adminBatchMenu}>
                {adminBatches.length === 0 ? (
                  <Text style={styles.adminBatchEmpty}>
                    No batches yet — create a batch first, then come back here.
                  </Text>
                ) : (
                  adminBatches.map((b) => {
                    const isSel = pickedBatch?.id === b.id;
                    return (
                      <TouchableOpacity
                        key={b.id}
                        style={[styles.adminBatchItem, isSel && styles.adminBatchItemSelected]}
                        onPress={() => {
                          setPickedBatch(b);
                          setBatchPickerOpen(false);
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.adminBatchItemTitle}>{b.name || `Batch #${b.id}`}</Text>
                        {b.course_name ? (
                          <Text style={styles.adminBatchItemSub}>{b.course_name}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Photo */}
        <View style={styles.photoCard}>
          <TouchableOpacity
            style={styles.photoWrap}
            onPress={pickPhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.85}
          >
            {uploadingPhoto ? (
              <View style={styles.photoPlaceholder}>
                <ActivityIndicator color={BRAND} />
              </View>
            ) : form.photo_uri || form.photo_url ? (
              <Image source={{ uri: form.photo_uri || form.photo_url }} style={styles.photoImage} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.photoBadge}>
              <Camera size={12} color="#fff" strokeWidth={2.6} />
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to upload photo</Text>
        </View>

        {/* Identity */}
        <SectionTitle icon={User} title="Personal Information" />
        <Field label="Full Name" required>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mohan Kumar"
            placeholderTextColor={TEXT_LIGHT}
            value={form.full_name}
            onChangeText={(v) => set('full_name', v)}
          />
        </Field>

        <Field
          label="Date of Birth"
          hint={age != null ? `Age: ${age} years` : 'Tap to pick the date.'}
        >
          <DateField
            value={form.date_of_birth}
            onChange={(v) => set('date_of_birth', v)}
            maxYear={new Date().getFullYear()}
            minYear={1900}
            placeholder="Pick date of birth"
            accent={BRAND}
          />
        </Field>

        {/* Family */}
        <SectionTitle icon={Users} title="Family" />
        <Field label="Father / Guardian Name">
          <TextInput
            style={styles.input}
            placeholder="e.g. Suresh Kumar"
            placeholderTextColor={TEXT_LIGHT}
            value={form.father_name}
            onChangeText={(v) => set('father_name', v)}
          />
        </Field>
        <Field label="Mother Name">
          <TextInput
            style={styles.input}
            placeholder="e.g. Lakshmi Kumar"
            placeholderTextColor={TEXT_LIGHT}
            value={form.mother_name}
            onChangeText={(v) => set('mother_name', v)}
          />
        </Field>

        {/* Contact */}
        <SectionTitle icon={Phone} title="Contact" />
        <Field label="Contact Number">
          <TextInput
            style={styles.input}
            placeholder="9876543210"
            placeholderTextColor={TEXT_LIGHT}
            value={form.contact_number}
            onChangeText={(v) => set('contact_number', v.replace(/[^0-9+]/g, ''))}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </Field>
        <Field label={adminMode ? 'Email *' : 'Email'}>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={TEXT_LIGHT}
            value={form.email}
            onChangeText={(v) => set('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {adminMode ? (
            <Text style={{
              fontSize: 11, color: '#6B7280', marginTop: 6, fontWeight: '600',
              fontStyle: 'italic',
            }}>
              We'll create a student login at this email and send the password.
            </Text>
          ) : null}
        </Field>
        <Field label="Address">
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Street, area, city, pincode..."
            placeholderTextColor={TEXT_LIGHT}
            value={form.address}
            onChangeText={(v) => set('address', v)}
            multiline
            textAlignVertical="top"
          />
        </Field>

        {/* Life — marital status removed; occupation, vitals,
            blood group, belt level, health notes. */}
        <SectionTitle icon={Briefcase} title="Other Details" />
        <Field label="Occupation">
          <TextInput
            style={styles.input}
            placeholder="e.g. Software Engineer / Student"
            placeholderTextColor={TEXT_LIGHT}
            value={form.occupation}
            onChangeText={(v) => set('occupation', v)}
          />
        </Field>

        <View style={styles.row}>
          <Field label="Height (cm)" style={{ flex: 1, marginRight: 8 }}>
            <TextInput
              style={styles.input}
              placeholder="170"
              placeholderTextColor={TEXT_LIGHT}
              value={form.height_cm}
              onChangeText={(v) => set('height_cm', v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              maxLength={3}
            />
          </Field>
          <Field label="Weight (kg)" style={{ flex: 1, marginLeft: 8 }}>
            <TextInput
              style={styles.input}
              placeholder="65"
              placeholderTextColor={TEXT_LIGHT}
              value={form.weight_kg}
              onChangeText={(v) => set('weight_kg', v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              maxLength={3}
            />
          </Field>
        </View>

        {/* Blood group — chip row with the 8 ABO/Rh options. */}
        <Field label="Blood Group">
          <ChipRow
            options={BLOOD_GROUPS}
            value={form.blood_group}
            onChange={(v) => set('blood_group', v)}
          />
        </Field>

        {/* Current belt category — wraps onto multiple lines because
            there are 13 options. "Other" reveals the free-text field. */}
        <Field label="Current Belt Category" hint="Default is 'New student'. Pick the right rank if the student has prior training.">
          <ChipRow
            options={BELT_OPTIONS}
            value={form.belt_category}
            onChange={(v) => set('belt_category', v)}
          />
        </Field>
        {form.belt_category === 'Other' ? (
          <Field label="Specify belt level" hint="Required when Other is selected.">
            <TextInput
              style={styles.input}
              placeholder="e.g. Red I, Senior Black, Provisional…"
              placeholderTextColor={TEXT_LIGHT}
              value={form.belt_category_other}
              onChangeText={(v) => set('belt_category_other', v)}
              maxLength={60}
            />
          </Field>
        ) : null}

        <Field label="Health Notes" hint="Allergies, asthma, injuries, dietary needs — anything the trainer should know. Leave blank if none.">
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="e.g. None / Knee injury / Asthma / Peanut allergy"
            placeholderTextColor={TEXT_LIGHT}
            value={form.health_notes}
            onChangeText={(v) => set('health_notes', v)}
            multiline
            textAlignVertical="top"
          />
        </Field>

        <View style={{ height: 16 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => navigation.goBack()}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>Continue to Pay</Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Reusable bits ────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionIcon}>
        <Icon size={14} color={BRAND} strokeWidth={2.4} />
      </View>
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}
function Field({ label, hint, required, children, style }) {
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      <Text style={styles.label}>
        {label}{required ? <Text style={{ color: BRAND }}> *</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}
function ChipRow({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const on = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(opt)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  body: { padding: 16, paddingBottom: 32 },

  photoCard: { alignItems: 'center', marginBottom: 16 },

  // ── Admin-mode batch picker (only rendered when adminMode=true) ──
  adminBatchCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 14,
  },
  adminBatchLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  adminBatchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  adminBatchTriggerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  adminBatchMenu: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  adminBatchEmpty: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontStyle: 'italic',
    padding: 14,
    textAlign: 'center',
  },
  adminBatchItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  adminBatchItemSelected: {
    backgroundColor: BRAND_SOFT,
  },
  adminBatchItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
  },
  adminBatchItemSub: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: '600',
    marginTop: 2,
  },
  photoWrap: { position: 'relative' },
  photoPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoInitials: { fontSize: 28, fontWeight: '800', color: BRAND },
  photoImage: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: SURFACE },
  photoBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoHint: { fontSize: 11, color: TEXT_MUTED, marginTop: 8, fontWeight: '600' },

  sectionTitle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 6, marginBottom: 10,
  },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitleText: { fontSize: 14, fontWeight: '800', color: TEXT, letterSpacing: 0.3 },

  label: { fontSize: 12, fontWeight: '700', color: TEXT, marginBottom: 6, letterSpacing: 0.3 },
  hint: { fontSize: 11, color: TEXT_MUTED, marginTop: 4, lineHeight: 16 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 78, paddingTop: 11 },
  row: { flexDirection: 'row' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: SURFACE,
    borderRadius: 999,
    borderWidth: 1, borderColor: BORDER,
  },
  chipOn: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  chipTextOn: { color: '#fff', fontWeight: '700' },

  footer: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  btn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
  },
  btnGhost: { backgroundColor: BG },
  btnGhostText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },
  btnPrimary: { backgroundColor: BRAND, flex: 1.6 },
  btnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
