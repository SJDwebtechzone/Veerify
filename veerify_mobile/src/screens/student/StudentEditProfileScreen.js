// src/screens/student/StudentEditProfileScreen.js
//
// Student self-service profile editor. Reachable from the Profile tab's
// pencil overlay. Fields:
//   Editable:
//     • Profile photo (upload / tap-to-replace)
//     • Name
//     • Date of birth (YYYY-MM-DD)
//     • Gender
//     • Phone
//     • Email
//     • Address
//     • Emergency contact
//     • (Password → separate screen, linked below)
//   Read-only (institution-managed):
//     • Student ID
//     • Institution / branch
//     • Belt / level
//     • Enrolled programs (count)
//
// Backend:
//   GET   /api/enrollments/my-profile        — hydrate the form
//   POST  /api/uploads?name_hint=student-avatar — upload the photo
//   PATCH /api/enrollments/me/profile        — save the whole delta

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, TextInput, Image, Alert,
} from 'react-native';
import {
  ArrowLeft, Camera, Save, User, Mail, Phone, Calendar, MapPin,
  ShieldAlert, KeyRound, Building2, Award, Users, Lock,
} from 'lucide-react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import resolveAssetUrl from '../../utils/assetUrl';
import DateField from '../../components/DateField';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

// Minimal client-side validation to catch obvious typos before the
// backend rejects them. Server-side validation is the source of truth.
function isEmailish(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }
function isPhoneish(s) { return /^[+\d][\d\s\-()]{5,}$/.test(String(s || '').trim()); }
function isIsoDateish(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()); }

