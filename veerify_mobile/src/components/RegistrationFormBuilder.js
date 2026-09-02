// src/components/RegistrationFormBuilder.js
//
// MODULE 1: Registration Form builder used inside CreateEventScreen.
//
// Fully controlled — the parent (CreateEventScreen) owns:
//   value:    { enabled, fields }
//   onChange: (next) => void
// so persisting the definition after the parent POSTs the event
// stays a single call in the parent's submit handler.
//
// Two field kinds:
//   • Student-profile references — the participating institution
//     will supply this at Module 2 registration time. Checkbox to
//     Enable + checkbox for Required.
//   • Custom fields — organizer defines label + type + (options).
//     Add / Edit modal + Delete-with-confirm + Up/Down reorder.
//
// Validation is client-side friendly (inline errors on the modal
// Save), then repeated server-side inside PUT for safety.
//
// Uses the app's palette / spacing / type tokens so the visual
// language matches the surrounding CreateEventScreen fields.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Switch, Modal, Alert,
  ScrollView, StyleSheet,
} from 'react-native';
import {
  Plus, Trash2, Edit3, ArrowUp, ArrowDown, X, ChevronDown, Check,
} from 'lucide-react-native';

// Palette — kept local so this component drops into any screen
// without a theme dependency. Mirrors the values used by
// CreateEventScreen itself.
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BORDER      = '#E5E7EB';
const BG          = '#F4F4F8';

// Canonical student catalog — mirrors the backend catalog so a
// fresh event can offer the defaults even before /config loads.
// Every entry in this list is auto-included in every new event's
// registration form (see the "auto-seed defaults" effect below).
// The organizer can uncheck any row they don't want, or mark it
// Required. Custom fields still get added on top via the section
// below this one.
const DEFAULT_STUDENT_CATALOG = [
  { source_key: 'name',         label: 'Student Name' },
  { source_key: 'dob',          label: 'Date of Birth' },
  { source_key: 'gender',       label: 'Gender' },
  { source_key: 'phone',        label: 'Phone' },
  { source_key: 'email',        label: 'Email' },
  { source_key: 'belt_level',   label: 'Belt Level' },
  // Skills replaces the old "Course" default field. The value
  // auto-populates from the selected student's snapshot when
  // available; otherwise the participant form renders a dropdown
  // sourced from this event's Categories & Skills configuration.
  { source_key: 'skills',       label: 'Skills' },
  { source_key: 'institution',  label: 'Institution' },
  { source_key: 'branch',       label: 'Branch' },
  // NEW — participant-identity + address fields the organiser almost
  // always wants captured. Auto-populated from student_profiles
  // where columns exist (father_name, mother_name, address,
  // photo_url); the rest (master_name, district, state) can be
  // typed in manually on the participant form.
  { source_key: 'father_name',  label: "Father's Name" },
  { source_key: 'mother_name',  label: "Mother's Name" },
  { source_key: 'photo_url',    label: 'Student Photo' },
  { source_key: 'address',      label: 'Address' },
  { source_key: 'master_name',  label: 'Master Name' },
  { source_key: 'district',     label: 'District' },
  { source_key: 'state',        label: 'State' },
  // NEW — 12-digit government ID. Rendered as a numeric input on the
  // participant form with input-side validation (exactly 12 digits).
  // Auto-populates from student_profiles.aadhaar_number when present;
  // otherwise the participant fills it in.
  { source_key: 'aadhaar_number', label: 'Aadhaar Number' },
];

// Mandatory declaration text — auto-appended to every registration
// form. Kept as a single exported constant so the builder preview and
// the participant submit screen render byte-identical wording.
export const DECLARATION_TEXT =
  'I hereby declare that all the information provided above is true and correct '
  + 'to the best of my knowledge. I agree to abide by the rules, regulations, '
  + 'code of conduct and safety guidelines of the event and the organising '
  + 'academy. I acknowledge that participation in martial-arts activities '
  + 'carries inherent risks, and I release the organisers from liability for '
  + 'any injury, loss, or damage that may occur during the event.';

const CUSTOM_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'radio',    label: 'Radio' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'file',     label: 'File Upload' },
];
const TYPE_LABEL = Object.fromEntries(CUSTOM_TYPES.map((t) => [t.value, t.label]));
const ENUM_TYPES = new Set(['dropdown', 'radio', 'checkbox']);

