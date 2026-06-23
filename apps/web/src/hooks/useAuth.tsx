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
    // Bump a guard so the layout's redirect useEffect doesn't double-fire
    // on the same render. Without this, the layout sees `!user` mid-render
    // and races our own `router.push('/login')` here, producing an
    // intermittent "Terjadi kesalahan" page on the first click.
    setLoading(true);
    try {
      await api.logout();
    } catch {
      // ignore — we still clear local state. Server may already be
      // gone (network blip, expired tab) and we don't want to strand
      // the user.
    }
    setUser(null);
    clearAuthed();
    // Keep loading=true so the layout's `if (!user) router.replace`
    // effect owns the navigation — this avoids two near-simultaneous
    // router calls clashing in Next 16's App Router.
    router.replace('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
