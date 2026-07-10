'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, ToastHost } from '@declutrmail/shared';
import { hasCapability } from '@declutrmail/shared/entitlements';
import { GracePeriodBanner } from '@/features/account-deletion/grace-period-banner';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { CookieConsentBanner } from '@/features/consent/cookie-consent-banner';
import { useTier } from '@/features/auth/api/use-tier';
import { UpgradeModal } from '@/features/billing/upgrade-modal';
import { AccountMenu } from '@/features/mailboxes/account-menu';
import { NoActiveMailbox } from '@/features/mailboxes/no-active-mailbox';
import { useMailboxSyncToasts } from '@/features/mailboxes/use-mailbox-sync-toasts';
import { useOnboardingGate } from '@/features/onboarding/use-onboarding-gate';
import { useScreenerCount } from '@/features/screener/api/use-screener';
import { ScreenerBadge } from '@/features/screener/screener-badge';
import { useSenders } from '@/features/senders/api/use-senders';
import { SyncErrorBanner } from '@/features/sync/sync-error-banner';
import { SyncNowAnimationStyle, SyncNowButton } from '@/features/sync/sync-now-button';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { isFeatureEnabled } from '@/lib/flags';

/**
 * Authed app chrome. Wires the routing-agnostic AppShell to the
 * Next.js router — `active` from the path, `onNavigate` to `router.push`.
 *
 * BRANCH LADDER (U-NAV integration — order is load-bearing):
 *
 *   1. loading            — AuthProvider skeleton while `/api/auth/me`
 *                           is in flight; children never render.
 *   2. unauthed (401)     — AuthProvider bounces to the OAuth start
 *                           endpoint; children never render.
 *   3. auth read error    — AuthProvider's designed failure surface.
 *   4. onboarding gate    — `users.onboarded_at IS NULL` (server truth)
 *                           replaces the route with `/onboarding`
 *                           (D6/D109/D113 strict gate). Sits ABOVE the
 *                           no-active-mailbox branch on purpose: a
 *                           mid-onboarding user with zero mailboxes
 *                           belongs at the onboarding connect step, not
 *                           the reconnect gate (`GET /onboarding/state`
 *                           is JwtGuard-only, so it resolves with no
 *                           active mailbox). Fail-open: a failed state
 *                           read never gates — falls through here.
 *   5. no active mailbox  — last mailbox disconnected → full-screen
 *                           reconnect gate instead of a data-less shell.
 *                           EXCEPTION: workspace-scoped routes
 *                           (`/settings`, `/settings/privacy`, `/billing`)
 *                           render through the gate — account deletion
 *                           (D216), data export, and billing/refunds (D121)
 *                           must stay reachable with zero mailboxes.
 *                           Mailbox-scoped subroutes (`/settings/senders`)
 *                           stay gated (see `isUserScopedRoute`).
 *   6. deletion pending   — GracePeriodBanner (D216), mounted ONCE,
 *                           additive: renders above branches 5 + 7 only
 *                           while a deletion request is pending (it is
 *                           user-scoped and must survive zero mailboxes).
 *   7. normal             — AppShell + children.
 *
 * Sender-count chip: derived from the live `useSenders` infinite query
 * (first page) — represents the active mailbox's count + a `+` suffix
 * when there's more data behind the cursor. Hidden until the first
 * page returns so we never flash a stale `0`.
 *
 * Screener badge (D74): `ScreenerBadge` fed by `useScreenerCount`,
 * mounted only for tiers with the `screener` capability (D77) — see
 * the gating comment at the hook call.
 *
 * Account menu (D116 surface — partial): the topbar's right slot
 * carries the switcher / disconnect / connect-another / sign-out menu.
 * The menu reads `useAuth` so the AuthProvider must wrap this layout —
 * it does, right here: since the D134 public-route split, the
 * `(app)` group owns its own AuthProvider (the root `providers.tsx`
 * no longer auth-gates public routes). `AppChrome` is split out so
 * its `useAuth()` call sits BELOW the provider in the tree.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthProvider>
        <AppChrome>{children}</AppChrome>
      </AuthProvider>
      {/* D147 consent ask — outside AuthProvider on purpose: consent is
          auth-independent and must stay answerable through every branch
          of the ladder above (loading skeleton, reconnect gate, normal). */}
      <CookieConsentBanner />
    </>
  );
}

/**
 * Workspace-level routes that stay reachable with NO active mailbox.
 * Account management (deletion + data export, D216) and billing/refunds
 * (D121) are user-scoped, not mailbox-scoped — a user who disconnected
 * their last Gmail must still reach them instead of being trapped on the
 * reconnect gate. `usePathname()` excludes hash/query, so `/settings#account`
 * resolves to `/settings` here.
 *
 * EXACT matches only, never a `/settings/` prefix: mailbox-scoped
 * settings subroutes (`/settings/senders` — standing policies read via
 * the session-scoped `useSenders`) must KEEP the reconnect gate, or they
 * render a dead-end 409 `NO_ACTIVE_MAILBOX` error with no recovery. New
 * user-scoped subroutes are added here explicitly; anything else fails
 * safe to the gate.
 */
