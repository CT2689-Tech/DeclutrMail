// Server boundary for the authed `(app)` group (Option A′, founder
// 2026-08-14 — docs/execution/static-marketing-csp-options-2026-08-14.md).
//
// Exists because the two per-request reads that used to live in the root
// layout had to leave it: reading `headers()` at the root opts EVERY
// route — all 34 public pages included — out of static prerendering.
// They land here instead, above the client chrome, because this group is
// authed and dynamic regardless.
//
//   NONCE (D175). This group keeps the strict CSP: nonce +
//     'strict-dynamic'. Under 'strict-dynamic' CSP3 browsers ignore
//     host-source expressions, so 'self' authorizes nothing — the theme
//     script executes ONLY because it carries the nonce. Reading it here
//     is also what makes Next stamp its own framework scripts, so this
//     read is load-bearing twice over.
//   BILLING RAIL (D117). The tier gate, the upgrade modal, the Autopilot
//     entitlement nudge and the plan strip all quote a price through
//     `useRegionProvider`. Seeded server-side so first paint already
//     names the rail the visitor will be charged on — a client-side
//     resolve would flash USD and correct itself.
//
// `(app)/billing/page.tsx` reads the same header for its own picker; the
// two agree because they read one header through one helper.

import type { ReactNode } from 'react';
import { headers } from 'next/headers';

import { BillingCurrencyProvider } from '@/features/billing/billing-currency';
import { defaultProviderForCountry } from '@/features/billing/billing-region';
import { ServerAuthBoundary } from '@/features/auth/server-auth-boundary';
import { ThemeScript } from '@/features/theme/theme-script';
import { COUNTRY_HEADER } from '@/middleware';

import { AppChromeLayout } from './app-chrome-layout';

/**
 * Origin of the API, when it is a DIFFERENT one from the web app
 * (production: Vercel → Cloud Run). `null` same-origin, which is local
 * dev and needs no warm-up.
 */
function crossOriginApi(): string | null {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  const regionProvider = defaultProviderForCountry(requestHeaders.get(COUNTRY_HEADER));
  const apiOrigin = crossOriginApi();
  const cookieHeader = requestHeaders.get('cookie') ?? '';

  return (
    <>
      {/* Warm DNS + TCP + TLS to the API. Authed screens still issue
          client fetches for anything the server did not seed (today-
          summary, filtered `/senders`, seed misses). On a
          cross-origin API those pay a full connection setup; doing it
          here overlaps that handshake with HTML generation.

          `preconnect` and NOT `preload`: a preload would have to match
          the eventual fetch's credentials mode and headers exactly or
          the browser issues a SECOND request. Warming the connection has
          no such matching rule, so it cannot double-fetch. */}
      {apiOrigin !== null && (
        <>
          <link rel="preconnect" href={apiOrigin} crossOrigin="use-credentials" />
          <link rel="dns-prefetch" href={apiOrigin} />
        </>
      )}
      <ThemeScript nonce={nonce} />
      <BillingCurrencyProvider provider={regionProvider}>
        <ServerAuthBoundary cookieHeader={cookieHeader}>
          <AppChromeLayout>{children}</AppChromeLayout>
        </ServerAuthBoundary>
      </BillingCurrencyProvider>
    </>
  );
}
