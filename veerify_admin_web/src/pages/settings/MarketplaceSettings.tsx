// src/pages/settings/MarketplaceSettings.tsx
//
// Super-admin Marketplace Settings page.
//
// Three sections:
//   1. Commission Settings — edit commission %, gateway bearer, min payout,
//      settlement cycle, auto-settlement toggle.
//   2. Information Card — read-only explainer of how settlement works.
//   3. Settlement Calculator — live preview of fees for a given course amount.
//
// Data flows through GET/PUT /api/marketplace-settings.

import { useEffect, useMemo, useState } from 'react';
import {
  Store, Percent, CreditCard, Wallet, CalendarClock, Zap,
  Info, ArrowRight, Calculator, Save, Loader2, CheckCircle2,
  IndianRupee,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface Settings {
  commission_percent: number;
  gateway_bearer: string;     // 'Platform' | 'Institution'
  min_payout: number;
  settlement_cycle: string;   // 'Daily' | 'Weekly' | 'Monthly'
  auto_settlement: boolean;
}

const DEFAULTS: Settings = {
  commission_percent: 10,
  gateway_bearer: 'Institution',
  min_payout: 1000,
  settlement_cycle: 'Weekly',
  auto_settlement: false,
};

const SETTLEMENT_CYCLES = ['Daily', 'Weekly', 'Monthly'];
const GATEWAY_BEARERS = ['Platform', 'Institution'];
const GATEWAY_PERCENT = 2; // Fixed gateway charge percentage for calculation

// ── Component ────────────────────────────────────────────────────────────────

export function MarketplaceSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Calculator state
  const [calcAmount, setCalcAmount] = useState('3000');

  // Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/marketplace-settings');
        const s = res.data?.settings;
        if (s) {
          setSettings({
            commission_percent: Number(s.commission_percent) ?? DEFAULTS.commission_percent,
            gateway_bearer: s.gateway_bearer || DEFAULTS.gateway_bearer,
            min_payout: Number(s.min_payout) ?? DEFAULTS.min_payout,
            settlement_cycle: s.settlement_cycle || DEFAULTS.settlement_cycle,
            auto_settlement: !!s.auto_settlement,
          });
        }
      } catch (err: any) {
        setError(err.response?.data?.message || err.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Update field ──
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
    // Clear validation error for this field
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Validate ──
  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (settings.commission_percent < 0 || settings.commission_percent > 100) {
      errors.commission_percent = 'Must be between 0 and 100';
    }
    if (settings.min_payout < 0) {
      errors.min_payout = 'Cannot be negative';
    }
    if (!SETTLEMENT_CYCLES.includes(settings.settlement_cycle)) {
      errors.settlement_cycle = 'Settlement cycle is required';
    }
    if (!GATEWAY_BEARERS.includes(settings.gateway_bearer)) {
      errors.gateway_bearer = 'Gateway bearer is required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Save ──
  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      await api.put('/marketplace-settings', settings);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Calculator derived values ──
  // Gateway charges are hidden from the UI per product decision; the
  // calculator only models the marketplace commission now. We keep the
  // gatewayFee field in the return shape for backwards-compat with any
  // unit tests / debug consumers.
  const calc = useMemo(() => {
    const amount = parseFloat(calcAmount) || 0;
    const commissionFee = Math.round(amount * settings.commission_percent / 100);
    const gatewayFee = 0;
    const institutionBears = false;
    const totalDeduction = commissionFee;
    const earnings = amount - totalDeduction;
    return { amount, commissionFee, gatewayFee, institutionBears, totalDeduction, earnings };
  }, [calcAmount, settings.commission_percent]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl">
      {/* ── Hero header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-600 p-8 text-white shadow-glow">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-widest mb-3">
              <Store className="w-3 h-3" /> Settings
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Marketplace Settings</h1>
            <p className="mt-1 text-sm text-white/80 max-w-2xl">
              Configure commissions, gateway charges, and settlement cycles.
              Changes affect all future institution payouts.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition shrink-0',
              dirty
                ? 'bg-white text-emerald-700 hover:bg-white/95'
                : 'bg-white/30 text-white/70 cursor-not-allowed',
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 p-4 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── SECTION 1 — Commission Settings (spans 2 cols) ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 space-y-6">
            <SectionHeader icon={Percent} title="Commission Settings" />

            {/* Commission % */}
            <FieldGroup
              label="Marketplace Commission (%)"
              description="Percentage deducted from institution course sales."
              error={validationErrors.commission_percent}
            >
              <div className="relative max-w-xs">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={settings.commission_percent}
                  onChange={(e) => update('commission_percent', parseFloat(e.target.value) || 0)}
                  className={cn(
                    'w-full pr-10 pl-4 py-2.5 rounded-xl border text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition',
                    validationErrors.commission_percent
                      ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
                  )}
                />
                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </FieldGroup>

            {/* Gateway Bearer — hidden by product decision. The field is kept
                in state with its default value so the save payload still
                passes backend validation; UI is suppressed. */}

            {/* Min payout */}
            <FieldGroup
              label="Minimum Payout Amount"
              description="Minimum wallet balance required before settlement."
              error={validationErrors.min_payout}
            >
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={settings.min_payout}
                  onChange={(e) => update('min_payout', parseFloat(e.target.value) || 0)}
                  className={cn(
                    'w-full pl-7 pr-4 py-2.5 rounded-xl border text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition',
                    validationErrors.min_payout
                      ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900',
                  )}
                />
              </div>
            </FieldGroup>

            {/* Settlement Cycle */}
            <FieldGroup
              label="Settlement Cycle"
              description="How often payouts are processed."
              error={validationErrors.settlement_cycle}
            >
              <div className="flex gap-2">
                {SETTLEMENT_CYCLES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => update('settlement_cycle', opt)}
                    className={cn(
                      'px-4 py-2 rounded-xl border text-sm font-semibold transition',
                      settings.settlement_cycle === opt
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-400'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600',
                    )}
                  >
                    <CalendarClock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    {opt}
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Auto Settlement */}
            <FieldGroup
              label="Enable Automatic Settlements"
              description="When enabled, payouts are processed automatically at the end of each cycle."
            >
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_settlement}
                  onChange={(e) => update('auto_settlement', e.target.checked)}
                  className="sr-only peer"
                />
                <div className={cn(
                  'w-11 h-6 rounded-full transition-colors peer-focus:ring-4 peer-focus:ring-brand-500/20',
                  settings.auto_settlement
                    ? 'bg-brand-500'
                    : 'bg-slate-300 dark:bg-slate-600',
                )}>
                  <div className={cn(
                    'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                    settings.auto_settlement && 'translate-x-5',
                  )} />
                </div>
                <span className={cn(
                  'ml-3 text-sm font-semibold',
                  settings.auto_settlement
                    ? 'text-brand-700 dark:text-brand-400'
                    : 'text-slate-500 dark:text-slate-400',
                )}>
                  {settings.auto_settlement ? 'ON' : 'OFF'}
                </span>
              </label>
            </FieldGroup>
          </div>
        </div>

        {/* ── Right column — Info card + Calculator ── */}
        <div className="space-y-6">
          {/* SECTION 2 — Information Card */}
          <div className="card p-6">
            <SectionHeader icon={Info} title="How Marketplace Settlement Works" />
            <div className="mt-4 space-y-3">
              {[
                { step: '1', text: 'Student purchases course' },
                { step: '2', text: 'Payment goes to admin Razorpay account' },
                { step: '3', text: 'Marketplace commission deducted' },
                { step: '4', text: 'Remaining amount added to institution wallet' },
                { step: '5', text: 'Admin settles manually/automatically' },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div className="w-6 h-6 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white text-[10px] font-bold grid place-items-center shadow-sm">
                    {item.step}
                  </div>
                  <span className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 3 — Calculator */}
          <div className="card p-6">
            <SectionHeader icon={Calculator} title="Settlement Preview" />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              Enter a course amount to see the breakdown.
            </p>

            <div className="relative mb-5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">₹</span>
              <input
                type="number"
                min="0"
                step="100"
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value)}
                placeholder="3000"
                className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              />
            </div>

            {calc.amount > 0 && (
              <div className="space-y-3">
                <CalcRow label="Course Amount" value={calc.amount} bold />
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
                <CalcRow
                  label={`Marketplace Fee (${settings.commission_percent}%)`}
                  value={-calc.commissionFee}
                  color="rose"
                />
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
                <CalcRow
                  label="Institution Earnings"
                  value={calc.earnings}
                  color="emerald"
                  bold
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-500/15 grid place-items-center text-emerald-600 dark:text-emerald-400">
        <Icon className="w-4 h-4" />
      </div>
      <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
    </div>
  );
}

function FieldGroup({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
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

function CalcRow({
  label,
  value,
  color = 'slate',
  bold = false,
  note,
}: {
  label: string;
  value: number;
  color?: 'slate' | 'rose' | 'emerald';
  bold?: boolean;
  note?: string;
}) {
  const colorMap = {
    slate: 'text-slate-700 dark:text-slate-300',
    rose: 'text-rose-600 dark:text-rose-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  };
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className={cn('text-xs', bold ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400')}>
          {label}
        </span>
        {note && <span className="ml-1.5 text-[10px] italic text-slate-400">({note})</span>}
      </div>
      <span className={cn('text-sm font-mono tabular-nums', bold ? 'font-bold' : 'font-semibold', colorMap[color])}>
        {value < 0 ? '−' : ''}₹{Math.abs(value).toLocaleString('en-IN')}
      </span>
    </div>
  );
}
