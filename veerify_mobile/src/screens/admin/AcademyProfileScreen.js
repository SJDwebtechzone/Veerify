// src/screens/admin/AcademyProfileScreen.js
//
// The Institution Admin's Academy Profile — reached by tapping the
// name/logo card on the More tab. Two modes on the same screen:
//
//   • View mode  (default) — read-only display of every profile field:
//       logo, name, brand name, description, contact, address, socials,
//       and the point-of-contact "Master" block.
//   • Edit mode  (pencil in top-right) — same layout but every field
//       becomes an input, and a Save button appears in the footer.
//
// Backend:
//   GET  /api/institutions/me/details   -> current row
//   PUT  /api/institutions/me/update    -> patch (COALESCE)
//   POST /api/uploads                   -> image upload for logo
//
// The update endpoint is COALESCE-based, so we send only the fields the
// admin actually edited. The screen refreshes from the server response
// on success so what you see is what the DB persisted.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, Linking,
  RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Edit3, Save, X, Camera, Mail, Phone, MapPin, Globe,
  User, Briefcase, Facebook, Instagram, Youtube, Linkedin, Clock,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import { confirm } from '../../components/ConfirmDialog';

const BRAND      = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT       = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = '#FFFFFF';
const BG         = '#F4F4F8';
const BORDER     = '#E5E7EB';

// Fields we send to the update endpoint. Keys match the backend's
// req.body shape. Kept as an explicit list so it's obvious what the
// screen edits and what stays read-only (the master block reuses the
// existing wizard-style fields for now).
// Every simple string / date column we prefill AND expose for edit.
// Arrays (types, skills, medium) are handled separately since they need
// tag-input UI. Operating hours (weekday / weekend jsonb) also handled
// separately below.
const EDITABLE_KEYS = [
  'name', 'brand_name', 'description', 'logo_url', 'website_url',
  'institution_type', 'registration_number', 'date_of_establishment',
  'phone', 'email',
  'address', 'city', 'pincode',
  'facebook_url', 'instagram_url', 'youtube_url', 'linkedin_url',
  'affiliation_or_board', 'accreditation_body_name',
  'accreditation_expiry_date', 'accreditation_certificate_url',
  'total_student_capacity', 'current_enrollment',
  'master_name', 'master_role', 'master_email', 'master_phone_number',
];

// Array columns we manage as comma-joined text in the input, but send as
// arrays on save.
const ARRAY_KEYS = ['institution_types', 'skills', 'medium_of_instruction'];

const EMPTY = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, '']));
const EMPTY_ARRAYS = Object.fromEntries(ARRAY_KEYS.map((k) => [k, '']));

// Operating hours use the wizard's dual-group format:
//   operating_hours_weekday: [{ start, end }, ...]  ← Mon-Fri
//   operating_hours_weekend: [{ start, end }, ...]  ← Sat-Sun
// One "slot" per (weekday|weekend) covers the whole group. We show two
// slots (open/close) — first slot only — since that's what the setup
// wizard captures on a typical academy.
const EMPTY_HOURS = { weekday: { start: '', end: '' }, weekend: { start: '', end: '' } };

