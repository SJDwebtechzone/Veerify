import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, Star, Search, User, Building2, Calendar, X,
  ChevronRight,
} from 'lucide-react';
import apiClient from '../../api/client';

// ─────────────────────────────────────────────────────────────────────────────
// Feedback — super-admin management page.
//
// Lists everything submitted from every mobile role (institution / branch
// admin, trainer, student, parent). Supports filtering by role, rating,
// date range, and free-text search across user name / email / message /
// institution / branch. Clicking a row opens a side-drawer with the full
// details for triage.
// ─────────────────────────────────────────────────────────────────────────────

interface FeedbackItem {
  id: number;
  role_snapshot: 'institution_admin' | 'branch_admin' | 'trainer' | 'student' | 'parent';
  rating: number;
  message: string | null;
  created_at: string;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  user_phone: string | null;
  institution_id: number | null;
  institution_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
}

interface Summary {
  total: number;
  avg_rating: string;   // numeric from postgres → string
  institution_admin: number;
  branch_admin: number;
  trainer: number;
  student: number;
  parent: number;
  last_7_days: number;
}

const ROLE_LABEL: Record<FeedbackItem['role_snapshot'], string> = {
  institution_admin: 'Institution',
  branch_admin:      'Branch',
  trainer:           'Trainer',
  student:           'Student',
  parent:            'Parent',
};

const ROLE_TINT: Record<FeedbackItem['role_snapshot'], string> = {
  institution_admin: 'bg-brand-50 text-brand-700 border-brand-200',
  branch_admin:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  trainer:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  student:           'bg-blue-50 text-blue-700 border-blue-200',
  parent:            'bg-purple-50 text-purple-700 border-purple-200',
};

