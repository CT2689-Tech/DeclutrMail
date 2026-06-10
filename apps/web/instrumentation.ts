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

import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
