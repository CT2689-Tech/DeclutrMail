// App-wide client providers (D200).
//
// Owns the QueryClient on the browser. The server gets a fresh client
// per request (via `makeQueryClient()` in any RSC that prefetches);
// the browser memoizes a single instance for the page lifetime so
// caches survive navigation between client routes.
//
// Why the memo dance: Next.js App Router can re-render the root layout
// during fast-refresh and during streaming. A naïve `new QueryClient()`
// at module scope would create the client at import time on the
// server, leaking state across requests. A `useState` keeps the
// browser client stable while letting the server stay request-scoped.
//
// Auth is NOT here (D134 public-route split): `AuthProvider` blocks on
// `GET /api/auth/me`, so it wraps only the authed surfaces — the
// `(app)` route-group layout and `/onboarding`'s layout. Public routes
// (the `(marketing)` group, 404, error boundaries) render without any
// auth round-trip.
//
// The billing rail (D117) is NOT here either, for the same shape of
// reason (Option A′, founder 2026-08-14): sourcing it means reading the
// edge geo header, and reading it at the root forces every route
// dynamic. Each surface that quotes a price now mounts its own
// `BillingCurrencyProvider` — `(app)/layout.tsx` for the in-app price
// surfaces, `/` and `/pricing` for the two public ones. Anywhere else,
// `useRegionProvider`'s own default (Paddle, the always-provisioned
// international rail) applies, which is what a page with no price shows
// anyway.

'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { makeQueryClient } from '@/lib/query-client';

const PageLoadObservability = dynamic(
  () => import('@/lib/page-load-observability').then((module) => module.PageLoadObservability),
  { ssr: false },
);

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always make a new client per request.
    return makeQueryClient();
  }
  // Browser: reuse the same client across React's render cycles so
  // navigation doesn't drop the cache.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <PageLoadObservability />
    </QueryClientProvider>
  );
}
