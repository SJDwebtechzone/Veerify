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
  StyleSheet, Dimensions, PanResponder, TextInput, Modal, Switch,
} from 'react-native';
import {
  ArrowLeft, Save, Plus, Trash2, Bold, Italic, AlignLeft, AlignCenter, AlignRight,
  Type, X as XIcon, Eye, Upload, Image as ImageIcon,
  ChevronDown, Check, Award,
} from 'lucide-react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
import { confirm } from '../../components/ConfirmDialog';

// Full field catalogue. Must stay in sync with the backend's
// PLACEHOLDER_KEYS array; the backend rejects any pin with a key
// that isn't in the catalogue.
const PLACEHOLDER_META = [
  { key: 'student_name',      label: 'Student Name',      sample: 'Rohan Kumar' },
  { key: 'course_name',       label: 'Course',            sample: 'Karate — Blue Belt' },
  { key: 'belt_name',         label: 'Belt / Grade',      sample: 'Blue Belt' },
  // Belt progression — drag either pin independently so the
  // certificate can print "White Belt → Yellow Belt" wherever the
  // artwork calls for it. Auto-populates from the student's most
  // recent belt promotion; blank when the certificate isn't tied
  // to a grading event.
  { key: 'belt_from',         label: 'Belt From',         sample: 'White Belt' },
  { key: 'belt_to',           label: 'Belt To',           sample: 'Yellow Belt' },
  { key: 'certificate_no',    label: 'Certificate No.',   sample: 'VRF-2026-45678' },
  { key: 'issue_date',        label: 'Issue Date',        sample: '13 Jul 2026' },
  { key: 'completion_date',   label: 'Completion Date',   sample: '05 Jul 2026' },
  { key: 'instructor_name',   label: 'Instructor',        sample: 'K. Ravi' },
  { key: 'institution_name',  label: 'Institution',       sample: 'Veerify Academy' },
  { key: 'branch_name',       label: 'Branch',            sample: 'Anna Nagar Branch' },
  { key: 'venue',             label: 'Venue',             sample: 'Chennai' },
  { key: 'duration',          label: 'Duration',          sample: '3 months' },
  { key: 'verification_url',  label: 'Verification URL',  sample: 'veerify.app/verify/1234' },
  { key: 'seal',              label: 'Seal',              sample: '[Seal]',            isImage: true },
  { key: 'digital_signature', label: 'Digital Signature', sample: '[Signature]',       isImage: true },
];
const META_BY_KEY = Object.fromEntries(PLACEHOLDER_META.map((m) => [m.key, m]));

// Belt-rank list — same curated set the Student Enrollment Form and
// EditStudentScreen expose so From/To Belt round-trips cleanly with
// the value stored on student_profiles.belt_category. Keep this in
// sync with backend BELT_ORDER in certificateTemplate.controller.js.
const BELT_OPTIONS = [
  'New student',
  'White',
  'Yellow',
  'Orange',
  'Green',
  'Blue',
  'Blue I',
  'Blue II',
  'Gray',
  'Brown I',
  'Brown II',
  'Brown III',
  'Black',
];

// Canvas width used inside the editor. Height is derived from the
// template's own canvas ratio.
const SCREEN_W = Dimensions.get('window').width;
const CANVAS_W = SCREEN_W - spacing.lg * 2;

