import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin';
  avatar?: string;
  // Path (relative or absolute) of the logo uploaded via My Profile.
  // Rendered as the navbar avatar; falls back to initials when null.
  org_logo_url?: string | null;
}

interface AuthContextValue {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  // Re-fetch /auth/me and update the cached user. Called by the My Profile
  // editor after a successful save so the Dashboard greeting + navbar
  // avatar pick up the new owner name without requiring a re-login.
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const USER_KEY = 'veerify-admin-user';
const TOKEN_KEY = 'veerify-admin-token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? (JSON.parse(stored) as AdminUser) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && user) {
        try {
          const res = await api.get('/auth/me');
          const userData = res.data.user || res.data;
          if (userData.role === 'super_admin') {
            setUser({
              id:           userData.id,
              email:        userData.email,
              name:         userData.name,
              role:         'super_admin',
              org_logo_url: userData.org_logo_url || null,
            });
          } else {
            setUser(null);
          }
        } catch (err) {
          console.error('Failed to verify token', err);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setIsLoading(false);
    }
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [user]);

  const login = async (
    email: string,
    password: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const res = await api.post('/auth/login', { email, password });
      const { token, user: userData } = res.data;

      // Only allow super_admin
      if (userData.role !== 'super_admin') {
        return {
          ok: false,
          error: 'Access denied. Super Admin credentials required.',
        };
      }

      // ← THIS IS THE KEY LINE — saves token for API calls
      localStorage.setItem(TOKEN_KEY, token);

      const adminUser: AdminUser = {
        id:           userData.id,
        email:        userData.email,
        name:         userData.name,
        role:         'super_admin',
        org_logo_url: userData.org_logo_url || null,
      };

      setUser(adminUser);
      return { ok: true };
    } catch (err: any) {
      const message =
        err.response?.data?.message || 'Login failed. Please try again.';
      return { ok: false, error: message };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  // Pull the latest user row from /auth/me and merge into our context
  // state. Used by My Profile after a successful save.
  const refresh = async () => {
    try {
      const res = await api.get('/auth/me');
      const u = res.data?.user || res.data;
      if (u && u.role === 'super_admin') {
        setUser({
          id:           u.id,
          email:        u.email,
          name:         u.name,
          role:         'super_admin',
          org_logo_url: u.org_logo_url || null,
        });
      }
    } catch (err) {
      console.warn('[auth] refresh failed', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}