export default function AcademyProfileScreen({ navigation }) {
  const [form, setForm]         = useState(EMPTY);
  const [initial, setInitial]   = useState(EMPTY);
  const [arrays, setArrays]     = useState(EMPTY_ARRAYS);           // comma-joined text
  const [arraysInitial, setArraysInitial] = useState(EMPTY_ARRAYS);
  const [hours, setHours]       = useState(EMPTY_HOURS);
  const [hoursInitial, setHoursInitial] = useState(EMPTY_HOURS);
  const [logoLocalUri, setLogoLocalUri] = useState('');   // preview only
  const [editing, setEditing]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setArr = (k, v) => setArrays((p) => ({ ...p, [k]: v }));

  // ── Load ─────────────────────────────────────────────────────────────
  // Prefills every field from /institutions/me/details, which returns the
  // exact same row the setup-wizard populated. Empty fields on the DB
  // stay blank in the form so the admin can fill them in later.
  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/institutions/me/details');
      const inst = r.data?.institution || {};

      // 1) Simple string / number / date fields.
      const next = { ...EMPTY };
      EDITABLE_KEYS.forEach((k) => {
        const v = inst[k];
        if (v == null) next[k] = '';
        else if (k === 'date_of_establishment' || k === 'accreditation_expiry_date') {
          // Postgres returns dates as ISO with time — strip to YYYY-MM-DD.
          next[k] = String(v).slice(0, 10);
        } else {
          next[k] = String(v);
        }
      });
      setForm(next);
      setInitial(next);

      // 2) Array columns — display as comma-joined text.
      const nextArrays = { ...EMPTY_ARRAYS };
      ARRAY_KEYS.forEach((k) => {
        const v = inst[k];
        if (Array.isArray(v)) nextArrays[k] = v.join(', ');
      });
      setArrays(nextArrays);
      setArraysInitial(nextArrays);

      // 3) Operating hours — pull first slot from each group.
      const readSlot = (val) => {
        if (!Array.isArray(val) || val.length === 0) return { start: '', end: '' };
        const s = val[0] || {};
        return { start: String(s.start || ''), end: String(s.end || '') };
      };
      const mergedHours = {
        weekday: readSlot(inst.operating_hours_weekday),
        weekend: readSlot(inst.operating_hours_weekend),
      };
      setHours(mergedHours);
      setHoursInitial(mergedHours);

      setLogoLocalUri('');
    } catch (err) {
      console.log('[AcademyProfile] load failed:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh on focus so leaving and coming back reflects any changes
  // made elsewhere (e.g. UpdateLocation screen on the same admin).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Logo picker (edit mode only) ────────────────────────────────────
  const pickLogo = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo', quality: 0.9, selectionLimit: 1,
      });
      if (result.didCancel) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setUploadingLogo(true);
      const fd = new FormData();
      fd.append('file', {
        uri:  asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'logo.jpg',
      });
      const res = await apiClient.post(
        `/uploads?name_hint=${encodeURIComponent((form.name || 'academy').trim())}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const stored = res.data?.path || res.data?.url || '';
      set('logo_url', stored);
      setLogoLocalUri(asset.uri);
    } catch (err) {
      Alert.alert('Logo upload failed', err?.response?.data?.message || err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────
  // Send only fields the admin actually changed. Empty-string is
  // translated to null so COALESCE keeps the old value (rather than
  // wiping it). That mirrors the update endpoint's semantics.
  const save = async () => {
    // Client-side URL sanity — matches the backend's stricter check but
    // gives a nicer inline error.
    const urlKeys = ['website_url', 'facebook_url', 'instagram_url', 'youtube_url', 'linkedin_url'];
    for (const k of urlKeys) {
      const v = form[k]?.trim();
      if (v && !/^https?:\/\//i.test(v)) {
        confirm({
          title:       'Invalid URL',
          message:     `The ${k.replace(/_/g, ' ')} field should start with http:// or https://`,
          variant:     'destructive',
          confirmText: 'OK', hideCancel: true,
        });
        return;
      }
    }

    const diff = {};
    EDITABLE_KEYS.forEach((k) => {
      if ((form[k] || '') !== (initial[k] || '')) {
        diff[k] = form[k].trim() === '' ? null : form[k].trim();
      }
    });

    // Arrays — split the comma-joined text back into a clean array.
    ARRAY_KEYS.forEach((k) => {
      if ((arrays[k] || '') === (arraysInitial[k] || '')) return;
      const parsed = arrays[k]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      diff[k] = parsed.length ? parsed : null;
    });

    // Operating hours — validate both slots and diff. Empty slot with
    // both fields blank = clear that group.
    const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
    const slotIsBlank = (s) => !s.start && !s.end;
    const slotToDbShape = (s) => (slotIsBlank(s) ? [] : [{ start: s.start, end: s.end }]);
    const validateSlot = (label, s) => {
      if (slotIsBlank(s)) return true;
      if (!HHMM.test(s.start || '') || !HHMM.test(s.end || '')) {
        confirm({
          title: 'Invalid time',
          message: `${label} — enter times as HH:MM (24-hour).`,
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return false;
      }
      if (s.start >= s.end) {
        confirm({
          title: 'Close before open',
          message: `${label} — close time must be after open time.`,
          variant: 'destructive', confirmText: 'OK', hideCancel: true,
        });
        return false;
      }
      return true;
    };
    if (hours.weekday.start !== hoursInitial.weekday.start
     || hours.weekday.end   !== hoursInitial.weekday.end) {
      if (!validateSlot('Mon–Fri', hours.weekday)) return;
      diff.operating_hours_weekday = slotToDbShape(hours.weekday);
    }
    if (hours.weekend.start !== hoursInitial.weekend.start
     || hours.weekend.end   !== hoursInitial.weekend.end) {
      if (!validateSlot('Sat–Sun', hours.weekend)) return;
      diff.operating_hours_weekend = slotToDbShape(hours.weekend);
    }

    if (Object.keys(diff).length === 0) {
      confirm({
        title:       'Nothing to save',
        message:     'No changes were made.',
        variant:     'info',
        confirmText: 'OK', hideCancel: true,
        onConfirm:   () => setEditing(false),
      });
      return;
    }

    setSaving(true);
    try {
      const res = await apiClient.put('/institutions/me/update', diff);
      const inst = res.data?.institution || {};

      // Re-hydrate the entire form from what the DB actually stored so
      // the view mode reflects persisted state.
      const next = { ...EMPTY };
      EDITABLE_KEYS.forEach((k) => {
        const v = inst[k];
        if (v == null) next[k] = '';
        else if (k === 'date_of_establishment' || k === 'accreditation_expiry_date') {
          next[k] = String(v).slice(0, 10);
        } else {
          next[k] = String(v);
        }
      });
      setForm(next);
      setInitial(next);

      const nextArrays = { ...EMPTY_ARRAYS };
      ARRAY_KEYS.forEach((k) => {
        const v = inst[k];
        if (Array.isArray(v)) nextArrays[k] = v.join(', ');
      });
      setArrays(nextArrays);
      setArraysInitial(nextArrays);

      const readSlot = (val) => {
        if (!Array.isArray(val) || val.length === 0) return { start: '', end: '' };
        const s = val[0] || {};
        return { start: String(s.start || ''), end: String(s.end || '') };
      };
      const mergedHours = {
        weekday: readSlot(inst.operating_hours_weekday),
        weekend: readSlot(inst.operating_hours_weekend),
      };
      setHours(mergedHours);
      setHoursInitial(mergedHours);

      setLogoLocalUri('');
      setEditing(false);
      confirm({
        title:       'Profile saved',
        message:     'Your academy profile has been updated.',
        variant:     'success',
        confirmText: 'OK', hideCancel: true,
      });
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Save failed.';
      confirm({
        title:       'Save failed',
        message:     msg,
        variant:     'destructive',
        confirmText: 'OK', hideCancel: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    // Discard any in-flight edits by resetting from the last-loaded row.
    setForm(initial);
    setArrays(arraysInitial);
    setHours(hoursInitial);
    setLogoLocalUri('');
    setEditing(false);
  };

  // ── Render helpers ──────────────────────────────────────────────────
  const displayLogo = logoLocalUri || resolveAssetUrl(form.logo_url);
  const initials = useMemo(() => (form.name || form.brand_name || 'A')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(), [form.name, form.brand_name]);

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Academy Profile</Text>
          <Text style={styles.headerSub}>
            {editing ? 'Edit institution details' : 'Institution details'}
          </Text>
        </View>
        {editing ? (
          <TouchableOpacity onPress={cancelEdit} style={styles.iconBtn} hitSlop={8}>
            <X size={20} color={TEXT_MUTED} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setEditing(true)} style={[styles.iconBtn, { backgroundColor: BRAND_SOFT }]} hitSlop={8}>
            <Edit3 size={18} color={BRAND} strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          !editing ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={BRAND}
            />
          ) : undefined
        }
      >
        {/* ─── Logo / name hero ─────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Outer touch target — no overflow clipping so the camera
              badge that sits at the bottom-right corner stays visible.
              The inner circle handles clipping the image. */}
          <TouchableOpacity
            onPress={editing ? pickLogo : undefined}
            activeOpacity={editing ? 0.85 : 1}
            style={styles.logoWrap}
            disabled={!editing || uploadingLogo}
          >
            <View style={styles.logoClip}>
              {uploadingLogo ? (
                <ActivityIndicator color={BRAND} />
              ) : displayLogo ? (
                <Image source={{ uri: displayLogo }} style={styles.logo} resizeMode="cover" />
              ) : (
                <Text style={styles.logoInitials}>{initials}</Text>
              )}
            </View>
            {editing ? (
              <View style={styles.logoBadge}>
                <Camera size={12} color="#fff" strokeWidth={2.6} />
              </View>
            ) : null}
          </TouchableOpacity>

          {editing ? (
            <>
              {/* One "Academy name" input, one "Brand name" input —
                  distinct labels so they don't look duplicated. The
                  first field is required; the second is optional and
                  only exists for academies that trade under a brand
                  name different from their registered name. */}
              <Text style={styles.heroLabel}>Academy name</Text>
              <TextInput
                style={[styles.input, styles.heroInput]}
                value={form.name}
                onChangeText={(v) => set('name', v)}
                placeholder="e.g. Maruthi Karate Academy"
                placeholderTextColor={TEXT_LIGHT}
                maxLength={120}
              />
              <Text style={styles.heroLabel}>Brand name (optional)</Text>
              <TextInput
                style={styles.input}
                value={form.brand_name}
                onChangeText={(v) => set('brand_name', v)}
                placeholder="Trading name shown to students"
                placeholderTextColor={TEXT_LIGHT}
                maxLength={150}
              />
            </>
          ) : (
            <>
              <Text style={styles.heroName} numberOfLines={2}>{form.name || 'Unnamed academy'}</Text>
              {form.brand_name ? (
                <Text style={styles.heroBrand} numberOfLines={1}>{form.brand_name}</Text>
              ) : null}
            </>
          )}
        </View>

        {/* ─── Institution details (from setup wizard) ─────────────── */}
        <Section title="Institution details">
          <Row
            label="Registration number"
            value={form.registration_number}
            editing={editing}
            onChange={(v) => set('registration_number', v)}
          />
          <Row
            label="Primary type"
            value={form.institution_type}
            editing={editing}
            onChange={(v) => set('institution_type', v)}
            placeholder="e.g. Martial arts academy"
          />
          <Row
            label="All types"
            value={arrays.institution_types}
            editing={editing}
            onChange={(v) => setArr('institution_types', v)}
            placeholder="Comma-separated"
          />
          <Row
            label="Established"
            value={form.date_of_establishment}
            editing={editing}
            onChange={(v) => set('date_of_establishment', v)}
            placeholder="YYYY-MM-DD"
          />
          <Row
            label="Skills / disciplines"
            value={arrays.skills}
            editing={editing}
            onChange={(v) => setArr('skills', v)}
            placeholder="Comma-separated (e.g. Karate, Kung Fu)"
            multiline
          />
        </Section>

        {/* ─── About ────────────────────────────────────────────────── */}
        <Section title="About">
          {editing ? (
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.description}
              onChangeText={(v) => set('description', v)}
              placeholder="A short description shown to students."
              placeholderTextColor={TEXT_LIGHT}
              multiline
              textAlignVertical="top"
              maxLength={800}
            />
          ) : form.description ? (
            <Text style={styles.body_}>{form.description}</Text>
          ) : (
            <Empty text="No description added yet." />
          )}
        </Section>

        {/* ─── Contact ─────────────────────────────────────────────── */}
        <Section title="Contact">
          <Row
            icon={Phone}
            label="Phone"
            value={form.phone}
            editing={editing}
            onChange={(v) => set('phone', v)}
            keyboardType="phone-pad"
            openable={(v) => `tel:${v}`}
          />
          <Row
            icon={Mail}
            label="Email"
            value={form.email}
            editing={editing}
            onChange={(v) => set('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            openable={(v) => `mailto:${v}`}
          />
          <Row
            icon={Globe}
            label="Website"
            value={form.website_url}
            editing={editing}
            onChange={(v) => set('website_url', v)}
            keyboardType="url"
            autoCapitalize="none"
            openable={(v) => v}
            placeholder="https://…"
          />
        </Section>

        {/* ─── Address ─────────────────────────────────────────────── */}
        <Section title="Address">
          <Row
            icon={MapPin}
            label="Address"
            value={form.address}
            editing={editing}
            onChange={(v) => set('address', v)}
            multiline
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1.4 }}>
              <Row
                label="City"
                value={form.city}
                editing={editing}
                onChange={(v) => set('city', v)}
                compact
              />
            </View>
            <View style={{ flex: 1 }}>
              <Row
                label="Pincode"
                value={form.pincode}
                editing={editing}
                onChange={(v) => set('pincode', v.replace(/[^0-9]/g, '').slice(0, 6))}
                keyboardType="numeric"
                compact
              />
            </View>
          </View>
        </Section>

        {/* ─── Accreditation (setup step 3) ────────────────────────── */}
        <Section title="Accreditation">
          <Row
            label="Affiliation / board"
            value={form.affiliation_or_board}
            editing={editing}
            onChange={(v) => set('affiliation_or_board', v)}
          />
          <Row
            label="Body name"
            value={form.accreditation_body_name}
            editing={editing}
            onChange={(v) => set('accreditation_body_name', v)}
          />
          <Row
            label="Expiry"
            value={form.accreditation_expiry_date}
            editing={editing}
            onChange={(v) => set('accreditation_expiry_date', v)}
            placeholder="YYYY-MM-DD"
          />
          <Row
            label="Certificate URL"
            value={form.accreditation_certificate_url}
            editing={editing}
            onChange={(v) => set('accreditation_certificate_url', v)}
            keyboardType="url"
            autoCapitalize="none"
            openable={(v) => v}
          />
        </Section>

        {/* ─── Operations (setup step 4) ───────────────────────────── */}
        <Section title="Operations">
          <Row
            label="Student capacity"
            value={form.total_student_capacity}
            editing={editing}
            onChange={(v) => set('total_student_capacity', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
          />
          <Row
            label="Current enrollment"
            value={form.current_enrollment}
            editing={editing}
            onChange={(v) => set('current_enrollment', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
          />
          <Row
            label="Medium of instruction"
            value={arrays.medium_of_instruction}
            editing={editing}
            onChange={(v) => setArr('medium_of_instruction', v)}
            placeholder="Comma-separated (e.g. English, Tamil)"
          />
        </Section>

        {/* ─── Operating hours ─────────────────────────────────────── */}
        <Section title="Operating hours">
          <OperatingHoursBlock
            editing={editing}
            hours={hours}
            onChange={setHours}
          />
        </Section>

        {/* ─── Social ──────────────────────────────────────────────── */}
        <Section title="Social">
          <Row
            icon={Facebook}
            label="Facebook"
            value={form.facebook_url}
            editing={editing}
            onChange={(v) => set('facebook_url', v)}
            openable={(v) => v}
            placeholder="https://facebook.com/…"
            keyboardType="url"
            autoCapitalize="none"
          />
          <Row
            icon={Instagram}
            label="Instagram"
            value={form.instagram_url}
            editing={editing}
            onChange={(v) => set('instagram_url', v)}
            openable={(v) => v}
            placeholder="https://instagram.com/…"
            keyboardType="url"
            autoCapitalize="none"
          />
          <Row
            icon={Youtube}
            label="YouTube"
            value={form.youtube_url}
            editing={editing}
            onChange={(v) => set('youtube_url', v)}
            openable={(v) => v}
            placeholder="https://youtube.com/…"
            keyboardType="url"
            autoCapitalize="none"
          />
          <Row
            icon={Linkedin}
            label="LinkedIn"
            value={form.linkedin_url}
            editing={editing}
            onChange={(v) => set('linkedin_url', v)}
            openable={(v) => v}
            placeholder="https://linkedin.com/company/…"
            keyboardType="url"
            autoCapitalize="none"
          />
        </Section>

        {/* ─── Point of contact ────────────────────────────────────── */}
        <Section title="Point of contact">
          <Row
            icon={User}
            label="Name"
            value={form.master_name}
            editing={editing}
            onChange={(v) => set('master_name', v)}
          />
          <Row
            icon={Briefcase}
            label="Role"
            value={form.master_role}
            editing={editing}
            onChange={(v) => set('master_role', v)}
          />
          <Row
            icon={Mail}
            label="Email"
            value={form.master_email}
            editing={editing}
            onChange={(v) => set('master_email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
            openable={(v) => `mailto:${v}`}
          />
          <Row
            icon={Phone}
            label="Phone"
            value={form.master_phone_number}
            editing={editing}
            onChange={(v) => set('master_phone_number', v)}
            keyboardType="phone-pad"
            openable={(v) => `tel:${v}`}
          />
        </Section>

        <View style={{ height: 24 }} />
      </ScrollView>

      {editing ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.footerBtn, styles.footerGhost]}
            onPress={cancelEdit}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={styles.footerGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerBtn, styles.footerPrimary, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.88}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save size={16} color="#fff" strokeWidth={2.4} />
                <Text style={styles.footerPrimaryText}>Save changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ─── Section / Row / Empty helpers ─────────────────────────────────────
function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({
  icon: Icon, label, value, editing, onChange,
  keyboardType, autoCapitalize, multiline, placeholder,
  openable, compact,
}) {
  if (editing) {
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <TextInput
          style={[styles.input, multiline && styles.textarea, compact && { paddingVertical: 9 }]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
          placeholderTextColor={TEXT_LIGHT}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : undefined}
        />
      </View>
    );
  }
  const displayValue = value?.trim();
  return (
    <TouchableOpacity
      activeOpacity={openable && displayValue ? 0.75 : 1}
      onPress={() => {
        if (!openable || !displayValue) return;
        const url = openable(displayValue);
        if (url) Linking.openURL(url).catch(() => {});
      }}
      style={styles.rowStatic}
    >
      {Icon ? (
        <View style={styles.rowIcon}>
          <Icon size={13} color={BRAND} strokeWidth={2.4} />
        </View>
      ) : <View style={{ width: 26 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabelStatic}>{label}</Text>
        {displayValue ? (
          <Text style={styles.rowValue} numberOfLines={multiline ? 6 : 2}>{displayValue}</Text>
        ) : (
          <Text style={styles.rowEmpty}>Not set</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function Empty({ text }) {
  return <Text style={styles.emptyRow}>{text}</Text>;
}

// ─── Operating Hours block ─────────────────────────────────────────────
// Uses the SAME group model as the setup wizard: Mon-Fri slot + Sat-Sun
// slot, so the values captured at registration flow straight through.
// Blank both fields on a group = closed that whole group.
function OperatingHoursBlock({ editing, hours, onChange }) {
  const setGroup = (group, next) => onChange({ ...hours, [group]: { ...hours[group], ...next } });

  const Group = ({ groupKey, label }) => {
    const s = hours[groupKey] || { start: '', end: '' };
    if (!editing) {
      return (
        <View style={hourStyles.viewRow}>
          <View style={hourStyles.viewDayChip}>
            <Text style={hourStyles.viewDayText} numberOfLines={1}>{label}</Text>
          </View>
          {s.start && s.end ? (
            <Text style={hourStyles.viewValue} numberOfLines={1}>
              {s.start} – {s.end}
            </Text>
          ) : (
            <Text style={hourStyles.viewClosed} numberOfLines={1}>Closed</Text>
          )}
        </View>
      );
    }
    return (
      <View style={hourStyles.editRow}>
        <View style={hourStyles.editDayChip}>
          <Text style={hourStyles.editDayText} numberOfLines={1}>{label}</Text>
        </View>
        <View style={hourStyles.timeRow}>
          <TextInput
            style={hourStyles.timeInput}
            value={s.start}
            onChangeText={(v) => setGroup(groupKey, { start: v.slice(0, 5) })}
            placeholder="09:00"
            placeholderTextColor={TEXT_LIGHT}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
          <Text style={hourStyles.timeSep}>–</Text>
          <TextInput
            style={hourStyles.timeInput}
            value={s.end}
            onChangeText={(v) => setGroup(groupKey, { end: v.slice(0, 5) })}
            placeholder="18:00"
            placeholderTextColor={TEXT_LIGHT}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>
      </View>
    );
  };

  const bothBlank = !hours.weekday.start && !hours.weekday.end
                 && !hours.weekend.start && !hours.weekend.end;
  if (!editing && bothBlank) return <Empty text="No operating hours set." />;

  return (
    <View style={{ gap: editing ? 10 : 6 }}>
      <Group groupKey="weekday" label="Mon–Fri" />
      <Group groupKey="weekend" label="Sat–Sun" />
      {editing ? (
        <Text style={styles.rowLabel}>Times are 24-hour (HH:MM). Leave both blank to mark closed.</Text>
      ) : null}
    </View>
  );
}

// ─── Operating hours styles ────────────────────────────────────────────
const hourStyles = StyleSheet.create({
  viewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 4,
  },
  viewDayChip: {
    // Wide enough for "Mon–Fri" / "Sat–Sun" without wrapping to a
    // second line. flexShrink: 0 keeps the chip from being squished
    // when the value on the right is long.
    minWidth: 68,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center',
    flexShrink: 0,
  },
  viewDayText: {
    // Slight letterSpacing tightening — the previous 0.4 was pushing
    // the label past the chip's inner width. 0.2 still reads as an
    // uppercase chip label.
    fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.2,
  },
  viewValue:   { fontSize: 13, color: TEXT, fontWeight: '700', flexShrink: 1 },
  viewClosed:  { fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic', flexShrink: 1 },

  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  editDayChip: {
    minWidth: 68,
    paddingHorizontal: 8, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BG,
    alignItems: 'center',
    flexShrink: 0,
  },
  editDayText: {
    fontSize: 11, fontWeight: '800', color: TEXT, letterSpacing: 0.2,
  },

  togglePill: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
    minWidth: 66, alignItems: 'center',
  },
  togglePillOpen:   { backgroundColor: '#D1FAE5', borderColor: '#6EE7B7' },
  togglePillClosed: { backgroundColor: BG,         borderColor: BORDER },
  togglePillText:   { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  timeInput: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 8,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 13, color: TEXT, fontWeight: '700',
    textAlign: 'center',
  },
  timeSep: { fontSize: 14, color: TEXT_MUTED, fontWeight: '800' },
});

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    backgroundColor: SURFACE, paddingTop: 48, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  body: { padding: 16, paddingBottom: 40 },

  // Hero
  hero: {
    backgroundColor: SURFACE,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    padding: 18, alignItems: 'center', marginBottom: 16,
  },
  // Outer positioning box — NO overflow clip so the camera badge that
  // hangs off the bottom-right corner of the circle renders on top.
  logoWrap: {
    width: 92, height: 92,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  // Inner circle that actually clips the image. Border radius + overflow
  // hidden go here so the round crop works, without eating the badge.
  logoClip: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  logoInitials: { fontSize: 28, fontWeight: '900', color: BRAND },
  logoBadge: {
    position: 'absolute',
    // Nudged inside the circle's edge so the badge sits half on the
    // ring, half outside — matches the pattern used by every avatar
    // camera badge in the app.
    bottom: -2, right: -2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
    // Nudge in front of the circle on iOS + Android.
    zIndex: 2, elevation: 4,
  },
  heroName: { fontSize: 18, fontWeight: '900', color: TEXT, textAlign: 'center', letterSpacing: -0.2 },
  heroBrand: { fontSize: 12, color: TEXT_MUTED, marginTop: 3, fontWeight: '600' },
  heroLabel: { alignSelf: 'stretch', fontSize: 11, fontWeight: '700', color: TEXT_MUTED, marginBottom: 6, marginTop: 6 },
  heroInput: { marginBottom: 8 },

  // Section
  section: {
    backgroundColor: SURFACE,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '900', color: TEXT_MUTED,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10,
  },
  sectionBody: { gap: 2 },

  // Static (view-mode) row
  rowStatic: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F5F9',
  },
  rowIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  rowLabelStatic: { fontSize: 10, fontWeight: '800', color: TEXT_MUTED, letterSpacing: 0.4, textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: TEXT, fontWeight: '600', marginTop: 2, lineHeight: 20 },
  rowEmpty: { fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic', marginTop: 2 },

  // Edit-mode row
  rowLabel: { fontSize: 11, fontWeight: '800', color: TEXT_MUTED, marginBottom: 5, letterSpacing: 0.3 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 84, paddingTop: 11 },
  body_: { fontSize: 14, color: TEXT, lineHeight: 21 },
  emptyRow: { fontSize: 12, color: TEXT_LIGHT, fontStyle: 'italic' },

  // Footer
  footer: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
  },
  footerGhost: { backgroundColor: BG },
  footerGhostText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },
  footerPrimary: { backgroundColor: BRAND, flex: 1.6 },
  footerPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
