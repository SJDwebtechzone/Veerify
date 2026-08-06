import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Save, CheckCircle2, AlertCircle, FileText, Eye, EyeOff, Loader2,
  PenLine,
} from 'lucide-react';
import apiClient from '../../api/client';
import { RichTextEditor } from './RichTextEditor';
import { sectionsForSlug, type SectionSchema } from './legalSectionSchemas';

// Per-slug intro copy for the admin. Everything else — section outline,
// per-section headings — comes from the shared legalSectionSchemas.
const SLUG_META: Record<string, { title: string; description: string }> = {
  terms_and_conditions: {
    title: 'Terms & Conditions',
    description:
      'The contract every user agrees to before using Veerify. Cover accounts, ownership, acceptable use, and dispute resolution.',
  },
  privacy_policy: {
    title: 'Privacy Policy',
    description:
      'What personal data Veerify collects, how it\'s stored, and users\' rights over their information.',
  },
  refund_and_cancellation_policy: {
    title: 'Refund & Cancellation Policy',
    description:
      'When students / institutions are eligible for refunds, cooling-off windows, and how to raise a request.',
  },
  child_safety_policy: {
    title: 'Child Safety Policy',
    description:
      'How Veerify protects minors — background checks, moderation, incident reporting.',
  },
  contact_and_support: {
    title: 'Contact & Support',
    description:
      'How users reach the support team — email, phone, response windows, escalation paths.',
  },
};

interface Section { key: string; title: string; content: string; }

// Merge saved sections with the canonical outline. New keys from the
// outline are appended with empty content; unknown saved keys are
// dropped. Preserves the outline's order so the editor always mirrors
// the spec's section list.
function mergeSectionsWithSchema(
  outline: SectionSchema[], saved: Section[] | undefined,
): Section[] {
  const savedByKey = new Map((saved || []).map((s) => [s.key, s]));
  return outline.map((o) => {
    const existing = savedByKey.get(o.key);
    return {
      key:     o.key,
      title:   existing?.title || o.title,
      content: existing?.content || '',
    };
  });
}

