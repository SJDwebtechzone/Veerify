// veerify_admin_web/src/pages/Profile.tsx
//
// "My Profile" page for the super-admin web user.
//
// Renders the fields the spec asked for:
//   • Institution Logo  (uploaded via POST /api/uploads)
//   • Institution Name  (org_name)
//   • Owner Name        (name)
//   • Email             (email)
//   • Mobile Number     (phone)
//   • Alternate Contact (alt_phone)
//   • Date Joined       (created_at — read-only)
//   • Role              (admin / super_admin dropdown)
//
// View mode: all fields are read-only. Hitting "Edit" flips the card into
// edit mode where every editable field becomes an input. "Save" PUTs to
// /api/auth/me/profile; "Cancel" discards local changes and reverts to
// the last known server values. Saved values persist server-side so the
// next time the user opens the page, the same data is shown.

import { useEffect, useRef, useState } from 'react';
import {
  User as UserIcon, Mail, Phone, Calendar, ShieldCheck, Building2,
  Edit3, Save, X as XIcon, Upload, Camera,
} from 'lucide-react';
import apiClient from '../api/client';
import { useAuth } from '../lib/auth';

interface MeUser {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  org_name: string | null;
  org_logo_url: string | null;
  alt_phone: string | null;
  created_at: string | null;
}

// Form values mirror the editable fields. created_at is intentionally
// excluded — that's read-only.
interface FormValues {
  org_name: string;
  name: string;
  email: string;
  phone: string;
  alt_phone: string;
  role: string;
  org_logo_url: string;
}

const EMPTY: FormValues = {
  org_name: '', name: '', email: '', phone: '',
  alt_phone: '', role: '', org_logo_url: '',
};

