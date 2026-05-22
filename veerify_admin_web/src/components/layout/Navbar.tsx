import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Building2, ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, User,
} from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useNotifications, type RecentPending } from '../../lib/notifications';
import { resolveImageUrl } from '../../lib/api';
import { cn } from '../../lib/utils';

interface NavbarProps {
  onMenuClick: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : 'SA';

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 glass border-b border-slate-200/60 dark:border-slate-800">
      <div className="flex items-center gap-4 px-4 lg:px-8 h-16">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex-1 max-w-xl">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search institutions, students, trainers…"
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-transparent focus:border-brand-400 focus:bg-white dark:focus:bg-slate-900 outline-none text-sm placeholder:text-slate-400 transition-all"
            />
            <kbd className="hidden md:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1 px-1.5 h-6 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-medium text-slate-500">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggle}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>

          <NotificationBell
            open={bellOpen}
            setOpen={setBellOpen}
            bellRef={bellRef}
            onView={(path) => { setBellOpen(false); navigate(path); }}
          />

          <div className="relative ml-2 pl-3 border-l border-slate-200 dark:border-slate-700" ref={menuRef}>
            <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-3 group">
              <div className="hidden md:block text-right">
                <div className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{user?.name ?? 'Admin'}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Super Admin</div>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white font-semibold text-sm shadow-glow">
                {initials}
              </div>
              <ChevronDown
                className={cn(
                  'w-4 h-4 text-slate-400 transition-transform hidden md:block',
                  menuOpen && 'rotate-180',
                )}
              />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{user?.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</div>
                </div>
                <div className="py-1">
                  <MenuItem icon={User} label="My profile" onClick={() => setMenuOpen(false)} />
                  <MenuItem
                    icon={Settings}
                    label="Account settings"
                    onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  />
                </div>
                <div className="py-1 border-t border-slate-200 dark:border-slate-800">
                  <MenuItem icon={LogOut} label="Sign out" onClick={handleLogout} danger />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─────────── Notification bell + dropdown ───────────
function NotificationBell({
  open, setOpen, bellRef, onView,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  bellRef: React.RefObject<HTMLDivElement>;
  onView: (path: string) => void;
}) {
  const { counts, recentPending, refresh } = useNotifications();
  const pending = counts.pending_approval;

  return (
    <div className="relative" ref={bellRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) refresh(); }}
        className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-[18px] h-[18px]" />
        {pending > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900">
            {pending > 99 ? '99+' : pending}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {pending === 0 ? 'You\'re all caught up.' : `${pending} pending approval${pending === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          {recentPending.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Building2 className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
              <div className="text-sm text-slate-500 dark:text-slate-400">No new requests</div>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {recentPending.map((p) => (
                <PendingItem key={p.id} item={p} onClick={() => onView(`/institutions/${p.id}`)} />
              ))}
            </div>
          )}

          <button
            onClick={() => onView('/institutions/pending')}
            className="w-full px-4 py-2.5 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-200 dark:border-slate-800 transition-colors"
          >
            View all pending approvals →
          </button>
        </div>
      )}
    </div>
  );
}

function PendingItem({ item, onClick }: { item: RecentPending; onClick: () => void }) {
  const logo = item.logo_url ? resolveImageUrl(item.logo_url) : '';
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0"
    >
      {logo ? (
        <img src={logo} alt={item.name} className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm shrink-0">
          {item.name?.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{item.name}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {item.owner_name} • {item.plan_name || 'No plan'}
        </div>
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {timeAgo(item.created_at)}
        </div>
      </div>
    </button>
  );
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return '';
  const secs = Math.round((Date.now() - d) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function MenuItem({
  icon: Icon, label, onClick, danger,
}: {
  icon: typeof User;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
        danger
          ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
