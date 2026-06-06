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

interface NotificationsContextValue {
  counts: OnboardingCounts;
  recentPending: RecentPending[];
  refresh: () => Promise<void>;
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
      const res = await apiClient.get('/onboarding/counts');
      setCounts({ ...EMPTY, ...(res.data.counts || {}) });
      setRecentPending(res.data.recent_pending || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setCounts(EMPTY);
      setRecentPending([]);
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

  return (
    <NotificationsContext.Provider value={{ counts, recentPending, refresh, loading, error }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Safe default — components that mount outside the provider get zero
    // counts rather than crashing. (Login page is the main case.)
    return { counts: EMPTY, recentPending: [], refresh: async () => {}, loading: false, error: null };
  }
  return ctx;
}
