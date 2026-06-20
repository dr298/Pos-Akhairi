'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type User } from '@/lib/api';
import { clearAuthed, isAuthed, markAuthed } from '@/lib/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // Sprint 5.5b — switch active branch. Calls /api/auth/me/branch, then
  // refreshes the user object so role/branchId update.
  switchBranch: (branchId: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    // Skip the /api/auth/me round-trip on public pages (login, etc.) where
    // we know there's no session — avoids a 401 in the browser console.
    if (!isAuthed()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.me();
      setUser(res.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        clearAuthed();
        return;
      }
      setUser(null);
      clearAuthed();
      console.error('Auth refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      setUser(res.user);
      markAuthed();
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore — we still clear local state
    }
    setUser(null);
    clearAuthed();
    router.push('/login');
  }, [router]);

  const switchBranch = useCallback(async (branchId: string) => {
    await api.switchBranch(branchId);
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, switchBranch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
