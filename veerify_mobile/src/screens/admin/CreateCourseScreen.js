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

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, Switch, Image,
} from 'react-native';
import {
  BookOpen, Globe, MapPin, Clock, IndianRupee, Award, Tag,
  Image as ImageIcon, ChevronDown, Film, ListChecks, Plus, Trash2,
  Camera, Upload, X,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

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
  { key: 'hybrid',  label: 'Hybrid',   hint: 'Mix of both'          },
];

const LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'];

const BADGE_OPTIONS = [
  { key: '',             label: 'None'         },
  { key: 'popular',      label: 'Popular'      },
  { key: 'new',          label: 'New'          },
  { key: 'kids_special', label: 'Kids Special' },
];

export default function CreateCourseScreen({ navigation, route }) {
  // Edit mode → route.params.course is the existing row from CoursesListScreen.
  // When present we pre-fill every field and switch the submit to PUT.
  const existing = route?.params?.course || null;
  const editingId = route?.params?.courseId || existing?.id || null;
  const isEdit = !!editingId;

  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    // basic
    name:                  existing?.name              || '',
    category:              existing?.category          || '',
    short_description:     existing?.short_description || '',
    description:           existing?.description       || '',
    // mode + level
    mode:                  existing?.mode              || 'offline',
    level:                 existing?.level             || 'Beginner',
    age_group:             existing?.age_group         || '',
    // schedule
    days_of_week:          existing?.days_of_week      || '',
    class_start_time:      existing?.class_start_time  || '',
    class_end_time:        existing?.class_end_time    || '',
    duration_months:       String(existing?.duration_months || 6),
    batch_size_min:        existing?.batch_size_min ? String(existing.batch_size_min) : '',
    batch_size_max:        existing?.batch_size_max ? String(existing.batch_size_max) : '',
    // pricing
    price:                 existing?.price ? String(existing.price) : '',
    admission_fee:         existing?.admission_fee ? String(existing.admission_fee) : '',
    // perks
    belt_system:           !!existing?.belt_system,
    certificate_available: existing?.certificate_available === undefined ? true : !!existing.certificate_available,
    language:              existing?.language          || 'English',
    // branding
    image_url:             existing?.image_url         || '',
    intro_video_url:       existing?.intro_video_url   || '',
    badge:                 existing?.badge             || '',
    trainer_name:          existing?.trainer_name      || '',
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

  const submit = async () => {
    if (!form.name.trim()) {
      Alert.alert('Required', 'Course name is required.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        duration_months: parseInt(form.duration_months, 10) || 1,
        batch_size_min:  form.batch_size_min ? parseInt(form.batch_size_min, 10) : null,
        batch_size_max:  form.batch_size_max ? parseInt(form.batch_size_max, 10) : null,
        price:           form.price ? parseFloat(form.price) : 0,
        admission_fee:   form.admission_fee ? parseFloat(form.admission_fee) : 0,
        badge:           form.badge || null,
        curriculum:      curriculum
          .filter((l) => l.title.trim())                          // drop blank rows
          .map((l) => ({
            title:    l.title.trim(),
            duration: l.duration.trim(),
            is_free:  !!l.is_free,
          })),
      };
      if (isEdit) {
        await apiClient.put(`/courses/${editingId}`, payload);
      } else {
        await apiClient.post('/courses', payload);
      }
      Alert.alert(
        isEdit ? 'Course updated' : 'Course created',
        `${form.name} is now ${form.status === 'active' ? 'live' : 'saved as draft'}.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert(
        isEdit ? 'Could not update course' : 'Could not create course',
        err.response?.data?.message || err.message || 'Try again',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Section 1: Basic info ── */}
      <Section title="Basic Info" icon={BookOpen} accent={palette.purple}>
        <Field label="Course Name *" value={form.name} onChange={(v) => update('name', v)} placeholder="e.g., Karate — Beginner" />
        <Field label="Category"      value={form.category} onChange={(v) => update('category', v)} placeholder="Karate, Silambam, Self Defense..." />
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
        <Field label="Age Group" value={form.age_group} onChange={(v) => update('age_group', v)} placeholder="7+ Years, 5-12 Years..." />
      </Section>

      {/* ── Section 4: Schedule ── */}
      <Section title="Schedule" icon={Clock} accent={palette.orange}>
        <Field label="Days" value={form.days_of_week} onChange={(v) => update('days_of_week', v)} placeholder="Mon, Wed, Fri" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Start time" value={form.class_start_time} onChange={(v) => update('class_start_time', v)} placeholder="06:00 PM" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Field label="End time" value={form.class_end_time} onChange={(v) => update('class_end_time', v)} placeholder="07:00 PM" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Duration (months)" value={form.duration_months} onChange={(v) => update('duration_months', v)} placeholder="6" keyboardType="number-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Field label="Min batch" value={form.batch_size_min} onChange={(v) => update('batch_size_min', v)} placeholder="20" keyboardType="number-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Field label="Max batch" value={form.batch_size_max} onChange={(v) => update('batch_size_max', v)} placeholder="25" keyboardType="number-pad" />
          </View>
        </View>
      </Section>

      {/* ── Section 5: Pricing ── */}
      <Section title="Pricing (₹)" icon={IndianRupee} accent={palette.pink}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Monthly Fee" value={form.price} onChange={(v) => update('price', v)} placeholder="1500" keyboardType="decimal-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={{ flex: 1 }}>
            <Field label="Admission Fee" value={form.admission_fee} onChange={(v) => update('admission_fee', v)} placeholder="500" keyboardType="decimal-pad" />
          </View>
        </View>
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
                <TextInput
                  style={[styles.input, styles.lessonDurationInput]}
                  value={lesson.duration}
                  onChangeText={(v) => updateLesson(lesson.id, 'duration', v)}
                  placeholder="12 min"
                  placeholderTextColor={palette.textLight}
                />
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
              <TouchableOpacity key={b.key || 'none'} style={[styles.pill, active && styles.pillActive]} onPress={() => update('badge', b.key)}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{b.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Field label="Trainer name" value={form.trainer_name} onChange={(v) => update('trainer_name', v)} placeholder="Sensei Arun" />
        <Field label="Branch name" value={form.branch_name} onChange={(v) => update('branch_name', v)} placeholder="Chennai Main Branch" />
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

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.lg },

  // Section
  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { ...type.h2, color: palette.text, fontWeight: '700' },
  sectionBody: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },

  // Field
  fieldWrap: { marginBottom: spacing.sm },
  label: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
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
});
