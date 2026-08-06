import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Pencil, Trash2, Eye, EyeOff, Star, Upload,
  Image as ImageIcon, Award, Save, X, ArrowLeft,
} from 'lucide-react';

import apiClient from '../../api/client';
import { uploadImage, resolveImageUrl } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input, Toggle } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';

// ─────────────────────────────────────────────────────────────────────
// Sample Certificate Templates — super-admin manager.
//
// Two views:
//   • List — grid of samples with thumbnail, active toggle, default
//     star, edit / preview / delete / set-default actions, plus an
//     "Add sample" button.
//   • Designer — a click-to-place canvas that reproduces the mobile
//     app's drag-and-drop editor as closely as browser DOM allows:
//     - Left panel: field catalogue with per-field active toggle +
//       "Place on canvas" button that pins the field at canvas centre.
//     - Right canvas: shows the uploaded background; each active pin
//       is draggable via pointer events, coordinates land back on
//       the row's placeholders array as relative 0..1 values.
//     - Bottom bar: Signature / Seal image upload, Belt Range toggle
//       with From / To dropdowns, Save + Cancel.
//
// The layout stays in sync with the mobile editor: same PLACEHOLDER_KEYS,
// same {key, x, y, font_size, color, align, bold, italic, active}
// shape on each pin, so a sample authored here renders identically
// on the mobile student certificate.
// ─────────────────────────────────────────────────────────────────────

interface PlaceholderPin {
  key:       string;
  label:     string;
  x:         number;   // 0..1 relative
  y:         number;   // 0..1 relative
  font_size: number;
  color:     string;
  align:     'left' | 'center' | 'right';
  bold:      boolean;
  italic:    boolean;
  active:    boolean;
  width?:    number;   // image pins
  height?:   number;
}

interface Template {
  id:                 number;
  name:               string;
  background_url:     string;
  background_kind:    'image' | 'pdf';
  canvas_width:       number;
  canvas_height:      number;
  placeholders:       PlaceholderPin[];
  signature_url:      string | null;
  seal_url:           string | null;
  from_belt:          string | null;
  to_belt:            string | null;
  belt_range_active:  boolean;
  is_default:         boolean;
  is_sample:          boolean;
  created_at?:        string;
}

// Full placeholder catalogue — same as the mobile app.
const PLACEHOLDER_META: { key: string; label: string; sample: string; isImage?: boolean }[] = [
  { key: 'student_name',      label: 'Student Name',      sample: 'Rohan Kumar' },
  { key: 'course_name',       label: 'Course',            sample: 'Karate — Blue Belt' },
  { key: 'belt_name',         label: 'Belt / Grade',      sample: 'Blue Belt' },
  // Belt progression pins — drag independently. Auto-fill from the
  // student's most recent belt promotion at dispatch time.
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
  { key: 'seal',              label: 'Seal',              sample: '[Seal]',      isImage: true },
  { key: 'digital_signature', label: 'Digital Signature', sample: '[Signature]', isImage: true },
];

const BELT_OPTIONS = [
  'New student', 'White', 'Yellow', 'Orange', 'Green',
  'Blue', 'Blue I', 'Blue II', 'Gray', 'Brown I', 'Brown II', 'Brown III', 'Black',
];

function newPin(key: string): PlaceholderPin {
  const meta = PLACEHOLDER_META.find((m) => m.key === key)!;
  return {
    key,
    label:     meta.label,
    x:         0.5,
    y:         0.5,
    font_size: 20,
    color:     '#111827',
    align:     'center',
    bold:      false,
    italic:    false,
    active:    true,
    ...(meta.isImage ? { width: 0.2, height: 0.1 } : {}),
  };
}

