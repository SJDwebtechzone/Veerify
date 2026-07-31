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
//   - Upload Certificate (PDF only, max 1 MB — mandatory)
//   - Academy Name (auto-populated from the admin's institution, read-only)
//   - Govt Proof Type (chip select: Aadhaar / PAN / Driving License / Voter ID / Passport)
//   - Govt Proof Number
//   - Bio (free text)
//
// New columns live on the `trainers` table (migration 016). Photo and
// certificate uploads land on /api/uploads.

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Camera, FileText, Plus, X, User, Mail, Phone, Lock,
  IdCard, Building, Award, Calendar, Briefcase, ShieldCheck,
  ExternalLink, ChevronDown, Check, Trash2,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
// Lazy-require the document picker. Same try/catch pattern as the
// institution setup wizard so this screen still mounts on builds
// where the native module isn't linked yet.
let DocPicker = null;
try {
  const mod = require('@react-native-documents/picker');
  DocPicker = (mod && mod.default) || mod || null;
} catch (_) { DocPicker = null; }

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import DateField from '../../components/DateField';
import PasswordInput from '../../components/PasswordInput';
import { useAuth } from '../../context/AuthContext';
import PlanLimitModal from '../../components/PlanLimitModal';
import { confirm } from '../../components/ConfirmDialog';

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

