// src/screens/admin/CreateCourseScreen.js
//
// Admin "Add Course" form — drives every column on the extended `courses`
// table so the resulting row renders the rich detail screen out of the box.
//
// Sections:
//   1. Basic Info          — name, category, short blurb, full description
//   2. Mode of Learning    — online / offline / hybrid toggle (✱ requested)
//   3. Level + Age         — Beginner/Intermediate/Advanced + free-text age
//   4. Schedule            — days, start/end time, duration months, batch size
//   5. Pricing             — monthly fee + admission fee
//   6. Perks               — belt system, certificate available, language
//   7. Branding            — image URL, badge, trainer name, branch name
//   8. Publish             — status (active / draft) and submit button

import React, { createContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, Switch, Image, Modal, FlatList,
} from 'react-native';
import {
  BookOpen, Globe, MapPin, Clock, IndianRupee, Award, Tag,
  Image as ImageIcon, ChevronDown, Film, ListChecks, Plus, Trash2,
  Camera, Upload, X, Check,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
// Shared canonical-list dropdown — same component used by the Create
// Trainer form's Skill + Belt fields. Backs the Category picker with
// the master skills list from /config/enums (mirrors Academy Setup).
import LookupDropdown, { FALLBACK_SKILLS } from '../../components/LookupDropdown';
import {
  BILLING_CYCLE_OPTIONS,
  billingCycleLabel,
} from '../../utils/billingCycle';
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

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const CreateCourseCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.text },
    label:       { color: pal.textMuted },
  });
}

// Resolve a stored /uploads/<file> path to an absolute URL that works on the
// Android emulator (which can't reach localhost — it maps to 10.0.2.2).
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

// ── Option lists ─────────────────────────────────────────────────────────────
const MODE_OPTIONS = [
  { key: 'offline', label: 'Offline',  hint: 'In-person at academy' },
  { key: 'online',  label: 'Online',   hint: 'Live virtual class'   },
];

const LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'];

// Selectable ages for the Min Age / Max Age dropdowns. Covers the
// realistic martial-arts student range from young children to seniors.
const AGE_OPTIONS = Array.from({ length: 78 }, (_, i) => i + 3); // 3..80

// Parse the legacy free-text `age_group` value (e.g. "5-12 Years",
// "7+ Years", "All ages") back into { min, max } numbers so existing
// rows round-trip into the new dropdowns cleanly.
function parseAgeGroup(raw) {
  if (!raw || typeof raw !== 'string') return { min: '', max: '' };
  const s = raw.trim();
  const range = s.match(/(\d+)\s*[-–to]+\s*(\d+)/i);
  if (range) {
    return { min: String(Number(range[1])), max: String(Number(range[2])) };
  }
  const open = s.match(/(\d+)\s*\+/);
  if (open) {
    return { min: String(Number(open[1])), max: '' };
  }
  const single = s.match(/(\d+)/);
  if (single) {
    return { min: String(Number(single[1])), max: String(Number(single[1])) };
  }
  return { min: '', max: '' };
}

// Badge pills shown on the course card. Default is 'new'; users can
// switch to Popular, Kids Special, or Other (with a free-text override).
const BADGE_OPTIONS = [
  { key: 'new',          label: 'New'          },
  { key: 'popular',      label: 'Popular'      },
  { key: 'kids_special', label: 'Kids Special' },
  { key: 'other',        label: 'Other'        },
];

const DAYS_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TIME_OPTIONS = (() => {
  const list = [];
  const periods = ['AM', 'PM'];
  for (const period of periods) {
    list.push(`12:00 ${period}`);
    list.push(`12:30 ${period}`);
    for (let h = 1; h <= 11; h++) {
      const hrStr = String(h).padStart(2, '0');
      list.push(`${hrStr}:00 ${period}`);
      list.push(`${hrStr}:30 ${period}`);
    }
  }
  return list;
})();