function StarRow({ n, size = 12 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= n ? 'text-amber-500' : 'text-slate-300'}
          fill={i <= n ? '#F59E0B' : 'transparent'}
          strokeWidth={2}
        />
      ))}
    </span>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export function Feedback() {
  const [items,   setItems]   = useState<FeedbackItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Filters
  const [role,   setRole]   = useState<string>('');
  const [rating, setRating] = useState<string>('');
  const [from,   setFrom]   = useState<string>('');
  const [to,     setTo]     = useState<string>('');
  const [q,      setQ]      = useState<string>('');

  // Selected row for the side drawer.
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  useEffect(() => {
    apiClient.get('/feedback/summary')
      .then((r) => setSummary(r.data || null))
      .catch(() => setSummary(null));
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (role)   params.set('role',   role);
      if (rating) params.set('rating', rating);
      if (from)   params.set('from',   from);
      if (to)     params.set('to',     to);
      if (q.trim()) params.set('q',    q.trim());
      const r = await apiClient.get('/feedback?' + params.toString());
      setItems(r.data?.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load feedback');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [role, rating, from, to]);

  // Search debounces on Enter — cheap for now, we don't hammer the server per keystroke.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') load();
  };

  const avg = summary ? Number(summary.avg_rating).toFixed(2) : '—';

  const roleTabs = useMemo(() => ([
    { key: '',                   label: 'All',         count: summary?.total },
    { key: 'institution_admin',  label: 'Institution', count: summary?.institution_admin },
    { key: 'branch_admin',       label: 'Branch',      count: summary?.branch_admin },
    { key: 'trainer',            label: 'Trainer',     count: summary?.trainer },
    { key: 'student',            label: 'Student',     count: summary?.student },
    { key: 'parent',             label: 'Parent',      count: summary?.parent },
  ]), [summary]);

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-600" />
            <h1 className="text-2xl font-bold text-slate-900">Feedback</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            User feedback submitted from every mobile role.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total feedback"   value={String(summary.total)} sub={`${summary.last_7_days} in last 7d`} />
          <StatCard label="Average rating"   value={avg} sub={<StarRow n={Math.round(Number(avg) || 0)} />} />
          <StatCard label="Institutions"     value={String(summary.institution_admin + summary.branch_admin)} sub={`${summary.institution_admin} main · ${summary.branch_admin} branch`} />
          <StatCard label="Trainers & Students" value={String(summary.trainer + summary.student)} sub={`${summary.trainer} trainer · ${summary.student} student`} />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        {/* Role tabs */}
        <div className="flex flex-wrap gap-2">
          {roleTabs.map((tab) => (
            <button
              key={tab.key || 'all'}
              onClick={() => setRole(tab.key)}
              className={
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ' +
                (role === tab.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100')
              }
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span className={
                  'ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold ' +
                  (role === tab.key ? 'bg-white/20 px-1.5 py-0.5' : 'bg-slate-200 px-1.5 py-0.5 text-slate-700')
                }>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Rating filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Rating:</span>
            <select
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
            >
              <option value="">Any</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="3">3 stars</option>
              <option value="2">2 stars</option>
              <option value="1">1 star</option>
            </select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">From:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">To:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
            />
          </div>

          {/* Search */}
          <div className="ml-auto relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, email, message, institution…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              className="text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 bg-white w-72 focus:outline-none focus:border-brand-400"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading feedback…</div>
        ) : error ? (
          <div className="p-12 text-center text-sm text-rose-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <MessageSquare className="w-8 h-8 mx-auto text-slate-300 mb-3" />
            <div className="text-sm text-slate-500">No feedback yet for this filter.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Institution / Branch</th>
                <th className="text-left px-4 py-3">Rating</th>
                <th className="text-left px-4 py-3">Message</th>
                <th className="text-left px-4 py-3">Submitted</th>
                <th className="text-left px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  onClick={() => setSelected(it)}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <span className={
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ' +
                      ROLE_TINT[it.role_snapshot]
                    }>
                      {ROLE_LABEL[it.role_snapshot]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{it.user_name || '—'}</div>
                    <div className="text-xs text-slate-500">{it.user_email || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-900">{it.institution_name || '—'}</div>
                    {it.branch_name && (
                      <div className="text-xs text-slate-500">{it.branch_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StarRow n={it.rating} />
                  </td>
                  <td className="px-4 py-3 max-w-md">
                    <div className="text-slate-700 truncate">{it.message || <span className="text-slate-400 italic">No message</span>}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(it.created_at)}</td>
                  <td className="px-4 py-3 text-slate-400">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setSelected(null)}
          />
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  Feedback #{selected.id}
                </div>
                <div className="text-lg font-bold text-slate-900">
                  {ROLE_LABEL[selected.role_snapshot]} feedback
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-full p-1.5 hover:bg-slate-100"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Rating hero */}
              <div className="bg-amber-50 rounded-xl p-4 flex items-center gap-3">
                <StarRow n={selected.rating} size={20} />
                <div className="text-sm">
                  <div className="font-bold text-amber-900">{selected.rating} / 5</div>
                  <div className="text-xs text-amber-800">{fmtDate(selected.created_at)}</div>
                </div>
              </div>

              {/* User */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">User</div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold">
                    <User className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900">{selected.user_name || '—'}</div>
                    <div className="text-xs text-slate-500">{selected.user_email || '—'}</div>
                    {selected.user_phone && (
                      <div className="text-xs text-slate-500">{selected.user_phone}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Institution */}
              {(selected.institution_name || selected.branch_name) && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Academy</div>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">
                        {selected.institution_name || '—'}
                      </div>
                      {selected.branch_name && (
                        <div className="text-xs text-slate-500">Branch: {selected.branch_name}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Message */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Message</div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-800 leading-relaxed">
                  {selected.message || <span className="text-slate-400 italic">No message provided.</span>}
                </div>
              </div>

              {/* Meta */}
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Submitted {fmtDate(selected.created_at)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────
function StatCard({
  label, value, sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      {sub != null && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
