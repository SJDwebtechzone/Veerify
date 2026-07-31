import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Building2, ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun, User,
} from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useNotifications, type RecentPending, type InboxItem } from '../../lib/notifications';
import { resolveImageUrl } from '../../lib/api';
import { cn } from '../../lib/utils';

interface NavbarProps {
  onMenuClick: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Overload so bell clicks can attach router state (highlightFields,
  // refreshedAt) when deep-linking into the institution detail page.
  const navigateWithState = (path: string, state?: any) => navigate(path, { state });

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
  // Profile logo uploaded via My Profile. When present we render it
  // inside the avatar tile in place of the initials so the navbar
  // matches whatever brand mark the admin set on themself.
  const profileLogoUrl = user?.org_logo_url
    ? resolveImageUrl(user.org_logo_url)
    : '';

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
            onView={(path, state) => { setBellOpen(false); navigateWithState(path, state); }}
          />

          <div className="relative ml-2 pl-3 border-l border-slate-200 dark:border-slate-700" ref={menuRef}>
            <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-3 group">
              <div className="hidden md:block text-right">
                <div className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{user?.name ?? 'Admin'}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Super Admin</div>
              </div>
              {profileLogoUrl ? (
                <img
                  src={profileLogoUrl}
                  alt={user?.name || 'Profile logo'}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shadow-glow bg-white"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center text-white font-semibold text-sm shadow-glow">
                  {initials}
                </div>
              )}
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
                  <MenuItem
                    icon={User}
                    label="My profile"
                    onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                  />
                  <MenuItem
                    icon={Settings}
                    label="Account settings"
                    onClick={() => { setMenuOpen(false); navigate('/account/settings'); }}
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
// The bell surfaces TWO streams:
//   1. Pending institution approvals   → onboarding/counts.recent_pending
//   2. Inbox notifications             → /notifications (system events like
//      "Institution profile updated", branch event approval requests, etc.)
// Badge count is unread inbox + pending approvals combined.
function NotificationBell({
  open, setOpen, bellRef, onView,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  bellRef: React.RefObject<HTMLDivElement>;
  onView: (path: string, state?: any) => void;
}) {
  const {
    counts, recentPending, inbox, unreadInbox,
    markInboxRead, markAllInboxRead, refresh,
  } = useNotifications();
  const pending = counts.pending_approval;
  const totalBadge = pending + unreadInbox;

  // Deep-link helper — picks the correct /institutions/:id to open for
  // each notification kind. Key rule: use the id that OWNS the changed
  // data, not the reporting-context id. For branch updates that means
  // the branch's own id (which IS an institutions row for sub-branches),
  // not the parent — otherwise the amber highlight lands on the parent's
  // untouched fields and looks wrong.
  const routeForInboxItem = (n: InboxItem): string | null => {
    const d = n.data || {};
    if (d.kind === 'institution_profile_updated' && d.institution_id) {
      return `/institutions/${d.institution_id}`;
    }
    // Branch add / update — route to the PARENT institution's detail
    // page. Its Linked Branches section already lists every child
    // (sub-branch + satellite + wizard), so the super admin sees the
    // change in context. This also gracefully handles stale
    // notifications whose data.branch_id pointed at an old
    // institution_branches row id (a different id sequence that
    // could collide with an unrelated institutions.id — the previous
    // /institutions/${branch_id} link resolved to phantom or wrong
    // academies and 404'd).
    if ((d.kind === 'branch_added' || d.kind === 'branch_updated')
        && d.institution_id) {
      return `/institutions/${d.institution_id}`;
    }
    // Event approval flow — the branch's admin is the audience for
    // approve/reject; the parent's admin is the audience for pending.
    // Either way route to the branch's page which surfaces its EventsList.
    if ((d.kind === 'branch_event_pending' || d.kind === 'branch_event_approved' || d.kind === 'branch_event_rejected')
        && d.branch_id) {
      return `/institutions/${d.branch_id}`;
    }
    if (n.institution_id) return `/institutions/${n.institution_id}`;
    return null;
  };

  const onInboxClick = (n: InboxItem) => {
    if (!n.read_at) markInboxRead(n.id);
    const path = routeForInboxItem(n);
    if (!path) { setOpen(false); return; }

    // Package the notification's diff so the detail page can (a) refetch
    // even when the URL id matches the current one — refreshedAt bumps
    // the effect's dependency — and (b) highlight exactly the fields
    // this notification says changed. Handles both institution profile
    // updates and branch updates; each backend payload puts the diff
    // under different keys (updated_fields vs changed_fields).
    const d = n.data || {};
    const highlightFields: string[] = Array.isArray(d.updated_fields)
      ? d.updated_fields
      : Array.isArray(d.changed_fields) ? d.changed_fields : [];
    // changed_values is the values-after snapshot the backend attaches
    // to profile-update notifications. When present, the detail page
    // renders it inline so the reviewer sees the truthful new value
    // even before the /onboarding/:id refetch resolves.
    const changedValues: Record<string, any> =
      d.changed_values && typeof d.changed_values === 'object' ? d.changed_values : {};
    const highlightBranchId: number | null = typeof d.branch_id === 'number'
      ? d.branch_id : null;
    onView(path, {
      highlightFields,
      highlightBranchId,
      changedValues,
      refreshedAt: Date.now(),
      notificationTitle: n.title,
    });
  };

  return (
    <div className="relative" ref={bellRef}>
      <button
        onClick={() => { setOpen(!open); if (!open) refresh(); }}
        className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-[18px] h-[18px]" />
        {totalBadge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {totalBadge === 0
                  ? 'You\'re all caught up.'
                  : `${pending} pending approval${pending === 1 ? '' : 's'}, ${unreadInbox} unread`}
              </div>
            </div>
            {unreadInbox > 0 && (
              <button
                onClick={() => markAllInboxRead()}
                className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Pending approvals section */}
          {recentPending.length > 0 && (
            <>
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Pending institution approvals
              </div>
              <div className="max-h-56 overflow-y-auto">
                {recentPending.map((p) => (
                  <PendingItem key={p.id} item={p} onClick={() => onView(`/institutions/${p.id}`)} />
                ))}
              </div>
            </>
          )}

          {/* Inbox section — this is where the "Institution profile updated"
              rows land once a mobile admin edits their academy profile. */}
          {inbox.length > 0 && (
            <>
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Recent activity
              </div>
              <div className="max-h-64 overflow-y-auto">
                {inbox.slice(0, 12).map((n) => (
                  <InboxRow key={n.id} item={n} onClick={() => onInboxClick(n)} />
                ))}
              </div>
            </>
          )}

          {recentPending.length === 0 && inbox.length === 0 && (
            <div className="px-4 py-8 text-center">
              <Building2 className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
              <div className="text-sm text-slate-500 dark:text-slate-400">No new activity</div>
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

function InboxRow({ item, onClick }: { item: InboxItem; onClick: () => void }) {
  const unread = !item.read_at;
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0',
        unread
          ? 'bg-brand-50/60 dark:bg-brand-500/5 hover:bg-brand-50 dark:hover:bg-brand-500/10'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800',
      )}
    >
      <div className={cn(
        'w-2 h-2 rounded-full mt-2 shrink-0',
        unread ? 'bg-rose-500' : 'bg-transparent',
      )} />
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-sm truncate',
          unread ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300',
        )}>
          {item.title}
        </div>
        {item.message ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
            {item.message}
          </div>
        ) : null}
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {timeAgo(item.created_at)}
        </div>
      </div>
    </button>
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
