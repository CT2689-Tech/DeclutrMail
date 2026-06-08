// Sentry browser init (D159 + ADR-0021 source-map upload via
// withSentryConfig). Loaded automatically by Next.js 15's client
// instrumentation hook — do NOT import this file from app code.
//
// Filename convention: `instrumentation-client.ts` at the apps/web
// root. Was `sentry.client.config.ts` under the old (Next 13)
// convention; Next 15 + Turbopack only resolve the new filename.
//
// Privacy posture (D7 / D228) — IDENTICAL to the prior lib/sentry.ts
// bootstrap that this file replaces:
//
//   - **Session Replay is OFF.** Replay snapshots the DOM, which on
//     DeclutrMail's surfaces would mean rendered subject lines and
//     snippets. Hard off (`replaysSessionSampleRate: 0` AND
//     `replaysOnErrorSampleRate: 0`).
//   - Captures EXCEPTIONS ONLY (`tracesSampleRate: 0`).
//   - `beforeSend` + `beforeBreadcrumb` run every event through the
//     shared `scrubTelemetryPayload` so banned keys (body / html / text /
//     snippet / payload / mime / attachment / parts / raw) are stripped.
//   - PII auto-collection (`sendDefaultPii`) is OFF.
//   - `integrations: []` — do NOT auto-register Replay, BrowserTracing,
//     ContextLines, or any default integration that could capture page
//     state. Each integration must be opt-in after privacy review.
//
// DSN gate: when `NEXT_PUBLIC_SENTRY_DSN` is unset, `Sentry.init` is a
// silent no-op — local dev w/o DSN never ships an event.

import * as Sentry from '@sentry/nextjs';
import { scrubTelemetryPayload } from '@declutrmail/shared/observability';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    integrations: [],
    beforeSend: (event) =>
      scrubTelemetryPayload(event as unknown as Record<string, unknown>) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) =>
      scrubTelemetryPayload(
        breadcrumb as unknown as Record<string, unknown>,
      ) as unknown as typeof breadcrumb,
  });
}

/**
 * Next 15 / App Router navigation instrumentation hook (Sentry 10+).
 *
 * The Sentry SDK requires this export from `instrumentation-client.ts`
 * to know when an App-Router transition starts so it can begin a
 * navigation transaction. Without it, the Vercel build logs an
 * `ACTION REQUIRED` warning per build (visible in the 2026-06-08
 * build trace) and client-side navigation events go unobserved.
 *
 * Privacy posture is unchanged — this hook only delimits transaction
 * boundaries; it does NOT add new captures. `tracesSampleRate: 0`
 * above means no actual trace is sent either way; the hook just
 * silences the warning + leaves the door open for future opt-in.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
