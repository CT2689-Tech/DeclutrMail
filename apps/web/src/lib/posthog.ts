'use client';

import {
  scrubObject,
  scrubTelemetryPayload,
  type EventName,
  type EventProps,
} from '@declutrmail/shared/observability';
import { hasAnalyticsConsent, storeConsent } from './cookie-consent';

/**
 * PostHog browser wrapper (D159).
 *
 * Gated on TWO conditions, both required:
 *   - cookie consent (D147): the visitor chose "Accept all" in the
 *     cookie banner. Analytics is opt-in — with no choice (or
 *     "Essential only") the SDK is never imported, never initialized,
 *     and writes nothing. This is the privacy-policy promise
 *     ("initialized only after you accept it in the cookie banner").
 *   - `NEXT_PUBLIC_POSTHOG_KEY`. With no key, every `track()` call is
 *     a silent no-op so local dev and tests run unaffected.
 *
 * Privacy posture (D7, D228):
 *   - Event names are a CLOSED UNION (`EventName` in `@declutrmail/shared/observability`).
 *     Typos and ad-hoc events become compile errors.
 *   - Per-event props are typed via `EventProps<E>`. Only scalars and
 *     internal UUIDs / enums — never email addresses, message text, etc.
 *   - Defense in depth: `scrubObject` runs on every property bag before
 *     it reaches the SDK, and PostHog's own `sanitize_properties` hook
 *     scrubs again at the wire boundary.
 *   - `disable_session_recording: true` (PostHog's replay is also OFF).
 *   - `disable_surveys` and `autocapture: false` — no implicit INTERACTION
 *     capture; clicks, form fields and rageclicks are never recorded.
 *   - `$pageview` and `$pageleave` ARE captured by the SDK itself, which
 *     means they do not pass through `track()`. `track()` re-reads consent
 *     on every call, so it used to be the only gate needed; these two
 *     bypass it entirely. `withdrawAnalyticsConsent` therefore has to stop
 *     the library, not just clear the stored choice — see its doc below.
 *   - User identifier is opt-in via `identifyUser(internalUserUuid)`.
 *     Callers MUST pass the internal user UUID, NEVER the Gmail address.
 *
 * The SDK loads lazily on first `track()` call.
 */

type PosthogSdk = {
  init: (key: string, opts: Record<string, unknown>) => void;
  capture: (eventName: string, props?: Record<string, unknown>) => void;
  identify: (id: string, props?: Record<string, unknown>) => void;
  reset: () => void;
  opt_out_capturing: () => void;
  opt_in_capturing: (opts?: { captureEventName?: false }) => void;
  has_opted_out_capturing: () => boolean;
};

let sdkPromise: Promise<PosthogSdk | null> | null = null;

async function loadSdk(): Promise<PosthogSdk | null> {
  if (typeof window === 'undefined') return null;
  // D147 consent gate. Checked on EVERY call — before the cached
  // promise, too — so consent granted mid-session takes effect on the
  // next call without a reload, and a future withdrawal surface stops
  // capture immediately even after the SDK has loaded.
  if (!hasAnalyticsConsent()) return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  if (!sdkPromise) {
    sdkPromise = (async () => {
      const mod = await import('posthog-js');
      const posthog = mod.default as unknown as PosthogSdk;
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        // No implicit INTERACTION capture — clicks, form fields and
        // rageclicks are never recorded.
        autocapture: false,
        // `$pageview` is the one implicit event we do send: PostHog's Web
        // analytics, Web vitals and Page reports read it and nothing else,
        // so without it those surfaces are permanently empty. It widens no
        // data category — `$current_url` and `$session_id` already ride
        // every explicit `track()` call as auto-properties.
        //
        // MUST be 'history_change', not `true`. posthog-js only starts its
        // HistoryAutocapture extension on the literal 'history_change'
        // (`isEnabled` compares against that exact string); plain `true`
        // captures a single `$pageview` at init and nothing after. This is an
        // App Router SPA that navigates via pushState, so `true` would have
        // recorded one pageview per cold load and missed every in-app route
        // change. 'history_change' keeps the init-time capture too.
        capture_pageview: 'history_change',
        // Dwell time / bounce rate. This IS new data about a visitor rather
        // than a restatement of what `track()` already sends, so it was put
        // to the founder as its own call and approved 2026-07-31 — it does
        // not ride along with the `$pageview` decision above. Like
        // `$pageview` it captures outside `track()`.
        capture_pageleave: true,
        // No session recording / replay (D7 — same reason as Sentry replay).
        disable_session_recording: true,
        disable_surveys: true,
        // Defense-in-depth scrub at the wire boundary.
        sanitize_properties: (props: Record<string, unknown> | null | undefined) =>
          (scrubTelemetryPayload(props) ?? {}) as Record<string, unknown>,
      });
      return posthog;
    })().catch(() => {
      // Analytics must never destabilize product UI. Clear the rejected
      // cache so a later explicit event may retry a transient chunk/init
      // failure; callers simply observe a no-op.
      sdkPromise = null;
      return null;
    });
  }

  const sdk = await sdkPromise;
  if (!sdk) return null;

  // Consent WITHDRAWN while the chunk was in flight. The gate at the top of
  // this function ran BEFORE the dynamic import, but `init()` — which starts
  // the `$pageview` / `$pageleave` autocapture — runs after it. A withdrawal
  // landing inside that window can find `sdkPromise` still unset, return
  // early having stopped nothing, and leave a live SDK reporting on every
  // navigation. Re-read consent here, on the far side of the await, now that
  // the instance actually exists.
  if (!hasAnalyticsConsent()) {
    try {
      sdk.opt_out_capturing();
    } catch {
      // Best-effort — the stored choice already says no.
    }
    return null;
  }

  // Consent RE-GRANTED after a withdrawal. `withdrawAnalyticsConsent` opts
  // the SDK out at the library level and posthog-js PERSISTS that flag, so
  // storing 'all' again is not enough on its own: an already-initialized SDK
  // would keep silently dropping every capture forever. Re-opt-in before
  // handing the instance back. `captureEventName: false` stops this
  // housekeeping from emitting an event of its own.
  try {
    if (sdk.has_opted_out_capturing()) {
      sdk.opt_in_capturing({ captureEventName: false });
    }
  } catch {
    // Best-effort — a failed re-opt-in must never break the caller.
  }
  return sdk;
}