// Map a stored relative path back to an absolute browser-fetchable URL.
function resolveAssetUrl(rel: string | null): string {
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  const base = (apiClient.defaults.baseURL || '/api').replace(/\/api\/?$/, '');
  return `${base}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function formatJoined(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Institution Owner' },
  { value: 'admin',       label: 'Admin' },
];

function roleLabel(value: string | null): string {
  return ROLE_OPTIONS.find((o) => o.value === value)?.label || value || '—';
}

export function Profile() {
  // refresh() re-fetches /auth/me into the AuthContext so the Dashboard
  // greeting + navbar avatar pick up the new owner name as soon as Save
  // succeeds — no re-login required.
  const { refresh: refreshAuthUser } = useAuth();
  const [user, setUser] = useState<MeUser | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate form values from the user row.
  const hydrate = (u: MeUser | null) => {
    if (!u) { setForm(EMPTY); return; }
    setForm({
      org_name:     u.org_name     || '',
      name:         u.name         || '',
      email:        u.email        || '',
      phone:        u.phone        || '',
      alt_phone:    u.alt_phone    || '',
      role:         u.role         || 'super_admin',
      org_logo_url: u.org_logo_url || '',
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/auth/me');
      const u: MeUser = res.data?.user;
      setUser(u);
      hydrate(u);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message || e?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Field setters.
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  // Upload a freshly-picked image to the generic /api/uploads endpoint
  // and stash the returned path in the form state. The user still has to
  // hit "Save" to persist it server-side.
  const onPickLogo = () => fileInputRef.current?.click();

  const onLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const slug = (form.org_name || form.name || 'profile').trim();
      const url = slug
        ? `/uploads?name_hint=${encodeURIComponent(slug + '-logo')}`
        : '/uploads';
      const res = await apiClient.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.path) set('org_logo_url', res.data.path);
    } catch (err: unknown) {
      const obj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(obj?.response?.data?.message || obj?.message || 'Logo upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.put('/auth/me/profile', form);
      const u: MeUser = res.data?.user;
      setUser(u);
      hydrate(u);
      setEditing(false);
      // Push the new name into the shared auth context so the Dashboard
      // "Welcome back, <name>" greeting and the navbar avatar reflect the
      // change immediately, without waiting for a page reload or re-login.
      refreshAuthUser();
      setFlash('Profile updated');
      setTimeout(() => setFlash(null), 2500);
    } catch (err: unknown) {
      const obj = err as { response?: { data?: { message?: string } }; message?: string };
      setError(obj?.response?.data?.message || obj?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    hydrate(user);
    setEditing(false);
    setError(null);
  };

  if (loading) {
    return (
      <div className="p-8 text-sm text-slate-500">Loading profile…</div>
    );
  }

  const logoUrl = resolveAssetUrl(form.org_logo_url);

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Profile</h1>
          <p className="text-sm text-slate-500 mt-1">
            Your contact details and the organisation you represent on Veerify.
          </p>
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
          >
            <Edit3 size={14} /> Edit
          </button>
        ) : null}
      </div>

      {/* Flash + error banners */}
      {flash ? (
        <div className="mb-4 px-4 py-2.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
          {flash}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 px-4 py-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Logo + identity strip */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-4 bg-gradient-to-br from-slate-50 to-white">
          <div className="relative">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Institution logo"
                className="w-20 h-20 rounded-2xl object-cover border border-slate-200 bg-white"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-blue-50 border border-blue-100 grid place-items-center text-blue-600">
                <Building2 size={28} />
              </div>
            )}
            {editing ? (
              <button
                onClick={onPickLogo}
                disabled={uploading}
                className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-blue-600 text-white grid place-items-center shadow-md hover:bg-blue-700 disabled:opacity-60"
                title="Upload a new logo"
              >
                {uploading ? <Upload size={14} className="animate-pulse" /> : <Camera size={14} />}
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={onLogoChange}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Institution</p>
            <p className="text-lg font-bold text-slate-900 truncate">
              {form.org_name || <span className="text-slate-400 italic">Untitled organisation</span>}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <ShieldCheck size={12} className="inline align-middle mr-1" />
              {roleLabel(form.role)}
            </p>
          </div>
        </div>

        {/* Field grid */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Institution Name"
            icon={Building2}
            editing={editing}
            value={form.org_name}
            onChange={(v) => set('org_name', v)}
            placeholder="e.g. Veerify Martial Arts"
          />
          <Field
            label="Owner Name"
            icon={UserIcon}
            editing={editing}
            value={form.name}
            onChange={(v) => set('name', v)}
            placeholder="Your full name"
          />
          <Field
            label="Email"
            icon={Mail}
            editing={editing}
            value={form.email}
            onChange={(v) => set('email', v)}
            placeholder="you@example.com"
            type="email"
          />
          <Field
            label="Mobile Number"
            icon={Phone}
            editing={editing}
            value={form.phone}
            onChange={(v) => set('phone', v.replace(/[^\d+\s-]/g, ''))}
            placeholder="+91 9xxxxxxxxx"
            type="tel"
          />
          <Field
            label="Alternate Contact"
            icon={Phone}
            editing={editing}
            value={form.alt_phone}
            onChange={(v) => set('alt_phone', v.replace(/[^\d+\s-]/g, ''))}
            placeholder="Optional backup number"
            type="tel"
          />

          {/* Role — always a dropdown in edit mode, otherwise a label. */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              <ShieldCheck size={12} className="inline align-middle mr-1" /> Role
            </label>
            {editing ? (
              <select
                value={form.role}
                onChange={(e) => set('role', e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-800 font-semibold">{roleLabel(form.role)}</p>
            )}
          </div>

          {/* Date Joined — always read-only (server-managed). */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              <Calendar size={12} className="inline align-middle mr-1" /> Date Joined
            </label>
            <p className="text-sm text-slate-800 font-semibold">
              {formatJoined(user?.created_at || null)}
            </p>
          </div>
        </div>

        {/* Footer actions */}
        {editing ? (
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <XIcon size={14} /> Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Update changes'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Field primitive ────────────────────────────────────────────────────
// Renders a labelled value in view mode and a labelled input in edit mode.
function Field({
  label, icon: Icon, editing, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  icon: typeof Building2;
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        <Icon size={12} className="inline align-middle mr-1" /> {label}
      </label>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      ) : (
        <p className="text-sm text-slate-800 font-semibold">
          {value || <span className="text-slate-400 italic font-normal">—</span>}
        </p>
      )}
    </div>
  );
}
