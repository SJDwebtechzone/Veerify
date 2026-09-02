// src/pages/events/EventApprovals.tsx
//
// Super-admin queue for Intra-Level mobile events. Three views:
//   • Pending  — submitted, awaiting action. Approve/Reject buttons.
//   • Approved — already promoted to every institution's feed.
//   • History  — every intra event ever submitted, any status.
//
// Every list is paginated (10 per page). Counts stay in sync with
// the DB: after each Approve/Reject we refetch the current page +
// the pending count so the sidebar badge / bell number update
// immediately.
//
// Endpoints:
//   GET  /intra-events/pending?limit=10&offset=N     — pending page
//   GET  /intra-events?status=approved&limit=10&…    — approved page
//   GET  /intra-events?status=all&limit=10&…         — history page
//   GET  /intra-events/pending-count                 — badge number
//   POST /intra-events/:id/approve
//   POST /intra-events/:id/reject   (body: { reason?: string })

import type React from 'react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Calendar, MapPin, Building2, CheckCircle, XCircle,
  RefreshCw, Image as ImageIcon, User, Clock, History as HistoryIcon,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import apiClient from '../../api/client';

type Status = 'pending' | 'approved' | 'rejected';
type Tab    = 'pending' | 'approved' | 'history';

// Skill row inside a category. Divisions ride along inside each
// skill; older events written before that feature just omit the key.
interface SkillEntry {
  name: string;
  age_from?: number | null;
  age_to?: number | null;
  divisions?: Array<{ name: string }>;
}

// One category block from the event's Categories & Skills section.
// Every field except `name` + `skills` is optional so older event
// rows (pre-gender, pre-divisions) still deserialise cleanly.
interface CategoryEntry {
  name: string;
  gender?: string;
  skills?: SkillEntry[];
}

interface IntraEvent {
  id: number;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  image_url?: string | null;
  event_date: string;
  event_time?: string | null;            // 'HH:mm' 24h, from migration 096
  registration_closing_date?: string | null;
  location?: string | null;
  link?: string | null;
  // Categories & Skills, JSONB blob written by CreateEventScreen. May
  // be missing on old rows that predate migration 096.
  categories?: CategoryEntry[] | null;
  payment_required?: boolean;
  payment_amount?: number | null;
  payment_link?: string | null;
  // Publish schedule — null → publish immediately; a future timestamp
  // means the event is queued to fan out at that time.
  publish_at?: string | null;
  approval_status?: Status;
  event_type?: string;
  submitted_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  created_at: string;
  institution_id: number;
  institution_name: string | null;
  institution_logo: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
}

// Registration Form definition returned by
// GET /api/events/:id/registration-form. Fetched lazily when the
// detail modal opens so we don't overload the list responses.
interface RegFormField {
  id: number;
  fieldKey: string;
  label: string;
  type: string;
  required: boolean;
  options?: Array<{ label: string; value: string }> | null;
  sourceType: 'student' | 'custom';
  sourceKey?: string | null;
  sortOrder?: number;
}
interface RegFormResponse {
  enabled: boolean;
  fields: RegFormField[];
}

interface ListResponse {
  total: number;
  count: number;
  limit: number;
  offset: number;
  events: IntraEvent[];
}

const PAGE_SIZE = 10;

