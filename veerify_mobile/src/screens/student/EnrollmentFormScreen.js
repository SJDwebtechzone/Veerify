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

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Prefer not to say'];

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
  const { batch, course } = route?.params || {};
  const batchId = batch?.id;
  const coursePrice = batch?.course_price || course?.price || 0;

  const [form, setForm] = useState({
    full_name: '',
    date_of_birth: '',
    father_name: '',
    mother_name: '',
    contact_number: '',
    email: '',
    address: '',
    marital_status: '',
    occupation: '',
    height_cm: '',
    weight_kg: '',
    disabilities: '',
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
          setForm((prev) => ({
            ...prev,
            full_name:      p.full_name || '',
            date_of_birth:  p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : '',
            father_name:    p.father_name || '',
            mother_name:    p.mother_name || '',
            contact_number: p.contact_number || '',
            email:          p.email || '',
            address:        p.address || '',
            marital_status: p.marital_status || '',
            occupation:     p.occupation || '',
            height_cm:      p.height_cm ? String(p.height_cm) : '',
            weight_kg:      p.weight_kg ? String(p.weight_kg) : '',
            disabilities:   p.disabilities || '',
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
      const resp = await apiClient.post('/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      set('photo_url', resp.data.url);
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
    if (form.contact_number && form.contact_number.length < 10) {
      return 'Please enter a valid contact number';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { Alert.alert('Required', err); return; }
    if (!batchId) { Alert.alert('Missing', 'No batch selected'); return; }

    setSubmitting(true);
    try {
      const res = await apiClient.post('/enrollments', {
        batch_id: batchId,
        full_name:      form.full_name.trim(),
        date_of_birth:  form.date_of_birth || null,
        father_name:    form.father_name.trim() || null,
        mother_name:    form.mother_name.trim() || null,
        contact_number: form.contact_number.trim() || null,
        email:          form.email.trim() || null,
        address:        form.address.trim() || null,
        marital_status: form.marital_status || null,
        occupation:     form.occupation.trim() || null,
        height_cm:      form.height_cm ? Number(form.height_cm) : null,
        weight_kg:      form.weight_kg ? Number(form.weight_kg) : null,
        disabilities:   form.disabilities.trim() || null,
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
        <Field label="Email">
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

        {/* Life */}
        <SectionTitle icon={Briefcase} title="Other Details" />
        <Field label="Marital Status">
          <ChipRow
            options={MARITAL_STATUSES}
            value={form.marital_status}
            onChange={(v) => set('marital_status', v)}
          />
        </Field>
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

        <Field label="Disabilities" hint="Mention anything the trainer should know. Leave blank if none.">
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="e.g. None / Knee injury / Asthma"
            placeholderTextColor={TEXT_LIGHT}
            value={form.disabilities}
            onChangeText={(v) => set('disabilities', v)}
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
