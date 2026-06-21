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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
  BackHandler, PermissionsAndroid,
} from 'react-native';
import {
  ArrowLeft, ChevronRight, ChevronLeft, Check, Camera, FileText, Plus, Trash2,
  Building2, MapPin, ShieldCheck, BarChart3, UserSquare, Calendar, X, Clock,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera, } from 'react-native-image-picker';

// Native modules. Metro's babel transform refuses computed-name
// require() calls, so we use plain string literals. Wrapped in try/catch
// so a temporarily-missing package surfaces as a runtime "setup required"
// alert rather than a hard crash on the first call.

let DocumentPicker = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('@react-native-documents/picker');
  DocumentPicker = (mod && mod.default) || mod || null;
} catch (e) {
  DocumentPicker = null;
}

let Geolocation = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('react-native-geolocation-service');
  Geolocation = (mod && mod.default) || mod || null;
} catch (e) {
  Geolocation = null;
}

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

// Certificate upload rules — PDF only, capped at 2 MB to keep
// onboarding/upload latency low.
const CERT_MAX_SIZE_MB = 2;
const CERT_MAX_SIZE_BYTES = CERT_MAX_SIZE_MB * 1024 * 1024;

// ─── Static lists ──────────────────────────────────────────────────────
// Institution_Type is now a free-text field with tap-to-fill suggestions
// (combobox pattern). Owners can pick a common type or type anything custom.
// Institution type is now a single-select from a fixed three-option list.
// Each entry has a short caption to clarify the distinction at a glance.
const INSTITUTION_TYPE_OPTIONS = [
  {
    value: 'School',
    caption: 'Affiliated educational institution offering martial arts.',
  },
  {
    value: 'Training Center',
    caption: 'Dedicated academy or dojo running coaching programs.',
  },
  {
    value: 'Association',
    caption: 'Federation, club, or governing body for the sport.',
  },
];

// Martial-arts skills the academy teaches. Multi-select chips — owners can
// tick as many as apply. "Other" lets them add a custom one.
const SKILL_OPTIONS = [
  'Karate',
  'Taekwondo',
  'Kung Fu',
  'Judo',
  'Boxing',
  'Muay Thai',
  'Brazilian Jiu-Jitsu (BJJ)',
  'MMA',
  'Yoga',
  'Silambam',
  'Kalaripayattu',
  'Aikido',
  'Krav Maga',
  'Kickboxing',
  'Self Defense',
];

const BOARDS = [
  'CBSE', 'ICSE', 'State Board', 'IB', 'Cambridge (IGCSE)', 'University', 'Other',
];

// Affiliation / board scope. Single-select dropdown with two options
// on the Accreditation step.
const AFFILIATION_OPTIONS = ['State', 'National'];

const MEDIUMS = [
  'English', 'Tamil', 'Hindi', 'Telugu', 'Kannada', 'Malayalam',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi',
];

// (Legacy preset list. Replaced by per-day time-slot editor in StepOperations.)

