import {
  scrubSentryEvent,
  scrubSentryLog,
  scrubSentryTransaction,
  scrubSentryBreadcrumb,
} from '@declutrmail/shared/observability';

/**
 * Sentry server bootstrap (D159).
 *
 * Gated entirely on `SENTRY_DSN`. With no DSN, this module installs
 * nothing — no SDK calls, no global side effects, no error swallowing
 * — so local dev (and the test suite) run unaffected.
 *
 * Privacy posture (D7, D228):
 *   - Captures exceptions, plus one closed message
 *     (`llm.provider_rejected`) when the LLM breaker trips. Sanitized sampled
 *     traces and closed operational logs are enabled; no profiling or replay (server-side replay
 *     doesn't exist, but the principle stands: opt out of anything
 *     that could carry user data).
 *   - `beforeSend` runs every event through the shared scrubber, which
 *     strips body / snippet / attachment / non-allowlisted header keys
 *     wherever they appear in the event tree.
 *   - PII auto-collection is off via `dataCollection` (v11 removed
 *     `sendDefaultPii`; an omitted `dataCollection` collects bodies
 *     and model prompts).
 *
 * The SDK is loaded via dynamic `import()` so unconfigured envs incur
 * zero startup cost (the @sentry/node bundle is large).
 */

let initialized = false;
let readySdk: typeof import('@sentry/node') | undefined;
let pendingInit: Promise<boolean> | undefined;

/**
 * Bound asynchronous SDK loading to five seconds. The Docker entrypoint already
 * preloads @sentry/node/import before the application graph to avoid the historic
 * late instrumentation hang. This deadline handles a stalled asynchronous import;
 * it cannot interrupt synchronous code that blocks the JavaScript event loop.
 * A late successful initialization remains available to worker observers.
 */
const SENTRY_INIT_TIMEOUT_MS = 5_000;

/**
 * Parse a `0..1` sample rate from the environment, falling back on
 * anything unparseable.
 *
 * Deliberately strict: an unset, malformed, or out-of-range value returns
 * the DEFAULT rather than clamping toward 1. A typo in a Cloud Run env var
 * should not silently turn full-rate tracing on — the failure mode of this
 * knob is a quota bill, and the safe direction is down.
 */
function readSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

