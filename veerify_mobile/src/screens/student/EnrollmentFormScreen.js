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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
  Modal, FlatList,
} from 'react-native';
import {
  ArrowLeft, Camera, User, Calendar, Users, Phone, Mail, MapPin,
  Briefcase, Heart, ChevronRight, ChevronDown, Check, Droplet, Award,
} from 'lucide-react-native';
// Older lucide versions don't have Ruler/Weight/Accessibility - they were
// only imported, never rendered, but removing them removes the failure
// mode entirely.
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import PlanLimitModal from '../../components/PlanLimitModal';
import { confirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useInstitution } from '../../context/InstitutionContext';
import { formatBatchTimeRange } from '../../utils/formatTime';

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

// Current belt rank for an incoming student. Every new enrollment
// defaults to "White" (freshly starting martial-arts training); the
// dropdown stays fully editable so the admin can pick any higher
// rank if the student is joining with prior training. "Other" reveals
// a free-text input for academies that use non-standard belt names.
// Note: the legacy "New student" placeholder has been removed per
// spec — every enrollment now starts at "White" instead.
const BELT_OPTIONS = [
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue',
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
  const { user, institution } = useAuth();
  // Sub-branch admins are locked to their own branch server-side —
  // batches auto-filter to their branch_id, enrolInBatch refuses
  // cross-branch batches. We only render the Branch dropdown for
  // MAIN admins so they can pick which branch the student joins.
  const isBranchAdmin = !!institution?.parent_institution_id;
  const { selectedInstitution } = useInstitution();

  // ── Guest gate ──────────────────────────────────────────────────
  // Belt-and-suspenders: BatchesTabScreen + CourseDetailScreen already
  // pop the "Login to Continue" prompt for guests, but if this screen
  // ever mounts without an authenticated user (deep link, state
  // rehydration, etc.) we redirect to Login immediately so a guest
  // can never reach the Pay button. Runs once on mount.
  React.useEffect(() => {
    if (user || adminMode) return;
    // No user, no admin flag → this is a guest that slipped through.
    confirm({
      title: 'Sign in to enroll',
      message: 'You need a Veerify account to enroll and pay. Sign in or create an account to continue.',
      variant: 'destructive',
      confirmText: 'Login',
      cancelText: 'Not now',
      onConfirm: () => {
        try { navigation.navigate('Login'); return; } catch {}
        try { navigation.getParent()?.navigate('Login'); } catch {}
      },
      onCancel: () => {
        try { navigation.goBack(); } catch {}
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin-initiated path (from the Add Student quick action) doesn't
  // pre-bind to a batch — we let the admin pick a course first, then a
  // batch under that course via two cascading inline dropdowns.
  const [pickedBatch, setPickedBatch] = useState(batch || null);
  const [pickedCourseId, setPickedCourseId] = useState(batch?.course_id || null);
  const [adminBatches, setAdminBatches] = useState([]);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);

  // Branch selector — main-institution admin only. String value so
  // 'main' passes cleanly to the backend (batches.branch_id IS NULL).
  // Selecting a branch narrows the batch picker to that branch's
  // batches; changing the branch resets course/batch so a stale
  // selection can't survive across branch flips.
  const [subBranches, setSubBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('main');
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const branchLabel = selectedBranchId === 'main'
    ? 'Main Institution'
    : (subBranches.find((b) => String(b.id) === String(selectedBranchId))?.name || 'Branch');

  // Derive the course list from the batches the admin has access to. We
  // don't fire a separate /courses request — every batch row already
  // carries course_id + course_name. De-dupe by course_id.
  const adminCourses = React.useMemo(() => {
    const map = new Map();
    (adminBatches || []).forEach((b) => {
      if (!b?.course_id) return;
      if (!map.has(b.course_id)) {
        map.set(b.course_id, { id: b.course_id, name: b.course_name || 'Untitled course' });
      }
    });
    return Array.from(map.values());
  }, [adminBatches]);

  // Batches filtered by the picked course. Hides the Batch picker until
  // a course is chosen so the admin can't pick an unrelated batch.
  const filteredBatches = React.useMemo(() => {
    if (!pickedCourseId) return [];
    return (adminBatches || []).filter((b) => b.course_id === pickedCourseId);
  }, [adminBatches, pickedCourseId]);

  const batchId = pickedBatch?.id || paramBatchId || batch?.id;

  // Refresh the picked batch's course fee on every selection change so
  // the header + fee card show the LATEST value from the course row.
  // Falls back to whatever `pickedBatch.course_price` was already in
  // memory when the network fetch fails, so switching batches never
  // leaves the header showing a stale price.
  const [freshBatch, setFreshBatch] = useState(null);
  useEffect(() => {
    if (!batchId) { setFreshBatch(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiClient.get(`/batches/${batchId}`);
        if (!cancelled) setFreshBatch(r?.data?.batch || null);
      } catch (err) {
        if (!cancelled) setFreshBatch(null);
      }
    })();
    return () => { cancelled = true; };
  }, [batchId]);

  // Course fee resolution — always prefer the freshest source. Returns
  // a Number when a real fee is configured (may be 0), null when we
  // genuinely don't know yet (nothing picked / all sources undefined).
  const coursePrice = useMemo(() => {
    const raw =
      freshBatch?.course_price ??
      pickedBatch?.course_price ??
      batch?.course_price ??
      course?.price ??
      null;
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [freshBatch, pickedBatch, batch, course]);

  // Configured means "admin set a real positive fee". A stored 0 is
  // treated as "not configured" for display purposes — a fresh course
  // row defaults to price=0 in Postgres so there's no way to
  // distinguish "explicit 0" from "never set" without a schema change,
  // and no academy sets a real 0 fee intentionally.
  const feeConfigured = coursePrice != null && coursePrice > 0;
  const feeLabel = feeConfigured
    ? `₹${Number(coursePrice).toLocaleString('en-IN')}`
    : 'Fee Not Configured';
  // Amount actually sent to the payment link + enrollment record.
  // Zero when not configured so a Razorpay call fails cleanly rather
  // than minting a ₹0 link.
  const paymentAmount = feeConfigured ? Number(coursePrice) : 0;

  // Fetch sub-branches once for the branch dropdown. Skipped when
  // the caller is a branch admin — they have no choice to make.
  useEffect(() => {
    if (!adminMode || isBranchAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/branches');
        const list = (res?.data?.branches || [])
          .filter((b) => b.branch_kind === 'sub_branch' || b.parent_institution_id);
        if (!cancelled) setSubBranches(list);
      } catch (err) {
        // Non-fatal — dropdown just shows Main Institution.
        if (!cancelled) setSubBranches([]);
      }
    })();
    return () => { cancelled = true; };
  }, [adminMode, isBranchAdmin]);

  // When opened from admin "Add Student", fetch the institution's batches
  // so we can populate the inline picker. Scoped to the selected branch
  // for main admins (backend accepts ?branch_id=main / <id> / all); a
  // branch admin's list is auto-scoped server-side to their own branch
  // regardless of query, so we omit the param there.
  useEffect(() => {
    if (!adminMode) return;
    let cancelled = false;
    (async () => {
      try {
        const url = isBranchAdmin
          ? '/batches'
          : `/batches?branch_id=${encodeURIComponent(selectedBranchId)}`;
        const res = await apiClient.get(url);
        if (!cancelled) setAdminBatches(res?.data?.batches || []);
      } catch (err) {
        console.warn('[EnrollmentForm] failed to load batches for admin picker:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [adminMode, isBranchAdmin, selectedBranchId]);

  // Changing the branch invalidates any prior course/batch pick.
  // Without this, the admin could switch branches and still submit an
  // enrolment against a batch under the previous branch.
  useEffect(() => {
    if (!adminMode || isBranchAdmin) return;
    setPickedCourseId(null);
    setPickedBatch(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

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
    // belt_category — defaults to "White" per the enrollment-form
    // spec. Admin can change it to any other rank if the student
    // is joining with prior training. "Other" reveals
    // belt_category_other for non-standard belt names.
    belt_category: 'White',
    belt_category_other: '',
    photo_url: '',
    photo_uri: '',
    // Admin-mode only: how the fee was collected at the counter. The
    // payload only includes this when adminMode=true, so self-enrolled
    // students never trip the offline-paid branch on the server.
    payment_mode: 'cash',
    // Admin-mode only: when TRUE the backend mints a Razorpay Payment
    // Link + emails the student, and the enrolment stays as Pending
    // Payment until the webhook fires. When FALSE we fall through to
    // the offline payment_mode branch as before.
    enable_payment_link: false,
    // Admin-mode only: the OFFLINE-path next-installment date. Empty
    // string when unset. Deliberately disabled + ignored server-side
    // when enable_payment_link=true (Razorpay drives that schedule).
    next_payment_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  // Plan-cap modal — populated when the backend returns 402 PLAN_LIMIT_REACHED
  // on submit. We mirror the same UI the Students-tab FAB shows so the admin
  // gets one consistent upgrade prompt regardless of where they hit the cap.
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planLimitInfo, setPlanLimitInfo] = useState(null);

  // Photo source picker (Gallery/Camera). Rendered as a branded
  // bottom sheet so it matches the rest of the app instead of the
  // stock OS Alert.
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);

  // ── Exit guard ────────────────────────────────────────────────────
  // Guards against accidental exit while the student is filling the
  // enrolment form. Flipped to `true` right before we call
  // navigation.replace('EnrollmentPayment', ...) so the successful
  // submit path is NOT blocked by the confirmation dialog. Admin
  // "Add student" flow bypasses the guard entirely (see below).
  const submittedRef = useRef(false);

  // Intercept every attempt to leave the screen — hardware back, the
  // header back button, gesture-swipe, or any programmatic
  // navigation — and prompt "Are you sure you want to exit?" per
  // spec. Only self-enrolment gets the prompt; the admin quick-add
  // flow shouldn't nag the operator.
  useEffect(() => {
    if (adminMode) return;
    const beforeRemove = (e) => {
      if (submittedRef.current) return; // Successful submit → allow.
      e.preventDefault();
      confirm({
        title:       'Are you sure you want to exit?',
        message:     'Your enrollment is not yet completed.',
        variant:     'warning',
        confirmText: 'Exit',
        cancelText:  'Continue Enrollment',
        onConfirm: () => {
          // Flip the flag first so the re-dispatched action doesn't
          // trigger this listener recursively.
          submittedRef.current = true;
          navigation.dispatch(e.data.action);
        },
        // No onCancel → dismissing the dialog leaves the student on
        // the form exactly as spec'd ("Continue Enrollment — Stay").
      });
    };
    const unsub = navigation.addListener('beforeRemove', beforeRemove);
    return unsub;
  }, [navigation, adminMode]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Pre-fill from existing profile (subsequent enrollments) with a
  // fallback to the current user's account row when this is the
  // student's first enrolment (nothing in /enrollments/my-profile yet).
  //
  // ── Admin mode carve-out ─────────────────────────────────────────
  // When an admin opens Add Student, the `useAuth()` user IS the admin
  // — their name is the academy name and their email is the academy's
  // admin email. Falling back to those values used to pre-fill the
  // student's Personal Details with the INSTITUTION's info, which was
  // the reason the form kept showing "Damakka Academy" as the student
  // name. We now short-circuit: in admin mode the form starts EMPTY
  // and the admin types the student's details in manually. Only the
  // self-enrolment path (adminMode=false) uses the AuthContext
  // fallback, and there the `user` really is the student.
  useEffect(() => {
    (async () => {
      try {
        if (adminMode) {
          // Admin adding a new student — the form must NOT pre-fill
          // with the admin's / institution's data. Skip both the
          // profile fetch and the user fallback so the fields start
          // clean and the admin captures the student's own info.
          return;
        }
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
            // Fall back to the AuthContext user for the three "auto-fill"
            // fields so a brand-new student who never enrolled before
            // still sees their name / phone / email pre-populated.
            full_name:      p.full_name      || user?.name  || '',
            date_of_birth:  p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : '',
            father_name:    p.father_name || '',
            mother_name:    p.mother_name || '',
            contact_number: p.contact_number || user?.phone || '',
            email:          p.email          || user?.email || '',
            address:        p.address || '',
            occupation:     p.occupation || '',
            height_cm:      p.height_cm ? String(p.height_cm) : '',
            weight_kg:      p.weight_kg ? String(p.weight_kg) : '',
            blood_group:    p.blood_group || '',
            health_notes:   p.health_notes || p.disabilities || '',
            belt_category:  savedBelt
              ? (isStandardBelt ? savedBelt : 'Other')
              : 'White',
            belt_category_other: savedBelt && !isStandardBelt ? savedBelt : '',
            photo_url:      p.photo_url || '',
          }));
        } else {
          // No profile at all yet — seed the three auto-fill fields
          // straight from the AuthContext user (the STUDENT, since we
          // already returned early when adminMode is true).
          setForm((prev) => ({
            ...prev,
            full_name:      user?.name  || '',
            contact_number: user?.phone || '',
            email:          user?.email || '',
          }));
        }
      } catch (err) {
        // First-time enroller / API hiccup — still try to auto-fill the
        // three headline fields from the AuthContext user so the form is
        // never empty on the very first Join Batch tap. Not applicable
        // in admin mode; we already returned early above.
        if (!adminMode) {
          setForm((prev) => ({
            ...prev,
            full_name:      prev.full_name      || user?.name  || '',
            contact_number: prev.contact_number || user?.phone || '',
            email:          prev.email          || user?.email || '',
          }));
        }
      } finally {
        setLoadingProfile(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, adminMode]);

  const age = useMemo(() => ageFromDob(form.date_of_birth), [form.date_of_birth]);

  // ── Photo upload ───────────────────────────────────────────────────
  // Opens the branded bottom-sheet picker. The actual Gallery/Camera
  // launches happen from the sheet's option rows, not from here.
  const pickPhoto = () => setPhotoPickerOpen(true);
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
      confirm({
        title: 'Upload failed',
        message: 'That image is too large to upload. Please try a smaller one.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      set('photo_uri', '');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── Validation ─────────────────────────────────────────────────────
  // Student-side self-enrolment is the paid-course entry point, so we
  // require the FULL mandatory set before the Pay button can fire:
  //   • Full Name
  //   • Date of Birth
  //   • Contact Number (10-digit Indian mobile)
  //   • Email (valid format)
  //   • Address
  // Admin mode keeps the older, looser rules so the counter-enrolment
  // flow doesn't slow down with fields the admin can't always see.
  const validate = () => {
    if (!form.full_name?.trim()) return 'Full Name is required';

    if (!adminMode) {
      // Full mandatory-field enforcement for self-enrolling students —
      // this is the guard the "Pay Now" flow depends on.
      if (!form.date_of_birth) return 'Date of Birth is required';
      if (!form.contact_number?.trim()) return 'Contact Number is required';
      if (!/^[6-9]\d{9}$/.test(form.contact_number.replace(/\D/g, ''))) {
        return 'Please enter a valid 10-digit Indian mobile (starts with 6-9)';
      }
      if (!form.email?.trim()) return 'Email is required';
      if (!/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
      if (!form.address?.trim()) return 'Address is required';
    } else {
      // Admin mode — legacy loose rules preserved.
      if (form.email && !/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
      if (!form.email?.trim()) {
        return 'Email is required so we can email the student their login.';
      }
      if (form.contact_number && form.contact_number.length < 10) {
        return 'Please enter a valid contact number';
      }
    }

    if (form.belt_category === 'Other' && !form.belt_category_other.trim()) {
      return 'Please specify the belt level';
    }
    return null;
  };

  // Live invalid state — used ONLY to render the small hint under the
  // button so the student knows which field is still missing. The
  // button itself stays enabled by default (see canSubmit below); the
  // submit() handler runs the same validate() check on tap and pops
  // a friendly "Check this detail" dialog when something's missing.
  // Disabling the button caused too many "why can't I tap Submit?"
  // reports where the user hadn't scrolled far enough to see the
  // failing field — task #28's fix.
  const validationError = useMemo(() => validate(), [
    form.full_name, form.date_of_birth, form.contact_number,
    form.email, form.address, form.belt_category, form.belt_category_other,
    adminMode,
  ]);
  const canSubmit = !submitting;

  const submit = async ({ resume: resumeFlag = false } = {}) => {
    const err = validate();
    if (err) {
      confirm({
        title: 'Check this detail',
        message: err,
        variant: 'warning',
        confirmText: 'Got it',
        hideCancel: true,
      });
      return;
    }
    if (!batchId) {
      confirm({
        title: 'No batch selected',
        message: 'Please choose a batch before submitting the enrolment.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      return;
    }

    setSubmitting(true);
    try {
      // Resolve the belt category: when "Other" is picked we send the
      // custom string. Standard belts go through as-is. Fallback is
      // "White" (default for every new enrollment per spec).
      const beltVal = form.belt_category === 'Other'
        ? (form.belt_category_other || '').trim() || 'Other'
        : (form.belt_category || 'White');

      const res = await apiClient.post('/enrollments', {
        batch_id: batchId,
        // Resume Registration opt-in — set when the admin has
        // accepted the "Continue previous registration?" prompt for
        // this student's email/mobile. The backend then updates the
        // existing draft user row instead of blocking with
        // EMAIL_TAKEN / PHONE_TAKEN. See migration 077.
        resume: resumeFlag,
        // Tell the backend this is an admin-driven enrolment. When set,
        // the server creates a brand-new student user (or reuses the
        // existing email's account), emails the login credentials, then
        // links the enrolment to that user instead of the admin's id.
        admin_mode: !!adminMode,
        // Only attach payment_mode when the admin actually chose one —
        // self-enrolled students must still flow through the online-pay
        // path on the next screen.
        // Payment path — only one of the two branches applies:
        //   • enable_payment_link=true → server mints a Razorpay link,
        //     emails the student, enrolment stays Pending until paid.
        //   • enable_payment_link=false → server records payment_mode
        //     (cash/upi/bank/cheque) and marks paid immediately.
        enable_payment_link: adminMode ? !!form.enable_payment_link : undefined,
        payment_mode:
          adminMode && !form.enable_payment_link
            ? (form.payment_mode || 'cash')
            : undefined,
        // Only send next_payment_date on the OFFLINE path. The
        // backend also enforces this (ignores the field when
        // payment_link_enabled=true) but omitting it client-side
        // keeps the request payload honest to the UI.
        next_payment_date:
          adminMode && !form.enable_payment_link
            ? (form.next_payment_date || null)
            : undefined,
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

      // Admin-mode short-circuit: skip the online-pay screen and
      // bounce back to Students with a confirmation. Two variants:
      //   • Payment link enabled → tell admin we emailed the student
      //     and enrolment stays as Pending Payment.
      //   • Payment link disabled → recorded as offline sale under
      //     Institution / Branch Revenue with the chosen mode.
      if (adminMode) {
        const name = form.full_name.trim();
        if (form.enable_payment_link) {
          const url = enrollment?.payment_link_url;
          confirm({
            title: 'Payment link sent',
            message:
              `${name} has been enrolled and a payment link has been emailed to ${form.email.trim()}.\n\n` +
              `The account stays as Pending Payment until Razorpay confirms. Login credentials + welcome email go out automatically after payment is verified — nothing before then.` +
              (url ? `\n\nLink: ${url}` : ''),
            variant: 'success',
            confirmText: 'Done',
            hideCancel: true,
            onConfirm: () => navigation.goBack(),
          });
        } else {
          const modeLabel = {
            cash:   'Cash',
            upi:    'UPI',
            bank:   'Bank Transfer',
            cheque: 'Cheque',
          }[(form.payment_mode || 'cash').toLowerCase()] || 'Offline';
          confirm({
            title: 'Student enrolled',
            message:
              `${name} has been enrolled and the fee was recorded as ${modeLabel}. ` +
              `The amount is booked under Institution Revenue.`,
            variant: 'success',
            confirmText: 'Done',
            hideCancel: true,
            onConfirm: () => navigation.goBack(),
          });
        }
        return;
      }

      // Flip the exit-guard flag so the beforeRemove listener lets
      // this replace() through instead of prompting "Are you sure
      // you want to exit?" — the student IS finishing enrolment,
      // just moving to the payment step.
      submittedRef.current = true;
      navigation.replace('EnrollmentPayment', {
        enrollment, batch, course, amount: paymentAmount,
      });
    } catch (e) {
      // Plan-limit safety net: backend returns 402 PLAN_LIMIT_REACHED with
      // { code, limit, current, plan_name } when the institution is at its
      // student cap. Surface the same upgrade modal the Students tab FAB
      // shows so the admin gets a consistent prompt, not a stark Alert.
      const data = e?.response?.data || {};
      const isPlanCap =
        e?.response?.status === 402 ||
        data.code === 'PLAN_LIMIT_REACHED';
      if (isPlanCap && adminMode) {
        setPlanLimitInfo({
          limit:     data.limit,
          current:   data.current,
          plan_name: data.plan_name,
        });
        setPlanModalOpen(true);
      } else if (e?.response?.status === 409 && data.code === 'RESUME_AVAILABLE') {
        // Resume Registration prompt (spec: "An incomplete registration
        // was found for this email/mobile number. Would you like to
        // continue where you left off?"). On accept, retry with
        // resume:true so the backend overwrites the draft student
        // row instead of rejecting the collision.
        confirm({
          title:       'Continue previous enrolment?',
          message:     data.message
            || 'An incomplete registration was found for this email/mobile number. Would you like to continue where you left off?',
          variant:     'info',
          confirmText: 'Yes, continue',
          cancelText:  'Cancel',
          onConfirm:   () => submit({ resume: true }),
        });
      } else {
        // Server-side validation (e.g. "Please enter a valid 10-digit
        // mobile number starting with 6-9.") and other backend errors
        // surface through here. Map the validated field to a friendlier
        // title so the user immediately sees what to fix.
        const fieldTitle = {
          phone: 'Check the mobile number',
          email: 'Check the email',
        }[data.field] || 'Enrolment failed';
        confirm({
          title: fieldTitle,
          message: data.message || 'Something went wrong while submitting. Please try again.',
          variant: 'warning',
          confirmText: 'Fix it',
          hideCancel: true,
        });
      }
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
          {/* Course · Fee. The fee updates automatically whenever the
              admin picks a different batch (see freshBatch useEffect
              above) and reads "Fee Not Configured" when the course
              row has no positive price set. */}
          <Text style={styles.headerSub} numberOfLines={1}>
            {(freshBatch?.course_name
              || pickedBatch?.course_name
              || course?.name
              || batch?.course_name
              || 'Course')} · {feeLabel}
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

        {/* Admin-only: two cascading dropdowns — Course, then Batch.
            Only renders when the form was opened from the institution
            admin's "Add Student" quick action (adminMode=true). Students
            still get a pre-bound batch from CourseDetail's "Enroll Now". */}
        {adminMode ? (
          <>
            {/* ── 0. Select Branch ──────────────────────────────────
                Main-institution admin only. Branch admins have their
                branch inferred from the JWT and can only see their
                own branch's batches — no dropdown for them, no
                cross-branch enrolment possible. When the branch
                changes the batch picker refetches (see the effect on
                selectedBranchId) so the admin can't submit an
                enrolment against a batch that no longer belongs to
                the picked branch. */}
            {!isBranchAdmin && subBranches.length > 0 ? (
              <View style={styles.adminBatchCard}>
                <Text style={styles.adminBatchLabel}>Branch</Text>
                <TouchableOpacity
                  style={styles.adminBatchTrigger}
                  onPress={() => {
                    setBranchPickerOpen((o) => !o);
                    setCoursePickerOpen(false);
                    setBatchPickerOpen(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.adminBatchTriggerText} numberOfLines={1}>
                    {branchLabel}
                  </Text>
                  <ChevronRight
                    size={14}
                    color={TEXT_MUTED}
                    strokeWidth={2.2}
                    style={{ transform: [{ rotate: branchPickerOpen ? '90deg' : '0deg' }] }}
                  />
                </TouchableOpacity>

                {branchPickerOpen ? (
                  <View style={styles.adminBatchMenu}>
                    {/* Main Institution is always the first + default
                        option per spec. Selecting it sets branch_id
                        to null server-side. */}
                    <TouchableOpacity
                      style={[
                        styles.adminBatchItem,
                        selectedBranchId === 'main' && styles.adminBatchItemSelected,
                      ]}
                      onPress={() => {
                        setSelectedBranchId('main');
                        setBranchPickerOpen(false);
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.adminBatchItemTitle}>Main Institution</Text>
                    </TouchableOpacity>
                    {subBranches.map((b) => {
                      const isSel = String(selectedBranchId) === String(b.id);
                      return (
                        <TouchableOpacity
                          key={b.id}
                          style={[styles.adminBatchItem, isSel && styles.adminBatchItemSelected]}
                          onPress={() => {
                            setSelectedBranchId(b.id);
                            setBranchPickerOpen(false);
                          }}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.adminBatchItemTitle}>{b.name}</Text>
                          {b.city ? (
                            <Text style={styles.adminBatchItemMeta} numberOfLines={1}>{b.city}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ── 1. Select Course ─────────────────────────────────── */}
            <View style={styles.adminBatchCard}>
              <Text style={styles.adminBatchLabel}>Select Course</Text>
              <TouchableOpacity
                style={styles.adminBatchTrigger}
                onPress={() => {
                  setCoursePickerOpen((o) => !o);
                  setBatchPickerOpen(false);
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.adminBatchTriggerText,
                    !pickedCourseId && { color: TEXT_LIGHT, fontWeight: '500' },
                  ]}
                  numberOfLines={1}
                >
                  {(() => {
                    const c = adminCourses.find((x) => x.id === pickedCourseId);
                    return c ? c.name : 'Choose the course this student is enrolling in';
                  })()}
                </Text>
                <ChevronRight
                  size={14}
                  color={TEXT_MUTED}
                  strokeWidth={2.2}
                  style={{ transform: [{ rotate: coursePickerOpen ? '90deg' : '0deg' }] }}
                />
              </TouchableOpacity>

              {coursePickerOpen ? (
                <View style={styles.adminBatchMenu}>
                  {adminCourses.length === 0 ? (
                    <Text style={styles.adminBatchEmpty}>
                      No courses yet — publish a course first, then come back here.
                    </Text>
                  ) : (
                    adminCourses.map((c) => {
                      const isSel = pickedCourseId === c.id;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.adminBatchItem, isSel && styles.adminBatchItemSelected]}
                          onPress={() => {
                            setPickedCourseId(c.id);
                            // Clear the batch when the course changes so
                            // the next picker only shows valid options.
                            if (pickedBatch && pickedBatch.course_id !== c.id) {
                              setPickedBatch(null);
                            }
                            setCoursePickerOpen(false);
                          }}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.adminBatchItemTitle}>{c.name}</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>

            {/* ── 2. Select Batch (only after a course is chosen) ──── */}
            <View style={styles.adminBatchCard}>
              <Text style={styles.adminBatchLabel}>Select Batch</Text>
              <TouchableOpacity
                style={[
                  styles.adminBatchTrigger,
                  !pickedCourseId && { opacity: 0.6 },
                ]}
                onPress={() => {
                  if (!pickedCourseId) return;
                  setBatchPickerOpen((o) => !o);
                  setCoursePickerOpen(false);
                }}
                activeOpacity={0.85}
                disabled={!pickedCourseId}
              >
                <Text
                  style={[
                    styles.adminBatchTriggerText,
                    !pickedBatch && { color: TEXT_LIGHT, fontWeight: '500' },
                  ]}
                  numberOfLines={1}
                >
                  {pickedBatch
                    ? pickedBatch.name
                    : pickedCourseId
                      ? 'Choose a batch under this course'
                      : 'Pick a course first'}
                </Text>
                <ChevronRight
                  size={14}
                  color={TEXT_MUTED}
                  strokeWidth={2.2}
                  style={{ transform: [{ rotate: batchPickerOpen ? '90deg' : '0deg' }] }}
                />
              </TouchableOpacity>

              {batchPickerOpen && pickedCourseId ? (
                <View style={styles.adminBatchMenu}>
                  {filteredBatches.length === 0 ? (
                    <Text style={styles.adminBatchEmpty}>
                      No batches yet for this course — create a batch first, then come back here.
                    </Text>
                  ) : (
                    filteredBatches.map((b) => {
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
                          {b.days_of_week ? (
                            <Text style={styles.adminBatchItemSub}>{b.days_of_week}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {/* ── Batch summary (student mode only) ─────────────────────
            Shows the student EXACTLY what they're enrolling into so they
            can eyeball the details before scrolling into the form. All
            fields come from the batch row we were handed by the Batches
            tab; nothing here needs a second fetch. Fields with no value
            simply don't render — the card never has an empty row. */}
        {!adminMode && pickedBatch ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryHeading}>Batch Summary</Text>
            <SummaryRow
              label="Institution"
              value={selectedInstitution?.name || pickedBatch.institution_name}
            />
            <SummaryRow
              label="Branch"
              value={pickedBatch.branch_name}
            />
            <SummaryRow
              label="Course"
              value={pickedBatch.course_name || course?.name}
            />
            <SummaryRow
              label="Batch"
              value={pickedBatch.name || pickedBatch.batch_name}
            />
            <SummaryRow
              label="Trainer"
              value={pickedBatch.trainer_name || pickedBatch.trainer}
            />
            <SummaryRow
              label="Schedule"
              value={(() => {
                const time =
                  formatBatchTimeRange(pickedBatch.start_time, pickedBatch.end_time) ||
                  pickedBatch.time ||
                  pickedBatch.timing ||
                  '';
                const days = pickedBatch.days || pickedBatch.days_of_week || '';
                return [days, time].filter(Boolean).join(' · ');
              })()}
            />
            <SummaryRow
              label="Duration"
              value={(() => {
                const months =
                  pickedBatch.duration_months ??
                  course?.duration_months ??
                  pickedBatch.course_duration_months;
                if (months) return `${months} ${months === 1 ? 'month' : 'months'}`;
                return pickedBatch.duration || '';
              })()}
            />
            {/* Fee — reads the LATEST price from the picked batch's
                course. The `freshBatch` useEffect above re-fetches the
                batch every time the selection changes so an updated
                fee at the academy end shows up here without an app
                restart. Renders "Fee Not Configured" when no positive
                fee is on file. */}
            <SummaryRow
              label="Fee"
              value={feeLabel}
              emphasise
              alwaysShow
            />
            <SummaryRow
              label="Start Date"
              value={pickedBatch.start_date
                ? new Date(pickedBatch.start_date).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })
                : ''}
            />
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

        {/* Blood group — inline dropdown with the 8 ABO/Rh options. */}
        <Field label="Blood Group">
          <Dropdown
            options={BLOOD_GROUPS}
            value={form.blood_group}
            onChange={(v) => set('blood_group', v)}
            placeholder="Select blood group"
            icon={Droplet}
          />
        </Field>

        {/* Current belt category — 13 options, served via an inline
            dropdown so the form doesn't grow a 3-line chip wrap.
            "Other" still reveals the free-text field below. The Award
            icon hints at "rank / achievement" without taking space. */}
        <Field label="Current Belt Category" hint="Default is 'White'. Pick a higher rank if the student is joining with prior training.">
          <Dropdown
            options={BELT_OPTIONS}
            value={form.belt_category}
            onChange={(v) => set('belt_category', v)}
            placeholder="Select belt level"
            icon={Award}
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

        {/* Admin-mode only: Payment path chooser.
            The Enable Payment Link toggle switches between:
              • ON  → server mints a Razorpay link, emails the student,
                     enrolment stays as Pending Payment. Amount will
                     land on the Institution / Branch Wallet after
                     platform + gateway deductions.
              • OFF → admin picks Cash / UPI / Bank / Cheque, enrolment
                     is marked Paid immediately and booked under
                     Institution / Branch Revenue only. */}
        {adminMode ? (
          <>
            <View style={styles.linkToggleCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkToggleTitle}>Enable Payment Link</Text>
                <Text style={styles.linkToggleHint}>
                  {form.enable_payment_link
                    ? 'A Razorpay link will be emailed to the student. Their enrolment stays Pending Payment until verified.'
                    : 'Record an offline payment collected at the counter. Booked under Institution Revenue.'}
                </Text>
              </View>
              {/* Simple two-state pill so we don't pull in <Switch> — matches the app's pill aesthetic. */}
              <TouchableOpacity
                onPress={() => set('enable_payment_link', !form.enable_payment_link)}
                activeOpacity={0.85}
                style={[
                  styles.linkTogglePill,
                  form.enable_payment_link && styles.linkTogglePillActive,
                ]}
              >
                <View
                  style={[
                    styles.linkTogglePillDot,
                    form.enable_payment_link && styles.linkTogglePillDotActive,
                  ]}
                />
              </TouchableOpacity>
            </View>

            {/* Read-only Payment Link field. Auto-filled with the URL
                returned by the backend after the enrolment is saved.
                Rendered here so the admin knows what will be sent AND
                so we visually enforce the spec's "Payment Link field"
                requirement even before Save. */}
            {form.enable_payment_link ? (
              <>
                <Field
                  label="Payment Link"
                  hint="Automatically generated after Save and emailed to the student. Refresh their record to copy the URL later."
                >
                  <View style={styles.linkPreview}>
                    <Text style={styles.linkPreviewText} numberOfLines={1}>
                      Will be generated on save · sent to {form.email.trim() || 'the student email'}
                    </Text>
                  </View>
                </Field>
                {/* Read-only Next Payment Date when the link path is
                    on — spec: "If Payment Link is enabled, payment
                    scheduling is handled by payment links, so manual
                    Next Payment Date should not be editable." */}
                <Field
                  label="Next Payment Date"
                  hint="Managed by the Payment Link. Turn off Enable Payment Link to set a manual reminder date."
                >
                  <View style={[styles.linkPreview, { opacity: 0.55 }]}>
                    <Text style={styles.linkPreviewText} numberOfLines={1}>
                      Auto-managed by Payment Link
                    </Text>
                  </View>
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="Mode of Payment *"
                  hint="How was the fee collected? The enrolment will be marked paid immediately."
                >
                  <View style={styles.payModeRow}>
                    {[
                      { v: 'cash',   label: 'Cash' },
                      { v: 'upi',    label: 'UPI' },
                      { v: 'bank',   label: 'Bank Transfer' },
                      { v: 'cheque', label: 'Cheque' },
                    ].map((opt) => {
                      const active = form.payment_mode === opt.v;
                      return (
                        <TouchableOpacity
                          key={opt.v}
                          style={[styles.payModeChip, active && styles.payModeChipActive]}
                          onPress={() => set('payment_mode', opt.v)}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={[
                              styles.payModeChipText,
                              active && styles.payModeChipTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Field>

                {/* Next Payment Date — editable only on the offline
                    path. Feeds the reminder job so the student gets
                    a bell + WA nudge N days before this date. Empty
                    is fine — the row just isn't in the reminder set. */}
                <Field
                  label="Next Payment Date"
                  hint="Optional. Sets the reminder date for the next installment. Leave blank for one-time fees."
                >
                  <DateField
                    value={form.next_payment_date}
                    onChange={(v) => set('next_payment_date', v || '')}
                    placeholder="YYYY-MM-DD"
                  />
                </Field>
              </>
            )}
          </>
        ) : null}

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
          // Enabled by default. Missing / invalid fields still block
          // the submission — validate() runs first inside submit()
          // and pops a "Check this detail" dialog — but the button
          // itself stays tappable so the user gets clear inline
          // feedback instead of a silent grey button.
          style={[
            styles.btn, styles.btnPrimary,
            submitting && { opacity: 0.45 },
          ]}
          onPress={submit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>
                {adminMode ? 'Submit' : 'Pay Now'}
              </Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
      {/* Small hint under the disabled button so the student knows why
          they can't proceed yet. Renders only in self-enrolment mode. */}
      {!adminMode && validationError ? (
        <View style={{
          paddingHorizontal: 16,
          paddingBottom: 8,
          backgroundColor: SURFACE,
        }}>
          <Text style={{
            fontSize: 11, color: TEXT_MUTED, textAlign: 'center',
            fontStyle: 'italic',
          }}>
            {validationError}
          </Text>
        </View>
      ) : null}

      {/* Plan-cap modal — fires when /enrollments returns 402
          PLAN_LIMIT_REACHED in admin mode. Dismissing keeps the user
          on the form so they can fix what they had typed; tapping
          "View plans" sends them to PlanSelection. */}
      <PlanLimitModal
        visible={planModalOpen}
        kind="student"
        limit={planLimitInfo?.limit}
        current={planLimitInfo?.current}
        planName={planLimitInfo?.plan_name}
        onClose={() => setPlanModalOpen(false)}
        onUpgrade={() => {
          try { navigation.navigate('PlanSelection'); }
          catch { navigation.getParent()?.navigate('PlanSelection'); }
        }}
      />

      {/* Photo source picker — branded bottom sheet. Tapping the
          backdrop or Cancel dismisses; tapping an option closes the
          sheet first, then launches the picker on the next tick so
          the modal has time to unmount before the OS camera/gallery
          intent fires (Android will otherwise misroute focus). */}
      <Modal
        visible={photoPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setPhotoPickerOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Upload photo</Text>
            <Text style={styles.sheetSubtitle}>
              Choose how you'd like to add your photo.
            </Text>

            <TouchableOpacity
              style={styles.sheetOption}
              activeOpacity={0.8}
              onPress={() => {
                setPhotoPickerOpen(false);
                setTimeout(() => fromGallery(), 200);
              }}
            >
              <View style={[styles.sheetIconWrap, { backgroundColor: BRAND_SOFT }]}>
                <User size={20} color={BRAND} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptionTitle}>Choose from gallery</Text>
                <Text style={styles.sheetOptionSub}>Pick an existing photo</Text>
              </View>
              <ChevronRight size={18} color={TEXT_LIGHT} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetOption}
              activeOpacity={0.8}
              onPress={() => {
                setPhotoPickerOpen(false);
                setTimeout(() => fromCamera(), 200);
              }}
            >
              <View style={[styles.sheetIconWrap, { backgroundColor: BRAND_SOFT }]}>
                <Camera size={20} color={BRAND} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetOptionTitle}>Take a new photo</Text>
                <Text style={styles.sheetOptionSub}>Open your camera</Text>
              </View>
              <ChevronRight size={18} color={TEXT_LIGHT} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetCancel}
              activeOpacity={0.8}
              onPress={() => setPhotoPickerOpen(false)}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Reusable bits ────────────────────────────────────────────────────

// One line inside the Batch Summary card. Silently returns null when
// there's no value so the card never renders a blank row (keeps the
// student's confidence in the data — no "-" placeholders).
function SummaryRow({ label, value, emphasise, alwaysShow }) {
  // Silently hide any row without a value so the summary card never
  // renders an empty line — unless the caller explicitly asks us to
  // always show it (e.g. Fee, which needs to display "Free" when the
  // course has no price).
  if (!alwaysShow
      && (value === null || value === undefined || value === '' || value === 0)) {
    return null;
  }
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[styles.summaryValue, emphasise && styles.summaryValueEmphasise]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

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

// Inline dropdown — tap the trigger, options unfold right below it
// (no modal, no bottom sheet). Used for Blood Group, Belt Category,
// and any other single-select short list where the picker should sit
// in-place. The leading `icon` prop is optional; pass any lucide icon
// to tint the trigger row, or omit for a plain text trigger. Long
// lists scroll inside the panel via `maxPanelHeight`.
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

  // ── Photo picker bottom sheet ─────────────────────────────────────
  // Slides up from the bottom (fade transition + backdrop). Two big
  // touch targets for Gallery and Camera, plus a Cancel row.
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 4,
    backgroundColor: BORDER,
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginBottom: 14,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    marginBottom: 10,
  },
  sheetIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
    marginBottom: 2,
  },
  sheetOptionSub: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  sheetCancel: {
    marginTop: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
  },

  // ── Batch summary card (student mode only) ────────────────────────
  // Renders the Institution / Branch / Course / Batch / Trainer /
  // Schedule / Duration / Fee / Start Date at the top of the form so
  // the student can confirm what they picked before typing anything.
  summaryCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 14,
  },
  summaryHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  summaryLabel: {
    flex: 0.9,
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: '700',
  },
  summaryValue: {
    flex: 1.6,
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
    textAlign: 'right',
  },
  summaryValueEmphasise: {
    color: BRAND,
    fontWeight: '800',
    fontSize: 14,
  },

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

  // Dropdown — trigger row + inline expanding panel for short
  // single-select lists like Blood Group. The panel pops up directly
  // beneath the trigger and only takes as much room as it needs.
  dropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  // Visual cue that the panel is open — flatten the bottom corners so the
  // trigger reads as the lid of the dropdown panel below.
  dropdownTriggerOpen: {
    borderColor: BRAND,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },
  dropdownPlaceholder: { color: TEXT_LIGHT, fontWeight: '500' },

  // Inline panel that opens below the trigger
  dropdownPanel: {
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BRAND,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 4,
    // Subtle shadow so it visibly lifts above the next form field.
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 14,
  },
  dropdownItemActive: { backgroundColor: BRAND_SOFT },
  dropdownItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  dropdownItemTextActive: { color: BRAND, fontWeight: '800' },

  // Payment-mode chips (admin only) — slightly larger than the belt
  // chips because there are only four and they benefit from breathing
  // room on a key decision field.
  payModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  payModeChip: {
    paddingHorizontal: 16, paddingVertical: 11,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1.5, borderColor: BORDER,
    minWidth: 90, alignItems: 'center',
  },
  payModeChipActive: {
    backgroundColor: BRAND_SOFT,
    borderColor: BRAND,
  },
  payModeChipText: { fontSize: 13, color: TEXT, fontWeight: '700' },
  payModeChipTextActive: { color: BRAND, fontWeight: '800' },

  // Enable Payment Link toggle — sits above the payment-mode / link
  // preview sections. Card layout keeps the label + hint aligned and
  // the toggle pill anchored to the right.
  linkToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  linkToggleTitle: { fontSize: 14, fontWeight: '800', color: TEXT },
  linkToggleHint: {
    fontSize: 11, color: TEXT_MUTED, marginTop: 3, lineHeight: 15,
    fontWeight: '600',
  },
  linkTogglePill: {
    width: 40, height: 22, borderRadius: 999,
    backgroundColor: BORDER,
    padding: 2,
    justifyContent: 'center',
  },
  linkTogglePillActive: { backgroundColor: BRAND },
  linkTogglePillDot: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: SURFACE,
  },
  linkTogglePillDotActive: {
    transform: [{ translateX: 18 }],
  },
  linkPreview: {
    backgroundColor: BG,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  linkPreviewText: {
    fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic', fontWeight: '600',
  },

  // Sticky bottom action bar — Cancel on the left, primary submit on
  // the right.
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
