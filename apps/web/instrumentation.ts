// Next.js 13.4+ Instrumentation Hook — runtime entry point that Next
// invokes ONCE per worker boot (server cold-start, edge cold-start).
// Routes to the runtime-specific Sentry init based on `NEXT_RUNTIME`.
// The browser config (`sentry.client.config.ts`) is loaded by Sentry's
// build plugin, not here.
//
// Required filename + location (`apps/web/instrumentation.ts`) per
// Next.js docs — DO NOT rename or relocate.
//
// `onRequestError` is the Sentry-recommended hook that captures
// uncaught errors from React Server Components + route handlers and
// forwards them to Sentry with the correct request context. Without
// it, RSC throws go to Next's default error handler and never reach
// Sentry.

import type * as Sentry from '@sentry/nextjs';
import { isStreamedQueryRecoveryError } from './src/lib/streamed-query-recovery';

export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
    if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
  } catch {
    // Optional telemetry must not abort Next.js bootstrap, even on chunk-load failure.
    console.warn(JSON.stringify({ level: 'warn', kind: 'sentry.init_failed' }));
  }
}

export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): Promise<void> {
  // Only the fixed marker from an already-classified optional stream.
  // All unrelated render/route errors continue through normal reporting.
  if (isStreamedQueryRecoveryError(args[0])) return;
  try {
    const sdk = await import('@sentry/nextjs');
    await sdk.captureRequestError(...args);
  } catch {
    // Do not replace the original application error or disclose SDK error details.
    console.warn(JSON.stringify({ level: 'warn', kind: 'sentry.capture_failed' }));
  }
}
