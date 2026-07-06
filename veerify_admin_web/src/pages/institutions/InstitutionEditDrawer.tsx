// Super-admin edit drawer for an institution. Slides in from the right of
// the InstitutionDetail page; lets the super admin fill in every field
// except staff (trainers) and courses, which live on their own tables.
//
// Used most often for branches whose parent only provided basic info —
// super admin can complete Accreditation / Operations / Master here.

import { useEffect, useRef, useState } from 'react';
import { X, Save, Building2, MapPin, ShieldCheck, BarChart3, Briefcase, Upload, FileText, ExternalLink, Trash2 } from 'lucide-react';
import apiClient from '../../api/client';

type TabKey = 'core' | 'contact' | 'accreditation' | 'operations' | 'master';

interface Branch {
  name?: string;
  address?: string;
  city?: string;
  pincode?: string;
  email?: string;
  contact_number?: string;
}

interface FormState {
  // Core
  name: string;
  brand_name: string;
  institution_type: string;
  institution_types: string[];
  registration_number: string;
  date_of_establishment: string;
  skills: string[];
  // Contact
  address: string;
  city: string;
  pincode: string;
  email: string;
  phone: string;
  website_url: string;
  latitude: string;
  longitude: string;
  branches: Branch[];
  // Accreditation
  affiliation_or_board: string;
  accreditation_body_name: string;
  accreditation_expiry_date: string;
  accreditation_certificate_url: string;
  // Operations
  total_student_capacity: string;
  current_enrollment: string;
  medium_of_instruction: string[];
  // Master / POC
  master_name: string;
  master_role: string;
  master_email: string;
  master_phone_number: string;
}

interface Props {
  institutionId: number;
  initial: Partial<FormState>;
  onClose: () => void;
  onSaved: () => void;
}

const blankForm: FormState = {
  name: '', brand_name: '', institution_type: '', institution_types: [],
  registration_number: '', date_of_establishment: '', skills: [],
  address: '', city: '', pincode: '', email: '', phone: '', website_url: '',
  latitude: '', longitude: '', branches: [],
  affiliation_or_board: '', accreditation_body_name: '',
  accreditation_expiry_date: '', accreditation_certificate_url: '',
  total_student_capacity: '', current_enrollment: '', medium_of_instruction: [],
  master_name: '', master_role: '', master_email: '', master_phone_number: '',
};

const tabs: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: 'core',          label: 'Core',         icon: Building2 },
  { key: 'contact',       label: 'Contact',      icon: MapPin },
  { key: 'accreditation', label: 'Accreditation',icon: ShieldCheck },
  { key: 'operations',    label: 'Operations',   icon: BarChart3 },
  { key: 'master',        label: 'Master',       icon: Briefcase },
];

