// src/screens/admin/CertificateTemplateEditorScreen.js
//
// Drag-and-drop placeholder editor. Loads the template's background as
// a canvas and paints each placeholder pin at its (x, y) — normalised
// 0-1 so the layout survives DPI changes.
//
// Interactions:
//   • Tap a pin → select + open the bottom sheet (font size, align,
//     bold/italic, color).
//   • Drag a pin → live update its (x, y). Saved on release.
//   • Bottom sheet shows a "+ Add" chip for every placeholder key that
//     isn't already on the canvas.
//   • Top-right "Save" — persists the whole layout to the backend.
//
// Route params:
//   templateId    : number
//   preview?      : boolean  — read-only preview from Templates list.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, Dimensions, PanResponder, TextInput, Modal,
} from 'react-native';
import {
  ArrowLeft, Save, Plus, Trash2, Bold, Italic, AlignLeft, AlignCenter, AlignRight,
  Type, X as XIcon, Eye,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
import { confirm } from '../../components/ConfirmDialog';

const PLACEHOLDER_META = [
  { key: 'student_name',      label: 'Student Name',      sample: 'Rohan Kumar' },
  { key: 'course_name',       label: 'Course Name',       sample: 'Karate — Blue Belt' },
  { key: 'belt_name',         label: 'Belt Name',         sample: 'Blue Belt' },
  { key: 'institution_name',  label: 'Academy',           sample: 'Veerify Academy' },
  { key: 'venue',             label: 'Venue',             sample: 'Chennai' },
  { key: 'completion_date',   label: 'Completion Date',   sample: '05 Jul 2026' },
  { key: 'certificate_no',    label: 'Certificate No.',   sample: 'VRF-2026-45678' },
  { key: 'instructor_name',   label: 'Instructor',        sample: 'K. Ravi' },
  { key: 'digital_signature', label: 'Digital Signature', sample: '~ Instructor Signature ~' },
  { key: 'qr_code',           label: 'QR Code',           sample: '[QR]' },
];
const META_BY_KEY = Object.fromEntries(PLACEHOLDER_META.map((m) => [m.key, m]));

// Canvas width used inside the editor. Height is derived from the
// template's own canvas ratio.
const SCREEN_W = Dimensions.get('window').width;
const CANVAS_W = SCREEN_W - spacing.lg * 2;

export default function CertificateTemplateEditorScreen({ route, navigation }) {
  const { templateId, preview } = route.params || {};
  const [template, setTemplate] = useState(null);
  const [pins, setPins] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const canvasH = useMemo(() => {
    if (!template) return CANVAS_W * 0.71;
    const ratio = template.canvas_height / (template.canvas_width || 1);
    return Math.min(Math.max(CANVAS_W * ratio, 200), CANVAS_W * 1.6);
  }, [template]);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/certificate-templates');
      const t = (r.data?.templates || []).find((x) => x.id === templateId);
      if (t) {
        setTemplate(t);
        setPins(Array.isArray(t.placeholders) ? t.placeholders : []);
        setName(t.name || 'Template');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[TemplateEditor] load error:', err?.response?.data);
    }
  }, [templateId]);
  React.useEffect(() => { load(); }, [load]);

  const updatePin = (idx, patch) =>
    setPins((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removePin = (idx) =>
    setPins((prev) => prev.filter((_, i) => i !== idx));
  const addPin = (key) => {
    const meta = META_BY_KEY[key];
    if (!meta) return;
    setPins((prev) => [
      ...prev,
      {
        key,
        label:     meta.label,
        x:         0.5, y: 0.5,
        font_size: 20, align: 'center',
        bold:      false, italic: false,
        color:     '#111827',
      },
    ]);
    setSelectedKey(key);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/certificate-templates/${templateId}`, {
        name: name || 'Untitled',
        placeholders: pins,
      });
      confirm({
        title: 'Template saved',
        message: `${pins.length} placeholder${pins.length === 1 ? '' : 's'} pinned.`,
        variant: 'success', confirmText: 'Done', hideCancel: true,
        onConfirm: () => navigation.goBack(),
      });
    } catch (err) {
      confirm({
        title: 'Save failed',
        message: err?.response?.data?.message || 'Try again.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!template) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  const bg = resolveAssetUrl(template.background_url);
  const selectedIdx = pins.findIndex((p) => p.key === selectedKey);
  const availableKeys = PLACEHOLDER_META
    .map((m) => m.key)
    .filter((k) => !pins.some((p) => p.key === k));

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {preview ? (
            <Text style={styles.title}>Preview</Text>
          ) : (
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.title}
              placeholder="Template name"
              placeholderTextColor={palette.textLight}
            />
          )}
          <Text style={styles.subtitle}>
            {pins.length} placeholder{pins.length === 1 ? '' : 's'}
          </Text>
        </View>
        {!preview ? (
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Save size={13} color="#fff" strokeWidth={2.6} />
                <Text style={styles.saveBtnText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 240 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.canvas, { width: CANVAS_W, height: canvasH }]}>
          {bg ? (
            <Image source={{ uri: bg }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.borderSoft }]} />
          )}
          {pins.map((pin, i) => (
            <Pin
              key={`${pin.key}-${i}`}
              pin={pin}
              canvasW={CANVAS_W}
              canvasH={canvasH}
              selected={selectedKey === pin.key}
              readOnly={!!preview}
              onSelect={() => setSelectedKey(pin.key)}
              onMove={(x, y) => updatePin(i, { x, y })}
            />
          ))}
        </View>

        {/* Add placeholder chips */}
        {!preview && availableKeys.length > 0 ? (
          <View style={styles.chipRow}>
            <Text style={styles.chipRowTitle}>ADD PLACEHOLDER</Text>
            <View style={styles.chipWrap}>
              {availableKeys.map((k) => {
                const meta = META_BY_KEY[k];
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => addPin(k)}
                    style={styles.addChip}
                    activeOpacity={0.85}
                  >
                    <Plus size={11} color={palette.purple.vivid} strokeWidth={2.4} />
                    <Text style={styles.addChipText}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {selectedIdx >= 0 && !preview ? (
          <StyleEditor
            pin={pins[selectedIdx]}
            onChange={(patch) => updatePin(selectedIdx, patch)}
            onDelete={() => { removePin(selectedIdx); setSelectedKey(null); }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Pin ────────────────────────────────────────────────────────────
function Pin({ pin, canvasW, canvasH, selected, readOnly, onSelect, onMove }) {
  const start = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !readOnly,
      onMoveShouldSetPanResponder: (_e, g) => !readOnly && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2),
      onPanResponderGrant: () => {
        onSelect && onSelect();
        start.current = { x: pin.x, y: pin.y };
      },
      onPanResponderMove: (_e, g) => {
        const nx = Math.min(1, Math.max(0, start.current.x + g.dx / canvasW));
        const ny = Math.min(1, Math.max(0, start.current.y + g.dy / canvasH));
        onMove(nx, ny);
      },
    }),
  ).current;

  const text = META_BY_KEY[pin.key]?.sample || pin.label;
  // Estimate text width based on font size + text length so we can
  // roughly center the pin visually. Pure heuristic — perfect
  // alignment happens at final render on the backend.
  const est = Math.max(60, text.length * (pin.font_size || 16) * 0.55);
  const left = pin.x * canvasW - est / 2;
  const top  = pin.y * canvasH - (pin.font_size || 16);

  return (
    <View
      {...pan.panHandlers}
      style={[
        styles.pin,
        {
          left, top, width: est,
          borderColor: selected ? palette.purple.vivid : 'rgba(0,0,0,0.15)',
          backgroundColor: selected ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.7)',
        },
      ]}
    >
      <Text
        onPress={() => !readOnly && onSelect && onSelect()}
        style={{
          fontSize:  Math.max(9, (pin.font_size || 16) * 0.6),
          fontWeight: pin.bold ? '800' : '600',
          fontStyle:  pin.italic ? 'italic' : 'normal',
          color:      pin.color || '#111827',
          textAlign:  pin.align || 'center',
        }}
        numberOfLines={1}
      >
        {text}
      </Text>
      <Text style={styles.pinLabel} numberOfLines={1}>{pin.label}</Text>
    </View>
  );
}

// ─── Style editor for the selected pin ──────────────────────────────
function StyleEditor({ pin, onChange, onDelete }) {
  return (
    <View style={styles.editor}>
      <View style={styles.editorHead}>
        <Type size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        <Text style={styles.editorTitle}>{pin.label}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onDelete} activeOpacity={0.85} style={styles.removePinBtn}>
          <Trash2 size={13} color={palette.rose.on} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <Text style={styles.editorLabel}>Font size</Text>
      <View style={styles.sizeRow}>
        <TouchableOpacity onPress={() => onChange({ font_size: Math.max(8, (pin.font_size || 16) - 2) })} style={styles.stepBtn}>
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.sizeValue}>{pin.font_size || 16}</Text>
        <TouchableOpacity onPress={() => onChange({ font_size: Math.min(96, (pin.font_size || 16) + 2) })} style={styles.stepBtn}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.editorLabel}>Alignment</Text>
      <View style={styles.alignRow}>
        {[
          { key: 'left',   Icon: AlignLeft },
          { key: 'center', Icon: AlignCenter },
          { key: 'right',  Icon: AlignRight },
        ].map(({ key, Icon }) => (
          <TouchableOpacity
            key={key}
            onPress={() => onChange({ align: key })}
            style={[styles.alignBtn, pin.align === key && styles.alignBtnActive]}
            activeOpacity={0.85}
          >
            <Icon size={14} color={pin.align === key ? '#fff' : palette.text} strokeWidth={2.4} />
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => onChange({ bold: !pin.bold })}
          style={[styles.alignBtn, pin.bold && styles.alignBtnActive]}
          activeOpacity={0.85}
        >
          <Bold size={14} color={pin.bold ? '#fff' : palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onChange({ italic: !pin.italic })}
          style={[styles.alignBtn, pin.italic && styles.alignBtnActive]}
          activeOpacity={0.85}
        >
          <Italic size={14} color={pin.italic ? '#fff' : palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>

      <Text style={styles.editorLabel}>Color</Text>
      <View style={styles.colorRow}>
        {['#111827', '#B91C1C', '#1D4ED8', '#065F46', '#7C2D12', '#374151', '#FFFFFF'].map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => onChange({ color: c })}
            style={[
              styles.colorDot,
              { backgroundColor: c },
              pin.color === c && styles.colorDotActive,
              c === '#FFFFFF' && { borderColor: palette.borderSoft, borderWidth: 1 },
            ]}
            activeOpacity={0.85}
          />
        ))}
      </View>

      <Text style={styles.editorHint}>
        Drag the pin on the canvas to reposition. Save when you're done.
      </Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
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
  title: { ...type.h1, color: palette.text, fontSize: 18, padding: 0 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.purple.vivid,
  },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  canvas: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...shadows.card,
    alignSelf: 'center',
  },
  pin: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 2,
    minHeight: 20,
  },
  pinLabel: {
    fontSize: 7, color: palette.purple.vivid,
    fontWeight: '800', letterSpacing: 0.3,
    marginTop: 1,
  },

  chipRow: { marginTop: spacing.lg },
  chipRowTitle: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.6, marginBottom: 6,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  addChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
  },
  addChipText: { fontSize: 11, color: palette.purple.on, fontWeight: '800' },

  editor: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  editorHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10,
  },
  editorTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  editorLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.4, marginTop: 10, marginBottom: 6,
  },
  editorHint: {
    ...type.micro, color: palette.textLight,
    fontWeight: '600', marginTop: 12, textAlign: 'center',
  },
  removePinBtn: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.rose.soft,
  },

  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  stepBtnText: { fontSize: 16, fontWeight: '800', color: palette.text },
  sizeValue: {
    minWidth: 40, textAlign: 'center',
    ...type.bodyBold, color: palette.text, fontSize: 15,
  },

  alignRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alignBtn: {
    width: 32, height: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  alignBtnActive: { backgroundColor: palette.purple.vivid },

  colorRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  colorDot: {
    width: 26, height: 26, borderRadius: 13,
  },
  colorDotActive: {
    borderWidth: 2, borderColor: palette.purple.vivid,
  },
});
