import { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

type Accent = 'brand' | 'emerald' | 'amber' | 'rose' | 'sky';

interface StatsCardProps {
  label: string;
  value: ReactNode;
  delta?: number;
  deltaSuffix?: string;
  icon: LucideIcon;
  accent?: Accent;
}

const accentStyles: Record<Accent, string> = {
  brand: 'from-brand-500/15 to-brand-500/5 text-brand-600 dark:text-brand-400',
  emerald: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  amber: 'from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400',
  rose: 'from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-400',
  sky: 'from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-400',
};

export function StatsCard({ label, value, delta, deltaSuffix = 'vs last month', icon: Icon, accent = 'brand' }: StatsCardProps) {
  const positive = (delta ?? 0) >= 0;

  return (
    <div className="card card-hover p-5 relative overflow-hidden">
      <div
        className={cn(
          'absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br opacity-60 blur-2xl',
          accentStyles[accent],
        )}
      />

      <div className="relative">
        <div className="flex items-start justify-between">
          <div
            className={cn(
              'w-10 h-10 rounded-xl bg-gradient-to-br grid place-items-center',
              accentStyles[accent],
            )}
          >
            <Icon className="w-5 h-5" strokeWidth={2.2} />
          </div>

          {delta !== undefined && (
            <div
              className={cn(
                'flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-md',
                positive
                  ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10'
                  : 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/10',
              )}
            >
              {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(delta)}%
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</div>
          {delta !== undefined && (
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{deltaSuffix}</div>
          )}
        </div>
      </div>
    </div>
  );
}
