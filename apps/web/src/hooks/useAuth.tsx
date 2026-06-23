'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
    // Strategy: hard-navigate to /login via window.location instead of
    // router.replace. Three reasons:
    //
    // 1. The /pos tree (PrinterProvider, useWebSocket, useBarcodeScanner,
    //    useDrawerKick, ongoing fetch polls) is mid-tear-down. Even with
    //    setLoading(true) gating the layout's redirect, some cleanup
    //    still fires, and any throw in cleanup bubbles to global-error
    //    → "Terjadi kesalahan" flashes for <1s.
    //
    // 2. A hard nav gives us a clean React tree on /login. No leftover
    //    WebSocket reconnect timers, no in-flight /api/me calls, no
    //    stuck loading states. The cookie is already gone (we deleted
    //    it on the server above), so /login renders immediately.
    //
    // 3. Browser back button after logout can't return to the
    //    just-logged-out POS — there's no entry in the new history
    //    stack pointing to /pos.
    //
    // The 300-500ms reload is a fair trade for zero flash.
    try {
      await api.logout();
    } catch {
      // ignore — local state still gets cleared
    }
    clearAuthed();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

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
