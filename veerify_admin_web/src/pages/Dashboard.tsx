import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Building2,
  CheckCircle2,
  GraduationCap,
  UserCog,
  Wallet,
  AlertTriangle,
  TrendingUp,
  Download,
  Filter,
} from 'lucide-react';
import apiClient from '../api/client';
import { StatsCard } from '../components/ui/StatsCard';
import { ChartCard } from '../components/ui/ChartCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useNotifications } from '../lib/notifications';
import { useAuth } from '../lib/auth';
import {
  revenueData,
  growthData,
  enrollmentData,
  trainerUtilization,
} from '../data/mockData';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';

// ─── CSV export helpers ────────────────────────────────────────────
// Kept in this file (rather than a shared utility) because the CSV
// shape is tightly coupled to what the dashboard actually renders.

/** Escape a single CSV cell per RFC 4180 — quotes doubled, wrap when needed. */
function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Turn an array of records into a CSV block (header row + N data rows). */
function csvBlock(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

interface CountsForExport {
  total?:              number;
  active?:             number;
  pending_approval?:   number;
  total_students?:     number;
  total_trainers?:     number;
  monthly_revenue?:    number;
  [key: string]:       number | undefined;
}

/** Assemble the multi-section CSV the Export button downloads. */
function buildDashboardCsv({
  counts,
  institutions,
  payments,
  enrollments,
}: {
  counts:       CountsForExport;
  institutions: RecentInstitutionRow[];
  payments:     RecentPaymentRow[];
  enrollments:  RecentEnrollmentRow[];
}): string {
  const stamp = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Overview (KPI counts).
  const overview = csvBlock(
    ['Metric', 'Value'],
    [
      ['Total Institutions',    counts?.total            ?? 0],
      ['Active Subscriptions',  counts?.active           ?? 0],
      ['Pending Approvals',     counts?.pending_approval ?? 0],
      ['Total Students',        counts?.total_students   ?? 0],
      ['Total Trainers',        counts?.total_trainers   ?? 0],
      ['Monthly Revenue (INR)', counts?.monthly_revenue  ?? 0],
    ],
  );

  const instBlock = csvBlock(
    ['ID', 'Name', 'City', 'Status', 'Owner', 'Plan', 'Plan Price', 'Created', 'Subscription End'],
    institutions.map((r: any) => [
      r.id,
      r.name,
      r.city,
      r.onboarding_status,
      r.owner_name,
      r.plan_name,
      r.plan_price,
      r.created_at,
      r.subscription_end,
    ]),
  );

  const payBlock = csvBlock(
    ['Institution', 'Owner', 'Plan', 'Amount (INR)', 'Status', 'Paid On', 'Subscription End'],
    payments.map((r: any) => [
      r.institution_name,
      r.owner_name || r.owner_email,
      r.plan_name,
      r.amount_inr,
      r.payment_link_status,
      r.paid_at,
      r.subscription_end,
    ]),
  );

  const enrollBlock = csvBlock(
    ['Enrollment ID', 'Student', 'Email', 'Course', 'Institution', 'Payment Status', 'Enrolled At'],
    enrollments.map((r: any) => [
      r.id,
      r.student_name,
      r.student_email,
      r.course_name,
      r.institution_name,
      r.payment_status,
      r.enrolled_at,
    ]),
  );

  return [
    `Veerify Super Admin Dashboard Export`,
    `Generated,${csvCell(stamp)}`,
    ``,
    `# Overview`,
    overview,
    ``,
    `# Recent Institutions (${institutions.length})`,
    instBlock,
    ``,
    `# Recent Subscription Payments (${payments.length})`,
    payBlock,
    ``,
    `# Recent Enrollments (${enrollments.length})`,
    enrollBlock,
    ``,
  ].join('\n');
}

/** Trigger a browser download of the given CSV string as `filename`. */
function downloadCsv(filename: string, csv: string) {
  // BOM prefix so Excel opens UTF-8 CSVs with the right encoding
  // (₹ symbol + Tamil script names would otherwise mojibake).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob URL on the next tick — some browsers race the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Shape of the rows the dashboard's Recent Institutions table consumes.
// Mirrors what GET /api/onboarding/all returns; we only pick the fields
// the row renderer actually needs.
interface RecentInstitutionRow {
  id: number;
  name: string;
  city: string | null;
  onboarding_status: string;
  owner_name: string;
  plan_name: string | null;
  plan_price: string | number | null;
  subscription_end: string | null;
  created_at: string;
}

// Platform-wide enrollment row from GET /api/enrollments/all.
interface RecentEnrollmentRow {
  id: number;
  enrolled_at: string;
  payment_status: 'paid' | 'pending' | 'failed' | string;
  payment_amount: string | number | null;
  student_id: number;
  student_name: string;
  student_email: string;
  course_id: number;
  course_name: string;
  batch_id: number;
  batch_name: string;
  institution_id: number;
  institution_name: string;
  institution_city: string | null;
}

// Subscription payment made by an institution. Backed by
// GET /api/onboarding/recent-payments.
interface RecentPaymentRow {
    id: number;

  institution_id: number;
  institution_name: string;
  payment_link_id: string | null;
  payment_link_url: string | null;
  payment_link_status: 'pending' | 'paid' | 'expired' | 'cancelled' | null;
  payment_reference: string | null;
  amount_inr: string | number | null;
  paid_at: string;
  plan_name: string | null;
  owner_name: string | null;
  owner_email: string | null;
}

export function Dashboard() {
  // Live counts from /api/onboarding/counts (polled every 30s by
  // NotificationsProvider). Active = institutions that completed payment and
  // are currently subscribed; pending_approval = academies waiting for super
  // admin review; total = every institution row that isn't soft-deleted.
  const { counts } = useNotifications();
  // Owner name comes from the auth context, which is hydrated from
  // /auth/me on app boot and again whenever the My Profile editor saves.
  // We fall back to a polite "Admin" so the header never reads blank.
  const { user } = useAuth();
  const ownerFirstName = (user?.name || '').trim().split(/\s+/)[0] || 'Admin';

  // ── Export dashboard snapshot ──
  //
  // Pulls a fresh copy of every table shown on the page and stitches
  // them into a single CSV file the admin can open in Excel. We refetch
  // rather than reading from the child tables' local state so the
  // export doesn't lie when a filter is applied inside one of them.
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const [instRes, payRes, enrollRes] = await Promise.all([
        apiClient.get('/onboarding/all').catch(() => ({ data: { institutions: [] } })),
        apiClient.get('/onboarding/recent-payments').catch(() => ({ data: { payments: [] } })),
        apiClient.get('/enrollments/all').catch(() => ({ data: { enrollments: [] } })),
      ]);
      const institutions = instRes.data?.institutions || [];
      const payments     = payRes.data?.payments      || [];
      const enrollments  = enrollRes.data?.enrollments || [];

      const csv = buildDashboardCsv({
        counts,
        institutions,
        payments,
        enrollments,
      });

      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadCsv(`veerify-dashboard-${stamp}.csv`, csv);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Dashboard] export failed:', err);
      alert('Could not export the dashboard right now. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Welcome back, {ownerFirstName} 👋
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Here's what's happening across your academies today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<Filter className="w-3.5 h-3.5" />}>
            Filter
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  {/* Each stat card now navigates to the matching list page so the dashboard
      doubles as a launchpad. `delta={0}` removed where we'd rather show the
      "View →" affordance — keeping it would obscure the click target. */}
  <StatsCard label="Total Institutions"   value={formatNumber(counts.total)}            icon={Building2}     accent="brand"   to="/institutions" />
  <StatsCard label="Active Subscriptions" value={formatNumber(counts.active)}           icon={CheckCircle2}  accent="emerald" to="/institutions/active" />
  <StatsCard label="Pending Approvals"    value={formatNumber(counts.pending_approval)} icon={AlertTriangle} accent="amber"   to="/institutions/pending" />
  <StatsCard label="Total Students"       value={formatNumber(counts.total_students)}   icon={GraduationCap} accent="sky"     to="/students" />
  <StatsCard label="Total Trainers"       value={formatNumber(counts.total_trainers)}   icon={UserCog}       accent="brand"   to="/trainers" />
  <StatsCard label="Monthly Revenue"      value={formatCurrency(counts.monthly_revenue)} icon={Wallet}       accent="emerald" to="/payments" />
  <StatsCard label="Course Completion"    value="0%" delta={0} icon={TrendingUp}    accent="sky" />
</div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Monthly Revenue" subtitle="Total + subscription revenue across all institutions" className="lg:col-span-2">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <AreaChart data={revenueData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-sub" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                <XAxis dataKey="month" stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} />
                <YAxis stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} tickFormatter={(v) => `₹${v / 1000}k`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    border: 'none',
                    borderRadius: 12,
                    color: '#fff',
                    fontSize: 12,
                  }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#grad-rev)" name="Total Revenue" />
                <Area type="monotone" dataKey="subscriptions" stroke="#10b981" strokeWidth={2.5} fill="url(#grad-sub)" name="Subscriptions" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Enrollments by Discipline" subtitle="Active student enrollments">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={[]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {enrollmentData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    border: 'none',
                    borderRadius: 12,
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <Legend
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Institution & Student Growth" subtitle="Cumulative over the past 12 months">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={growthData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                <XAxis dataKey="month" stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} />
                <YAxis stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    border: 'none',
                    borderRadius: 12,
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="institutions" fill="#6366f1" radius={[6, 6, 0, 0]} name="Institutions" />
                <Bar dataKey="students" fill="#10b981" radius={[6, 6, 0, 0]} name="Students" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Trainer Utilization" subtitle="Weekly slot-booking rate (avg.)">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={trainerUtilization} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                <XAxis dataKey="day" stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} />
                <YAxis stroke="currentColor" className="text-slate-400 text-xs" tick={{ fill: 'currentColor' }} unit="%" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    border: 'none',
                    borderRadius: 12,
                    color: '#fff',
                    fontSize: 12,
                  }}
                  formatter={(v: number) => `${v}%`}
                />
                <Bar dataKey="booked" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Utilization %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Tables */}
      <RecentInstitutions />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RecentPaymentsTable />
        <RecentEnrollmentsTable />
      </div>
    </div>
  );
}