export default function CreateCourseScreen({ navigation, route }) {
  // Edit mode → route.params.course is the existing row from CoursesListScreen.
  // When present we pre-fill every field and switch the submit to PUT.
  const existing = route?.params?.course || null;
  const editingId = route?.params?.courseId || existing?.id || null;
  const isEdit = !!editingId;

  const [loading, setLoading] = useState(false);
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  const [activeTimeField, setActiveTimeField] = useState(null); // 'class_start_time' | 'class_end_time'

  // Trainer selection is intentionally removed from the course form
  // per product spec. Trainer records elsewhere in the app (Trainers
  // tab, Batches → trainer assignment, etc.) are unaffected; only
  // this screen no longer offers a trainer picker.

  // Canonical Skill / Category list — pulled from GET /config/enums
  // so the Category picker below renders the SAME options as the
  // Academy Setup form's Skills field. Starts with the offline
  // fallback (byte-identical to backend/src/config/enums.js) so the
  // dropdown is populated even before the network answers.
  const [canonicalCategories, setCanonicalCategories] = useState(FALLBACK_SKILLS);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/config/enums')
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data?.skills) ? r.data.skills.map(String) : [];
        if (list.length) setCanonicalCategories(list);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          '[CreateCourse] /config/enums fetch failed — using local fallback:',
          err?.response?.status || err?.message,
        );
      });
    return () => { cancelled = true; };
  }, []);
  const [form, setForm] = useState({
    // basic
    name:                  existing?.name              || '',
    category:              existing?.category          || '',
    short_description:     existing?.short_description || '',
    description:           existing?.description       || '',
    // mode + level
    mode:                  existing?.mode              || 'offline',
    level:                 existing?.level             || 'Beginner',
    // Age range — split into Min/Max dropdowns. We parse the legacy
    // free-text `age_group` value so existing courses round-trip.
    min_age:               (existing?.min_age != null && existing.min_age !== '')
                            ? String(existing.min_age)
                            : parseAgeGroup(existing?.age_group).min,
    max_age:               (existing?.max_age != null && existing.max_age !== '')
                            ? String(existing.max_age)
                            : parseAgeGroup(existing?.age_group).max,
    // schedule
    days_of_week:          existing?.days_of_week      || '',
    class_start_time:      existing?.class_start_time  || '',
    class_end_time:        existing?.class_end_time    || '',
    duration_months:       String(existing?.duration_months || 6),
    batch_size_min:        existing?.batch_size_min ? String(existing.batch_size_min) : '',
    batch_size_max:        existing?.batch_size_max ? String(existing.batch_size_max) : '',
    // pricing
    price:                 existing?.price ? String(existing.price) : '',
    // Billing cadence — flows through to the mobile payment summary
    // (fee chip: "Monthly Fee" / "Quarterly Fee" / "Annual Fee" / etc.),
    // the Razorpay Payment Link description, and the invoice PDF.
    // Defaults to 'monthly' for continuity with existing courses.
    billing_cycle:         existing?.billing_cycle || 'monthly',
    // Legacy single admission-fee field — kept in state for back-compat
    // with rows saved before the new fee-list UI. Stays in sync with the
    // first Admission Fee entry of additional_fees on save.
    admission_fee:         existing?.admission_fee ? String(existing.admission_fee) : '',
    // Dynamic list of additional fees beyond the monthly fee. Each item:
    //   { type: 'Admission Fee'|'Uniform Fee'|'Others',
    //     custom_title: '' (only used when type === 'Others'),
    //     amount: '' }
    additional_fees:
      Array.isArray(existing?.additional_fees) && existing.additional_fees.length
        ? existing.additional_fees.map((f) => ({
            type:         f.type || 'Admission Fee',
            custom_title: f.custom_title || '',
            amount:       f.amount != null ? String(f.amount) : '',
          }))
        : (existing?.admission_fee
            ? [{ type: 'Admission Fee', custom_title: '', amount: String(existing.admission_fee) }]
            : []),
    // perks
    belt_system:           !!existing?.belt_system,
    certificate_available: existing?.certificate_available === undefined ? true : !!existing.certificate_available,
    language:              existing?.language          || 'English',
    // branding
    image_url:             existing?.image_url         || '',
    intro_video_url:       existing?.intro_video_url   || '',
    // New courses default to the "New" badge; existing courses keep
    // whatever was saved. The "Other" tab in the picker reveals a
    // free-text input stored in badge_custom.
    badge:                 existing?.badge             || 'new',
    badge_custom:          existing?.badge_custom      || '',
    // Trainer picker removed from the course form per spec. Keeping
    // the field on `existing` so an update PATCH doesn't accidentally
    // clear a previously-assigned trainer — we forward the saved
    // value verbatim in the submit payload without touching it.
    trainer_id:            existing?.trainer_id != null ? String(existing.trainer_id) : '',
    trainer_name:          existing?.trainer_name      || '',
    // Branch name is prefilled from the academy's institution name on
    // first open via a useEffect below; existing courses keep their own.
    branch_name:           existing?.branch_name       || '',
    // publish
    status:                existing?.status            || 'active',
  });

  const [uploadingBanner, setUploadingBanner] = useState(false);

  // Banner picker — same pattern as SetupInstitutionScreen for the logo. Uses
  // react-native-image-picker, uploads to POST /api/uploads, stores the
  // returned `path` (e.g. `/uploads/abc.jpg`) in form.image_url. Storing the
  // path (not the absolute URL) means it keeps working when the API host
  // changes (e.g. localhost ↔ 10.0.2.2 ↔ production).
  const pickBannerSource = () => {
    Alert.alert('Banner image', 'Where should we get the image from?', [
      { text: 'Photo Library', onPress: () => pickFromGallery() },
      { text: 'Take Photo',    onPress: () => takePhoto() },
      { text: 'Cancel',        style: 'cancel' },
    ]);
  };
  const pickFromGallery = () => {
    launchImageLibrary(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1600, maxHeight: 900 },
      (res) => { if (!res.didCancel && !res.errorCode && res.assets?.[0]) uploadBanner(res.assets[0]); },
    );
  };
  const takePhoto = () => {
    launchCamera(
      { mediaType: 'photo', quality: 0.85, maxWidth: 1600, maxHeight: 900 },
      (res) => { if (!res.didCancel && !res.errorCode && res.assets?.[0]) uploadBanner(res.assets[0]); },
    );
  };
  const uploadBanner = async (asset) => {
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri:  asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'banner.jpg',
      });
      const res = await apiClient.post('/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // server returns { path: '/uploads/<file>', url: 'http://...' } —
      // store path so it follows the host wherever the app runs.
      update('image_url', res.data.path || res.data.url || '');
    } catch (err) {
      Alert.alert('Upload failed', err.response?.data?.message || err.message || 'Try again');
    } finally {
      setUploadingBanner(false);
    }
  };
  const clearBanner = () => update('image_url', '');

  // Curriculum repeater — independent from `form` so the rows have their own
  // identity for delete / edit operations.
  const [curriculum, setCurriculum] = useState(() => {
    const list = Array.isArray(existing?.curriculum) ? existing.curriculum : [];
    if (list.length === 0) return [{ id: Date.now(), title: '', duration: '', is_free: false }];
    return list.map((l, i) => ({
      id:       Date.now() + i,
      title:    l.title || l.name || '',
      duration: l.duration || '',
      is_free:  !!(l.is_free ?? l.free),
    }));
  });
  const updateLesson = (id, key, value) =>
    setCurriculum((prev) => prev.map((l) => (l.id === id ? { ...l, [key]: value } : l)));
  const addLesson = () =>
    setCurriculum((prev) => [...prev, { id: Date.now(), title: '', duration: '', is_free: false }]);
  const removeLesson = (id) =>
    setCurriculum((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const update = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // On first open of a NEW course form, prefill the branch name with the
  // institution's own name from the academy setup so the admin doesn't
  // have to retype it. Editing an existing course leaves whatever was
  // saved alone.
  useEffect(() => {
    if (existing) return;            // edit mode → don't override saved value
    if (form.branch_name) return;    // user already typed something
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/onboarding/my-status');
        const instName = res?.data?.institution?.name;
        if (!cancelled && instName) {
          setForm((prev) => prev.branch_name ? prev : { ...prev, branch_name: instName });
        }
      } catch (err) {
        console.warn('[CreateCourse] could not load institution name:', err?.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!form.name.trim()) {
      Alert.alert('Required', 'Course name is required.');
      return;
    }
    setLoading(true);
    try {
      // Compose the legacy `age_group` text from the dropdowns so any
      // back-end / read-side code that still reads the string column
      // keeps working without changes.
      const minA = parseInt(form.min_age, 10);
      const maxA = parseInt(form.max_age, 10);
      const ageGroupText = (() => {
        if (Number.isFinite(minA) && Number.isFinite(maxA)) return `${minA}-${maxA} Years`;
        if (Number.isFinite(minA)) return `${minA}+ Years`;
        if (Number.isFinite(maxA)) return `Up to ${maxA} Years`;
        return '';
      })();

      // Normalise the additional-fees list. Drop blank rows and resolve
      // the title (use custom_title when type is 'Others').
      const cleanFees = (form.additional_fees || [])
        .map((f) => ({
          type: f.type || 'Admission Fee',
          title: (f.type === 'Others' ? (f.custom_title || '').trim() : f.type) || null,
          amount: f.amount ? parseFloat(f.amount) : 0,
        }))
        .filter((f) => f.title && f.amount > 0);

      // Back-compat: keep `admission_fee` populated from the first
      // "Admission Fee" entry so anything that still reads that column
      // continues to work.
      const admissionFromList = cleanFees.find((f) => f.type === 'Admission Fee');
      const admissionFeeVal = admissionFromList
        ? admissionFromList.amount
        : (form.admission_fee ? parseFloat(form.admission_fee) : 0);

      const payload = {
        ...form,
        min_age:         Number.isFinite(minA) ? minA : null,
        max_age:         Number.isFinite(maxA) ? maxA : null,
        age_group:       ageGroupText || null,
        duration_months: parseInt(form.duration_months, 10) || 1,
        batch_size_min:  form.batch_size_min ? parseInt(form.batch_size_min, 10) : null,
        batch_size_max:  form.batch_size_max ? parseInt(form.batch_size_max, 10) : null,
        price:           form.price ? parseFloat(form.price) : 0,
        billing_cycle:   form.billing_cycle || 'monthly',
        admission_fee:   admissionFeeVal,
        additional_fees: cleanFees,
        // Trainer — send trainer_id (server derives trainer_name
        // from it so the label + FK stay in sync). Blank string → null
        // so the row can be cleared.
        trainer_id:      form.trainer_id ? parseInt(form.trainer_id, 10) || null : null,
        // Legacy trainer_name is intentionally dropped from the outgoing
        // payload — the server ignores it when trainer_id is present
        // and derives the label from the trainer's users.name.
        trainer_name:    undefined,
        // Resolve the badge: when "Other" is picked we send the custom
        // text the admin typed; otherwise the canonical key (new /
        // popular / kids_special).
        badge:           form.badge === 'other'
          ? (form.badge_custom || '').trim() || null
          : (form.badge || null),
        // Curriculum no longer captures duration — only the lesson
        // title and the optional Free flag.
        curriculum:      curriculum
          .filter((l) => l.title.trim())                          // drop blank rows
          .map((l) => ({
            title:    l.title.trim(),
            is_free:  !!l.is_free,
          })),
      };
      if (isEdit) {
        await apiClient.put(`/courses/${editingId}`, payload);
      } else {
        await apiClient.post('/courses', payload);
      }
      // Styled success dialog — green check with one-tap Done that bounces
      // back to the courses list. Replaces the stock OS Alert.
      const live = form.status === 'active';
      confirm({
        title:       isEdit ? 'Course updated' : 'Course created',
        message:     `${form.name} is now ${live ? 'live' : 'saved as draft'}.`,
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      confirm({
        title:       isEdit ? 'Could not update course' : 'Could not create course',
        message:     err.response?.data?.message || err.message || 'Something went wrong. Please try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setLoading(false);
    }
  };

  // Dark-mode overrides from the shared ThemeContext. Ambient
  // background layer is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <CreateCourseCtx.Provider value={{ isDark, dark }}>
    <View style={[{ flex: 1, backgroundColor: isDark ? themePalette.bg : INSTITUTION_BG_BASE }]}>
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <ScrollView
        style={[styles.screen, isDark && dark.screen]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      {/* ── Section 1: Basic info ── */}
      <Section title="Basic Info" icon={BookOpen} accent={palette.purple}>
        <Field label="Course Name *" value={form.name} onChange={(v) => update('name', v)} placeholder="e.g., Karate — Beginner" />
        {/* Category — searchable dropdown backed by /config/enums so
            it mirrors the Academy Setup form's Skills list. Legacy
            values not in the canonical list are preserved by the
            dropdown so existing courses keep displaying correctly. */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Category</Text>
          <LookupDropdown
            value={form.category}
            options={canonicalCategories}
            onSelect={(v) => update('category', v)}
            placeholder="Choose a category"
            emptyText="No categories available."
          />
        </View>
        <Field label="Short tagline" value={form.short_description} onChange={(v) => update('short_description', v)} placeholder="Start your martial arts journey..." />
        <Field label="Full description" value={form.description} onChange={(v) => update('description', v)} placeholder="What will students learn?" multiline />
      </Section>

      {/* ── Section 2: Mode of learning ── */}
      <Section title="Mode of Learning" icon={Globe} accent={palette.blue}>
        <Text style={styles.hint}>How will this course be delivered?</Text>
        <View style={styles.segmentedWrap}>
          {MODE_OPTIONS.map((opt) => {
            const active = form.mode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => update('mode', opt.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{opt.label}</Text>
                <Text style={[styles.segmentHint, active && styles.segmentHintActive]}>{opt.hint}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      {/* ── Section 3: Level + Age ── */}
      <Section title="Level & Audience" icon={Award} accent={palette.green}>
        <Text style={styles.subLabel}>Level</Text>
        <View style={styles.pillRow}>
          {LEVEL_OPTIONS.map((lvl) => {
            const active = form.level === lvl;
            return (
              <TouchableOpacity
                key={lvl}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => update('level', lvl)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{lvl}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Age range — two dropdowns side-by-side. The picker is a
            scrollable list of years 3–80 so the admin doesn't have to
            type or remember a format. */}
        <Text style={styles.label}>Age Range</Text>
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <AgeDropdown
              label="Min Age"
              value={form.min_age}
              onChange={(v) => {
                // If a max was set and the new min is greater, bump max
                // up so the range stays valid.
                update('min_age', v);
                const minN = parseInt(v, 10);
                const maxN = parseInt(form.max_age, 10);
                if (Number.isFinite(minN) && Number.isFinite(maxN) && maxN < minN) {
                  update('max_age', v);
                }
              }}
              options={AGE_OPTIONS}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <AgeDropdown
              label="Max Age"
              value={form.max_age}
              onChange={(v) => update('max_age', v)}
              // Disable values below min_age so the admin can't pick an
              // invalid range.
              options={AGE_OPTIONS}
              minAllowed={parseInt(form.min_age, 10) || undefined}
            />
          </View>
        </View>
      </Section>

      {/* ── Section 4: Course Duration ──
          Days, class start/end times and batch-size min/max were removed
          per spec — those live on the per-batch screen, not on the course
          template itself. The course only needs to declare how many
          months long the program is. */}
      <Section title="Course Duration" icon={Clock} accent={palette.orange}>
        <Field
          label="Duration (months)"
          value={form.duration_months}
          onChange={(v) => update('duration_months', v.replace(/[^0-9]/g, ''))}
          placeholder="6"
          keyboardType="number-pad"
        />
      </Section>

      {/* ── Section 5: Pricing ── */}
      <Section title="Pricing (₹)" icon={IndianRupee} accent={palette.pink}>
        {/* Billing cadence — controls the fee label shown to the
            student on the payment summary, on the Razorpay checkout
            page, and on the invoice PDF. */}
        <Text style={styles.label}>Billing Cycle</Text>
        <Text style={styles.helperText}>
          Choose how the course fee is billed. Default is Monthly Fee.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 6, marginBottom: spacing.md }}>
          {BILLING_CYCLE_OPTIONS.map((opt) => {
            const on = (form.billing_cycle || 'monthly') === opt.value;
            // Matches the "Level & Audience" pill row (Beginner /
            // Intermediate / Advanced) so the whole form reads with
            // one consistent brand red for the selected state. That
            // group uses palette.purple.vivid which the theme maps
            // to the brand red (#EF4444) — see theme.js.
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => update('billing_cycle', opt.value)}
                activeOpacity={0.85}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? palette.purple.vivid : palette.borderSoft,
                  backgroundColor: on ? palette.purple.vivid : palette.surface,
                }}
              >
                <Text style={{
                  fontSize: 12, fontWeight: '800',
                  color: on ? '#fff' : palette.text,
                }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Field
          // Field label mirrors the picked billing cycle so an admin
          // configuring an annual course sees "Annual Fee" here rather
          // than the stale hardcoded "Monthly Fee".
          label={billingCycleLabel(form.billing_cycle)}
          value={form.price}
          onChange={(v) => update('price', v)}
          placeholder="1500"
          keyboardType="decimal-pad"
        />

        <Text style={[styles.label, { marginTop: spacing.md }]}>
          Other Fees (optional)
        </Text>
        <Text style={styles.helperText}>
          Add admission, uniform, or any one-off charge. Choose "Others" to type a custom title.
        </Text>

        {form.additional_fees.map((fee, idx) => (
          <FeeRow
            key={idx}
            fee={fee}
            onChange={(patch) => {
              const next = [...form.additional_fees];
              next[idx] = { ...next[idx], ...patch };
              update('additional_fees', next);
            }}
            onRemove={() => {
              update(
                'additional_fees',
                form.additional_fees.filter((_, i) => i !== idx),
              );
            }}
          />
        ))}

        <TouchableOpacity
          style={styles.addFeeBtn}
          onPress={() => {
            update('additional_fees', [
              ...form.additional_fees,
              { type: 'Admission Fee', custom_title: '', amount: '' },
            ]);
          }}
          activeOpacity={0.85}
        >
          <Plus size={14} color={palette.pink.vivid} strokeWidth={2.6} />
          <Text style={styles.addFeeBtnText}>Add fee</Text>
        </TouchableOpacity>
      </Section>

      {/* ── Section 6: Perks ── */}
      <Section title="Perks" icon={Tag} accent={palette.teal}>
        <Toggle
          label="Belt System"
          hint="Course grants belts as students progress"
          value={form.belt_system}
          onChange={(v) => update('belt_system', v)}
        />
        <Toggle
          label="Certificate Available"
          hint="Students get a completion certificate"
          value={form.certificate_available}
          onChange={(v) => update('certificate_available', v)}
        />
        <Field label="Language" value={form.language} onChange={(v) => update('language', v)} placeholder="English, Tamil" />
      </Section>

      {/* ── Section 7: Media ── */}
      <Section title="Media" icon={ImageIcon} accent={palette.rose}>
        <Text style={styles.subLabel}>Banner image</Text>
        {form.image_url ? (
          <View style={styles.bannerPreview}>
            <Image
              source={{ uri: resolveAssetUrl(form.image_url) }}
              style={styles.bannerImage}
              resizeMode="cover"
            />
            <View style={styles.bannerActions}>
              <TouchableOpacity
                style={styles.bannerActionBtn}
                onPress={pickBannerSource}
                disabled={uploadingBanner}
              >
                <Camera size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.bannerActionText}>Replace</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bannerActionBtn, { backgroundColor: palette.rose.vivid }]}
                onPress={clearBanner}
                disabled={uploadingBanner}
              >
                <X size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.bannerActionText}>Remove</Text>
              </TouchableOpacity>
            </View>
            {uploadingBanner ? (
              <View style={styles.bannerOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.bannerPlaceholder}
            onPress={pickBannerSource}
            disabled={uploadingBanner}
            activeOpacity={0.85}
          >
            {uploadingBanner ? (
              <ActivityIndicator color={palette.purple.vivid} />
            ) : (
              <>
                <Upload size={28} color={palette.purple.vivid} strokeWidth={2} />
                <Text style={[styles.bannerHint, { color: palette.text, fontWeight: '700' }]}>
                  Upload banner image
                </Text>
                <Text style={styles.bannerHint}>From gallery or camera · 16:9 looks best</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.label}>Intro Video URL</Text>
          <TextInput
            style={styles.input}
            value={form.intro_video_url}
            onChangeText={(v) => update('intro_video_url', v)}
            placeholder="https://youtube.com/watch?v=... or direct .mp4 link"
            placeholderTextColor={palette.textLight}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            spellCheck={false}
          />
          {form.intro_video_url ? (
            <View style={styles.videoChip}>
              <Film size={14} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.videoChipText} numberOfLines={1}>
                {form.intro_video_url.length > 50
                  ? form.intro_video_url.slice(0, 50) + '…'
                  : form.intro_video_url}
              </Text>
            </View>
          ) : null}
        </View>
      </Section>

      {/* ── Section 8: Curriculum ── */}
      <Section title="Curriculum" icon={ListChecks} accent={palette.blue}>
        <Text style={styles.hint}>
          Add the lessons / modules students will learn. Toggle "Free" on intro lessons
          you want to unlock for non-subscribers.
        </Text>
        {curriculum.map((lesson, idx) => (
          <View key={lesson.id} style={styles.lessonRow}>
            <View style={styles.lessonNumber}>
              <Text style={styles.lessonNumberText}>{String(idx + 1).padStart(2, '0')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                style={[styles.input, styles.lessonTitleInput]}
                value={lesson.title}
                onChangeText={(v) => updateLesson(lesson.id, 'title', v)}
                placeholder="Lesson title"
                placeholderTextColor={palette.textLight}
              />
              <View style={styles.lessonMetaRow}>
                {/* Duration input removed per spec — only the lesson
                    title is captured. Free toggle still on the right. */}
                <View style={{ flex: 1 }} />
                <View style={styles.freeToggleRow}>
                  <Text style={styles.freeToggleLabel}>Free</Text>
                  <Switch
                    value={lesson.is_free}
                    onValueChange={(v) => updateLesson(lesson.id, 'is_free', v)}
                    trackColor={{ false: palette.borderSoft, true: palette.purple.vivid }}
                    thumbColor="#fff"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => removeLesson(lesson.id)}
                  disabled={curriculum.length === 1}
                  style={[styles.deleteLessonButton, curriculum.length === 1 && { opacity: 0.3 }]}
                >
                  <Trash2 size={16} color={palette.rose.on} strokeWidth={2.2} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.addLessonButton} onPress={addLesson} activeOpacity={0.85}>
          <Plus size={16} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.addLessonText}>Add lesson</Text>
        </TouchableOpacity>
      </Section>

      {/* ── Section 9: Branding ── */}
      <Section title="Branding" icon={Tag} accent={palette.green}>
        <Text style={styles.subLabel}>Badge (optional)</Text>
        <View style={styles.pillRow}>
          {BADGE_OPTIONS.map((b) => {
            const active = form.badge === b.key;
            return (
              <TouchableOpacity key={b.key} style={[styles.pill, active && styles.pillActive]} onPress={() => update('badge', b.key)}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{b.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Free-text override for the "Other" badge. Only shown when
            the Other pill is active so the form stays compact for the
            common case. */}
        {form.badge === 'other' ? (
          <Field
            label="Custom badge label"
            value={form.badge_custom}
            onChange={(v) => update('badge_custom', v)}
            placeholder="e.g. Limited Seats"
          />
        ) : null}

        {/* Trainer picker intentionally removed from the course
            form per product spec. Trainer records elsewhere in the
            app (Trainers tab, Batches → trainer assignment) are
            untouched — the previously-saved trainer_id on this
            course row is still submitted unchanged so an existing
            course keeps its trainer link. Nothing on this screen
            surfaces or mutates it now. */}

        {/* Branch name — read-only display. The value is pulled from the
            academy setup so admins don't have to retype it and can't
            accidentally drift from the institution's official name. */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Branch name</Text>
          <View style={[styles.input, styles.branchReadOnly]}>
            <Text
              style={[
                styles.branchReadOnlyText,
                !form.branch_name && { color: palette.textLight, fontWeight: '500' },
              ]}
              numberOfLines={1}
            >
              {form.branch_name || 'Loading academy name…'}
            </Text>
          </View>
          <Text style={styles.helperText}>
            Auto-filled from your academy profile.
          </Text>
        </View>
      </Section>

      {/* ── Section 8: Publish ── */}
      <Section title="Publish" icon={MapPin} accent={palette.purple}>
        <View style={styles.pillRow}>
          {['active', 'draft'].map((s) => {
            const active = form.status === s;
            return (
              <TouchableOpacity key={s} style={[styles.pill, active && styles.pillActive]} onPress={() => update('status', s)}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {s === 'active' ? 'Publish now' : 'Save as draft'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <TouchableOpacity
        style={[styles.submit, loading && { opacity: 0.6 }]}
        onPress={submit}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitText}>{isEdit ? 'Save changes' : 'Create Course'}</Text>}
      </TouchableOpacity>

      <View style={{ height: 80 }} />
      </ScrollView>

      <DropdownModal
        visible={timeModalVisible}
        title={activeTimeField === 'class_start_time' ? 'Select Start Time' : 'Select End Time'}
        options={TIME_OPTIONS}
        selectedValue={activeTimeField ? form[activeTimeField] : ''}
        onSelect={(val) => {
          if (activeTimeField) {
            update(activeTimeField, val);
          }
        }}
        onClose={() => {
          setTimeModalVisible(false);
          setActiveTimeField(null);
        }}
      />
    </View>
    </CreateCourseCtx.Provider>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────
function Section({ title, icon: Icon, accent, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: accent.soft }]}>
          {Icon ? <Icon size={16} color={accent.vivid} strokeWidth={2.4} /> : null}
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

// Compact tap target that opens a DropdownModal listing the supplied
// ages (rendered as "<n> Years" strings since the existing
// DropdownModal works with plain strings). `minAllowed` filters the
// list so the Max Age picker can't accept values below Min Age.
function AgeDropdown({ label, value, onChange, options, minAllowed }) {
  const [open, setOpen] = useState(false);
  const items = (options || [])
    .filter((n) => minAllowed == null || n >= minAllowed)
    .map((n) => `${n} Years`);
  const displayValue = value ? `${value} Years` : '';
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.input}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              flex: 1,
              color: value ? palette.text : palette.textLight,
              fontSize: 14,
              fontWeight: '600',
            }}
          >
            {displayValue || 'Select age'}
          </Text>
          <ChevronDown size={14} color={palette.textMuted} strokeWidth={2.2} />
        </View>
      </TouchableOpacity>
      <DropdownModal
        visible={open}
        title={label}
        options={items}
        selectedValue={displayValue}
        onSelect={(picked) => {
          // Picked is e.g. "12 Years" — strip the suffix and store the number.
          const n = parseInt(String(picked).replace(/\D/g, ''), 10);
          if (Number.isFinite(n)) onChange(String(n));
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

// ─── FeeRow ────────────────────────────────────────────────────────────
// One row in the dynamic "Other Fees" list. Type dropdown +
// (Others-only) custom title input + amount input + trash button.
const FEE_TYPES = ['Admission Fee', 'Uniform Fee', 'Others'];
function FeeRow({ fee, onChange, onRemove }) {
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const isOthers = fee.type === 'Others';
  return (
    <View style={styles.feeRow}>
      <View style={styles.feeRowTop}>
        {/* Type dropdown */}
        <TouchableOpacity
          style={styles.feeTypeBtn}
          onPress={() => setTypePickerOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.feeTypeText} numberOfLines={1}>
            {fee.type || 'Select type'}
          </Text>
          <ChevronDown size={14} color={palette.textMuted} strokeWidth={2.4} />
        </TouchableOpacity>

        {/* Trash */}
        <TouchableOpacity
          style={styles.feeRemoveBtn}
          onPress={onRemove}
          hitSlop={6}
          activeOpacity={0.7}
        >
          <Trash2 size={14} color={palette.pink.vivid} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      {/* Custom title shows only when type === 'Others' */}
      {isOthers ? (
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Fee name (e.g. Tournament Fee)"
          placeholderTextColor={palette.textLight}
          value={fee.custom_title}
          onChangeText={(v) => onChange({ custom_title: v })}
          maxLength={60}
        />
      ) : null}

      {/* Amount */}
      <View style={styles.feeAmountWrap}>
        <Text style={styles.feeAmountPrefix}>₹</Text>
        <TextInput
          style={styles.feeAmountInput}
          placeholder="500"
          placeholderTextColor={palette.textLight}
          value={fee.amount}
          onChangeText={(v) => onChange({ amount: v.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
        />
      </View>

      <DropdownModal
        visible={typePickerOpen}
        title="Fee type"
        options={FEE_TYPES}
        selectedValue={fee.type}
        onSelect={(val) => {
          // When switching away from Others, clear the custom title so it
          // doesn't linger as an unused value on the row.
          const patch = { type: val };
          if (val !== 'Others') patch.custom_title = '';
          onChange(patch);
        }}
        onClose={() => setTypePickerOpen(false)}
      />
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline, keyboardType }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textLight}
        multiline={!!multiline}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function Toggle({ label, hint, value, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.borderSoft, true: palette.purple.vivid }}
        thumbColor="#fff"
      />
    </View>
  );
}

function DropdownModal({ visible, title, options, selectedValue, onSelect, onClose }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <X size={18} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const active = item === selectedValue;
              return (
                <TouchableOpacity
                  style={[styles.modalItem, active && styles.modalItemActive]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <Text style={[styles.modalItemText, active && styles.modalItemTextActive]}>
                    {item}
                  </Text>
                  {active && <Check size={16} color={palette.purple.vivid} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            }}
            style={styles.modalList}
            contentContainerStyle={styles.modalListContent}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Ambient blue-tinted page colour so the InstitutionScreenBackground
  // wash sits on the right base. Overridden by dark palette when the
  // theme flips.
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.lg },

  // Section — navy heading, translucent glass card body with a soft
  // blue lift shadow to match Institution Home / TrainersList.
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { ...type.h2, color: HEADER_NAVY, fontWeight: '800' },
  sectionBody: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  // Field
  fieldWrap: { marginBottom: spacing.sm },
  label: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  helperText: {
    ...type.micro,
    color: palette.textLight,
    marginBottom: spacing.sm,
  },

  // Read-only display variant of the input — soft grey background with
  // no border focus + cursor since the value is non-editable.
  branchReadOnly: {
    justifyContent: 'center',
    backgroundColor: palette.bg,
  },
  branchReadOnlyText: {
    ...type.body,
    color: palette.text,
    fontWeight: '700',
  },

  // ── Dynamic "Other Fees" list ─────────────────────────────────────
  feeRow: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.divider || '#E5E7EB',
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  feeRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feeTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.divider || '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  feeTypeText: {
    flex: 1,
    ...type.body,
    color: palette.text,
    fontWeight: '600',
  },
  feeRemoveBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feeAmountWrap: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.divider || '#E5E7EB',
    paddingHorizontal: 12,
  },
  feeAmountPrefix: {
    ...type.body,
    color: palette.textMuted,
    fontWeight: '700',
    marginRight: 4,
  },
  feeAmountInput: {
    flex: 1,
    paddingVertical: 9,
    ...type.body,
    color: palette.text,
    fontWeight: '600',
  },

  // "+ Add fee" button at the bottom of the list
  addFeeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.pink.vivid,
    borderStyle: 'dashed',
    backgroundColor: palette.pink.soft,
    marginTop: 4,
  },
  addFeeBtnText: {
    ...type.micro,
    color: palette.pink.vivid,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  subLabel: { ...type.caption, color: palette.text, fontWeight: '700', marginTop: spacing.xs, marginBottom: 6 },
  input: {
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    ...type.body,
    color: palette.text,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  hint: { ...type.caption, color: palette.textMuted, marginBottom: spacing.sm },

  // Segmented control (mode)
  segmentedWrap: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flex: 1,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: palette.blue.soft, borderColor: palette.blue.vivid },
  segmentLabel: { ...type.bodyBold, color: palette.text },
  segmentLabelActive: { color: palette.blue.on },
  segmentHint: { ...type.micro, color: palette.textMuted, marginTop: 2 },
  segmentHintActive: { color: palette.blue.on },

  // Pills (level / badge / status)
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  pillActive: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  pillText: { ...type.caption, color: palette.text, fontWeight: '600' },
  pillTextActive: { color: '#fff', fontWeight: '700' },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: spacing.md,
  },
  toggleLabel: { ...type.bodyBold, color: palette.text },
  toggleHint: { ...type.micro, color: palette.textMuted, marginTop: 1 },

  // Media
  bannerPreview: {
    width: '100%',
    height: 140,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: palette.borderSoft,
    marginTop: 6,
    marginBottom: spacing.sm,
  },
  bannerImage: { width: '100%', height: '100%' },
  bannerActions: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: 6,
  },
  bannerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  bannerActionText: { ...type.micro, color: '#fff', fontWeight: '700' },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    borderWidth: 1,
    borderColor: palette.purple.vivid,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: spacing.sm,
  },
  bannerHint: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
  videoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    marginTop: 4,
  },
  videoChipText: { ...type.caption, color: palette.purple.on, fontWeight: '600', flex: 1 },

  // Curriculum
  lessonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  lessonNumber: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
  },
  lessonNumberText: { ...type.caption, color: palette.purple.on, fontWeight: '700' },
  lessonTitleInput: { marginBottom: 6 },
  lessonMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lessonDurationInput: { flex: 1, paddingVertical: 8 },
  freeToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  freeToggleLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  deleteLessonButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.rose.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  addLessonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: 4,
  },
  addLessonText: { ...type.bodyBold, color: palette.purple.on, fontWeight: '700' },

  // Submit
  submit: {
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitText: { ...type.bodyBold, color: '#fff', fontWeight: '700' },

  // Days checkbox container
  daysContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: 4,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    minWidth: 70,
    justifyContent: 'center',
    gap: 6,
  },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: palette.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  checkboxLabel: {
    ...type.caption,
    color: palette.text,
    fontWeight: '600',
  },

  // Dropdown time trigger
  dropdownTrigger: {
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
    marginBottom: spacing.sm,
  },
  dropdownTriggerText: {
    ...type.body,
    color: palette.text,
  },
  dropdownPlaceholder: {
    color: palette.textLight,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '50%',
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: palette.borderSoft,
  },
  modalTitle: { ...type.bodyBold, color: palette.text, fontSize: 16 },
  modalCloseBtn: {
    padding: 4,
  },
  modalList: {
    paddingHorizontal: spacing.md,
  },
  modalListContent: {
    paddingVertical: spacing.sm,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  modalItemActive: {
    backgroundColor: palette.purple.soft,
  },
  modalItemText: { ...type.body, color: palette.text },
  modalItemTextActive: { color: palette.purple.on, fontWeight: '700' },
});
