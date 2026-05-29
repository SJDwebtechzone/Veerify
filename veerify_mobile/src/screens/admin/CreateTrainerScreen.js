// src/screens/admin/CreateTrainerScreen.js
//
// Staff (trainer) enrollment form used by the institution admin.
//
// Fields (per spec):
//   - Photo upload (with circular preview)
//   - Name *
//   - Contact (phone)
//   - Email *  (login id)
//   - Temporary Password *  (trainer rotates this after first login)
//   - Gender (chip select)
//   - Date of Birth (calendar picker; derived Age is displayed)
//   - Skill (specialization)  + Belt Level  + Experience years
//   - Upload Certificate (PDF or image)
//   - Academy Name (auto-populated from the admin's institution, read-only)
//   - Govt Proof Type (chip select: Aadhaar / PAN / Driving License / Voter ID / Passport)
//   - Govt Proof Number
//   - Bio (free text)
//
// New columns live on the `trainers` table (migration 016). Photo and
// certificate uploads land on /api/uploads.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Camera, FileText, Plus, X, User, Mail, Phone, Lock,
  IdCard, Building, Award, Calendar, Briefcase, ShieldCheck,
  ExternalLink,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';

// ─── Theme tokens (kept local to avoid coupling to ../theme) ───────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

const GOVT_PROOF_TYPES = [
  'Aadhaar', 'PAN', 'Driving License', 'Voter ID', 'Passport',
];

const SKILL_SUGGESTIONS = [
  'Karate', 'Silambam', 'Taekwondo', 'Boxing', 'Muay Thai',
  'BJJ', 'Judo', 'Kung Fu', 'MMA', 'Self Defense',
];

// Compute the age (in years) from an ISO YYYY-MM-DD birthday.
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

