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

import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, Modal, FlatList,
  Switch,
} from 'react-native';
import {
  ArrowLeft, Calendar, MapPin, Link as LinkIcon, Image as ImageIcon,
  Type, ChevronRight, X, CreditCard, Clock, Send, Check,
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

    // New — payment gate. When on, students/trainers see a "Pay ₹X"
    // button on the event that mints a Razorpay Payment Link at tap
    // time — same integrated flow as the subscription Pay Now.
    payment_required: false,
    payment_amount: '',            // rupees, string in input, coerced to number on submit

    // New — publish scheduling. 'now' publishes immediately; 'later'
    // requires publish_date + publish_time (hh:mm 24h).
    publish_mode: 'now',             // 'now' | 'later'
    publish_date: '',
    publish_time: '',                // 'HH:mm'
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [timeModalOpen, setTimeModalOpen] = useState(false);

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
        payment_required:           !!form.payment_required,
        payment_amount:             form.payment_required ? feeNumber : null,
        publish_at,
      });
      const scheduled = form.publish_mode === 'later';
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

        {/* ── Payment card ─────────────────────────────────────────────
            Toggle governs whether the event is paid. When on, the link
            becomes mandatory and students/trainers see a Pay Now CTA on
            the event card. When off, the link field is hidden and the
            payload sends payment_link=null (backend also validates). */}
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

        {/* ── Posting options ──────────────────────────────────────────
            Two-pill toggle for Post Now / Schedule. Choosing Schedule
            reveals the date + time pickers. The event stays hidden from
            the student/trainer feed until publish_at is reached — the
            backend filters on read, so no cron job is needed. */}
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
                  onPress={() => setTimeModalOpen(true)}
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

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* Time picker bottom sheet — two wheels: hours (12h) + minutes. */}
      <TimeWheelModal
        visible={timeModalOpen}
        initial={form.publish_time || defaultRoundedTime()}
        onCancel={() => setTimeModalOpen(false)}
        onDone={(hhmm) => {
          set('publish_time', hhmm);
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
                {form.publish_mode === 'later' ? 'Schedule event' : 'Publish event'}
              </Text>
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

function TimeWheelModal({ visible, initial, onCancel, onDone }) {
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
            <Text style={timeStyles.title}>Pick publish time</Text>
            <TouchableOpacity onPress={commit} hitSlop={8}>
              <Check size={20} color={BRAND} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <View style={timeStyles.wheels}>
            <Wheel
              data={hours}
              value={state.hour12}
              onChange={(v) => setState((s) => ({ ...s, hour12: v }))}
              render={(n) => String(n)}
            />
            <Text style={timeStyles.colon}>:</Text>
            <Wheel
              data={minutes}
              value={state.minute}
              onChange={(v) => setState((s) => ({ ...s, minute: v }))}
              render={(n) => String(n).padStart(2, '0')}
            />

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

          {/* Center-band highlight is a visual guide — no interaction. */}
          <View pointerEvents="none" style={timeStyles.centerBand} />
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
      style={{ height: WHEEL_H, width: 64 }}
      contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
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

  wheels: {
    marginTop: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: WHEEL_H,
  },
  colon: { fontSize: 22, fontWeight: '800', color: TEXT, marginHorizontal: 2 },

  centerBand: {
    position: 'absolute',
    left: 20, right: 20,
    top: 14 + 30 + 4 + ITEM_H * 2,   // header + spacing + 2 rows above center
    height: ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: BORDER,
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
