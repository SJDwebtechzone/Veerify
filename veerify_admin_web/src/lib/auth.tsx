import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin';
  avatar?: string;
}

interface AuthContextValue {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
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
        id: userData.id,
        email: userData.email,
        name: userData.name,
        role: 'super_admin',
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

  return (
    <AuthContext.Provider value={{ user,  isLoading,isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}