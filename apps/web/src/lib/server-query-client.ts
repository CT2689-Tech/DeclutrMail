import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { QueryClient } from '@tanstack/react-query';

import { ServerApiError } from '@/lib/api/server';

export type ServerHydrationSurface =
  | 'activity'
  | 'admin-security'
  | 'app-shell'
  | 'autopilot'
  | 'billing'
  | 'billing-invoices'
  | 'brief'
  | 'followups'
  | 'later'
  | 'onboarding'
  | 'onboarding-step'
  | 'quiet'
  | 'screener'
  | 'sender-detail'
  | 'senders'
  | 'settings'
  | 'settings-privacy'
  | 'triage';

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
  surface: ServerHydrationSurface,
  queries: Array<Promise<unknown>>,
): Promise<void> {
  if (queries.length === 0) return;
  const startedAt = performance.now();
  const results = await Promise.allSettled(queries);
  let designedFailureCount = 0;
  let unexpectedFailureCount = 0;

  for (const result of results) {
    if (result.status !== 'rejected') continue;
    if (isDesignedPrefetchFailure(result.reason)) {
      designedFailureCount += 1;
      continue;
    }
    unexpectedFailureCount += 1;

    const message =
      result.reason instanceof Error ? result.reason.message : 'Unknown server query error';
    console.warn(
      `[server-hydration] ${surface} prefetch failed; falling back to the client query.`,
      message,
    );
    try {
      Sentry.captureException(result.reason instanceof Error ? result.reason : new Error(message), {
        tags: { surface: 'server-hydration', hydration_surface: surface },
      });
    } catch {
      // Optional telemetry must never turn a recoverable prefetch fallback
      // into a failed page render.
    }
  }

  console.info(
    JSON.stringify({
      level: 'info',
      event: 'server_hydration.prefetch',
      surface,
      duration_ms: Math.round((performance.now() - startedAt) * 1_000) / 1_000,
      query_count: results.length,
      designed_failure_count: designedFailureCount,
      unexpected_failure_count: unexpectedFailureCount,
    }),
  );
}
