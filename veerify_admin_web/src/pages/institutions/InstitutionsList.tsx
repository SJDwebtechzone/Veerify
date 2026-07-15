import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Search, Eye, RefreshCw, AlertCircle, Trash2, AlertTriangle,
  CheckCircle2, XCircle, X,
} from 'lucide-react';
import apiClient from '../../api/client';
import { resolveImageUrl } from '../../lib/api';

// Result item returned by the bulk-delete flow — one per selected row.
// Displayed in the "some failed" summary panel so the admin knows
// exactly which ones didn't go through and why.
interface BulkDeleteResult {
  id:    number;
  name:  string;
  ok:    boolean;
  error?: string;
}

interface Institution {
  id: number;
  name: string;
  institution_type: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  onboarding_status: string;
  is_active: boolean;
  created_at: string;
  approved_at: string | null;
  master_name: string | null;
  registration_number: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  payment_link_status: 'pending' | 'paid' | 'expired' | 'cancelled' | null;
  payment_amount: number | null; // paise
  paid_at: string | null;
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
  plan_name: string | null;
  plan_price: string | null;
}

type StatusFilter =
  | 'all'
  | 'active'
  | 'approved'
  | 'pending_approval'
  | 'rejected'
  | 'expired';

interface Props {
  presetFilter?: StatusFilter;
  pageTitle?: string;
  pageSubtitle?: string;
}

