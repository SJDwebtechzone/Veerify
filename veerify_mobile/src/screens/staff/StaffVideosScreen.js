// src/screens/staff/StaffVideosScreen.js
//
// Trainer-side upload + management screen for course videos. Lets the
// trainer pick one of their assigned batches and:
//   - Paste a video URL (YouTube / Vimeo / direct MP4) OR upload a file
//   - Add a title + optional description + duration
//   - See the list of videos they've already uploaded for that batch
//   - Delete a video they uploaded
//
// Backend:
//   GET    /api/batches/trainer/my            list assigned batches
//   GET    /api/course-videos/batch/:id       list videos for selected batch
//   POST   /api/course-videos                 create
//   DELETE /api/course-videos/:id             delete
//   POST   /api/uploads                       optional file upload

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
  RefreshControl, Image, Linking, Modal, FlatList,
} from 'react-native';
import {
  ArrowLeft, Video, Upload, Link2, Trash2, Plus, Clock, GraduationCap,
  ChevronDown, ChevronUp, X, PlayCircle, Loader, Calendar, Check,
} from 'lucide-react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import DateField from '../../components/DateField';

import apiClient from '../../api/client';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

function fmtDuration(seconds) {
  if (!seconds) return null;
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function StaffVideosScreen({ navigation }) {
  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);

  const [videos, setVideos] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Add-video form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', video_url: '', thumbnail_url: '',
    duration_seconds: '',
    kind: 'recorded',           // 'recorded' | 'live'
    scheduled_at: '',           // ISO string, only used when kind === 'live'
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || null,
    [batches, selectedBatchId],
  );

  // ── Load assigned batches once ────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/batches/trainer/my');
        const list = res.data?.batches || [];
        setBatches(list);
        if (list.length > 0) setSelectedBatchId(list[0].id);
      } catch (err) {
        console.log('[Videos] batches load failed:', err.message);
      } finally {
        setLoadingBatches(false);
      }
    })();
  }, []);

  // ── Load videos when batch changes ──────────────────────────────
  const loadVideos = useCallback(async () => {
    if (!selectedBatchId) {
      setVideos([]);
      return;
    }
    setLoadingVideos(true);
    try {
      const res = await apiClient.get(`/course-videos/batch/${selectedBatchId}`);
      setVideos(res.data?.videos || []);
    } catch (err) {
      console.log('[Videos] list load failed:', err.message);
    } finally {
      setLoadingVideos(false);
      setRefreshing(false);
    }
  }, [selectedBatchId]);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  // ── Pick + upload file ─────────────────────────────────────────────
  const pickAndUploadVideo = () => {
    launchImageLibrary(
      { mediaType: 'video', selectionLimit: 1 },
      async (resp) => {
        if (resp.didCancel || resp.errorCode || !resp.assets?.[0]) return;
        const asset = resp.assets[0];
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append('file', {
            uri: asset.uri,
            type: asset.type || 'video/mp4',
            name: asset.fileName || 'video.mp4',
          });
          const res = await apiClient.post('/uploads', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const url = res.data?.url;
          if (url) {
            setForm((p) => ({ ...p, video_url: url }));
          } else {
            Alert.alert('Upload failed', 'No URL returned.');
          }
        } catch (err) {
          Alert.alert('Upload failed', err?.response?.data?.message || 'Try a smaller file.');
        } finally {
          setUploading(false);
        }
      },
    );
  };

  // ── Submit ─────────────────────────────────────────────────────────
  const submit = async () => {
    if (!selectedBatchId) {
      Alert.alert('Pick a batch', 'Choose which batch this video is for.');
      return;
    }
    if (!form.title.trim()) {
      Alert.alert('Title required', 'Give the video a short title.');
      return;
    }
    if (!form.video_url.trim()) {
      Alert.alert('Video URL required', 'Paste a video link or upload a file.');
      return;
    }
    if (form.kind === 'live' && !form.scheduled_at) {
      Alert.alert('Schedule required', 'Pick a date and time for this live session.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/course-videos', {
        batch_id: selectedBatchId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        video_url: form.video_url.trim(),
        thumbnail_url: form.thumbnail_url.trim() || null,
        duration_seconds: form.duration_seconds ? Number(form.duration_seconds) : null,
        kind: form.kind,
        scheduled_at: form.kind === 'live' ? form.scheduled_at : null,
      });
      setForm({
        title: '', description: '', video_url: '', thumbnail_url: '',
        duration_seconds: '',
        kind: 'recorded', scheduled_at: '',
      });
      setShowForm(false);
      loadVideos();
    } catch (err) {
      Alert.alert(
        form.kind === 'live' ? 'Post failed' : 'Upload failed',
        err?.response?.data?.message || 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────
  const handleDelete = (video) => {
    Alert.alert(
      'Delete video?',
      `"${video.title}" will be removed from the batch. Students who downloaded it can still keep the file.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/course-videos/${video.id}`);
              loadVideos();
            } catch (err) {
              Alert.alert('Error', err?.response?.data?.message || 'Failed to delete.');
            }
          },
        },
      ],
    );
  };

  // ── Render ─────────────────────────────────────────────────────────
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
          <Text style={styles.headerTitle}>Recorded Videos</Text>
          <Text style={styles.headerSub}>
            Share videos with your batch students
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadVideos(); }}
            tintColor={BRAND}
          />
        }
      >
        {/* Batch picker */}
        <SectionLabel>BATCH</SectionLabel>
        <TouchableOpacity
          style={styles.batchPickerBtn}
          onPress={() => setBatchPickerOpen((o) => !o)}
          disabled={loadingBatches || batches.length === 0}
          activeOpacity={0.85}
        >
          <View style={styles.batchPickerLeft}>
            <View style={styles.batchIcon}>
              <GraduationCap size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {loadingBatches ? (
                <Text style={styles.batchName}>Loading batches…</Text>
              ) : !selectedBatch ? (
                <Text style={styles.batchName}>No batches assigned</Text>
              ) : (
                <>
                  <Text style={styles.batchName} numberOfLines={1}>{selectedBatch.name}</Text>
                  <Text style={styles.batchSub} numberOfLines={1}>
                    {selectedBatch.course_name || ''}
                    {selectedBatch.days_of_week ? ` · ${selectedBatch.days_of_week}` : ''}
                  </Text>
                </>
              )}
            </View>
          </View>
          {batches.length > 1 ? (
            batchPickerOpen ? (
              <ChevronUp size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            ) : (
              <ChevronDown size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            )
          ) : null}
        </TouchableOpacity>

        {batchPickerOpen && batches.length > 1 ? (
          <View style={styles.batchList}>
            {batches.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={[
                  styles.batchListItem,
                  selectedBatchId === b.id && styles.batchListItemOn,
                ]}
                onPress={() => {
                  setSelectedBatchId(b.id);
                  setBatchPickerOpen(false);
                }}
                activeOpacity={0.85}
              >
                <Text style={[
                  styles.batchListItemText,
                  selectedBatchId === b.id && styles.batchListItemTextOn,
                ]} numberOfLines={1}>
                  {b.name}
                </Text>
                {b.days_of_week ? (
                  <Text style={styles.batchListItemSub} numberOfLines={1}>
                    {b.days_of_week}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Add video toggle / form */}
        {selectedBatchId ? (
          <>
            {showForm ? (
              <View style={styles.formCard}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>
                    {form.kind === 'live' ? 'Post a live session' : 'Add a video'}
                  </Text>
                  <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
                    <X size={18} color={TEXT_MUTED} strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>

                {/* Kind toggle — Recorded vs Live. The live branch reveals a
                    scheduled-at field below; both branches share the same
                    title/description/url inputs. */}
                <View style={styles.kindToggle}>
                  {[
                    { key: 'recorded', label: 'Recorded video', icon: Video },
                    { key: 'live',     label: 'Live session',   icon: PlayCircle },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const active = form.kind === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => setForm((p) => ({ ...p, kind: opt.key }))}
                        activeOpacity={0.85}
                        style={[styles.kindOption, active && styles.kindOptionActive]}
                      >
                        <Icon
                          size={14}
                          color={active ? '#fff' : TEXT_MUTED}
                          strokeWidth={2.4}
                        />
                        <Text style={[styles.kindOptionText, active && styles.kindOptionTextActive]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Field label="Title" required>
                  <TextInput
                    style={styles.input}
                    placeholder={
                      form.kind === 'live'
                        ? 'e.g. Saturday morning sparring'
                        : 'e.g. Lesson 1 - Stance & Footwork'
                    }
                    placeholderTextColor={TEXT_LIGHT}
                    value={form.title}
                    onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
                    maxLength={200}
                  />
                </Field>

                {/* Live-only: date + time selection. Date picks an ISO day
                    via the shared DateField; time uses a custom Hour /
                    Minute / AM·PM picker rendered in a modal. The two
                    combine into an ISO 'YYYY-MM-DDTHH:mm' string in
                    form.scheduled_at. */}
                {form.kind === 'live' ? (
                  <Field label="Scheduled at" required hint="When the session goes live (your local time).">
                    <ScheduleField
                      value={form.scheduled_at}
                      onChange={(iso) => setForm((p) => ({ ...p, scheduled_at: iso }))}
                    />
                  </Field>
                ) : null}

                <Field label="Description">
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    placeholder="What does this video cover?"
                    placeholderTextColor={TEXT_LIGHT}
                    value={form.description}
                    onChangeText={(v) => setForm((p) => ({ ...p, description: v }))}
                    multiline
                    textAlignVertical="top"
                  />
                </Field>

                <Field
                  label={form.kind === 'live' ? 'Join link' : 'Video'}
                  required
                  hint={
                    form.kind === 'live'
                      ? 'Paste your Google Meet, Zoom, Jitsi, YouTube Live or any join URL — students tap to open it in the right app.'
                      : 'Paste a YouTube / Vimeo URL or upload an MP4.'
                  }
                >
                  <View style={{ gap: 8 }}>
                    <TextInput
                      style={styles.input}
                      placeholder={
                        form.kind === 'live'
                          ? 'https://meet.google.com/abc-defg-hij'
                          : 'https://youtube.com/watch?v=...'
                      }
                      placeholderTextColor={TEXT_LIGHT}
                      value={form.video_url}
                      onChangeText={(v) => setForm((p) => ({ ...p, video_url: v }))}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                    {/* File upload only makes sense for recorded videos — a
                        live session is always a join URL, never an MP4. */}
                    {form.kind === 'recorded' ? (
                      <TouchableOpacity
                        style={styles.uploadBtn}
                        onPress={pickAndUploadVideo}
                        disabled={uploading}
                        activeOpacity={0.85}
                      >
                        {uploading ? (
                          <ActivityIndicator color={BRAND} size="small" />
                        ) : (
                          <>
                            <Upload size={14} color={BRAND} strokeWidth={2.4} />
                            <Text style={styles.uploadBtnText}>
                              {form.video_url ? 'Replace with file' : 'Upload from device'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </Field>

                <Field label="Thumbnail URL" hint="Optional preview image.">
                  <TextInput
                    style={styles.input}
                    placeholder="https://..."
                    placeholderTextColor={TEXT_LIGHT}
                    value={form.thumbnail_url}
                    onChangeText={(v) => setForm((p) => ({ ...p, thumbnail_url: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>

                <Field label="Duration (seconds)">
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 720"
                    placeholderTextColor={TEXT_LIGHT}
                    value={form.duration_seconds}
                    onChangeText={(v) => setForm((p) => ({ ...p, duration_seconds: v.replace(/[^0-9]/g, '') }))}
                    keyboardType="numeric"
                    maxLength={6}
                  />
                </Field>

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Upload size={14} color="#fff" strokeWidth={2.4} />
                      <Text style={styles.submitBtnText}>Share with batch</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addCard}
                onPress={() => setShowForm(true)}
                activeOpacity={0.85}
              >
                <View style={styles.addCardIcon}>
                  <Plus size={18} color={BRAND} strokeWidth={2.6} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addCardTitle}>Add a session</Text>
                  <Text style={styles.addCardSub}>
                    Post a recorded video or a live join link for this batch
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Videos list */}
            <SectionLabel style={{ marginTop: 20 }}>
              SHARED VIDEOS{videos.length > 0 ? ` · ${videos.length}` : ''}
            </SectionLabel>

            {loadingVideos ? (
              <ActivityIndicator color={BRAND} style={{ marginVertical: 20 }} />
            ) : videos.length === 0 ? (
              <View style={styles.emptyCard}>
                <Video size={28} color={TEXT_LIGHT} strokeWidth={1.6} />
                <Text style={styles.emptyTitle}>No videos shared yet</Text>
                <Text style={styles.emptySub}>
                  Add your first video so students in this batch can watch it from their dashboard.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {videos.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    onOpen={() => v.video_url && Linking.openURL(v.video_url).catch(() => {})}
                    onDelete={() => handleDelete(v)}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────
function SectionLabel({ children, style }) {
  return (
    <Text style={[styles.sectionLabel, style]}>{children}</Text>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>
        {label}{required ? <Text style={{ color: BRAND }}> *</Text> : null}
      </Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function VideoCard({ video, onOpen, onDelete }) {
  const thumb = resolveAssetUrl(video.thumbnail_url);
  const duration = fmtDuration(video.duration_seconds);
  const created = video.created_at
    ? new Date(video.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : '';

  return (
    <View style={styles.videoCard}>
      <TouchableOpacity
        style={styles.videoThumbWrap}
        onPress={onOpen}
        activeOpacity={0.85}
      >
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.videoThumb} />
        ) : (
          <View style={[styles.videoThumb, styles.videoThumbFallback]} />
        )}
        <View style={styles.playOverlay}>
          <PlayCircle size={28} color="#fff" strokeWidth={2.2} />
        </View>
      </TouchableOpacity>

      <View style={styles.videoBody}>
        <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
        {video.description ? (
          <Text style={styles.videoDesc} numberOfLines={2}>{video.description}</Text>
        ) : null}
        <View style={styles.videoMetaRow}>
          {video.kind === 'live' ? (
            <View style={[styles.videoMetaPill, { backgroundColor: BRAND_SOFT }]}>
              <PlayCircle size={9} color={BRAND} strokeWidth={2.4} />
              <Text style={[styles.videoMetaText, { color: BRAND }]}>LIVE</Text>
            </View>
          ) : null}
          {video.scheduled_at ? (
            <View style={styles.videoMetaPill}>
              <Calendar size={9} color={TEXT_MUTED} strokeWidth={2.4} />
              <Text style={styles.videoMetaText}>
                {new Date(video.scheduled_at).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          ) : null}
          {duration ? (
            <View style={styles.videoMetaPill}>
              <Clock size={9} color={TEXT_MUTED} strokeWidth={2.4} />
              <Text style={styles.videoMetaText}>{duration}</Text>
            </View>
          ) : null}
          {created ? (
            <View style={styles.videoMetaPill}>
              <Calendar size={9} color={TEXT_MUTED} strokeWidth={2.4} />
              <Text style={styles.videoMetaText}>{created}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={onDelete}
        hitSlop={6}
        activeOpacity={0.7}
      >
        <Trash2 size={14} color={BRAND} strokeWidth={2.4} />
      </TouchableOpacity>
    </View>
  );
}

// ─── ScheduleField (date + time picker) ────────────────────────────────
// Date is picked via the shared DateField (YYYY-MM-DD). Time is picked via
// a modal with three columns: hour (1-12), minute (00, 05, ... 55), AM/PM.
// Output is an ISO 'YYYY-MM-DDTHH:mm' string in 24h time.

const HOURS_12   = Array.from({ length: 12 }, (_, i) => i + 1);                     // 1..12
const MINUTES    = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')); // 00, 05, ..., 55
const PERIODS    = ['AM', 'PM'];

// Parse 'YYYY-MM-DDTHH:mm' (or partial) into { date, hour12, minute, period }.
function parseScheduledIso(iso) {
  if (!iso) return { date: '', hour12: 9, minute: '00', period: 'AM' };
  const [dPart, tPart = ''] = iso.split('T');
  const [hStr = '9', mStr = '00'] = tPart.split(':');
  const h24 = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { date: dPart || '', hour12: h12, minute: String(parseInt(mStr, 10) || 0).padStart(2, '0'), period };
}

function buildScheduledIso(date, hour12, minute, period) {
  if (!date) return '';
  let h24 = hour12 % 12;
  if (period === 'PM') h24 += 12;
  return `${date}T${String(h24).padStart(2, '0')}:${minute}`;
}

function ScheduleField({ value, onChange }) {
  const parts = parseScheduledIso(value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftHour,   setDraftHour]   = useState(parts.hour12);
  const [draftMin,    setDraftMin]    = useState(parts.minute);
  const [draftPeriod, setDraftPeriod] = useState(parts.period);

  const onDateChange = (newDate) => {
    onChange(buildScheduledIso(newDate, parts.hour12, parts.minute, parts.period));
  };

  const openTimePicker = () => {
    setDraftHour(parts.hour12);
    setDraftMin(parts.minute);
    setDraftPeriod(parts.period);
    setPickerOpen(true);
  };

  const confirmTime = () => {
    setPickerOpen(false);
    onChange(buildScheduledIso(parts.date, draftHour, draftMin, draftPeriod));
  };

  const timeLabel = parts.date
    ? `${parts.hour12}:${parts.minute} ${parts.period}`
    : 'Pick date first';

  return (
    <View style={{ gap: 8 }}>
      <DateField
        value={parts.date}
        onChange={onDateChange}
        placeholder="Pick date"
        accent={BRAND}
        minYear={new Date().getFullYear()}
      />

      <TouchableOpacity
        onPress={openTimePicker}
        disabled={!parts.date}
        activeOpacity={0.85}
        style={[styles.timeTrigger, !parts.date && { opacity: 0.5 }]}
      >
        <Clock size={14} color={TEXT_MUTED} strokeWidth={2.2} />
        <Text style={styles.timeTriggerText}>{timeLabel}</Text>
        <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.2} />
      </TouchableOpacity>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.timeModalOverlay}
          onPress={() => setPickerOpen(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.timeModalCard}
            onPress={() => {} /* swallow */}
          >
            <Text style={styles.timeModalTitle}>Pick time</Text>

            <View style={styles.timeColumnsRow}>
              {/* Hour column */}
              <PickerColumn
                label="Hour"
                items={HOURS_12.map(String)}
                selected={String(draftHour)}
                onSelect={(v) => setDraftHour(Number(v))}
              />
              {/* Minute column */}
              <PickerColumn
                label="Minute"
                items={MINUTES}
                selected={draftMin}
                onSelect={setDraftMin}
              />
              {/* AM/PM column */}
              <PickerColumn
                label="Period"
                items={PERIODS}
                selected={draftPeriod}
                onSelect={setDraftPeriod}
              />
            </View>

            <View style={styles.timeModalActions}>
              <TouchableOpacity
                style={[styles.timeModalBtn, styles.timeModalBtnGhost]}
                onPress={() => setPickerOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.timeModalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.timeModalBtn, styles.timeModalBtnPrimary]}
                onPress={confirmTime}
                activeOpacity={0.85}
              >
                <Check size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.timeModalBtnPrimaryText}>Set</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function PickerColumn({ label, items, selected, onSelect }) {
  return (
    <View style={styles.pickerColumn}>
      <Text style={styles.pickerColumnLabel}>{label}</Text>
      <FlatList
        data={items}
        keyExtractor={(it) => it}
        showsVerticalScrollIndicator={false}
        style={styles.pickerColumnList}
        renderItem={({ item }) => {
          const active = item === selected;
          return (
            <TouchableOpacity
              onPress={() => onSelect(item)}
              activeOpacity={0.85}
              style={[styles.pickerItem, active && styles.pickerItemActive]}
            >
              <Text style={[styles.pickerItemText, active && styles.pickerItemTextActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header
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

  // Section label
  sectionLabel: {
    fontSize: 10, color: TEXT_LIGHT, fontWeight: '800',
    letterSpacing: 1.4, marginBottom: 8,
  },

  // Batch picker
  batchPickerBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  batchPickerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  batchIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  batchName: { fontSize: 14, color: TEXT, fontWeight: '800' },
  batchSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  batchList: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    marginTop: 6,
    overflow: 'hidden',
  },
  batchListItem: {
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  batchListItemOn: { backgroundColor: BRAND_SOFT },
  batchListItemText: { fontSize: 13, color: TEXT, fontWeight: '700' },
  batchListItemTextOn: { color: BRAND },
  batchListItemSub: { fontSize: 10, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  // Add card
  addCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 20,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: BRAND,
  },
  addCardIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  addCardTitle: { fontSize: 14, color: TEXT, fontWeight: '800' },
  addCardSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  // Form
  formCard: {
    marginTop: 20,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  formHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  formTitle: { fontSize: 15, color: TEXT, fontWeight: '800' },

  // Kind toggle (Recorded / Live)
  kindToggle: {
    flexDirection: 'row',
    backgroundColor: BG,
    borderRadius: 999,
    padding: 4,
    marginBottom: 12,
  },
  kindOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 999,
  },
  kindOptionActive: {
    backgroundColor: BRAND,
  },
  kindOptionText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '700' },
  kindOptionTextActive: { color: '#fff' },

  // Time-picker trigger row (shown under DateField for the scheduled_at flow)
  timeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  timeTriggerText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '600' },

  // Time picker modal
  timeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  timeModalCard: {
    width: '100%',
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 16,
  },
  timeModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 12,
    textAlign: 'center',
  },
  timeColumnsRow: {
    flexDirection: 'row',
    gap: 8,
    height: 200,
  },
  pickerColumn: { flex: 1 },
  pickerColumnLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  pickerColumnList: {
    flex: 1,
    backgroundColor: BG,
    borderRadius: 10,
  },
  pickerItem: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickerItemActive: {
    backgroundColor: BRAND_SOFT,
  },
  pickerItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  pickerItemTextActive: { color: BRAND, fontWeight: '800' },

  timeModalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  timeModalBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  timeModalBtnGhost: { backgroundColor: BG },
  timeModalBtnGhostText: { fontSize: 13, color: TEXT, fontWeight: '700' },
  timeModalBtnPrimary: { backgroundColor: BRAND },
  timeModalBtnPrimaryText: { fontSize: 13, color: '#fff', fontWeight: '800' },

  label: { fontSize: 12, fontWeight: '800', color: TEXT, marginBottom: 6, letterSpacing: 0.3 },
  hint: { fontSize: 11, color: TEXT_MUTED, marginTop: 4, lineHeight: 16 },

  input: {
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, color: TEXT,
  },
  textarea: { minHeight: 70, paddingTop: 10 },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  uploadBtnText: { fontSize: 12, color: BRAND, fontWeight: '800' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  submitBtnText: { fontSize: 14, color: '#fff', fontWeight: '800' },

  // Empty list
  emptyCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1, borderColor: BORDER,
  },
  emptyTitle: { fontSize: 13, color: TEXT, fontWeight: '800', marginTop: 4 },
  emptySub: { fontSize: 11, color: TEXT_MUTED, textAlign: 'center', lineHeight: 16 },

  // Video card
  videoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  videoThumbWrap: { position: 'relative' },
  videoThumb: { width: 80, height: 60, borderRadius: 8, backgroundColor: '#1F2937' },
  videoThumbFallback: { backgroundColor: '#1F2937' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
  },
  videoBody: { flex: 1, gap: 2 },
  videoTitle: { fontSize: 13, color: TEXT, fontWeight: '800' },
  videoDesc: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },
  videoMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  videoMetaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: BG,
    borderRadius: 999,
  },
  videoMetaText: { fontSize: 9, color: TEXT_MUTED, fontWeight: '800' },

  deleteBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
});
