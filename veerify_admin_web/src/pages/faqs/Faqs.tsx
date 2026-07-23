import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Search, HelpCircle, Eye, EyeOff, Check,
} from 'lucide-react';

import apiClient from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input, Toggle } from '../../components/ui/Input';
import { RichTextEditor } from '../legal/RichTextEditor';

// ─────────────────────────────────────────────────────────────────────
// FAQ manager — super-admin surface for the dynamic FAQ module.
//
// Grid rows: question, category, audiences (chips), display order,
// active toggle, edit / delete actions.
//
// Editor modal (Add / Edit):
//   • Question             — plain text.
//   • Answer               — rich text via the shared RichTextEditor
//                            (same component used for legal pages).
//   • Category / Section   — free-text input with a suggested list.
//   • Audience             — multi-select checkboxes.
//   • Display order        — integer; lower = appears first.
//   • Active               — visibility toggle.
// ─────────────────────────────────────────────────────────────────────

type Audience = 'guest' | 'student' | 'trainer' | 'admin' | 'branch' | 'parent';

interface Faq {
  id:            number;
  question:      string;
  answer:        string;
  category:      string;
  audience:      Audience[];
  display_order: number;
  is_active:     boolean;
  updated_at?:   string;
}

interface Draft {
  question:      string;
  answer:        string;
  category:      string;
  audience:      Audience[];
  display_order: number;
  is_active:     boolean;
}

const AUDIENCE_OPTIONS: { key: Audience; label: string; hint: string }[] = [
  { key: 'guest',   label: 'Guest',       hint: 'Unauthenticated visitors' },
  { key: 'student', label: 'Student',     hint: 'Enrolled students' },
  { key: 'trainer', label: 'Trainer',     hint: 'Assigned trainers' },
  { key: 'admin',   label: 'Institution', hint: 'Head-office admins' },
  { key: 'branch',  label: 'Branch',      hint: 'Sub-branch admins' },
  { key: 'parent',  label: 'Parent',      hint: 'Linked parent accounts' },
];

// Common categories offered as chips under the Category input. The
// field is a free-text box so admins can add new sections as needed.
const CATEGORY_SUGGESTIONS = [
  'General', 'Account', 'Courses', 'Payments',
  'Attendance', 'Certificates', 'Events', 'Support',
];

const AUDIENCE_TINT: Record<Audience, string> = {
  guest:   'bg-slate-100 text-slate-700 border-slate-200',
  student: 'bg-blue-50 text-blue-700 border-blue-200',
  trainer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  admin:   'bg-brand-50 text-brand-700 border-brand-200',
  branch:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  parent:  'bg-purple-50 text-purple-700 border-purple-200',
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  guest:   'Guest',
  student: 'Student',
  trainer: 'Trainer',
  admin:   'Institution',
  branch:  'Branch',
  parent:  'Parent',
};

const BLANK_DRAFT: Draft = {
  question:      '',
  answer:        '',
  category:      'General',
  audience:      ['student', 'trainer'],
  display_order: 100,
  is_active:     true,
};

