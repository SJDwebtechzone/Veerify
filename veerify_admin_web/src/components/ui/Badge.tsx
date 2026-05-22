import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

const variants: Record<Variant, string> = {
  default: 'bg-brand-50 text-brand-700 ring-brand-200/60 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200/60 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700/60',
};

const dotColors: Record<Variant, string> = {
  default: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-500',
};

export function Badge({ variant = 'default', children, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset',
        variants[variant],
        className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  );
}
