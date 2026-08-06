import { useEffect, useMemo, useState } from 'react';
import {
  Wallet, RefreshCw, Search, Building2, AlertCircle, ExternalLink,
  Download, CheckCircle2, Clock, XCircle, ArrowUpRight, Filter,
  Calendar, CreditCard, Repeat, ChevronDown,
} from 'lucide-react';
import apiClient from '../../api/client';

// ─── Types ────────────────────────────────────────────────────────────
interface SubscriptionPayment {
  id:                          number;
  institution_id:              number;
  plan_id:                     number | null;
  plan_name:                   string | null;
  action:                      'onboarding' | 'renew' | 'change_plan';
  status:                      'pending' | 'paid' | 'failed' | 'cancelled';
  billing_cycle:               'monthly' | 'quarterly' | 'half_yearly' | 'annual' | null;
  auto_renewal:                boolean;
  payment_gateway:             string | null;
  razorpay_link_id:            string | null;
  razorpay_payment_id:         string | null;
  razorpay_short_url:          string | null;
  invoice_url:                 string | null;
  base_paise:                  number;
  referral_discount_paise:     number;
  amount_paise:                number;
  amount_inr:                  string;
  created_at:                  string;
  paid_at:                     string | null;
  new_subscription_end:        string | null;
  institution_name:            string;
  institution_logo:            string | null;
  subscription_start:          string | null;
  subscription_end:            string | null;
  parent_institution_id:       number | null;
  parent_institution_name:     string | null;
  branch_name:                 string | null;
  root_institution_name:       string;
  owner_name:                  string | null;
  owner_email:                 string | null;
  plan_default_billing_cycle:  string | null;
}

interface Counts {
  paid:      number;
  pending:   number;
  failed:    number;
  cancelled: number;
  total:     number;
}

type StatusFilter = 'all' | 'paid' | 'pending' | 'failed' | 'cancelled';

// ─── Helpers ──────────────────────────────────────────────────────────
const inr = (n: number | string | null) => {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
};

const BILLING_LABEL: Record<string, string> = {
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  half_yearly: 'Half-yearly',
  annual:      'Yearly',
  yearly:      'Yearly',
};

const ACTION_LABEL: Record<string, string> = {
  onboarding:  'First-time',
  renew:       'Renewal',
  change_plan: 'Plan change',
};

const GATEWAY_LABEL: Record<string, string> = {
  razorpay: 'Razorpay',
};

