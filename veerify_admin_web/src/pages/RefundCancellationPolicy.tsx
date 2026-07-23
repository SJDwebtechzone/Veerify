import { useEffect, useState } from 'react';
import { RefreshCcw, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import publicClient from '../api/publicClient';

interface Section {
  key: string;
  title: string;
  content: string;
}

interface LegalPage {
  slug: string;
  title: string;
  sections: Section[];
  updated_at: string;
}

export default function RefundCancellationPolicy() {
  const [page, setPage] = useState<LegalPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await publicClient.get('/legal-pages/public/refund_and_cancellation_policy');
        setPage(res.data?.page || null);
      } catch {
        setError('Unable to load the Refund & Cancellation Policy. Please try again later.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-[#080C1A] text-white">
      {/* Ambient background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-emerald-600/10 blur-[120px]" />
        <div className="absolute top-1/2 -left-40 w-[500px] h-[500px] rounded-full bg-teal-600/10 blur-[100px]" />
        <div className="absolute bottom-0 right-1/3 w-[400px] h-[400px] rounded-full bg-cyan-600/8 blur-[80px]" />
      </div>

      {/* Top nav bar */}
      <header className="relative z-20 border-b border-white/5 bg-white/3 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <RefreshCcw size={18} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">Veerify Platform</p>
            <p className="text-sm font-bold text-white leading-none">Legal Documentation</p>
          </div>
          <nav className="ml-auto flex items-center gap-1 text-xs text-gray-500">
            <a href="/" className="hover:text-white transition-colors">Home</a>
            <ChevronRight size={12} />
            <span className="text-gray-300">Refund &amp; Cancellation Policy</span>
          </nav>
        </div>
      </header>

      <div className="relative z-10 max-w-5xl mx-auto px-5 py-14">
        {/* Hero */}
        <div className="mb-14 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-5 py-2 text-sm text-emerald-300 font-medium mb-6 backdrop-blur-sm">
            <RefreshCcw size={15} />
            Refunds &amp; Cancellations
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight bg-gradient-to-br from-white via-gray-100 to-gray-400 bg-clip-text text-transparent mb-5 leading-none pb-2">
            {page?.title || 'Refund & Cancellation Policy'}
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto leading-relaxed">
            Understand your options for refunds, cancellations, and how we process your requests.
          </p>
          {page?.updated_at && (
            <p className="mt-4 text-xs text-gray-600">
              Last updated:{' '}
              {new Date(page.updated_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </div>

        {/* Content */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 size={36} className="animate-spin text-emerald-400" />
            <p className="text-gray-500 text-sm">Loading refund policy…</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && (!page || !page.sections?.length) && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCcw size={40} className="text-gray-700" />
            <p className="text-gray-500">Refund & Cancellation Policy hasn't been published yet.</p>
          </div>
        )}

        {!loading && !error && page && page.sections?.length > 0 && (
          <div className="space-y-6">
            {page.sections
              .filter((s) => s.content && s.content.trim() && s.content !== '<br>')
              .map((section, idx) => (
                <div
                  key={section.key}
                  className="group relative bg-white/4 backdrop-blur-md border border-white/8 rounded-2xl p-7 hover:bg-white/6 hover:border-emerald-500/20 transition-all duration-300"
                >
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/0 to-teal-500/0 group-hover:from-emerald-500/5 group-hover:to-teal-500/5 transition-all duration-500" />

                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-xs font-black text-emerald-400">
                        {idx + 1}
                      </span>
                      <h2 className="text-lg font-bold text-white">{section.title}</h2>
                    </div>
                    <div
                      className="prose-legal text-gray-300 leading-relaxed text-[15px]"
                      dangerouslySetInnerHTML={{ __html: section.content }}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 mt-20">
        <div className="max-w-5xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">
            © {new Date().getFullYear()} Veerify. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-xs text-gray-600">
            <a href="/privacy-policy" className="hover:text-emerald-400 transition-colors">
              Privacy Policy
            </a>
            <a href="/terms-and-conditions" className="hover:text-emerald-400 transition-colors">
              Terms &amp; Conditions
            </a>
            <a href="/refund-cancellation-policy" className="hover:text-emerald-400 transition-colors font-medium text-emerald-400">
              Refund Policy
            </a>
          </div>
        </div>
      </footer>

      <style>{`
        .prose-legal p { margin: 0.4rem 0; }
        .prose-legal ul { list-style: disc; padding-left: 1.4rem; margin: 0.5rem 0; }
        .prose-legal ol { list-style: decimal; padding-left: 1.4rem; margin: 0.5rem 0; }
        .prose-legal li { margin: 0.25rem 0; }
        .prose-legal h2, .prose-legal h3 { font-size: 1rem; font-weight: 700; margin: 0.75rem 0 0.25rem; color: #e2e8f0; }
        .prose-legal a { color: #34d399; text-decoration: underline; }
        .prose-legal strong { font-weight: 700; color: #e2e8f0; }
      `}</style>
    </main>
  );
}