/**
 * Capture a typed product event. No-op without "Accept all" cookie
 * consent (D147), when `NEXT_PUBLIC_POSTHOG_KEY` is unset, or when
 * running server-side.
 *
 * Type signature enforces:
 *   - `eventName` is one of the closed-union literals from `EventName`
 *   - `props` matches the per-event shape declared in `EventPayloads`
 */
export async function track<E extends EventName>(
  eventName: E,
  props: EventProps<E>,
): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  // First-line defense: scrub props at the caller boundary too.
  const safeProps = scrubObject(props as unknown as Record<string, unknown>);
  try {
    sdk.capture(eventName, safeProps);
  } catch {
    // Explicit analytics is best-effort; product actions never depend on it.
  }
}

/**
 * Identify the current user. Pass the INTERNAL user UUID (from our DB),
 * never the user's Gmail address.
 */
export async function identifyUser(internalUserUuid: string): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  try {
    sdk.identify(internalUserUuid);
  } catch {
    // Identity enrichment is best-effort.
  }
}

/** Clear identity on logout. */
export async function resetIdentity(): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  try {
    sdk.reset();
  } catch {
    // Logout/navigation must never depend on analytics cleanup.
  }
}

/**
 * Withdraw analytics consent (GDPR Art. 7(3) — the D147 banner's
 * counterpart). Flips the stored choice synchronously BEFORE touching
 * the SDK, so a slow/rejected dynamic import can never leave capture
 * enabled after the UI says Essential only. If an SDK load already
 * exists, reset it best-effort; withdrawal never starts a new analytics
 * download and never depends on reset succeeding.
 *
 * Clearing the stored choice is NOT sufficient on its own. `track()` re-reads
 * consent per call, but `$pageview` / `$pageleave` are captured by the SDK
 * itself and never go through `track()` — HistoryAutocapture calls
 * `capture('$pageview')` straight off a pushState. So withdrawal must stop the
 * library too, or navigation keeps reporting after the visitor opted out
 * (GDPR Art. 7(3)). `opt_out_capturing()` flips `is_capturing()`, which every
 * capture path — autocaptured or explicit — checks first.
 *
 * The re-grant counterpart lives in `loadSdk`: posthog-js persists the opt-out,
 * so storing "all" again cannot revive capture by itself.
 */
export async function withdrawAnalyticsConsent(): Promise<void> {
  storeConsent('essential');
  const pendingSdk = sdkPromise;
  if (!pendingSdk) return;
  let sdk: PosthogSdk | null = null;
  try {
    sdk = await pendingSdk;
  } catch {
    // The load itself rejected, so there is no live SDK to stop.
    return;
  }
  if (!sdk) return;

  // ORDER IS LOAD-BEARING. posthog's `reset()` calls its internal
  // `consent.reset()`, which clears the opt-out flag — so opting out first
  // and resetting second would silently switch capture back on.
  //
  // They also need SEPARATE catches, precisely because that order puts the
  // cheap step in front of the critical one. Sharing a catch meant a throw
  // from `reset()` skipped the opt-out entirely and left `$pageview` /
  // `$pageleave` reporting after the visitor withdrew.
  try {
    sdk.reset();
  } catch {
    // Identity cleanup is hygiene. The opt-out below is what actually stops
    // capture, so a failure here must never prevent it from running.
  }

  try {
    sdk.opt_out_capturing();
  } catch {
    // Nothing further can be done in-page. The stored choice already reads
    // "essential", so `loadSdk` will opt out on its next call — though that
    // only fires on an explicit `track()`, which is why the call above is
    // the one that matters for autocaptured events.
  }
}

/** Test seam — drops the cached SDK promise so a fresh init happens. */
export function __resetForTests(): void {
  sdkPromise = null;
}

/** Test seam for slow/rejected SDK-load withdrawal regressions. */
export function __setSdkPromiseForTests(promise: Promise<PosthogSdk | null>): void {
  sdkPromise = promise;
}