// Map the backend's onboarding_status enum to the Badge UI variants so
// the table reads like a status board at a glance.
function statusLabel(s: string): { label: string; variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral' } {
  switch (s) {
    case 'active':            return { label: 'Active',   variant: 'success' };
    case 'approved':          return { label: 'Approved', variant: 'info' };
    case 'pending_approval':  return { label: 'Pending',  variant: 'warning' };
    case 'rejected':          return { label: 'Rejected', variant: 'danger' };
    case 'deleted':           return { label: 'Deleted',  variant: 'danger' };
    default:                  return { label: s.replace(/_/g, ' ') || '—', variant: 'neutral' };
  }
}

function RecentInstitutions() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RecentInstitutionRow[]>([]);

  // Pull the freshest 10 institutions that have actually completed setup.
  //
  // /onboarding/all also returns half-onboarded rows — `registered` and
  // `plan_selected` — which are placeholder records the backend creates
  // the moment an owner picks a plan, *before* they've filled in any
  // details. Surfacing those here makes it look like a brand-new academy
  // just registered when really the owner is still mid-form. We filter
  // them out so this panel only shows academies that have submitted the
  // setup wizard (pending_approval / approved / active / rejected).
  useEffect(() => {
    let cancelled = false;
    const SUBMITTED = new Set([
      'pending_approval', 'approved', 'active', 'rejected',
    ]);
    apiClient
      .get('/onboarding/all')
      .then((r) => {
        if (cancelled) return;
        const submitted = (r.data?.institutions || []).filter(
          (i: RecentInstitutionRow) => SUBMITTED.has(i.onboarding_status),
        );
        setRows(submitted.slice(0, 10));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  const columns: Column<RecentInstitutionRow>[] = [
    {
      key: 'name',
      header: 'Institution',
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white text-xs font-bold">
            {row.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-white text-sm">{row.name}</div>
            <div className="text-xs text-slate-500">{row.city || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (row) => <span className="text-sm">{row.owner_name || '—'}</span>,
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <Badge variant={row.plan_name === 'Pro' ? 'info' : 'neutral'}>
          {row.plan_name || '—'}
        </Badge>
      ),
    },
    {
      key: 'revenue',
      header: 'Plan Price',
      render: (row) => (
        <span className="font-mono text-sm">
          {row.plan_price != null ? formatCurrency(Number(row.plan_price)) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const s = statusLabel(row.onboarding_status);
        return (
          <Badge variant={s.variant} dot>
            {s.label}
          </Badge>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Added',
      render: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      render: (row) => (
        <span className="text-xs text-slate-500">
          {row.subscription_end ? formatDate(row.subscription_end) : '—'}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      title="Recent Institutions"
      columns={columns}
      data={rows}
      searchKeys={['name', 'owner_name', 'city']}
      pageSize={6}
      onRowAction={(row) => navigate(`/institutions/${row.id}`)}
      toolbar={
        <Button size="sm" variant="outline" onClick={() => navigate('/institutions')}>
          View all
        </Button>
      }
    />
  );
}

function RecentPaymentsTable() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RecentPaymentRow[]>([]);

  // Pull recent institution subscription payments. /onboarding/recent-payments
  // returns up to 25 rows ordered by paid_at DESC; we render 6 per page.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/onboarding/recent-payments')
      .then((r) => {
        if (!cancelled) setRows(r.data?.payments || []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  const columns: Column<RecentPaymentRow>[] = [
    {
      key: 'institution',
      header: 'Institution',
      render: (row) => (
        <div>
          <div className="font-medium text-sm text-slate-900 dark:text-white">{row.institution_name}</div>
          {row.owner_name ? (
            <div className="text-xs text-slate-500">{row.owner_name}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <Badge variant={row.plan_name === 'Pro' ? 'info' : 'neutral'}>
          {row.plan_name || '—'}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span className="font-mono font-semibold text-sm">
          {row.amount_inr != null ? formatCurrency(Number(row.amount_inr)) : '—'}
        </span>
      ),
    },
    {
      key: 'payment_id',
      header: 'Payment ID',
      render: (row) => {
        // Prefer Razorpay's payment_link_id; fall back to payment_reference
        // (mock-pay flow generates MOCK-* references).
        const id = row.payment_link_id || row.payment_reference;
        if (!id) {
          return <span className="text-xs text-slate-400">—</span>;
        }
        return (
          <span
            className="font-mono text-[11px] text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800"
            title={id}
          >
            {id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id}
          </span>
        );
      },
    },
    {
      key: 'paid_at',
      header: 'Paid On',
      render: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.paid_at)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        // payment_link_status mirrors Razorpay vocabulary.
        const s = row.payment_link_status || (row.paid_at ? 'paid' : 'pending');
        let variant: 'success' | 'warning' | 'danger' | 'neutral' = 'neutral';
        let label = s;
        switch (s) {
          case 'paid':      variant = 'success'; label = 'paid';      break;
          case 'pending':   variant = 'warning'; label = 'pending';   break;
          case 'expired':   variant = 'danger';  label = 'expired';   break;
          case 'cancelled': variant = 'danger';  label = 'cancelled'; break;
          default:          variant = 'neutral'; label = s;
        }
        return (
          <Badge variant={variant} dot>
            {label}
          </Badge>
        );
      },
    },
  ];

  return (
    <DataTable
      title="Recent Payments"
      columns={columns}
      data={rows}
      pageSize={6}
      onRowAction={(row) => navigate(`/institutions/${row.institution_id}`)}
      toolbar={
        <Button size="sm" variant="outline" onClick={() => navigate('/institutions/active')}>
          View all
        </Button>
      }
    />
  );
}

function RecentEnrollmentsTable() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RecentEnrollmentRow[]>([]);

  // Pull the platform's freshest 20 enrollments. /enrollments/all is
  // already ordered by enrolled_at DESC.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/enrollments/all')
      .then((r) => {
        if (!cancelled) setRows(r.data?.enrollments || []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  const columns: Column<RecentEnrollmentRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div>
          <div className="font-medium text-sm text-slate-900 dark:text-white">{row.student_name}</div>
          <div className="text-xs text-slate-500">{row.course_name}</div>
        </div>
      ),
    },
    {
      key: 'institution',
      header: 'Institution',
      render: (row) => (
        <div>
          <div className="text-xs text-slate-700 dark:text-slate-300">{row.institution_name}</div>
          {row.institution_city ? (
            <div className="text-[11px] text-slate-400">{row.institution_city}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'batch',
      header: 'Batch',
      render: (row) => <Badge variant="neutral">{row.batch_name}</Badge>,
    },
    {
      key: 'enrolled_at',
      header: 'Enrolled',
      render: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.enrolled_at)}</span>
      ),
    },
    {
      key: 'payment_status',
      header: 'Status',
      render: (row) => {
        const s = row.payment_status || 'pending';
        let variant: 'success' | 'warning' | 'danger' | 'neutral' = 'neutral';
        let label = s;
        switch (s) {
          case 'paid':    variant = 'success'; label = 'Paid';    break;
          case 'pending': variant = 'warning'; label = 'Pending'; break;
          case 'failed':  variant = 'danger';  label = 'Failed';  break;
          default:        variant = 'neutral'; label = s;
        }
        return (
          <Badge variant={variant} dot>
            {label}
          </Badge>
        );
      },
    },
  ];

  return (
    <DataTable
      title="Latest Enrollments"
      columns={columns}
      data={rows}
      searchKeys={['student_name', 'course_name', 'institution_name']}
      pageSize={6}
      onRowAction={(row) => navigate(`/institutions/${row.institution_id}`)}
      toolbar={
        <Button size="sm" variant="outline" onClick={() => navigate('/students')}>
          View all
        </Button>
      }
    />
  );
}
