'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { ErrorState } from '@declutrmail/shared';

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

/** Resolve the mailbox that every action and deep link on the current screen targets. */
export function getActiveMailboxEmail(me: Me): string {
  return me.mailboxes.find((mailbox) => mailbox.id === me.activeMailboxId)?.email ?? me.user.email;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() requires <AuthProvider> in the tree.');
  }
  return ctx;
}

/**
 * Read the authenticated mailbox context when a component can also be
 * rendered in isolation (tests, stories, and public demos). Production app
 * surfaces still live under `<AuthProvider>`; the nullable form simply keeps
 * reusable confirmation dialogs from inventing an account in those isolated
 * environments.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();

  // A revoked session is the one failure that must NOT keep rendering off a
  // cached identity. The redirect itself is NOT done here: `apiGet`'s own
  // terminal-401 handling (`client.ts`'s `redirectToLogin`, guarded against
  // stacking navigations) already fired before this error ever reached
  // `useMe` — a second, unguarded `window.location.assign` here duplicated
  // that real external navigation on every re-render while the 401
  // persisted (QA-onboarding-20260828-02: 2-3 live hits to Google's OAuth
  // start per session-expiry event, one of which tripped the API's own
  // rate limiter). Render the skeleton and let the in-flight redirect land.
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <AuthSkeleton />;
  }

  // A failed REFRESH is not a failed session. TanStack keeps `data` when a
  // refetch rejects, so reaching here with `me.data` means we already
  // resolved this session and only the latest re-read failed — the app is
  // entirely usable, and `useMe` is already retrying in the background.
  //
  // This branch used to read `if (me.error || !me.data)`, which threw a
  // valid session away the moment any background re-read failed. That is
  // what turned a client-side cache defect into a dead app on 2026-08-21:
  // deleting a sender invalidates `me` to re-read the cleanup quota, that
  // refetch rejected, and a screen full of working data was replaced by
  // "Auth check failed." A transient 5xx or a dropped connection did the
  // same thing. Blank the app only when there is genuinely no session.
  if (me.data) {
    return <AuthContext.Provider value={{ me: me.data }}>{children}</AuthContext.Provider>;
  }

  if (me.isPending) {
    return <AuthSkeleton />;
  }

  return <AuthUnavailable onRetry={() => void me.refetch()} />;
}

/**
 * The no-session failure surface — reached only when `me` has never
 * resolved and the last attempt failed.
 *
 * It is a real, recoverable state, not a dead end: `useMe` keeps retrying
 * every {@link ME_ERROR_RETRY_MS} and on the next window focus, so a
 * transient API failure clears itself; the button is for the user who does
 * not want to wait. The previous version offered neither, so anything that
 * reached it stayed there until someone thought to reload.
 *
 * The copy is fixed rather than derived from the error, per `ErrorState`'s
 * contract. Rendering `error.message` is how a TanStack internal —
 * `Missing queryFn: '["auth","me"]'` — ended up as the founder's UI on
 * 2026-08-21. The detail belongs in Sentry (the `makeQueryClient`
 * QueryCache reporter), never on screen.
 */
function AuthUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--color-bg, #fff)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <ErrorState
          title="We couldn't load your account"
          description="This is usually a brief connection problem. We're retrying automatically — you can also try again now."
          onRetry={onRetry}
        />
      </div>
    </div>
  );
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
