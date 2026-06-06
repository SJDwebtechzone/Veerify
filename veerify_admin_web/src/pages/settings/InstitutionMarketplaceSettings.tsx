import { useEffect, useState, useMemo } from 'react';
import { CalendarClock, CheckCircle2, Loader2, Info, Calculator, Percent } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface Settings {
  commission_percent: number;
  gateway_bearer: string; // 'Platform' | 'Institution'
  min_payout: number;
  settlement_cycle: string; // 'Daily' | 'Weekly' | 'Monthly'
  auto_settlement: boolean;
}

// Constants (mirrored from admin page)
const SETTLEMENT_CYCLES = ['Daily', 'Weekly', 'Monthly'];
const GATEWAY_BEARERS = ['Platform', 'Institution'];
const GATEWAY_PERCENT = 2; // Fixed for calculator

export function InstitutionMarketplaceSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [calcAmount, setCalcAmount] = useState('3000');
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Detect mobile screen size (responsive fallback)
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768); // treat <=768px as mobile
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load settings (read‑only)
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/marketplace-settings');
        setSettings(res.data?.settings);
      } catch (err: any) {
        console.error('Failed to load marketplace settings', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Calculator derived values
  const calc = useMemo(() => {
    if (!settings) return null;
    const amount = parseFloat(calcAmount) || 0;
    const commissionFee = Math.round(amount * settings.commission_percent / 100);
    const gatewayFee = Math.round(amount * GATEWAY_PERCENT / 100);
    const institutionBears = settings.gateway_bearer === 'Institution';
    const totalDeduction = commissionFee + (institutionBears ? gatewayFee : 0);
    const earnings = amount - totalDeduction;
    return { amount, commissionFee, gatewayFee, institutionBears, totalDeduction, earnings };
  }, [calcAmount, settings]);

  // Mobile‑only guard
  if (!isMobile) {
    return (
      <div className="flex items-center justify-center py-32 animate-fade-in">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This view is available on mobile devices only.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 animate-fade-in">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-rose-600">Unable to load marketplace settings.</div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6 animate-fade-in">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-600 p-8 text-white shadow-glow">
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-bold uppercase tracking-widest mb-3">
              <Info className="w-3 h-3" /> Institution View
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Marketplace Settings (Read‑Only)</h1>
            <p className="mt-1 text-sm text-white/80 max-w-2xl">
              These values are configured by the super‑admin and affect all institutions.
            </p>
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT – Settings (read‑only) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 space-y-4">
            <div className="flex items-center gap-2.5 mb-4">
              <Percent className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-semibold">Commission Settings</h2>
            </div>
            {/* Commission % */}
            <div>
              <label className="block text-sm font-semibold mb-1">Marketplace Commission (%)</label>
              <div className="text-sm text-slate-700 dark:text-slate-300">{settings.commission_percent}%</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Percentage deducted from institution course sales.</p>
            </div>
            {/* Gateway Bearer */}
            <div>
              <label className="block text-sm font-semibold mb-1">Gateway Charges Bearer</label>
              <div className="text-sm text-slate-700 dark:text-slate-300">{settings.gateway_bearer}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Who pays the payment gateway processing fee?</p>
            </div>
            {/* Minimum Payout */}
            <div>
              <label className="block text-sm font-semibold mb-1">Minimum Payout Amount</label>
              <div className="text-sm text-slate-700 dark:text-slate-300">₹{settings.min_payout.toLocaleString()}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Minimum wallet balance required before settlement.</p>
            </div>
            {/* Settlement Cycle */}
            <div>
              <label className="block text-sm font-semibold mb-1">Settlement Cycle</label>
              <div className="text-sm text-slate-700 dark:text-slate-300">{settings.settlement_cycle}</div>
            </div>
            {/* Auto Settlement */}
            <div>
              <label className="block text-sm font-semibold mb-1">Enable Automatic Settlements</label>
              <div className="text-sm text-slate-700 dark:text-slate-300">{settings.auto_settlement ? 'ON' : 'OFF'}</div>
            </div>
          </div>
        </div>

        {/* RIGHT – Info Card + Calculator */}
        <div className="space-y-6">
          {/* Information Card */}
          <div className="card p-6">
            <div className="flex items-center gap-2.5 mb-3">
              <Info className="w-5 h-5 text-brand-600" />
              <h2 className="text-base font-bold">How Marketplace Settlement Works</h2>
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <p>1️⃣ Student purchases course</p>
              <p>2️⃣ Payment goes to admin Razorpay account</p>
              <p>3️⃣ Marketplace commission deducted</p>
              <p>4️⃣ Gateway charges deducted (if institution bears it)</p>
              <p>5️⃣ Remaining amount added to institution wallet</p>
              <p>6️⃣ Admin settles manually/automatically</p>
            </div>
          </div>

          {/* Calculator (read‑only) */}
          <div className="card p-6">
            <div className="flex items-center gap-2.5 mb-3">
              <Calculator className="w-5 h-5 text-brand-600" />
              <h2 className="text-base font-bold">Settlement Preview</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Enter a course amount to see the breakdown.</p>
            <div className="relative mb-5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">₹</span>
              <input
                type="number"
                min="0"
                step="100"
                value={calcAmount}
                onChange={e => setCalcAmount(e.target.value)}
                placeholder="3000"
                className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              />
            </div>
            {calc && calc.amount > 0 && (
              <div className="space-y-3">
                <div className="flex justify-between text-sm font-mono">
                  <span className="font-bold text-slate-900 dark:text-white">Course Amount</span>
                  <span>₹{calc.amount.toLocaleString()}</span>
                </div>
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
                <div className="flex justify-between text-sm font-mono text-rose-600">
                  <span>Marketplace Fee ({settings.commission_percent}%)</span>
                  <span>-₹{calc.commissionFee.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-mono" style={{ color: calc.institutionBears ? '#e11d48' : '#64748b' }}>
                  <span>Gateway Charges ({GATEWAY_PERCENT}%){!calc.institutionBears && ' (paid by platform)'}</span>
                  <span>{calc.institutionBears ? `-₹${calc.gatewayFee.toLocaleString()}` : '₹0'}</span>
                </div>
                <div className="h-px bg-slate-100 dark:bg-slate-800" />
                <div className="flex justify-between text-sm font-mono text-emerald-600 font-bold">
                  <span>Institution Earnings</span>
                  <span>₹{calc.earnings.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