export function InstitutionEditDrawer({ institutionId, initial, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<TabKey>('core');
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the existing institution row when the drawer opens.
  useEffect(() => {
    setForm({
      ...blankForm,
      ...Object.fromEntries(
        Object.entries(initial).map(([k, v]) => [
          k,
          v == null ? blankForm[k as keyof FormState] : v,
        ]),
      ),
      // Force these to the right types regardless of what API sent.
      institution_types: Array.isArray(initial.institution_types) ? initial.institution_types : [],
      skills: Array.isArray(initial.skills) ? initial.skills : [],
      branches: Array.isArray(initial.branches) ? initial.branches : [],
      medium_of_instruction: Array.isArray(initial.medium_of_instruction)
        ? initial.medium_of_instruction : [],
      date_of_establishment: (initial.date_of_establishment || '').toString().slice(0, 10),
      accreditation_expiry_date: (initial.accreditation_expiry_date || '').toString().slice(0, 10),
      latitude: initial.latitude != null ? String(initial.latitude) : '',
      longitude: initial.longitude != null ? String(initial.longitude) : '',
      total_student_capacity: initial.total_student_capacity != null
        ? String(initial.total_student_capacity) : '',
      current_enrollment: initial.current_enrollment != null
        ? String(initial.current_enrollment) : '',
    } as FormState);
  }, [institutionId, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.put(`/onboarding/${institutionId}/super-admin-edit`, form);
      onSaved();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Drawer markup. Fixed right-side slide-in with a backdrop for click-out.
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Edit institution details</h2>
            <p className="text-xs text-gray-500 mt-0.5">Fields you leave blank keep their existing value.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab strip */}
        <div className="px-6 pt-3 border-b border-gray-100">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                    active
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'core' && (
            <>
              <Field label="Institution name"><Text v={form.name} onC={(v) => set('name', v)} /></Field>
              <Field label="Brand name"><Text v={form.brand_name} onC={(v) => set('brand_name', v)} /></Field>
              <Field label="Institution type">
                <select value={form.institution_type} onChange={(e) => set('institution_type', e.target.value)} className={inp}>
                  <option value="">—</option>
                  <option value="School">School</option>
                  <option value="Training Center">Training Center</option>
                  <option value="Association">Association</option>
                </select>
              </Field>
              <Field label="Registration number"><Text v={form.registration_number} onC={(v) => set('registration_number', v)} /></Field>
              <Field label="Date of establishment"><input type="date" className={inp} value={form.date_of_establishment} onChange={(e) => set('date_of_establishment', e.target.value)} /></Field>
              <Field label="Skills (comma-separated)">
                <Text v={form.skills.join(', ')} onC={(v) => set('skills', v.split(',').map((s) => s.trim()).filter(Boolean))} />
              </Field>
            </>
          )}

          {tab === 'contact' && (
            <>
              <Field label="Address"><textarea className={inp} rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City"><Text v={form.city} onC={(v) => set('city', v)} /></Field>
                <Field label="Pincode"><Text v={form.pincode} onC={(v) => set('pincode', v.replace(/[^0-9]/g, ''))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><Text v={form.email} onC={(v) => set('email', v)} /></Field>
                <Field label="Phone"><Text v={form.phone} onC={(v) => set('phone', v)} /></Field>
              </div>
              <Field label="Website URL"><Text v={form.website_url} onC={(v) => set('website_url', v)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude"><Text v={form.latitude} onC={(v) => set('latitude', v)} /></Field>
                <Field label="Longitude"><Text v={form.longitude} onC={(v) => set('longitude', v)} /></Field>
              </div>
              <BranchEditor branches={form.branches} onChange={(b) => set('branches', b)} />
            </>
          )}

          {tab === 'accreditation' && (
            <>
              <Field label="Affiliation / Board">
                <select value={form.affiliation_or_board} onChange={(e) => set('affiliation_or_board', e.target.value)} className={inp}>
                  <option value="">—</option>
                  <option value="State">State</option>
                  <option value="National">National</option>
                </select>
              </Field>
              <Field label="Accreditation body name"><Text v={form.accreditation_body_name} onC={(v) => set('accreditation_body_name', v)} /></Field>
              <Field label="Accreditation expiry date"><input type="date" className={inp} value={form.accreditation_expiry_date} onChange={(e) => set('accreditation_expiry_date', e.target.value)} /></Field>
              <Field label="Accreditation certificate">
                <CertificateUpload
                  value={form.accreditation_certificate_url}
                  onChange={(v) => set('accreditation_certificate_url', v)}
                  hintSlug={form.name || form.brand_name}
                />
              </Field>
            </>
          )}

          {tab === 'operations' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Total student capacity"><Text v={form.total_student_capacity} onC={(v) => set('total_student_capacity', v.replace(/[^0-9]/g, ''))} /></Field>
                <Field label="Current enrolment"><Text v={form.current_enrollment} onC={(v) => set('current_enrollment', v.replace(/[^0-9]/g, ''))} /></Field>
              </div>
              <Field label="Medium of instruction (comma-separated)">
                <Text v={form.medium_of_instruction.join(', ')} onC={(v) => set('medium_of_instruction', v.split(',').map((s) => s.trim()).filter(Boolean))} />
              </Field>
              <p className="text-xs text-gray-500 italic">Operating hours per day are managed in the mobile app's setup wizard. Coming to admin web later.</p>
            </>
          )}

          {tab === 'master' && (
            <>
              <Field label="Master name"><Text v={form.master_name} onC={(v) => set('master_name', v)} /></Field>
              <Field label="Master role"><Text v={form.master_role} onC={(v) => set('master_role', v)} /></Field>
              <Field label="Master email"><Text v={form.master_email} onC={(v) => set('master_email', v)} /></Field>
              <Field label="Master phone"><Text v={form.master_phone_number} onC={(v) => set('master_phone_number', v)} /></Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          {error ? <p className="text-sm text-red-600">{error}</p> : <span />}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── Small primitives ───────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Text({ v, onC }: { v: string; onC: (s: string) => void }) {
  return <input type="text" className={inp} value={v} onChange={(e) => onC(e.target.value)} />;
}

// CertificateUpload — picks a PDF / image from the user's computer, uploads
// it to POST /api/uploads, and stores the returned relative path on the
// form. The save flow already PUTs accreditation_certificate_url, so once
// the path is set the existing save handler persists it.
//
// Shows a preview pill for an existing certificate (with View + Replace +
// Remove). When no certificate is set, shows a single "Upload certificate"
// button.
function CertificateUpload({
  value,
  onChange,
  hintSlug,
}: {
  value: string;
  onChange: (path: string) => void;
  hintSlug?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  // Resolve the stored relative path to an absolute URL the browser can hit.
  // apiClient.defaults.baseURL is "/api" in prod (nginx-proxied), so we strip
  // the trailing /api to land on the static /uploads/* served by Express.
  const resolveUrl = (rel: string) => {
    if (!rel) return '';
    if (/^https?:\/\//i.test(rel)) return rel;
    const base = (apiClient.defaults.baseURL || '/api').replace(/\/api\/?$/, '');
    return `${base}${rel.startsWith('/') ? '' : '/'}${rel}`;
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const slug = (hintSlug || '').toString().trim();
      const url = slug
        ? `/uploads?name_hint=${encodeURIComponent(slug + '-cert')}`
        : '/uploads';
      const res = await apiClient.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.path) onChange(res.data.path);
      else throw new Error('Upload returned no path');
    } catch (e: unknown) {
      const errObj = e as { response?: { data?: { message?: string } }; message?: string };
      setErr(errObj?.response?.data?.message || errObj?.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
  };

  // Pretty filename for the pill — last path segment.
  const filename = value ? value.split('/').pop() || value : '';

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={onFile}
      />

      {value ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
          <FileText size={16} className="text-blue-600 shrink-0" />
          <span className="text-sm text-gray-700 truncate flex-1" title={filename}>
            {filename}
          </span>
          <a
            href={resolveUrl(value)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            <ExternalLink size={12} /> View
          </a>
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="text-xs text-gray-600 hover:text-gray-900 font-medium px-2"
          >
            {busy ? 'Uploading…' : 'Replace'}
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-red-600 hover:text-red-700"
            aria-label="Remove certificate"
            title="Remove certificate"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="w-full px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-dashed border-blue-300 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Upload size={14} /> {busy ? 'Uploading…' : 'Upload certificate (PDF / image)'}
        </button>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}
      <p className="text-[11px] text-gray-400">JPG, PNG, WebP, GIF or PDF. Max 10 MB.</p>
    </div>
  );
}

function BranchEditor({ branches, onChange }: { branches: Branch[]; onChange: (b: Branch[]) => void }) {
  const update = (i: number, patch: Partial<Branch>) => {
    const next = branches.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(branches.filter((_, j) => j !== i));
  const add = () => onChange([...branches, { name: '', address: '', city: '', pincode: '', email: '', contact_number: '' }]);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-600">Branches</label>
        <button onClick={add} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add branch</button>
      </div>
      {branches.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No branches.</p>
      ) : (
        <div className="space-y-3">
          {branches.map((b, i) => (
            <div key={i} className="p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Branch {i + 1}</span>
                <button onClick={() => remove(i)} className="text-xs text-red-600 hover:underline">Remove</button>
              </div>
              <Text v={b.name || ''} onC={(v) => update(i, { name: v })} />
              <Text v={b.address || ''} onC={(v) => update(i, { address: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Text v={b.city || ''} onC={(v) => update(i, { city: v })} />
                <Text v={b.pincode || ''} onC={(v) => update(i, { pincode: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Text v={b.email || ''} onC={(v) => update(i, { email: v })} />
                <Text v={b.contact_number || ''} onC={(v) => update(i, { contact_number: v })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
