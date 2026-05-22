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
  CalendarRange,
  TrendingUp,
  Download,
  Filter,
  Plus,
} from 'lucide-react';
import { StatsCard } from '../components/ui/StatsCard';
import { ChartCard } from '../components/ui/ChartCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  revenueData,
  growthData,
  enrollmentData,
  trainerUtilization,
  institutions,
  recentPayments,
  recentEnrollments,
  type Institution,
  type PaymentRow,
  type EnrollmentRow,
} from '../data/mockData';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';

export function Dashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Welcome back, Mohana 👋
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Here's what's happening across your academies today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<Filter className="w-3.5 h-3.5" />}>
            Filter
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Download className="w-3.5 h-3.5" />}>
            Export
          </Button>
          <Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />}>
            New Institution
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <StatsCard label="Total Institutions" value="0" delta={0} icon={Building2} accent="brand" />
  <StatsCard label="Active Subscriptions" value="0" delta={0} icon={CheckCircle2} accent="emerald" />
  <StatsCard label="Total Students" value="0" delta={0} icon={GraduationCap} accent="sky" />
  <StatsCard label="Total Trainers" value="0" delta={0} icon={UserCog} accent="brand" />
  <StatsCard label="Monthly Revenue" value="₹0" delta={0} icon={Wallet} accent="emerald" />
  <StatsCard label="Pending Payments" value="₹0" delta={0} icon={AlertTriangle} accent="rose" />
  <StatsCard label="Active Batches" value="0" delta={0} icon={CalendarRange} accent="amber" />
  <StatsCard label="Course Completion" value="0%" delta={0} icon={TrendingUp} accent="sky" />
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

function RecentInstitutions() {
  const columns: Column<Institution>[] = [
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
              .join('')}
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-white text-sm">{row.name}</div>
            <div className="text-xs text-slate-500">{row.city}</div>
          </div>
        </div>
      ),
    },
    { key: 'owner', header: 'Owner', render: (row) => <span className="text-sm">{row.owner}</span> },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <Badge variant={row.plan === 'Enterprise' ? 'default' : row.plan === 'Pro' ? 'info' : 'neutral'}>{row.plan}</Badge>
      ),
    },
    { key: 'students', header: 'Students', render: (row) => <span className="font-semibold">{formatNumber(row.students)}</span> },
    { key: 'revenue', header: 'Revenue', render: (row) => <span className="font-mono text-sm">{formatCurrency(row.revenue)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const variant = row.status === 'Active' ? 'success' : row.status === 'Trial' ? 'info' : row.status === 'Pending' ? 'warning' : 'danger';
        return (
          <Badge variant={variant} dot>
            {row.status}
          </Badge>
        );
      },
    },
    { key: 'expiresAt', header: 'Expires', render: (row) => <span className="text-xs text-slate-500">{row.expiresAt === '-' ? '—' : formatDate(row.expiresAt)}</span> },
  ];

  return (
    <DataTable
      title="Recent Institutions"
      columns={columns}
      data={[]}
      searchKeys={['name', 'owner', 'city']}
      pageSize={6}
      onRowAction={() => {}}
      toolbar={
        <Button size="sm" variant="outline">
          View all
        </Button>
      }
    />
  );
}

function RecentPaymentsTable() {
  const columns: Column<PaymentRow>[] = [
    { key: 'institution', header: 'Institution', render: (row) => <span className="font-medium text-sm text-slate-900 dark:text-white">{row.institution}</span> },
    { key: 'plan', header: 'Plan', render: (row) => <span className="text-xs text-slate-500">{row.plan}</span> },
    { key: 'amount', header: 'Amount', render: (row) => <span className="font-mono font-semibold text-sm">{formatCurrency(row.amount)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const variant = row.status === 'Paid' ? 'success' : row.status === 'Pending' ? 'warning' : 'danger';
        return (
          <Badge variant={variant} dot>
            {row.status}
          </Badge>
        );
      },
    },
  ];

  return (
    <DataTable
      title="Recent Payments"
      columns={columns}
      data={[]}
      pageSize={6}
      onRowAction={() => {}}
      toolbar={
        <Button size="sm" variant="outline">
          View all
        </Button>
      }
    />
  );
}

function RecentEnrollmentsTable() {
  const columns: Column<EnrollmentRow>[] = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div>
          <div className="font-medium text-sm text-slate-900 dark:text-white">{row.student}</div>
          <div className="text-xs text-slate-500">{row.course}</div>
        </div>
      ),
    },
    { key: 'institution', header: 'Institution', render: (row) => <span className="text-xs text-slate-500">{row.institution}</span> },
    { key: 'batch', header: 'Batch', render: (row) => <Badge variant="neutral">{row.batch}</Badge> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge variant={row.status === 'Active' ? 'success' : 'warning'} dot>
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      title="Latest Enrollments"
      columns={[]}
      data={recentEnrollments}
      pageSize={6}
      onRowAction={() => {}}
      toolbar={
        <Button size="sm" variant="outline">
          View all
        </Button>
      }
    />
  );
}
