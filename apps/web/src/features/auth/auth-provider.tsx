'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { ApiError } from '@/lib/api/client';
import { useMe, type Me } from './api/use-me';

/**
 * AuthProvider (D155 client side).
 *
 * Wraps the authenticated app and exposes the current `Me` payload
 * (user + mailboxes + activeMailboxId) to descendants via `useAuth()`.
 *
 * Unauthenticated handling: when `GET /api/auth/me` returns 401 the
 * provider redirects the browser to `/api/auth/google/start` so the
 * user lands in the OAuth consent flow. The redirect is `window.
 * location.assign` (not `router.push`) because the API base may be
 * cross-origin in production — the absolute redirect avoids a Next
 * router warning.
 *
 * The loading skeleton is intentionally minimal — the `useMe` query
 * has a 60s staleTime so navigation between authed routes never
 * re-renders the skeleton.
 */

interface AuthContextValue {
  me: Me;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() requires <AuthProvider> in the tree.');
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isLoading) {
    return <AuthSkeleton />;
  }

  if (me.error instanceof ApiError && me.error.status === 401) {
    if (typeof window !== 'undefined') {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
      window.location.assign(`${apiBase}/api/auth/google/start`);
    }
    return <AuthSkeleton />;
  }

  if (me.error || !me.data) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Auth check failed.</h1>
        <p style={{ color: '#666' }}>{me.error?.message ?? 'Unknown error.'}</p>
      </div>
    );
  }

  return <AuthContext.Provider value={{ me: me.data }}>{children}</AuthContext.Provider>;
}

function AuthSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-bg, #fff)',
      }}
    >
      <span style={{ position: 'absolute', left: -9999 }}>Loading session…</span>
    </div>
  );
}