export function EventApprovals() {
  const [tab, setTab] = useState<Tab>('pending');
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<IntraEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<IntraEvent | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Pending badge — polled independently so the tab-header
  // number is always up to date even if the operator sits on the
  // Approved / History tab. Refreshed after every mutation too.
  const refreshPendingCount = useCallback(async () => {
    try {
      const r = await apiClient.get('/intra-events/pending-count');
      setPendingCount(r.data?.total || 0);
    } catch { /* leave stale — the sidebar badge shows the same value */ }
  }, []);

  const load = useCallback(async (opts?: { keepPage?: boolean }) => {
    setLoading(true); setError('');
    try {
      const offset = ((opts?.keepPage ? page : 1) - 1) * PAGE_SIZE;
      if (!opts?.keepPage) setPage(1);
      let url: string;
      if (tab === 'pending') {
        url = `/intra-events/pending?limit=${PAGE_SIZE}&offset=${offset}`;
      } else if (tab === 'approved') {
        url = `/intra-events?status=approved&limit=${PAGE_SIZE}&offset=${offset}`;
      } else {
        url = `/intra-events?status=all&limit=${PAGE_SIZE}&offset=${offset}`;
      }
      const r = await apiClient.get<ListResponse>(url);
      setEvents(r.data.events || []);
      setTotal(r.data.total || 0);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load events');
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  // Reload whenever the tab changes (resets to page 1) or the page
  // number is changed by the paginator (keeps the tab, changes page).
  useEffect(() => { load(); refreshPendingCount(); /* eslint-disable-next-line */ }, [tab]);
  useEffect(() => { load({ keepPage: true }); /* eslint-disable-next-line */ }, [page]);

  const mutate = async (fn: () => Promise<void>) => {
    try {
      await fn();
      // Refresh both the current view and the pending badge so the
      // sidebar and bell numbers update immediately.
      await Promise.all([load({ keepPage: true }), refreshPendingCount()]);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Action failed');
    }
  };

  const approve = (id: number) => mutate(async () => {
    setBusyId(id);
    try {
      await apiClient.post(`/intra-events/${id}/approve`);
      if (selected?.id === id) setSelected(null);
    } finally { setBusyId(null); }
  });

  const reject = (id: number) => mutate(async () => {
    const reason = window.prompt('Optional reason for rejection (visible to the institution admin):') || '';
    setBusyId(id);
    try {
      await apiClient.post(`/intra-events/${id}/reject`, { reason });
      if (selected?.id === id) setSelected(null);
    } finally { setBusyId(null); }
  });

  const fmtDate = (s?: string | null) => {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  };
  const fmtDateTime = (s?: string | null) => {
    if (!s) return '—';
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header + tab toggle + refresh */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Approvals</h1>
          <p className="text-gray-500 mt-1">
            Intra-Level events awaiting review before they fan out to every institution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { load({ keepPage: true }); refreshPendingCount(); }}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Pending/Approved toggle + History button */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          <TabButton
            active={tab === 'pending'}
            onClick={() => setTab('pending')}
            label="Pending"
            badge={pendingCount}
          />
          <TabButton
            active={tab === 'approved'}
            onClick={() => setTab('approved')}
            label="Approved"
          />
        </div>
        <button
          onClick={() => setTab('history')}
          className={
            'flex items-center gap-2 px-4 py-2 text-sm rounded-lg border ' +
            (tab === 'history'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
          }
        >
          <HistoryIcon size={16} />
          History
        </button>
      </div>

      {/* List */}
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      ) : events.length === 0 ? (
        <EmptyState tab={tab} />
      ) : tab === 'history' ? (
        <HistoryTable events={events} fmtDate={fmtDate} fmtDateTime={fmtDateTime} onOpen={setSelected} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {events.map(e => (
            <EventCard
              key={e.id}
              event={e}
              tab={tab}
              busy={busyId === e.id}
              onOpen={() => setSelected(e)}
              onApprove={() => approve(e.id)}
              onReject={() => reject(e.id)}
              fmtDate={fmtDate}
              fmtDateTime={fmtDateTime}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > PAGE_SIZE ? (
        <Paginator
          page={page}
          pageCount={pageCount}
          total={total}
          onPage={setPage}
        />
      ) : null}

      {/* Full-detail modal */}
      {selected ? (
        <DetailModal
          event={selected}
          onClose={() => setSelected(null)}
          onApprove={selected.approval_status === 'pending' ? () => approve(selected.id) : undefined}
          onReject={selected.approval_status === 'pending' ? () => reject(selected.id) : undefined}
          busy={busyId === selected.id}
          fmtDate={fmtDate}
          fmtDateTime={fmtDateTime}
        />
      ) : null}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function TabButton({
  active, onClick, label, badge,
}: {
  active: boolean; onClick: () => void; label: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ' +
        (active
          ? 'bg-slate-900 text-white'
          : 'bg-white text-gray-700 hover:bg-gray-50')
      }
    >
      {label}
      {typeof badge === 'number' && badge > 0 ? (
        <span
          className={
            'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ' +
            (active ? 'bg-white text-slate-900' : 'bg-red-500 text-white')
          }
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function StatusPill({ status }: { status?: Status }) {
  const map: Record<Status, string> = {
    pending:  'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  };
  const label = status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded ${status ? map[status] : 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

function EventCard({
  event, tab, busy, onOpen, onApprove, onReject, fmtDate, fmtDateTime,
}: {
  event: IntraEvent;
  tab: Tab;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  fmtDate: (s?: string | null) => string;
  fmtDateTime: (s?: string | null) => string;
}) {
  return (
    <article className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
      {/* Adaptive image container — max-height frame + object-contain
          preserves the original aspect ratio for portrait / landscape
          / square / 4:3 / 16:9 / any custom ratio, no cropping or
          stretching. */}
      <div className="w-full bg-gray-50 flex items-center justify-center" style={{ maxHeight: 220 }}>
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full object-contain"
            style={{ maxHeight: 220 }}
          />
        ) : (
          <div className="w-full h-32 flex items-center justify-center text-gray-300">
            <ImageIcon size={36} />
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <StatusPill status={event.approval_status} />
          <h3 className="mt-2 text-base font-bold text-gray-900 line-clamp-2">{event.title}</h3>
          {event.subtitle ? (
            <p className="text-sm text-gray-600 line-clamp-2 mt-0.5">{event.subtitle}</p>
          ) : null}
        </div>

        <div className="text-xs text-gray-600 space-y-1">
          <div className="flex items-center gap-1.5">
            <Building2 size={13} className="text-gray-400" />
            <span className="font-medium text-gray-800 truncate">
              {event.institution_name || `Institution #${event.institution_id}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-gray-400" />
            <span>Event: {fmtDate(event.event_date)}</span>
          </div>
          {event.location ? (
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="text-gray-400" />
              <span className="truncate">{event.location}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-gray-400" />
            <span>Submitted: {fmtDateTime(event.submitted_at || event.created_at)}</span>
          </div>
          {event.submitter_name ? (
            <div className="flex items-center gap-1.5">
              <User size={13} className="text-gray-400" />
              <span className="truncate">{event.submitter_name}</span>
            </div>
          ) : null}
        </div>

        <button onClick={onOpen} className="text-xs text-blue-600 hover:underline text-left">
          View full details
        </button>

        {tab === 'pending' ? (
          <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
            <button
              disabled={busy}
              onClick={onReject}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"
            >
              <XCircle size={16} />
              Reject
            </button>
            <button
              disabled={busy}
              onClick={onApprove}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
            >
              <CheckCircle size={16} />
              Approve
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function HistoryTable({
  events, fmtDate, fmtDateTime, onOpen,
}: {
  events: IntraEvent[];
  fmtDate: (s?: string | null) => string;
  fmtDateTime: (s?: string | null) => string;
  onOpen: (e: IntraEvent) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Image</th>
              <th className="text-left px-3 py-2 font-semibold">Event</th>
              <th className="text-left px-3 py-2 font-semibold">Institution</th>
              <th className="text-left px-3 py-2 font-semibold">Type</th>
              <th className="text-left px-3 py-2 font-semibold">Event date</th>
              <th className="text-left px-3 py-2 font-semibold">Requested</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-left px-3 py-2 font-semibold">Action date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map(e => (
              <tr key={e.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(e)}>
                <td className="px-3 py-2">
                  <div className="w-14 h-14 bg-gray-50 rounded flex items-center justify-center overflow-hidden">
                    {e.image_url ? (
                      <img src={e.image_url} alt="" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <ImageIcon size={18} className="text-gray-300" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 font-medium text-gray-800 max-w-xs truncate">{e.title}</td>
                <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{e.institution_name || `#${e.institution_id}`}</td>
                <td className="px-3 py-2 text-gray-700 capitalize">{e.event_type || 'intra'}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(e.event_date)}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(e.submitted_at || e.created_at)}</td>
                <td className="px-3 py-2"><StatusPill status={e.approval_status} /></td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {e.approval_status === 'approved' ? fmtDateTime(e.approved_at)
                    : e.approval_status === 'rejected' ? fmtDateTime(e.rejected_at)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Paginator({
  page, pageCount, total, onPage,
}: {
  page: number; pageCount: number; total: number; onPage: (n: number) => void;
}) {
  const pages = useMemo(() => {
    // Compact window: 1 … p-1 p p+1 … last
    const wanted = new Set<number>([1, pageCount, page, page - 1, page + 1]);
    return Array.from(wanted).filter(n => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  }, [page, pageCount]);

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="text-xs text-gray-500">
        Showing page {page} of {pageCount} · {total} total
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1.5 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((n, i) => {
          const prev = pages[i - 1];
          const gap = prev !== undefined && n - prev > 1;
          return (
            <span key={n} className="flex items-center gap-1">
              {gap ? <span className="px-1 text-gray-400">…</span> : null}
              <button
                onClick={() => onPage(n)}
                className={
                  'min-w-[32px] h-8 px-2 text-xs rounded border ' +
                  (n === page
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                }
              >
                {n}
              </button>
            </span>
          );
        })}
        <button
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="p-1.5 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// Human-friendly "Inter-Level" / "Intra-Level" from the raw type.
// Kept out of the JSX so both the header pill and the meta grid share
// the exact same label.
function eventLevelLabel(t?: string): string {
  if (t === 'inter') return 'Inter-Level (Institution-local)';
  if (t === 'intra') return 'Intra-Level (Cross-institution)';
  return t || '—';
}

// 'HH:mm' 24h → 'h:mm AM/PM' for display. Falls back to the raw
// value if it can't parse.
function fmtTime(hhmm?: string | null): string {
  if (!hhmm) return '—';
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return String(hhmm);
  const h  = Number(m[1]);
  const mm = m[2];
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm} ${suffix}`;
}

function DetailModal({
  event, onClose, onApprove, onReject, busy, fmtDate, fmtDateTime,
}: {
  event: IntraEvent;
  onClose: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  busy: boolean;
  fmtDate: (s?: string | null) => string;
  fmtDateTime: (s?: string | null) => string;
}) {
  // ── Full event refetch ────────────────────────────────────────
  // The list endpoint may return a narrower shape than the modal
  // needs (older backend revisions, cached response, etc.). We
  // re-fetch the full row from /intra-events/:id which always
  // returns every persisted column, and merge it over the parent
  // payload so display keeps working even before the fetch resolves.
  const [full, setFull] = useState<IntraEvent>(event);
  useEffect(() => { setFull(event); }, [event]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ event: IntraEvent }>(`/intra-events/${event.id}`)
      .then((r) => {
        if (cancelled || !r.data?.event) return;
        setFull((prev) => ({ ...prev, ...r.data.event }));
      })
      .catch(() => { /* keep the list-payload version */ });
    return () => { cancelled = true; };
  }, [event.id]);

  // ── Registration form fetch ────────────────────────────────────
  // Lazy — only fires when the modal opens for a specific event.
  // Failure is soft: we render an inline hint instead of the field
  // list so the rest of the detail page still shows.
  const [regForm, setRegForm]     = useState<RegFormResponse | null>(null);
  const [regLoading, setRegLoad]  = useState(false);
  const [regError,   setRegError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setRegForm(null);
    setRegError('');
    setRegLoad(true);
    apiClient
      .get<RegFormResponse>(`/events/${event.id}/registration-form`)
      .then((r) => { if (!cancelled) setRegForm(r.data); })
      .catch((err) => {
        if (cancelled) return;
        setRegError(err.response?.data?.message || 'Failed to load registration form');
      })
      .finally(() => { if (!cancelled) setRegLoad(false); });
    return () => { cancelled = true; };
  }, [event.id]);

  const categories = Array.isArray(full.categories) ? full.categories : [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(ev) => ev.stopPropagation()}
      >
        {full.image_url ? (
          <div className="w-full bg-gray-50 flex items-center justify-center" style={{ maxHeight: 360 }}>
            <img
              src={full.image_url}
              alt={full.title}
              className="w-full object-contain"
              style={{ maxHeight: 360 }}
            />
          </div>
        ) : null}
        <div className="p-6 space-y-5">
          {/* Header — status + level pill + title. Event level falls
              back to 'intra' because every row surfaced in this modal
              is from the intra-events queue, so we never show '—'
              even if the list payload omitted event_type. */}
          <div>
            <div className="flex items-center gap-2">
              <StatusPill status={full.approval_status} />
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-slate-100 text-slate-700">
                {eventLevelLabel(full.event_type || 'intra')}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">{full.title}</h2>
            {full.subtitle ? <p className="text-sm text-gray-600 mt-1">{full.subtitle}</p> : null}
          </div>

          {/* Description */}
          {full.description ? (
            <Section title="Description">
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{full.description}</p>
            </Section>
          ) : null}

          {/* When & Where */}
          <Section title="When & Where">
            <FieldGrid>
              <FieldItem label="Event date" value={fmtDate(full.event_date)} />
              <FieldItem label="Event time" value={fmtTime(full.event_time)} />
              <FieldItem
                label="Registration closes"
                value={full.registration_closing_date ? fmtDate(full.registration_closing_date) : '—'}
              />
              <FieldItem label="Location / Venue" value={full.location || '—'} />
              <FieldItem
                label="Location link"
                value={full.link ? (
                  <a href={full.link} target="_blank" rel="noopener noreferrer"
                     className="text-blue-600 hover:underline break-all">
                    {full.link}
                  </a>
                ) : '—'}
              />
              <FieldItem label="Event level" value={eventLevelLabel(full.event_type || 'intra')} />
            </FieldGrid>
          </Section>

          {/* Organiser */}
          <Section title="Organiser">
            <FieldGrid>
              <FieldItem
                label="Institution"
                value={full.institution_name || `#${full.institution_id}`}
              />
              <FieldItem label="Submitted by" value={full.submitter_name || '—'} />
              <FieldItem label="Submitter email" value={full.submitter_email || '—'} />
              <FieldItem
                label="Submitted at"
                value={fmtDateTime(full.submitted_at || full.created_at)}
              />
            </FieldGrid>
          </Section>

          {/* Categories & Skills */}
          <Section title="Categories & Skills">
            {categories.length === 0 ? (
              <div className="text-sm text-gray-500 italic">
                No categories or skills entered for this event.
              </div>
            ) : (
              <div className="space-y-3">
                {categories.map((cat, ci) => (
                  <div key={ci} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold">
                        {ci + 1}
                      </span>
                      <span className="text-sm font-bold text-gray-900">{cat.name}</span>
                      {cat.gender ? (
                        <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-indigo-100 text-indigo-800">
                          {cat.gender}
                        </span>
                      ) : null}
                      <span className="text-xs text-gray-500">
                        {(cat.skills || []).length} skill{(cat.skills || []).length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {(cat.skills || []).length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {(cat.skills || []).map((sk, si) => (
                          <div key={si} className="pl-3 border-l-2 border-slate-300">
                            <div className="text-sm text-gray-800">
                              <span className="font-semibold">{si + 1}. {sk.name}</span>
                              <span className="ml-2 text-xs text-gray-500">
                                Age {sk.age_from ?? '—'}
                                {' – '}
                                {sk.age_to ?? '—'}
                              </span>
                            </div>
                            {Array.isArray(sk.divisions) && sk.divisions.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {sk.divisions.map((d, di) => (
                                  <span
                                    key={di}
                                    className="inline-block px-2 py-0.5 text-[11px] rounded bg-white border border-gray-200 text-gray-700"
                                  >
                                    {d.name}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Registration form */}
          <Section title="Registration Form">
            {regLoading ? (
              <div className="text-sm text-gray-500">Loading registration form…</div>
            ) : regError ? (
              <div className="text-sm text-red-600">{regError}</div>
            ) : !regForm ? (
              <div className="text-sm text-gray-500">—</div>
            ) : !regForm.enabled ? (
              <div className="text-sm text-gray-600 italic">
                Registration form is disabled for this event.
              </div>
            ) : regForm.fields.length === 0 ? (
              <div className="text-sm text-gray-500 italic">No fields configured.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-200 rounded">
                  <thead className="bg-gray-50 text-gray-600 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">#</th>
                      <th className="text-left px-3 py-2 font-semibold">Label</th>
                      <th className="text-left px-3 py-2 font-semibold">Type</th>
                      <th className="text-left px-3 py-2 font-semibold">Source</th>
                      <th className="text-left px-3 py-2 font-semibold">Required</th>
                      <th className="text-left px-3 py-2 font-semibold">Options</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {regForm.fields.map((f, i) => (
                      <tr key={f.id}>
                        <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{f.label}</td>
                        <td className="px-3 py-2 text-gray-700 capitalize">{f.type}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {f.sourceType === 'student'
                            ? `Student · ${f.sourceKey || '—'}`
                            : 'Custom'}
                        </td>
                        <td className="px-3 py-2">
                          {f.required ? (
                            <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-red-100 text-red-800">
                              Required
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">Optional</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {Array.isArray(f.options) && f.options.length > 0
                            ? f.options.map((o) => o.label).join(', ')
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Payment — hidden entirely when the organiser didn't
              turn Payment Required on. An event with payment
              disabled is not necessarily free; we simply suppress
              the section to match the organiser's decision to
              collect nothing. */}
          {full.payment_required ? (
            <Section title="Payment">
              <FieldGrid>
                <FieldItem
                  label="Amount"
                  value={`₹${full.payment_amount ?? '—'}`}
                />
                {full.payment_link ? (
                  <FieldItem
                    label="Payment link"
                    value={
                      <a href={full.payment_link} target="_blank" rel="noopener noreferrer"
                         className="text-blue-600 hover:underline break-all">
                        {full.payment_link}
                      </a>
                    }
                  />
                ) : null}
              </FieldGrid>
            </Section>
          ) : null}

          {/* Publish schedule */}
          <Section title="Publish Schedule">
            <FieldGrid>
              <FieldItem
                label="Publish mode"
                value={full.publish_at ? 'Scheduled' : 'Immediate'}
              />
              {full.publish_at ? (
                <FieldItem
                  label="Publishes at"
                  value={fmtDateTime(full.publish_at)}
                />
              ) : null}
            </FieldGrid>
          </Section>

          {/* Approval history */}
          <Section title="Approval History">
            <FieldGrid>
              <FieldItem label="Status" value={
                <StatusPill status={full.approval_status} />
              } />
              {full.approved_at ? (
                <FieldItem label="Approved at" value={fmtDateTime(full.approved_at)} />
              ) : null}
              {full.rejected_at ? (
                <FieldItem label="Rejected at" value={fmtDateTime(full.rejected_at)} />
              ) : null}
            </FieldGrid>
          </Section>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              Close
            </button>
            {onReject ? (
              <button
                disabled={busy}
                onClick={onReject}
                className="flex-1 px-4 py-2 text-sm font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"
              >
                Reject
              </button>
            ) : null}
            {onApprove ? (
              <button
                disabled={busy}
                onClick={onApprove}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
              >
                Approve
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout helpers ──────────────────────────────────────────────
// Small presentational primitives used only by the DetailModal.
// Kept local so the modal remains a single self-contained block.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
      {children}
    </div>
  );
}

function FieldItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-gray-800 mt-0.5 break-words">{value}</div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-64 bg-white rounded-lg border border-gray-200 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="p-12 text-center bg-white rounded-lg border border-gray-200">
      <CheckCircle size={32} className="mx-auto text-green-500 mb-3" />
      <div className="text-gray-800 font-semibold">
        {tab === 'pending' ? 'All caught up' : tab === 'approved' ? 'No approved events yet' : 'No history yet'}
      </div>
      <div className="text-sm text-gray-500 mt-1">
        {tab === 'pending'
          ? 'No Intra-Level events waiting for approval right now.'
          : tab === 'approved'
          ? 'Once you approve Intra-Level events they will appear here.'
          : 'Nothing has been submitted for approval yet.'}
      </div>
    </div>
  );
}
