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

/**
 * Shell-shaped loading skeleton (2026-07-10): the previous skeleton was
 * an empty full-viewport div — a cold load showed a blank page for the
 * whole `/api/auth/me` round trip and read as "broken", not "loading".
 * This one sketches the real chrome (sidebar rail + topbar + content
 * ghosts) with a subtle pulse so the first paint is recognizably the
 * app. Layout mirrors AppShell's proportions; token-driven colors keep
 * it correct in dark mode.
 */
function AuthSkeleton() {
  const ghost = (height: number, width: string | number = '100%'): React.CSSProperties => ({
    height,
    width,
    borderRadius: 8,
    background: 'var(--color-line-soft, rgba(20,30,50,0.07))',
  });
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="auth-skeleton"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        background: 'var(--color-bg, #fff)',
      }}
    >
      <style>{`@keyframes dm-skeleton-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }`}</style>
      <span style={{ position: 'absolute', left: -9999 }}>Loading session…</span>
      {/* Sidebar rail — hidden on narrow viewports like the real shell. */}
      <div
        aria-hidden
        style={{
          width: 228,
          flexShrink: 0,
          borderRight: '1px solid var(--color-line, rgba(20,30,50,0.08))',
          padding: '20px 14px',
          display: 'none',
          flexDirection: 'column',
          gap: 14,
          animation: 'dm-skeleton-pulse 1.6s ease-in-out infinite',
        }}
        className="dm-skeleton-sidebar"
      />
      <style>{`@media (min-width: 768px) { .dm-skeleton-sidebar { display: flex !important; } }`}</style>
      <div
        aria-hidden
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          animation: 'dm-skeleton-pulse 1.6s ease-in-out infinite',
        }}
      >
        {/* Topbar strip. */}
        <div
          style={{
            height: 48,
            borderBottom: '1px solid var(--color-line, rgba(20,30,50,0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 20px',
          }}
        >
          <div style={ghost(20, 180)} />
        </div>
        {/* Content ghosts — heading + three card rows. */}
        <div
          style={{
            padding: '28px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxWidth: 920,
          }}
        >
          <div style={ghost(28, 260)} />
          <div style={ghost(64)} />
          <div style={ghost(88)} />
          <div style={ghost(88)} />
          <div style={ghost(88)} />
        </div>
      </div>
    </div>
  );
}
