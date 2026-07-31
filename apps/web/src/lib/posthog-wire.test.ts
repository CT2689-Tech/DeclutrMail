import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeConsent } from './cookie-consent';

/**
 * WIRE-LEVEL privacy regression (D7, D159).
 *
 * Deliberately does NOT mock `posthog-js`. `posthog.test.ts` does, and so
 * can only assert which options we PASS to `init()` — which is not a
 * privacy guarantee. `advanced_disable_decide` was already renamed to
 * `advanced_disable_flags` once; the day posthog-js renames it again, an
 * "is the option set?" assertion stays green while the leak returns. This
 * file asserts on what leaves the browser, with the real SDK driving the
 * real transport, so a rename fails the build instead.
 *
 * What leaked: `sanitize_properties` runs on CAPTURED EVENTS only. The
 * SDK's `/flags/` POST carries its own `person_properties` and bypasses
 * that hook, so posthog-js built `$initial_current_url` /
 * `$initial_utm_content` straight from the address bar and shipped
 * `?sender_q=<address>` unscrubbed — on the same page load where `/e/`
 * was provably clean. Found by smoke 2026-07-31, one day after #454
 * closed the `/e/` door.
 *
 * NON-VACUITY IS THE POINT. "Assert no flags request" passes perfectly
 * when the SDK never started, when happy-dom has no working transport, or
 * when the request left via a method this file forgot to patch — every one
 * a vacuous pass. Two things rule that out here:
 *
 *   1. `posthog.__loaded` must be true, which posthog-js sets only after a
 *      genuine init. That kills "no requests because no SDK".
 *   2. The NEGATIVE CONTROL, run by hand and recorded on PR #455: with
 *      `advanced_disable_flags` reverted this test fails, naming the exact
 *      `/flags/?v=2` URL it caught through these same patches. That is the
 *      proof the transport interception works — a claim no amount of
 *      green can make on its own.
 *
 * Re-run that control whenever this file or the posthog-js major changes.
 * An in-file control instance was tried first and had to be abandoned:
 * posthog-js keeps singleton state on `window.__PosthogExtensions__` that
 * survives `vi.resetModules()`, so the control silenced the very test it
 * was meant to validate — that draft PASSED with the fix reverted.
 *
 * SCOPE, stated honestly: this guards the ENDPOINT, not the payload.
 * happy-dom sends `person_properties: {}` — the `$initial_*` values only
 * populate in a real browser — so asserting the address inside the body
 * here would be environment-dependent and flaky. That is acceptable
 * because a request never made cannot leak a payload; the endpoint IS the
 * invariant. Payload-level evidence lives in the manual smoke recorded on
 * PR #455 and in the scrubber's own unit tests.
 */

type Recorded = { url: string; body: string };

/**
 * Patch every transport posthog-js might reach for. Missing one would make
 * the "no flags request" assertion silently vacuous, which is why the
 * negative control described above is the thing that validates this — it
 * only fails on a revert if these patches genuinely see the request.
 */
function recordTransport(): { requests: Recorded[]; restore: () => void } {
  const requests: Recorded[] = [];
  const push = (url: unknown, body: unknown): void => {
    requests.push({
      url: String(url ?? ''),
      body: typeof body === 'string' ? body : body ? String(body) : '',
    });
  };

  const realFetch = globalThis.fetch;
  const realBeacon = navigator.sendBeacon;
  const realOpen = XMLHttpRequest.prototype.open;
  const realSend = XMLHttpRequest.prototype.send;

  globalThis.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    push(typeof input === 'string' ? input : (input as { url?: string })?.url, init?.body);
    return new Response('{"status":1,"featureFlags":{}}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: vi.fn((url: unknown, body: unknown) => {
      push(url, body);
      return true;
    }),
  });

  const urls = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _method: string, url: string) {
    urls.set(this, url);
    // Deliberately not calling through: happy-dom would open a real socket.
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: unknown) {
    push(urls.get(this), body);
  } as typeof XMLHttpRequest.prototype.send;

  return {
    requests,
    restore: () => {
      globalThis.fetch = realFetch;
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        writable: true,
        value: realBeacon,
      });
      XMLHttpRequest.prototype.open = realOpen;
      XMLHttpRequest.prototype.send = realSend;
    },
  };
}

/** `decide` is the legacy spelling of the same endpoint — both must stay unused. */
const isFlagsRequest = (r: Recorded): boolean => /\/(flags|decide)\//.test(r.url);

/** Let the SDK's init-time work (the flags fetch included) actually run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

/** Entry URL carrying a sender address, the shape that leaked in production. */
const LEAKY_URL = 'http://localhost/?utm_source=reddit&sender_q=private%40example.com';

/** Survives as `%40` or `@` depending on whether the SDK round-tripped it. */
const ADDRESS_FORMS = ['private@example.com', 'private%40example.com'] as const;

/**
 * happy-dom's test-only navigation hook. Not in the DOM lib types, and
 * `location.href = ...` cannot stand in: assigning it in happy-dom triggers
 * a real navigation rather than just restating the URL, which tears down the
 * window this test is asserting against.
 */
const setTestUrl = (url: string): void => {
  (window as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM?.setURL?.(url);
};

beforeEach(() => {
  // MANDATORY, not hygiene. posthog-js keeps module-level singleton state:
  // once an instance has initialized, a later `init()` short-circuits and
  // never re-fetches flags. Without a fresh module registry the test would
  // observe a no-op init and pass no matter how the SDK is configured.
  vi.resetModules();
  setTestUrl(LEAKY_URL);
  window.localStorage.clear();
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_wiretest');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'http://posthog.invalid');
  storeConsent('all');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PostHog wire-level privacy guard (D7, D159)', () => {
  it('production config makes NO /flags/ request, so its unscrubbed person properties never leave', async () => {
    const { requests, restore } = recordTransport();
    try {
      // Imported AFTER `vi.resetModules()` so this exercises a pristine
      // posthog-js, the same state a real first page load starts from.
      const { track } = await import('./posthog');
      await track('page_viewed', { page: 'landing', mailbox_id: null });
      await settle();

      // Non-vacuity gate. Cannot be "some request was observed": correctly
      // guarded, this config emits NOTHING at init — disabling flags also
      // suppresses the `/array/<key>/config` fetch — and queued events
      // never flush inside a test. `__loaded` is set only by a real init,
      // so it rules out the "no requests because no SDK" pass.
      const posthog = (await import('posthog-js')).default as unknown as Record<string, unknown>;
      expect(posthog.__loaded, 'SDK never initialized — assertion would be vacuous').toBe(true);

      // The actual regression guard.
      expect(requests.filter(isFlagsRequest).map((r) => r.url)).toEqual([]);

      // Belt and braces on whatever DID go out.
      const wire = requests.map((r) => `${r.url} ${r.body}`).join('\n');
      expect(ADDRESS_FORMS.filter((form) => wire.includes(form))).toEqual([]);
      expect(wire).not.toContain('$initial_current_url');
    } finally {
      restore();
    }
  });
});