export function SampleCertificates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState<Template | 'new' | null>(null);
  const [preview,   setPreview]   = useState<Template | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const r = await apiClient.get('/certificate-templates/samples');
      setTemplates(r.data?.templates || []);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to load samples');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (t: Template) => {
    // "Active/Inactive" for a sample is layered onto the row's
    // is_default: we treat is_default as the "active on the platform"
    // flag for samples. Every sample is technically discoverable
    // from the mobile app; is_default surfaces the recommended one.
    // For a richer active flag we'd add a column — for now we
    // toggle via the update endpoint (leaving is_default alone).
    // No-op placeholder; keep the button around for future use.
    void t;
  };

  const removeSample = async (t: Template) => {
    if (!confirm(`Delete sample "${t.name}"? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/certificate-templates/samples/${t.id}`);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Delete failed');
    }
  };

  const setDefault = async (t: Template) => {
    try {
      await apiClient.patch(`/certificate-templates/samples/${t.id}/default`);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to set default');
    }
  };

  if (editing !== null) {
    return (
      <SampleEditor
        source={editing}
        onSaved={() => { setEditing(null); load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }
  if (preview) {
    return <SamplePreview template={preview} onClose={() => setPreview(null)} />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Sample Certificate Templates
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Published samples that every institution can preview and copy into their own templates.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing('new')} variant="primary" size="md">
          <Plus className="w-4 h-4 mr-1" /> Add sample
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          No samples yet. Tap "Add sample" to create the first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {t.background_url ? (
                <img
                  src={resolveImageUrl(t.background_url)}
                  alt={t.name}
                  className="w-full h-40 object-cover"
                />
              ) : (
                <div className="w-full h-40 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-slate-400" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex-1 truncate">
                    {t.name}
                  </h3>
                  {t.is_default ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                      <Star className="w-2.5 h-2.5" fill="currentColor" />
                      DEFAULT
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  {(t.placeholders || []).length} field{(t.placeholders || []).length === 1 ? '' : 's'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPreview(t)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                  <button
                    onClick={() => setEditing(t)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  {!t.is_default ? (
                    <button
                      onClick={() => setDefault(t)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100"
                    >
                      <Star className="w-3 h-3" /> Default
                    </button>
                  ) : null}
                  <button
                    onClick={() => removeSample(t)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-700 hover:bg-rose-100"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SamplePreview — read-only canvas
// ─────────────────────────────────────────────────────────────────────
function SamplePreview({ template, onClose }: { template: Template; onClose: () => void }) {
  const CANVAS_W = 720;
  const ratio    = (template.canvas_height || 700) / (template.canvas_width || 1000);
  const CANVAS_H = Math.min(CANVAS_W * ratio, 900);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-slate-700" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{template.name}</h1>
          <p className="text-sm text-slate-500">Read-only preview</p>
        </div>
      </div>

      <div
        className="relative bg-white rounded-xl shadow-lg overflow-hidden mx-auto"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        {template.background_url ? (
          <img
            src={resolveImageUrl(template.background_url)}
            className="absolute inset-0 w-full h-full object-cover"
            alt=""
          />
        ) : null}
        {(template.placeholders || [])
          .filter((p) => p.active !== false)
          .map((p, i) => {
            const meta = PLACEHOLDER_META.find((m) => m.key === p.key);
            const isImage = meta?.isImage;
            const sample  = meta?.sample || p.label;
            if (isImage) {
              const w = (p.width  || 0.2) * CANVAS_W;
              const h = (p.height || 0.1) * CANVAS_H;
              const url = p.key === 'digital_signature' ? template.signature_url : template.seal_url;
              return url ? (
                <img
                  key={i}
                  src={resolveImageUrl(url)}
                  className="absolute object-contain"
                  style={{
                    left: p.x * CANVAS_W - w / 2,
                    top:  p.y * CANVAS_H - h / 2,
                    width: w, height: h,
                  }}
                  alt=""
                />
              ) : null;
            }
            return (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${p.x * 100}%`,
                  top:  `${p.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  fontSize:  p.font_size,
                  color:     p.color,
                  fontWeight: p.bold ? 800 : 600,
                  fontStyle:  p.italic ? 'italic' : 'normal',
                  textAlign:  p.align,
                }}
              >
                {sample}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SampleEditor — drag-and-drop canvas + field toggles + belt range
// ─────────────────────────────────────────────────────────────────────
function SampleEditor({
  source, onSaved, onCancel,
}: { source: Template | 'new'; onSaved: () => void; onCancel: () => void; }) {
  const isNew  = source === 'new';
  const seed   = isNew ? null : (source as Template);

  const [name,          setName]          = useState(seed?.name || '');
  const [backgroundUrl, setBackgroundUrl] = useState(seed?.background_url || '');
  const [canvasW,       setCanvasW]       = useState(seed?.canvas_width  || 1000);
  const [canvasH,       setCanvasH]       = useState(seed?.canvas_height || 700);
  const [pins,          setPins]          = useState<PlaceholderPin[]>(seed?.placeholders || []);
  const [sigUrl,        setSigUrl]        = useState(seed?.signature_url || '');
  const [sealUrl,       setSealUrl]       = useState(seed?.seal_url || '');
  const [fromBelt,      setFromBelt]      = useState(seed?.from_belt || '');
  const [toBelt,        setToBelt]        = useState(seed?.to_belt || '');
  const [beltActive,    setBeltActive]    = useState(!!seed?.belt_range_active);
  const [isDefault,     setIsDefault]     = useState(!!seed?.is_default);
  const [uploading,     setUploading]     = useState(false);
  const [saving,        setSaving]        = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const CANVAS_W  = 720;
  const ratio     = canvasH / (canvasW || 1);
  const CANVAS_H  = Math.min(CANVAS_W * ratio, 900);

  const pinByKey = useMemo(() => new Map(pins.map((p) => [p.key, p])), [pins]);

  const handleBg = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setBackgroundUrl(url);
      // Read intrinsic dimensions for a clean canvas ratio.
      const img = new Image();
      img.src = resolveImageUrl(url);
      img.onload = () => {
        if (img.naturalWidth)  setCanvasW(img.naturalWidth);
        if (img.naturalHeight) setCanvasH(img.naturalHeight);
      };
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAsset = async (file: File | undefined, setter: (v: string) => void) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setter(url);
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const addPin = (key: string) => {
    if (pinByKey.has(key)) return;
    setPins((prev) => [...prev, newPin(key)]);
  };
  const removePin = (key: string) => setPins((prev) => prev.filter((p) => p.key !== key));
  const setPinActive = (key: string, active: boolean) =>
    setPins((prev) => prev.map((p) => (p.key === key ? { ...p, active } : p)));
  const updatePin = (key: string, patch: Partial<PlaceholderPin>) =>
    setPins((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const startDrag = (key: string, evt: React.PointerEvent) => {
    if (!canvasRef.current) return;
    evt.preventDefault();
    (evt.target as HTMLElement).setPointerCapture(evt.pointerId);
    const canvasRect = canvasRef.current.getBoundingClientRect();

    const onMove = (e: PointerEvent) => {
      const x = (e.clientX - canvasRect.left) / canvasRect.width;
      const y = (e.clientY - canvasRect.top)  / canvasRect.height;
      updatePin(key, {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
  };

  const save = async () => {
    if (!name.trim())         { alert('Name is required.'); return; }
    if (!backgroundUrl)       { alert('Upload a background image.'); return; }
    setSaving(true);
    try {
      const payload = {
        name:               name.trim(),
        background_url:     backgroundUrl,
        background_kind:    'image',
        canvas_width:       canvasW,
        canvas_height:      canvasH,
        placeholders:       pins,
        signature_url:      sigUrl || '',
        seal_url:           sealUrl || '',
        from_belt:          fromBelt || '',
        to_belt:            toBelt || '',
        belt_range_active:  beltActive,
        is_default:         isDefault,
      };
      if (isNew) {
        await apiClient.post('/certificate-templates/samples', payload);
      } else {
        await apiClient.put(`/certificate-templates/samples/${(seed as Template).id}`, payload);
      }
      onSaved();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
        >
          <ArrowLeft className="w-4 h-4 text-slate-700" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isNew ? 'Add Sample Certificate' : 'Edit Sample Certificate'}
          </h1>
          <p className="text-sm text-slate-500">
            Drag any pin on the canvas to reposition. Toggle a field OFF to hide it on the generated certificate.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save className="w-4 h-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Left panel */}
        <div className="space-y-4">
          <Input
            label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sample Karate Completion"
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Background</label>
            {backgroundUrl ? (
              <img
                src={resolveImageUrl(backgroundUrl)}
                className="w-full h-32 object-cover rounded-lg border border-slate-200"
                alt=""
              />
            ) : (
              <div className="w-full h-32 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                No background yet
              </div>
            )}
            <label className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 cursor-pointer">
              <Upload className="w-3 h-3" />
              {backgroundUrl ? 'Replace' : 'Upload background'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleBg(e.target.files?.[0])}
                disabled={uploading}
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700">Fields</label>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                {PLACEHOLDER_META.length} available
              </span>
            </div>
            {/* No max-height cap — the full catalogue (Student Name,
                Course, Belt / Grade, Belt From, Belt To, Certificate
                No., Issue Date, Completion Date, Instructor,
                Institution, Branch, Venue, Duration, Verification
                URL, Seal, Digital Signature) needs to be visible so
                the author doesn't miss the new belt-progression
                fields hidden behind an inner scroll. */}
            <div className="space-y-1 pr-1">
              {PLACEHOLDER_META.map((meta) => {
                const pin = pinByKey.get(meta.key);
                const isActive = !!pin && pin.active !== false;
                return (
                  <div key={meta.key} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-700 truncate">{meta.label}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {pin ? (isActive ? 'On canvas · Active' : 'On canvas · Hidden') : 'Not placed'}
                      </div>
                    </div>
                    {pin ? (
                      <>
                        <button
                          onClick={() => setPinActive(meta.key, !isActive)}
                          className={`p-1.5 rounded-md ${isActive ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                          title={isActive ? 'Deactivate' : 'Activate'}
                        >
                          {isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => removePin(meta.key)}
                          className="p-1.5 rounded-md text-rose-500 hover:bg-rose-50"
                          title="Remove pin"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => addPin(meta.key)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-brand-50 text-brand-700 hover:bg-brand-100"
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Signature / Seal</label>
            <AssetInput label="Signature" url={sigUrl}  onFile={(f) => handleAsset(f, setSigUrl)}  onClear={() => setSigUrl('')} />
            <AssetInput label="Seal"      url={sealUrl} onFile={(f) => handleAsset(f, setSealUrl)} onClear={() => setSealUrl('')} />
          </div>

          {/* Belt Range — always shows the From / To selects with
              explicit labels so the fields are obvious. The Active
              toggle controls whether the backend enforces the range
              at dispatch time; leaving it off keeps the sample
              template usable for any belt. */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Belt Range</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {beltActive
                    ? 'Certificates only dispatch for belts inside this range.'
                    : 'Range is off — any belt is accepted for this template.'}
                </div>
              </div>
              <Toggle
                checked={beltActive}
                onChange={(v) => setBeltActive(v)}
                label={beltActive ? 'Active' : 'Off'}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  From Belt
                </label>
                <select
                  value={fromBelt}
                  onChange={(e) => setFromBelt(e.target.value)}
                  className="w-full text-sm bg-white border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-400"
                >
                  <option value="">Select a belt…</option>
                  {BELT_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  To Belt
                </label>
                <select
                  value={toBelt}
                  onChange={(e) => setToBelt(e.target.value)}
                  className="w-full text-sm bg-white border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-400"
                >
                  <option value="">Select a belt…</option>
                  {BELT_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <Toggle
              checked={isDefault}
              onChange={(v) => setIsDefault(v)}
              label="Mark as Default Sample"
              description="One default across the platform. Toggling this on unsets the previous default."
            />
          </div>
        </div>

        {/* Canvas */}
        <div className="space-y-2">
          {/* Belt-eligibility badge — surfaces the gate that decides
              WHICH students this template can dispatch to. The range
              itself isn't printed on the certificate (only the
              individual student's belt is, via the belt_name pin);
              this badge is how the author sees the current gate at
              a glance while editing. */}
          {beltActive ? (
            <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold">
              <Award className="w-4 h-4" />
              <span>
                Belt eligibility:{' '}
                <span className="font-bold">{fromBelt || '—'}</span>
                {' '}→{' '}
                <span className="font-bold">{toBelt || '—'}</span>
              </span>
              <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px]">
                ACTIVE
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs font-medium">
              Belt eligibility: any belt (range off)
            </div>
          )}

          <div
            ref={canvasRef}
            className="relative bg-white rounded-xl shadow-lg overflow-hidden mx-auto select-none"
            style={{ width: CANVAS_W, height: CANVAS_H }}
          >
            {backgroundUrl ? (
              <img
                src={resolveImageUrl(backgroundUrl)}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                alt=""
              />
            ) : (
              <div className="absolute inset-0 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                Upload a background image to start
              </div>
            )}
            {pins.filter((p) => p.active !== false).map((p) => {
              const meta = PLACEHOLDER_META.find((m) => m.key === p.key);
              const sample = meta?.sample || p.label;
              return (
                <div
                  key={p.key}
                  onPointerDown={(e) => startDrag(p.key, e)}
                  className="absolute cursor-grab active:cursor-grabbing"
                  style={{
                    left: `${p.x * 100}%`,
                    top:  `${p.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: p.font_size,
                    color:    p.color,
                    fontWeight: p.bold ? 800 : 600,
                    fontStyle:  p.italic ? 'italic' : 'normal',
                    textAlign:  p.align,
                    padding: '2px 6px',
                    border:  '1px dashed rgba(0,0,0,0.35)',
                    borderRadius: 4,
                    backgroundColor: 'rgba(255,255,255,0.6)',
                    whiteSpace: 'nowrap',
                  }}
                  title={p.label}
                >
                  {sample}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 text-center">
            Drag any pin to reposition. Preview text is placeholder — the real values render on the generated certificate.
          </p>
          <p className="text-[11px] text-slate-400 text-center leading-relaxed">
            The Belt Range gates <b>who</b> the certificate can be issued to — it doesn't get printed on the certificate itself.
            Use the <b>Belt / Grade</b> field pin (left panel) to place the individual student's belt on the artwork.
          </p>
        </div>
      </div>
    </div>
  );
}

function AssetInput({
  label, url, onFile, onClear,
}: { label: string; url: string; onFile: (f?: File) => void; onClear: () => void; }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border border-slate-200">
      <div className="w-12 h-12 rounded-md bg-slate-100 flex items-center justify-center overflow-hidden">
        {url ? (
          <img src={resolveImageUrl(url)} alt="" className="w-full h-full object-contain" />
        ) : (
          <ImageIcon className="w-4 h-4 text-slate-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        <div className="text-[10px] text-slate-500 truncate">{url ? url : 'Not uploaded'}</div>
      </div>
      <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 cursor-pointer">
        <Upload className="w-3 h-3" />
        {url ? 'Replace' : 'Upload'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {url ? (
        <button
          onClick={onClear}
          className="p-1 rounded-md text-rose-500 hover:bg-rose-50"
          title="Remove"
        >
          <X className="w-3 h-3" />
        </button>
      ) : null}
    </div>
  );
}
