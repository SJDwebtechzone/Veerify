import { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, toolbar, className, children }: ChartCardProps) {
  return (
    <div className={cn('card p-5', className)}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          <button className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