const MASTER_ROLES = [
   'Director', 'Admin', 'Head Coach', 'Founder',  'Other',
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

// Each branch carries the postal fields the wizard already collected,
// plus latitude / longitude that the student-side "nearby academies"
// search needs. lat/lng are filled either by the "Use my current
// location" button or — if the device denies GPS — left null, in which
// case the branch still appears in the list but won't surface in the
// student's distance search until coords are added later from the
// admin's Branches screen.
const blankBranch = () => ({
  name: '', address: '', city: '', pincode: '',
  latitude: null, longitude: null,
});

// Anything at or above this threshold counts as "Unlimited" on a plan.
// Mirrors the convention used by PlanSelectionScreen.
const UNLIMITED_THRESHOLD = 999;

export default function SetupInstitutionScreen({ navigation }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Plan ceiling — looked up at mount so the Operations step can disable
  // the capacity field on Unlimited and block over-the-limit values on
  // finite plans. While loading we leave it as null (no constraint), so
  // a flaky network never blocks the form.
  // Shape: { name, max_students, is_unlimited } or null.
  const [planInfo, setPlanInfo] = useState(null);

  // Edit mode — true when the admin already submitted the form and is
  // re-opening it from the pending-approval screen. Changes the header
  // copy ("Update Details") and the submit CTA wording.
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Pull the institution's selected plan_id and the full plan list
        // in parallel; pick the matching plan locally.
        const [statusRes, plansRes] = await Promise.all([
          apiClient.get('/onboarding/my-status'),
          apiClient.get('/plans'),
        ]);
        const inst = statusRes?.data?.institution;
        const rawPlanId = inst?.plan_id;
        const plansList = plansRes?.data?.plans || [];
        // plan_id can come back as number or string depending on the
        // serializer — coerce both sides so the find() actually matches.
        const planId = rawPlanId == null ? null : String(rawPlanId);
        const plan = plansList.find((p) => String(p.id) === planId);

        // ── Prefill the form from the existing institution row, if any.
        // This kicks in whenever the wizard is reopened (Edit Details flow
        // from the Pending Approval screen). Any fields the DB doesn't have
        // a column for yet (e.g. skills, structured operating-hour slots)
        // simply fall back to their empty defaults.
        // Only treat this as edit-mode when the institution has actually
        // been submitted at least once. 'registered' (just signed up) and
        // 'plan_selected' (picked a plan but never opened the form) both
        // count as "fresh" — show a clean form for them.
        const EDITABLE_STATUSES = ['pending_approval', 'approved', 'active', 'rejected'];
        if (!cancelled && inst && EDITABLE_STATUSES.includes(inst.onboarding_status)) {
          setIsEditMode(true);
          let parsedBranches = [];
          try {
            const raw = inst.branches;
            if (Array.isArray(raw)) parsedBranches = raw;
            else if (typeof raw === 'string' && raw.trim()) parsedBranches = JSON.parse(raw);
          } catch (_) { parsedBranches = []; }

          // Institution type — must match one of the 3 single-select
          // options. If the legacy row carried a free-text value (e.g.
          // "Karate", "Academy"), leave it blank so the admin picks one.
          const rawType = Array.isArray(inst.institution_types) && inst.institution_types[0]
            ? inst.institution_types[0]
            : (inst.institution_type || '');
          const VALID_TYPES = ['School', 'Training Center', 'Association'];
          const primaryType = VALID_TYPES.includes(rawType) ? rawType : '';

          // Skills are the new required Step 1 field. If the row predates
          // migration 028 the column will be null — fall back to empty
          // so the validator clearly prompts the admin to pick at least one.
          const safeSkills = Array.isArray(inst.skills) ? inst.skills : [];

          // Structured operating-hour slots (jsonb). If the row only has
          // the legacy text summary in `operating_hours`, seed one blank
          // editable slot per group so the admin sees the editor instead
          // of an empty area.
          const safeWeekday = Array.isArray(inst.operating_hours_weekday) && inst.operating_hours_weekday.length
            ? inst.operating_hours_weekday.map((s) => ({
                start: s?.start || '', end: s?.end || '',
              }))
            : [{ start: '', end: '' }];
          const safeWeekend = Array.isArray(inst.operating_hours_weekend) && inst.operating_hours_weekend.length
            ? inst.operating_hours_weekend.map((s) => ({
                start: s?.start || '', end: s?.end || '',
              }))
            : [{ start: '', end: '' }];

          setForm((prev) => ({
            ...prev,
            // Core
            name: inst.name || '',
            brand_name: inst.brand_name || '',
            institution_type: primaryType,
            skills: safeSkills,
            skills_other: '',
            registration_number: inst.registration_number || '',
            date_of_establishment: inst.date_of_establishment
              ? String(inst.date_of_establishment).slice(0, 10) : '',
            logo_url: inst.logo_url || '',
            // Contact
            address: inst.address || '',
            city: inst.city || '',
            pincode: inst.pincode || '',
            branches: parsedBranches.map((b) => ({
              name: b?.name || '', address: b?.address || '',
              city: b?.city || '', pincode: b?.pincode || '',
            })),
            email: inst.email || '',
            phone: inst.phone || '',
            website_url: inst.website_url || '',
            latitude:  inst.latitude  != null ? String(inst.latitude)  : '',
            longitude: inst.longitude != null ? String(inst.longitude) : '',
            location_accuracy_m: '',
            // Accreditation
            affiliation_or_board: inst.affiliation_or_board || '',
            accreditation_body_name: inst.accreditation_body_name || '',
            accreditation_expiry_date: inst.accreditation_expiry_date
              ? String(inst.accreditation_expiry_date).slice(0, 10) : '',
            accreditation_certificate_url: inst.accreditation_certificate_url || '',
            accreditation_certificate_name: inst.accreditation_certificate_url
              ? 'certificate.pdf' : '',
            // Operations
            total_student_capacity: inst.total_student_capacity != null
              ? String(inst.total_student_capacity) : '',
            current_enrollment: inst.current_enrollment != null
              ? String(inst.current_enrollment) : '',
            medium_of_instruction: Array.isArray(inst.medium_of_instruction)
              ? inst.medium_of_instruction : [],
            operating_hours_weekday: safeWeekday,
            operating_hours_weekend: safeWeekend,
            // Master / Point of contact
            master_name: inst.master_name || '',
            master_role: inst.master_role || '',
            master_email: inst.master_email || '',
            master_phone_number: inst.master_phone_number || '',
          }));
        }

        if (cancelled || !plan) return;

        const maxStudents = Number(plan.max_students);
        // Treat a missing / zero / negative cap as "no enforceable ceiling"
        // (likely a misconfigured plan or an Unlimited tier without an
        // explicit number). Without this the check below would fire for
        // every non-zero enrollment and force a bogus upgrade prompt.
        const noCeiling = !Number.isFinite(maxStudents) || maxStudents <= 0;
        const isUnlimited = noCeiling || maxStudents >= UNLIMITED_THRESHOLD;

        // eslint-disable-next-line no-console
        console.log('[Setup] plan info →', {
          plan_id: planId,
          plan_name: plan.name,
          max_students_raw: plan.max_students,
          max_students_parsed: maxStudents,
          is_unlimited: isUnlimited,
        });

        setPlanInfo({
          name: plan.name || 'Selected plan',
          max_students: isUnlimited ? 0 : maxStudents,
          is_unlimited: isUnlimited,
        });
      } catch (err) {
        // Silent — Operations step works with no plan info (no ceiling).
        console.warn('[Setup] plan lookup failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hardware back-button handler. We use a ref so the listener always
  // calls the latest goBack closure — registered ONCE at mount, no
  // deps, no re-binding. The ref is updated below after goBack is
  // defined (effects run after render so this is always populated).
  const goBackRef = useRef(() => {});
  useEffect(() => {
    const handler = () => {
      try { goBackRef.current && goBackRef.current(); } catch (e) { /* noop */ }
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => {
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      } else if (typeof BackHandler.removeEventListener === 'function') {
        BackHandler.removeEventListener('hardwareBackPress', handler);
      }
    };
  }, []);

  // ── Form state ────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    // Core
    name: '',
    brand_name: '',
    // institution_type is a single-select from the fixed three-option list:
    // School / Training Center / Association.
    institution_type: '',
    // skills is a multi-select list of martial-arts disciplines the
    // academy teaches (Karate, Kung Fu, BJJ, etc.). Plus an optional
    // free-text "other" the owner can add.
    skills: [],
    skills_other: '',
    registration_number: '',
    date_of_establishment: '', // ISO date string (YYYY-MM-DD), set by the inline calendar
    logo_url: '',
    logo_uri: '', // local URI for preview while uploading

    // Contact & Location
    address: '',
    city: '',
    pincode: '',
    // Geographic coordinates of the head office, captured via "Use my
    // current location" on Step 2. Stored as decimal degrees (e.g.
    // 13.0827 N, 80.2707 E). Powers the student-side nearby search.
    latitude: '',
    longitude: '',
    location_accuracy_m: '',  // metres (informational; not sent to server)
    // no_of_branches is now derived from `branches.length` at submit time
    // (always 1 + branches.length). We keep the key for API back-compat
    // but no longer maintain it as editable state.
    branches: [],
    email: '',
    phone: '',
    website_url: '',

    // Accreditation
    // Affiliation scope — 'State' or 'National'. Replaces the older
    // free-text field. The legacy *_custom key is gone.
    affiliation_or_board: '',
    accreditation_body_name: '',
    accreditation_expiry_date: '',
    accreditation_certificate_url: '',
    accreditation_certificate_name: '',

    // Operations
    total_student_capacity: '',
    current_enrollment: '',
    medium_of_instruction: [],
    // Operating hours are now split into two day-groups (Mon–Fri and
    // Sat–Sun). Each group is an array of `{ start, end }` slots in
    // 24-hour "HH:MM" form. Admins can add multiple slots per group
    // (e.g. a morning batch and an evening batch).
    operating_hours_weekday: [{ start: '', end: '' }],
    operating_hours_weekend: [{ start: '', end: '' }],

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
    if (kind === 'cert') {
      // Certificate is PDF-only — skip the gallery/camera prompt and open
      // the system document picker directly.
      pickCertPdf();
      return;
    }
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

  // Native document picker — PDF only, max 2 MB. Supports both v9
  // (pickSingle) and v10+ (pick) of @react-native-documents/picker so
  // the picker works regardless of which version is installed.
  const pickCertPdf = async () => {
    if (!DocumentPicker) {
      Alert.alert(
        'Setup required',
        'PDF uploads need the document picker module. Please run:\n\n' +
        '  npm install @react-native-documents/picker\n\n' +
        'then rebuild (cd android && ./gradlew clean && cd .. && \n' +
        'npx react-native run-android). On iOS, also pod install.',
      );
      return;
    }
    try {
      // Raw MIME string works on both v9 (which also exposes
      // DocumentPicker.types.pdf) and v10+ (which dropped types).
      const opts = { type: ['application/pdf'] };

      let res = null;
      if (typeof DocumentPicker.pickSingle === 'function') {
        // v9 API
        res = await DocumentPicker.pickSingle({ ...opts, copyTo: 'cachesDirectory' });
      } else if (typeof DocumentPicker.pick === 'function') {
        // v10+ API
        const arr = await DocumentPicker.pick({ ...opts, allowMultiSelection: false });
        res = Array.isArray(arr) ? arr[0] : arr;
      } else {
        Alert.alert(
          'Picker unavailable',
          'No compatible pick API found in the document picker module.',
        );
        return;
      }
      if (!res) return;

      // Belt-and-braces: extension + mime-type check (some Android pickers
      // ignore the type filter and surface non-PDF files).
      const name = res.name || '';
      const looksLikePdf =
        /\.pdf$/i.test(name) ||
        (res.type || '').toLowerCase() === 'application/pdf';
      if (!looksLikePdf) {
        Alert.alert('PDF only', 'Please pick a .pdf file for your certificate.');
        return;
      }
      if (typeof res.size === 'number' && res.size > CERT_MAX_SIZE_BYTES) {
        Alert.alert(
          'File too large',
          `Maximum allowed size is ${CERT_MAX_SIZE_MB} MB. Please pick a smaller PDF.`,
        );
        return;
      }

      await uploadAsset(
        {
          uri: res.fileCopyUri || res.uri,
          type: 'application/pdf',
          fileName: name || 'certificate.pdf',
          fileSize: res.size,
        },
        'cert',
      );
    } catch (err) {
      // Cancellation comes through in different shapes per version.
      const isCancel =
        (typeof DocumentPicker.isCancel === 'function' && DocumentPicker.isCancel(err)) ||
        err?.code === 'OPERATION_CANCELED' ||
        err?.code === 'DOCUMENT_PICKER_CANCELED' ||
        err?.message?.toLowerCase().includes('cancel');
      if (isCancel) return;
      console.warn('pickCertPdf error:', err);
      Alert.alert('Pick failed', err?.message || 'Could not open the file picker.');
    }
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
        // PDF-only accreditation certificate.
        fd.append('file', {
          uri: asset.uri,
          type: asset.type || 'application/pdf',
          name: asset.fileName || 'certificate.pdf',
        });
        // Use the institution / academy name as the file hint so the
        // accreditation cert lands as "veerify-academy-accreditation-...pdf"
        // on disk instead of the gallery's temp name.
        const hintName = (form.name || 'academy').trim();
        const hint = encodeURIComponent(`${hintName}-accreditation`);
        const resp = await apiClient.post(`/uploads?name_hint=${hint}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        // Store the RELATIVE upload path so the same record renders on
        // every client (emulator + browser + production).
        set('accreditation_certificate_url', resp.data.path || resp.data.url);
        set('accreditation_certificate_name', asset.fileName || 'certificate.pdf');
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
        if (!form.institution_type) {
          return 'Please select an Institution Type';
        }
        if (!form.skills?.length) {
          return 'Please select at least one Skill';
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
      case 3: {
        // Only Current Enrollment is plan-bound; Total Student Capacity
        // is the physical capacity of the institution and not constrained
        // by the SaaS plan tier.
        if (planInfo && !planInfo.is_unlimited) {
          const max = planInfo.max_students;
          const enr = parseInt(form.current_enrollment || '0', 10) || 0;
          if (enr > max) {
            return `Current Enrollment (${enr}) is more than your ${planInfo.name} plan allows (${max}). Upgrade to Unlimited to add more students.`;
          }
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
      // Step 2 (accreditation) has no required fields yet.
      default:
        return null;
    }
  };

  // Friendlier prompt for Step 3 — when the user overshoots the plan
  // ceiling we want two-button "Edit number" vs "Upgrade plan" choice,
  // not a flat Alert.
  const showOverLimitAlert = (label, entered) => {
    confirm({
      title: 'Plan limit reached',
      message:
        `${label} is ${entered}, but your ${planInfo.name} plan only allows ${planInfo.max_students} students. ` +
        `Reduce the number, or upgrade to the Unlimited plan.`,
      variant: 'warning',
      confirmText: 'Upgrade plan',
      cancelText: 'Edit number',
      onConfirm: () => {
        try { navigation.navigate('PlanSelection'); } catch { /* no-op */ }
      },
    });
  };

  // True if a branch card has no detail filled in at all.
  const isBranchEmpty = (b) =>
    !b?.name?.trim() &&
    !b?.address?.trim() &&
    !b?.city?.trim() &&
    !b?.pincode?.trim();

  // Indices (1-based) of branch cards that the user opened but left blank.
  const getEmptyBranchPositions = () =>
    form.branches
      .map((b, i) => (isBranchEmpty(b) ? i + 1 : null))
      .filter((n) => n !== null);

  // Drop every blank branch card from the array. Useful when the user picks
  // "Keep count at 1" in the empty-branch prompt.
  const removeEmptyBranches = () => {
    set('branches', form.branches.filter((b) => !isBranchEmpty(b)));
  };

  const goNext = () => {
    // On the Contact step, guard against half-added branches. If the user
    // tapped "Add branch" but didn't fill anything in, ask whether they
    // want to fill the details or drop the empty card (so the live count
    // returns to 1).
    if (stepIdx === 1) {
      const emptyPositions = getEmptyBranchPositions();
      if (emptyPositions.length > 0) {
        const label = emptyPositions.length === 1
          ? `Branch ${emptyPositions[0]} is empty.`
          : `Branches ${emptyPositions.join(', ')} are empty.`;
        Alert.alert(
          'Empty branch',
          `${label} Please enter the details, or remove the empty branch so the count returns to 1.`,
          [
            { text: 'Fill in details', style: 'cancel' },
            {
              text: emptyPositions.length === 1 ? 'Remove empty branch' : 'Remove empty branches',
              style: 'destructive',
              onPress: removeEmptyBranches,
            },
          ],
        );
        return;
      }
    }

    // Step 3 — over-limit guard. We only check Current Enrollment against
    // the plan ceiling, because that's the actual SaaS record count.
    // Total Student Capacity is the institution's physical space and
    // shouldn't be bound by which plan tier they picked.
    if (stepIdx === 3 && planInfo && !planInfo.is_unlimited) {
      const max = planInfo.max_students;
      const enr = parseInt(form.current_enrollment || '0', 10) || 0;
      if (enr > max) {
        showOverLimitAlert('Current Enrollment', enr);
        return;
      }
    }

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

  // Performs the actual back action from Step 0 — either pops the nav
  // stack or jumps back to PlanSelection if there's nothing behind us.
  const leaveSetup = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      try { navigation.navigate('PlanSelection'); } catch { /* no-op */ }
    }
  };

  const goBack = () => {
    if (stepIdx === 0) {
      // First step — leaving here exits the entire registration flow, so
      // confirm before discarding whatever they've typed so far.
      Alert.alert(
        isEditMode ? 'Discard changes?' : 'Leave registration?',
        isEditMode
          ? 'Any edits you\'ve made will be lost. Your previously-submitted details stay on file until super-admin approval.'
          : 'You\'re still on the first step. If you go back now, any details you\'ve entered will be discarded and you\'ll return to the plan selection screen.',
        [
          { text: 'Stay here', style: 'cancel' },
          {
            text: isEditMode ? 'Discard' : 'Leave',
            style: 'destructive',
            onPress: leaveSetup,
          },
        ],
        { cancelable: true },
      );
    } else {
      setStepIdx(stepIdx - 1);
    }
  };

  // Sync the ref so the hardware-back listener always invokes the
  // latest goBack closure (which sees the current stepIdx). Updating
  // a ref during render is allowed because no one reads it during
  // render — only the back-press handler does, asynchronously.
  goBackRef.current = goBack;

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
        // Single-select institution type (School / Training Center / Association).
        // We also send a 1-element institution_types array so the existing
        // backend code paths (which still read the array column for stats /
        // filters) keep working without a schema migration.
        institution_type: form.institution_type || null,
        institution_types: form.institution_type ? [form.institution_type] : [],
        // Skills the academy teaches (multi-select). If the owner typed an
        // additional free-text skill in "other", we fold it into the array
        // before sending.
        skills: [
          ...form.skills,
          ...(form.skills_other.trim() ? [form.skills_other.trim()] : []),
        ],
        registration_number: form.registration_number.trim(),
        date_of_establishment: form.date_of_establishment || null,
        logo_url: form.logo_url || null,

        // contact
        address: form.address.trim(),
        city: form.city.trim() || null,
        pincode: form.pincode.trim() || null,
        // Head office (+1) plus every branch that has at least one detail
        // filled in. Empty branch cards (user tapped "Add" but typed
        // nothing) don't count toward the total or get sent to the API.
        no_of_branches: 1 + form.branches.filter((b) =>
          (b?.name?.trim()) ||
          (b?.address?.trim()) ||
          (b?.city?.trim()) ||
          (b?.pincode?.trim())
        ).length,
        branches: form.branches.filter((b) => b.address?.trim()),
        email: form.email.trim(),
        phone: form.phone.trim(),
        website_url: form.website_url.trim() || null,
        // Head-office GPS, used by the student-side nearby-academies
        // search. Empty strings get coerced to nulls so the SQL UPDATE
        // doesn't choke on the NUMERIC column.
        latitude:  form.latitude  ? Number(form.latitude)  : null,
        longitude: form.longitude ? Number(form.longitude) : null,

        // accreditation
        affiliation_or_board: (form.affiliation_or_board || '').trim() || null,
        accreditation_body_name: form.accreditation_body_name.trim() || null,
        accreditation_expiry_date: form.accreditation_expiry_date || null,
        accreditation_certificate_url: form.accreditation_certificate_url || null,

        // operations
        // On an Unlimited plan we explicitly send null for capacity — the
        // field is disabled in the UI, so any stale value left over from
        // a previous plan choice should be cleared on save.
        total_student_capacity: planInfo?.is_unlimited
          ? null
          : (form.total_student_capacity
              ? Number(form.total_student_capacity)
              : null),
        medium_of_instruction: form.medium_of_instruction,
        // Send only fully-filled slots so the backend doesn't get
        // half-typed entries. We pass both the structured arrays AND a
        // human-readable summary string for back-compat with anything
        // that still reads the legacy `operating_hours` field.
        operating_hours_weekday: form.operating_hours_weekday.filter(
          (s) => s.start && s.end,
        ),
        operating_hours_weekend: form.operating_hours_weekend.filter(
          (s) => s.start && s.end,
        ),
        operating_hours: formatOperatingHoursSummary(
          form.operating_hours_weekday,
          form.operating_hours_weekend,
        ) || null,

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
            <Text style={styles.headerTitle}>
              {isEditMode ? 'Edit Academy Details' : 'Academy Setup'}
            </Text>
            <Text style={styles.headerSub}>
              {isEditMode ? 'Editable until approval · ' : ''}
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
          <StepOperations form={form} set={set} planInfo={planInfo} />
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
                {stepIdx === STEPS.length - 1
                  ? (isEditMode ? 'Save changes' : 'Submit')
                  : 'Next'}
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
        hint="Pick the option that best describes your institution."
      >
        <InstitutionTypeSelect
          value={form.institution_type}
          onChange={(v) => set('institution_type', v)}
          options={INSTITUTION_TYPE_OPTIONS}
        />
      </Field>

      <Field
        label="Skills"
        required
        hint="Tap every martial-arts discipline you teach. You can add another below if it's not listed."
      >
        <SkillsMultiSelect
          values={form.skills}
          onToggle={(skill) => {
            const has = form.skills.includes(skill);
            set(
              'skills',
              has
                ? form.skills.filter((s) => s !== skill)
                : [...form.skills, skill],
            );
          }}
          options={SKILL_OPTIONS}
          other={form.skills_other}
          onOtherChange={(v) => set('skills_other', v)}
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

      {/* Location capture — needed so the student-side "nearby academies"
          search can sort institutions by distance. Stand inside the head
          office and tap once. */}
      <Field
        label="Head Office Location"
        hint="Tap to capture the GPS coordinates. Stand inside your head office for best accuracy."
      >
        <LocationCaptureCard form={form} set={set} />
      </Field>

      <Field label="No. of Branches" hint="Auto-calculated: 1 (head office) plus every branch with details below.">
        {(() => {
          // Only count branch cards that actually have something filled in
          // — an empty "Add branch" card shouldn't bump the total.
          const filledCount = form.branches.filter((b) =>
            (b?.name?.trim()) ||
            (b?.address?.trim()) ||
            (b?.city?.trim()) ||
            (b?.pincode?.trim())
          ).length;
          const total = 1 + filledCount;
          return (
            <View style={styles.branchCountCard}>
              <View style={styles.branchCountIconWrap}>
                <MapPin size={16} color={BRAND} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.branchCountValue}>{total}</Text>
                <Text style={styles.branchCountCaption}>
                  {filledCount === 0
                    ? 'Head office only'
                    : `Head office + ${filledCount} branch${filledCount === 1 ? '' : 'es'}`}
                </Text>
              </View>
            </View>
          );
        })()}
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

      {/* Affiliation scope dropdown — State or National. The federation /
          body name goes in the dedicated field below. */}
      <Field
        label="Affiliation or Board"
        hint="Choose whether the affiliation is at the State or National level."
      >
        <SimpleDropdown
          value={form.affiliation_or_board}
          onChange={(v) => set('affiliation_or_board', v)}
          options={AFFILIATION_OPTIONS}
          placeholder="Select affiliation level"
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

      <Field
        label="Accreditation Certificate"
        hint={`PDF only · Max ${CERT_MAX_SIZE_MB} MB *`}
      >
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
              <Text style={styles.uploadText}>Upload PDF Certificate</Text>
              <Text style={styles.uploadHint}>PDF only · Max {CERT_MAX_SIZE_MB} MB</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.fileRuleNote}>
          * Only PDF files up to {CERT_MAX_SIZE_MB} MB are accepted.
        </Text>
      </Field>
    </>
  );
}

// ─── Step 4: Operations ─────────────────────────────────────────────────
function StepOperations({ form, set, planInfo }) {
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

      {/* Definitions note — clarifies the two capacity fields below so the
          admin doesn't confuse seats-available with students-enrolled. */}
      <View style={styles.opsNoteCard}>
        <View style={styles.opsNoteIconWrap}>
          <BarChart3 size={14} color={BRAND} strokeWidth={2.6} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.opsNoteTitle}>What these numbers mean</Text>
          <Text style={styles.opsNoteBody}>
            <Text style={styles.opsNoteLabel}>Total Student Capacity</Text>
            {' '}— the maximum number of students your institution can
            accommodate.
          </Text>
          <Text style={[styles.opsNoteBody, { marginTop: 4 }]}>
            <Text style={styles.opsNoteLabel}>Current Enrollment</Text>
            {' '}— how many students are currently learning at your
            institution right now.
          </Text>
        </View>
      </View>

      {/* Plan badge — shows the active plan's student ceiling so the
          admin knows what numbers to type in below. */}
      {planInfo ? (
        <View
          style={[
            styles.planBadge,
            planInfo.is_unlimited && styles.planBadgeUnlimited,
          ]}
        >
          <Text style={styles.planBadgeLabel}>{planInfo.name}</Text>
          <Text style={styles.planBadgeValue}>
            {planInfo.is_unlimited
              ? 'Unlimited students'
              : `Up to ${planInfo.max_students} students`}
          </Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <Field
          label="Total Student Capacity"
          style={{ flex: 1, marginRight: 8 }}
          hint={
            planInfo?.is_unlimited
              ? 'Disabled on Unlimited plans.'
              : 'Your building / classroom capacity.'
          }
        >
          <TextInput
            style={[
              styles.input,
              planInfo?.is_unlimited && styles.inputDisabled,
            ]}
            placeholder={planInfo?.is_unlimited ? 'Unlimited' : '500'}
            placeholderTextColor={TEXT_LIGHT}
            value={planInfo?.is_unlimited ? '' : form.total_student_capacity}
            onChangeText={(v) =>
              set('total_student_capacity', v.replace(/[^0-9]/g, ''))
            }
            keyboardType="numeric"
            maxLength={6}
            editable={!planInfo?.is_unlimited}
          />
        </Field>
        <Field
          label="Current Enrollment"
          style={{ flex: 1, marginLeft: 8 }}
          hint={
            planInfo && !planInfo.is_unlimited
              ? `Max ${planInfo.max_students}`
              : undefined
          }
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

      <Field
        label="Operating Hours"
        hint="Add the time windows when classes run. Weekdays and weekends are kept separate. Tap Add slot to add more time windows (e.g. a morning and an evening batch)."
      >
        <DaySlotsBlock
          title="Monday – Friday"
          subtitle="Weekday hours"
          slots={form.operating_hours_weekday}
          onChange={(next) => set('operating_hours_weekday', next)}
        />
        <View style={{ height: 12 }} />
        <DaySlotsBlock
          title="Saturday – Sunday"
          subtitle="Weekend hours"
          slots={form.operating_hours_weekend}
          onChange={(next) => set('operating_hours_weekend', next)}
        />
      </Field>
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

// ─── InstitutionTypeSelect: single-select 3-option card picker ─────────
//
// Stacked, full-width radio-style cards. Each card shows the option name
// and a short caption explaining what that type means, with a brand-red
// border + check badge when selected.
function InstitutionTypeSelect({ value, onChange, options }) {
  return (
    <View style={{ gap: 10 }}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.85}
            style={[
              styles.typeOptionCard,
              selected && styles.typeOptionCardSelected,
            ]}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                style={[
                  styles.typeOptionLabel,
                  selected && styles.typeOptionLabelSelected,
                ]}
              >
                {opt.value}
              </Text>
              <Text style={styles.typeOptionCaption}>{opt.caption}</Text>
            </View>
            <View
              style={[
                styles.typeOptionRadio,
                selected && styles.typeOptionRadioSelected,
              ]}
            >
              {selected ? (
                <View style={styles.typeOptionRadioDot} />
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── SkillsMultiSelect: tappable chips + free-text "other" ─────────────
//
// Wrapped row of chips for each skill in SKILL_OPTIONS. Tapping a chip
// toggles whether it's in `values`. Selected chips are solid red; the
// rest are soft outlined. Below the grid is a short "Other" text input
// for any skill not on the list.
function SkillsMultiSelect({ values, onToggle, options, other, onOtherChange }) {
  return (
    <View>
      <View style={styles.chipRow}>
        {options.map((opt) => {
          const on = values.includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onToggle(opt)}
              activeOpacity={0.85}
              style={[styles.skillChip, on && styles.skillChipOn]}
            >
              {on ? (
                <Check
                  size={12}
                  color="#fff"
                  strokeWidth={3}
                  style={{ marginRight: 4 }}
                />
              ) : null}
              <Text
                style={[styles.skillChipText, on && styles.skillChipTextOn]}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ marginTop: 12 }}>
        <Text style={styles.skillsOtherLabel}>Other (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Wing Chun, Capoeira…"
          placeholderTextColor={TEXT_LIGHT}
          value={other}
          onChangeText={onOtherChange}
          maxLength={60}
        />
      </View>
    </View>
  );
}

// ─── SimpleDropdown: trigger + inline menu (single-select) ─────────────
//
// Drop-in for any short list of choices. Closed: just a tap target showing
// the current value (or placeholder) with a chevron. Open: an inline card
// below with each option as a row; tapping picks + closes.
// ─── LocationCaptureCard: "Use my current location" on Step 2 ──────────
//
// Tap once → asks for location permission → reads device GPS once →
// writes latitude / longitude / accuracy into form state.
// Tap again to refresh. Already-captured coordinates show a small green
// confirmation row with the lat/lng and the accuracy estimate.
function LocationCaptureCard({ form, set }) {
  const [busy, setBusy] = useState(false);

  const hasCoords = !!(form.latitude && form.longitude);
  const lat = parseFloat(form.latitude);
  const lng = parseFloat(form.longitude);
  const accuracy = parseFloat(form.location_accuracy_m);

  const capture = async () => {
    if (!Geolocation) {
      Alert.alert(
        'Setup required',
        'Capturing GPS needs the geolocation module. Please run:\n\n' +
        '  npm install react-native-geolocation-service\n\n' +
        'then rebuild (cd android && ./gradlew clean && cd .. && \n' +
        'npx react-native run-android). On iOS, also pod install.\n\n' +
        'Add this line inside <manifest> in\n' +
        'android/app/src/main/AndroidManifest.xml:\n\n' +
        '  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
      );
      return;
    }

    // Android needs explicit runtime permission. iOS uses the Info.plist
    // string + Geolocation.requestAuthorization('whenInUse').
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location permission',
            message: 'Veerify needs your location to mark the head office position so students can find your academy nearby.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            'Permission denied',
            'Please grant location permission in Settings, then try again.',
          );
          return;
        }
      } catch (e) {
        Alert.alert('Permission error', e?.message || 'Could not request permission.');
        return;
      }
    } else if (typeof Geolocation.requestAuthorization === 'function') {
      try { await Geolocation.requestAuthorization('whenInUse'); } catch (_) { /* noop */ }
    }

    setBusy(true);
    try {
      Geolocation.getCurrentPosition(
        (pos) => {
          const c = pos?.coords || {};
          if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
            set('latitude', String(c.latitude));
            set('longitude', String(c.longitude));
            set('location_accuracy_m', c.accuracy != null ? String(Math.round(c.accuracy)) : '');
          } else {
            Alert.alert('No location returned', 'The device didn\'t return a valid position. Try again outside or near a window.');
          }
          setBusy(false);
        },
        (err) => {
          setBusy(false);
          const msg = err?.message || 'Could not read GPS.';
          if (err?.code === 1) {
            Alert.alert(
              'Permission denied',
              'Please grant location permission in Settings, then try again.',
            );
          } else {
            Alert.alert('Location error', msg);
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        },
      );
    } catch (e) {
      setBusy(false);
      Alert.alert('Location error', e?.message || 'Unexpected error.');
    }
  };

  const clear = () => {
    set('latitude', '');
    set('longitude', '');
    set('location_accuracy_m', '');
  };

  return (
    <View>
      {hasCoords ? (
        <View style={styles.locCard}>
          <View style={styles.locIconWrap}>
            <MapPin size={16} color="#10B981" strokeWidth={2.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locTitle}>Location captured</Text>
            <Text style={styles.locDetail}>
              {lat.toFixed(5)}, {lng.toFixed(5)}
              {Number.isFinite(accuracy) ? ` · ±${accuracy} m` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={clear} hitSlop={8} style={styles.locClearBtn}>
            <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.locBtn, busy && { opacity: 0.7 }]}
        onPress={capture}
        disabled={busy}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MapPin size={14} color="#fff" strokeWidth={2.6} />
        )}
        <Text style={styles.locBtnText}>
          {busy
            ? 'Reading GPS…'
            : hasCoords
              ? 'Refresh my location'
              : 'Use my current location'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function SimpleDropdown({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity
        style={styles.dropdownTrigger}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.dropdownTriggerText,
            !value && { color: TEXT_LIGHT, fontWeight: '500' },
          ]}
        >
          {value || placeholder}
        </Text>
        <ChevronRight
          size={14}
          color={TEXT_MUTED}
          strokeWidth={2.4}
          style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.dropdownMenu}>
          {options.map((opt, i) => {
            const isSel = value === opt;
            const isLast = i === options.length - 1;
            return (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.dropdownItem,
                  !isLast && styles.dropdownItemDivider,
                  isSel && styles.dropdownItemSelected,
                ]}
                onPress={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    isSel && styles.dropdownItemTextSelected,
                  ]}
                >
                  {opt}
                </Text>
                {isSel ? (
                  <Check size={14} color={BRAND} strokeWidth={2.8} />
                ) : null}
              </TouchableOpacity>
            );
          })}
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

// ─── DateField: trigger button + 3-wheel scroll picker ─────────────────
//
// Replaces the old calendar grid with a Day | Month | Year wheel picker
// (iOS-style) so that going back ~20 years takes a single flick instead
// of clicking the year arrow dozens of times. Each column is its own
// snapping ScrollView; the middle row is highlighted as the current
// selection. Tap "Done" to commit.
//
// `value` and `onChange` use ISO date strings (YYYY-MM-DD).
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function pad2(n) { return String(n).padStart(2, '0'); }
function isoFor(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function parseIso(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE = 5; // odd number so middle row is the "selected" row
const WHEEL_PADDING = WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE / 2);

// One scrollable column. Snaps to whole items; the parent decides which
// index is "selected" based on the final scroll offset.
function WheelColumn({ items, selectedIndex, onIndexChange, formatter }) {
  const ref = useRef(null);
  const lastReportedRef = useRef(selectedIndex);

  // Programmatic scroll when the selection changes from outside.
  useEffect(() => {
    if (lastReportedRef.current === selectedIndex) return;
    lastReportedRef.current = selectedIndex;
    ref.current?.scrollTo({
      y: selectedIndex * WHEEL_ITEM_HEIGHT,
      animated: false,
    });
  }, [selectedIndex]);

  // Initial position on mount.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({
        y: selectedIndex * WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const raw = Math.round(y / WHEEL_ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(items.length - 1, raw));
    if (clamped !== lastReportedRef.current) {
      lastReportedRef.current = clamped;
      onIndexChange(clamped);
    }
  };

  return (
    <View style={styles.wheelCol}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
        contentContainerStyle={{ paddingVertical: WHEEL_PADDING }}
        style={{ height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE }}
        nestedScrollEnabled
      >
        {items.map((it, i) => {
          const active = i === selectedIndex;
          return (
            <View key={i} style={styles.wheelItem}>
              <Text
                style={[
                  styles.wheelItemText,
                  active && styles.wheelItemTextActive,
                ]}
              >
                {formatter ? formatter(it) : String(it)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function DateField({ value, onChange, minYear, maxYear, placeholder = 'Pick a date' }) {
  const today = new Date();
  const parsed = parseIso(value);
  const [open, setOpen] = useState(false);

  const yMin = minYear ?? 1900;
  const yMax = maxYear ?? today.getFullYear() + 10;

  // Default working selection — current value, else today.
  const initialDay   = (parsed?.d || today.getDate()) - 1;
  const initialMonth = parsed?.m ?? today.getMonth();
  const initialYear  = (parsed?.y || today.getFullYear()) - yMin;

  const [dayIdx,   setDayIdx]   = useState(initialDay);
  const [monthIdx, setMonthIdx] = useState(initialMonth);
  const [yearIdx,  setYearIdx]  = useState(initialYear);

  // Re-seed the wheels whenever the dropdown re-opens so the user starts
  // on the existing value (or today if blank).
  useEffect(() => {
    if (!open) return;
    const p = parseIso(value);
    setDayIdx((p?.d || today.getDate()) - 1);
    setMonthIdx(p?.m ?? today.getMonth());
    setYearIdx((p?.y || today.getFullYear()) - yMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const years = useMemo(
    () => Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i),
    [yMin, yMax],
  );

  // Day count depends on the currently selected month/year (handles
  // 28/29/30/31).
  const selectedYear  = years[yearIdx] ?? today.getFullYear();
  const selectedMonth = monthIdx;
  const daysCount     = daysInMonth(selectedYear, selectedMonth);
  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => i + 1),
    [daysCount],
  );

  // If the user lands on Feb 30 by changing month, clamp down.
  useEffect(() => {
    if (dayIdx >= daysCount) setDayIdx(daysCount - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysCount]);

  const display = parsed
    ? `${pad2(parsed.d)} ${MONTH_NAMES[parsed.m].slice(0, 3)} ${parsed.y}`
    : placeholder;

  const confirm = () => {
    const d = dayIdx + 1;
    const m = monthIdx;
    const y = years[yearIdx];
    onChange(isoFor(y, m, d));
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const jumpToToday = () => {
    setDayIdx(today.getDate() - 1);
    setMonthIdx(today.getMonth());
    setYearIdx(today.getFullYear() - yMin);
  };

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
        <View style={styles.wheelCard}>
          {/* Column headers */}
          <View style={styles.wheelHeaderRow}>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>Day</Text>
            </View>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>Month</Text>
            </View>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>Year</Text>
            </View>
          </View>

          {/* Wheels with center-band highlight */}
          <View style={styles.wheelRow}>
            <View pointerEvents="none" style={styles.wheelHighlight} />

            <WheelColumn
              items={days}
              selectedIndex={dayIdx}
              onIndexChange={setDayIdx}
              formatter={(n) => pad2(n)}
            />
            <WheelColumn
              items={MONTH_NAMES}
              selectedIndex={monthIdx}
              onIndexChange={setMonthIdx}
              formatter={(n) => n.slice(0, 3)}
            />
            <WheelColumn
              items={years}
              selectedIndex={yearIdx}
              onIndexChange={setYearIdx}
            />
          </View>

          {/* Footer */}
          <View style={styles.wheelFooter}>
            <TouchableOpacity onPress={jumpToToday} activeOpacity={0.7}>
              <Text style={styles.wheelFooterTextSecondary}>Today</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={styles.wheelFooterTextSecondary}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirm}
              style={styles.wheelDoneBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.wheelDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── TimeField + DaySlotsBlock: Operating Hours editor ─────────────────
//
// Each "slot" is a `{ start, end }` pair in 24-hour HH:MM strings. The
// TimeField renders a compact tap target that, when tapped, opens a
// 3-column wheel (Hour 1–12 · Minute 00–55 step 5 · AM/PM). DaySlotsBlock
// composes these into a card per day-group, with an Add slot button at
// the bottom.
const HOUR_OPTIONS    = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_OPTIONS  = Array.from({ length: 12 }, (_, i) => i * 5);
const AMPM_OPTIONS    = ['AM', 'PM'];

function parseTime24(value) {
  if (!value) return null;
  const [h, m] = String(value).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}
function formatTime12(value) {
  const p = parseTime24(value);
  if (!p) return '';
  const isPM = p.h >= 12;
  const hour12 = p.h % 12 || 12;
  return `${hour12}:${pad2(p.m)} ${isPM ? 'PM' : 'AM'}`;
}

function TimeField({ value, onChange, placeholder = 'Select time' }) {
  const [open, setOpen] = useState(false);
  const parsed = parseTime24(value);

  // Defaults — 9:00 AM when empty.
  const def = parsed || { h: 9, m: 0 };
  const initHourIdx  = (def.h % 12 || 12) - 1;
  const initMinIdx   = Math.max(0, MINUTE_OPTIONS.indexOf(def.m));
  const initAmPmIdx  = def.h >= 12 ? 1 : 0;

  const [hourIdx,  setHourIdx]  = useState(initHourIdx);
  const [minIdx,   setMinIdx]   = useState(initMinIdx);
  const [ampmIdx,  setAmPmIdx]  = useState(initAmPmIdx);

  useEffect(() => {
    if (!open) return;
    const p = parseTime24(value) || { h: 9, m: 0 };
    setHourIdx((p.h % 12 || 12) - 1);
    const mi = MINUTE_OPTIONS.indexOf(p.m);
    setMinIdx(mi >= 0 ? mi : 0);
    setAmPmIdx(p.h >= 12 ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = () => {
    const hour12 = HOUR_OPTIONS[hourIdx];
    const minute = MINUTE_OPTIONS[minIdx];
    const isPM = ampmIdx === 1;
    let hour24 = hour12 % 12;
    if (isPM) hour24 += 12;
    onChange(`${pad2(hour24)}:${pad2(minute)}`);
    setOpen(false);
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.timeTrigger}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Clock size={13} color={BRAND} strokeWidth={2.4} />
        <Text
          style={[
            styles.timeTriggerText,
            !parsed && { color: TEXT_LIGHT, fontWeight: '500' },
          ]}
          numberOfLines={1}
        >
          {parsed ? formatTime12(value) : placeholder}
        </Text>
      </TouchableOpacity>

      {open ? (
        <View style={styles.wheelCard}>
          <View style={styles.wheelHeaderRow}>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>Hour</Text>
            </View>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>Min</Text>
            </View>
            <View style={styles.wheelCol}>
              <Text style={styles.wheelHeaderText}>AM/PM</Text>
            </View>
          </View>

          <View style={styles.wheelRow}>
            <View pointerEvents="none" style={styles.wheelHighlight} />
            <WheelColumn
              items={HOUR_OPTIONS}
              selectedIndex={hourIdx}
              onIndexChange={setHourIdx}
            />
            <WheelColumn
              items={MINUTE_OPTIONS}
              selectedIndex={minIdx}
              onIndexChange={setMinIdx}
              formatter={(n) => pad2(n)}
            />
            <WheelColumn
              items={AMPM_OPTIONS}
              selectedIndex={ampmIdx}
              onIndexChange={setAmPmIdx}
            />
          </View>

          <View style={styles.wheelFooter}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
              <Text style={styles.wheelFooterTextSecondary}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirm}
              style={styles.wheelDoneBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.wheelDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DaySlotsBlock({ title, subtitle, slots, onChange }) {
  const safeSlots = Array.isArray(slots) && slots.length > 0
    ? slots
    : [{ start: '', end: '' }];

  const update = (i, patch) => {
    const next = [...safeSlots];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const addSlot = () => onChange([...safeSlots, { start: '', end: '' }]);
  const removeSlot = (i) => {
    const next = safeSlots.filter((_, k) => k !== i);
    // Always keep at least one editable row visible.
    onChange(next.length ? next : [{ start: '', end: '' }]);
  };

  return (
    <View style={styles.daySlotsCard}>
      <View style={styles.daySlotsHeader}>
        <View style={styles.daySlotsHeaderIcon}>
          <Calendar size={13} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.daySlotsTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.daySlotsSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>

      {safeSlots.map((s, i) => (
        <View key={i} style={styles.slotRow}>
          <View style={styles.slotField}>
            <Text style={styles.slotFieldLabel}>From</Text>
            <TimeField
              value={s.start}
              onChange={(v) => update(i, { start: v })}
              placeholder="Start"
            />
          </View>
          <View style={styles.slotField}>
            <Text style={styles.slotFieldLabel}>To</Text>
            <TimeField
              value={s.end}
              onChange={(v) => update(i, { end: v })}
              placeholder="End"
            />
          </View>
          <TouchableOpacity
            onPress={() => removeSlot(i)}
            style={styles.slotRemoveBtn}
            disabled={safeSlots.length === 1 && !s.start && !s.end}
            hitSlop={6}
          >
            <Trash2
              size={14}
              color={safeSlots.length === 1 && !s.start && !s.end ? TEXT_LIGHT : BRAND}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={styles.addSlotBtn}
        onPress={addSlot}
        activeOpacity={0.85}
      >
        <Plus size={12} color={BRAND} strokeWidth={2.6} />
        <Text style={styles.addSlotBtnText}>Add slot</Text>
      </TouchableOpacity>
    </View>
  );
}

// Build a one-liner from the two slot arrays for back-compat with the
// legacy `operating_hours` text column. Example:
//   "Mon–Fri 09:00 AM – 12:00 PM, 05:00 PM – 09:00 PM · Sat–Sun 10:00 AM – 06:00 PM"
function formatOperatingHoursSummary(weekday, weekend) {
  const fmt = (slots) =>
    (slots || [])
      .filter((s) => s.start && s.end)
      .map((s) => `${formatTime12(s.start)} – ${formatTime12(s.end)}`)
      .join(', ');
  const wd = fmt(weekday);
  const we = fmt(weekend);
  const parts = [];
  if (wd) parts.push(`Mon–Fri ${wd}`);
  if (we) parts.push(`Sat–Sun ${we}`);
  return parts.join(' · ');
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

  // ── Institution Type single-select cards (School / Training Center / Association) ──
  typeOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  typeOptionCardSelected: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  typeOptionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
  },
  typeOptionLabelSelected: {
    color: BRAND,
  },
  typeOptionCaption: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 2,
    lineHeight: 16,
  },
  typeOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE,
  },
  typeOptionRadioSelected: {
    borderColor: BRAND,
    backgroundColor: BRAND,
  },
  typeOptionRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },

  // ── Skills multi-select chips ─────────────────────────────────────────
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  skillChipOn: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  skillChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
  },
  skillChipTextOn: {
    color: '#fff',
    fontWeight: '700',
  },
  skillsOtherLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  // ── Date picker (trigger + inline calendar) ─────────────────────────
  dateTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  dateTriggerText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },

  // ── SimpleDropdown (closed trigger + open menu) ─────────────────────
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownTriggerText: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
  },
  dropdownMenu: {
    marginTop: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  dropdownItemSelected: {
    backgroundColor: BRAND_SOFT,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
  },
  dropdownItemTextSelected: {
    color: BRAND,
    fontWeight: '800',
  },

  dateClearBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BG,
  },

  // ── 3-wheel scroll date picker (Day | Month | Year) ─────────────────
  wheelCard: {
    marginTop: 8,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingTop: 10,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  wheelHeaderRow: {
    flexDirection: 'row',
    paddingBottom: 6,
  },
  wheelHeaderText: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  wheelRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  // Center highlight band sits behind the three columns. Top = padding
  // (so it's centered on the middle row).
  wheelHighlight: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: WHEEL_PADDING,
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    borderWidth: 1,
    borderColor: BRAND,
  },
  wheelCol: {
    flex: 1,
  },
  wheelItem: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontSize: 15,
    color: TEXT_LIGHT,
    fontWeight: '600',
  },
  wheelItemTextActive: {
    fontSize: 17,
    color: BRAND,
    fontWeight: '800',
  },
  wheelFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 4,
  },
  wheelFooterTextSecondary: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_MUTED,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  wheelDoneBtn: {
    backgroundColor: BRAND,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
  },
  wheelDoneText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
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

  // ── Day-slots editor (Mon–Fri / Sat–Sun blocks) ────────────────────
  daySlotsCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  daySlotsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  daySlotsHeaderIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySlotsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT,
  },
  daySlotsSubtitle: {
    fontSize: 10,
    color: TEXT_MUTED,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  slotField: {
    flex: 1,
  },
  slotFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  slotRemoveBtn: {
    width: 32,
    height: 38,
    borderRadius: 8,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSlotBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRAND,
    borderStyle: 'dashed',
    backgroundColor: BRAND_SOFT,
  },
  addSlotBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: BRAND,
  },

  // Compact tap target for one TimeField (start / end). Same visual
  // weight as the input style, but row-aligned with the clock icon.
  timeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 38,
  },
  timeTriggerText: {
    flex: 1,
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  // Greyed-out variant of `input` used when the field is intentionally
  // disabled (e.g. Total Capacity on an Unlimited plan).
  inputDisabled: {
    backgroundColor: BG,
    color: TEXT_LIGHT,
  },

  // ── Plan ceiling badge above the Operations capacity row ───────────
  // Finite plans → solid red soft pill ("Up to 30 students").
  // Unlimited plans → green pill ("Unlimited students").
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: BRAND_SOFT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BRAND,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  planBadgeUnlimited: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  planBadgeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  planBadgeValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'right',
  },

  // ── Operations step explainer card ─────────────────────────────────
  // Soft-red info box that defines "Total Student Capacity" vs.
  // "Current Enrollment" so admins fill the right number into each.
  opsNoteCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: BRAND_SOFT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BRAND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  opsNoteIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  opsNoteTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: BRAND,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  opsNoteBody: {
    fontSize: 12,
    color: TEXT,
    lineHeight: 17,
    fontWeight: '500',
  },
  opsNoteLabel: {
    fontWeight: '800',
    color: BRAND,
  },

  // Asterisk footnote line under the certificate upload, calling out the
  // PDF-only + max-size rule.
  fileRuleNote: {
    marginTop: 6,
    fontSize: 11,
    color: BRAND,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Head-office Location capture ────────────────────────────────────
  locCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  locIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  locDetail: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '600',
    marginTop: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  locClearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
  },
  locBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Auto-counted "No. of Branches" card (display-only) ───────────────
  branchCountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND_SOFT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BRAND,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  branchCountIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branchCountValue: {
    fontSize: 22,
    fontWeight: '800',
    color: BRAND,
    lineHeight: 26,
  },
  branchCountCaption: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: '600',
    marginTop: 1,
  },

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
