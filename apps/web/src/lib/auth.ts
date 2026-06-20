// Client-side auth helpers. The pos_session cookie is HttpOnly so we can't read
// it from JS; we use /api/auth/me to verify the session is alive.

import { api, type User } from './api';

export async function fetchMe(): Promise<User | null> {
  try {
    const res = await api.me();
    return res.user;
  } catch {
    return null;
  }
}

export function isAuthed(): boolean {
  // The cookie is HttpOnly; the only signal we have client-side is localStorage
  // flag set by AuthProvider. This is best-effort, not a security boundary.
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('pos:authed') === '1';
}

export function markAuthed() {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('pos:authed', '1');
  }
}

export function clearAuthed() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('pos:authed');
  }
}
