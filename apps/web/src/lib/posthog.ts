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
 *   - `disable_surveys`, `autocapture: false`, `capture_pageview: false`
 *     — explicit events only; nothing implicit.
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
        // No implicit data — explicit `track()` calls only.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        // No session recording / replay (D7 — same reason as Sentry replay).
        disable_session_recording: true,
        disable_surveys: true,
        // Defense-in-depth scrub at the wire boundary.
        sanitize_properties: (props: Record<string, unknown> | null | undefined) =>
          (scrubTelemetryPayload(props) ?? {}) as Record<string, unknown>,
      });
      return posthog;
    })();
  }
  return sdkPromise;
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
  sdk.capture(eventName, safeProps);
}

/**
 * Identify the current user. Pass the INTERNAL user UUID (from our DB),
 * never the user's Gmail address.
 */
export async function identifyUser(internalUserUuid: string): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.identify(internalUserUuid);
}

/** Clear identity on logout. */
export async function resetIdentity(): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.reset();
}

/**
 * Withdraw analytics consent (GDPR Art. 7(3) — the D147 banner's
 * counterpart). Grabs the SDK handle FIRST, while consent still reads
 * "all" (null when it never loaded — no consent, no key, server-side),
 * then flips the stored choice to "essential" in both stores. Because
 * `loadSdk` re-checks consent on every call, `track()` and
 * `identifyUser()` no-op immediately after the flip — no reload needed.
 * `reset()` additionally drops the identity the SDK stored locally.
 *
 * The upgrade path needs no counterpart here: storing "all"
 * (`storeConsent('all')`) is enough, since the same per-call gate picks
 * consent up on the next `track()`.
 */
export async function withdrawAnalyticsConsent(): Promise<void> {
  const sdk = await loadSdk();
  storeConsent('essential');
  if (sdk) sdk.reset();
}

/** Test seam — drops the cached SDK promise so a fresh init happens. */
export function __resetForTests(): void {
  sdkPromise = null;
}
