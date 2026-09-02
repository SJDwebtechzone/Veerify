// src/screens/admin/CreateEventScreen.js
//
// Institution-admin "Create event" form. POSTs to /institutions/me/events,
// which writes a row to mobile_events scoped to the admin's own academy.
// The new event automatically renders on:
//
//   - Every linked student's Home tab (via /institutions/:id/events,
//     which now unions institution-scoped rows + global ones)
//   - Every linked trainer's home (via /institutions/me/events that the
//     trainer dashboard fetches on focus)
//
// Form mirrors the existing CMS events schema so super-admin curated rows
// and academy-created rows have the same shape.

import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, Modal, FlatList,
  Switch,
} from 'react-native';
import {
  ArrowLeft, Calendar, MapPin, Link as LinkIcon, Image as ImageIcon,
  Type, ChevronRight, X, CreditCard, Clock, Send, Check,
  Layers, Trash2, Plus, ChevronDown,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

// Reused upload helper — admins pick a photo from their gallery, we POST
// it to /uploads, and store only the returned relative path. Same flow
// the academy logo + course banner upload uses.
import { launchImageLibrary } from 'react-native-image-picker';
import resolveAssetUrl from '../../utils/assetUrl';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local theme tokens — names kept unchanged so every card / border
// / text style inherits the Institution Home look automatically.
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = HEADER_NAVY;
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = GLASS_FILL_STRONG;
const BG          = INSTITUTION_BG_BASE;
const BORDER      = GLASS_BORDER_LIGHT;

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const CreateEventCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    catBlock:    { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.textMuted },
    label:       { color: pal.textMuted },
  });
}

// Canonical categories the organiser can start from. "Other" opens
// a free-text field so events aimed at a custom bucket (e.g. "Sub-
// Junior Category") are still captured.
// Categories offered in the Category Name dropdown. Order is
// deliberate — youngest first — so age-appropriate options appear at
// the top of the picker. "Sub-Junior" was added per product spec to
// cover younger participants that did not fit under "Junior".
const CATEGORY_OPTIONS = [
  'Sub-Junior Category',
  'Junior Category',
  'Senior Category',
  'Other',
];

// Age range the From / To dropdowns choose from. Covers everyone from
// young beginners through adult / senior players. Stored as strings so
// dropdown equality is trivial.
const AGE_OPTIONS = Array.from({ length: 77 }, (_, i) => String(i + 4)); // 4 … 80

// Gender bucket for each category. Kept as an explicit list — no
// "Other" for now, per product spec — so the picker is unambiguous
// and the stored value maps 1:1 to what the registrant sees.
const GENDER_OPTIONS = ['Male', 'Female'];

import RegistrationFormBuilder from '../../components/RegistrationFormBuilder';

