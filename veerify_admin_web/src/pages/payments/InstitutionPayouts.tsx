// src/pages/payments/InstitutionPayouts.tsx
//
// Super-admin Institution Payout page.
//
// Lists every institution with its course-purchase total, the platform
// commission (pulled from /marketplace-settings via the backend), the
// amount to be transferred, and a paid/pending status pill. "Mark Paid"
// records a settlement; the institution's mobile wallet picks that up
// immediately because it reads from the same institution_payouts table.

import { useEffect, useMemo, useState } from 'react';
import {
  Wallet, Search, CheckCircle2, Clock, Send, Loader2,
  Building2, RefreshCw, AlertCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn, formatCurrency } from '../../lib/utils';

interface PayoutRow {
  institution_id:        number;
  institution_name:      string;
  institution_email:     string | null;
  institution_logo:      string | null;
  paid_enrollment_count: number;
  gross_purchases:       number;
  commission_percent:    number;
  commission_amount:     number;
  transfer_amount:       number;
  transferred_total:     number;
  pending_amount:        number;
  status:                'paid' | 'pending';
  last_paid_at:          string | null;
}

interface ListResponse {
  commission_percent: number;
  count: number;
  payouts: PayoutRow[];
}

export function InstitutionPayouts() {
  const [data,    setData]    = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [busyId,  setBusyId]  = useState<number | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await api.get<ListResponse>('/institution-payouts');
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    if (!data) return { gross: 0, commission: 0, transfer: 0, pending: 0 };
    return data.payouts.reduce(
      (acc, p) => ({
        gross:      acc.gross      + p.gross_purchases,
        commission: acc.commission + p.commission_amount,
        transfer:   acc.transfer   + p.transfer_amount,
        pending:    acc.pending    + p.pending_amount,
      }),
      { gross: 0, commission: 0, transfer: 0, pending: 0 },
    );
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.payouts.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.institution_name.toLowerCase().includes(q) ||
        (p.institution_email || '').toLowerCase().includes(q)
      );
    });
  }, [data, search, statusFilter]);

  const markPaid = async (row: PayoutRow) => {
    if (!confirm(
      `Mark ${formatCurrency(row.pending_amount)} as paid to ${row.institution_name}?\n\n` +
      `This will increase their wallet balance.`,
    )) return;
    setBusyId(row.institution_id);
    try {
      await api.post(`/institution-payouts/${row.institution_id}/mark-paid`);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || err.message || 'Mark paid failed.');
    } finally {
      setBusyId(null);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-fuchsia-500 to-purple-600 p-8 text-white shadow-glow">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-widest mb-3">
              <Wallet className="w-3 h-3" /> Payments
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Institution Payout</h1>
            <p className="mt-1 text-sm text-white/85 max-w-2xl">
              Settle institution earnings from course sales. Commission is
              applied at the rate configured under{' '}
              <span className="font-semibold">Settings → Marketplace</span>
              {data ? ` (currently ${data.commission_percent}%)` : ''}.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white text-purple-700 hover:bg-white/95 shadow-lg shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryTile
          label="Total Course Purchases"
          value={formatCurrency(totals.gross)}
          accent="indigo"
        />
        <SummaryTile
          label="Total Commission"
          value={formatCurrency(totals.commission)}
          sub={data ? `${data.commission_percent}% deducted` : undefined}
          accent="amber"
        />
        <SummaryTile
          label="Total To Transfer"
          value={formatCurrency(totals.transfer)}
          accent="emerald"
        />
        <SummaryTile
          label="Pending Payouts"
          value={formatCurrency(totals.pending)}
          sub={
            data
              ? `${data.payouts.filter((p) => p.status === 'pending').length} institution(s)`
              : undefined
          }
          accent="rose"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by institution name or email…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="flex gap-2">
          {([
            { key: 'all',     label: 'All'     },
            { key: 'pending', label: 'Pending' },
            { key: 'paid',    label: 'Paid'    },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'px-3 py-2 rounded-xl text-xs font-semibold border transition',
                statusFilter === f.key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-7 h-7 animate-spin text-brand-500" />
        </div>
      ) : error ? (
        <div className="card p-6 flex items-start gap-3 text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-brand-100 dark:bg-brand-500/15 grid place-items-center mb-4">
            <Building2 className="w-7 h-7 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">
            No institutions found
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {search
              ? 'Try a different search term or status filter.'
              : 'Institutions with paid enrolments will appear here.'}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                <tr>
                  <th className="px-5 py-3 text-left">Institution</th>
                  <th className="px-4 py-3 text-right">Course Purchases</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3 text-right">To Transfer</th>
                  <th className="px-4 py-3 text-right">Paid So Far</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((row) => (
                  <PayoutTableRow
                    key={row.institution_id}
                    row={row}
                    busy={busyId === row.institution_id}
                    onMarkPaid={() => markPaid(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryTile({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: 'indigo' | 'amber' | 'emerald' | 'rose';
}) {
  const tone = {
    indigo:  { bg: 'bg-indigo-50  dark:bg-indigo-500/10',  text: 'text-indigo-700  dark:text-indigo-300',  label: 'text-indigo-600/80'  },
    amber:   { bg: 'bg-amber-50   dark:bg-amber-500/10',   text: 'text-amber-700   dark:text-amber-300',   label: 'text-amber-600/80'   },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', label: 'text-emerald-600/80' },
    rose:    { bg: 'bg-rose-50    dark:bg-rose-500/10',    text: 'text-rose-700    dark:text-rose-300',    label: 'text-rose-600/80'    },
  }[accent];
  return (
    <div className={cn('rounded-2xl p-4', tone.bg)}>
      <div className={cn('text-[10px] uppercase tracking-wider font-bold', tone.label)}>{label}</div>
      <div className={cn('text-xl font-extrabold tabular-nums mt-1', tone.text)}>{value}</div>
      {sub && <div className={cn('text-[10px] mt-0.5 font-medium', tone.label)}>{sub}</div>}
    </div>
  );
}

function PayoutTableRow({
  row, busy, onMarkPaid,
}: {
  row: PayoutRow;
  busy: boolean;
  onMarkPaid: () => void;
}) {
  const statusIsPaid = row.status === 'paid';
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      {/* Institution cell */}
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          {row.institution_logo ? (
            <img
              src={row.institution_logo}
              alt=""
              className="w-9 h-9 rounded-lg object-cover bg-slate-100"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 grid place-items-center text-white text-xs font-bold">
              {row.institution_name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
              {row.institution_name}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
              {row.paid_enrollment_count} paid enrolment{row.paid_enrollment_count === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-slate-900 dark:text-white">
        {formatCurrency(row.gross_purchases)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-amber-700 dark:text-amber-400">
        − {formatCurrency(row.commission_amount)}
        <div className="text-[10px] text-slate-500 font-sans">{row.commission_percent}%</div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
        {formatCurrency(row.transfer_amount)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
        {formatCurrency(row.transferred_total)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums font-semibold text-rose-700 dark:text-rose-400">
        {formatCurrency(row.pending_amount)}
      </td>
      <td className="px-4 py-3 text-center">
        {statusIsPaid ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            <Clock className="w-3 h-3" /> Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {statusIsPaid ? (
          <span className="text-[11px] text-slate-400">All settled</span>
        ) : (
          <button
            onClick={onMarkPaid}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 transition"
          >
            {busy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            Mark Paid
          </button>
        )}
      </td>
    </tr>
  );
}
