// src/screens/admin/InstitutionBrandingScreen.js
//
// Institution admin lands here from More → Branding. Manages promo
// banners that appear on the student and trainer mobile dashboards.
//
// CRUD against /api/institution-banners. Each banner has:
//   • image (uploaded via POST /api/uploads, path stored on the row)
//   • optional title + subtitle (overlay text)
//   • optional link URL (tap-through)
//   • audience: student / trainer / both (controls where it appears)
//   • active toggle + ordering (we expose active only; sort_order is
//     auto-set by creation date)

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, Alert,
  ActivityIndicator, StyleSheet, RefreshControl, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  ArrowLeft, Image as ImageIcon, Plus, Trash2, Eye, EyeOff, Edit3,
  Users, GraduationCap, Layers, Save, X as XIcon, Upload,
} from 'lucide-react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

const BRAND       = '#E63946';
const BG          = '#FAFAFC';
const SURFACE     = '#FFFFFF';
const TEXT        = '#0F172A';
const TEXT_MUTED  = '#64748B';
const TEXT_LIGHT  = '#94A3B8';
const BORDER      = '#E2E8F0';

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
const resolveAssetUrl = (src) => {
  if (!src) return null;
  if (src.startsWith('data:') || /^https?:\/\//i.test(src)) return src;
  if (src.startsWith('/')) return ASSET_HOST + src;
  return src;
};

const AUDIENCE_OPTIONS = [
  { key: 'student', label: 'Students',           icon: GraduationCap },
  { key: 'trainer', label: 'Trainers',           icon: Users },
  { key: 'both',    label: 'Both',               icon: Layers },
];

export default function InstitutionBrandingScreen({ navigation }) {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, row = edit

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/institution-banners');
      setBanners(r.data?.banners || []);
    } catch (err) {
      console.warn('[banners] load failed', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onDelete = (banner) => {
    confirm({
      title:           'Delete banner?',
      message:         'Students and trainers will stop seeing it immediately.',
      variant:         'destructive',
      confirmText:     'Delete',
      cancelText:      'Cancel',
      onConfirm: async () => {
        try {
          await apiClient.delete(`/institution-banners/${banner.id}`);
          setBanners((prev) => prev.filter((b) => b.id !== banner.id));
        } catch (err) {
          confirm({
            title:       'Could not delete',
            message:     err?.response?.data?.message || err?.message || 'Try again.',
            variant:     'warning',
            confirmText: 'OK',
            hideCancel:  true,
          });
        }
      },
    });
  };

  const onToggleActive = async (banner) => {
    try {
      const r = await apiClient.put(`/institution-banners/${banner.id}`, {
        is_active: !banner.is_active,
      });
      setBanners((prev) => prev.map((b) => (b.id === banner.id ? r.data.banner : b)));
    } catch (err) {
      confirm({
        title:       'Could not update',
        message:     err?.response?.data?.message || err?.message || 'Try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBack}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Branding · Banners</Text>
          <Text style={styles.headerSub}>
            Promo strips shown on student & trainer dashboards
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
      >
        {banners.length === 0 ? (
          <View style={styles.emptyCard}>
            <ImageIcon size={32} color={TEXT_LIGHT} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No banners yet</Text>
            <Text style={styles.emptySub}>
              Tap the + button to upload your first banner. Pick whether
              it shows to students, trainers, or both.
            </Text>
          </View>
        ) : (
          banners.map((b) => (
            <BannerRow
              key={b.id}
              banner={b}
              onEdit={() => setEditing(b)}
              onDelete={() => onDelete(b)}
              onToggleActive={() => onToggleActive(b)}
            />
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setEditing({})}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" strokeWidth={2.6} />
      </TouchableOpacity>

      {editing ? (
        <BannerEditorSheet
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, mode) => {
            setEditing(null);
            if (mode === 'create') setBanners((prev) => [saved, ...prev]);
            else setBanners((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
          }}
        />
      ) : null}
    </View>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────
function BannerRow({ banner, onEdit, onDelete, onToggleActive }) {
  const uri = resolveAssetUrl(banner.image_url);
  const audienceLabel = (
    AUDIENCE_OPTIONS.find((a) => a.key === banner.audience) || AUDIENCE_OPTIONS[2]
  ).label;
  return (
    <View style={[styles.row, !banner.is_active && { opacity: 0.6 }]}>
      <View style={styles.rowMedia}>
        {uri ? (
          <Image source={{ uri }} style={styles.rowImage} resizeMode="cover" />
        ) : (
          <ImageIcon size={20} color={TEXT_LIGHT} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {banner.title || 'Untitled banner'}
        </Text>
        {banner.subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>{banner.subtitle}</Text>
        ) : null}
        <View style={styles.rowMeta}>
          <View style={[styles.audChip, audChipStyle(banner.audience)]}>
            <Text style={[styles.audChipText, audChipText(banner.audience)]}>{audienceLabel}</Text>
          </View>
          <Text style={styles.statusText}>
            {banner.is_active ? '● Active' : '○ Hidden'}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity onPress={onToggleActive} style={styles.iconBtn} hitSlop={6}>
          {banner.is_active
            ? <EyeOff size={16} color={TEXT_MUTED} strokeWidth={2.2} />
            : <Eye size={16} color={TEXT_MUTED} strokeWidth={2.2} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={onEdit} style={styles.iconBtn} hitSlop={6}>
          <Edit3 size={16} color={TEXT_MUTED} strokeWidth={2.2} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn} hitSlop={6}>
          <Trash2 size={16} color={BRAND} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function audChipStyle(a) {
  if (a === 'student') return { backgroundColor: '#DBEAFE', borderColor: '#93C5FD' };
  if (a === 'trainer') return { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' };
  return                     { backgroundColor: '#FCE7F3', borderColor: '#F9A8D4' };
}
function audChipText(a) {
  if (a === 'student') return { color: '#1E40AF' };
  if (a === 'trainer') return { color: '#166534' };
  return                     { color: '#9D174D' };
}

// ─── Editor sheet ──────────────────────────────────────────────────────
function BannerEditorSheet({ initial, onClose, onSaved }) {
  const isEdit = !!initial?.id;
  // Edit mode: one image. Create mode: an array so the admin can pick
  // several photos in a single trip to the gallery and publish them all
  // with the same title / subtitle / audience.
  const [imageUrls, setImageUrls] = useState(
    initial?.image_url ? [initial.image_url] : [],
  );
  const [title, setTitle]         = useState(initial?.title || '');
  const [subtitle, setSubtitle]   = useState(initial?.subtitle || '');
  const [linkUrl, setLinkUrl]     = useState(initial?.link_url || '');
  const [audience, setAudience]   = useState(initial?.audience || 'both');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);

  const pickImage = () => {
    Alert.alert('Upload banner', 'Choose how to add the image:', [
      { text: isEdit ? 'Gallery' : 'Gallery (pick many)', onPress: () => fromGallery() },
      { text: 'Camera',  onPress: () => fromCamera() },
      { text: 'Cancel',  style: 'cancel' },
    ]);
  };

  // Multi-select gallery — selectionLimit: 0 = unlimited. In edit mode
  // we cap to 1 because the row is a single banner; in create mode the
  // admin can grab many at once and we publish each as its own banner.
  const fromGallery = () => launchImageLibrary(
    {
      mediaType: 'photo',
      quality: 0.85,
      maxWidth: 1600,
      maxHeight: 1000,
      selectionLimit: isEdit ? 1 : 0,
    },
    (resp) => {
      if (resp.didCancel || resp.errorCode) return;
      const picks = resp.assets || [];
      if (picks.length === 0) return;
      if (isEdit) {
        uploadOne(picks[0]).then((path) => { if (path) setImageUrls([path]); });
      } else {
        uploadMany(picks);
      }
    },
  );

  const fromCamera = () => launchCamera(
    { mediaType: 'photo', quality: 0.85, maxWidth: 1600, maxHeight: 1000 },
    (resp) => {
      if (resp.didCancel || resp.errorCode || !resp.assets?.[0]) return;
      uploadOne(resp.assets[0]).then((path) => {
        if (!path) return;
        if (isEdit) setImageUrls([path]);
        else setImageUrls((prev) => [...prev, path]);
      });
    },
  );

  // Single upload — returns the stored path (or null on failure).
  const uploadOne = async (asset) => {
    try {
      const fd = new FormData();
      fd.append('file', {
        uri:  asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'banner.jpg',
      });
      const res = await apiClient.post('/uploads?name_hint=banner', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data?.path || null;
    } catch (err) {
      console.warn('[banner upload]', err?.message);
      return null;
    }
  };

  // Many — uploads in parallel, appends successes to the carousel and
  // surfaces a single dialog if any failed.
  const uploadMany = async (assets) => {
    setUploading(true);
    try {
      const paths = await Promise.all(assets.map(uploadOne));
      const ok   = paths.filter(Boolean);
      const fail = paths.length - ok.length;
      if (ok.length) setImageUrls((prev) => [...prev, ...ok]);
      if (fail > 0) {
        confirm({
          title:       fail === paths.length ? 'Upload failed' : 'Some uploads failed',
          message:     `${fail} of ${paths.length} image${paths.length === 1 ? '' : 's'} couldn't be uploaded. Try smaller files.`,
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx) => setImageUrls((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (imageUrls.length === 0) {
      confirm({
        title:       'Pick an image first',
        message:     'Tap the upload area to add at least one banner image.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    setSaving(true);
    try {
      // Edit mode = single PUT. Create mode = one POST per picked image
      // so each becomes its own banner row, all sharing the same
      // title / subtitle / link / audience.
      if (isEdit) {
        const res = await apiClient.put(`/institution-banners/${initial.id}`, {
          image_url: imageUrls[0],
          title:     title.trim() || null,
          subtitle:  subtitle.trim() || null,
          link_url:  linkUrl.trim() || null,
          audience,
        });
        onSaved(res.data.banner, 'edit');
      } else {
        const results = await Promise.all(
          imageUrls.map((image_url) =>
            apiClient.post('/institution-banners', {
              image_url,
              title:    title.trim() || null,
              subtitle: subtitle.trim() || null,
              link_url: linkUrl.trim() || null,
              audience,
            }).then((r) => r.data?.banner).catch(() => null),
          ),
        );
        const created = results.filter(Boolean);
        if (created.length === 0) {
          throw new Error('No banners were created');
        }
        // Pass each created banner through onSaved one by one — the
        // parent prepends them so the carousel ends up in the picker order.
        // We pass the most recent first so the list reads top-to-bottom.
        [...created].reverse().forEach((b) => onSaved(b, 'create'));
        // The reverse() loop above already called onClose() implicitly
        // through the parent's setEditing(null) handler on the first
        // call, but that's fine — subsequent calls just update state.
      }
    } catch (err) {
      confirm({
        title:       'Could not save',
        message:     err?.response?.data?.message || err?.message || 'Try again.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.sheetBackdrop}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{isEdit ? 'Edit banner' : 'New banner'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={6}>
              <XIcon size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Image picker — single tile when empty / editing, or a
                horizontal thumbnail strip when several images are picked.
                Each thumbnail has a small × to remove just that image
                from the batch before publishing. */}
            {imageUrls.length === 0 ? (
              <TouchableOpacity
                onPress={pickImage}
                style={styles.uploadCard}
                activeOpacity={0.85}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color={BRAND} />
                ) : (
                  <>
                    <Upload size={22} color={BRAND} strokeWidth={2.2} />
                    <Text style={styles.uploadTitle}>
                      {isEdit ? 'Tap to pick image' : 'Tap to pick one or many images'}
                    </Text>
                    <Text style={styles.uploadHint}>Wide images work best (16:9 / 16:10)</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
                >
                  {imageUrls.map((url, idx) => (
                    <View key={`${url}-${idx}`} style={styles.thumbWrap}>
                      <Image
                        source={{ uri: resolveAssetUrl(url) }}
                        style={styles.thumb}
                        resizeMode="cover"
                      />
                      <TouchableOpacity
                        onPress={() => removeImage(idx)}
                        style={styles.thumbRemove}
                        hitSlop={4}
                      >
                        <XIcon size={11} color="#fff" strokeWidth={3} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {!isEdit ? (
                    <TouchableOpacity
                      onPress={pickImage}
                      style={[styles.thumbWrap, styles.thumbAdd]}
                      activeOpacity={0.85}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <ActivityIndicator color={BRAND} size="small" />
                      ) : (
                        <Plus size={20} color={BRAND} strokeWidth={2.4} />
                      )}
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
                <Text style={styles.thumbCount}>
                  {isEdit
                    ? '1 image'
                    : `${imageUrls.length} image${imageUrls.length === 1 ? '' : 's'} ready · they'll all share the title, subtitle, and audience below.`}
                </Text>
              </>
            )}

            {/* Title */}
            <Text style={styles.label}>Title <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Summer Camp 2026"
              placeholderTextColor={TEXT_LIGHT}
              value={title}
              onChangeText={setTitle}
              maxLength={150}
            />

            {/* Subtitle */}
            <Text style={styles.label}>Subtitle <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              placeholder="One short line of supporting copy"
              placeholderTextColor={TEXT_LIGHT}
              value={subtitle}
              onChangeText={setSubtitle}
              multiline
              maxLength={300}
            />

            {/* Link URL */}
            <Text style={styles.label}>Link URL <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="https://…"
              placeholderTextColor={TEXT_LIGHT}
              value={linkUrl}
              onChangeText={setLinkUrl}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={500}
            />

            {/* Audience picker */}
            <Text style={styles.label}>Show to *</Text>
            <View style={styles.audRow}>
              {AUDIENCE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = audience === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setAudience(opt.key)}
                    style={[styles.audBtn, active && styles.audBtnActive]}
                    activeOpacity={0.85}
                  >
                    <Icon
                      size={14}
                      color={active ? '#fff' : TEXT_MUTED}
                      strokeWidth={2.4}
                    />
                    <Text style={[styles.audBtnText, active && styles.audBtnTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.sheetFooter}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.footerBtn, styles.footerBtnGhost]}
              activeOpacity={0.85}
            >
              <Text style={styles.footerBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              disabled={saving || uploading}
              style={[styles.footerBtn, styles.footerBtnPrimary, (saving || uploading) && { opacity: 0.7 }]}
              activeOpacity={0.9}
            >
              <Save size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.footerBtnPrimaryText}>
                {saving
                  ? 'Saving…'
                  : isEdit
                    ? 'Save changes'
                    : `Publish ${imageUrls.length || ''} banner${imageUrls.length === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerBack: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  emptyCard: {
    alignItems: 'center', padding: 28, gap: 8,
    backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: TEXT, marginTop: 4 },
  emptySub:   { fontSize: 12, color: TEXT_MUTED, textAlign: 'center', lineHeight: 17, paddingHorizontal: 8 },

  // Row
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 10,
    marginBottom: 10,
  },
  rowMedia: {
    width: 64, height: 64, borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  rowImage: { width: '100%', height: '100%' },
  rowTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  rowSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  audChip: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1,
  },
  audChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  statusText:  { fontSize: 10, color: TEXT_MUTED, fontWeight: '700' },
  rowActions:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 28, right: 18,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    elevation: 6,
  },

  // Editor sheet
  sheetBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
    zIndex: 99,
  },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: TEXT },

  uploadCard: {
    height: 160, borderRadius: 14,
    backgroundColor: '#FFF5F5',
    borderWidth: 1, borderColor: '#FECDD3', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    gap: 4, overflow: 'hidden',
  },
  uploadPreview: { width: '100%', height: '100%' },
  uploadTitle: { fontSize: 13, fontWeight: '800', color: TEXT, marginTop: 4 },
  uploadHint:  { fontSize: 11, color: TEXT_MUTED },
  replaceLink: { fontSize: 12, color: BRAND, fontWeight: '700' },

  // Multi-image thumbnail strip
  thumbWrap: {
    width: 110, height: 70, borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: BORDER,
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(15,23,42,0.78)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbAdd: {
    alignItems: 'center', justifyContent: 'center',
    borderStyle: 'dashed', borderColor: '#FECDD3',
    backgroundColor: '#FFF5F5',
  },
  thumbCount: {
    marginTop: 6,
    fontSize: 11, color: TEXT_MUTED, fontWeight: '600',
    lineHeight: 15,
  },

  label:    { fontSize: 12, fontWeight: '800', color: TEXT_MUTED, marginTop: 14, marginBottom: 6, letterSpacing: 0.3 },
  optional: { fontWeight: '600', color: TEXT_LIGHT },
  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, color: TEXT,
  },

  audRow: { flexDirection: 'row', gap: 8 },
  audBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: BORDER,
  },
  audBtnActive: { backgroundColor: BRAND, borderColor: BRAND },
  audBtnText:  { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  audBtnTextActive: { color: '#fff', fontWeight: '800' },

  sheetFooter: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: BORDER,
    backgroundColor: '#F8FAFC',
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 12,
  },
  footerBtnGhost:        { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  footerBtnGhostText:    { fontSize: 13, fontWeight: '700', color: TEXT_MUTED },
  footerBtnPrimary:      { backgroundColor: BRAND },
  footerBtnPrimaryText:  { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
});
