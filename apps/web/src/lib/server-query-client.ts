import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { QueryClient } from '@tanstack/react-query';

import { ServerApiError } from '@/lib/api/server';

export function makeServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function isDesignedPrefetchFailure(error: unknown): boolean {
  if (!(error instanceof ServerApiError)) return false;
  if (error.status >= 400 && error.status < 500) return true;
  const body = error.body as { error?: { code?: unknown } } | undefined;
  return error.status === 503 && body?.error?.code === 'BILLING_DISABLED';
}

export async function settleServerQueries(
  surface: string,
  queries: Array<Promise<unknown>>,
): Promise<void> {
  const results = await Promise.allSettled(queries);

  for (const result of results) {
    if (result.status !== 'rejected') continue;
    if (isDesignedPrefetchFailure(result.reason)) continue;

    const message =
      result.reason instanceof Error ? result.reason.message : 'Unknown server query error';
    console.warn(
      `[server-hydration] ${surface} prefetch failed; falling back to the client query.`,
      message,
    );
    Sentry.captureException(result.reason instanceof Error ? result.reason : new Error(message), {
      tags: { surface: 'server-hydration', hydration_surface: surface },
    });
  }
}