export default function CertificateTemplateEditorScreen({ route, navigation }) {
  const { templateId, preview, sample } = route.params || {};
  const [template, setTemplate] = useState(null);
  const [pins, setPins] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  // Uploaded assets stored per-template. The backend renders these
  // wherever the digital_signature / seal placeholder pins sit AND
  // only when those pins are active. '' means "cleared by admin".
  const [signatureUrl, setSignatureUrl] = useState('');
  const [sealUrl,      setSealUrl]      = useState('');
  const [uploadingKind, setUploadingKind] = useState(null); // 'signature' | 'seal' | null
  // Belt-range gate — when active, the backend refuses to dispatch a
  // certificate whose student belt sits outside [fromBelt, toBelt].
  // Empty string = "not picked yet"; the Save handler serialises that
  // to null so the backend clears the column.
  const [fromBelt,        setFromBelt]        = useState('');
  const [toBelt,          setToBelt]          = useState('');
  const [beltRangeActive, setBeltRangeActive] = useState(false);

  const canvasH = useMemo(() => {
    if (!template) return CANVAS_W * 0.71;
    const ratio = template.canvas_height / (template.canvas_width || 1);
    return Math.min(Math.max(CANVAS_W * ratio, 200), CANVAS_W * 1.6);
  }, [template]);

  const load = useCallback(async () => {
    try {
      // Preview-only opens for GLOBAL samples pull from the sample
      // endpoint (institution rows list won't contain them). Editable
      // opens continue to hit the institution endpoint.
      const url = sample
        ? '/certificate-templates/samples'
        : '/certificate-templates';
      const r = await apiClient.get(url);
      const t = (r.data?.templates || []).find((x) => x.id === templateId);
      if (t) {
        setTemplate(t);
        // Back-compat: existing pins don't have an `active` flag. Fill
        // it in as TRUE so nothing hides on the first load after the
        // migration.
        const seededPins = (Array.isArray(t.placeholders) ? t.placeholders : [])
          .map((p) => ({ ...p, active: p.active === false ? false : true }));
        setPins(seededPins);
        setName(t.name || 'Template');
        setSignatureUrl(t.signature_url || '');
        setSealUrl(t.seal_url || '');
        setFromBelt(t.from_belt || '');
        setToBelt(t.to_belt || '');
        setBeltRangeActive(!!t.belt_range_active);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[TemplateEditor] load error:', err?.response?.data);
    }
  }, [templateId, sample]);
  React.useEffect(() => { load(); }, [load]);

  // ── Signature / Seal upload ──────────────────────────────────────
  // One handler for both — pass the kind so the callback knows which
  // slot to update. PNG with transparent background is preferred but
  // any image the OS picker returns is accepted; the backend just
  // stores the path and hands it to the renderer.
  const pickImage = (kind) => {
    if (uploadingKind || preview) return;
    launchImageLibrary(
      { mediaType: 'photo', quality: 0.9, maxWidth: 1600, maxHeight: 1600 },
      (resp) => {
        if (resp?.didCancel || resp?.errorCode || !resp?.assets?.[0]) return;
        uploadAsset(kind, resp.assets[0]);
      },
    );
  };
  const uploadAsset = async (kind, asset) => {
    setUploadingKind(kind);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri:  asset.uri,
        type: asset.type || 'image/png',
        name: asset.fileName || `${kind}.png`,
      });
      const hint = encodeURIComponent(`certificate-${kind}`);
      const resp = await apiClient.post(`/uploads?name_hint=${hint}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      const url = resp.data?.path || resp.data?.url || '';
      if (kind === 'signature') setSignatureUrl(url);
      else if (kind === 'seal') setSealUrl(url);
    } catch (err) {
      confirm({
        title: 'Upload failed',
        message: err?.response?.data?.message
          || 'Could not upload the image. Try a smaller PNG (transparent background preferred).',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
    } finally {
      setUploadingKind(null);
    }
  };
  const clearImage = (kind) => {
    if (kind === 'signature') setSignatureUrl('');
    else if (kind === 'seal') setSealUrl('');
  };

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
      // Persist signature + seal alongside pins. Sending '' clears the
      // slot on the backend (see CASE WHEN provided ... in the SQL).
      // Guard — when the range is Active both bounds must be picked or
      // the backend will refuse to dispatch. Fail fast on the client so
      // the admin fixes it now instead of at Send Certificate time.
      if (beltRangeActive && (!fromBelt || !toBelt)) {
        setSaving(false);
        confirm({
          title: 'Pick both belts',
          message: 'The belt range is set to Active but From Belt / To Belt is empty. Pick both or switch the range to Inactive.',
          variant: 'warning', confirmText: 'OK', hideCancel: true,
        });
        return;
      }
      await apiClient.put(`/certificate-templates/${templateId}`, {
        name: name || 'Untitled',
        placeholders: pins,
        signature_url: signatureUrl,
        seal_url:      sealUrl,
        from_belt:         fromBelt || '',
        to_belt:           toBelt   || '',
        belt_range_active: !!beltRangeActive,
      });
      const activeCount = pins.filter((p) => p.active !== false).length;
      confirm({
        title: 'Template saved',
        message: `${activeCount} active field${activeCount === 1 ? '' : 's'} · ${pins.length} pinned.`,
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
          {pins.map((pin, i) => {
            // Hide inactive pins from the canvas preview. They're still
            // in state (and still saved) so the admin can flip them
            // back on from the Fields list without losing coordinates.
            if (pin.active === false) return null;
            // Image-backed placeholders (digital_signature / seal) show
            // the real uploaded image on the canvas when the admin has
            // uploaded one. Falls back to a labeled outline otherwise.
            const imageUrl = pin.key === 'digital_signature'
              ? (signatureUrl ? resolveAssetUrl(signatureUrl) : null)
              : pin.key === 'seal'
                ? (sealUrl ? resolveAssetUrl(sealUrl) : null)
                : null;
            return (
              <Pin
                key={`${pin.key}-${i}`}
                pin={pin}
                canvasW={CANVAS_W}
                canvasH={canvasH}
                selected={selectedKey === pin.key}
                readOnly={!!preview}
                imageUrl={imageUrl}
                onSelect={() => setSelectedKey(pin.key)}
                onMove={(x, y) => updatePin(i, { x, y })}
              />
            );
          })}
        </View>

        {/* ── Font size / color / alignment editor ───────────────
            Moved directly under the canvas so tapping a pin surfaces
            its style controls above the fold, right where the admin
            is looking. Only renders when a pin is selected — tapping
            any pin on the canvas opens it. */}
        {selectedIdx >= 0 && !preview ? (
          <StyleEditor
            pin={pins[selectedIdx]}
            onChange={(patch) => updatePin(selectedIdx, patch)}
            onDelete={() => { removePin(selectedIdx); setSelectedKey(null); }}
          />
        ) : null}

        {/* ── Digital Signature upload ────────────────────────────
            Positioned directly below the template canvas (Template
            Selection) per the Certificate Template UI spec so the
            admin sees the signature right after the artwork. */}
        {!preview ? (
          <AssetUploader
            title="Digital Signature"
            hint="Upload a PNG with a transparent background. Shown at the Digital Signature pin only when the field is Active."
            url={signatureUrl}
            uploading={uploadingKind === 'signature'}
            onPick={() => pickImage('signature')}
            onClear={() => clearImage('signature')}
          />
        ) : null}

        {/* ── Belt Range gate ─────────────────────────────────────
            Locks the template to a From-belt → To-belt window. When
            the range is Active the backend refuses to dispatch a
            certificate against a student whose current belt sits
            outside the window — useful for institutions with
            separate templates for junior vs senior ranks. */}
        {!preview ? (
          <BeltRangeCard
            fromBelt={fromBelt}
            toBelt={toBelt}
            active={beltRangeActive}
            onChangeFrom={setFromBelt}
            onChangeTo={setToBelt}
            onToggleActive={setBeltRangeActive}
          />
        ) : null}

        {/* ── Fields visibility list ───────────────────────────────
            Full catalogue of certificate fields with an Active toggle.
            Tapping the toggle on a pinned field flips its `active` flag
            (backend hides the field on generated certs when false).
            Fields that haven't been placed yet render a "+ Add" button
            instead of the toggle — that pins them at canvas centre so
            the admin can drag them into position. */}
        {!preview ? (
          <View style={styles.fieldsCard}>
            <View style={styles.fieldsHead}>
              <Text style={styles.fieldsTitle}>Certificate Fields</Text>
              <Text style={styles.fieldsSub}>
                Toggle a field OFF to hide it on generated certificates.
              </Text>
            </View>
            {PLACEHOLDER_META.map((meta) => {
              const idx = pins.findIndex((p) => p.key === meta.key);
              const pin = idx >= 0 ? pins[idx] : null;
              const isPinned = !!pin;
              const isActive = !!pin && pin.active !== false;
              return (
                <View key={meta.key} style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{meta.label}</Text>
                    <Text style={styles.fieldHint}>
                      {isPinned
                        ? (isActive ? 'Visible on the certificate' : 'Hidden — pin kept for later')
                        : 'Not placed yet — tap Add to pin at centre'}
                    </Text>
                  </View>
                  {isPinned ? (
                    <View style={styles.fieldRowActions}>
                      <Text style={[
                        styles.fieldStateText,
                        { color: isActive ? palette.green.on : palette.textMuted },
                      ]}>
                        {isActive ? 'Active' : 'Inactive'}
                      </Text>
                      <Switch
                        value={isActive}
                        onValueChange={(v) => updatePin(idx, { active: v })}
                        thumbColor={isActive ? palette.purple.vivid : '#f4f4f5'}
                        trackColor={{
                          true:  palette.purple.soft,
                          false: palette.borderSoft,
                        }}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => addPin(meta.key)}
                      style={styles.fieldAddBtn}
                      activeOpacity={0.85}
                    >
                      <Plus size={11} color={palette.purple.vivid} strokeWidth={2.6} />
                      <Text style={styles.fieldAddText}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* ── Seal upload ─────────────────────────────────────────
            Same treatment for the academy seal / stamp — separate
            from the signature so the admin can toggle either
            independently. */}
        {!preview ? (
          <AssetUploader
            title="Seal / Stamp"
            hint="Optional. Renders at the Seal pin only when the field is Active."
            url={sealUrl}
            uploading={uploadingKind === 'seal'}
            onPick={() => pickImage('seal')}
            onClear={() => clearImage('seal')}
          />
        ) : null}

      </ScrollView>
    </View>
  );
}

// ── BeltRangeCard ────────────────────────────────────────────────────
// From / To belt dropdowns plus an Active/Inactive toggle. When the
// range is Active the backend refuses to dispatch a certificate whose
// student belt falls outside the [from, to] window — this is the
// enforcement point for "certificates are generated only for Active
// belt ranges" from the Certificate Template UI spec.
function BeltRangeCard({
  fromBelt, toBelt, active,
  onChangeFrom, onChangeTo, onToggleActive,
}) {
  return (
    <View style={styles.beltCard}>
      <View style={styles.beltHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.beltTitle}>Belt Range</Text>
          <Text style={styles.beltSub}>
            {active
              ? 'Certificates are dispatched ONLY for students whose belt sits inside this range.'
              : 'Range is Inactive — this template accepts any belt.'}
          </Text>
        </View>
        <View style={styles.beltActiveWrap}>
          <Text style={[
            styles.beltActiveLabel,
            { color: active ? palette.green.on : palette.textMuted },
          ]}>
            {active ? 'Active' : 'Inactive'}
          </Text>
          <Switch
            value={active}
            onValueChange={onToggleActive}
            thumbColor={active ? palette.purple.vivid : '#f4f4f5'}
            trackColor={{
              true:  palette.purple.soft,
              false: palette.borderSoft,
            }}
          />
        </View>
      </View>

      <Text style={styles.beltFieldLabel}>From Belt</Text>
      <BeltDropdown
        value={fromBelt}
        onChange={onChangeFrom}
        placeholder="Pick the lowest belt this template covers"
      />

      <Text style={[styles.beltFieldLabel, { marginTop: 12 }]}>To Belt</Text>
      <BeltDropdown
        value={toBelt}
        onChange={onChangeTo}
        placeholder="Pick the highest belt this template covers"
      />
    </View>
  );
}

// ── BeltDropdown ────────────────────────────────────────────────────
// Inline dropdown pinned to BELT_OPTIONS. Same UX + look as the
// dropdown on EditStudentScreen so From/To Belt reads as familiar to
// the admin who just picked a student's current belt.
function BeltDropdown({ value, onChange, placeholder = 'Select belt' }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity
        style={[styles.beltTrigger, open && styles.beltTriggerOpen]}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.85}
      >
        <Award size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        <Text style={[styles.beltTriggerText, !value && styles.beltTriggerPlaceholder]}>
          {value || placeholder}
        </Text>
        <ChevronDown
          size={16}
          color={palette.textMuted}
          strokeWidth={2.2}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.beltPanel}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            style={{ maxHeight: 240 }}
          >
            {BELT_OPTIONS.map((opt) => {
              const selected = opt === value;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.beltItem, selected && styles.beltItemActive]}
                  onPress={() => { onChange(opt); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.beltItemText,
                    selected && styles.beltItemTextActive,
                  ]}>
                    {opt}
                  </Text>
                  {selected ? (
                    <Check size={14} color={palette.purple.vivid} strokeWidth={2.8} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

// ── AssetUploader ────────────────────────────────────────────────────
// Card that shows the current uploaded image (or an empty state), plus
// Upload / Replace / Remove buttons per the spec. Used for both the
// signature and the seal.
function AssetUploader({ title, hint, url, uploading, onPick, onClear }) {
  const resolved = url ? resolveAssetUrl(url) : null;
  return (
    <View style={styles.uploaderCard}>
      <View style={styles.uploaderHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.uploaderTitle}>{title}</Text>
          <Text style={styles.uploaderHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.uploaderBody}>
        <View style={styles.uploaderPreview}>
          {uploading ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : resolved ? (
            <Image
              source={{ uri: resolved }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.uploaderPreviewEmpty}>
              <ImageIcon size={26} color={palette.textLight} strokeWidth={1.8} />
              <Text style={styles.uploaderPreviewEmptyText}>No image yet</Text>
            </View>
          )}
        </View>
        <View style={styles.uploaderActions}>
          <TouchableOpacity
            style={styles.uploaderPrimary}
            onPress={onPick}
            disabled={uploading}
            activeOpacity={0.85}
          >
            <Upload size={12} color="#fff" strokeWidth={2.6} />
            <Text style={styles.uploaderPrimaryText}>
              {resolved ? 'Replace' : 'Upload'}
            </Text>
          </TouchableOpacity>
          {resolved ? (
            <TouchableOpacity
              style={styles.uploaderGhost}
              onPress={onClear}
              disabled={uploading}
              activeOpacity={0.85}
            >
              <Trash2 size={12} color={palette.rose.on} strokeWidth={2.4} />
              <Text style={styles.uploaderGhostText}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── Pin ────────────────────────────────────────────────────────────
function Pin({ pin, canvasW, canvasH, selected, readOnly, imageUrl, onSelect, onMove }) {
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

  const meta = META_BY_KEY[pin.key];
  const isImage = !!meta?.isImage;

  // Image pins (signature / seal) size themselves from pin.width/height
  // (relative 0-1) so their canvas footprint survives DPI changes. Text
  // pins get width estimated from character count.
  if (isImage) {
    const w = Math.max(40, (pin.width  || 0.20) * canvasW);
    const h = Math.max(24, (pin.height || 0.10) * canvasH);
    const left = pin.x * canvasW - w / 2;
    const top  = pin.y * canvasH - h / 2;
    return (
      <View
        {...pan.panHandlers}
        style={[
          styles.pinImage,
          {
            left, top, width: w, height: h,
            borderColor: selected ? palette.purple.vivid : 'rgba(0,0,0,0.15)',
          },
        ]}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        ) : (
          <Text style={styles.pinImagePlaceholder} numberOfLines={1}>
            {meta.label}
          </Text>
        )}
        {/* Field-name overlay removed — the certificate should render
            only the value (or the uploaded image for signature / seal).
            Admin still identifies a pin by tapping it, which opens the
            StyleEditor with the field name at the top. */}
      </View>
    );
  }

  const text = meta?.sample || pin.label;
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
      {/* Field-name overlay removed — a certificate should render only
          the value, not the field label ("Student Name", "Course",
          etc). The dashed border already flags a pin as editable; the
          admin identifies which field it is by tapping to open the
          StyleEditor with the field name at the top. */}
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

  // Image-backed placeholder (digital signature / seal). Bigger footprint
  // than a text pin because the image itself is the content.
  pinImage: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 2,
    overflow: 'hidden',
  },
  pinImagePlaceholder: {
    fontSize: 10,
    color: palette.textMuted,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ── Fields visibility list (Active / Inactive) ─────────────────
  fieldsCard: {
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  fieldsHead: { marginBottom: 6 },
  fieldsTitle: { ...type.h2, color: palette.text, fontSize: 15, fontWeight: '800' },
  fieldsSub: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  fieldLabel: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  fieldHint:  { ...type.caption, color: palette.textMuted, marginTop: 2 },

  fieldRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldStateText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  fieldAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
  },
  fieldAddText: { fontSize: 11, color: palette.purple.on, fontWeight: '800' },

  // ── AssetUploader — signature / seal ───────────────────────────
  uploaderCard: {
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  uploaderHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  uploaderTitle: { ...type.h2, color: palette.text, fontSize: 15, fontWeight: '800' },
  uploaderHint:  { ...type.caption, color: palette.textMuted, marginTop: 2 },

  uploaderBody: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  uploaderPreview: {
    width: 96, height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: '#F8F7FC',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploaderPreviewEmpty: {
    alignItems: 'center',
    gap: 2,
  },
  uploaderPreviewEmptyText: {
    fontSize: 10, color: palette.textLight, fontWeight: '600',
  },

  uploaderActions: {
    flex: 1,
    gap: 8,
  },
  uploaderPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: palette.purple.vivid,
    alignSelf: 'flex-start',
  },
  uploaderPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  uploaderGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.rose.soft,
    alignSelf: 'flex-start',
  },
  uploaderGhostText: { color: palette.rose.on, fontSize: 12, fontWeight: '800' },

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

  // ── Belt Range card ───────────────────────────────────────────
  beltCard: {
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  beltHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  beltTitle: { ...type.h2, color: palette.text, fontSize: 15, fontWeight: '800' },
  beltSub:   { ...type.caption, color: palette.textMuted, marginTop: 2 },
  beltActiveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  beltActiveLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  beltFieldLabel: {
    ...type.micro, color: palette.textMuted, fontWeight: '800',
    letterSpacing: 0.4, marginBottom: 6,
    textTransform: 'uppercase',
  },
  beltTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    backgroundColor: palette.bg,
  },
  beltTriggerOpen: {
    borderColor: palette.purple.vivid,
    backgroundColor: palette.surface,
  },
  beltTriggerText: {
    flex: 1,
    ...type.bodyBold, color: palette.text, fontSize: 13,
  },
  beltTriggerPlaceholder: { color: palette.textLight, fontWeight: '600' },
  beltPanel: {
    marginTop: 6,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
    overflow: 'hidden',
  },
  beltItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  beltItemActive: { backgroundColor: palette.purple.soft },
  beltItemText: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  beltItemTextActive: { color: palette.purple.on },
});