export default function CreateTrainerScreen({ navigation }) {
  const [academyName, setAcademyName] = useState('');
  const [academyLoading, setAcademyLoading] = useState(true);

  const [form, setForm] = useState({
    // Account
    name: '',
    email: '',
    phone: '',
    password: '',
    // Personal
    gender: '',
    date_of_birth: '',
    // Profile
    specialization: '',
    belt_level: '',
    experience_years: '',
    bio: '',
    // Documents
    photo_url: '',
    photo_uri: '',         // local preview only
    certificate_url: '',
    certificate_name: '',
    // Identity
    govt_proof_type: '',
    govt_proof_number: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // Fetch admin's institution name on mount so the Academy field can show
  // it as a read-only chip.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/institutions/me/details');
        const inst = res.data?.institution || res.data;
        setAcademyName(inst?.name || inst?.brand_name || '');
      } catch (err) {
        // Falls back to empty — the server already scopes the trainer to the
        // admin's institution, so we don't strictly need this for submission.
      } finally {
        setAcademyLoading(false);
      }
    })();
  }, []);

  const age = useMemo(() => ageFromDob(form.date_of_birth), [form.date_of_birth]);

  // ── File pickers ─────────────────────────────────────────────────────
  const pickPhoto = () => {
    Alert.alert(
      'Upload Photo',
      'Choose how to upload the trainer\'s photo:',
      [
        { text: 'Gallery', onPress: () => fromGallery('photo') },
        { text: 'Camera',  onPress: () => fromCamera('photo') },
        { text: 'Cancel',  style: 'cancel' },
      ],
    );
  };

  const pickCertificate = () => {
    Alert.alert(
      'Upload Certificate',
      'Choose how to upload the certificate:',
      [
        { text: 'Gallery', onPress: () => fromGallery('cert') },
        { text: 'Camera',  onPress: () => fromCamera('cert') },
        { text: 'Cancel',  style: 'cancel' },
      ],
    );
  };

  const fromGallery = (kind) => {
    launchImageLibrary(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
      (resp) => {
        if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) {
          uploadAsset(resp.assets[0], kind);
        }
      },
    );
  };
  const fromCamera = (kind) => {
    launchCamera(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
      (resp) => {
        if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) {
          uploadAsset(resp.assets[0], kind);
        }
      },
    );
  };

  const uploadAsset = async (asset, kind) => {
    if (kind === 'photo') {
      set('photo_uri', asset.uri);
      setUploadingPhoto(true);
    } else {
      setUploadingCert(true);
    }

    try {
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || (kind === 'photo' ? 'photo.jpg' : 'certificate.jpg'),
      });
      const resp = await apiClient.post('/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (kind === 'photo') {
        set('photo_url', resp.data.url);
      } else {
        set('certificate_url', resp.data.url);
        set('certificate_name', asset.fileName || 'Certificate');
      }
    } catch (err) {
      Alert.alert('Upload failed', 'Please try again with a smaller file.');
      if (kind === 'photo') set('photo_uri', '');
    } finally {
      if (kind === 'photo') setUploadingPhoto(false);
      else setUploadingCert(false);
    }
  };

  // ── Validation ───────────────────────────────────────────────────────
  const validate = () => {
    if (!form.name?.trim()) return 'Trainer name is required';
    if (!form.email?.trim()) return 'Email is required';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
    if (!form.password) return 'Temporary password is required';
    if (form.password.length < 6) return 'Password must be at least 6 characters';
    if (form.phone && form.phone.length < 10) {
      return 'Please enter a valid phone number (or leave it blank)';
    }
    if (form.experience_years && Number(form.experience_years) < 0) {
      return 'Experience cannot be negative';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { Alert.alert('Required', err); return; }

    setSubmitting(true);
    try {
      await apiClient.post('/trainers', {
        // Account
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
        // Profile
        specialization: form.specialization.trim() || null,
        belt_level: form.belt_level.trim() || null,
        experience_years: Number(form.experience_years) || 0,
        bio: form.bio.trim() || null,
        // Personal
        gender: form.gender || null,
        date_of_birth: form.date_of_birth || null,
        // Identity
        govt_proof_type: form.govt_proof_type || null,
        govt_proof_number: form.govt_proof_number.trim() || null,
        // Documents
        photo_url: form.photo_url || null,
        certificate_url: form.certificate_url || null,
      });
      Alert.alert(
        'Trainer added',
        `${form.name.trim()} has been enrolled. Share the email + temporary password so they can sign in.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('Error', e.response?.data?.message || 'Failed to create trainer');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Initials for the photo placeholder ───────────────────────────────
  const initials = (form.name || ' ')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
    || '?';

  const certIsPdf = form.certificate_name?.toLowerCase().endsWith('.pdf');

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Enroll Staff</Text>
          <Text style={styles.headerSub}>
            Adds a trainer to {academyLoading ? '…' : (academyName || 'your academy')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Photo + Identity header card ── */}
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
              <Image
                source={{ uri: form.photo_uri || form.photo_url }}
                style={styles.photoImage}
              />
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

        {/* ── Section 1: Personal ── */}
        <SectionTitle icon={User} title="Personal Information" />

        <Field label="Full Name" required>
          <TextInput
            style={styles.input}
            placeholder="e.g. Rajesh Kumar"
            placeholderTextColor={TEXT_LIGHT}
            value={form.name}
            onChangeText={(v) => set('name', v)}
          />
        </Field>

        <Field label="Gender">
          <ChipRow
            options={GENDERS}
            value={form.gender}
            onChange={(v) => set('gender', v)}
          />
        </Field>

        <Field
          label="Date of Birth"
          hint={age != null ? `Age: ${age} years` : 'Tap to pick the birthday.'}
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

        {/* ── Section 2: Contact + Account ── */}
        <SectionTitle icon={Mail} title="Contact & Account" />

        <Field label="Contact / Phone">
          <TextInput
            style={styles.input}
            placeholder="9876543210"
            placeholderTextColor={TEXT_LIGHT}
            value={form.phone}
            onChangeText={(v) => set('phone', v.replace(/[^0-9+]/g, ''))}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </Field>

        <Field label="Email" required hint="Trainer signs in with this email.">
          <TextInput
            style={styles.input}
            placeholder="trainer@example.com"
            placeholderTextColor={TEXT_LIGHT}
            value={form.email}
            onChangeText={(v) => set('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="Temporary Password" required hint="At least 6 characters. Share securely with the trainer.">
          <TextInput
            style={styles.input}
            placeholder="••••••"
            placeholderTextColor={TEXT_LIGHT}
            value={form.password}
            onChangeText={(v) => set('password', v)}
            secureTextEntry
          />
        </Field>

        {/* ── Section 3: Academy + Skill ── */}
        <SectionTitle icon={Award} title="Skill & Academy" />

        <Field label="Academy Name" hint="Trainers are enrolled under your current academy.">
          <View style={[styles.input, styles.readonlyChip]}>
            <Building size={14} color={BRAND} strokeWidth={2.2} />
            <Text style={styles.readonlyChipText} numberOfLines={1}>
              {academyLoading ? 'Loading…' : (academyName || 'Your academy')}
            </Text>
          </View>
        </Field>

        <Field label="Skill / Specialization" hint="Type your own or tap a suggestion.">
          <TextInput
            style={styles.input}
            placeholder="e.g. Karate"
            placeholderTextColor={TEXT_LIGHT}
            value={form.specialization}
            onChangeText={(v) => set('specialization', v)}
          />
          <View style={[styles.chipRow, { marginTop: 8 }]}>
            {SKILL_SUGGESTIONS.map((s) => {
              const on = form.specialization?.toLowerCase() === s.toLowerCase();
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.suggestChip, on && styles.suggestChipOn]}
                  onPress={() => set('specialization', s)}
                  activeOpacity={0.85}
                >
                  <Plus
                    size={11}
                    color={on ? '#fff' : BRAND}
                    strokeWidth={2.6}
                    style={{ marginRight: 3 }}
                  />
                  <Text style={[styles.suggestChipText, on && styles.suggestChipTextOn]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>

        <View style={styles.row}>
          <Field label="Belt Level" style={{ flex: 1, marginRight: 8 }}>
            <TextInput
              style={styles.input}
              placeholder="e.g. Black Belt 3rd Dan"
              placeholderTextColor={TEXT_LIGHT}
              value={form.belt_level}
              onChangeText={(v) => set('belt_level', v)}
            />
          </Field>
          <Field label="Experience (years)" style={{ flex: 1, marginLeft: 8 }}>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={TEXT_LIGHT}
              value={form.experience_years}
              onChangeText={(v) => set('experience_years', v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              maxLength={2}
            />
          </Field>
        </View>

        <Field label="Certificate" hint="Upload a PDF or image of an achievement / training certificate.">
          <TouchableOpacity
            style={[styles.upload, form.certificate_url && styles.uploadDone]}
            onPress={pickCertificate}
            disabled={uploadingCert}
            activeOpacity={0.85}
          >
            {uploadingCert ? (
              <ActivityIndicator color={BRAND} />
            ) : form.certificate_url ? (
              <>
                <FileText size={26} color="#10B981" strokeWidth={2} />
                <Text style={styles.uploadDoneText}>
                  {form.certificate_name || 'Certificate'} uploaded
                </Text>
                <Text style={styles.uploadChangeText}>Tap to replace</Text>
              </>
            ) : (
              <>
                <FileText size={26} color={BRAND} strokeWidth={2} />
                <Text style={styles.uploadText}>Upload Certificate</Text>
                <Text style={styles.uploadHint}>PDF, JPG or PNG · Up to 10MB</Text>
              </>
            )}
          </TouchableOpacity>
        </Field>

        {/* ── Section 4: Identity ── */}
        <SectionTitle icon={ShieldCheck} title="Identity Verification" />

        <Field label="Govt Proof Type">
          <ChipRow
            options={GOVT_PROOF_TYPES}
            value={form.govt_proof_type}
            onChange={(v) => set('govt_proof_type', v)}
          />
        </Field>

        <Field
          label="Govt Proof Number"
          hint="We mask sensitive numbers in the trainer profile."
        >
          <TextInput
            style={styles.input}
            placeholder="e.g. XXXX-XXXX-1234"
            placeholderTextColor={TEXT_LIGHT}
            value={form.govt_proof_number}
            onChangeText={(v) => set('govt_proof_number', v)}
            autoCapitalize="characters"
          />
        </Field>

        {/* ── Section 5: Bio ── */}
        <SectionTitle icon={Briefcase} title="About the Trainer" />

        <Field label="Bio">
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Brief background, teaching style, achievements…"
            placeholderTextColor={TEXT_LIGHT}
            value={form.bio}
            onChangeText={(v) => set('bio', v)}
            multiline
            textAlignVertical="top"
          />
        </Field>

        <View style={{ height: 12 }} />
      </ScrollView>

      {/* Sticky submit bar */}
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
            <Text style={styles.btnPrimaryText}>Enroll Trainer</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Reusable bits ─────────────────────────────────────────────────────
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

  // Photo card at top
  photoCard: { alignItems: 'center', marginBottom: 16 },
  photoWrap: { position: 'relative' },
  photoPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoInitials: { fontSize: 28, fontWeight: '800', color: BRAND },
  photoImage: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: SURFACE,
  },
  photoBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoHint: { fontSize: 11, color: TEXT_MUTED, marginTop: 8, fontWeight: '600' },

  // Section title
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

  // Field
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

  // Read-only chip (Academy field)
  readonlyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: BRAND_SOFT,
    borderColor: BRAND_SOFT,
  },
  readonlyChipText: { flex: 1, fontSize: 13, fontWeight: '800', color: BRAND },

  // Chips
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

  // Suggestion pills
  suggestChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: BRAND_SOFT,
    borderRadius: 999,
    borderWidth: 1, borderColor: BRAND_SOFT,
  },
  suggestChipOn: { backgroundColor: BRAND, borderColor: BRAND },
  suggestChipText: { fontSize: 11, color: BRAND, fontWeight: '700' },
  suggestChipTextOn: { color: '#fff', fontWeight: '800' },

  // Upload
  upload: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: BORDER,
    padding: 18, alignItems: 'center', gap: 4,
  },
  uploadDone: { borderColor: '#10B981', borderStyle: 'solid' },
  uploadText: { fontSize: 14, fontWeight: '700', color: TEXT, marginTop: 6 },
  uploadHint: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  uploadDoneText: { fontSize: 13, fontWeight: '700', color: '#059669', marginTop: 6 },
  uploadChangeText: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },

  // Footer
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
