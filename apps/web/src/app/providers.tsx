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

'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/auth-provider';
import { makeQueryClient } from '@/lib/query-client';

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
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