export async function initSentry(): Promise<boolean> {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false; // local dev / unconfigured — no-op silently

  pendingInit ??= (async () => {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.SENTRY_RELEASE,
      // Tracing (D159, founder-authorised 2026-08-18). Off since D7 until
      // now: a span carries more user data by default than any other
      // signal. It ships behind `beforeSendTransaction` below, which drops
      // every span description and key-allowlists span data — see
      // `scrubSentryTransaction`.
      //
      // The 2026-06-08 boot hang this file's timeout guards against was an
      // OTel-init ordering problem, and its documented fix (preload
      // `@sentry/node/import` BEFORE `@swc-node/register`) is now live in
      // the Dockerfile CMD, so tracing no longer rides on that mismatch.
      // Sentry 11 streams spans by default and ignores
      // `beforeSendTransaction` unless the lifecycle stays static.
      //
      // Rate is env-tunable and deliberately not 1.0: the worker runs cron
      // jobs on 60s/5min ticks, so full sampling is mostly duplicate shapes.
      // 0.2 keeps the span quota (5M/month, 0 used at the 2026-08-18
      // incident) irrelevant while still catching a runaway loop, which
      // shows up as shape rather than as any single trace.
      tracesSampleRate: readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.2),
      traceLifecycle: 'static',
      // The LOGS channel (D159, 2026-08-18). Notices that are not crashes
      // — `dead_letter.parked`, the CAN-SPAM postal refusal — belong here,
      // not on the errors quota, which is the only Sentry budget that runs
      // out: errors sat at 4,000/5,000 while logs sat at 0 of 5 GB.
      //
      // v11 removed `enableLogs`. `Sentry.logger.*` still sends, and
      // `beforeSendLog` below is what scrubs that channel.
      // `defaultIntegrations: false` still stands, which is what keeps
      // the worker bootstrap from hanging (see the comment on
      // `integrations`).
      // v11 replaced `sendDefaultPii: false`. Omitted fields collect
      // bodies, headers, and model prompts. This is the v10 baseline.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        graphQL: { document: false, variables: false },
      },
      // CRITICAL (2026-06-08 session): `@sentry/node` default
      // integrations monkey-patch already-loaded modules (Express, http,
      // postgres, ioredis) when `Sentry.init` runs after the worker's
      // top-of-file imports. That hung Cloud Run worker revision
      // 00012-13 at `initSentry_begin`. `defaultIntegrations: false`
      // keeps that opt-out. The one integration added below is Anthropic
      // auto-capture, which rides the `/import` diagnostics channels
      // instead of a late monkey-patch. Manual `captureException` is
      // unchanged.
      defaultIntegrations: false,
      // Anthropic auto-capture stays on (spans for model, tokens, latency).
      // Prompt and response text stay off: `recordInputs` / `recordOutputs`
      // override `dataCollection.genAI`, and mailbox text must not ride
      // along. The `/import` hook has to load before the SDK or this
      // integration never sees the diagnostics channels.
      integrations: [
        Sentry.anthropicAIIntegration({
          recordInputs: false,
          recordOutputs: false,
        }),
      ],
      // Defense-in-depth privacy scrub on every outbound event.
      // `scrubSentryEvent('server')` REBUILDS the event from approved
      // fields (deny-by-default, same machinery as the browser path)
      // rather than deleting known-bad keys: `Error.message` is omitted
      // outright, so a future `throw new Error(subject)` cannot ship
      // content to Sentry (privacy sweep 2026-07-28). The server
      // profile keeps the worker/policy/job_id/mailbox/kind triage
      // tags the D159 workflow depends on.
      beforeSend: (event) =>
        scrubSentryEvent(event as unknown as Record<string, unknown>, 'server') as unknown as
          typeof event | null,
      // `beforeSend` does NOT run on logs. Without this hook the logs
      // channel would be a SECOND, unscrubbed egress path to Sentry — and
      // a log's `message` is free text, the same hazard `Error.message` is
      // stripped for. `scrubSentryLog` reconstructs the message from an
      // allowlisted `kind`, so a log's text can only ever be one of a
      // closed set of strings.
      beforeSendLog: (log) =>
        scrubSentryLog(log as unknown as Record<string, unknown>) as unknown as typeof log | null,
      // `beforeSend` does NOT run on transactions either — this is the
      // THIRD egress path, and the widest one: a transaction carries a
      // whole span tree, each span with a free-text description (raw SQL,
      // full request URLs) and arbitrary `data`. `scrubSentryTransaction`
      // drops descriptions outright and key-allowlists the rest, keeping
      // only the tree's shape.
      beforeSendTransaction: (event) =>
        scrubSentryTransaction(event as unknown as Record<string, unknown>, 'server') as unknown as
          typeof event | null,
      beforeSendMetric: () => null,
      beforeBreadcrumb: (breadcrumb) =>
        scrubSentryBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as unknown as
          typeof breadcrumb | null,
    });
    readySdk = Sentry;
    initialized = true;
    return true;
  })().catch(() => {
    // Closed diagnostic only: SDK errors can contain credentials or request data.
    console.warn(JSON.stringify({ level: 'warn', kind: 'sentry.init_failed' }));
    pendingInit = undefined;
    return false;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pendingInit,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'sentry.init_timeout',
              timeoutMs: SENTRY_INIT_TIMEOUT_MS,
            }),
          );
          resolve(false);
        }, SENTRY_INIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Nonblocking observer lookup; late SDK initialization can restore capture. */
export function getInitializedSentry(): typeof readySdk {
  return readySdk;
}

/** Test seam; not exported from the package barrel. */
export function __resetForTests(): void {
  initialized = false;
  pendingInit = undefined;
  readySdk = undefined;
}
