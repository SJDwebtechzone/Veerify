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
  Image,
} from 'react-native';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Calendar, Save,
  Camera, X as XIcon,
  ChevronDown, Check, Droplet, Award,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import resolveAssetUrl from '../../utils/assetUrl';
import { confirm } from '../../components/ConfirmDialog';

const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

// ABO/Rh options — same list the Student Enrollment Form uses so a
// value picked here round-trips cleanly with what the student entered.
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Current belt options — same curated list as the Student Enrollment
// Form. Picking "Other" reveals a free-text input for academies that
// use non-standard belt names (dan grades, stripes, "Assistant
// Instructor", etc.).
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
  // Extended profile fields — one-to-one match with the Student
  // Enrollment Form so every value the student entered on the way in
  // is editable here. Each field maps to a student_profiles column
  // (see migration 066 for blood_group + belt_category).
  const [occupation,   setOccupation]   = useState(student.occupation || '');
  const [heightCm,     setHeightCm]     = useState(
    student.height_cm != null && student.height_cm !== '' ? String(student.height_cm) : '',
  );
  const [weightKg,     setWeightKg]     = useState(
    student.weight_kg != null && student.weight_kg !== '' ? String(student.weight_kg) : '',
  );
  const [healthNotes,  setHealthNotes]  = useState(student.disabilities || student.health_notes || '');
  const [bloodGroup,   setBloodGroup]   = useState(student.blood_group || '');
  // Current belt — offers a curated list plus "Other" for custom
  // labels. Seed from the stored value; if it isn't in the standard
  // list we start with "Other" selected and pre-fill the free-text
  // input with the stored label so the admin sees exactly what's on
  // record.
  const initialBelt = student.belt_category || '';
  const isStandardBelt = BELT_OPTIONS.includes(initialBelt);
  const [beltCategory,      setBeltCategory]      = useState(
    initialBelt ? (isStandardBelt ? initialBelt : 'Other') : 'New student',
  );
  const [beltCategoryOther, setBeltCategoryOther] = useState(
    initialBelt && !isStandardBelt ? initialBelt : '',
  );

  // ── Photo state ─────────────────────────────────────────────────────
  // photoUrl:  server path (e.g. "/uploads/xyz.jpg") that gets persisted.
  //            null    → admin removed it; the backend clears the column.
  //            ''      → no change requested; backend leaves it as-is.
  // photoUri:  local preview URI from the picker BEFORE upload finishes.
  // photoDirty: true whenever the admin touched the photo (upload OR remove).
  const initialPhoto = student.photo_url || student.student_photo_url || '';
  const [photoUrl,   setPhotoUrl]  = useState(initialPhoto);
  const [photoUri,   setPhotoUri]  = useState('');
  const [photoDirty, setPhotoDirty] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [saving, setSaving] = useState(false);

  // Preview: local pick > uploaded server path > empty (initials fallback).
  const previewUri = photoUri || (photoUrl ? resolveAssetUrl(photoUrl) : '');

  // ── Photo picker + upload ───────────────────────────────────────────
  // Branded confirm dialog with a three-button layout: primary Gallery,
  // secondary Camera (destructive slot repurposed since it's just a
  // second choice, not a destructive action), and Cancel. Better UX
  // than the OS Alert.alert which paints pale system-accent buttons
  // and doesn't match the rest of the app.
  const pickPhoto = () => {
    confirm({
      title:           'Update photo',
      message:         "Choose how to upload the student's photo.",
      variant:         'info',
      confirmText:     'Gallery',
      destructiveText: 'Camera',
      cancelText:      'Cancel',
      onConfirm:       () => fromGallery(),
      onDestructive:   () => fromCamera(),
    });
  };
  const fromGallery = () => launchImageLibrary(
    { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
    (resp) => {
      if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) uploadAsset(resp.assets[0]);
    },
  );
  const fromCamera = () => launchCamera(
    { mediaType: 'photo', quality: 0.85, maxWidth: 1200, maxHeight: 1200 },
    (resp) => {
      if (!resp.didCancel && !resp.errorCode && resp.assets?.[0]) uploadAsset(resp.assets[0]);
    },
  );
  const uploadAsset = async (asset) => {
    setUploadingPhoto(true);
    setPhotoUri(asset.uri);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri:  asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'photo.jpg',
      });
      // Use the student's name as the on-disk filename hint so uploads
      // stay identifiable ("priya-r-student-1738485293-xy12.jpg").
      const hintName = (name || 'student').trim();
      const hint = encodeURIComponent(`${hintName}-student`);
      const resp = await apiClient.post(`/uploads?name_hint=${hint}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const stored = resp.data?.path || resp.data?.url || '';
      setPhotoUrl(stored);
      setPhotoDirty(true);
    } catch (err) {
      confirm({
        title:       'Upload failed',
        message:     'That image is too large to upload. Please try a smaller one.',
        variant:     'destructive',
        confirmText: 'OK',
        hideCancel:  true,
      });
      setPhotoUri('');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Remove — clears the local preview + the server-side column on save.
  const removePhoto = () => {
    confirm({
      title:       'Remove photo?',
      message:     `${name || 'This student'}'s profile photo will be removed. You can upload a new one anytime.`,
      variant:     'destructive',
      confirmText: 'Remove',
      cancelText:  'Cancel',
      onConfirm:   () => {
        setPhotoUri('');
        setPhotoUrl('');
        setPhotoDirty(true);
      },
    });
  };

  const handleSave = async () => {
    if (!studentId) {
      confirm({
        title:       'Cannot save',
        message:     'Student id is missing. Please close this screen and try editing again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    if (!name.trim()) {
      confirm({
        title:       'Name is required',
        message:     'Enter the student\'s full name before saving.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    setSaving(true);
    try {
      // Resolve belt: if the admin picked "Other" we send the
      // free-text label they typed; otherwise the picker value.
      const beltVal = beltCategory === 'Other'
        ? (beltCategoryOther.trim() || 'Other')
        : (beltCategory || 'New student');

      // Full-form payload — exact parity with the Student Enrollment
      // Form. The backend's COALESCE(NULLIF(...)) logic treats an
      // empty string as "don't change", so sending every field on
      // every save is safe. Editing NEVER touches the enrollment row's
      // batch, payment_status, payment_amount, paid_at, or
      // payment_reference — those live on a separate table and this
      // endpoint doesn't join to them.
      const payload = {
        name:          name.trim(),
        phone:         phone.trim(),
        email:         email.trim(),
        date_of_birth: dob || null,
        gender:        gender || '',
        address:       address.trim(),
        father_name:   fatherName.trim(),
        mother_name:   motherName.trim(),
        occupation:    occupation.trim(),
        height_cm:     heightCm.trim(),
        weight_kg:     weightKg.trim(),
        disabilities:  healthNotes.trim(),
        blood_group:   bloodGroup || '',
        belt_category: beltVal,
      };
      // Only include photo_url when the admin actually touched the
      // photo. Sending it always would send stale server-URL back on
      // every save, which is wasteful. When they removed the photo,
      // send explicit null so the backend clears the column (per the
      // CASE WHEN $9 THEN … contract in updateStudentByAdmin).
      if (photoDirty) {
        payload.photo_url = photoUrl && photoUrl.trim() ? photoUrl.trim() : null;
      }
      const { data } = await apiClient.patch(
        `/enrollments/student/${studentId}`,
        payload,
      );
      // Branded success card — matches the rest of the app instead
      // of the OS-style Alert.alert. On OK we bubble the merged
      // record back to the detail screen so its listeners re-render
      // with the fresh values without an extra network round trip.
      confirm({
        title:       'Student details updated',
        message:     `${(name || 'The student').split(' ')[0]}'s profile has been saved.`,
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm: () => {
          try {
            navigation.navigate({
              name: 'StudentDetail',
              params: { student: { ...student, ...(data?.student || {}) } },
              merge: true,
            });
          } catch (_) {
            try { navigation.goBack(); } catch (__) {}
          }
        },
      });
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Save failed';
      confirm({
        title:       'Could not save',
        message:     msg,
        variant:     'destructive',
        confirmText: 'OK',
        hideCancel:  true,
      });
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
          {/* ── Photo section ─────────────────────────────────────────
              Preview shows the current server photo (or the just-picked
              local URI while an upload is in flight). Camera badge in
              the bottom-right lets the admin re-upload; the small red
              × in the top-right clears the photo. If nothing's set we
              render the student's initials on a soft-brand background. */}
          <Section title="Photo">
            <View style={styles.photoBlock}>
              <TouchableOpacity
                style={styles.photoWrap}
                onPress={pickPhoto}
                disabled={uploadingPhoto}
                activeOpacity={0.85}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color={BRAND} />
                ) : previewUri ? (
                  <Image source={{ uri: previewUri }} style={styles.photoImg} resizeMode="cover" />
                ) : (
                  <Text style={styles.photoInitials}>
                    {(name || '?')
                      .split(' ')
                      .map((w) => w[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </Text>
                )}
                <View style={styles.photoBadge}>
                  <Camera size={12} color="#fff" strokeWidth={2.6} />
                </View>
                {previewUri && !uploadingPhoto ? (
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={removePhoto}
                    hitSlop={8}
                  >
                    <XIcon size={12} color="#fff" strokeWidth={2.8} />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.photoHelpTitle}>
                  {previewUri ? 'Tap the photo to replace' : 'Tap to upload a photo'}
                </Text>
                <Text style={styles.photoHelpSub}>
                  JPG or PNG, up to a few MB. The photo shows on the student's
                  profile, cards, and roster.
                </Text>
              </View>
            </View>
          </Section>

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

          {/* ── Personal & Health ──────────────────────────────────────
              Exact-parity with the Student Enrollment Form: occupation,
              height, weight, blood group, health notes, current belt.
              No marital status / alternate contact / emergency
              contact — those aren't on the enrollment form and would
              introduce edit-only fields that never round-trip. */}
          <Section title="Personal details">
            <Field label="Occupation" icon={User}>
              <TextInput
                style={styles.input}
                value={occupation}
                onChangeText={setOccupation}
                placeholder="e.g. Student / Software Engineer"
                placeholderTextColor={TEXT_LIGHT}
              />
            </Field>

            <Field label="Height (cm)" icon={User}>
              <TextInput
                style={styles.input}
                value={heightCm}
                onChangeText={(v) => setHeightCm(v.replace(/[^0-9]/g, ''))}
                placeholder="e.g. 168"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="number-pad"
                maxLength={3}
              />
            </Field>

            <Field label="Weight (kg)" icon={User}>
              <TextInput
                style={styles.input}
                value={weightKg}
                onChangeText={(v) => setWeightKg(v.replace(/[^0-9]/g, ''))}
                placeholder="e.g. 60"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="number-pad"
                maxLength={3}
              />
            </Field>

            <Field label="Blood group" icon={Droplet}>
              <Dropdown
                options={BLOOD_GROUPS}
                value={bloodGroup}
                onChange={setBloodGroup}
                placeholder="Select blood group"
                icon={Droplet}
              />
            </Field>

            <Field label="Health notes" icon={User}>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={healthNotes}
                onChangeText={setHealthNotes}
                placeholder="Allergies, asthma, dietary restrictions, or anything the trainer should know"
                placeholderTextColor={TEXT_LIGHT}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </Field>
          </Section>

          {/* ── Belt ───────────────────────────────────────────────────
              Current belt category. Inline dropdown with the curated
              list; picking "Other" reveals a free-text input for
              academies that use non-standard belt names. Same UX as
              the enrollment form. */}
          <Section title="Current belt">
            <Field label="Belt category" icon={Award}>
              <Dropdown
                options={BELT_OPTIONS}
                value={beltCategory}
                onChange={setBeltCategory}
                placeholder="Select belt level"
                icon={Award}
              />
            </Field>

            {beltCategory === 'Other' ? (
              <Field label="Specify belt level" icon={Award}>
                <TextInput
                  style={styles.input}
                  value={beltCategoryOther}
                  onChangeText={setBeltCategoryOther}
                  placeholder="e.g. Red I, Senior Black, Provisional…"
                  placeholderTextColor={TEXT_LIGHT}
                  maxLength={80}
                />
              </Field>
            ) : null}
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

// ───── Inline expanding dropdown ──────────────────────────────────────────
// Renders as a chevron-tipped pill that expands the option list right
// underneath. Chosen instead of a chip row so a 13-option list doesn't
// wrap across four lines. Same UX + styling as the Dropdown component
// on the Student Enrollment Form so the two screens read the same.
function Dropdown({
  options, value, onChange,
  placeholder = 'Select…',
  icon: LeadingIcon = null,
  maxPanelHeight = 260,
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity
        style={[styles.dropdownTrigger, open && styles.dropdownTriggerOpen]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        {LeadingIcon ? (
          <LeadingIcon size={14} color={BRAND} strokeWidth={2.4} />
        ) : null}
        <Text style={[styles.dropdownText, !value && styles.dropdownPlaceholder]}>
          {value || placeholder}
        </Text>
        <ChevronDown
          size={16}
          color={TEXT_MUTED}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={[styles.dropdownPanel, { maxHeight: maxPanelHeight }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {options.map((opt) => {
              const selected = opt === value;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.dropdownItem, selected && styles.dropdownItemActive]}
                  onPress={() => { onChange(opt); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.dropdownItemText,
                    selected && styles.dropdownItemTextActive,
                  ]}>
                    {opt}
                  </Text>
                  {selected ? (
                    <Check size={14} color={BRAND} strokeWidth={2.8} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
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

  // ── Photo block ─────────────────────────────────────────────────
  photoBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  photoWrap: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'visible',
  },
  photoImg: {
    width: 84, height: 84, borderRadius: 42,
  },
  photoInitials: {
    fontSize: 26, fontWeight: '900', color: BRAND,
  },
  photoBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoRemove: {
    position: 'absolute', top: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#B91C1C',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  photoHelpTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  photoHelpSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 3, lineHeight: 16, fontWeight: '500' },

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

  // ── Inline expanding dropdown ─────────────────────────────────────
  dropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: SURFACE,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  dropdownTriggerOpen: {
    borderColor: BRAND,
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  },
  dropdownText: { flex: 1, fontSize: 14, fontWeight: '600', color: TEXT },
  dropdownPlaceholder: { color: TEXT_LIGHT, fontWeight: '500' },
  dropdownPanel: {
    borderWidth: 1, borderColor: BRAND, borderTopWidth: 0,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    backgroundColor: SURFACE,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  dropdownItemActive: {
    backgroundColor: BRAND_SOFT,
  },
  dropdownItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  dropdownItemTextActive: { color: BRAND, fontWeight: '800' },

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
