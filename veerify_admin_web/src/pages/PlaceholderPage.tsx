import { Construction, type LucideIcon } from 'lucide-react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function PlaceholderPage({ title, description, icon: Icon = Construction }: PlaceholderPageProps) {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
      </div>

      <div className="card p-16 grid place-items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-500/10 grid place-items-center mb-5">
          <Icon className="w-7 h-7 text-brand-600 dark:text-brand-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title} coming soon</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-md">
          This page is wired into the navigation and will be fleshed out next. The shared layout, theming, and table /
          form primitives are already in place.
        </p>
      </div>
    </div>
  );
}
