import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  projectIds: string[];
  login: (identity: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api<{ user: User; projectIds: string[] }>('/api/auth/me');
      setUser(response.user);
      setProjectIds(response.projectIds);
    } catch {
      setToken(null);
      setUser(null);
      setProjectIds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (identity: string, password: string) => {
    const response = await api<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ identity, password }),
    });
    setToken(response.token);
    setUser(response.user);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api<void>('/api/auth/logout', { method: 'POST' }); } catch { /* session may already be gone */ }
    setToken(null);
    setUser(null);
    setProjectIds([]);
  }, []);

  const value = useMemo(() => ({ user, loading, projectIds, login, logout, refresh }), [user, loading, projectIds, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
