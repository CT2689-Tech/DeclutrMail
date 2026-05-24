/**
 * Test wrapper that mounts a fresh `QueryClient` per test.
 *
 * Each test gets its own client so cache state from one case doesn't
 * leak into the next. Retries are disabled in tests for speed — the
 * production `makeQueryClient` keeps default retries but we want
 * deterministic test runs.
 */

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        // Keep cached results alive for the duration of a test —
        // `gcTime: 0` made `fetchNextPage` race with eviction.
        gcTime: 1000 * 60,
      },
      mutations: { retry: false },
    },
  });
}

export function QueryWrapper({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
