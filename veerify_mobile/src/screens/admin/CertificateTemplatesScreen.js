// src/screens/admin/CertificateTemplatesScreen.js
//
// Institution Login → More → Certificate Templates. Multi-select list
// of the academy's certificate templates. Each row shows the template's
// name, background thumbnail, placeholder count, and default badge.
// Actions per row: Edit, Preview, Delete, Set Default.
//
// Tap the + FAB to upload a new background and drop into the editor.
//
// Backend:
//   GET    /api/certificate-templates
//   POST   /api/certificate-templates
//   DELETE /api/certificate-templates/:id
//   POST   /api/certificate-templates/:id/default
//   POST   /api/uploads?name_hint=cert-template     (for the background)

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Plus, Award, Star, Eye, Trash2, Pencil, FileText, Image as ImageIcon,
} from 'lucide-react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import resolveAssetUrl from '../../utils/assetUrl';

export default function CertificateTemplatesScreen({ navigation }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/certificate-templates');
      setTemplates(r.data?.templates || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[CertificateTemplates] load error:', err?.response?.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickAndUpload = () => {
    // `quality: 0.6` + max width 1600 keeps template backgrounds under
    // ~1 MB even for large gallery photos — well below the 10 MB cap on
    // the backend and the axios timeout window.
    launchImageLibrary(
      {
        mediaType:      'photo',
        selectionLimit: 1,
        quality:        0.6,
        maxWidth:       1600,
        maxHeight:      1600,
        includeBase64:  false,
      },
      async (resp) => {
        if (resp.didCancel || !resp.assets?.length) return;
        const asset = resp.assets[0];
        setUploading(true);
        try {
          // Multipart uploads on the Android emulator's 10.0.2.2 loopback
          // frequently exceed the default 10 s axios timeout — bump it
          // to 60 s just for THIS request so we don't blanket the whole
          // app in slower defaults.
          const fd = new FormData();
          fd.append('file', {
            uri:  asset.uri,
            type: asset.type || 'image/jpeg',
            name: asset.fileName || 'cert-template.jpg',
          });
          // eslint-disable-next-line no-console
          console.log('[CertTemplates] uploading', {
            size: asset.fileSize, uri: asset.uri, type: asset.type,
          });
          const upl = await apiClient.post('/uploads?name_hint=cert-template', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
            transformRequest: (data, headers) => {
              // Some axios versions try to JSON.stringify FormData —
              // returning it untouched forces multipart.
              return data;
            },
          });
          const backgroundUrl = upl.data?.path;
          if (!backgroundUrl) throw new Error('Upload returned no path.');

          const create = await apiClient.post('/certificate-templates', {
            name: `Template ${new Date().toLocaleDateString('en-IN')}`,
            background_url:  backgroundUrl,
            background_kind: 'image',
            canvas_width:    asset.width  || 1000,
            canvas_height:   asset.height || 700,
            placeholders:    DEFAULT_PINS,
          });
          const created = create.data?.template;
          if (created) {
            navigation.navigate('CertificateTemplateEditor', { templateId: created.id });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log('[CertTemplates] upload error:',
            err?.response?.status,
            err?.response?.data,
            err?.message,
            err?.code,
          );
          Alert.alert(
            'Upload failed',
            err?.response?.data?.message
              || (err?.code === 'ECONNABORTED'
                ? 'The upload timed out. Try a smaller image or check the backend.'
                : err?.message)
              || 'Try a smaller image.',
          );
        } finally {
          setUploading(false);
          load();
        }
      },
    );
  };

  const handleDelete = (t) => {
    confirm({
      title:       'Delete template?',
      message:     `"${t.name}" will be removed. Sent certificates keep working — this only removes the template.`,
      variant:     'destructive',
      confirmText: 'Delete',
      cancelText:  'Cancel',
      onConfirm: () => {
        (async () => {
          try {
            await apiClient.delete(`/certificate-templates/${t.id}`);
            setTemplates((prev) => prev.filter((x) => x.id !== t.id));
          } catch (err) {
            Alert.alert('Delete failed', err?.response?.data?.message || 'Try again');
          }
        })();
      },
    });
  };

  const handleSetDefault = async (t) => {
    try {
      await apiClient.post(`/certificate-templates/${t.id}/default`);
      setTemplates((prev) =>
        prev.map((x) => ({ ...x, is_default: x.id === t.id })),
      );
    } catch (err) {
      Alert.alert('Could not set default', err?.response?.data?.message || 'Try again');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Certificate Templates</Text>
          <Text style={styles.subtitle}>
            {templates.length === 0 ? 'None yet' : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : templates.length === 0 ? (
        <View style={styles.emptyCard}>
          <Award size={40} color={palette.textLight} strokeWidth={1.4} />
          <Text style={styles.emptyTitle}>No templates yet</Text>
          <Text style={styles.emptySub}>
            Tap the + button to upload a background and start placing pins.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {templates.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              onEdit={() => navigation.navigate('CertificateTemplateEditor', { templateId: t.id })}
              onPreview={() => navigation.navigate('CertificateTemplateEditor', {
                templateId: t.id, preview: true,
              })}
              onDelete={() => handleDelete(t)}
              onSetDefault={() => handleSetDefault(t)}
            />
          ))}
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, uploading && { opacity: 0.7 }]}
        onPress={pickAndUpload}
        disabled={uploading}
        activeOpacity={0.85}
      >
        {uploading ? <ActivityIndicator color="#fff" /> : <Plus size={22} color="#fff" strokeWidth={2.6} />}
      </TouchableOpacity>
    </View>
  );
}