// Dropdown options for the Skill / Specialization field. Single-select —
// the trainer picks one discipline. Yoga + Tamil traditional arts are
// included alongside the combat disciplines so wellness- and
// tradition-focused trainers can register.
const SKILL_SUGGESTIONS = [
  'Karate', 'Silambam', 'Kalaripayattu', 'Adimurai',
  'Taekwondo', 'Boxing', 'Muay Thai',
  'BJJ', 'Judo', 'Kung Fu', 'MMA', 'Self Defense', 'Yoga',
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

export default function CreateTrainerScreen({ navigation, route }) {
  // Edit mode is triggered by passing { trainer } in the route params.
  // When present we pre-fill the form, hide the password block, swap
  // the title + CTA copy, and PUT instead of POST on submit.
  const editingTrainer = route?.params?.trainer || null;
  const isEditing = !!editingTrainer;

  // Academy name — three-source cascade so the field is populated the
  // moment the screen mounts, never showing "Loading…" or the generic
  // "Your academy" placeholder for a logged-in admin:
  //   1. useAuth().institution.name — the freshly-cached institution row
  //      from /onboarding/my-status (admins only, set on login/resume).
  //   2. useAuth().user.institution_name — from the login response
  //      (backend just started emitting it).
  //   3. /institutions/me/details fetch — refreshes silently underneath
  //      so a mid-session rename via Academy Profile still lands here.
  const { user, institution } = useAuth();
  const cachedAcademyName =
    institution?.name ||
    institution?.brand_name ||
    user?.institution_name ||
    '';

  const [academyName, setAcademyName] = useState(cachedAcademyName);
  // Show "Loading…" only when we have nothing to display. With a cached
  // name we render instantly; the fetch below silently overwrites the
  // state if a newer value comes back.
  const [academyLoading, setAcademyLoading] = useState(!cachedAcademyName);

  const [form, setForm] = useState({
    // Account
    name:  editingTrainer?.name  || '',
    email: editingTrainer?.email || '',
    phone: editingTrainer?.phone || '',
    password: '', // never pre-filled; only used in create mode
    // Personal
    gender:        editingTrainer?.gender || '',
    date_of_birth: editingTrainer?.date_of_birth
      ? String(editingTrainer.date_of_birth).slice(0, 10)
      : '',
    // Bio (freeform).
    bio:              editingTrainer?.bio || '',
    // Basic Salary (monthly, in ₹). Drives the read-only Basic Salary
    // field on Institution → More → Salary. Persisted on the trainers
    // profile; per-month deductions live on trainer_salaries rows.
    basic_salary:     editingTrainer?.basic_salary != null
      ? String(editingTrainer.basic_salary)
      : '',
    // Photo — URL only (no local URI for previously-saved uploads).
    photo_url:        editingTrainer?.photo_url || editingTrainer?.photo || editingTrainer?.profile_photo || editingTrainer?.user?.photo_url || '',
    photo_uri:        '',
    // Identity
    govt_proof_type:   editingTrainer?.govt_proof_type   || '',
    govt_proof_number: editingTrainer?.govt_proof_number || '',
  });
  const [submitting, setSubmitting] = useState(false);
  // Plan-limit modal state — populated from the 402 PLAN_LIMIT_REACHED
  // response body so the modal can show the real plan name + counts.
  const [planLimit, setPlanLimit] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // ── Skills (structured, multi-entry) ─────────────────────────────────
  // Every skill carries its own name, belt level, years of experience,
  // and PDF certificate. Prefill from editingTrainer.skills when the DB
  // has it; otherwise synthesize a single row from the legacy singleton
  // columns (specialization + belt_level + experience_years + certificate_url)
  // so older trainers land on a clean, editable form.
  const [skills, setSkills] = useState(() => {
    const raw = editingTrainer?.skills;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((s) => ({
        name:             s?.name || '',
        belt_level:       s?.belt_level || '',
        experience_years: s?.experience_years != null ? String(s.experience_years) : '',
        certificate_url:  s?.certificate_url || '',
        certificate_name: s?.certificate_url ? 'Certificate on file' : '',
        uploading:        false,
      }));
    }
    // Legacy fallback — one row per specialization entry, all sharing the
    // single belt / experience / certificate the row historically had.
    const legacySpec = typeof editingTrainer?.specialization === 'string'
      ? editingTrainer.specialization.split(',').map((s) => s.trim()).filter(Boolean)
      : (Array.isArray(editingTrainer?.specialization) ? editingTrainer.specialization : []);
    if (legacySpec.length > 0) {
      return legacySpec.map((name, i) => ({
        name,
        // Belt / experience / certificate only apply to the first row;
        // the rest start blank so the admin can fill them in.
        belt_level:       i === 0 ? (editingTrainer?.belt_level || '') : '',
        experience_years: i === 0 && editingTrainer?.experience_years != null
          ? String(editingTrainer.experience_years) : '',
        certificate_url:  i === 0 ? (editingTrainer?.certificate_url || '') : '',
        certificate_name: i === 0 && editingTrainer?.certificate_url ? 'Certificate on file' : '',
        uploading:        false,
      }));
    }
    // Fresh trainer → one empty row so the section isn't invisible.
    return [{ name: '', belt_level: '', experience_years: '', certificate_url: '', certificate_name: '', uploading: false }];
  });

  const patchSkill = (idx, patch) =>
    setSkills((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addSkill = () =>
    setSkills((prev) => [...prev, {
      name: '', belt_level: '', experience_years: '',
      certificate_url: '', certificate_name: '', uploading: false,
    }]);
  const removeSkill = (idx) => {
    if (skills.length <= 1) {
      // Never leave the section empty — reset the last row instead.
      setSkills([{ name: '', belt_level: '', experience_years: '', certificate_url: '', certificate_name: '', uploading: false }]);
      return;
    }
    confirm({
      title:       'Remove skill?',
      message:     `Remove "${skills[idx]?.name || 'this skill'}" from the trainer?`,
      variant:     'destructive',
      confirmText: 'Remove',
      cancelText:  'Cancel',
      onConfirm:   () => setSkills((prev) => prev.filter((_, i) => i !== idx)),
    });
  };

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // Refresh the admin's academy name from the server so a mid-session
  // rename via Academy Profile lands here too. Runs alongside the
  // cached value already showing, so the field never blanks out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/institutions/me/details');
        const inst = res.data?.institution || res.data;
        const nextName = inst?.name || inst?.brand_name || '';
        if (!cancelled && nextName) setAcademyName(nextName);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[CreateTrainer] academy name refresh failed:', err?.message);
      } finally {
        if (!cancelled) setAcademyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [photoError, setPhotoError] = useState(false);

  // Fetch latest trainer details when editing to ensure photo_url is up to date
  useEffect(() => {
    if (!isEditing || !editingTrainer?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get(`/trainers/${editingTrainer.id}`);
        const t = res.data?.trainer || res.data;
        if (!cancelled && t && t.photo_url) {
          setForm((prev) => ({
            ...prev,
            photo_url: t.photo_url || prev.photo_url,
          }));
        }
      } catch (err) {
        console.warn('[CreateTrainer] trainer details fetch failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [isEditing, editingTrainer?.id]);

  useEffect(() => {
    setPhotoError(false);
  }, [form.photo_uri, form.photo_url]);

  const displayPhotoUri = useMemo(() => {
    if (form.photo_uri) return form.photo_uri;
    if (form.photo_url) return resolveAssetUrl(form.photo_url);
    return null;
  }, [form.photo_uri, form.photo_url]);

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
    // Certificate uploads are PDF-only now (no Gallery / Camera fallback)
    // so we can guarantee a clean document for verification. Hand straight
    // off to the document picker.
    if (!DocPicker) {
      confirm({
        title:       'PDF picker not available',
        message:     'This build is missing the document picker module. Please update the app to upload a PDF certificate.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    fromDocument('cert');
  };

  // PDF / document picker — used for certificate uploads. Handles the
  // two API shapes the @react-native-documents/picker package has
  // shipped (pickSingle in v9, pick in v10+) so the screen works on
  // both. Falls back to uploadAsset which already serialises PDFs.
  const fromDocument = async (kind) => {
    if (!DocPicker) {
      confirm({
        title:       'PDF not supported',
        message:     'Document picker module is missing from this build. Use Gallery or Camera to take a photo of the certificate.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    try {
      // PDF-only filter — image/* removed since the spec now requires a
      // proper PDF certificate.
      const opts = { type: ['application/pdf'] };

      let file = null;
      if (typeof DocPicker.pickSingle === 'function') {
        // v9 API
        file = await DocPicker.pickSingle({ ...opts, copyTo: 'cachesDirectory' });
      } else if (typeof DocPicker.pick === 'function') {
        // v10+ API
        const res = await DocPicker.pick({ ...opts, allowMultiSelection: false });
        file = Array.isArray(res) ? res[0] : res;
      } else {
        confirm({
          title:       'PDF not supported',
          message:     'No compatible pick API found in the document picker module.',
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
        return;
      }
      if (!file) return;

      // Defensive MIME / extension check — some pickers report the wrong
      // type on Android, so we re-verify against the file extension too.
      const mime = (file.type || '').toLowerCase();
      const name = (file.name || '').toLowerCase();
      const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
      if (!isPdf) {
        confirm({
          title:       'PDF only',
          message:     'Please pick a PDF file. Other formats are not accepted for the certificate.',
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
        return;
      }

      // 1 MB size cap. The picker exposes the size in bytes via `file.size`
      // on every version we support.
      const MAX_BYTES = 1 * 1024 * 1024;
      if (typeof file.size === 'number' && file.size > MAX_BYTES) {
        const mb = (file.size / (1024 * 1024)).toFixed(2);
        confirm({
          title:       'File too large',
          message:     `Certificate must be under 1 MB. Your file is ${mb} MB — please compress it and try again.`,
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
        return;
      }

      uploadAsset({
        uri:      file.fileCopyUri || file.uri,
        type:     'application/pdf',
        fileName: file.name || 'certificate.pdf',
      }, kind);
    } catch (err) {
      // Cancellations come through with different shapes per version
      // (an isCancel helper on v9, code OPERATION_CANCELED on v10).
      const isCancel =
        (typeof DocPicker.isCancel === 'function' && DocPicker.isCancel(err)) ||
        err?.code === 'OPERATION_CANCELED' ||
        err?.code === 'DOCUMENT_PICKER_CANCELED' ||
        err?.message?.toLowerCase().includes('cancel');
      if (!isCancel) {
        confirm({
          title:       'Picker error',
          message:     err?.message || 'Could not pick the document.',
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
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

  // uploadAsset — routes uploads to one of three destinations:
  //   kind === 'photo'                → the trainer's profile photo
  //   kind starts with 'skillCert:'   → a specific skill row's certificate
  //                                     (kind carries the index, e.g. 'skillCert:2')
  //   any other value                 → legacy top-level certificate slot
  //                                     (kept for backward compatibility)
  const uploadAsset = async (asset, kind) => {
    const isPhoto        = kind === 'photo';
    const skillCertMatch = typeof kind === 'string' && kind.startsWith('skillCert:')
      ? parseInt(kind.slice('skillCert:'.length), 10)
      : NaN;
    const isSkillCert    = Number.isFinite(skillCertMatch);

    if (isPhoto) {
      set('photo_uri', asset.uri);
      setUploadingPhoto(true);
    } else if (isSkillCert) {
      patchSkill(skillCertMatch, { uploading: true });
    }

    try {
      const fd = new FormData();
      // Infer a sensible mime/name fallback per slot. Photos default
      // to JPEG; certificates default to PDF so a document picker that
      // somehow returns no type still serialises correctly.
      const defaultType = isPhoto ? 'image/jpeg' : 'application/pdf';
      const defaultName = isPhoto ? 'photo.jpg' : 'certificate.pdf';
      fd.append('file', {
        uri: asset.uri,
        type: asset.type || defaultType,
        name: asset.fileName || defaultName,
      });
      const hintName = (form.name || 'trainer').trim();
      const hintKind = isPhoto ? 'photo' : 'certificate';
      const hint = encodeURIComponent(`${hintName}-${hintKind}`);
      const resp = await apiClient.post(`/uploads?name_hint=${hint}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const storedUrl = resp.data.path || resp.data.url;

      if (isPhoto) {
        set('photo_url', storedUrl);
      } else if (isSkillCert) {
        patchSkill(skillCertMatch, {
          certificate_url:  storedUrl,
          certificate_name: asset.fileName || 'Certificate',
        });
      }
    } catch (err) {
      confirm({
        title:       'Upload failed',
        message:     'Please try again with a smaller file.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      if (isPhoto) set('photo_uri', '');
    } finally {
      if (isPhoto) setUploadingPhoto(false);
      else if (isSkillCert) patchSkill(skillCertMatch, { uploading: false });
    }
  };

  // Trigger a PDF picker for a specific skill row.
  const pickCertForSkill = (idx) => {
    if (!DocPicker) {
      confirm({
        title:       'PDF picker not available',
        message:     'This build is missing the document picker module. Please update the app to upload a PDF certificate.',
        variant:     'warning',
        confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    fromDocument(`skillCert:${idx}`);
  };

  // Close-handles for inline dropdowns. Each dropdown binds its close fn
  // into one of these refs via useEffect; the ScrollView's onScroll fires
  // them all so any open panel collapses the moment the trainer-admin
  // starts scrolling toward the next field.
  const skillCloseRef = useRef(null);
  const proofCloseRef = useRef(null);

  // ── Validation ───────────────────────────────────────────────────────
  const validate = () => {
    if (!form.name?.trim()) return 'Trainer name is required';
    // Email is now editable in BOTH modes. Always required + format-check.
    if (!form.email?.trim()) return 'Email is required';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'Please enter a valid email';
    if (!isEditing) {
      // Password is only collected on creation. In edit mode the
      // password stays untouched (admin uses the "Change Password"
      // flow separately if they need to rotate it).
      if (!form.password) return 'Temporary password is required';
      if (form.password.length < 6) return 'Password must be at least 6 characters';
    }
    if (form.phone && form.phone.length < 10) {
      return 'Please enter a valid phone number (or leave it blank)';
    }
    // Every skill row that has a name must also have belt / experience /
    // certificate — otherwise it's incomplete.
    const namedSkills = skills.filter((s) => s.name?.trim());
    if (namedSkills.length === 0) {
      return 'Please add at least one skill with a name.';
    }
    for (let i = 0; i < namedSkills.length; i++) {
      const s = namedSkills[i];
      if (s.experience_years && Number(s.experience_years) < 0) {
        return `Skill #${i + 1} — experience cannot be negative.`;
      }
      // Certificate is mandatory in PRODUCTION builds only. Skip when
      // __DEV__ so emulator smoke-tests aren't blocked by an empty
      // Files app.
      if (!__DEV__ && !s.certificate_url) {
        return `Skill #${i + 1} (${s.name}) — please upload the certificate (PDF, under 1 MB).`;
      }
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      // Styled card matches the rest of the app's validation dialogs
      // (Setup wizard, Enrollment form, Payment screen).
      confirm({
        title:       'Check this detail',
        message:     err,
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }

    setSubmitting(true);
    try {
      // Serialise the structured skills array. Backend re-derives the
      // legacy singleton columns from this on the server side, so we
      // don't need to send them anymore.
      const skillsPayload = skills
        .filter((s) => s.name?.trim())
        .map((s) => ({
          name:             s.name.trim(),
          belt_level:       s.belt_level?.trim() || null,
          experience_years: Number(s.experience_years) || 0,
          certificate_url:  s.certificate_url || null,
        }));

      if (isEditing) {
        // PUT /trainers/:id — email is now included. Password is still
        // handled separately (Change Password flow).
        await apiClient.put(`/trainers/${editingTrainer.id}`, {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          bio: form.bio.trim() || null,
          gender: form.gender || null,
          date_of_birth: form.date_of_birth || null,
          govt_proof_type: form.govt_proof_type || null,
          govt_proof_number: form.govt_proof_number.trim() || null,
          photo_url: form.photo_url || null,
          skills: skillsPayload,
          // Basic salary (empty string → keep existing on the server;
          // any number → overwrite). Handled by COALESCE upstream.
          basic_salary: form.basic_salary.trim() !== ''
            ? Number(form.basic_salary) || 0
            : undefined,
        });
        confirm({
          title:       'Changes saved',
          message:     `${form.name.trim()}'s profile has been updated.`,
          variant:     'success',
          confirmText: 'Done',
          hideCancel:  true,
          onConfirm:   () => navigation.goBack(),
        });
      } else {
        // POST /trainers - creates user + trainer in one transaction.
        // Structured skills replace the old singleton fields; backend
        // derives specialization / belt_level / experience_years /
        // certificate_url from the first entry for legacy consumers.
        await apiClient.post('/trainers', {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          password: form.password,
          bio: form.bio.trim() || null,
          gender: form.gender || null,
          date_of_birth: form.date_of_birth || null,
          govt_proof_type: form.govt_proof_type || null,
          govt_proof_number: form.govt_proof_number.trim() || null,
          photo_url: form.photo_url || null,
          skills: skillsPayload,
          basic_salary: form.basic_salary.trim() !== ''
            ? Number(form.basic_salary) || 0
            : 0,
        });
        confirm({
          title:       'Trainer added',
          message:     `${form.name.trim()} has been enrolled. Share the email + temporary password so they can sign in.`,
          variant:     'success',
          confirmText: 'Done',
          hideCancel:  true,
          onConfirm:   () => navigation.goBack(),
        });
      }
    } catch (e) {
      // Plan-limit reached? Show a richer prompt with a direct path to the
      // plan-selection / upgrade screen so the admin can act immediately
      // instead of being told a generic 'Error'.
      const body = e?.response?.data;
      if (e?.response?.status === 402 && body?.code === 'PLAN_LIMIT_REACHED') {
        // Show the styled in-app modal instead of a system Alert so the
        // explanation ("Your <Plan> plan limit is N trainers only") and
        // the upgrade CTA feel native.
        setPlanLimit({
          limit:    body.limit,
          current:  body.current,
          planName: body.plan_name,
        });
      } else {
        confirm({
          title:       isEditing ? 'Could not save changes' : 'Could not create trainer',
          message:     body?.message || (isEditing ? 'Try again in a moment.' : 'Try again in a moment.'),
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Initials for the photo placeholder ───────────────────────────────
  const initials = (form.name || ' ')
    .split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
    || '?';

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
          <Text style={styles.headerTitle}>
            {isEditing ? 'Edit Trainer' : 'Enroll Staff'}
          </Text>
          <Text style={styles.headerSub}>
            {isEditing
              ? `Update ${editingTrainer?.name || 'trainer'}\'s profile`
              : `Adds a trainer to ${academyLoading ? '…' : (academyName || 'your academy')}`}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // Close any open in-page dropdown the moment the user scrolls past
        // it. Each inline dropdown registers its close handle in its own
        // ref; we fire every registered handle on every scroll tick.
        onScroll={() => {
          skillCloseRef.current && skillCloseRef.current();
          proofCloseRef.current && proofCloseRef.current();
        }}
        scrollEventThrottle={64}
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
            ) : displayPhotoUri && !photoError ? (
              <Image
                source={{ uri: displayPhotoUri }}
                style={styles.photoImage}
                onError={() => setPhotoError(true)}
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

        {/* Email — editable in both create AND edit modes. When editing, the
            new address becomes the trainer's login id on their next sign-in
            (existing JWTs stay valid until expiry). Backend re-checks
            uniqueness against every other users row. */}
        <Field
          label="Email"
          required
          hint={isEditing
            ? 'Trainer will sign in with this email from now on. Uniqueness is checked on save.'
            : 'Trainer signs in with this email.'}
        >
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

        {/* Password is only for creation. */}
        {!isEditing ? (
          <Field label="Temporary Password" required hint="At least 6 characters. Share securely with the trainer.">
            <PasswordInput
              inputStyle={styles.input}
              placeholder="••••••"
              placeholderTextColor={TEXT_LIGHT}
              value={form.password}
              onChangeText={(v) => set('password', v)}
            />
          </Field>
        ) : null}

        {/* ── Section 3: Academy ── */}
        <SectionTitle icon={Building} title="Academy" />

        <Field label="Academy Name" hint="Trainers are enrolled under your current academy.">
          <View style={[styles.input, styles.readonlyChip]}>
            <Building size={14} color={BRAND} strokeWidth={2.2} />
            {/* Priority: real academy name → 'Loading…' only while we
                genuinely have nothing → fallback text for admins whose
                institution row somehow has no name set. */}
            <Text style={styles.readonlyChipText} numberOfLines={1}>
              {academyName
                ? academyName
                : academyLoading
                  ? 'Loading…'
                  : 'Your academy'}
            </Text>
          </View>
        </Field>

        {/* ── Section 4: Skills (repeatable) ─────────────────────────
            Each row is a self-contained skill: name, belt level, years,
            and a PDF certificate. Admin can Add / Remove rows freely;
            the backend persists the full array as JSONB and derives the
            legacy singleton columns from the first entry. */}
        <SectionTitle icon={Award} title={`Skills (${skills.length})`} />

        {skills.map((skill, idx) => (
          <View key={`skill-${idx}`} style={styles.skillCard}>
            <View style={styles.skillCardHead}>
              <View style={styles.skillCardBadge}>
                <Text style={styles.skillCardBadgeText}>#{idx + 1}</Text>
              </View>
              <Text style={styles.skillCardTitle} numberOfLines={1}>
                {skill.name?.trim() || 'New skill'}
              </Text>
              <TouchableOpacity
                onPress={() => removeSkill(idx)}
                style={styles.skillCardRemove}
                hitSlop={8}
              >
                <Trash2 size={14} color="#B91C1C" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            <Field label="Skill name" required>
              <TextInput
                style={styles.input}
                placeholder="e.g. Karate"
                placeholderTextColor={TEXT_LIGHT}
                value={skill.name}
                onChangeText={(v) => patchSkill(idx, { name: v })}
                maxLength={80}
              />
            </Field>

            <View style={styles.row}>
              <Field label="Belt level" style={{ flex: 1, marginRight: 8 }}>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Black Belt 3rd Dan"
                  placeholderTextColor={TEXT_LIGHT}
                  value={skill.belt_level}
                  onChangeText={(v) => patchSkill(idx, { belt_level: v })}
                />
              </Field>
              <Field label="Years" style={{ flex: 1, marginLeft: 8 }}>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={TEXT_LIGHT}
                  value={skill.experience_years}
                  onChangeText={(v) => patchSkill(idx, { experience_years: v.replace(/[^0-9]/g, '') })}
                  keyboardType="numeric"
                  maxLength={2}
                />
              </Field>
            </View>

            <Field label="Certificate" hint="PDF only · Up to 1 MB.">
              <TouchableOpacity
                style={[styles.upload, skill.certificate_url && styles.uploadDone]}
                onPress={() => pickCertForSkill(idx)}
                disabled={skill.uploading}
                activeOpacity={0.85}
              >
                {skill.uploading ? (
                  <ActivityIndicator color={BRAND} />
                ) : skill.certificate_url ? (
                  <>
                    <FileText size={26} color="#10B981" strokeWidth={2} />
                    <Text style={styles.uploadDoneText}>
                      {skill.certificate_name || 'Certificate'} uploaded
                    </Text>
                    <Text style={styles.uploadChangeText}>Tap to replace</Text>
                  </>
                ) : (
                  <>
                    <FileText size={26} color={BRAND} strokeWidth={2} />
                    <Text style={styles.uploadText}>Upload Certificate</Text>
                    <Text style={styles.uploadHint}>PDF only · Up to 1 MB</Text>
                  </>
                )}
              </TouchableOpacity>
            </Field>
          </View>
        ))}

        <TouchableOpacity
          style={styles.addSkillBtn}
          onPress={addSkill}
          activeOpacity={0.85}
        >
          <Text style={styles.addSkillBtnText}>+ Add another skill</Text>
        </TouchableOpacity>

        {/* ── Section 4: Identity ── */}
        <SectionTitle icon={ShieldCheck} title="Identity Verification" />

        <Field label="Govt Proof Type" hint="Pick the ID you'll verify with.">
          <ProofTypeDropdown
            options={GOVT_PROOF_TYPES}
            value={form.govt_proof_type}
            onPick={(v) => set('govt_proof_type', v)}
            closeRef={proofCloseRef}
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

        {/* ── Section 6: Salary ── */}
        {/* Monthly base pay. Read-only on the payroll screen, editable
            here. Deductions per month are captured on Institution →
            More → Salary and stored per-slip.
            Note: the section header was previously "Compensation" but
            the spec renames the user-facing wording to "Salary" for
            consistency with the inner field label. Data column stays
            `basic_salary` — this is a copy-only change. */}
        <SectionTitle icon={Briefcase} title="Salary" />
        <Field label="Basic Salary (per month, ₹)">
          <TextInput
            style={styles.input}
            placeholder="e.g. 25000"
            placeholderTextColor={TEXT_LIGHT}
            value={form.basic_salary}
            onChangeText={(v) => set('basic_salary', v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            maxLength={10}
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
            <Text style={styles.btnPrimaryText}>
              {isEditing ? 'Save Changes' : 'Enroll Trainer'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Plan-limit modal — fired when /trainers POST returns 402. */}
      <PlanLimitModal
        visible={!!planLimit}
        kind="trainer"
        limit={planLimit?.limit}
        current={planLimit?.current}
        planName={planLimit?.planName}
        onClose={() => setPlanLimit(null)}
        onUpgrade={() => {
          try { navigation.navigate('PlanSelection'); }
          catch { navigation.goBack(); }
        }}
      />
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

// SkillDropdown — multi-select inline dropdown for Skill / Specialization.
//
// Closed: trigger row shows the picked values joined by " · " (or a
//         placeholder if none picked) with a chevron.
// Open:   inline panel lists every option. Each tap toggles that option
//         on/off — the panel stays open so the trainer can pick several
//         disciplines (e.g. Karate + Yoga) in one go.
function SkillDropdown({ options, values, onToggle, closeRef }) {
  const [open, setOpen] = React.useState(false);
  const selected = Array.isArray(values) ? values : [];

  // Bind an imperative close-handle into the parent's ref. The parent's
  // ScrollView fires this on scroll so the panel collapses as soon as the
  // trainer-admin moves on to the next field, exactly like the Medium of
  // Instruction dropdown in the academy setup wizard.
  React.useEffect(() => {
    if (closeRef) closeRef.current = () => setOpen(false);
    return () => { if (closeRef) closeRef.current = null; };
  }, [closeRef]);
  const summary = selected.length === 0
    ? 'Select skill(s)…'
    : selected.join(' · ');

  return (
    <View>
      <TouchableOpacity
        style={[styles.input, styles.dropdownTrigger, open && styles.dropdownTriggerOpen]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.dropdownTriggerText,
            selected.length === 0 && styles.dropdownTriggerPlaceholder,
          ]}
          numberOfLines={1}
        >
          {summary}
        </Text>
        <ChevronDown
          size={16}
          color={TEXT_MUTED}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.dropdownPanel}>
          {options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.dropdownItem, on && styles.dropdownItemActive]}
                onPress={() => onToggle(opt)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    on && styles.dropdownItemTextActive,
                  ]}
                >
                  {opt}
                </Text>
                {on ? <Check size={14} color={BRAND} strokeWidth={2.8} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ProofTypeDropdown — single-select inline dropdown for Govt Proof Type.
//
// Closed: trigger row shows the picked proof type (or a placeholder).
// Open:   inline panel lists every option. Tapping one sets the value
//         and immediately collapses the panel (single-select pattern).
//
// closeRef wires the same scroll-to-dismiss behaviour the SkillDropdown
// uses — the parent ScrollView fires .current() on scroll.
function ProofTypeDropdown({ options, value, onPick, closeRef }) {
  const [open, setOpen] = React.useState(false);
  const placeholder = 'Select proof type…';

  React.useEffect(() => {
    if (closeRef) closeRef.current = () => setOpen(false);
    return () => { if (closeRef) closeRef.current = null; };
  }, [closeRef]);

  return (
    <View>
      <TouchableOpacity
        style={[styles.input, styles.dropdownTrigger, open && styles.dropdownTriggerOpen]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.dropdownTriggerText,
            !value && styles.dropdownTriggerPlaceholder,
          ]}
          numberOfLines={1}
        >
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
        <View style={styles.dropdownPanel}>
          {options.map((opt) => {
            const on = value === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.dropdownItem, on && styles.dropdownItemActive]}
                onPress={() => { onPick(opt); setOpen(false); }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    on && styles.dropdownItemTextActive,
                  ]}
                >
                  {opt}
                </Text>
                {on ? <Check size={14} color={BRAND} strokeWidth={2.8} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
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

  // SkillDropdown — single-select inline dropdown that replaced the old
  // free-text input + chips for Skill / Specialization.
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerOpen: { borderColor: BRAND },
  dropdownTriggerText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },
  dropdownTriggerPlaceholder: { color: TEXT_LIGHT, fontWeight: '500' },
  dropdownPanel: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  dropdownItemActive: { backgroundColor: '#FFF1F2' },
  dropdownItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  dropdownItemTextActive: { color: BRAND, fontWeight: '700' },

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

  // ── Skill card (repeatable row) ─────────────────────────────────
  skillCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 14,
    marginBottom: 12,
  },
  skillCardHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingBottom: 10, marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  skillCardBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
  },
  skillCardBadgeText: {
    fontSize: 10, fontWeight: '900', color: BRAND, letterSpacing: 0.4,
  },
  skillCardTitle: {
    flex: 1, fontSize: 14, fontWeight: '800', color: TEXT,
  },
  skillCardRemove: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },

  addSkillBtn: {
    marginTop: 4, marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center',
  },
  addSkillBtnText: {
    fontSize: 13, fontWeight: '800', color: BRAND, letterSpacing: 0.3,
  },

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