export default function StudentEditProfileScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [enrollCount, setEnrollCount] = useState(0);
  const [institutionName, setInstitutionName] = useState('');
  const [currentBelt, setCurrentBelt] = useState('');

  // Form state — starts empty and hydrates from GET /my-profile.
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    date_of_birth: '', gender: '',
    address: '', emergency_contact: '',
    photo_url: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    try {
      const [me, enrolls, journey] = await Promise.all([
        apiClient.get('/enrollments/my-profile').catch(() => ({ data: { profile: null } })),
        apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } })),
        apiClient.get('/belts/journey').catch(() => ({ data: null })),
      ]);
      const p = me.data?.profile || {};
      // Postgres returns DATE as either a plain 'YYYY-MM-DD' string
      // (when we to_char it — preferred) OR a JS Date that gets JSON-
      // serialised as UTC ISO. If we naively .slice(0,10) the UTC ISO,
      // timezones ahead of UTC (like +05:30) show yesterday's date.
      // normaliseDob detects both shapes and always returns the local
      // day the row actually represents.
      const normaliseDob = (v) => {
        if (!v) return '';
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && !s.includes('T')) {
          return s.slice(0, 10);
        }
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return s.slice(0, 10);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      setForm({
        name:              p.name  || user?.name  || '',
        email:             p.email || user?.email || '',
        phone:             p.phone || '',
        date_of_birth:     normaliseDob(p.date_of_birth),
        gender:            p.gender || '',
        address:           p.address || '',
        // Prefer the new dedicated column; fall back to the legacy
        // contact_number for pre-migration rows so old data still
        // hydrates into the field.
        emergency_contact: p.emergency_contact || p.contact_number || '',
        photo_url:         p.photo_url || '',
      });
      const list = enrolls.data?.enrollments || [];
      setEnrollCount(list.length);
      setInstitutionName(list[0]?.institution_name || '');
      setCurrentBelt(journey.data?.current_belt?.name || '');
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  // ── Photo pick + upload ──
  const pickPhoto = () => {
    launchImageLibrary(
      { mediaType: 'photo', selectionLimit: 1, quality: 0.6, maxWidth: 1200, maxHeight: 1200 },
      async (resp) => {
        if (resp.didCancel || !resp.assets?.length) return;
        const asset = resp.assets[0];
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append('file', {
            uri:  asset.uri,
            type: asset.type || 'image/jpeg',
            name: asset.fileName || 'student-avatar.jpg',
          });
          const r = await apiClient.post('/uploads?name_hint=student-avatar', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
          });
          const path = r.data?.path;
          if (path) set('photo_url', path);
        } catch (err) {
          Alert.alert(
            'Upload failed',
            err?.response?.data?.message || err?.message || 'Try a smaller photo.',
          );
        } finally {
          setUploading(false);
        }
      },
    );
  };

  // ── Save handler ──
  const save = async () => {
    // Client-side validation first — catches obvious typos before the
    // backend round-trip. Server still has final say.
    if (!form.name.trim()) {
      Alert.alert('Name required', 'Please enter your name before saving.');
      return;
    }
    // Email is locked, so no validation needed here — the input is
    // read-only in the UI and the backend silently ignores any sent
    // value that differs from the student's current email.
    if (form.phone && !isPhoneish(form.phone)) {
      Alert.alert('Invalid phone', 'Please enter a valid phone number.');
      return;
    }
    if (form.date_of_birth && !isIsoDateish(form.date_of_birth)) {
      Alert.alert('Invalid date', 'DOB must be YYYY-MM-DD.');
      return;
    }
    if (form.emergency_contact && !isPhoneish(form.emergency_contact)) {
      Alert.alert('Invalid emergency contact', 'Please enter a valid phone number.');
      return;
    }

    setSaving(true);
    try {
      const body = {
        name:              form.name.trim() || null,
        // email intentionally omitted — locked, sign-in identifier.
        phone:             form.phone.trim() || null,
        date_of_birth:     form.date_of_birth.trim() || null,
        gender:            form.gender || null,
        address:           form.address.trim() || null,
        emergency_contact: form.emergency_contact.trim() || null,
        // photo_url only sent when non-empty so we don't accidentally
        // clear a previous upload when the user just skipped picking.
        ...(form.photo_url ? { photo_url: form.photo_url } : {}),
      };
      await apiClient.patch('/enrollments/me/profile', body);
      confirm({
        title:       'Profile updated',
        message:     'Your changes have been saved.',
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      confirm({
        title:       'Could not save',
        message:     err?.response?.data?.message || err?.message || 'Try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  const avatarUri = form.photo_url ? resolveAssetUrl(form.photo_url) : null;
  const initials = (form.name || '?').trim().charAt(0).toUpperCase();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Edit Profile</Text>
          <Text style={styles.subtitle}>Update your details and save</Text>
        </View>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Save size={13} color="#fff" strokeWidth={2.6} />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        {/* Avatar block */}
        <View style={styles.avatarBlock}>
          <View style={styles.avatarWrap}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarImg, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
            <TouchableOpacity onPress={pickPhoto} style={styles.cameraBtn} activeOpacity={0.85}>
              {uploading ? <ActivityIndicator color="#fff" /> : <Camera size={13} color="#fff" strokeWidth={2.6} />}
            </TouchableOpacity>
          </View>
          <Text style={styles.avatarHint}>Tap the camera to change your photo</Text>
        </View>

        {/* Editable — personal */}
        <Section title="Personal">
          <Field label="Full name" icon={User}>
            <TextInput
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="Your full name"
              placeholderTextColor={palette.textLight}
              style={styles.input}
            />
          </Field>
          <Field label="Date of birth" icon={Calendar}>
            {/* Shared branded date sheet — Year / Month / Day scroll
                wheels with a Done confirm. Same picker used across
                Enrollment / Add Trainer / Belt Promotion flows. */}
            <DateField
              value={form.date_of_birth}
              onChange={(v) => set('date_of_birth', v)}
              placeholder="Pick date of birth"
              minYear={1900}
              maxYear={new Date().getFullYear()}
              accent={palette.purple.vivid}
            />
          </Field>
          <Field label="Gender" icon={Users}>
            <View style={styles.chipRow}>
              {GENDER_OPTIONS.map((g) => {
                const active = form.gender === g;
                return (
                  <TouchableOpacity
                    key={g}
                    onPress={() => set('gender', active ? '' : g)}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>
        </Section>

        {/* Editable — contact */}
        <Section title="Contact">
          <Field label="Phone" icon={Phone}>
            <TextInput
              value={form.phone}
              onChangeText={(v) => set('phone', v)}
              placeholder="10-digit number"
              placeholderTextColor={palette.textLight}
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Field>
          {/* Email is the sign-in identifier — locked. If the student
              really needs to change it, their institution admin can do
              so from the admin-side student editor. */}
          <Field label="Email" icon={Mail}>
            <View style={[styles.input, styles.inputLocked]}>
              <Text style={styles.inputLockedText} numberOfLines={1}>
                {form.email || 'Not set'}
              </Text>
              <View style={styles.inputLockedPill}>
                <Text style={styles.inputLockedPillText}>LOGIN</Text>
              </View>
            </View>
            <Text style={styles.fieldHint}>
              Your email is used to sign in — contact your academy if you need to change it.
            </Text>
          </Field>
          <Field label="Address" icon={MapPin}>
            <TextInput
              value={form.address}
              onChangeText={(v) => set('address', v)}
              placeholder="House / street / city"
              placeholderTextColor={palette.textLight}
              style={[styles.input, styles.inputMultiline]}
              multiline
            />
          </Field>
          <Field label="Emergency contact" icon={ShieldAlert}>
            <TextInput
              value={form.emergency_contact}
              onChangeText={(v) => set('emergency_contact', v)}
              placeholder="Phone number"
              placeholderTextColor={palette.textLight}
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Field>
        </Section>

        {/* Security */}
        <Section title="Security">
          <TouchableOpacity
            style={styles.linkRow}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ChangePassword')}
          >
            <View style={[styles.linkIcon, { backgroundColor: palette.purple.soft }]}>
              <KeyRound size={14} color={palette.purple.on} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Change password</Text>
              <Text style={styles.linkSub}>Set a new sign-in password</Text>
            </View>
            <Text style={styles.linkArrow}>›</Text>
          </TouchableOpacity>
        </Section>

        {/* Read-only — institution-managed */}
        <Section title="Institution-managed" hint="These are set by your academy and can't be edited here.">
          <ReadOnlyRow icon={Building2}  label="Institution"     value={institutionName || '—'} />
          <ReadOnlyRow icon={Award}      label="Belt / Level"    value={currentBelt || 'Not promoted yet'} />
          <ReadOnlyRow icon={Lock}       label="Enrolled programs" value={`${enrollCount}`} />
        </Section>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────
function Section({ title, hint, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Icon size={11} color={palette.textMuted} strokeWidth={2.4} />
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function ReadOnlyRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.roRow}>
      <View style={[styles.roIcon, { backgroundColor: palette.borderSoft }]}>
        <Icon size={12} color={palette.textMuted} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.roLabel}>{label}</Text>
        <Text style={styles.roValue} numberOfLines={1}>{value}</Text>
      </View>
      <View style={styles.roLockedPill}>
        <Text style={styles.roLockedText}>LOCKED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
    gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.purple.vivid,
  },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // Avatar
  avatarBlock: { alignItems: 'center', marginBottom: spacing.lg },
  avatarWrap: { position: 'relative' },
  avatarImg: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: palette.purple.soft,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 32, fontWeight: '900', color: palette.purple.vivid },
  cameraBtn: {
    position: 'absolute', right: -2, bottom: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: palette.bg,
  },
  avatarHint: {
    ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 8,
  },

  // Section
  section: { marginBottom: spacing.md },
  sectionTitle: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.6, marginBottom: 4,
  },
  sectionHint: {
    ...type.micro, color: palette.textLight, fontWeight: '600',
    marginBottom: 6,
  },
  sectionCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },

  // Field
  field: { marginBottom: spacing.md },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  fieldLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1, borderColor: palette.borderSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: palette.text,
    backgroundColor: palette.bg,
  },
  inputMultiline: {
    minHeight: 74, textAlignVertical: 'top',
  },
  // Locked input style — visually mirrors a normal input but with a
  // slightly greyer background and a "LOGIN" chip on the right so
  // it's obvious this field can't be edited.
  inputLocked: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.borderSoft + '55',
    paddingVertical: 10,
  },
  inputLockedText: {
    flex: 1, fontSize: 14, color: palette.textMuted, fontWeight: '600',
  },
  inputLockedPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: palette.borderSoft,
  },
  inputLockedPillText: {
    fontSize: 9, fontWeight: '900', color: palette.textMuted, letterSpacing: 0.6,
  },
  // Small hint line under any field (e.g. "used to sign in").
  fieldHint: {
    ...type.micro, color: palette.textLight, fontWeight: '600',
    marginTop: 4, lineHeight: 14,
  },

  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  chipActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  chipText: { fontSize: 12, fontWeight: '700', color: palette.text },
  chipTextActive: { color: '#fff' },

  // Link row
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6,
  },
  linkIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  linkTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  linkSub: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 2 },
  linkArrow: { fontSize: 20, color: palette.textLight, fontWeight: '800' },

  // Read-only rows
  roRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  roIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  roLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  roValue: {
    ...type.bodyBold, color: palette.text, fontSize: 13, marginTop: 2,
  },
  roLockedPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, backgroundColor: palette.borderSoft,
  },
  roLockedText: {
    fontSize: 9, fontWeight: '900', color: palette.textMuted,
    letterSpacing: 0.6,
  },
});