// ─── Row ────────────────────────────────────────────────────────────
function TemplateRow({ template, onEdit, onPreview, onDelete, onSetDefault }) {
  const bg = resolveAssetUrl(template.background_url);
  const pinCount = Array.isArray(template.placeholders) ? template.placeholders.length : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {bg ? (
          <Image source={{ uri: bg }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            {template.background_kind === 'pdf'
              ? <FileText size={22} color={palette.textLight} strokeWidth={2} />
              : <ImageIcon size={22} color={palette.textLight} strokeWidth={2} />}
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{template.name}</Text>
            {template.is_default ? (
              <View style={styles.defaultBadge}>
                <Star size={9} color="#fff" strokeWidth={2.6} fill="#fff" />
                <Text style={styles.defaultBadgeText}>DEFAULT</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.meta}>
            {pinCount} placeholder{pinCount === 1 ? '' : 's'} · {template.background_kind.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <ActionBtn icon={Pencil} label="Edit"       onPress={onEdit}    accent={palette.purple} />
        <ActionBtn icon={Eye}    label="Preview"    onPress={onPreview} accent={palette.blue} />
        {!template.is_default ? (
          <ActionBtn icon={Star} label="Default"    onPress={onSetDefault} accent={palette.orange} />
        ) : null}
        <ActionBtn icon={Trash2} label="Delete"     onPress={onDelete}  accent={palette.rose} />
      </View>
    </View>
  );
}

function ActionBtn({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.actionBtn, { backgroundColor: accent.soft }]}>
      <Icon size={13} color={accent.on} strokeWidth={2.4} />
      <Text style={[styles.actionBtnText, { color: accent.on }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Default pin seed ───────────────────────────────────────────────
const DEFAULT_PINS = [
  { key: 'student_name',     label: 'Student Name',     x: 0.5,  y: 0.42, font_size: 32, align: 'center', bold: true,  color: '#111827' },
  { key: 'course_name',      label: 'Course Name',      x: 0.5,  y: 0.52, font_size: 20, align: 'center', bold: false, color: '#374151' },
  { key: 'belt_name',        label: 'Belt Name',        x: 0.5,  y: 0.58, font_size: 16, align: 'center', bold: false, color: '#6B7280' },
  { key: 'institution_name', label: 'Academy',          x: 0.5,  y: 0.12, font_size: 22, align: 'center', bold: true,  color: '#B91C1C' },
  { key: 'venue',            label: 'Venue',            x: 0.22, y: 0.88, font_size: 12, align: 'left',   bold: false, color: '#374151' },
  { key: 'completion_date',  label: 'Completion Date',  x: 0.78, y: 0.88, font_size: 12, align: 'right',  bold: false, color: '#374151' },
  { key: 'certificate_no',   label: 'Certificate No.',  x: 0.22, y: 0.06, font_size: 10, align: 'left',   bold: false, color: '#6B7280' },
  { key: 'instructor_name',  label: 'Instructor',       x: 0.28, y: 0.82, font_size: 14, align: 'center', bold: false, color: '#111827' },
  { key: 'digital_signature',label: 'Signature',        x: 0.72, y: 0.82, font_size: 14, align: 'center', italic: true, color: '#111827' },
  { key: 'qr_code',          label: 'QR Code',          x: 0.9,  y: 0.9,  font_size: 10, align: 'right',  color: '#374151' },
];

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
    gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  emptyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginBottom: spacing.md,
  },
  thumb: {
    width: 74, height: 54, borderRadius: radius.md,
    backgroundColor: palette.borderSoft,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...type.bodyBold, color: palette.text, fontSize: 15, flexShrink: 1 },
  meta: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 2 },

  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 999, backgroundColor: '#F59E0B',
  },
  defaultBadgeText: {
    fontSize: 9, color: '#fff', fontWeight: '900', letterSpacing: 0.6,
  },

  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
  },
  actionBtnText: { fontSize: 12, fontWeight: '800' },

  fab: {
    position: 'absolute', right: spacing.xl, bottom: spacing.xxl,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.raised,
  },
});