export default function CreateEventScreen({ navigation, route }) {
  // Edit mode. Set when the caller (EventsList "Edit event" button on
  // pending Inter-Level events) passes an existing event blob via
  // route.params.editEvent. In edit mode we PUT to the existing row
  // instead of POSTing a new one and the header/CTA copy switches
  // to reflect that this is an edit.
  const editEvent = route?.params?.editEvent || null;
  const isEdit    = !!editEvent && Number.isFinite(Number(editEvent.id));

  // Event-type is chosen upstream by the "Select Event Type" modal
  // launched from the Dashboard's Add Event tile. Missing / unknown
  // values collapse to 'inter' so the historical direct-navigation
  // path (no modal) still works exactly as before. In edit mode we
  // pin to the existing row's event_type so an accidental route-param
  // mismatch can't flip the row's type.
  const eventType = isEdit
    ? (editEvent.event_type === 'intra' ? 'intra' : 'inter')
    : (route?.params?.eventType === 'intra' ? 'intra' : 'inter');

  // MODULE 1: Registration Form definition. Kept as sibling state
  // rather than merged into `form` so the existing event-creation
  // POST body stays unchanged — the definition is persisted via a
  // separate PUT after the event row has been created (see the
  // submit handler below).
  const [regForm, setRegForm] = useState({ enabled: false, fields: [] });
  // Seed form state — in create mode everything is blank; in edit
  // mode we hydrate from the existing event blob so the fields
  // already show what the admin previously entered. `publish_at` is
  // a full ISO string from the backend; we split it into a date +
  // time pair so the existing DateField / time picker UI keeps
  // working unchanged.
  const [form, setForm] = useState(() => {
    if (!isEdit) {
      return {
        title: '', subtitle: '', description: '',
        event_date: '', event_time: '',
        registration_closing_date: '',
        location: '', image_url: '', image_uri: '', link: '',
        payment_required: false, payment_amount: '',
        publish_mode: 'now', publish_date: '', publish_time: '',
      };
    }
    // Split publish_at (ISO) into date + HH:mm parts if scheduled.
    let pubDate = '', pubTime = '', pubMode = 'now';
    if (editEvent.publish_at) {
      const d = new Date(editEvent.publish_at);
      if (!Number.isNaN(d.getTime())) {
        pubMode = 'later';
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = String(d.getDate()).padStart(2, '0');
        pubDate = `${yyyy}-${mm}-${dd}`;
        pubTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    // event_date from DB may come back as 'YYYY-MM-DD' or an ISO
    // timestamp — normalise to the date-only string DateField expects.
    const normaliseDate = (v) => {
      if (!v) return '';
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return {
      title:                     editEvent.title || '',
      subtitle:                  editEvent.subtitle || '',
      description:               editEvent.description || '',
      event_date:                normaliseDate(editEvent.event_date),
      event_time:                editEvent.event_time || '',
      registration_closing_date: normaliseDate(editEvent.registration_closing_date),
      location:                  editEvent.location || '',
      image_url:                 editEvent.image_url || '',
      image_uri:                 '',
      link:                      editEvent.link || '',
      payment_required:          !!editEvent.payment_required,
      payment_amount:            editEvent.payment_amount != null ? String(editEvent.payment_amount) : '',
      publish_mode:              pubMode,
      publish_date:              pubDate,
      publish_time:              pubTime,
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Time picker is shared between the Event Time field and the
  // Publish Time field — `timeTarget` records which one launched it
  // so the modal writes back to the right key.
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState(null); // 'event' | 'publish'

  // Skills catalog for the Categories & Skills dropdown. Sourced
  // from TWO places and merged so the picker shows every skill the
  // organiser could reasonably assign to an event:
  //
  //   1. GET /api/config/enums → { skills: [...] }
  //      The canonical martial-arts catalog that BACKS the Academy
  //      Registration Setup Form's multi-select chips. This is the
  //      single source of truth — the same array powers Setup, the
  //      Web Admin trainer filters, and the Student enrolment form.
  //
  //   2. GET /api/institutions/me/details → institution.skills
  //      The subset the admin actually ticked during Setup, plus any
  //      custom entries they typed into the "Other" free-text row on
  //      the setup wizard (which get folded into `institution.skills`
  //      alongside the ticked chips on submit).
  //
  // Merging both means:
  //   • Every canonical option appears (16 built-ins today), even for
  //     an academy that only ticked 2 during setup — the organiser
  //     can still assign any discipline to an event.
  //   • Custom disciplines the academy added via "Other" also appear.
  //   • Deduped case-insensitively so a canonical "Karate" and a
  //     custom "karate" don't render twice.
  const [instSkills,   setInstSkills]   = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError,   setSkillsError]   = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSkillsLoading(true);
      setSkillsError(null);
      try {
        // Fire both in parallel — either can fail independently and
        // we still surface whatever came back so the organiser is
        // never stuck with an empty picker.
        const [enumsRes, detailsRes] = await Promise.allSettled([
          apiClient.get('/config/enums'),
          apiClient.get('/institutions/me/details'),
        ]);
        if (cancelled) return;

        const canonical = enumsRes.status === 'fulfilled'
          ? (Array.isArray(enumsRes.value?.data?.skills) ? enumsRes.value.data.skills : [])
          : [];
        const owned = detailsRes.status === 'fulfilled'
          ? (Array.isArray(detailsRes.value?.data?.institution?.skills)
              ? detailsRes.value.data.institution.skills
              : [])
          : [];

        // Merge + dedupe case-insensitively. Canonical order first
        // (matches Setup Form order), then any custom-typed extras
        // the academy added on top.
        const seen = new Set();
        const merged = [];
        [...canonical, ...owned].forEach((raw) => {
          const s = String(raw || '').trim();
          if (!s) return;
          const key = s.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(s);
        });

        setInstSkills(merged);
        // Both endpoints failed AND the merge came back empty →
        // surface an error so the empty state renders a hint.
        if (
          merged.length === 0
          && enumsRes.status === 'rejected'
          && detailsRes.status === 'rejected'
        ) {
          setSkillsError('Could not load skills. Check your connection.');
        }
      } catch (err) {
        if (cancelled) return;
        setSkillsError(err?.response?.data?.message || err?.message || 'Could not load skills.');
      } finally {
        if (!cancelled) setSkillsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Hydrate the Registration Form in edit mode ─────────────────
  // Only runs once, when editing. We fetch the previously-saved
  // registration form definition so the builder toggle + field
  // rows come back exactly as the organiser left them. Failure is
  // soft — an empty form just means the organiser can start fresh.
  useEffect(() => {
    if (!isEdit) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiClient.get(`/events/${editEvent.id}/registration-form`);
        if (cancelled) return;
        const fields = Array.isArray(r.data?.fields)
          ? r.data.fields.map((f) => ({
              // Keep the wire shape the builder + submit expect.
              sourceType: f.sourceType || (f.sourceKey ? 'student' : 'custom'),
              sourceKey:  f.sourceKey || null,
              label:      f.label,
              type:       f.type,
              required:   !!f.required,
              options:    Array.isArray(f.options) ? f.options : null,
              sortOrder:  f.sortOrder,
            }))
          : [];
        setRegForm({ enabled: !!r.data?.enabled, fields });
      } catch (err) {
        // Not fatal — the builder just starts blank. Log for
        // debugging so we know if the fetch went sideways.
        console.warn('[CreateEvent/edit] registration-form fetch failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, editEvent?.id]);

  // ── Categories & Skills state ────────────────────────────────────
  // Structure:
  //   categories: [
  //     {
  //       id: string,               // stable local id for React keys
  //       name: string,             // 'Junior Category' | 'Senior Category' | 'Other'
  //       customName: string,       // only used when name === 'Other'
  //       skills: [
  //         {
  //           id: string,
  //           name: string,         // one of instSkills[] | 'Other'
  //           customName: string,   // only when name === 'Other'
  //           ageFrom: string,      // '4' … '80' from AGE_OPTIONS
  //           ageTo:   string,
  //         }
  //       ]
  //     }
  //   ]
  const nextIdRef = useRef(1);
  const nextId = () => String(nextIdRef.current++);
  // Seed categories from the existing event when editing. Every
  // category and skill needs a local `id` for React keys, and every
  // skill needs a `divisions` array (older rows may lack it). The
  // persisted shape uses `age_from` / `age_to`; the UI uses camel
  // case, so we translate here so the dropdowns pre-select correctly.
  const [categories, setCategories] = useState(() => {
    if (!isEdit || !Array.isArray(editEvent.categories)) return [];
    return editEvent.categories.map((c) => ({
      id:         nextIdRef.current++ + '',
      name:       c?.name || 'Junior Category',
      customName: '',
      gender:     c?.gender === 'Female' ? 'Female' : 'Male',
      skills: Array.isArray(c?.skills) ? c.skills.map((s) => ({
        id:         nextIdRef.current++ + '',
        name:       s?.name || 'Other',
        customName: '',
        ageFrom:    s?.age_from != null ? String(s.age_from) : '',
        ageTo:      s?.age_to   != null ? String(s.age_to)   : '',
        divisions:  Array.isArray(s?.divisions)
          ? s.divisions.map((d) => ({ id: nextIdRef.current++ + '', name: d?.name || '' }))
          : [],
      })) : [],
    }));
  });

  const addCategory = () => {
    setCategories((prev) => [
      ...prev,
      {
        id:         nextId(),
        name:       'Junior Category',
        customName: '',
        // Gender for the category — defaults to 'Male' so new blocks
        // always carry a valid persisted value even if the organiser
        // never touches the dropdown.
        gender:     'Male',
        skills:     [{ id: nextId(), name: instSkills[0] || 'Other', customName: '', ageFrom: '', ageTo: '', divisions: [] }],
      },
    ]);
  };
  const updateCategory = (id, patch) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeCategory = (id) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };
  const addSkillToCategory = (categoryId) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? { ...c, skills: [...c.skills, { id: nextId(), name: instSkills[0] || 'Other', customName: '', ageFrom: '', ageTo: '', divisions: [] }] }
        : c
    )));
  };
  const updateSkill = (categoryId, skillId, patch) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? { ...c, skills: c.skills.map((s) => (s.id === skillId ? { ...s, ...patch } : s)) }
        : c
    )));
  };
  const removeSkill = (categoryId, skillId) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? { ...c, skills: c.skills.filter((s) => s.id !== skillId) }
        : c
    )));
  };

  // ── Divisions (per-skill) ────────────────────────────────────────
  // Each skill can have zero or more free-text divisions (e.g.
  // "Division A / Division B / Division C" under Karate). Kept as a
  // separate `divisions: [{ id, name }]` array on the skill so it
  // rides along inside the existing categories JSONB blob without
  // needing a schema change — the whole categories tree is stored
  // as-is on the event row.
  const addDivision = (categoryId, skillId) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? {
            ...c,
            skills: c.skills.map((s) => (
              s.id === skillId
                ? { ...s, divisions: [...(s.divisions || []), { id: nextId(), name: '' }] }
                : s
            )),
          }
        : c
    )));
  };
  const updateDivision = (categoryId, skillId, divisionId, name) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? {
            ...c,
            skills: c.skills.map((s) => (
              s.id === skillId
                ? {
                    ...s,
                    divisions: (s.divisions || []).map((d) => (
                      d.id === divisionId ? { ...d, name } : d
                    )),
                  }
                : s
            )),
          }
        : c
    )));
  };
  const removeDivision = (categoryId, skillId, divisionId) => {
    setCategories((prev) => prev.map((c) => (
      c.id === categoryId
        ? {
            ...c,
            skills: c.skills.map((s) => (
              s.id === skillId
                ? { ...s, divisions: (s.divisions || []).filter((d) => d.id !== divisionId) }
                : s
            )),
          }
        : c
    )));
  };

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // ── Image picker — uploads on pick, stashes the path on success ──
  const pickEventImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.85,
        selectionLimit: 1,
      });
      if (result.didCancel) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setUploadingImage(true);
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'event.jpg',
      });
      const hint = (form.title || 'event').trim();
      const res = await apiClient.post(
        `/uploads?name_hint=${encodeURIComponent(hint)}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const stored = res.data?.path || res.data?.url || '';
      setForm((p) => ({ ...p, image_url: stored, image_uri: asset.uri }));
    } catch (err) {
      Alert.alert('Upload failed', err.response?.data?.message || err.message);
    } finally {
      setUploadingImage(false);
    }
  };

  // ── Schedule helper ─────────────────────────────────────────────────
  // Combine publish_date + publish_time into an ISO string. Returns null
  // when the mode is 'now' or the pieces are missing. The backend
  // coerces past timestamps to NULL, so a slightly-past minute is fine.
  const publishAtIso = () => {
    if (form.publish_mode !== 'later') return null;
    if (!form.publish_date || !form.publish_time) return null;
    const [h, m] = form.publish_time.split(':').map((n) => parseInt(n, 10));
    const [y, mo, d] = form.publish_date.split('-').map((n) => parseInt(n, 10));
    if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(m)) return null;
    // Local time — new Date() with local components then toISOString()
    // produces the correct UTC-anchored moment on the wire.
    const dt = new Date(y, mo - 1, d, h, m, 0, 0);
    return dt.toISOString();
  };

  // ── Validation + submit ─────────────────────────────────────────────
  const submit = async () => {
    if (!form.title.trim()) {
      confirm({
        title: 'Title required',
        message: 'Please give the event a title.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    if (!form.event_date) {
      confirm({
        title: 'Event date required',
        message: 'Please pick a date for the event.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
      });
      return;
    }

    // Payment gate — fee amount becomes mandatory when the toggle is on.
    let feeNumber = null;
    if (form.payment_required) {
      const raw = String(form.payment_amount || '').trim();
      feeNumber = Number(raw);
      if (!raw || !Number.isFinite(feeNumber) || feeNumber <= 0) {
        confirm({
          title: 'Amount required',
          message: 'Enter a positive fee amount (₹), or turn Payment Required off.',
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
      if (feeNumber < 1) {
        confirm({
          title: 'Amount too small',
          message: 'Minimum fee is ₹1.',
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
    }

    // Schedule mode — both date and time must be picked, and the combined
    // moment must be in the future.
    let publish_at = null;
    if (form.publish_mode === 'later') {
      if (!form.publish_date || !form.publish_time) {
        confirm({
          title: 'Schedule incomplete',
          message: 'Pick both a date and a time to schedule the event.',
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
      publish_at = publishAtIso();
      if (!publish_at) {
        confirm({
          title: 'Invalid schedule',
          message: 'Please pick a valid date and time.',
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
      if (new Date(publish_at).getTime() <= Date.now()) {
        confirm({
          title: 'Schedule in the past',
          message: 'Pick a time in the future, or use Post Now.',
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
    }

    // Normalise the categories payload: strip empty rows, resolve
    // "Other" custom names, and drop skills with no name so the
    // organiser can leave partially-filled rows sitting in the UI
    // without polluting the persisted event.
    const normalizedCategories = (categories || [])
      .map((c) => ({
        name: c.name === 'Other' ? (c.customName || '').trim() : c.name,
        // Persisted alongside the category — kept simple ('Male' /
        // 'Female') and defaulted to 'Male' if somehow blank so the
        // stored blob always has a value to render on the detail view.
        gender: c.gender === 'Female' ? 'Female' : 'Male',
        skills: (c.skills || [])
          .map((s) => ({
            name:    s.name === 'Other' ? (s.customName || '').trim() : s.name,
            age_from: s.ageFrom ? Number(s.ageFrom) : null,
            age_to:   s.ageTo   ? Number(s.ageTo)   : null,
            // Divisions ride along inside each skill. Empty rows are
            // stripped so a half-filled "+ Add Division" row the
            // organiser abandoned doesn't pollute the saved event.
            divisions: (s.divisions || [])
              .map((d) => ({ name: (d.name || '').trim() }))
              .filter((d) => d.name),
          }))
          .filter((s) => s.name),
      }))
      .filter((c) => c.name && c.skills.length > 0);

    setSubmitting(true);
    try {
      // Shared payload for create + edit. `event_type` is only sent
      // on create (the backend pins it at row level and won't accept
      // a mid-life change anyway).
      const payload = {
        title:                      form.title.trim(),
        subtitle:                   form.subtitle.trim() || null,
        description:                form.description.trim() || null,
        event_date:                 form.event_date,
        // Optional start-time (HH:mm 24h). Sent alongside the date so
        // downstream consumers can render "When" as a single line.
        event_time:                 form.event_time || null,
        registration_closing_date:  form.registration_closing_date || null,
        location:                   form.location.trim() || null,
        image_url:                  form.image_url || null,
        // Location Link (renamed on the UI; wire key stays `link` so
        // the backend + existing consumers don't need changes).
        link:                       form.link.trim() || null,
        // Categories × skills × age range. Backend may store or ignore
        // this block; the mobile form persists the full structure so
        // downstream features can consume it when available.
        categories:                 normalizedCategories,
        payment_required:           !!form.payment_required,
        payment_amount:             form.payment_required ? feeNumber : null,
        publish_at,
      };
      const res = isEdit
        ? await apiClient.put(`/institutions/me/events/${editEvent.id}`, payload)
        : await apiClient.post('/institutions/me/events', {
            ...payload,
            // 'inter' → institution-local, publishes immediately
            // (existing behaviour). 'intra' → cross-institution,
            // parks at Pending Approval on the backend until a
            // super-admin reviews it.
            event_type: eventType,
          });

      // MODULE 1: persist the Registration Form definition (if the
      // organizer configured one). Wrapped in try/catch so a form
      // save blip never rolls back the already-created event.
      const createdEventId = res.data?.event?.id || res.data?.id || (isEdit ? editEvent.id : null);
      if (createdEventId && regForm && (regForm.enabled || (regForm.fields || []).length > 0)) {
        try {
          await apiClient.put(`/events/${createdEventId}/registration-form`, {
            enabled: !!regForm.enabled,
            fields:  regForm.fields || [],
          });
        } catch (err) {
          console.warn('[event/create] registration-form save failed:', err?.response?.data?.message || err.message);
        }
      }
      const scheduled = form.publish_mode === 'later';

      // Intra-Level events always land on the super-admin approval
      // queue, so we ALWAYS show the "pending" confirmation regardless
      // of publish_mode (schedule doesn't apply until an approver
      // green-lights the event).
      if (eventType === 'intra') {
        confirm({
          title:   isEdit ? 'Event updated' : 'Event approval is pending',
          message: isEdit
            ? 'Your changes have been saved. The event stays awaiting approval — the platform reviewer will see the latest values.'
            : 'Your event has been submitted for approval. Once approved, it will be promoted to all institutions. You will be acknowledged within 24 hours.',
          variant: 'info', confirmText: 'OK', hideCancel: true,
          onConfirm: () => navigation.goBack(),
        });
      } else {
        confirm({
          title: scheduled ? 'Event scheduled' : 'Event published',
          message:
            res.data?.message ||
            (scheduled
              ? 'Your students and trainers will see it when the scheduled time arrives.'
              : 'Your students and trainers will see it on their home screen.'),
          variant: 'success', confirmText: 'OK', hideCancel: true,
          onConfirm: () => navigation.goBack(),
        });
      }
    } catch (err) {
      Alert.alert('Failed', err.response?.data?.message || err.message || 'Could not save event.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────
  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <CreateEventCtx.Provider value={{ isDark, dark }}>
    <KeyboardAvoidingView
      style={[styles.screen, isDark && dark.screen]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Institution Home ambient wash. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} activeOpacity={0.7}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>{isEdit ? 'Edit Event' : 'Create Event'}</Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>
            {isEdit
              ? 'Stays awaiting approval after you save.'
              : 'Visible to all Institutions, Students & Trainers'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        <Field label="Event banner" hint="A square or wide image works best. Optional.">
          <TouchableOpacity
            style={styles.imagePicker}
            onPress={pickEventImage}
            activeOpacity={0.85}
            disabled={uploadingImage}
          >
            {uploadingImage ? (
              <ActivityIndicator color={BRAND} />
            ) : form.image_uri || form.image_url ? (
              <>
                <Image
                  source={{ uri: form.image_uri || resolveAssetUrl(form.image_url) }}
                  style={styles.imagePreview}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={styles.imageRemove}
                  onPress={() => setForm((p) => ({ ...p, image_url: '', image_uri: '' }))}
                  hitSlop={8}
                >
                  <X size={14} color="#fff" strokeWidth={2.4} />
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <ImageIcon size={28} color={TEXT_LIGHT} strokeWidth={2} />
                <Text style={styles.imagePlaceholderText}>Tap to add a banner</Text>
              </View>
            )}
          </TouchableOpacity>
        </Field>

        {/* Title */}
        <Field label="Title *">
          <TextInput
            style={styles.input}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            placeholder="e.g. Annual Belt Grading 2026"
            placeholderTextColor={TEXT_LIGHT}
            maxLength={150}
          />
        </Field>

        {/* Subtitle */}
        <Field label="Subtitle" hint="Short tagline shown under the title.">
          <TextInput
            style={styles.input}
            value={form.subtitle}
            onChangeText={(v) => set('subtitle', v)}
            placeholder="e.g. Open to all senior students"
            placeholderTextColor={TEXT_LIGHT}
            maxLength={200}
          />
        </Field>

        {/* Date */}
        <Field label="Event date *">
          <DateField
            value={form.event_date}
            onChange={(v) => set('event_date', v)}
            placeholder="Pick a date"
            minDate={new Date()}
          />
        </Field>

        {/* Event Time — sits directly under the date so the two
            "when is this happening" fields group visually. Reuses
            the shared TimeWheelModal via `timeTarget = 'event'`. */}
        <Field label="Event time" hint="Optional. When on the event day does it start?">
          <TouchableOpacity
            style={styles.timeTrigger}
            onPress={() => { setTimeTarget('event'); setTimeModalOpen(true); }}
            activeOpacity={0.85}
          >
            <Clock size={14} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text
              style={[
                styles.timeTriggerText,
                !form.event_time && { color: TEXT_LIGHT, fontWeight: '500' },
              ]}
            >
              {form.event_time ? format12h(form.event_time) : 'Pick a time'}
            </Text>
            {form.event_time ? (
              <TouchableOpacity
                onPress={() => set('event_time', '')}
                hitSlop={8}
                style={{ marginLeft: 'auto' }}
              >
                <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        </Field>

        {/* Registration closing */}
        <Field label="Registration closes" hint="Optional cut-off for sign-ups.">
          <DateField
            value={form.registration_closing_date}
            onChange={(v) => set('registration_closing_date', v)}
            placeholder="Pick a date"
            minDate={new Date()}
          />
        </Field>

        {/* Location */}
        <Field label="Location">
          <TextInput
            style={styles.input}
            value={form.location}
            onChangeText={(v) => set('location', v)}
            placeholder="e.g. Main hall, 2nd floor"
            placeholderTextColor={TEXT_LIGHT}
            maxLength={200}
          />
        </Field>

        {/* Location Link — renamed from External Link. Same underlying
            form.link key so backend + downstream consumers keep working. */}
        <Field label="Location link" hint="Google Maps / venue page / directions URL. Optional.">
          <TextInput
            style={styles.input}
            value={form.link}
            onChangeText={(v) => set('link', v)}
            placeholder="https://…"
            placeholderTextColor={TEXT_LIGHT}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>

        {/* ── Categories & Skills ─────────────────────────────────────
            The organiser groups the event by category (Junior /
            Senior / custom) and, inside each category, picks which
            skills participate and the age window per skill. Any
            number of categories + skills is supported. */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Layers size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Categories & Skills</Text>
              <Text style={styles.cardHint}>
                Add each category, then the skills competing under it with an age range.
              </Text>
            </View>
          </View>

          {/* Skills-source status hint — surfaces the state of the two
              fetches driving the skill dropdown so the organiser
              understands why options look sparse (loading in flight,
              network error, or setup form genuinely empty). Silent
              once the catalog is loaded and non-empty. */}
          {skillsLoading ? (
            <View style={styles.skillsStatus}>
              <ActivityIndicator size="small" color={BRAND} />
              <Text style={styles.skillsStatusText}>Loading skills from your Setup Form…</Text>
            </View>
          ) : skillsError ? (
            <View style={[styles.skillsStatus, styles.skillsStatusError]}>
              <Text style={[styles.skillsStatusText, { color: '#B91C1C' }]}>
                {skillsError}
              </Text>
            </View>
          ) : instSkills.length === 0 ? (
            <View style={[styles.skillsStatus, styles.skillsStatusWarn]}>
              <Text style={[styles.skillsStatusText, { color: '#92400E' }]}>
                No skills configured yet. Add them in Setup → Academy Profile, or use "Other" below to type one in.
              </Text>
            </View>
          ) : null}

          {categories.length === 0 ? (
            <View style={styles.catEmpty}>
              <Text style={styles.catEmptyText}>
                No categories yet. Tap "+ Add Category" to start.
              </Text>
            </View>
          ) : null}

          {categories.map((cat, ci) => (
            <View key={cat.id} style={styles.catBlock}>
              <View style={styles.catHeader}>
                <View style={styles.catBadge}>
                  <Text style={styles.catBadgeText}>{ci + 1}</Text>
                </View>
                <Text style={styles.catHeaderTitle}>Category {ci + 1}</Text>
                <TouchableOpacity
                  onPress={() => removeCategory(cat.id)}
                  hitSlop={8}
                  style={styles.catRemoveBtn}
                >
                  <Trash2 size={14} color="#B91C1C" strokeWidth={2.4} />
                </TouchableOpacity>
              </View>

              {/* Category name dropdown */}
              <Text style={styles.miniLabel}>Category name</Text>
              <SimpleDropdown
                value={cat.name}
                options={CATEGORY_OPTIONS}
                onChange={(v) => updateCategory(cat.id, { name: v })}
              />
              {cat.name === 'Other' ? (
                <TextInput
                  style={[styles.input, { marginTop: 6 }]}
                  value={cat.customName}
                  onChangeText={(v) => updateCategory(cat.id, { customName: v })}
                  placeholder="Enter custom category name"
                  placeholderTextColor={TEXT_LIGHT}
                  maxLength={80}
                />
              ) : null}

              {/* Gender — Male / Female. Sits between Category name
                  and Skills so the organiser sets it once for the
                  whole category rather than per-skill. Value is
                  persisted with the category on submit. */}
              <View style={{ height: 8 }} />
              <Text style={styles.miniLabel}>Gender</Text>
              <SimpleDropdown
                value={cat.gender || 'Male'}
                options={GENDER_OPTIONS}
                onChange={(v) => updateCategory(cat.id, { gender: v })}
              />

              {/* Skills under this category */}
              <View style={styles.skillsHeader}>
                <Text style={styles.miniLabel}>Skills</Text>
                <Text style={styles.miniHint}>{cat.skills.length} added</Text>
              </View>

              {cat.skills.map((sk, si) => (
                <View key={sk.id} style={styles.skillCard}>
                  <View style={styles.skillTopRow}>
                    <Text style={styles.skillIndex}>{si + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <SimpleDropdown
                        value={sk.name}
                        // Institution's own skills come first, then Other
                        // so the organiser can still type a custom one.
                        options={[...instSkills, 'Other']}
                        onChange={(v) => updateSkill(cat.id, sk.id, { name: v })}
                        emptyLabel="Pick a skill"
                      />
                    </View>
                    {cat.skills.length > 1 ? (
                      <TouchableOpacity
                        onPress={() => removeSkill(cat.id, sk.id)}
                        hitSlop={8}
                        style={styles.skillRemoveBtn}
                      >
                        <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {sk.name === 'Other' ? (
                    <TextInput
                      style={[styles.input, { marginTop: 6 }]}
                      value={sk.customName}
                      onChangeText={(v) => updateSkill(cat.id, sk.id, { customName: v })}
                      placeholder="Enter custom skill"
                      placeholderTextColor={TEXT_LIGHT}
                      maxLength={80}
                    />
                  ) : null}

                  {/* Age range: From / To */}
                  <View style={styles.ageRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Age from</Text>
                      <SimpleDropdown
                        value={sk.ageFrom}
                        options={AGE_OPTIONS}
                        onChange={(v) => updateSkill(cat.id, sk.id, { ageFrom: v })}
                        emptyLabel="—"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Age to</Text>
                      <SimpleDropdown
                        value={sk.ageTo}
                        // Restrict "to" to values >= "from" when set,
                        // so the range picker can't produce nonsense.
                        options={sk.ageFrom
                          ? AGE_OPTIONS.filter((n) => Number(n) >= Number(sk.ageFrom))
                          : AGE_OPTIONS}
                        onChange={(v) => updateSkill(cat.id, sk.id, { ageTo: v })}
                        emptyLabel="—"
                      />
                    </View>
                  </View>

                  {/* Divisions — optional free-text tags under the
                      skill (e.g. Karate → Division A, Division B).
                      Each row is a text input + a remove button; the
                      "+ Add Division" button appends a fresh empty
                      row that the organiser can start typing into. */}
                  <View style={styles.divisionsHeader}>
                    <Text style={styles.miniLabel}>Divisions</Text>
                    <Text style={styles.miniHint}>
                      {(sk.divisions || []).length} added
                    </Text>
                  </View>
                  {(sk.divisions || []).map((d, di) => (
                    <View key={d.id} style={styles.divisionRow}>
                      <Text style={styles.divisionIndex}>{di + 1}.</Text>
                      <TextInput
                        style={[styles.input, styles.divisionInput]}
                        value={d.name}
                        onChangeText={(v) => updateDivision(cat.id, sk.id, d.id, v)}
                        placeholder="Division name (e.g. Division A)"
                        placeholderTextColor={TEXT_LIGHT}
                        maxLength={80}
                      />
                      <TouchableOpacity
                        onPress={() => removeDivision(cat.id, sk.id, d.id)}
                        hitSlop={8}
                        style={styles.divisionRemoveBtn}
                      >
                        <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={() => addDivision(cat.id, sk.id)}
                    style={styles.addDivisionBtn}
                    activeOpacity={0.85}
                  >
                    <Plus size={12} color={BRAND} strokeWidth={2.6} />
                    <Text style={styles.addDivisionBtnText}>Add Division</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => addSkillToCategory(cat.id)}
                style={styles.addSkillBtn}
                activeOpacity={0.85}
              >
                <Plus size={12} color={BRAND} strokeWidth={2.6} />
                <Text style={styles.addSkillBtnText}>Add skill</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            onPress={addCategory}
            style={styles.addCategoryBtn}
            activeOpacity={0.85}
          >
            <Plus size={14} color="#fff" strokeWidth={2.6} />
            <Text style={styles.addCategoryBtnText}>Add Category</Text>
          </TouchableOpacity>
        </View>

        {/* Description */}
        <Field label="Details" hint="What to expect, what to bring, contact info.">
          <TextInput
            style={[styles.input, styles.textarea]}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            placeholder="Full event description…"
            placeholderTextColor={TEXT_LIGHT}
            multiline
            textAlignVertical="top"
            maxLength={2000}
          />
        </Field>

        {/* ── Payment card ─────────────────────────────────────────────
            Toggle governs whether the event is paid. When on, the link
            becomes mandatory and students/trainers see a Pay Now CTA on
            the event card. When off, the link field is hidden and the
            payload sends payment_link=null (backend also validates).

            HIDE for Inter-Level events. The Add Event tile the admin
            sees labelled "Inter-Level Event" sends `eventType: 'intra'`
            (see AdminDashboardScreen's Select Event Type modal — labels
            were swapped visually). For that type the Payment Required
            field must not appear at all. Intra-Level tile (which sends
            `eventType: 'inter'`) keeps the payment field unchanged. */}
        {eventType !== 'intra' ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <CreditCard size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Payment required</Text>
              <Text style={styles.cardHint}>
                Turn on if attendees have to pay to register.
              </Text>
            </View>
            <Switch
              value={form.payment_required}
              onValueChange={(v) => set('payment_required', v)}
            />
          </View>

          {form.payment_required ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Amount (₹) *</Text>
              <View style={styles.amountRow}>
                <View style={styles.amountPrefix}>
                  <Text style={styles.amountPrefixText}>₹</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.amountInput]}
                  value={form.payment_amount}
                  onChangeText={(v) => {
                    // Numeric-only with an optional single decimal — the
                    // backend rounds to 2dp anyway, but stripping here
                    // keeps the field visibly clean.
                    const cleaned = v.replace(/[^0-9.]/g, '')
                      .replace(/(\..*?)\..*$/, '$1')
                      .slice(0, 8);
                    set('payment_amount', cleaned);
                  }}
                  placeholder="500"
                  placeholderTextColor={TEXT_LIGHT}
                  keyboardType="numeric"
                  maxLength={8}
                />
              </View>
              <Text style={styles.hint}>
                Students & trainers see a Pay ₹{form.payment_amount || '—'} button
                on the event. Tapping it opens the same Razorpay checkout used
                for the subscription payment.
              </Text>
            </View>
          ) : null}
        </View>
        ) : null}

        {/* ── Posting options ──────────────────────────────────────────
            Two-pill toggle for Post Now / Schedule. Choosing Schedule
            reveals the date + time pickers. The event stays hidden from
            the student/trainer feed until publish_at is reached — the
            backend filters on read, so no cron job is needed.

            HIDE for Inter-Level events. The Add Event tile the admin
            sees labelled "Inter-Level Event" navigates with
            `eventType: 'intra'` (labels swapped visually — see the
            Select Event Type modal). For that type the Posting Options
            card is hidden entirely; `form.publish_mode` defaults to
            'now' so submit still posts immediately. Intra-Level tile
            (which sends `eventType: 'inter'`) keeps the card
            unchanged. */}
        {eventType !== 'intra' ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Send size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Posting options</Text>
              <Text style={styles.cardHint}>
                Publish immediately or schedule for later.
              </Text>
            </View>
          </View>

          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[
                styles.pill,
                form.publish_mode === 'now' && styles.pillActive,
              ]}
              onPress={() => set('publish_mode', 'now')}
              activeOpacity={0.85}
            >
              <Send size={14}
                color={form.publish_mode === 'now' ? '#fff' : TEXT_MUTED}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.pillText,
                  form.publish_mode === 'now' && styles.pillTextActive,
                ]}
              >
                Post now
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.pill,
                form.publish_mode === 'later' && styles.pillActive,
              ]}
              onPress={() => set('publish_mode', 'later')}
              activeOpacity={0.85}
            >
              <Clock size={14}
                color={form.publish_mode === 'later' ? '#fff' : TEXT_MUTED}
                strokeWidth={2.4}
              />
              <Text
                style={[
                  styles.pillText,
                  form.publish_mode === 'later' && styles.pillTextActive,
                ]}
              >
                Schedule
              </Text>
            </TouchableOpacity>
          </View>

          {form.publish_mode === 'later' ? (
            <View style={{ marginTop: 12, gap: 12 }}>
              <View>
                <Text style={styles.label}>Publish date *</Text>
                <DateField
                  value={form.publish_date}
                  onChange={(v) => set('publish_date', v)}
                  placeholder="Pick a date"
                  minDate={new Date()}
                />
              </View>
              <View>
                <Text style={styles.label}>Publish time *</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => { setTimeTarget('publish'); setTimeModalOpen(true); }}
                  activeOpacity={0.85}
                >
                  <Clock size={14} color={TEXT_MUTED} strokeWidth={2.2} />
                  <Text
                    style={[
                      styles.timeTriggerText,
                      !form.publish_time && { color: TEXT_LIGHT, fontWeight: '500' },
                    ]}
                  >
                    {form.publish_time
                      ? format12h(form.publish_time)
                      : 'Pick a time'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.hint}>
                  Event stays hidden until this moment, then appears
                  automatically for students and trainers.
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        ) : null}

        {/* ── Registration Form section (MODULE 1) ────────────────
            Fully controlled component. Persisted via a follow-up
            PUT after the event row is created (see submit). Sits
            in its own card to match the surrounding sections.

            HIDE for Intra-Level events. The Add Event tile the admin
            sees labelled "Intra-Level Event" navigates with
            `eventType: 'inter'` (labels swapped visually — see the
            Select Event Type modal). For that type the Registration
            Form builder is hidden entirely; `regForm` keeps its
            default `{ enabled: false, fields: [] }` so the submit
            handler's follow-up PUT is skipped by its existing guard
            (only fires when enabled OR fields.length > 0).
            Inter-Level tile (`eventType: 'intra'`) keeps the section
            unchanged. */}
        {eventType !== 'inter' ? (
        <View style={{
          marginTop: 12,
          backgroundColor: SURFACE,
          borderWidth: 1, borderColor: BORDER,
          borderRadius: 12, padding: 14,
        }}>
          <RegistrationFormBuilder value={regForm} onChange={setRegForm} />
        </View>
        ) : null}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Time picker bottom sheet — two wheels: hours (12h) + minutes.
          Shared between the Event Time and Publish Time fields; the
          write-back key comes from `timeTarget`. */}
      <TimeWheelModal
        visible={timeModalOpen}
        initial={
          (timeTarget === 'event' ? form.event_time : form.publish_time)
          || defaultRoundedTime()
        }
        title={timeTarget === 'event' ? 'Pick event time' : 'Pick publish time'}
        onCancel={() => setTimeModalOpen(false)}
        onDone={(hhmm) => {
          if (timeTarget === 'event') set('event_time', hhmm);
          else                        set('publish_time', hhmm);
          setTimeModalOpen(false);
        }}
      />

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
          activeOpacity={0.88}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>
                {isEdit
                  ? 'Save changes'
                  : form.publish_mode === 'later' ? 'Schedule event' : 'Publish event'}
              </Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </CreateEventCtx.Provider>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
// SimpleDropdown — modal-backed picker with the same visual language
// as the existing time / date triggers. Used across the Categories &
// Skills section (category name, skill name, age from, age to).
function SimpleDropdown({ value, options, onChange, emptyLabel = 'Select…' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        style={styles.ddTrigger}
      >
        <Text
          style={[
            styles.ddTriggerText,
            !value && { color: TEXT_LIGHT, fontWeight: '500' },
          ]}
          numberOfLines={1}
        >
          {value || emptyLabel}
        </Text>
        <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.4} />
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.ddBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.ddSheet}>
            <FlatList
              data={options}
              keyExtractor={(item) => String(item)}
              renderItem={({ item }) => {
                const active = String(item) === String(value);
                return (
                  <TouchableOpacity
                    onPress={() => { onChange(item); setOpen(false); }}
                    style={[styles.ddItem, active && styles.ddItemActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.ddItemText, active && styles.ddItemTextActive]}>
                      {item}
                    </Text>
                    {active ? (
                      <Check size={14} color={BRAND} strokeWidth={2.6} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.ddSep} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function Field({ label, hint, children }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Time helpers ───────────────────────────────────────────────────────
// Default when opening the picker: next 5-minute boundary from now, so
// the wheel starts at a sensible spot instead of midnight.
function defaultRoundedTime() {
  const now = new Date();
  const mins = Math.ceil(now.getMinutes() / 5) * 5;
  const overflow = mins >= 60;
  const h = (now.getHours() + (overflow ? 1 : 0)) % 24;
  const m = overflow ? 0 : mins;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 24h HH:mm → "h:mm AM/PM" for the display trigger. We keep the stored
// form value in 24h internally so the ISO conversion is unambiguous.
function format12h(hhmm) {
  const [hh, mm] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return hhmm;
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

// ─── TimeWheelModal ─────────────────────────────────────────────────────
// Compact bottom-sheet time picker. Two vertical wheels: 12-hour hour
// (1-12) and 5-minute increments (00, 05, 10 … 55), plus an AM/PM
// toggle. Matches the visual language of the existing DateField wheels
// without pulling in an extra native dependency.
const ITEM_H = 40;
const VISIBLE = 5;
const WHEEL_H = ITEM_H * VISIBLE;

function TimeWheelModal({ visible, initial, onCancel, onDone, title }) {
  const parse = (s) => {
    const [hh, mm] = String(s || '09:00').split(':').map((n) => parseInt(n, 10));
    const safeH = Number.isFinite(hh) ? hh : 9;
    const safeM = Number.isFinite(mm) ? mm : 0;
    return {
      hour12: safeH % 12 === 0 ? 12 : safeH % 12,
      minute: Math.round(safeM / 5) * 5 % 60,
      period: safeH >= 12 ? 'PM' : 'AM',
    };
  };
  const [state, setState] = useState(parse(initial));

  // Re-sync when the modal is re-opened with a different initial value.
  const lastInitial = useRef(initial);
  if (visible && lastInitial.current !== initial) {
    lastInitial.current = initial;
    setState(parse(initial));
  }

  const hours   = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const minutes = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 5), []);

  const commit = () => {
    // Convert 12h → 24h before emitting the storage value.
    let h24 = state.hour12 % 12;
    if (state.period === 'PM') h24 += 12;
    const hhmm = `${String(h24).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`;
    onDone(hhmm);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={timeStyles.backdrop}>
        <View style={timeStyles.sheet}>
          <View style={timeStyles.header}>
            <TouchableOpacity onPress={onCancel} hitSlop={8}>
              <X size={20} color={TEXT_MUTED} strokeWidth={2.2} />
            </TouchableOpacity>
            <Text style={timeStyles.title}>{title || 'Pick time'}</Text>
            <TouchableOpacity onPress={commit} hitSlop={8}>
              <Check size={20} color={BRAND} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Wheels row — hours : minutes | AM/PM. The two number
              wheels sit inside a fixed-height container that also
              hosts the center-band highlight as an absolutely-
              positioned overlay (so the band always tracks the
              selected row regardless of the sheet's outer padding).
              overflow: 'hidden' on each wheel column prevents the
              FlatList's above/below-band padding from spilling into
              the AM/PM column. */}
          <View style={timeStyles.wheelsRow}>
            <View style={timeStyles.wheelsGroup}>
              {/* Center-band overlay — a subtle highlight strip that
                  marks the selected row without intercepting scrolls. */}
              <View pointerEvents="none" style={timeStyles.centerBand} />
              <View style={timeStyles.wheelCol}>
                <Wheel
                  data={hours}
                  value={state.hour12}
                  onChange={(v) => setState((s) => ({ ...s, hour12: v }))}
                  render={(n) => String(n)}
                />
              </View>
              <Text style={timeStyles.colon}>:</Text>
              <View style={timeStyles.wheelCol}>
                <Wheel
                  data={minutes}
                  value={state.minute}
                  onChange={(v) => setState((s) => ({ ...s, minute: v }))}
                  render={(n) => String(n).padStart(2, '0')}
                />
              </View>
            </View>

            <View style={timeStyles.periodCol}>
              {['AM', 'PM'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    timeStyles.periodBtn,
                    state.period === p && timeStyles.periodBtnActive,
                  ]}
                  onPress={() => setState((s) => ({ ...s, period: p }))}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      timeStyles.periodText,
                      state.period === p && timeStyles.periodTextActive,
                    ]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Vertical scroll wheel used inside TimeWheelModal. Snaps to ITEM_H and
// picks whichever row lines up with the center band on scroll-end.
function Wheel({ data, value, onChange, render }) {
  const ref = useRef(null);
  const initialIndex = Math.max(0, data.indexOf(value));

  return (
    <FlatList
      ref={ref}
      data={data}
      keyExtractor={(item) => String(item)}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      // Fill the parent wheelCol (72px wide, WHEEL_H tall). Explicit
      // width kept small so the two wheels + colon + AM/PM col all
      // fit comfortably on a phone-width sheet without clipping.
      style={{ height: WHEEL_H, width: '100%' }}
      contentContainerStyle={{ paddingVertical: ITEM_H * 2, alignItems: 'center' }}
      getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
      initialScrollIndex={initialIndex}
      onMomentumScrollEnd={(e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
        const clamped = Math.max(0, Math.min(data.length - 1, idx));
        onChange(data[clamped]);
      }}
      renderItem={({ item }) => (
        <View style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
          <Text
            style={[
              timeStyles.wheelText,
              item === value && timeStyles.wheelTextActive,
            ]}
          >
            {render(item)}
          </Text>
        </View>
      )}
    />
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header — glass slab with navy title and a soft blue lift
  // shadow. Matches every other Institution Home surface.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  body: { padding: 16, paddingBottom: 32 },

  label: { fontSize: 12, fontWeight: '700', color: TEXT, marginBottom: 6, letterSpacing: 0.3 },
  hint:  { fontSize: 11, color: TEXT_MUTED, marginTop: 4, lineHeight: 16 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 100, paddingTop: 11 },

  // Image picker
  imagePicker: {
    height: 160,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  imagePreview: { ...StyleSheet.absoluteFillObject },
  imageRemove: {
    position: 'absolute',
    top: 8, right: 8,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  imagePlaceholder: { alignItems: 'center' },
  imagePlaceholderText: { fontSize: 12, color: TEXT_LIGHT, marginTop: 6, fontWeight: '600' },

  // Footer buttons
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

  // ── Payment / Posting cards ─────────────────────────────────────────
  card: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    padding: 12,
    marginBottom: 16,
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  cardIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  cardHint:  { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '500' },

  // ── Post Now / Schedule pill row ────────────────────────────────────
  pillRow: {
    flexDirection: 'row', gap: 8,
    marginTop: 12,
  },
  pill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BG,
    borderWidth: 1, borderColor: BORDER,
  },
  pillActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  pillText:       { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  pillTextActive: { color: '#fff' },

  // ── Amount input with ₹ prefix ──────────────────────────────────────
  amountRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 0,
  },
  amountPrefix: {
    width: 40,
    borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
    borderWidth: 1, borderRightWidth: 0, borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  amountPrefixText: { fontSize: 16, fontWeight: '800', color: TEXT },
  amountInput: {
    flex: 1,
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
  },

  // ── Time trigger ────────────────────────────────────────────────────
  timeTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  timeTriggerText: { fontSize: 14, color: TEXT, fontWeight: '700' },

  // ── Categories & Skills ────────────────────────────────────────────
  // Loading / error / empty hint for the skills catalog. Sits above
  // the Add Category CTA so the organiser knows why the dropdown may
  // look sparse.
  skillsStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: BG,
    borderWidth: 1, borderColor: BORDER,
  },
  skillsStatusError: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  skillsStatusWarn:  { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  skillsStatusText:  { flex: 1, fontSize: 11, color: TEXT_MUTED, fontWeight: '600', lineHeight: 16 },

  catEmpty: {
    marginTop: 12, padding: 12,
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER, borderStyle: 'dashed',
    alignItems: 'center',
  },
  catEmptyText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },

  // Category block — glass-tinted card so it reads as a nested
  // panel on the ambient wash instead of a flat grey box.
  catBlock: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    backgroundColor: GLASS_FILL,
  },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
  },
  catBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  catBadgeText: { fontSize: 11, fontWeight: '800', color: BRAND },
  catHeaderTitle: {
    flex: 1,
    fontSize: 13, fontWeight: '800', color: TEXT, letterSpacing: 0.2,
  },
  catRemoveBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },

  miniLabel: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 0.4, marginBottom: 4, marginTop: 6,
  },
  miniHint: { fontSize: 11, color: TEXT_LIGHT, fontWeight: '600' },

  skillsHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 10, marginBottom: 4,
  },
  skillCard: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    padding: 10,
    marginTop: 8,
  },
  skillTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  skillIndex: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED, width: 18,
  },
  skillRemoveBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  ageRow: {
    flexDirection: 'row', gap: 10, marginTop: 8,
  },

  addSkillBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    borderWidth: 1, borderColor: BRAND_SOFT,
  },
  addSkillBtnText: { fontSize: 12, fontWeight: '800', color: BRAND, letterSpacing: 0.2 },

  // Divisions block — sits inside each skill card below the age
  // range. Rendered a touch tighter than the skill picker so it
  // reads as a sub-section rather than a peer.
  divisionsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, marginBottom: 4,
  },
  divisionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
  },
  divisionIndex: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED, width: 18,
  },
  divisionInput: {
    flex: 1, marginTop: 0,
  },
  divisionRemoveBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  addDivisionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BRAND_SOFT, borderStyle: 'dashed',
  },
  addDivisionBtnText: { fontSize: 12, fontWeight: '800', color: BRAND, letterSpacing: 0.2 },

  addCategoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: BRAND,
  },
  addCategoryBtnText: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },

  // ── SimpleDropdown ─────────────────────────────────────────────────
  ddTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10,
    gap: 8,
  },
  ddTriggerText: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '700' },
  ddBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  ddSheet: {
    width: '100%',
    maxWidth: 340,
    maxHeight: 340,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  ddItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    gap: 8,
  },
  ddItemActive: { backgroundColor: BRAND_SOFT },
  ddItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  ddItemTextActive: { color: BRAND, fontWeight: '800' },
  ddSep: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginLeft: 16 },
});

// ─── Time picker styles ─────────────────────────────────────────────────
const timeStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 26,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 10,
  },
  title: { fontSize: 15, fontWeight: '800', color: TEXT },

  // Outer wheels row hosts the two-wheel group + AM/PM column.
  wheelsRow: {
    marginTop: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12,
    height: WHEEL_H,
  },
  // Group holds the hour + colon + minute together so the
  // center-band overlay can span both wheels precisely.
  wheelsGroup: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: WHEEL_H,
    position: 'relative',
  },
  // Each wheel column clips its FlatList so the row-padding rows
  // above/below the center don't spill into the AM/PM column.
  wheelCol: {
    width: 72,
    height: WHEEL_H,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  colon: {
    fontSize: 22, fontWeight: '800', color: TEXT,
    marginHorizontal: 4,
    textAlignVertical: 'center',
  },

  // Center-band highlight — absolutely positioned inside the
  // wheelsGroup so it sits over the "selected" row regardless of
  // the sheet's outer padding.
  centerBand: {
    position: 'absolute',
    left: 0, right: 0,
    top: ITEM_H * 2,   // 2 rows above the center of a 5-row wheel
    height: ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: BORDER,
    backgroundColor: BRAND_SOFT,
    borderRadius: 8,
  },

  wheelText: {
    fontSize: 20,
    color: TEXT_LIGHT,
    fontWeight: '600',
  },
  wheelTextActive: {
    color: TEXT,
    fontWeight: '800',
  },

  periodCol: {
    marginLeft: 12,
    gap: 6,
  },
  periodBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', minWidth: 54,
  },
  periodBtnActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  periodText:       { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  periodTextActive: { color: '#fff' },
});
