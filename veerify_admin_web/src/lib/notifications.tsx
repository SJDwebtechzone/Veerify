import {
  createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback,
} from 'react';
import apiClient from '../api/client';
import { useAuth } from './auth';

// ─────────────────────────────────────────────────────────────────────────────
// Notifications context — polls /api/onboarding/counts so the sidebar's
// "Pending Approvals" entry and the navbar bell can show live counts without
// each component fetching on its own.
//
// Poll cadence: 30s. Also re-fetches immediately whenever `refresh()` is called
// (e.g. after an admin approves / rejects a pending institution, that screen
// can call refresh() so the badge updates without waiting for the next tick).
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardingCounts {
  pending_approval: number;
  approved: number;
  active: number;
  rejected: number;
  expired: number;
  total: number;
  // Platform-wide people counts (added in the same payload so the dashboard
  // doesn't need a second round-trip for the headline cards).
  total_students: number;
  total_trainers: number;
  total_parents: number;
  // Monthly Recurring Revenue — sum of plan price for every currently-
  // active institution. In rupees (NOT paise) to match the rest of the
  // pricing in the system.
  monthly_revenue: number;
}

export interface RecentPending {
  id: number;
  name: string;
  logo_url: string | null;
  city: string | null;
  created_at: string;
  owner_name: string;
  owner_email: string;
  plan_name: string | null;
  plan_price: string | null;
}

// A row from GET /api/notifications — the generic inbox that carries
// system events like "Institution profile updated", branch event
// approval requests, etc. Shape mirrors the mobile side.
export interface InboxItem {
  id: number;
  user_id: number;
  institution_id: number | null;
  category: string;
  title: string;
  message: string | null;
  data: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationsContextValue {
  counts: OnboardingCounts;
  recentPending: RecentPending[];
  inbox: InboxItem[];
  unreadInbox: number;
  refresh: () => Promise<void>;
  markInboxRead: (id: number) => Promise<void>;
  markAllInboxRead: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const EMPTY: OnboardingCounts = {
  pending_approval: 0, approved: 0, active: 0, rejected: 0, expired: 0, total: 0,
  total_students: 0, total_trainers: 0, total_parents: 0,
  monthly_revenue: 0,
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

const POLL_INTERVAL_MS = 30_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [counts, setCounts] = useState<OnboardingCounts>(EMPTY);
  const [recentPending, setRecentPending] = useState<RecentPending[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    if (inFlightRef.current) return; // de-dupe concurrent polls
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Two parallel fetches:
      //   /onboarding/counts        → pending-institution counts + recent list
      //   /notifications?limit=50   → generic inbox (system, announcements, etc.)
      //
      // The inbox is what carries the "Institution profile updated" ping we
      // fire from the backend when an admin edits their profile. Catching
      // errors on the inbox call so a 401/500 doesn't wipe out the counts.
      const [countsRes, inboxRes] = await Promise.all([
        apiClient.get('/onboarding/counts'),
        apiClient.get('/notifications?limit=50').catch(() => ({ data: { notifications: [] } })),
      ]);
      setCounts({ ...EMPTY, ...(countsRes.data.counts || {}) });
      setRecentPending(countsRes.data.recent_pending || []);
      setInbox(inboxRes.data.notifications || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [isAuthenticated]);

  // Mark a single inbox row as read. Optimistic local update so the badge
  // drops immediately; if the request fails we revert.
  const markInboxRead = useCallback(async (id: number) => {
    setInbox((prev) =>
      prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n))
    );
    try {
      await apiClient.post(`/notifications/${id}/read`);
    } catch {
      // Best-effort — next poll will re-hydrate.
    }
  }, []);

  const markAllInboxRead = useCallback(async () => {
    if (inbox.every((n) => n.read_at)) return;
    const now = new Date().toISOString();
    setInbox((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    try {
      await apiClient.post('/notifications/read-all');
    } catch { /* poll will resync */ }
  }, [inbox]);

  useEffect(() => {
    if (!isAuthenticated) {
      setCounts(EMPTY);
      setRecentPending([]);
      setInbox([]);
      return;
    }
    // Fetch immediately on auth, then every POLL_INTERVAL_MS.
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    // Also refresh whenever the window regains focus (admin returns from a tab).
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated, refresh]);

  const unreadInbox = inbox.reduce((n, item) => (item.read_at ? n : n + 1), 0);

  return (
    <NotificationsContext.Provider
      value={{
        counts, recentPending,
        inbox, unreadInbox,
        markInboxRead, markAllInboxRead,
        refresh, loading, error,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Safe default — components that mount outside the provider get zero
    // counts rather than crashing. (Login page is the main case.)
    return {
      counts: EMPTY, recentPending: [], inbox: [], unreadInbox: 0,
      markInboxRead: async () => {}, markAllInboxRead: async () => {},
      refresh: async () => {}, loading: false, error: null,
    };
  }
  return ctx;
}
