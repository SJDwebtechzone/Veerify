// src/screens/admin/SetupInstitutionScreen.js
//
// 5-step wizard the institution owner uses after picking a plan and before
// submitting for super-admin approval.
//
//  Step 1  Core Details        - institution_name, brand_name, brand_logo,
//                                institution_type (with custom), registration_number,
//                                date_of_establishment.
//  Step 2  Contact & Location  - head office address (+ city, pincode),
//                                no_of_branches, branches[] repeater,
//                                official_email, primary_contact_number, website_url.
//  Step 3  Accreditation       - affiliation_or_board, accreditation_body_name,
//                                accreditation_expiry_date, certificate upload.
//  Step 4  Operations          - total_student_capacity, current_enrollment_count,
//                                medium_of_instruction[], operating_hours.
//  Step 5  Point of Contact    - master_name, master_role, master_email,
//                                master_phone_number.
//
// Required fields stay the same as the legacy form (name, type, email,
// phone, address, registration_number, master_name) until the product spec
// finalises the new required list. Everything else is optional.

import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, ChevronRight, ChevronLeft, Check, Camera, FileText, Plus, Trash2,
  Building2, MapPin, ShieldCheck, BarChart3, UserSquare, Calendar, X,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera, } from 'react-native-image-picker';

import apiClient from '../../api/client';

// ─── Static lists ──────────────────────────────────────────────────────
// Institution_Type is now a free-text field with tap-to-fill suggestions
// (combobox pattern). Owners can pick a common type or type anything custom.
const INSTITUTION_TYPE_SUGGESTIONS = [
  'School', 'College', 'Academy', 'Training Center',
  'Karate', 'Silambam', 'Taekwondo', 'Boxing', 'Muay Thai',
  'BJJ (Brazilian Jiu-Jitsu)', 'Judo', 'Kung Fu', 'MMA',
  'Self Defense', 'Kalaripayattu',
];

const BOARDS = [
  'CBSE', 'ICSE', 'State Board', 'IB', 'Cambridge (IGCSE)', 'University', 'Other',
];

const MEDIUMS = [
  'English', 'Tamil', 'Hindi', 'Telugu', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi',
];

const OPERATING_HOURS = [
  'Morning', 'Afternoon', 'Evening', 'Full Day', 'Weekends Only', 'Custom',
];

const MASTER_ROLES = [
  'Principal', 'Director', 'Admin', 'Head Coach', 'Founder', 'Owner', 'Other',
];

const STEPS = [
  { key: 'core',     label: 'Core',         icon: Building2  },
  { key: 'contact',  label: 'Contact',      icon: MapPin     },
  { key: 'accred',   label: 'Accreditation',icon: ShieldCheck},
  { key: 'ops',      label: 'Operations',   icon: BarChart3  },
  { key: 'poc',      label: 'Master',       icon: UserSquare },
];

// Tokens (avoid coupling to ../theme so this screen renders cleanly even
// during the admin pre-onboarding phase).
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

const blankBranch = () => ({ name: '', address: '', city: '', pincode: '' });

