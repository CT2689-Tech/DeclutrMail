'use client';

import {
  scrubObject,
  scrubTelemetryPayload,
  type EventName,
  type EventProps,
} from '@declutrmail/shared/observability';

/**
 * PostHog browser wrapper (D159).
 *
 * Gated on `NEXT_PUBLIC_POSTHOG_KEY`. With no key, every `track()` call
 * is a silent no-op so local dev and tests run unaffected.
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
 * Capture a typed product event. No-op when `NEXT_PUBLIC_POSTHOG_KEY`
 * is unset or when running server-side.
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

/** Test seam — drops the cached SDK promise so a fresh init happens. */
export function __resetForTests(): void {
  sdkPromise = null;
}
