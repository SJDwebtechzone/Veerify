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

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { ArrowLeft, Calendar, MapPin, Link as LinkIcon, Image as ImageIcon, Type, ChevronRight, X } from 'lucide-react-native';

import apiClient from '../../api/client';
import DateField from '../../components/DateField';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

// Reused upload helper — admins pick a photo from their gallery, we POST
// it to /uploads, and store only the returned relative path. Same flow
// the academy logo + course banner upload uses.
import { launchImageLibrary } from 'react-native-image-picker';
import resolveAssetUrl from '../../utils/assetUrl';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';

export default function CreateEventScreen({ navigation }) {
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    description: '',
    event_date: '',                  // ISO yyyy-mm-dd from DateField
    registration_closing_date: '',
    location: '',
    image_url: '',
    image_uri: '',                   // local preview only
    link: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

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

    setSubmitting(true);
    try {
      const res = await apiClient.post('/institutions/me/events', {
        title:                      form.title.trim(),
        subtitle:                   form.subtitle.trim() || null,
        description:                form.description.trim() || null,
        event_date:                 form.event_date,
        registration_closing_date:  form.registration_closing_date || null,
        location:                   form.location.trim() || null,
        image_url:                  form.image_url || null,
        link:                       form.link.trim() || null,
      });
      confirm({
        title: 'Event published',
        message: res.data?.message || 'Your students and trainers will see it on their home screen.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
        onConfirm: () => navigation.goBack(),
      });
    } catch (err) {
      Alert.alert('Failed', err.response?.data?.message || err.message || 'Could not save event.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Create Event</Text>
          <Text style={styles.headerSub}>Visible to your students & trainers</Text>
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

        {/* Link */}
        <Field label="External link" hint="Form / ticket page / live-stream URL. Optional.">
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
          style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
          activeOpacity={0.88}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.btnPrimaryText}>Publish event</Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
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
});
