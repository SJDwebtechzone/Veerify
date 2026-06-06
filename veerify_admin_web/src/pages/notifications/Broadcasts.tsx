import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Send, Building2, Sparkles, AlertCircle, CheckCircle,
  Filter, Search, X, Loader2,
} from 'lucide-react';
import apiClient from '../../api/client';

type Scope = 'all' | 'active' | 'pending' | 'specific';

interface InstitutionRow {
  id: number;
  name: string;
  city?: string | null;
  onboarding_status: string;
  owner_name?: string | null;
}

interface Counts {
  pending_approval: number;
  approved: number;
  active: number;
  rejected: number;
  expired: number;
  deleted: number;
  total: number;
}

const MAX_TITLE = 150;
const MAX_MESSAGE = 800;

const SCOPE_OPTIONS: { key: Scope; label: string; helper: string; icon: any }[] = [
  { key: 'active',   label: 'Active only',  helper: 'Live academies',     icon: CheckCircle },
  { key: 'pending',  label: 'Pending',      helper: 'Awaiting approval',  icon: AlertCircle },
  { key: 'all',      label: 'All',          helper: 'Every non-deleted',  icon: Bell },
  { key: 'specific', label: 'Pick & choose', helper: 'Hand-pick a list',   icon: Filter },
];

export function Broadcasts() {
  const [scope, setScope] = useState<Scope>('active');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [counts, setCounts] = useState<Counts | null>(null);

  // Specific-scope state
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);

  // Submit state
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    delivered: number;
    skipped: number;
    scope: Scope;
  } | null>(null);
  const [error, setError] = useState('');

  // ── Initial fetch: counts + institution roster for the picker ──
  useEffect(() => {
    apiClient
      .get('/onboarding/counts')
      .then((r) => setCounts(r.data?.counts || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scope !== 'specific' || institutions.length > 0) return;
    setLoadingInstitutions(true);
    apiClient
      .get('/onboarding/all')
      .then((r) => setInstitutions(r.data?.institutions || []))
      .catch(() => setInstitutions([]))
      .finally(() => setLoadingInstitutions(false));
  }, [scope, institutions.length]);

  // ── Recipient count preview ──
  const recipientCount = useMemo(() => {
    if (!counts) return 0;
    switch (scope) {
      case 'all':      return counts.total;
      case 'active':   return counts.active;
      case 'pending':  return counts.pending_approval;
      case 'specific': return selectedIds.length;
    }
  }, [scope, counts, selectedIds.length]);

  const filteredInstitutions = useMemo(() => {
    if (!search.trim()) return institutions;
    const q = search.trim().toLowerCase();
    return institutions.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.city || '').toLowerCase().includes(q) ||
        (i.owner_name || '').toLowerCase().includes(q),
    );
  }, [institutions, search]);

  const canSend =
    title.trim().length > 0 &&
    !sending &&
    recipientCount > 0;

  const handleSend = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (recipientCount === 0) {
      setError('No institutions match this scope');
      return;
    }
    if (
      !window.confirm(
        `Send "${title.trim()}" to ${recipientCount} ${recipientCount === 1 ? 'institution' : 'institutions'}?`,
      )
    ) {
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await apiClient.post('/onboarding/notify-bulk', {
        scope,
        institution_ids: scope === 'specific' ? selectedIds : undefined,
        title: title.trim(),
        message: message.trim() || null,
        category: 'system',
      });
      setResult({
        delivered: res.data?.delivered_count || 0,
        skipped: res.data?.skipped_count || 0,
        scope,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const resetAndCompose = () => {
    setResult(null);
    setTitle('');
    setMessage('');
    setSelectedIds([]);
    setError('');
  };

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const selectAll = () =>
    setSelectedIds(filteredInstitutions.map((i) => i.id));
  const clearAll = () => setSelectedIds([]);

  // ── Success screen ──
  if (result) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={42} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Broadcast sent</h1>
        <p className="text-gray-500 mt-2">
          Delivered to {result.delivered} institution{result.delivered === 1 ? '' : 's'}
          {result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}.
          They'll see it in their mobile bell inbox.
        </p>

        <div className="flex justify-center gap-3 mt-8">
          <button
            onClick={resetAndCompose}
            className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
          >
            <Sparkles size={16} />
            Compose another
          </button>
          <button
            onClick={() => (window.location.href = '/')}
            className="px-5 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Compose ──
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Bell size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Broadcast Notification</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Send a notification to many institutions at once. Lands in the owner's mobile inbox.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Compose area */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Scope picker */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Audience
            </p>
            <div className="grid grid-cols-2 gap-3">
              {SCOPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const on = scope === opt.key;
                const c =
                  opt.key === 'all'
                    ? counts?.total
                    : opt.key === 'active'
                    ? counts?.active
                    : opt.key === 'pending'
                    ? counts?.pending_approval
                    : selectedIds.length;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setScope(opt.key)}
                    className={`text-left rounded-xl p-4 transition-all border-2 ${
                      on
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-100 bg-white hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <Icon size={16} />
                      </div>
                      <div
                        className={`text-xs font-bold px-2 py-1 rounded-full ${
                          on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {c ?? '—'}
                      </div>
                    </div>
                    <p
                      className={`mt-3 text-sm font-semibold ${
                        on ? 'text-blue-700' : 'text-gray-900'
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p
                      className={`text-xs mt-1 ${
                        on ? 'text-blue-600' : 'text-gray-500'
                      }`}
                    >
                      {opt.helper}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Specific-scope institution picker */}
          {scope === 'specific' && (
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Pick institutions
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-xs text-blue-600 font-semibold hover:underline"
                  >
                    Select all visible
                  </button>
                  {selectedIds.length > 0 && (
                    <button
                      onClick={clearAll}
                      className="text-xs text-gray-500 font-semibold hover:underline"
                    >
                      Clear ({selectedIds.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="relative mb-3">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, city, or owner..."
                  className="w-full border border-gray-200 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                {loadingInstitutions ? (
                  <div className="p-6 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading institutions...
                  </div>
                ) : filteredInstitutions.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">
                    No institutions match this search.
                  </div>
                ) : (
                  filteredInstitutions.map((inst) => {
                    const checked = selectedIds.includes(inst.id);
                    return (
                      <label
                        key={inst.id}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                          checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(inst.id)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 flex-shrink-0">
                          <Building2 size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {inst.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {inst.owner_name || '—'}
                            {inst.city ? ` · ${inst.city}` : ''}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                            inst.onboarding_status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : inst.onboarding_status === 'pending_approval'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {inst.onboarding_status.replace(/_/g, ' ')}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Title */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder="e.g. New feature: Razorpay fees now live"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {title.length}/{MAX_TITLE}
            </p>
          </div>

          {/* Message */}
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
              placeholder="Add the details here. Keep it short and clear."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm h-32 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">
              {message.length}/{MAX_MESSAGE}
            </p>
          </div>
        </div>

        {/* Preview + send rail */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Recipient counter */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 text-center">
            <p className="text-xs text-blue-600 font-bold uppercase tracking-wider">
              Will reach
            </p>
            <p className="text-4xl font-extrabold text-blue-700 mt-2">
              {recipientCount}
            </p>
            <p className="text-xs text-blue-600 font-medium">
              institution{recipientCount === 1 ? '' : 's'}
            </p>
          </div>

          {/* Preview card */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Preview (mobile inbox)
            </p>
            <div className="border-l-4 border-red-500 bg-gray-50 rounded-r-lg p-4">
              <div className="inline-flex items-center gap-1 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider mb-2">
                <Bell size={9} /> Platform
              </div>
              <p className="text-sm font-bold text-gray-900">
                {title.trim() || 'Your title appears here'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {message.trim() ||
                  'Your message appears here. Recipients see this in their notifications inbox.'}
              </p>
              <p className="text-[10px] text-gray-400 mt-2">Just now</p>
            </div>
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={16} />
                Send to {recipientCount} {recipientCount === 1 ? 'institution' : 'institutions'}
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            You can't undo a broadcast. Double-check the audience and message.
          </p>
        </div>
      </div>
    </div>
  );
}