export default function RegistrationFormBuilder({
  value,
  onChange,
  studentCatalog,
}) {
  const catalog = studentCatalog && studentCatalog.length
    ? studentCatalog
    : DEFAULT_STUDENT_CATALOG;

  const enabled = !!(value && value.enabled);
  const fields  = (value && Array.isArray(value.fields)) ? value.fields : [];

  const setEnabled = (v) => onChange({ ...(value || {}), enabled: !!v, fields });
  const setFields  = (next) => onChange({ ...(value || {}), enabled, fields: next });

  // ── Auto-seed default student fields ─────────────────────────
  // Requirement: every new event's registration form must include
  // the canonical student fields (Name, DOB, Gender, Phone, Email,
  // Father's Name, Mother's Name, Student Photo, Address, Master
  // Name, District, State, Belt Level, Course, Institution, Branch)
  // out of the box. The organiser can still uncheck rows they don't
  // want or mark specific rows Required.
  //
  // Runs when the builder is enabled AND no student-source rows are
  // already present. That way:
  //   • A fresh event with an empty definition → all defaults seed
  //     on the first enable tap.
  //   • An existing event that already has its own picks is left
  //     untouched — we never clobber the organiser's saved config.
  //   • Toggling off then on again re-seeds if the state got wiped.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (seeded) return;
    const alreadyHasStudent = fields.some((f) => f.sourceType === 'student');
    if (alreadyHasStudent) { setSeeded(true); return; }
    // Build one row per catalog entry, optional by default. Sort
    // order follows catalog order so the layout is predictable.
    const seededRows = catalog.map((c, i) => ({
      sourceType: 'student',
      sourceKey:  c.source_key,
      label:      c.label,
      type:       'student',
      required:   false,
      sortOrder:  i + 1,
    }));
    setFields([...fields.filter((f) => f.sourceType !== 'student'), ...seededRows]);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Fast lookups — is this student key currently enabled? what's
  // its required flag? Used to render each catalog row's toggles.
  const enabledStudent = useMemo(() => {
    const m = new Map();
    fields.filter((f) => f.sourceType === 'student').forEach((f) => {
      m.set(f.sourceKey, f);
    });
    return m;
  }, [fields]);

  const customFields = useMemo(
    () => fields.filter((f) => f.sourceType !== 'student')
                 .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [fields],
  );

  const nextSortOrder = () =>
    fields.reduce((max, f) => Math.max(max, Number(f.sortOrder) || 0), 0) + 1;

  // ── Toggle a canonical student field on / off ───────────────
  const toggleStudent = (source_key, on) => {
    const others = fields.filter(
      (f) => !(f.sourceType === 'student' && f.sourceKey === source_key),
    );
    if (!on) return setFields(others);
    setFields([
      ...others,
      {
        sourceType: 'student',
        sourceKey:  source_key,
        label:      catalog.find((c) => c.source_key === source_key)?.label || source_key,
        type:       'student',
        required:   false,
        sortOrder:  nextSortOrder(),
      },
    ]);
  };

  const setStudentRequired = (source_key, req) => {
    setFields(fields.map((f) =>
      (f.sourceType === 'student' && f.sourceKey === source_key)
        ? { ...f, required: !!req }
        : f,
    ));
  };

  // ── Custom-field CRUD ───────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState(null);
  const [editorIndex, setEditorIndex] = useState(-1);

  const openNewCustom = () => {
    setEditorDraft({ label: '', type: 'text', required: false, options: [] });
    setEditorIndex(-1);
    setEditorOpen(true);
  };
  const openEditCustom = (idx) => {
    setEditorDraft({ ...customFields[idx], options: customFields[idx].options || [] });
    setEditorIndex(idx);
    setEditorOpen(true);
  };
  const closeEditor = () => { setEditorOpen(false); setEditorDraft(null); setEditorIndex(-1); };

  const saveCustom = (draft) => {
    // Merge back into full list preserving student rows + sortOrders.
    const others = fields.filter((f) => f.sourceType === 'student');
    const nextCustom = [...customFields];
    if (editorIndex >= 0) {
      nextCustom[editorIndex] = {
        ...customFields[editorIndex],
        ...draft,
        sourceType: 'custom',
      };
    } else {
      nextCustom.push({
        ...draft,
        sourceType: 'custom',
        sortOrder: nextSortOrder(),
      });
    }
    setFields([...others, ...nextCustom]);
    closeEditor();
  };

  const deleteCustom = (idx) => {
    const f = customFields[idx];
    Alert.alert(
      'Delete field?',
      `Remove "${f.label}" from the registration form?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            const others = fields.filter((f2) => f2.sourceType === 'student');
            const nextCustom = customFields.filter((_, i) => i !== idx);
            setFields([...others, ...nextCustom]);
          },
        },
      ],
    );
  };

  const moveCustom = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= customFields.length) return;
    const swapped = [...customFields];
    const [a, b] = [swapped[idx], swapped[target]];
    swapped[idx] = b;
    swapped[target] = a;
    // Re-stamp sort_order sequentially.
    const others = fields.filter((f) => f.sourceType === 'student');
    const stamped = swapped.map((f, i) => ({ ...f, sortOrder: i + 1 }));
    setFields([...others, ...stamped]);
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <View>
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Registration Form</Text>
          <Text style={styles.headerHint}>
            Define the information participating institutions must
            provide when registering students for this event.
          </Text>
        </View>
        <Switch value={enabled} onValueChange={setEnabled}
          thumbColor={enabled ? BRAND : '#f4f4f4'}
          trackColor={{ false: '#d1d5db', true: BRAND_SOFT }}
        />
      </View>

      {!enabled ? (
        <Text style={styles.disabledHint}>
          Turn on Registration to configure participant fields.
        </Text>
      ) : (
        <>
          {/* Default student fields */}
          <Text style={styles.sectionLabel}>Default Student Fields</Text>
          <View style={styles.card}>
            {catalog.map((c, i) => {
              const on = enabledStudent.has(c.source_key);
              const req = on ? !!enabledStudent.get(c.source_key).required : false;
              return (
                <View key={c.source_key} style={[
                  styles.stdRow,
                  i < catalog.length - 1 && styles.stdRowBorder,
                ]}>
                  <TouchableOpacity
                    style={styles.stdLabel}
                    activeOpacity={0.7}
                    onPress={() => toggleStudent(c.source_key, !on)}
                  >
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                    </View>
                    <Text style={styles.stdLabelText}>{c.label}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    disabled={!on}
                    onPress={() => setStudentRequired(c.source_key, !req)}
                    style={[styles.reqPill, on && req && styles.reqPillOn, !on && { opacity: 0.4 }]}
                  >
                    <Text style={[styles.reqPillText, on && req && { color: '#fff' }]}>
                      {req ? 'Required' : 'Optional'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          {/* Custom fields */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>Custom Fields</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openNewCustom} activeOpacity={0.85}>
              <Plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.addBtnText}>Add Custom Field</Text>
            </TouchableOpacity>
          </View>

          {/* Declaration preview — the participant form ALWAYS appends
              this mandatory declaration + checkbox below all fields.
              Rendered here read-only so the organiser sees what
              participants will be asked to accept. The rule is enforced
              on the submit side (EventRegistrationFormScreen) — the
              button stays disabled until the participant ticks it. */}
          <Text style={styles.sectionLabel}>Mandatory Declaration</Text>
          <View style={[styles.card, styles.declarationCard]}>
            <View style={styles.declarationHead}>
              <View style={[styles.checkbox, styles.checkboxOn]}>
                <Check size={12} color="#fff" strokeWidth={3} />
              </View>
              <Text style={styles.declarationText}>
                {DECLARATION_TEXT}
              </Text>
            </View>
            <Text style={styles.declarationHint}>
              This declaration and its checkbox are added to every event
              automatically. Participants must tick the checkbox before
              they can submit their registration.
            </Text>
          </View>

          {customFields.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No custom fields yet. Tap "Add Custom Field" to define one.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {customFields.map((f, idx) => (
                <View key={`${f.fieldKey || f.label}-${idx}`} style={[
                  styles.customRow,
                  idx < customFields.length - 1 && styles.stdRowBorder,
                ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.customLabel} numberOfLines={1}>{f.label}</Text>
                    <View style={styles.customMeta}>
                      <Text style={styles.metaPill}>{TYPE_LABEL[f.type] || f.type}</Text>
                      <Text style={[styles.metaPill, f.required && styles.metaPillReq]}>
                        {f.required ? 'Required' : 'Optional'}
                      </Text>
                      {ENUM_TYPES.has(f.type) && f.options?.length ? (
                        <Text style={styles.metaOpts} numberOfLines={1}>
                          {f.options.map((o) => o.label).join(', ')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.customActions}>
                    <IconBtn onPress={() => moveCustom(idx, -1)} Icon={ArrowUp}   disabled={idx === 0} />
                    <IconBtn onPress={() => moveCustom(idx,  1)} Icon={ArrowDown} disabled={idx === customFields.length - 1} />
                    <IconBtn onPress={() => openEditCustom(idx)} Icon={Edit3} />
                    <IconBtn onPress={() => deleteCustom(idx)}   Icon={Trash2} danger />
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Custom-field editor modal */}
      <CustomFieldModal
        visible={editorOpen}
        draft={editorDraft}
        setDraft={setEditorDraft}
        onCancel={closeEditor}
        onSave={saveCustom}
        existingLabels={customFields
          .filter((_, i) => i !== editorIndex)
          .map((f) => f.label.toLowerCase().trim())}
      />
    </View>
  );
}

function IconBtn({ onPress, Icon, disabled, danger }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.iconBtn,
        disabled && { opacity: 0.35 },
        danger && { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
      ]}
    >
      <Icon size={14} color={danger ? '#B91C1C' : TEXT_MUTED} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

function CustomFieldModal({ visible, draft, setDraft, onCancel, onSave, existingLabels }) {
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  if (!visible || !draft) return null;

  const needsOptions = ENUM_TYPES.has(draft.type);

  const setDraftK = (k, v) => setDraft({ ...draft, [k]: v });

  const addOption = () =>
    setDraftK('options', [...(draft.options || []), { label: '', value: '' }]);

  const updateOption = (idx, patch) => {
    const next = [...(draft.options || [])];
    next[idx] = { ...next[idx], ...patch };
    setDraftK('options', next);
  };
  const removeOption = (idx) =>
    setDraftK('options', (draft.options || []).filter((_, i) => i !== idx));

  const trySave = () => {
    const label = String(draft.label || '').trim();
    if (!label) {
      Alert.alert('Missing label', 'Please enter a field label.');
      return;
    }
    if (existingLabels.includes(label.toLowerCase())) {
      Alert.alert('Duplicate label', 'A custom field with this label already exists on the event.');
      return;
    }
    if (!draft.type) {
      Alert.alert('Missing type', 'Please pick a field type.');
      return;
    }
    let options = draft.options;
    if (ENUM_TYPES.has(draft.type)) {
      options = (options || []).map((o) => ({
        label: String(o.label || '').trim(),
        value: String(o.value || o.label || '').trim(),
      })).filter((o) => o.label && o.value);
      if (options.length === 0) {
        Alert.alert('Options required', 'Add at least one option for this field type.');
        return;
      }
    } else {
      options = null;
    }
    onSave({ label, type: draft.type, required: !!draft.required, options });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>
              {existingLabels && draft.fieldKey ? 'Edit Custom Field' : 'Add Custom Field'}
            </Text>
            <TouchableOpacity onPress={onCancel} style={styles.modalClose}>
              <X size={18} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.inputLabel}>Field Label *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Competition Weight"
              placeholderTextColor="#9CA3AF"
              value={draft.label}
              onChangeText={(v) => setDraftK('label', v)}
            />

            <Text style={styles.inputLabel}>Field Type *</Text>
            <TouchableOpacity
              style={[styles.input, styles.selectInput]}
              onPress={() => setTypePickerOpen((v) => !v)}
              activeOpacity={0.75}
            >
              <Text style={{ color: TEXT }}>{TYPE_LABEL[draft.type] || 'Select type'}</Text>
              <ChevronDown size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
            {typePickerOpen ? (
              <View style={styles.selectPanel}>
                {CUSTOM_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={styles.selectRow}
                    onPress={() => { setDraftK('type', t.value); setTypePickerOpen(false); }}
                  >
                    <Text style={{ color: TEXT }}>{t.label}</Text>
                    {draft.type === t.value ? <Check size={14} color={BRAND} /> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <View style={styles.reqRow}>
              <Text style={styles.inputLabel}>Required</Text>
              <Switch
                value={!!draft.required}
                onValueChange={(v) => setDraftK('required', v)}
                thumbColor={draft.required ? BRAND : '#f4f4f4'}
                trackColor={{ false: '#d1d5db', true: BRAND_SOFT }}
              />
            </View>

            {needsOptions ? (
              <>
                <View style={styles.optHeader}>
                  <Text style={styles.inputLabel}>Options *</Text>
                  <TouchableOpacity onPress={addOption} style={styles.addOptBtn}>
                    <Plus size={12} color={BRAND} strokeWidth={2.6} />
                    <Text style={styles.addOptText}>Add option</Text>
                  </TouchableOpacity>
                </View>
                {(draft.options || []).map((o, i) => (
                  <View key={i} style={styles.optRow}>
                    <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor="#9CA3AF"
                      value={o.label}
                      onChangeText={(v) => updateOption(i, { label: v, value: v })}
                    />
                    <TouchableOpacity onPress={() => removeOption(i)} style={styles.optRemove}>
                      <X size={16} color="#B91C1C" />
                    </TouchableOpacity>
                  </View>
                ))}
                {(draft.options || []).length === 0 ? (
                  <Text style={styles.hint}>
                    Add at least one option that participants can pick.
                  </Text>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          <View style={styles.modalFoot}>
            <TouchableOpacity style={styles.footBtn} onPress={onCancel}>
              <Text style={styles.footBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footBtn, styles.footBtnPrimary]} onPress={trySave}>
              <Text style={[styles.footBtnText, { color: '#fff' }]}>Save Field</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
  headerHint:  { fontSize: 12, color: TEXT_MUTED, marginTop: 4, lineHeight: 17 },
  disabledHint:{ fontSize: 12, color: TEXT_MUTED, marginTop: 10, fontStyle: 'italic' },

  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: 16, marginBottom: 8,
  },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, marginBottom: 8,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  card: {
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12,
  },

  stdRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
  },
  stdRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  stdLabel:     { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  stdLabelText: { fontSize: 14, fontWeight: '600', color: TEXT },
  checkbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: BRAND, borderColor: BRAND },

  reqPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    borderWidth: 1, borderColor: BORDER, backgroundColor: BG,
  },
  reqPillOn:   { backgroundColor: BRAND, borderColor: BRAND },
  reqPillText: { fontSize: 11, fontWeight: '700', color: TEXT_MUTED },

  customRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  customLabel: { fontSize: 14, fontWeight: '700', color: TEXT },
  customMeta:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  metaPill: {
    fontSize: 10, fontWeight: '700', color: TEXT_MUTED,
    backgroundColor: BG, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
  },
  metaPillReq: { backgroundColor: BRAND_SOFT, color: BRAND },
  metaOpts:    { fontSize: 10, color: TEXT_MUTED, flexShrink: 1 },
  customActions: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    width: 28, height: 28, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center',
  },

  empty: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER,
    borderRadius: 12, padding: 16, alignItems: 'center',
    backgroundColor: SURFACE,
  },
  emptyText: { fontSize: 12, color: TEXT_MUTED, textAlign: 'center' },

  // Declaration preview
  declarationCard: {
    padding: 12,
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  declarationHead: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  declarationText: {
    flex: 1,
    fontSize: 12, color: '#7C2D12', fontWeight: '600', lineHeight: 17,
  },
  declarationHint: {
    fontSize: 11, color: TEXT_MUTED, marginTop: 8, lineHeight: 15,
    fontStyle: 'italic',
  },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 16,
  },
  modalCard: {
    width: '100%', maxWidth: 460, maxHeight: '85%',
    backgroundColor: SURFACE, borderRadius: 16, overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
  modalClose: { padding: 4 },

  inputLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: TEXT, marginBottom: 4, backgroundColor: SURFACE,
  },
  selectInput: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  selectPanel: {
    marginTop: -2,
    borderWidth: 1, borderColor: BORDER, borderRadius: 10,
    backgroundColor: SURFACE,
  },
  selectRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  reqRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, paddingVertical: 4,
  },

  optHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 4,
  },
  addOptBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: BRAND_SOFT,
  },
  addOptText: { fontSize: 11, fontWeight: '800', color: BRAND },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  optRemove: {
    width: 32, height: 32, borderRadius: 8,
    borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2',
    alignItems: 'center', justifyContent: 'center',
  },
  hint: { fontSize: 11, color: TEXT_MUTED, marginTop: 6, fontStyle: 'italic' },

  modalFoot: {
    flexDirection: 'row', gap: 8, padding: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  footBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
  },
  footBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  footBtnText: { fontSize: 14, fontWeight: '800', color: TEXT },
});