export function LegalPageEditor() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const meta = SLUG_META[slug];
  const outline = sectionsForSlug(slug);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'idle' | 'draft' | 'published'>('idle');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  const [title, setTitle] = useState(meta?.title || '');
  const [sections, setSections] = useState<Section[]>([]);
  const [isPublished, setIsPublished] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (!meta) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const res = await apiClient.get('/legal-pages/platform');
        if (cancelled) return;
        const page = (res.data?.pages || []).find((p: any) => p.slug === slug);
        setTitle(page?.title || meta.title);
        setSections(mergeSectionsWithSchema(outline, page?.sections));
        setIsPublished(!!page?.is_published);
        setLastUpdated(page?.updated_at || null);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.message || 'Failed to load the page');
          // Still show the outline so the admin can start typing.
          setSections(mergeSectionsWithSchema(outline, []));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const updateSectionContent = (key: string, content: string) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)));
  };

  const save = async (opts?: { publish?: boolean }) => {
    if (!meta) return;
    setSaving(true);
    setError('');
    const publish = opts?.publish ?? isPublished;
    try {
      // The legacy `content` field carries a concatenated fallback so
      // any consumer still reading it (older mobile / API scripts) gets
      // something meaningful. New consumers read `sections`.
      const flatContent = sections
        .map((s) => `<h2>${escapeHtml(s.title)}</h2>${s.content || ''}`)
        .join('\n');

      const res = await apiClient.post('/legal-pages/platform', {
        slug,
        title: (title || meta.title).trim(),
        content: flatContent,
        sections,
        is_published: publish,
      });
      setLastUpdated(res.data?.page?.updated_at || new Date().toISOString());
      setIsPublished(publish);
      setSaved(publish ? 'published' : 'draft');
      setTimeout(() => setSaved('idle'), 3500);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Unknown slug guard.
  if (!meta) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <AlertCircle size={28} className="mx-auto mb-2 text-red-500" />
        <h2 className="text-lg font-bold text-gray-900">Policy not found</h2>
        <p className="mt-1 text-sm text-gray-500">
          "{slug}" isn't a recognised platform policy.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <FileText size={13} />
            Platform legal · Managed by admin
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{meta.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            {meta.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Edit / Preview toggle — clicking Preview flips the same
              content into a read-only render so admin can see what
              the mobile users will actually see. */}
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
            <button
              onClick={() => setMode('edit')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold ${
                mode === 'edit' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <PenLine size={12} /> Edit
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold ${
                mode === 'preview' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Eye size={12} /> Preview
            </button>
          </div>
          <button
            onClick={() => save({ publish: false })}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {saving && !isPublished ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save draft
          </button>
          <button
            onClick={() => save({ publish: true })}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && isPublished ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {isPublished ? 'Republish' : 'Publish'}
          </button>
        </div>
      </div>

      {/* Saved / error banners */}
      {saved === 'draft' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} /> Draft saved. Not visible to students / trainers until you publish.
        </div>
      )}
      {saved === 'published' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} /> Published. Now visible to every user across the platform.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* Status strip */}
          <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-4">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                isPublished
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {isPublished ? <Eye size={12} /> : <EyeOff size={12} />}
              {isPublished ? 'Published' : 'Draft — hidden'}
            </div>
            {lastUpdated ? (
              <span className="text-xs text-gray-500">
                Last saved{' '}
                {new Date(lastUpdated).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: 'numeric', minute: '2-digit', hour12: true,
                })}
              </span>
            ) : (
              <span className="text-xs italic text-gray-500">
                Not saved yet — first save creates the page.
              </span>
            )}
          </div>

          {/* Title + section editor OR preview */}
          {mode === 'edit' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-100 bg-white p-6">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Display title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder={meta.title}
                  className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {sections.map((s) => (
                <div key={s.key} className="rounded-xl border border-gray-100 bg-white p-6">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      Section · {s.title}
                    </label>
                    {s.content && s.content !== '<br>' ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        WRITTEN
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">
                        EMPTY
                      </span>
                    )}
                  </div>
                  <RichTextEditor
                    value={s.content}
                    onChange={(html) => updateSectionContent(s.key, html)}
                    placeholder={`Write the ${s.title} content here.`}
                    minHeight={140}
                  />
                </div>
              ))}
            </div>
          ) : (
            <PreviewPane title={title || meta.title} sections={sections} />
          )}
        </>
      )}
    </div>
  );
}

// Read-only preview — renders exactly what the consumer (student /
// trainer) app will render. Section headings + sanitised HTML.
function PreviewPane({ title, sections }: { title: string; sections: Section[] }) {
  const hasContent = sections.some((s) => (s.content || '').trim() && s.content !== '<br>');
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-8">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <div className="my-4 h-px bg-gray-200" />
      {!hasContent ? (
        <p className="text-sm italic text-gray-500">
          Nothing written yet. Switch to Edit mode to add content.
        </p>
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <div key={s.key}>
              <h2 className="text-base font-bold text-gray-900">{s.title}</h2>
              {s.content && s.content !== '<br>' ? (
                <div
                  className="prose-legal-preview mt-2 text-sm text-gray-700"
                  dangerouslySetInnerHTML={{ __html: s.content }}
                />
              ) : (
                <p className="mt-2 text-xs italic text-gray-400">— empty</p>
              )}
            </div>
          ))}
        </div>
      )}
      <style>{`
        .prose-legal-preview p { margin: 0.35rem 0; line-height: 1.6; }
        .prose-legal-preview ul { list-style: disc; margin-left: 1.25rem; }
        .prose-legal-preview ol { list-style: decimal; margin-left: 1.25rem; }
        .prose-legal-preview h2 { font-size: 1rem; font-weight: 800; margin: 0.5rem 0 0.3rem; }
        .prose-legal-preview a { color: #2563EB; text-decoration: underline; }
        .prose-legal-preview strong { font-weight: 700; }
      `}</style>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