// ─── Page ─────────────────────────────────────────────────────────────
export function SubscriptionPayments() {
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [counts, setCounts]     = useState<Counts>({
    paid: 0, pending: 0, failed: 0, cancelled: 0, total: 0,
  });
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [filter, setFilter]     = useState<StatusFilter>('all');
  const [search, setSearch]     = useState('');

  const load = async (statusFilter: StatusFilter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await apiClient.get(`/onboarding/subscription-payments?${params.toString()}`);
      setPayments(res.data?.payments || []);
      setCounts(res.data?.counts || {
        paid: 0, pending: 0, failed: 0, cancelled: 0, total: 0,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load subscription payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visible = useMemo(() => {
    if (!search.trim()) return payments;
    const q = search.trim().toLowerCase();
    return payments.filter((p) =>
      p.institution_name?.toLowerCase().includes(q) ||
      p.root_institution_name?.toLowerCase().includes(q) ||
      p.branch_name?.toLowerCase().includes(q) ||
      p.plan_name?.toLowerCase().includes(q) ||
      p.razorpay_payment_id?.toLowerCase().includes(q) ||
      p.razorpay_link_id?.toLowerCase().includes(q) ||
      p.owner_email?.toLowerCase().includes(q) ||
      p.owner_name?.toLowerCase().includes(q),
    );
  }, [payments, search]);

  // Roll-up amount for the header pill — always uses the currently
  // filtered set so the number reflects what's actually on screen.
  const totalPaid = useMemo(
    () => visible
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + Number(p.amount_inr || 0), 0),
    [visible],
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Wallet size={20} className="text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Subscription Payments</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Every subscription payment across every institution — plan, billing cycle, invoice, and more.
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => load(filter)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      {/* ── Roll-up strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RollupCard
          label="Paid"     value={counts.paid}
          accent="emerald" icon={CheckCircle2}
          amount={inr(totalPaid)}
        />
        <RollupCard
          label="Pending"  value={counts.pending}
          accent="amber"   icon={Clock}
        />
        <RollupCard
          label="Failed"   value={counts.failed}
          accent="red"     icon={XCircle}
        />
        <RollupCard
          label="Cancelled" value={counts.cancelled}
          accent="gray"    icon={ArrowUpRight}
        />
      </div>

      {/* ── Filter pills + search ── */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="All" count={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterPill label="Paid" count={counts.paid} active={filter === 'paid'} onClick={() => setFilter('paid')} tone="emerald" />
        <FilterPill label="Pending" count={counts.pending} active={filter === 'pending'} onClick={() => setFilter('pending')} tone="amber" />
        <FilterPill label="Failed" count={counts.failed} active={filter === 'failed'} onClick={() => setFilter('failed')} tone="red" />
        <FilterPill label="Cancelled" count={counts.cancelled} active={filter === 'cancelled'} onClick={() => setFilter('cancelled')} tone="gray" />
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by institution, branch, plan, transaction id, or owner…"
          className="w-full h-10 pl-9 pr-4 rounded-lg bg-white border border-gray-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
        />
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <Wallet size={40} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-base font-semibold text-gray-700">
            {search ? 'No matching payments' : 'No subscription payments yet'}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {search
              ? 'Try a different search term or clear the filter.'
              : 'Payments will show up here as soon as any institution goes through the checkout flow.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Transaction ID</th>
                  <th className="px-4 py-3">Gateway</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paid On</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">Renews</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Cycle</th>
                  <th className="px-4 py-3">Auto Renew</th>
                  <th className="px-4 py-3 text-center">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((p) => (
                  <PaymentRow key={p.id} p={p} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 text-xs text-gray-500">
            Showing {visible.length} of {counts.total} payment{counts.total === 1 ? '' : 's'}
            {search ? ` (filtered)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────
function PaymentRow({ p }: { p: SubscriptionPayment }) {
  // Prefer razorpay_payment_id (final receipt id) when present, then the
  // link_id (the mint id). Both are copyable via a small tooltip.
  const txnId = p.razorpay_payment_id || p.razorpay_link_id || '—';
  const cycleLabel = p.billing_cycle
    ? BILLING_LABEL[p.billing_cycle]
    : (p.plan_default_billing_cycle ? BILLING_LABEL[p.plan_default_billing_cycle] : '—');

  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
      {/* Institution */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate max-w-[180px]">
              {p.root_institution_name}
            </div>
            {p.owner_email ? (
              <div className="text-xs text-gray-500 truncate max-w-[180px]">
                {p.owner_email}
              </div>
            ) : null}
            <div className="mt-1">
              <ActionPill action={p.action} />
            </div>
          </div>
        </div>
      </td>

      {/* Branch */}
      <td className="px-4 py-3">
        {p.branch_name ? (
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold">
            <Building2 size={11} />
            {p.branch_name}
          </div>
        ) : (
          <span className="text-xs font-semibold text-gray-500">Main</span>
        )}
      </td>

      {/* Plan */}
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{p.plan_name || '—'}</div>
      </td>

      {/* Transaction ID */}
      <td className="px-4 py-3">
        <div
          className="font-mono text-xs text-gray-800 truncate max-w-[160px]"
          title={txnId}
        >
          {txnId}
        </div>
        {p.razorpay_payment_id && p.razorpay_link_id ? (
          <div
            className="font-mono text-[10px] text-gray-400 truncate max-w-[160px]"
            title={p.razorpay_link_id}
          >
            Link: {p.razorpay_link_id}
          </div>
        ) : null}
      </td>

      {/* Gateway */}
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <CreditCard size={12} className="text-gray-400" />
          {GATEWAY_LABEL[p.payment_gateway || 'razorpay'] || p.payment_gateway || 'Razorpay'}
        </div>
      </td>

      {/* Amount */}
      <td className="px-4 py-3 text-right">
        <div className="font-bold text-gray-900 tabular-nums">
          {inr(p.amount_inr)}
        </div>
        {p.referral_discount_paise > 0 ? (
          <div className="text-[10px] text-emerald-600 font-semibold">
            −{inr(p.referral_discount_paise / 100)} referral
          </div>
        ) : null}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusPill status={p.status} />
      </td>

      {/* Paid On */}
      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
        {fmtDateTime(p.paid_at)}
      </td>

      {/* Start */}
      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
        {fmtDate(p.subscription_start)}
      </td>

      {/* Next renewal (== end of current cycle) */}
      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
        {fmtDate(p.new_subscription_end || p.subscription_end)}
      </td>

      {/* Expires */}
      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
        {fmtDate(p.subscription_end)}
      </td>

      {/* Billing cycle */}
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-semibold">
          <Calendar size={11} />
          {cycleLabel}
        </div>
      </td>

      {/* Auto renewal */}
      <td className="px-4 py-3">
        {p.auto_renewal ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
            <Repeat size={11} />
            Yes
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-50 text-gray-500 text-xs font-semibold">
            No
          </span>
        )}
      </td>

      {/* Invoice */}
      <td className="px-4 py-3 text-center">
        {p.invoice_url ? (
          <div className="inline-flex items-center gap-1">
            <a
              href={p.invoice_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
              title="View invoice"
            >
              <ExternalLink size={12} />
              View
            </a>
            <a
              href={p.invoice_url}
              download
              className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
              title="Download invoice"
            >
              <Download size={12} />
            </a>
          </div>
        ) : p.razorpay_short_url && p.status === 'paid' ? (
          <a
            href={p.razorpay_short_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700"
            title="Open Razorpay receipt"
          >
            <ExternalLink size={12} />
            Receipt
          </a>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Rollup card ──────────────────────────────────────────────────────
function RollupCard({
  label, value, amount, accent, icon: Icon,
}: {
  label:  string;
  value:  number;
  amount?: string;
  accent: 'emerald' | 'amber' | 'red' | 'gray';
  icon:   React.ElementType;
}) {
  const styles = {
    emerald: { bg: 'bg-emerald-50',  text: 'text-emerald-700', ring: 'ring-emerald-100' },
    amber:   { bg: 'bg-amber-50',    text: 'text-amber-700',   ring: 'ring-amber-100'   },
    red:     { bg: 'bg-red-50',      text: 'text-red-700',     ring: 'ring-red-100'     },
    gray:    { bg: 'bg-gray-50',     text: 'text-gray-700',    ring: 'ring-gray-100'    },
  }[accent];
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 ring-1 ${styles.ring}`}>
      <div className="flex items-start justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</div>
        <div className={`w-8 h-8 rounded-lg ${styles.bg} flex items-center justify-center`}>
          <Icon size={15} className={styles.text} />
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {amount ? (
        <div className={`mt-1 text-xs font-semibold ${styles.text}`}>{amount}</div>
      ) : null}
    </div>
  );
}

// ─── Small pills ──────────────────────────────────────────────────────
function FilterPill({
  label, count, active, onClick, tone,
}: {
  label:  string;
  count:  number;
  active: boolean;
  onClick: () => void;
  tone?:  'emerald' | 'amber' | 'red' | 'gray';
}) {
  const toneStyles = tone === 'emerald' ? 'text-emerald-700'
                    : tone === 'amber'   ? 'text-amber-700'
                    : tone === 'red'     ? 'text-red-700'
                    : tone === 'gray'    ? 'text-gray-700'
                    : 'text-gray-700';
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gray-900 text-white text-sm font-semibold shadow-sm'
          : `flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-gray-200 text-sm font-semibold hover:bg-gray-50 ${toneStyles}`
      }
    >
      {label}
      <span className={active ? 'text-white/90' : 'text-gray-400'}>· {count}</span>
    </button>
  );
}

function StatusPill({ status }: { status: SubscriptionPayment['status'] }) {
  const map = {
    paid:      { text: 'Paid',      bg: 'bg-emerald-50', fg: 'text-emerald-700', ring: 'ring-emerald-200', icon: CheckCircle2 },
    pending:   { text: 'Pending',   bg: 'bg-amber-50',   fg: 'text-amber-700',   ring: 'ring-amber-200',   icon: Clock },
    failed:    { text: 'Failed',    bg: 'bg-red-50',     fg: 'text-red-700',     ring: 'ring-red-200',     icon: XCircle },
    cancelled: { text: 'Cancelled', bg: 'bg-gray-100',   fg: 'text-gray-700',    ring: 'ring-gray-200',    icon: ArrowUpRight },
  }[status];
  const Icon = map.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${map.bg} ${map.fg} text-xs font-semibold ring-1 ${map.ring}`}
    >
      <Icon size={11} />
      {map.text}
    </span>
  );
}

function ActionPill({ action }: { action: SubscriptionPayment['action'] }) {
  const map = {
    onboarding:  { bg: 'bg-blue-50',   fg: 'text-blue-700'  },
    renew:       { bg: 'bg-emerald-50', fg: 'text-emerald-700' },
    change_plan: { bg: 'bg-purple-50', fg: 'text-purple-700' },
  }[action] || { bg: 'bg-gray-50', fg: 'text-gray-700' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${map.bg} ${map.fg} text-[10px] font-bold uppercase tracking-wider`}>
      {ACTION_LABEL[action] || action}
    </span>
  );
}

export default SubscriptionPayments;
