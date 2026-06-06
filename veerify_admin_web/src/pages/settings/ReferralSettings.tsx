// src/pages/settings/ReferralSettings.tsx
//
// Super-admin Refer & Earn configuration page. Reads + writes the single
// referral_settings row, shows platform-wide stats, top referrers, and a
// recent-referrals feed. Five editable fields:
//   - Points per referral
//   - Rupees per point (rate)
//   - Max discount % per renewal
//   - Points expiry duration (days)
//   - Auto approval toggle

import { useEffect, useMemo, useState } from 'react';
import {
  Gift, Save, Loader2, CheckCircle2, Percent, Clock, Wallet,
  Users, TrendingUp, Trophy, Calculator, Zap,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn, formatCurrency } from '../../lib/utils';

interface Settings {
  points_per_referral: number;
  rupees_per_point:    number | string;
  max_discount_pct:    number;
  points_expiry_days:  number;
  auto_approve:        boolean;
}

interface Stats {
  counts: {
    total_referrals: number;
    pending: number;
    credited: number;
    expired: number;
    lifetime_points: number;
  };
  wallets: {
    total_wallets: number;
    total_outstanding_points: number;
    total_earned: number;
    total_used: number;
  };
  top_referrers: Array<{
    id: number; name: string; credited_count: number; points_earned: number;
  }>;
  recent_referrals: Array<{
    id: number; status: string; reward_points: number;
    referrer_name: string; referred_name: string; created_at: string;
    rewarded_at: string | null;
  }>;
}

const DEFAULTS: Settings = {
  points_per_referral: 500,
  rupees_per_point:    1,
  max_discount_pct:    50,
  points_expiry_days:  180,
  auto_approve:        true,
};

function fmtDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ReferralSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [dirty,    setDirty]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Validation errors
  const [errs, setErrs] = useState<Record<string, string>>({});

  // Preview state — "what would a ₹3000 renewal look like after N points?"
  const [previewPlan,   setPreviewPlan]   = useState('3000');
  const [previewPoints, setPreviewPoints] = useState('2500');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, aRes] = await Promise.all([
          api.get('/referrals/settings'),
          api.get('/referrals/admin/stats').catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        const s = sRes.data?.settings;
        if (s) {
          setSettings({
            points_per_referral: Number(s.points_per_referral) || DEFAULTS.points_per_referral,
            rupees_per_point:    Number(s.rupees_per_point)    || DEFAULTS.rupees_per_point,
            max_discount_pct:    Number(s.max_discount_pct)    || DEFAULTS.max_discount_pct,
            points_expiry_days:  Number(s.points_expiry_days)  || DEFAULTS.points_expiry_days,
            auto_approve:        !!s.auto_approve,
          });
        }
        if (aRes.data) setStats(aRes.data);
      } catch (err: any) {
        setError(err?.response?.data?.message || err?.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
    setErrs((e) => { const n = { ...e }; delete n[key as string]; return n; });
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (Number(settings.points_per_referral) < 0) e.points_per_referral = 'Must be 0 or more';
    if (Number(settings.rupees_per_point) < 0)    e.rupees_per_point    = 'Must be 0 or more';
    if (Number(settings.max_discount_pct) < 0 || Number(settings.max_discount_pct) > 100)
      e.max_discount_pct = 'Must be between 0 and 100';
    if (Number(settings.points_expiry_days) < 1)  e.points_expiry_days  = 'Must be at least 1 day';
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      await api.put('/referrals/settings', settings);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Live preview math ────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const plan   = parseFloat(previewPlan)   || 0;
    const pts    = parseFloat(previewPoints) || 0;
    const rate   = Number(settings.rupees_per_point)  || 0;
    const maxPct = Number(settings.max_discount_pct)  || 0;
    const balanceRupees = Math.floor(pts * rate);
    const cap           = Math.floor(plan * maxPct / 100);
    const discount      = Math.min(balanceRupees, cap);
    return {
      plan,
      balance_rupees: balanceRupees,
      cap,
      discount,
      payable: Math.max(0, plan - discount),
    };
  }, [previewPlan, previewPoints, settings.rupees_per_point, settings.max_discount_pct]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 max-w-6xl">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-rose-500 p-8 text-white shadow-glow">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-widest mb-3">
              <Gift className="w-3 h-3" /> Settings
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Refer & Earn</h1>
            <p className="mt-1 text-sm text-white/85 max-w-2xl">
              Configure the institution-to-institution referral programme. Defaults
              apply to all new referrals as soon as you save.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition shrink-0',
              dirty
                ? 'bg-white text-violet-700 hover:bg-white/95'
                : 'bg-white/30 text-white/70 cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" />
              : saved ? <CheckCircle2 className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {/* ── Platform stats strip ── */}
      {stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat
            icon={Users}
            label="Total Referrals"
            value={stats.counts.total_referrals.toString()}
            sub={`${stats.counts.credited} credited`}
            accent="violet"
          />
          <Stat
            icon={TrendingUp}
            label="Lifetime Points Issued"
            value={stats.counts.lifetime_points.toLocaleString('en-IN')}
            sub="Across all wallets"
            accent="emerald"
          />
          <Stat
            icon={Wallet}
            label="Outstanding Points"
            value={stats.wallets.total_outstanding_points.toLocaleString('en-IN')}
            sub={`${stats.wallets.total_wallets} wallets`}
            accent="amber"
          />
          <Stat
            icon={Zap}
            label="Points Used"
            value={stats.wallets.total_used.toLocaleString('en-IN')}
            sub="At renewals"
            accent="rose"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Settings form (2 cols) ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 space-y-5">
            <SectionHeader icon={Gift} title="Programme Settings" />

            <FieldGroup
              label="Points per referral"
              description="Awarded to the referrer once the referred institution completes their first paid subscription."
              error={errs.points_per_referral}
            >
              <NumberInput
                value={String(settings.points_per_referral)}
                onChange={(v) => update('points_per_referral', Number(v) || 0)}
                min={0}
                trail="points"
                error={!!errs.points_per_referral}
              />
            </FieldGroup>

            <FieldGroup
              label="Rupees per point"
              description="Conversion rate when points are applied as a discount. 1 point = ₹1 by default."
              error={errs.rupees_per_point}
            >
              <NumberInput
                value={String(settings.rupees_per_point)}
                onChange={(v) => update('rupees_per_point', Number(v) || 0)}
                min={0}
                step={0.01}
                lead="₹"
                trail="/ point"
                error={!!errs.rupees_per_point}
              />
            </FieldGroup>

            <FieldGroup
              label="Maximum discount per renewal"
              description="Hard ceiling so a single renewal can't be wiped out entirely by referral points."
              error={errs.max_discount_pct}
            >
              <NumberInput
                value={String(settings.max_discount_pct)}
                onChange={(v) => update('max_discount_pct', Number(v) || 0)}
                min={0}
                max={100}
                trail="%"
                error={!!errs.max_discount_pct}
              />
            </FieldGroup>

            <FieldGroup
              label="Points expiry"
              description="Points lapse this many days after they were earned (any earn-event)."
              error={errs.points_expiry_days}
            >
              <NumberInput
                value={String(settings.points_expiry_days)}
                onChange={(v) => update('points_expiry_days', Number(v) || 0)}
                min={1}
                trail="days"
                error={!!errs.points_expiry_days}
              />
            </FieldGroup>

            <FieldGroup
              label="Auto-approve rewards"
              description="When ON, rewards credit automatically as soon as the referred institution's payment lands. When OFF, you'll need to approve each referral manually before points hit the wallet."
            >
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_approve}
                  onChange={(e) => update('auto_approve', e.target.checked)}
                  className="sr-only peer"
                />
                <div className={cn(
                  'w-11 h-6 rounded-full transition-colors peer-focus:ring-4 peer-focus:ring-violet-500/20',
                  settings.auto_approve ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600',
                )}>
                  <div className={cn(
                    'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                    settings.auto_approve && 'translate-x-5',
                  )} />
                </div>
                <span className={cn(
                  'ml-3 text-sm font-semibold',
                  settings.auto_approve
                    ? 'text-violet-700 dark:text-violet-300'
                    : 'text-slate-500 dark:text-slate-400',
                )}>
                  {settings.auto_approve ? 'ON' : 'OFF'}
                </span>
              </label>
            </FieldGroup>
          </div>

          {/* Top referrers */}
          {stats && stats.top_referrers.length > 0 ? (
            <div className="card p-6">
              <SectionHeader icon={Trophy} title="Top Referrers" />
              <div className="mt-4 space-y-2">
                {stats.top_referrers.map((t, idx) => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-violet-50/40 transition">
                    <div className={cn(
                      'w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold',
                      idx === 0 ? 'bg-amber-100 text-amber-700'
                        : idx === 1 ? 'bg-slate-200 text-slate-700'
                        : idx === 2 ? 'bg-orange-100 text-orange-700'
                        : 'bg-slate-100 text-slate-500',
                    )}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{t.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {t.credited_count} referral{t.credited_count === 1 ? '' : 's'} · {t.points_earned.toLocaleString('en-IN')} pts
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Recent referrals */}
          {stats && stats.recent_referrals.length > 0 ? (
            <div className="card overflow-hidden">
              <div className="p-6 pb-3">
                <SectionHeader icon={Clock} title="Recent Referrals" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/40 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    <tr>
                      <th className="px-5 py-2 text-left">Referrer</th>
                      <th className="px-4 py-2 text-left">Referred</th>
                      <th className="px-4 py-2 text-right">Points</th>
                      <th className="px-4 py-2 text-center">Status</th>
                      <th className="px-4 py-2 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stats.recent_referrals.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-5 py-2.5 font-medium text-slate-900 dark:text-white">{r.referrer_name}</td>
                        <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{r.referred_name}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                          {(r.reward_points || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-[11px] text-slate-500">
                          {fmtDate(r.rewarded_at || r.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Right column: preview ── */}
        <div className="space-y-6">
          <div className="card p-6">
            <SectionHeader icon={Calculator} title="Renewal Preview" />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              See exactly how your settings translate to a real renewal.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Plan amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                  <input
                    type="number"
                    min="0"
                    value={previewPlan}
                    onChange={(e) => setPreviewPlan(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-violet-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Wallet points
                </label>
                <input
                  type="number"
                  min="0"
                  value={previewPoints}
                  onChange={(e) => setPreviewPoints(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <PreviewRow label="Wallet balance" value={formatCurrency(preview.balance_rupees)} />
              <PreviewRow label={`Max allowed (${settings.max_discount_pct}%)`} value={formatCurrency(preview.cap)} />
              <div className="h-px bg-slate-100 dark:bg-slate-800" />
              <PreviewRow label="Plan amount" value={formatCurrency(preview.plan)} bold />
              <PreviewRow label="Referral discount" value={`− ${formatCurrency(preview.discount)}`} color="rose" />
              <div className="h-px bg-slate-100 dark:bg-slate-800" />
              <PreviewRow label="Final payable" value={formatCurrency(preview.payable)} bold color="emerald" />
            </div>
          </div>

          {/* How it works */}
          <div className="card p-6">
            <SectionHeader icon={Zap} title="How it works" />
            <div className="mt-3 space-y-3">
              {[
                'Institution A shares their referral code.',
                'Institution B registers using that code.',
                'When B pays their first subscription, A earns points.',
                'A\'s next renewal is discounted up to the max %.',
                'Points expire after the configured duration.',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-5 h-5 shrink-0 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[10px] font-bold grid place-items-center mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-500/15 grid place-items-center text-violet-600 dark:text-violet-400">
        <Icon className="w-4 h-4" />
      </div>
      <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
    </div>
  );
}

function FieldGroup({
  label, description, error, children,
}: { label: string; description?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-1">{label}</label>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2.5">{description}</p>
      )}
      {children}
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5 font-medium">{error}</p>
      )}
    </div>
  );
}

function NumberInput({
  value, onChange, min, max, step, lead, trail, error,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number; max?: number; step?: number;
  lead?: string; trail?: string;
  error?: boolean;
}) {
  return (
    <div className="relative max-w-xs">
      {lead ? (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">{lead}</span>
      ) : null}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full py-2.5 rounded-xl border text-sm font-mono focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition',
          lead ? 'pl-7' : 'pl-4',
          trail ? 'pr-16' : 'pr-4',
          error
            ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
        )}
      />
      {trail ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-medium pointer-events-none">{trail}</span>
      ) : null}
    </div>
  );
}

function Stat({
  icon: Icon, label, value, sub, accent,
}: {
  icon: any; label: string; value: string; sub?: string;
  accent: 'violet' | 'emerald' | 'amber' | 'rose';
}) {
  const tone = {
    violet:  { bg: 'bg-violet-50  dark:bg-violet-500/10',  text: 'text-violet-700  dark:text-violet-300',  label: 'text-violet-600/80'  },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', label: 'text-emerald-600/80' },
    amber:   { bg: 'bg-amber-50   dark:bg-amber-500/10',   text: 'text-amber-700   dark:text-amber-300',   label: 'text-amber-600/80'   },
    rose:    { bg: 'bg-rose-50    dark:bg-rose-500/10',    text: 'text-rose-700    dark:text-rose-300',    label: 'text-rose-600/80'    },
  }[accent];
  return (
    <div className={cn('rounded-2xl p-4', tone.bg)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-3.5 h-3.5', tone.text)} />
        <span className={cn('text-[10px] uppercase tracking-wider font-bold', tone.label)}>{label}</span>
      </div>
      <div className={cn('text-xl font-extrabold tabular-nums', tone.text)}>{value}</div>
      {sub && <div className={cn('text-[10px] mt-0.5 font-medium', tone.label)}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    pending:   { bg: 'bg-amber-100 text-amber-700',     text: 'Pending' },
    completed: { bg: 'bg-blue-100 text-blue-700',       text: 'Completed' },
    credited:  { bg: 'bg-emerald-100 text-emerald-700', text: 'Credited' },
    expired:   { bg: 'bg-rose-100 text-rose-700',       text: 'Expired' },
  };
  const m = map[status] || map.pending;
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', m.bg)}>
      {m.text}
    </span>
  );
}

function PreviewRow({
  label, value, bold, color,
}: { label: string; value: string; bold?: boolean; color?: 'emerald' | 'rose' }) {
  const colorMap = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose:    'text-rose-600 dark:text-rose-400',
  };
  return (
    <div className="flex items-center justify-between">
      <span className={cn('text-xs', bold ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400')}>
        {label}
      </span>
      <span className={cn(
        'font-mono tabular-nums',
        bold ? 'text-sm font-bold' : 'text-sm font-semibold',
        color ? colorMap[color] : 'text-slate-700 dark:text-slate-300',
      )}>
        {value}
      </span>
    </div>
  );
}
