import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { navSections, type NavSection, type NavChild } from '../../lib/nav';
import { useNotifications } from '../../lib/notifications';
import veerifyLogo from '../../assets/veerify-logo.png';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

// Map a child route to a live counter from the notifications context. Keeping
// this lookup table here (rather than baking it into nav.ts) keeps the nav
// definition pure data and avoids a circular import.
function badgeCountFor(to: string, counts: ReturnType<typeof useNotifications>['counts']): number {
  switch (to) {
    case '/institutions/pending':  return counts.pending_approval;
    case '/institutions/expired':  return counts.expired;
    default: return 0;
  }
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden animate-fade-in"
        />
      )}

      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-40 h-screen w-72 shrink-0',
          'bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <img
                src={veerifyLogo}
                alt="Veerify"
                className="w-9 h-9 rounded-full object-cover shadow-glow"
              />
              <div>
                <div className="font-bold text-slate-900 dark:text-white tracking-tight">Veerify</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">Super Admin</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {navSections.map((section) => (
              <NavGroup key={section.label} section={section} />
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}

function NavGroup({ section }: { section: NavSection }) {
  const location = useLocation();
  const { counts } = useNotifications();
  const isActive = section.children?.some((c) => location.pathname === c.to) ?? false;
  const [open, setOpen] = useState(isActive);

  const Icon = section.icon;

  // Aggregate badge count for the parent: sum of badged children. Lets the
  // user see "there's something pending under here" even when collapsed.
  const parentBadge = section.children
    ? section.children.reduce((sum, c) => sum + badgeCountFor(c.to, counts), 0)
    : 0;

  if (!section.children) {
    return (
      <NavLink
        to={section.to!}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
            isActive
              ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
          )
        }
      >
        <Icon className="w-[18px] h-[18px]" />
        <span>{section.label}</span>
      </NavLink>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
          isActive
            ? 'text-brand-700 dark:text-brand-300'
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
        <span className="flex-1 text-left">{section.label}</span>
        {parentBadge > 0 && !open && <CountBadge count={parentBadge} small />}
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-1 ml-5 pl-4 border-l border-slate-200 dark:border-slate-800 space-y-0.5 animate-fade-in">
          {section.children.map((child) => (
            <ChildLink key={child.to} child={child} count={badgeCountFor(child.to, counts)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildLink({ child, count }: { child: NavChild; count: number }) {
  return (
    <NavLink
      to={child.to}
      end={child.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center justify-between px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
          isActive
            ? 'text-brand-700 dark:text-brand-300 bg-brand-50/60 dark:bg-brand-500/10'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50',
        )
      }
    >
      <span>{child.label}</span>
      {count > 0 && <CountBadge count={count} />}
    </NavLink>
  );
}

function CountBadge({ count, small }: { count: number; small?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold leading-none bg-rose-500 text-white shrink-0',
        small ? 'text-[10px] min-w-[18px] h-[18px] px-1.5' : 'text-[11px] min-w-[20px] h-5 px-1.5',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