export function InstitutionsList({
  presetFilter,
  pageTitle = 'All Institutions',
  pageSubtitle = 'Every academy on the Veerify platform.',
}: Props) {
  const navigate = useNavigate();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>(presetFilter || 'all');
  const [toggling, setToggling] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Institution | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // ── Multi-select + bulk delete ─────────────────────────────────────
  // `selected` = ids of every institution currently checked. `bulkConfirmOpen`
  // shows the confirmation modal before firing the bulk DELETE loop. `bulkResults`
  // holds the per-row outcome so we can render the "N deleted / M failed" panel.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkDeleteResult[] | null>(null);

  const load = async (statusFilter: StatusFilter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter === 'expired') {
        params.set('expired', 'true');
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const res = await apiClient.get(`/onboarding/all?${params.toString()}`);
      setInstitutions(res.data.institutions || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load institutions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Auto-dismiss success message after 4s.
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 4000);
    return () => clearTimeout(t);
  }, [successMsg]);

  const handleToggleActive = async (inst: Institution) => {
    const nextValue = !inst.is_active;
    // Optimistic update — flip locally first so the switch feels instant.
    setInstitutions((prev) =>
      prev.map((i) => (i.id === inst.id ? { ...i, is_active: nextValue } : i)),
    );
    setToggling((s) => new Set(s).add(inst.id));
    try {
      await apiClient.post(`/onboarding/toggle-active/${inst.id}`, { is_active: nextValue });
      setSuccessMsg(`${inst.name} is now ${nextValue ? 'ACTIVE' : 'INACTIVE'}.`);
    } catch (err: any) {
      // Roll back on failure.
      setInstitutions((prev) =>
        prev.map((i) => (i.id === inst.id ? { ...i, is_active: inst.is_active } : i)),
      );
      setError(err.response?.data?.message || 'Could not change status');
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(inst.id);
        return n;
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    try {
      await apiClient.delete(`/onboarding/${pendingDelete.id}`);
      // Drop the row locally — no need to re-fetch.
      setInstitutions((prev) => prev.filter((i) => i.id !== pendingDelete.id));
      setSuccessMsg(`${pendingDelete.name} deleted permanently.`);
      setPendingDelete(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // Fire N deletes in parallel and record every outcome. The endpoint
  // already cascades the institution's courses / batches / students /
  // attendance server-side (see /onboarding/:id — same DELETE the
  // single-delete flow uses), so no extra client work is needed to
  // honour "related data is handled according to the application's
  // deletion rules". We batch results so the admin sees which rows
  // succeeded and which failed, without a mid-loop halt.
  const runBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    // Snapshot the row metadata before we start deleting, so the
    // results panel can show the actual names even after the rows
    // disappear from the local list.
    const byId = new Map(institutions.map((i) => [i.id, i]));

    setBulkDeleting(true);
    setError('');
    setSuccessMsg('');

    const results: BulkDeleteResult[] = await Promise.all(
      ids.map(async (id) => {
        const inst = byId.get(id);
        const name = inst?.name || `#${id}`;
        try {
          await apiClient.delete(`/onboarding/${id}`);
          return { id, name, ok: true };
        } catch (err: any) {
          return {
            id,
            name,
            ok: false,
            error: err?.response?.data?.message || err?.message || 'Delete failed',
          };
        }
      }),
    );

    // Drop every successfully deleted row locally so the list
    // updates immediately.
    const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    if (okIds.size > 0) {
      setInstitutions((prev) => prev.filter((i) => !okIds.has(i.id)));
    }
    // Keep only failed rows in the selection so the admin can retry
    // them from the same bulk bar.
    const failedIds = new Set(results.filter((r) => !r.ok).map((r) => r.id));
    setSelected(failedIds);

    setBulkResults(results);
    setBulkConfirmOpen(false);
    setBulkDeleting(false);

    const okCount = results.length - failedIds.size;
    if (failedIds.size === 0) {
      setSuccessMsg(
        `${okCount} institution${okCount === 1 ? '' : 's'} deleted permanently.`,
      );
    } else if (okCount > 0) {
      setSuccessMsg(
        `${okCount} deleted · ${failedIds.size} failed — see details below.`,
      );
    } else {
      setError(`All ${failedIds.size} deletes failed — see details below.`);
    }
  };

  const visible = useMemo(() => {
    if (!search.trim()) return institutions;
    const q = search.trim().toLowerCase();
    return institutions.filter(
      (i) =>
        i.name?.toLowerCase().includes(q) ||
        i.owner_name?.toLowerCase().includes(q) ||
        i.owner_email?.toLowerCase().includes(q) ||
        i.city?.toLowerCase().includes(q),
    );
  }, [institutions, search]);

  // Header checkbox derives its state from selection ∩ current visible
  // rows so filtering / searching doesn't lie about the "select all".
  const visibleIds = useMemo(() => visible.map((i) => i.id), [visible]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some((id) => selected.has(id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        // Everything visible is checked → uncheck them all.
        visibleIds.forEach((id) => next.delete(id));
      } else {
        // Otherwise add every visible row.
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const c = { all: institutions.length, active: 0, approved: 0, pending_approval: 0, rejected: 0, expired: 0 };
    const now = Date.now();
    institutions.forEach((i) => {
      // Matches the backend's strict definitions:
      // • Active  = onboarding_status='active' + is_active=true + subscription still valid.
      // • Expired = onboarding_status='active' + subscription_end in the past.
      //   (Pending / approved / rejected rows never went live, so they
      //   don't count as expired even if some stale end-date lingers.)
      const subEnded = !!(i.subscription_end && new Date(i.subscription_end).getTime() < now);
      if (i.onboarding_status === 'active' && i.is_active && !subEnded) c.active++;
      if (i.onboarding_status === 'approved') c.approved++;
      if (i.onboarding_status === 'pending_approval') c.pending_approval++;
      if (i.onboarding_status === 'rejected') c.rejected++;
      if (i.onboarding_status === 'active' && subEnded) c.expired++;
    });
    return c;
  }, [institutions]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{pageTitle}</h1>
          <p className="text-gray-500 mt-1">{pageSubtitle}</p>
        </div>
        <button
          onClick={() => load(filter)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg flex items-center gap-2">
          ✓ {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!presetFilter && (
        <div className="flex flex-wrap gap-2">
          <FilterPill label="All"            count={counts.all}              active={filter === 'all'}              onClick={() => setFilter('all')} />
          <FilterPill label="Active"         count={counts.active}           active={filter === 'active'}           onClick={() => setFilter('active')} color="emerald" />
          <FilterPill label="Awaiting Pay"   count={counts.approved}         active={filter === 'approved'}         onClick={() => setFilter('approved')} color="blue" />
          <FilterPill label="Pending"        count={counts.pending_approval} active={filter === 'pending_approval'} onClick={() => setFilter('pending_approval')} color="yellow" />
          <FilterPill label="Rejected"       count={counts.rejected}         active={filter === 'rejected'}         onClick={() => setFilter('rejected')} color="red" />
          <FilterPill label="Expired"        count={counts.expired}          active={filter === 'expired'}          onClick={() => setFilter('expired')} color="gray" />
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by academy name, owner, email, or city…"
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-white border border-gray-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        />
      </div>

      {/* ── Bulk action bar ───────────────────────────────────────── */}
      {/* Sticky-ish bar that appears whenever at least one row is
          checked. Shows the selection count and a Delete N button.
          Deliberately kept above the table (rather than floating) so
          the underlying rows stay legible. */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">
              {selected.size} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              Clear
            </button>
          </div>
          <button
            onClick={() => setBulkConfirmOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
          >
            <Trash2 size={15} />
            Delete {selected.size} institution{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {/* ── Bulk results panel ────────────────────────────────────── */}
      {/* Rendered after a bulk-delete cycle completes, whether or not
          any rows failed. Lists every attempted row with a green tick
          (success) or a red cross (failure + reason), so the admin
          knows exactly what to retry. */}
      {bulkResults && bulkResults.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Bulk delete results
              {' · '}
              <span className="text-emerald-600">
                {bulkResults.filter((r) => r.ok).length} deleted
              </span>
              {bulkResults.some((r) => !r.ok) && (
                <>
                  {' · '}
                  <span className="text-red-600">
                    {bulkResults.filter((r) => !r.ok).length} failed
                  </span>
                </>
              )}
            </h3>
            <button
              onClick={() => setBulkResults(null)}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {bulkResults.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                {r.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
                )}
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{r.name}</div>
                  {!r.ok && (
                    <div className="text-xs text-red-600">{r.error || 'Delete failed'}</div>
                  )}
                </div>
                {r.ok ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    Deleted
                  </span>
                ) : (
                  <span className="text-xs font-semibold uppercase tracking-wide text-red-600">
                    Failed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-base font-semibold text-gray-700">
            {search ? 'No matching institutions' : 'No institutions yet'}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {search ? 'Try a different search term.' : 'New academies will show up here once they register.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {/* Master "select all visible" checkbox. Uses the DOM
                      `indeterminate` state via a ref callback so it
                      shows a mixed state whenever some — but not all —
                      visible rows are selected. */}
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      aria-label="Select all visible institutions"
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-5 py-3">Academy</th>
                  <th className="px-5 py-3">Owner</th>
                  <th className="px-5 py-3">Plan</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Subscribed</th>
                  <th className="px-5 py-3">Paid On</th>
                  <th className="px-5 py-3">Expires</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Active</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map((inst) => (
                  <Row
                    key={inst.id}
                    inst={inst}
                    busyToggle={toggling.has(inst.id)}
                    onView={() => navigate(`/institutions/${inst.id}`)}
                    onToggle={() => handleToggleActive(inst)}
                    onDelete={() => setPendingDelete(inst)}
                    selected={selected.has(inst.id)}
                    onToggleSelect={() => toggleOne(inst.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">Delete this institution?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This will permanently delete{' '}
                  <span className="font-semibold text-gray-900">{pendingDelete.name}</span>{' '}
                  and all of its courses, batches, students, and attendance records.
                  The owner's user account will remain so they can re-register if needed.
                </p>
                <p className="text-sm text-red-600 font-semibold mt-3">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk delete confirmation modal ────────────────────────── */}
      {bulkConfirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">
                  Delete {selected.size} institution{selected.size === 1 ? '' : 's'}?
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Every selected academy will be permanently removed along with
                  its courses, batches, students, and attendance records.
                  Owner user accounts stay intact so they can re-register.
                </p>
                {/* Quick preview of what's about to be deleted so the
                    admin can catch a rogue selection before it fires. */}
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-2">
                  <ul className="space-y-1">
                    {Array.from(selected).slice(0, 12).map((id) => {
                      const inst = institutions.find((i) => i.id === id);
                      return (
                        <li key={id} className="text-xs text-gray-700">
                          • {inst?.name || `#${id}`}
                        </li>
                      );
                    })}
                    {selected.size > 12 && (
                      <li className="text-xs italic text-gray-500">
                        …and {selected.size - 12} more
                      </li>
                    )}
                  </ul>
                </div>
                <p className="text-sm text-red-600 font-semibold mt-3">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkDeleting}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={runBulkDelete}
                disabled={bulkDeleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {bulkDeleting
                  ? `Deleting ${selected.size}…`
                  : `Delete ${selected.size} forever`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────── Row ───────────
function Row({
  inst, busyToggle, onView, onToggle, onDelete, selected, onToggleSelect,
}: {
  inst: Institution;
  busyToggle: boolean;
  onView: () => void;
  onToggle: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const expiresInfo = expiresLabel(inst.subscription_end);
  return (
    <tr
      className={
        selected
          ? 'bg-blue-50/60 transition-colors hover:bg-blue-50'
          : 'transition-colors hover:bg-gray-50'
      }
    >
      {/* Row checkbox. Clicking anywhere in the cell (not just the
          checkbox itself) toggles selection to make it easier to hit. */}
      <td
        className="px-4 py-4 cursor-pointer"
        onClick={onToggleSelect}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${inst.name}`}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <Logo logoUrl={inst.logo_url} name={inst.name} />
          <div>
            <p className="font-semibold text-gray-900">{inst.name}</p>
            <p className="text-xs text-gray-500">
              {inst.institution_type ? `${inst.institution_type} • ` : ''}
              {inst.city || '—'}
            </p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <p className="text-sm font-medium text-gray-900">{inst.owner_name}</p>
        <p className="text-xs text-gray-500">{inst.owner_email}</p>
      </td>
      <td className="px-5 py-4">
        {inst.plan_name ? (
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              inst.plan_name === 'Pro'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {inst.plan_name} — ₹{parseInt(inst.plan_price || '0').toLocaleString()}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
      <td className="px-5 py-4">
        <StatusBadge status={inst.onboarding_status} subscriptionEnd={inst.subscription_end} />
      </td>
      <td className="px-5 py-4">
        <p className="text-sm text-gray-700">{formatDate(inst.subscription_start)}</p>
      </td>
      <td className="px-5 py-4">
        <p className="text-sm text-gray-700">{formatDate(inst.paid_at)}</p>
      </td>
      <td className="px-5 py-4">
        <p className="text-sm text-gray-700">{formatDate(inst.subscription_end)}</p>
        {expiresInfo && (
          <p className={`text-xs mt-0.5 ${expiresInfo.expired ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
            {expiresInfo.text}
          </p>
        )}
      </td>
      <td className="px-5 py-4">
        <p className="text-sm font-semibold text-gray-900">
          {inst.payment_amount
            ? `₹${Math.round(inst.payment_amount / 100).toLocaleString()}`
            : '—'}
        </p>
      </td>
      <td className="px-5 py-4">
        <ToggleSwitch
          checked={inst.is_active}
          disabled={busyToggle}
          onChange={onToggle}
        />
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onView}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
            title="View details"
          >
            <Eye size={14} />
            View
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center w-9 h-8 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            title="Delete institution"
            aria-label="Delete institution"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────── Toggle switch ───────────
function ToggleSwitch({
  checked, disabled, onChange,
}: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ─────────── Helpers ───────────
function Logo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const url = logoUrl ? resolveImageUrl(logoUrl) : '';
  if (url) {
    return <img src={url} alt={name} className="w-10 h-10 rounded-lg object-cover border border-gray-100" />;
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
      {name?.charAt(0).toUpperCase()}
    </div>
  );
}

function StatusBadge({
  status, subscriptionEnd,
}: { status: string; subscriptionEnd: string | null }) {
  if (status === 'active' && subscriptionEnd && new Date(subscriptionEnd).getTime() < Date.now()) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
        EXPIRED
      </span>
    );
  }
  const map: Record<string, string> = {
    active:           'bg-emerald-100 text-emerald-700 border-emerald-200',
    approved:         'bg-blue-100 text-blue-700 border-blue-200',
    pending_approval: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    rejected:         'bg-red-100 text-red-700 border-red-200',
    plan_selected:    'bg-slate-100 text-slate-700 border-slate-200',
    registered:       'bg-slate-100 text-slate-700 border-slate-200',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  );
}

function FilterPill({
  label, count, active, onClick, color = 'slate',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: 'slate' | 'emerald' | 'blue' | 'yellow' | 'red' | 'gray';
}) {
  const palette: Record<string, string> = {
    slate:   'bg-slate-100 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue:    'bg-blue-50 text-blue-700 border-blue-200',
    yellow:  'bg-yellow-50 text-yellow-800 border-yellow-200',
    red:     'bg-red-50 text-red-700 border-red-200',
    gray:    'bg-gray-50 text-gray-700 border-gray-200',
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : palette[color] + ' hover:bg-white'
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function expiresLabel(dateStr: string | null): { text: string; expired: boolean } | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `expired ${Math.abs(days)}d ago`, expired: true };
  if (days === 0) return { text: 'expires today', expired: false };
  if (days <= 14) return { text: `${days}d left`, expired: false };
  return null;
}
