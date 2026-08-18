import {
  scrubSentryEvent,
  scrubSentryLog,
  scrubSentryTransaction,
  scrubTelemetryPayload,
} from '@declutrmail/shared/observability';

/**
 * Sentry server bootstrap (D159).
 *
 * Gated entirely on `SENTRY_DSN`. With no DSN, this module installs
 * nothing — no SDK calls, no global side effects, no error swallowing
 * — so local dev (and the test suite) run unaffected.
 *
 * Privacy posture (D7, D228):
 *   - Captures EXCEPTIONS ONLY. No performance traces, no profiling,
 *     no replay (server-side replay doesn't exist, but the principle
 *     stands: opt out of anything that could carry user data).
 *   - `beforeSend` runs every event through the shared scrubber, which
 *     strips body / snippet / attachment / non-allowlisted header keys
 *     wherever they appear in the event tree.
 *   - PII auto-collection (`sendDefaultPii`) is OFF.
 *
 * The SDK is loaded via dynamic `import()` so unconfigured envs incur
 * zero startup cost (the @sentry/node bundle is large).
 */

let initialized = false;

/**
 * Hard timeout for the Sentry init phase, in ms. 2026-06-08 session:
 * `await initSentry()` blocked indefinitely on a Cloud Run worker
 * revision (last-logged boot step was `initSentry_begin`, never
 * `initSentry_done`). @sentry/node v10+'s OTel-aware init can stall
 * when modules are already imported above it; the worker entrypoint
 * imports the NestJS / Drizzle / BullMQ / Anthropic graph at the top
 * of `worker.ts` before any code runs, so Sentry attaching after-the-
 * fact is the structural mismatch. The right long-term fix is to
 * preload `@sentry/node/preload` via `node --import @sentry/node/preload`
 * BEFORE `@swc-node/register`; tracked as a follow-up. Until then,
 * this timeout prevents a single observability dependency from blocking
 * the entire worker indefinitely. Sentry is "best-effort" by design
 * (D159 — privacy preserved is more important than error capture).
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

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // local dev / unconfigured — no-op silently

  const initPromise = (async () => {
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
      // `@sentry/node/preload` BEFORE `@swc-node/register`) is now live in
      // the Dockerfile CMD, so tracing no longer rides on that mismatch.
      //
      // Rate is env-tunable and deliberately not 1.0: the worker runs cron
      // jobs on 60s/5min ticks, so full sampling is mostly duplicate shapes.
      // 0.2 keeps the span quota (5M/month, 0 used at the 2026-08-18
      // incident) irrelevant while still catching a runaway loop, which
      // shows up as shape rather than as any single trace.
      tracesSampleRate: readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.2),
      // The LOGS channel (D159, 2026-08-18). Notices that are not crashes
      // — `dead_letter.parked`, the CAN-SPAM postal refusal — belong here,
      // not on the errors quota, which is the only Sentry budget that runs
      // out: errors sat at 4,000/5,000 while logs sat at 0 of 5 GB.
      //
      // This does NOT re-enable auto-instrumentation. Logs use their own
      // transport; `defaultIntegrations: false` below still stands, which
      // is what keeps the worker bootstrap from hanging (see the comment
      // on `integrations`).
      enableLogs: true,
      profilesSampleRate: 0,
      // Never auto-collect IP, user-agent, cookies, request bodies, etc.
      sendDefaultPii: false,
      // CRITICAL (2026-06-08 session): `@sentry/node` v10 ships with
      // OpenTelemetry-based default integrations that monkey-patch
      // already-loaded modules (Express, http, postgres, ioredis, etc.)
      // when `Sentry.init` runs. The worker entrypoint imports the full
      // NestJS / Drizzle / BullMQ / Anthropic graph at the TOP of
      // `worker.ts` before any code runs, so by the time `initSentry()`
      // executes those modules are already in `require.cache`. Sentry's
      // late-monkey-patch hangs the bootstrap — observed as
      // `initSentry_begin` being the last logged step on Cloud Run
      // worker revision 00012-13. `defaultIntegrations: false` + an
      // empty integrations list opts entirely out of auto-
      // instrumentation; we keep ONLY `captureException`-style manual
      // capture (which is all we need per D159 — exceptions only, no
      // performance traces). Without this opt-out, the entire worker
      // never reaches BullMQ Worker constructors.
      defaultIntegrations: false,
      integrations: [],
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
      beforeBreadcrumb: (breadcrumb) =>
        scrubTelemetryPayload(
          breadcrumb as unknown as Record<string, unknown>,
        ) as unknown as typeof breadcrumb,
    });
    initialized = true;
  })();

  await Promise.race([
    initPromise,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!initialized) {
          // eslint-disable-next-line no-console
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'sentry.init_timeout',
              timeoutMs: SENTRY_INIT_TIMEOUT_MS,
              dsnSet: true,
              message:
                'Sentry init did not resolve before the timeout — proceeding without capture wiring.',
            }),
          );
        }
        resolve();
      }, SENTRY_INIT_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Test seam — re-set so multiple `initSentry()` calls in unit tests
 * behave deterministically. Not exported from the package barrel.
 */
export function __resetForTests(): void {
  initialized = false;
}