export default function SetupInstitutionScreen({ navigation }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ── Form state ────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    // Core
    name: '',
    brand_name: '',
    // institution_types is the canonical multi-select list of types. Owners
    // can pick any combination of suggested types or type their own (each
    // entry becomes a removable chip).
    institution_types: [],
    institution_type_input: '', // text input draft (not persisted to server)
    registration_number: '',
    date_of_establishment: '', // ISO date string (YYYY-MM-DD), set by the inline calendar
    logo_url: '',
    logo_uri: '', // local URI for preview while uploading

    // Contact & Location
    address: '',
    city: '',
    pincode: '',
    no_of_branches: '',
    branches: [],
    email: '',
    phone: '',
    website_url: '',

    // Accreditation
    affiliation_or_board: '',
    affiliation_or_board_custom: '',
    accreditation_body_name: '',
    accreditation_expiry_date: '',
    accreditation_certificate_url: '',
    accreditation_certificate_name: '',

    // Operations
    total_student_capacity: '',
    current_enrollment: '',
    medium_of_instruction: [],
    operating_hours: '',
    operating_hours_custom: '',

    // Point of contact
    master_name: '',
    master_role: '',
    master_role_custom: '',
    master_email: '',
    master_phone_number: '',
  });

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // ── Logo / certificate uploads ────────────────────────────────────────
  const pickAndUpload = (kind) => {
    // kind: 'logo' | 'cert'
    Alert.alert(
      kind === 'logo' ? 'Upload Brand Logo' : 'Upload Certificate',
      'Choose how to upload:',
      [
        { text: 'Gallery', onPress: () => fromGallery(kind) },
        { text: 'Camera',  onPress: () => fromCamera(kind) },
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
    setUploading(true);
    if (kind === 'logo') set('logo_uri', asset.uri);

    try {
      const fd = new FormData();
      if (kind === 'logo') {
        fd.append('logo', {
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'logo.jpg',
        });
        const resp = await apiClient.post('/uploads/logo', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        set('logo_url', resp.data.logo_url);
      } else {
        // Generic uploader for accreditation certificate (image OR pdf).
        fd.append('file', {
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'certificate.jpg',
        });
        const resp = await apiClient.post('/uploads', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        set('accreditation_certificate_url', resp.data.url);
        set('accreditation_certificate_name', asset.fileName || 'certificate');
      }
    } catch (err) {
      console.error('Upload error:', err?.response?.data || err.message);
      Alert.alert('Upload failed', 'Please try again with a smaller file.');
      if (kind === 'logo') set('logo_uri', '');
    } finally {
      setUploading(false);
    }
  };

  // ── Branch repeater ──────────────────────────────────────────────────
  const addBranch = () => set('branches', [...form.branches, blankBranch()]);
  const updateBranch = (idx, patch) => {
    const next = [...form.branches];
    next[idx] = { ...next[idx], ...patch };
    set('branches', next);
  };
  const removeBranch = (idx) =>
    set('branches', form.branches.filter((_, i) => i !== idx));

  // ── Per-step validation ──────────────────────────────────────────────
  const validateStep = (idx) => {
    switch (idx) {
      case 0: {
        if (!form.name?.trim()) return 'Institution Name is required';
        if (!form.institution_types?.length) {
          return 'Add at least one Institution Type';
        }
        if (!form.registration_number?.trim()) return 'Registration Number is required';
        return null;
      }
      case 1: {
        if (!form.address?.trim()) return 'Head Office Address is required';
        if (!form.email?.trim()) return 'Official Email is required';
        if (!/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
        if (!form.phone?.trim()) return 'Primary Contact Number is required';
        if (form.phone.length < 10) return 'Please enter a valid phone number';
        if (form.website_url && !/^https?:\/\//i.test(form.website_url)) {
          return 'Website URL must start with http:// or https://';
        }
        return null;
      }
      case 4: {
        if (!form.master_name?.trim()) return 'Master Name is required';
        if (form.master_email && !/\S+@\S+\.\S+/.test(form.master_email)) {
          return 'Please enter a valid master email';
        }
        return null;
      }
      // Steps 2 (accreditation) and 3 (operations) have no required fields
      // yet — the spec marks them as fill-when-available.
      default:
        return null;
    }
  };

  const goNext = () => {
    const err = validateStep(stepIdx);
    if (err) {
      Alert.alert('Required', err);
      return;
    }
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      submit();
    }
  };

  const goBack = () => {
    if (stepIdx === 0) {
      // SetupInstitution is mounted as the initial route after plan-select,
      // so the stack often has no entry behind us. Prefer goBack() when
      // available; otherwise jump to PlanSelection so the admin can change
      // their plan choice instead of being stranded with a dead button.
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        try { navigation.navigate('PlanSelection'); } catch { /* no-op */ }
      }
    } else {
      setStepIdx(stepIdx - 1);
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────
  const submit = async () => {
    // Run every step's validator one last time.
    for (let i = 0; i < STEPS.length; i += 1) {
      const err = validateStep(i);
      if (err) {
        setStepIdx(i);
        Alert.alert('Required', err);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        // core
        name: form.name.trim(),
        brand_name: form.brand_name.trim() || null,
        // Send the canonical array. Backend also sets the legacy
        // institution_type column to the first entry for back-compat.
        institution_types: form.institution_types,
        institution_type: form.institution_types[0] || null,
        registration_number: form.registration_number.trim(),
        date_of_establishment: form.date_of_establishment || null,
        logo_url: form.logo_url || null,

        // contact
        address: form.address.trim(),
        city: form.city.trim() || null,
        pincode: form.pincode.trim() || null,
        no_of_branches: form.no_of_branches ? Number(form.no_of_branches) : 0,
        branches: form.branches.filter((b) => b.address?.trim()),
        email: form.email.trim(),
        phone: form.phone.trim(),
        website_url: form.website_url.trim() || null,

        // accreditation
        affiliation_or_board: (form.affiliation_or_board || '').trim() || null,
        accreditation_body_name: form.accreditation_body_name.trim() || null,
        accreditation_expiry_date: form.accreditation_expiry_date || null,
        accreditation_certificate_url: form.accreditation_certificate_url || null,

        // operations
        total_student_capacity: form.total_student_capacity
          ? Number(form.total_student_capacity) : null,
        medium_of_instruction: form.medium_of_instruction,
        operating_hours: form.operating_hours === 'Custom'
          ? form.operating_hours_custom.trim() || null
          : (form.operating_hours || null),

        // master
        master_name: form.master_name.trim(),
        master_role: form.master_role === 'Other'
          ? form.master_role_custom.trim() || null
          : (form.master_role || null),
        master_email: form.master_email.trim() || null,
        master_phone_number: form.master_phone_number.trim() || null,
      };

      await apiClient.post('/onboarding/setup', payload);
      navigation.reset({
        index: 0,
        routes: [{ name: 'PendingApproval' }],
      });
    } catch (err) {
      Alert.alert(
        'Submission Failed',
        err.response?.data?.message || 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const progress = useMemo(
    () => Math.round(((stepIdx + 1) / STEPS.length) * 100),
    [stepIdx],
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ───── Header with progress ───── */}
      <View style={styles.headerWrap}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBack} style={styles.iconBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Academy Setup</Text>
            <Text style={styles.headerSub}>
              Step {stepIdx + 1} of {STEPS.length} · {STEPS[stepIdx].label}
            </Text>
          </View>
          <View style={styles.progressPill}>
            <Text style={styles.progressPillText}>{progress}%</Text>
          </View>
        </View>

        {/* Progress strip */}
        <View style={styles.progressStrip}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <TouchableOpacity
                key={s.key}
                style={styles.progressStep}
                onPress={() => {
                  // Only allow moving back to a completed step. Forward
                  // jumping must go through validation.
                  if (i < stepIdx) setStepIdx(i);
                }}
                activeOpacity={i < stepIdx ? 0.7 : 1}
              >
                <View style={[
                  styles.progressDot,
                  done && styles.progressDotDone,
                  active && styles.progressDotActive,
                ]}>
                  {done ? (
                    <Check size={11} color="#fff" strokeWidth={3} />
                  ) : (
                    <Icon size={11} color={active ? '#fff' : TEXT_LIGHT} strokeWidth={2.4} />
                  )}
                </View>
                <Text style={[
                  styles.progressLabel,
                  (done || active) && { color: BRAND, fontWeight: '700' },
                ]} numberOfLines={1}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {stepIdx === 0 && (
          <StepCore form={form} set={set} pickLogo={() => pickAndUpload('logo')} uploading={uploading} />
        )}
        {stepIdx === 1 && (
          <StepContact
            form={form}
            set={set}
            addBranch={addBranch}
            updateBranch={updateBranch}
            removeBranch={removeBranch}
          />
        )}
        {stepIdx === 2 && (
          <StepAccreditation
            form={form}
            set={set}
            pickCert={() => pickAndUpload('cert')}
            uploading={uploading}
          />
        )}
        {stepIdx === 3 && (
          <StepOperations form={form} set={set} />
        )}
        {stepIdx === 4 && (
          <StepMaster form={form} set={set} />
        )}
      </ScrollView>

      {/* ───── Bottom button bar ───── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={goBack}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGhostText}>
            {stepIdx === 0 ? 'Cancel' : 'Back'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.6 }]}
          onPress={goNext}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>
                {stepIdx === STEPS.length - 1 ? 'Submit' : 'Next'}
              </Text>
              {stepIdx === STEPS.length - 1 ? null : (
                <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
              )}
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Step 1: Core Details ───────────────────────────────────────────────
function StepCore({ form, set, pickLogo, uploading }) {
  return (
    <>
      <SectionIntro
        title="Core Details"
        sub="The basics about your institution. We'll show this to students browsing your academy."
      />

      <Field label="Institution Name" required>
        <TextInput
          style={styles.input}
          placeholder="e.g. Chennai Karate Academy"
          placeholderTextColor={TEXT_LIGHT}
          value={form.name}
          onChangeText={(v) => set('name', v)}
          maxLength={150}
        />
      </Field>

      <Field label="Brand Name" hint="The name students see in marketing. Defaults to your institution name.">
        <TextInput
          style={styles.input}
          placeholder="e.g. CKA Academy"
          placeholderTextColor={TEXT_LIGHT}
          value={form.brand_name}
          onChangeText={(v) => set('brand_name', v)}
          maxLength={150}
        />
      </Field>

      <Field label="Brand Logo" hint="PNG, JPG or WebP. Up to 5MB.">
        <TouchableOpacity
          style={[styles.upload, (form.logo_uri || form.logo_url) && styles.uploadDone]}
          onPress={pickLogo}
          disabled={uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator color={BRAND} />
          ) : form.logo_uri || form.logo_url ? (
            <>
              <Image
                source={{ uri: form.logo_uri || form.logo_url }}
                style={styles.logoPreview}
              />
              <Text style={styles.uploadDoneText}>Logo uploaded</Text>
              <Text style={styles.uploadChangeText}>Tap to change</Text>
            </>
          ) : (
            <>
              <Camera size={26} color={BRAND} strokeWidth={2} />
              <Text style={styles.uploadText}>Upload Logo</Text>
              <Text style={styles.uploadHint}>Tap to pick from gallery or take a photo</Text>
            </>
          )}
        </TouchableOpacity>
      </Field>

      <Field
        label="Institution Type"
        required
        hint="Add as many types as fit your institution. Type your own or tap a suggestion."
      >
        <MultiTypeInput
          values={form.institution_types}
          draft={form.institution_type_input}
          onDraftChange={(v) => set('institution_type_input', v)}
          onAdd={(raw) => {
            const v = (raw || '').trim();
            if (!v) return;
            // Case-insensitive de-dupe
            if (form.institution_types.some((t) => t.toLowerCase() === v.toLowerCase())) {
              set('institution_type_input', '');
              return;
            }
            set('institution_types', [...form.institution_types, v]);
            set('institution_type_input', '');
          }}
          onRemove={(idx) => {
            set('institution_types', form.institution_types.filter((_, i) => i !== idx));
          }}
          suggestions={INSTITUTION_TYPE_SUGGESTIONS}
        />
      </Field>

      <Field label="Registration Number" required hint="Government / board / federation registration ID.">
        <TextInput
          style={styles.input}
          placeholder="e.g. TN/MA/2024/001"
          placeholderTextColor={TEXT_LIGHT}
          value={form.registration_number}
          onChangeText={(v) => set('registration_number', v)}
          autoCapitalize="characters"
        />
      </Field>

      <Field label="Date of Establishment" hint="Tap to pick the founding date.">
        <DateField
          value={form.date_of_establishment}
          onChange={(v) => set('date_of_establishment', v)}
          maxYear={new Date().getFullYear()}
          placeholder="Pick founding date"
        />
      </Field>
    </>
  );
}

// ─── Step 2: Contact & Location ─────────────────────────────────────────
function StepContact({ form, set, addBranch, updateBranch, removeBranch }) {
  return (
    <>
      <SectionIntro
        title="Contact & Location"
        sub="How students and our team can reach you. You can add branch locations now or later."
      />

      <Field label="Head Office Address" required>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Door number, street, area..."
          placeholderTextColor={TEXT_LIGHT}
          value={form.address}
          onChangeText={(v) => set('address', v)}
          multiline
          textAlignVertical="top"
        />
      </Field>

      <View style={styles.row}>
        <Field label="City" style={{ flex: 1, marginRight: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="Chennai"
            placeholderTextColor={TEXT_LIGHT}
            value={form.city}
            onChangeText={(v) => set('city', v)}
          />
        </Field>
        <Field label="Pincode" style={{ flex: 1, marginLeft: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="600001"
            placeholderTextColor={TEXT_LIGHT}
            value={form.pincode}
            onChangeText={(v) => set('pincode', v)}
            keyboardType="numeric"
            maxLength={6}
          />
        </Field>
      </View>

      <Field label="No. of Branches" hint="Total branches you operate, including the head office.">
        <TextInput
          style={styles.input}
          placeholder="0"
          placeholderTextColor={TEXT_LIGHT}
          value={form.no_of_branches}
          onChangeText={(v) => set('no_of_branches', v.replace(/[^0-9]/g, ''))}
          keyboardType="numeric"
          maxLength={3}
        />
      </Field>

      <Field label="Branch Addresses" hint="Add any branches beyond your head office. Optional.">
        {form.branches.length === 0 ? (
          <Text style={styles.emptyHint}>No branches added yet.</Text>
        ) : (
          form.branches.map((b, i) => (
            <View key={i} style={styles.branchCard}>
              <View style={styles.branchHeader}>
                <Text style={styles.branchTitle}>Branch {i + 1}</Text>
                <TouchableOpacity onPress={() => removeBranch(i)} activeOpacity={0.7}>
                  <Trash2 size={16} color={BRAND} strokeWidth={2.4} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, styles.inputCompact]}
                placeholder="Branch name (e.g. T. Nagar)"
                placeholderTextColor={TEXT_LIGHT}
                value={b.name}
                onChangeText={(v) => updateBranch(i, { name: v })}
              />
              <TextInput
                style={[styles.input, styles.inputCompact, { marginTop: 6 }]}
                placeholder="Address"
                placeholderTextColor={TEXT_LIGHT}
                value={b.address}
                onChangeText={(v) => updateBranch(i, { address: v })}
                multiline
              />
              <View style={[styles.row, { marginTop: 6 }]}>
                <TextInput
                  style={[styles.input, styles.inputCompact, { flex: 1, marginRight: 6 }]}
                  placeholder="City"
                  placeholderTextColor={TEXT_LIGHT}
                  value={b.city}
                  onChangeText={(v) => updateBranch(i, { city: v })}
                />
                <TextInput
                  style={[styles.input, styles.inputCompact, { flex: 1, marginLeft: 6 }]}
                  placeholder="Pincode"
                  placeholderTextColor={TEXT_LIGHT}
                  value={b.pincode}
                  onChangeText={(v) => updateBranch(i, { pincode: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={6}
                />
              </View>
            </View>
          ))
        )}
        <TouchableOpacity style={styles.addBranchBtn} onPress={addBranch} activeOpacity={0.85}>
          <Plus size={14} color={BRAND} strokeWidth={2.6} />
          <Text style={styles.addBranchText}>Add branch</Text>
        </TouchableOpacity>
      </Field>

      <Field label="Official Email" required>
        <TextInput
          style={styles.input}
          placeholder="academy@example.com"
          placeholderTextColor={TEXT_LIGHT}
          value={form.email}
          onChangeText={(v) => set('email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label="Primary Contact Number" required>
        <TextInput
          style={styles.input}
          placeholder="9876543210"
          placeholderTextColor={TEXT_LIGHT}
          value={form.phone}
          onChangeText={(v) => set('phone', v)}
          keyboardType="phone-pad"
          maxLength={15}
        />
      </Field>

      <Field label="Website URL">
        <TextInput
          style={styles.input}
          placeholder="https://youracademy.com"
          placeholderTextColor={TEXT_LIGHT}
          value={form.website_url}
          onChangeText={(v) => set('website_url', v)}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
    </>
  );
}

// ─── Step 3: Accreditation ──────────────────────────────────────────────
function StepAccreditation({ form, set, pickCert, uploading }) {
  return (
    <>
      <SectionIntro
        title="Accreditation"
        sub="Optional. Helps students see that your academy is officially recognised."
      />

      {/* Free-text affiliation/board: martial-arts federations vary so much
          that a fixed pill list never quite fits. Admins can type whatever
          best describes their accreditation. */}
      <Field
        label="Affiliation or Board"
        hint="e.g. World Karate Federation, Khelo India, Sports Authority of India, your state board."
      >
        <TextInput
          style={styles.input}
          placeholder="Type your affiliation"
          placeholderTextColor={TEXT_LIGHT}
          value={form.affiliation_or_board}
          onChangeText={(v) => set('affiliation_or_board', v)}
        />
      </Field>

      <Field label="Accreditation Body Name">
        <TextInput
          style={styles.input}
          placeholder="e.g. Karate India Organisation"
          placeholderTextColor={TEXT_LIGHT}
          value={form.accreditation_body_name}
          onChangeText={(v) => set('accreditation_body_name', v)}
        />
      </Field>

      <Field label="Accreditation Expiry Date" hint="Tap to pick the certificate expiry date.">
        <DateField
          value={form.accreditation_expiry_date}
          onChange={(v) => set('accreditation_expiry_date', v)}
          minYear={new Date().getFullYear() - 1}
          maxYear={new Date().getFullYear() + 30}
          placeholder="Pick expiry date"
        />
      </Field>

      <Field label="Accreditation Certificate" hint="Upload a PDF or image of your certificate.">
        <TouchableOpacity
          style={[styles.upload, form.accreditation_certificate_url && styles.uploadDone]}
          onPress={pickCert}
          disabled={uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
            <ActivityIndicator color={BRAND} />
          ) : form.accreditation_certificate_url ? (
            <>
              <FileText size={26} color="#10B981" strokeWidth={2} />
              <Text style={styles.uploadDoneText}>
                {form.accreditation_certificate_name || 'Certificate'} uploaded
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
    </>
  );
}

// ─── Step 4: Operations ─────────────────────────────────────────────────
function StepOperations({ form, set }) {
  const toggleMedium = (m) => {
    const cur = new Set(form.medium_of_instruction);
    if (cur.has(m)) cur.delete(m);
    else cur.add(m);
    set('medium_of_instruction', Array.from(cur));
  };

  return (
    <>
      <SectionIntro
        title="Operations"
        sub="Tell us about your day-to-day capacity. All optional."
      />

      <View style={styles.row}>
        <Field label="Total Student Capacity" style={{ flex: 1, marginRight: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="500"
            placeholderTextColor={TEXT_LIGHT}
            value={form.total_student_capacity}
            onChangeText={(v) => set('total_student_capacity', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            maxLength={6}
          />
        </Field>
        <Field
          label="Current Enrollment"
          hint="Display-only snapshot."
          style={{ flex: 1, marginLeft: 8 }}
        >
          <TextInput
            style={styles.input}
            placeholder="120"
            placeholderTextColor={TEXT_LIGHT}
            value={form.current_enrollment}
            onChangeText={(v) => set('current_enrollment', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            maxLength={6}
          />
        </Field>
      </View>

      <Field label="Medium of Instruction" hint="Pick all that apply.">
        <View style={styles.chipRow}>
          {MEDIUMS.map((m) => {
            const on = form.medium_of_instruction.includes(m);
            return (
              <TouchableOpacity
                key={m}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => toggleMedium(m)}
                activeOpacity={0.85}
              >
                {on && <Check size={12} color="#fff" strokeWidth={2.6} style={{ marginRight: 4 }} />}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{m}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>

      <PillSelect
        label="Operating Hours"
        options={OPERATING_HOURS}
        value={form.operating_hours}
        onChange={(v) => set('operating_hours', v)}
      />
      {form.operating_hours === 'Custom' && (
        <Field label="Custom Hours">
          <TextInput
            style={styles.input}
            placeholder="e.g. 6 AM - 10 AM and 5 PM - 9 PM"
            placeholderTextColor={TEXT_LIGHT}
            value={form.operating_hours_custom}
            onChangeText={(v) => set('operating_hours_custom', v)}
          />
        </Field>
      )}
    </>
  );
}

// ─── Step 5: Master / Point of Contact ──────────────────────────────────
function StepMaster({ form, set }) {
  return (
    <>
      <SectionIntro
        title="Master / Point of Contact"
        sub="Who is the primary face of your academy? This is who our team will reach out to."
      />

      <Field label="Master Name" required>
        <TextInput
          style={styles.input}
          placeholder="e.g. Sensei Rajesh Kumar"
          placeholderTextColor={TEXT_LIGHT}
          value={form.master_name}
          onChangeText={(v) => set('master_name', v)}
        />
      </Field>

      <PillSelect
        label="Master Role"
        options={MASTER_ROLES}
        value={form.master_role}
        onChange={(v) => set('master_role', v)}
      />
      {form.master_role === 'Other' && (
        <Field label="Custom Role">
          <TextInput
            style={styles.input}
            placeholder="e.g. Co-founder"
            placeholderTextColor={TEXT_LIGHT}
            value={form.master_role_custom}
            onChangeText={(v) => set('master_role_custom', v)}
          />
        </Field>
      )}

      <Field label="Master Email">
        <TextInput
          style={styles.input}
          placeholder="master@example.com"
          placeholderTextColor={TEXT_LIGHT}
          value={form.master_email}
          onChangeText={(v) => set('master_email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label="Master Phone Number">
        <TextInput
          style={styles.input}
          placeholder="9876543210"
          placeholderTextColor={TEXT_LIGHT}
          value={form.master_phone_number}
          onChangeText={(v) => set('master_phone_number', v)}
          keyboardType="phone-pad"
          maxLength={15}
        />
      </Field>

      <View style={styles.reviewBox}>
        <Text style={styles.reviewTitle}>Almost there!</Text>
        <Text style={styles.reviewBody}>
          Tap Submit and our team will review your application within 24-48 hours.
          You can revisit and edit these details from your dashboard later.
        </Text>
      </View>
    </>
  );
}

// ─── Reusable bits ──────────────────────────────────────────────────────
function SectionIntro({ title, sub }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.introTitle}>{title}</Text>
      <Text style={styles.introSub}>{sub}</Text>
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

// ─── MultiTypeInput: chips + free-text + suggestions ───────────────────
//
// Layout:
//   [Selected chip × ] [Selected chip × ] ...
//   [____text input____] [Add]
//   + Suggestion   + Suggestion   ...
//
// - Tap × on a chip to remove it
// - Type in the input and tap Add (or hit return) to push a new chip
// - Tap a suggestion to push that suggestion (and it disappears from
//   the suggestion row since it's now selected)
function MultiTypeInput({ values, draft, onDraftChange, onAdd, onRemove, suggestions }) {
  const remaining = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );
  return (
    <View>
      {/* Selected chips */}
      {values.length > 0 ? (
        <View style={[styles.chipRow, { marginBottom: 8 }]}>
          {values.map((t, i) => (
            <View key={`${t}-${i}`} style={styles.selectedChip}>
              <Text style={styles.selectedChipText}>{t}</Text>
              <TouchableOpacity
                onPress={() => onRemove(i)}
                style={styles.selectedChipClose}
                hitSlop={6}
                activeOpacity={0.7}
              >
                <X size={11} color="#fff" strokeWidth={2.8} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {/* Text input + Add button */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder={values.length === 0 ? 'e.g. Martial Arts Academy' : 'Add another type…'}
          placeholderTextColor={TEXT_LIGHT}
          value={draft}
          onChangeText={onDraftChange}
          onSubmitEditing={() => onAdd(draft)}
          returnKeyType="done"
          maxLength={80}
        />
        <TouchableOpacity
          style={[styles.addTypeBtn, !draft?.trim() && { opacity: 0.5 }]}
          onPress={() => onAdd(draft)}
          disabled={!draft?.trim()}
          activeOpacity={0.85}
        >
          <Plus size={14} color="#fff" strokeWidth={2.8} />
          <Text style={styles.addTypeBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Suggestion pills */}
      {remaining.length > 0 ? (
        <View style={[styles.chipRow, { marginTop: 8 }]}>
          {remaining.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={styles.suggestChip}
              onPress={() => onAdd(opt)}
              activeOpacity={0.85}
            >
              <Plus
                size={11}
                color={BRAND}
                strokeWidth={2.6}
                style={{ marginRight: 3 }}
              />
              <Text style={styles.suggestChipText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PillSelect({ label, options, value, onChange, required }) {
  return (
    <Field label={label} required={required}>
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
    </Field>
  );
}

// ─── DateField: trigger button + inline calendar ────────────────────────
//
// Tap the field to expand a Material-style month grid. Header has < / > to
// step months and tappable month/year labels that flip the body to a
// month grid (12 buttons) or year grid (paginated 12 at a time).
//
// `value` and `onChange` use ISO date strings (YYYY-MM-DD) so the parent
// can store them straight in form state and send to the API as-is.
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_HEADERS = ['S','M','T','W','T','F','S'];

function pad2(n) { return String(n).padStart(2, '0'); }
function isoFor(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function parseIso(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstWeekday(y, m) { return new Date(y, m, 1).getDay(); }

function DateField({ value, onChange, minYear, maxYear, placeholder = 'Pick a date' }) {
  const today = new Date();
  const parsed = parseIso(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('day'); // 'day' | 'month' | 'year'
  const [cursor, setCursor] = useState({
    y: parsed?.y || today.getFullYear(),
    m: parsed?.m ?? today.getMonth(),
  });
  // Year grid pagination — anchor each page on the current cursor year.
  const [yearAnchor, setYearAnchor] = useState(parsed?.y || today.getFullYear());

  const yMin = minYear ?? 1900;
  const yMax = maxYear ?? today.getFullYear() + 10;

  const display = parsed
    ? `${pad2(parsed.d)} ${MONTH_NAMES[parsed.m].slice(0, 3)} ${parsed.y}`
    : placeholder;

  // Build the 6x7 grid cells for the day view.
  const grid = useMemo(() => {
    const cells = [];
    const offset = firstWeekday(cursor.y, cursor.m);
    const total = daysInMonth(cursor.y, cursor.m);
    for (let i = 0; i < offset; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const stepMonth = (delta) => {
    let y = cursor.y;
    let m = cursor.m + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    if (y < yMin) { y = yMin; m = 0; }
    if (y > yMax) { y = yMax; m = 11; }
    setCursor({ y, m });
  };

  const pickDay = (d) => {
    if (!d) return;
    onChange(isoFor(cursor.y, cursor.m, d));
    setOpen(false);
    setView('day');
  };

  const clear = () => {
    onChange('');
    setOpen(false);
    setView('day');
  };

  // ─── Renders ─────────────────────────────────────────────────────────
  return (
    <View>
      {/* Trigger button */}
      <TouchableOpacity
        style={styles.dateTrigger}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Calendar size={16} color={BRAND} strokeWidth={2.2} />
        <Text style={[styles.dateTriggerText, !parsed && { color: TEXT_LIGHT }]}>
          {display}
        </Text>
        {parsed ? (
          <TouchableOpacity onPress={clear} style={styles.dateClearBtn} hitSlop={8}>
            <X size={14} color={TEXT_MUTED} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : (
          <ChevronRight
            size={16}
            color={TEXT_LIGHT}
            strokeWidth={2}
            style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
          />
        )}
      </TouchableOpacity>

      {open ? (
        <View style={styles.calendarCard}>
          {/* Calendar header */}
          <View style={styles.calHeader}>
            <TouchableOpacity
              onPress={() => view === 'day' ? stepMonth(-1) : setYearAnchor(yearAnchor - 12)}
              style={styles.calNavBtn}
              activeOpacity={0.7}
            >
              <ChevronLeft size={16} color={TEXT} strokeWidth={2.4} />
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'center' }}>
              <TouchableOpacity
                style={styles.calLabelBtn}
                onPress={() => setView(view === 'month' ? 'day' : 'month')}
                activeOpacity={0.7}
              >
                <Text style={styles.calLabelText}>
                  {view === 'year'
                    ? `${yearAnchor} – ${yearAnchor + 11}`
                    : MONTH_NAMES[cursor.m]}
                </Text>
              </TouchableOpacity>
              {view !== 'year' ? (
                <TouchableOpacity
                  style={styles.calLabelBtn}
                  onPress={() => { setView('year'); setYearAnchor(cursor.y - 5); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.calLabelText}>{cursor.y}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={() => view === 'day' ? stepMonth(+1) : setYearAnchor(yearAnchor + 12)}
              style={styles.calNavBtn}
              activeOpacity={0.7}
            >
              <ChevronRight size={16} color={TEXT} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Day view */}
          {view === 'day' && (
            <>
              <View style={styles.calDayHeaderRow}>
                {DAY_HEADERS.map((d, i) => (
                  <View key={i} style={styles.calDayHeader}>
                    <Text style={styles.calDayHeaderText}>{d}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.calGrid}>
                {grid.map((d, i) => {
                  const isSelected = parsed
                    && parsed.y === cursor.y
                    && parsed.m === cursor.m
                    && parsed.d === d;
                  const isToday = !isSelected
                    && d
                    && today.getFullYear() === cursor.y
                    && today.getMonth() === cursor.m
                    && today.getDate() === d;
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.calCell}
                      disabled={!d}
                      onPress={() => pickDay(d)}
                      activeOpacity={0.7}
                    >
                      {d ? (
                        <View style={[
                          styles.calCellInner,
                          isSelected && styles.calCellSelected,
                          isToday && styles.calCellToday,
                        ]}>
                          <Text style={[
                            styles.calCellText,
                            isSelected && { color: '#fff', fontWeight: '800' },
                            isToday && !isSelected && { color: BRAND, fontWeight: '800' },
                          ]}>
                            {d}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Month view */}
          {view === 'month' && (
            <View style={styles.calMonthGrid}>
              {MONTH_NAMES.map((name, i) => {
                const isSel = parsed && parsed.y === cursor.y && parsed.m === i;
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.calMonthCell, isSel && styles.calCellSelected]}
                    onPress={() => { setCursor({ y: cursor.y, m: i }); setView('day'); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.calMonthCellText,
                      isSel && { color: '#fff', fontWeight: '800' },
                    ]}>
                      {name.slice(0, 3)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Year view */}
          {view === 'year' && (
            <View style={styles.calMonthGrid}>
              {Array.from({ length: 12 }, (_, i) => yearAnchor + i).map((y) => {
                const disabled = y < yMin || y > yMax;
                const isSel = cursor.y === y;
                return (
                  <TouchableOpacity
                    key={y}
                    style={[
                      styles.calMonthCell,
                      isSel && styles.calCellSelected,
                      disabled && { opacity: 0.3 },
                    ]}
                    disabled={disabled}
                    onPress={() => { setCursor({ y, m: cursor.m }); setView('month'); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.calMonthCellText,
                      isSel && { color: '#fff', fontWeight: '800' },
                    ]}>
                      {y}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Footer */}
          <View style={styles.calFooter}>
            <TouchableOpacity
              onPress={() => {
                const t = new Date();
                if (t.getFullYear() < yMin || t.getFullYear() > yMax) return;
                setCursor({ y: t.getFullYear(), m: t.getMonth() });
                setView('day');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.calFooterText}>Today</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={styles.calFooterText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  headerWrap: {
    backgroundColor: SURFACE,
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  progressPill: {
    backgroundColor: BRAND,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  progressPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  progressStrip: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 14, paddingHorizontal: 4,
  },
  progressStep: { alignItems: 'center', flex: 1 },
  progressDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: BG,
    borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  progressDotDone: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  progressDotActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  progressLabel: {
    fontSize: 10, color: TEXT_LIGHT, marginTop: 4, fontWeight: '600',
  },

  body: { padding: 16, paddingBottom: 32 },

  introTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  introSub: { fontSize: 13, color: TEXT_MUTED, marginTop: 4, lineHeight: 19 },

  label: { fontSize: 12, fontWeight: '700', color: TEXT, marginBottom: 6, letterSpacing: 0.3 },
  hint: { fontSize: 11, color: TEXT_MUTED, marginTop: 4, lineHeight: 16 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: TEXT,
  },
  inputCompact: { paddingVertical: 9, fontSize: 13 },
  textarea: { minHeight: 78, paddingTop: 11 },
  row: { flexDirection: 'row' },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: SURFACE,
    borderRadius: 999,
    borderWidth: 1, borderColor: BORDER,
  },
  chipOn: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  chipText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  chipTextOn: { color: '#fff', fontWeight: '700' },

  // Suggestion chip — "+ <type>" tap-to-fill pill below the institution
  // type text input. Visually softer than the selection chip so users
  // read it as an autocomplete hint rather than a required choice.
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

  // Selected chip — solid red pill with × button. Used above the
  // institution-type input to show what the owner has already added.
  selectedChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 10, paddingRight: 4, paddingVertical: 5,
    backgroundColor: BRAND,
    borderRadius: 999,
  },
  selectedChipText: { fontSize: 12, color: '#fff', fontWeight: '800' },
  selectedChipClose: {
    marginLeft: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Add button next to the text input
  addTypeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14,
    backgroundColor: BRAND,
    borderRadius: 10,
  },
  addTypeBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // ── Date picker (trigger + inline calendar) ─────────────────────────
  dateTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  dateTriggerText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },
  dateClearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BG,
  },
  calendarCard: {
    marginTop: 8,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    padding: 10,
  },
  calHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 8,
  },
  calNavBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  calLabelBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
  },
  calLabelText: { fontSize: 14, fontWeight: '800', color: TEXT },

  calDayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  calDayHeader: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  calDayHeaderText: { fontSize: 10, color: TEXT_LIGHT, fontWeight: '700' },

  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center',
    padding: 2,
  },
  calCellInner: {
    width: '92%', aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  calCellText: { fontSize: 13, color: TEXT, fontWeight: '600' },
  calCellSelected: { backgroundColor: BRAND },
  calCellToday: {
    borderWidth: 1.5,
    borderColor: BRAND,
  },

  // Month + year grids reuse 4-column layout (3 rows of 4)
  calMonthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calMonthCell: {
    width: '25%',
    paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  calMonthCellText: { fontSize: 13, color: TEXT, fontWeight: '700' },

  calFooter: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  calFooterText: { fontSize: 12, fontWeight: '800', color: BRAND, paddingVertical: 4, paddingHorizontal: 4 },

  // Upload
  upload: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: BORDER,
    padding: 18,
    alignItems: 'center',
    gap: 4,
  },
  uploadDone: { borderColor: '#10B981', borderStyle: 'solid' },
  uploadText: { fontSize: 14, fontWeight: '700', color: TEXT, marginTop: 6 },
  uploadHint: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  uploadDoneText: { fontSize: 13, fontWeight: '700', color: '#059669', marginTop: 6 },
  uploadChangeText: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  logoPreview: { width: 76, height: 76, borderRadius: 12 },

  // Branch repeater
  emptyHint: {
    fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic',
    paddingVertical: 6,
  },
  branchCard: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    padding: 10,
    marginBottom: 8,
  },
  branchHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6,
  },
  branchTitle: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  addBranchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
    marginTop: 4,
  },
  addBranchText: { color: BRAND, fontWeight: '800', fontSize: 13 },

  // Review box (step 5 footer)
  reviewBox: {
    backgroundColor: BRAND_SOFT,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  reviewTitle: { fontSize: 14, fontWeight: '800', color: '#991B1B' },
  reviewBody: { fontSize: 12, color: '#7F1D1D', marginTop: 4, lineHeight: 17 },

  // Footer / button bar
  footer: {
    flexDirection: 'row',
    gap: 10,
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