export function Faqs() {
  const [items,   setItems]   = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [q,       setQ]       = useState('');
  const [saving,  setSaving]  = useState(false);

  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const [draft,   setDraft]   = useState<Draft>(BLANK_DRAFT);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const r = await apiClient.get('/faqs/admin');
      setItems(Array.isArray(r.data?.faqs) ? r.data.faqs : []);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load FAQs.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Client-side search across question + category + audience labels.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((f) => {
      const audLabels = f.audience.map((a) => AUDIENCE_LABEL[a] || a).join(' ').toLowerCase();
      return (
        (f.question || '').toLowerCase().includes(needle) ||
        (f.category || '').toLowerCase().includes(needle) ||
        audLabels.includes(needle)
      );
    });
  }, [items, q]);

  const openNew = () => {
    setDraft(BLANK_DRAFT);
    setEditing('new');
  };
  const openEdit = (f: Faq) => {
    setDraft({
      question:      f.question || '',
      answer:        f.answer   || '',
      category:      f.category || 'General',
      audience:      f.audience && f.audience.length ? f.audience : ['student'],
      display_order: Number.isFinite(f.display_order) ? f.display_order : 100,
      is_active:     f.is_active !== false,
    });
    setEditing(f);
  };

  const save = async () => {
    // Client-side pre-flight so we can surface a friendly error on the
    // form itself. Backend runs the same checks and rejects with 400.
    if (!draft.question.trim()) { alert('Question is required.'); return; }
    if (!draft.answer.trim())   { alert('Answer is required.');   return; }
    if (draft.audience.length === 0) {
      alert('Pick at least one audience.');
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') {
        await apiClient.post('/faqs', draft);
      } else if (editing) {
        await apiClient.put(`/faqs/${editing.id}`, draft);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (f: Faq) => {
    try {
      await apiClient.patch(`/faqs/${f.id}/active`, { is_active: !f.is_active });
      setItems((prev) => prev.map((x) => (x.id === f.id ? { ...x, is_active: !f.is_active } : x)));
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to toggle');
    }
  };

  const remove = async (f: Faq) => {
    if (!confirm(`Delete FAQ "${f.question}"? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/faqs/${f.id}`);
      setItems((prev) => prev.filter((x) => x.id !== f.id));
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              FAQs
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Manage the app's dynamic FAQ content. Changes go live instantly for the selected audiences.
            </p>
          </div>
        </div>
        <Button onClick={openNew} variant="primary" size="md">
          <Plus className="w-4 h-4 mr-1" /> Add FAQ
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by question, category, or audience"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-400"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-center py-16 text-rose-600 text-sm">{error}</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          {q ? 'No FAQs match your search.' : 'No FAQs yet. Tap "Add FAQ" to create the first one.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Question</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 max-w-md">
                    <div className="text-slate-900 dark:text-white font-medium line-clamp-2">
                      {f.question}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {f.category}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(f.audience || []).map((a) => (
                        <span
                          key={a}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium border ${AUDIENCE_TINT[a] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                        >
                          {AUDIENCE_LABEL[a] || a}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {f.display_order}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(f)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                        f.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                      }`}
                      title={f.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {f.is_active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {f.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => openEdit(f)}
                        className="p-1.5 rounded-md text-slate-500 hover:text-brand-600 hover:bg-brand-50"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(f)}
                        className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Editor modal ── */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add FAQ' : 'Edit FAQ'}
        description="Content updates go live in the app immediately."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : (editing === 'new' ? 'Create FAQ' : 'Save changes')}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Input
            label="Question"
            value={draft.question}
            onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
            placeholder="What are you looking to explain?"
          />

          {/* Answer — rich text editor */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Answer
            </label>
            <RichTextEditor
              value={draft.answer}
              onChange={(html) => setDraft((d) => ({ ...d, answer: html }))}
              placeholder="Write the answer. Use formatting to keep it readable."
              minHeight={220}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Formatting supported: headings, bold, italic, underline, bullet + numbered lists, links.
            </p>
          </div>

          {/* Category */}
          <div>
            <Input
              label="Category / Section"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              placeholder="General, Account, Courses, Payments…"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {CATEGORY_SUGGESTIONS.map((c) => {
                const active = draft.category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, category: c }))}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400 hover:text-brand-600'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience multi-select */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Audience (multi-select)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {AUDIENCE_OPTIONS.map((opt) => {
                const checked = draft.audience.includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        audience: checked
                          ? d.audience.filter((x) => x !== opt.key)
                          : [...d.audience, opt.key],
                      }))
                    }
                    className={`flex items-start gap-2 text-left p-3 rounded-lg border transition-colors ${
                      checked
                        ? 'bg-brand-50 border-brand-400 text-brand-800'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center mt-0.5 ${
                        checked ? 'bg-brand-600 border-brand-600' : 'bg-white border-slate-300'
                      }`}
                    >
                      {checked ? <Check className="w-3 h-3 text-white" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-slate-500">{opt.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              The FAQ shows for every role that's checked here.
            </p>
          </div>

          {/* Display order + active */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Display order"
              type="number"
              value={String(draft.display_order)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({ ...d, display_order: Number.isFinite(n) ? n : 0 }));
              }}
              hint="Lower numbers appear first within a category."
            />
            <div className="pt-6">
              <Toggle
                checked={draft.is_active}
                onChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
                label="Active"
                description="Inactive FAQs are hidden from the app."
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