function isUserScopedRoute(pathname: string): boolean {
  return pathname === '/settings' || pathname === '/settings/privacy' || pathname === '/billing';
}

function AppChrome({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useAuth();
  const active = pathname.split('/')[1] || 'senders';
  const hasActiveMailbox = me.activeMailboxId != null;
  const userScopedRoute = isUserScopedRoute(pathname);

  // In-app "B is ready" toast when a background sync finishes (D116).
  useMailboxSyncToasts();

  // Returning-user strict onboarding gate (D6/D109/D113) — ladder #4.
  const onboardingGate = useOnboardingGate();

  // First page is enough — the chip is a hint, not an inventory. Gated
  // off when there's no active mailbox so it can't 409.
  const senders = useSenders({ limit: 50, enabled: hasActiveMailbox });
  const firstPage = senders.data?.pages[0];
  const sendersCount =
    firstPage === undefined
      ? undefined
      : firstPage.meta.pagination.hasMore
        ? `${firstPage.data.length}+`
        : firstPage.data.length;

  // Screener badge (D74) — Screener is Pro-only (D77), so the count
  // query is gated on the tier capability: a Free/Plus session must
  // NEVER fire a request the server would 402 (a read 4xx is a
  // designed state, never an error surface or a retry — §8). Also
  // gated on an active mailbox (`CurrentMailboxGuard` 409s without
  // one — same rule as the senders chip). On any error the badge is
  // simply absent (`retry: false` in the hook); a nav hint has no
  // error state.
  const { tier } = useTier();
  const screenerUnlocked = hasCapability(tier, 'screener');
  const screenerCount = useScreenerCount({ enabled: screenerUnlocked && hasActiveMailbox });
  const screenerPending = screenerUnlocked ? screenerCount.data?.pending : undefined;

  // Onboarding incomplete — `useOnboardingGate` has already issued
  // `router.replace('/onboarding')`; render nothing while it lands so
  // no half-authed screen flashes behind the redirect.
  if (onboardingGate.gating) {
    return null;
  }

  // No active mailbox: hold until onboarding state SETTLES before
  // deciding. Without this, an onboarding-incomplete user with zero
  // mailboxes flashes the reconnect gate during the onboarding-state
  // round-trip (branch #4's `gating` is false while that read is in
  // flight) before the gate redirects them to /onboarding. Fail-open:
  // on a failed read `resolving` is false, so we fall through.
  if (!hasActiveMailbox && onboardingGate.resolving) {
    return null;
  }

  // No active mailbox (last one disconnected) — take over with the
  // reconnect gate instead of rendering a broken, data-less shell. The
  // grace banner still mounts: deletion status is user-scoped and this
  // is its only chrome surface when no mailbox is connected.
  //
  // EXCEPTION: user-scoped routes (settings / billing) fall through to
  // the shell below so account deletion + data export (D216) and
  // billing/refunds (D121) stay reachable with zero mailboxes. The
  // mailbox-scoped chrome (SyncErrorBanner, SyncNowButton) is gated off
  // in that render so no session-scoped read 409-storms (§8).
  if (!hasActiveMailbox && !userScopedRoute) {
    return (
      <>
        <GracePeriodBanner />
        <NoActiveMailbox />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <SyncNowAnimationStyle />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <GracePeriodBanner />
        {/* Passive incremental-sync failure surface (D224). Active-mailbox
            ONLY — its session-scoped status poll 409-storms without one, so
            it stays off on the user-scoped-route fallback (settings/billing
            rendered with no active mailbox). */}
        {hasActiveMailbox && <SyncErrorBanner />}
        <div style={{ flex: 1, minHeight: 0 }}>
          <AppShell
            active={active}
            onNavigate={(id) => router.push(`/${id}`)}
            counts={{
              ...(sendersCount === undefined ? {} : { senders: sendersCount }),
              // Element badge — the sidebar renders it as-is, so the
              // D74 pulse + aria-label + hide-at-zero all apply.
              ...(screenerPending === undefined
                ? {}
                : { screener: <ScreenerBadge count={screenerPending} /> }),
            }}
            topbarRight={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {isFeatureEnabled('darkMode') && <ThemeToggle />}
                {/* Same 409-storm guard as SyncErrorBanner — the button
                    polls session-scoped sync status, meaningless (and
                    unresolvable) with no active mailbox. */}
                {hasActiveMailbox && <SyncNowButton />}
                <AccountMenu />
              </div>
            }
          >
            {children}
          </AppShell>
        </div>
      </div>
      {/* D19/D77/D81 — entitlement-402 upgrade flow. Mounted ONCE in
          the authed chrome; fed by the global MutationCache handler
          (lib/query-client) so every mutation surface is covered. */}
      <UpgradeModal />
      <ToastHost />
    </>
  );
}
