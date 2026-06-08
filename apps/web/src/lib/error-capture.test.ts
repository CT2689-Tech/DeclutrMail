// error-capture.test.ts — exercises the Sentry init guard + the
// one-shot warning latch (and demonstrates `__resetForTests` actually
// runs in a test, so the exported seam isn't dead weight).
//
// Covers:
//   • No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset
//   • Fallback warn + console.error when Sentry client is missing
//   • One-shot latch — repeated misses log warn ONCE per session
//   • `__resetForTests()` actually resets the latch between tests
//   • `validateBoundary` rejects unknown boundary strings (via tag)
//
// Sentry SDK is stubbed via `vi.mock('@sentry/nextjs', …)` so the
// dynamic import inside captureErrorBoundaryException resolves to a
// controlled fake without hitting the real SDK.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests, captureErrorBoundaryException } from './error-capture';

// Stub the dynamic-imported SDK. The factory runs once per test file
// load; `getClient` + `captureException` are mutable per-test via the
// `setClient`/`setCapture` helpers below.
let currentClient: object | undefined;
const captureExceptionSpy = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  getClient: () => currentClient,
  captureException: (...args: unknown[]) => captureExceptionSpy(...args),
}));

function setClient(client: object | undefined): void {
  currentClient = client;
}

describe('captureErrorBoundaryException', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    __resetForTests();
    setClient({}); // default: SDK initialised
    captureExceptionSpy.mockClear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://stub@sentry.io/123';
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalDsn === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    }
  });

  it('forwards to Sentry when the SDK is initialised', async () => {
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'app-router-error',
    });
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { boundary: 'app-router-error' },
      }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no-ops when NEXT_PUBLIC_SENTRY_DSN is unset', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'app-router-error',
    });
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('falls back to console.error when Sentry SDK reports no client', async () => {
    setClient(undefined);
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'app-router-error',
    });
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[error-capture] boundary capture (fallback)',
      expect.objectContaining({ boundary: 'app-router-error' }),
    );
  });

  it('logs the not-initialised warning ONCE per session (latch holds)', async () => {
    setClient(undefined);
    await captureErrorBoundaryException(new Error('first'), {
      boundary: 'app-router-error',
    });
    await captureErrorBoundaryException(new Error('second'), {
      boundary: 'app-router-error',
    });
    await captureErrorBoundaryException(new Error('third'), {
      boundary: 'app-router-global-error',
    });
    // Warning latched after first miss.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // But every capture still logs the structured fallback.
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('__resetForTests releases the warning latch between tests', async () => {
    setClient(undefined);
    await captureErrorBoundaryException(new Error('first'), {
      boundary: 'app-router-error',
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    __resetForTests();

    await captureErrorBoundaryException(new Error('second'), {
      boundary: 'app-router-error',
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('forwards the per-feature "senders-detail" boundary tag verbatim', async () => {
    // D38 session-3 — `/senders/[id]/error.tsx` uses the per-feature
    // boundary so Sentry groups its errors distinctly from the global
    // app shell.
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'senders-detail',
    });
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { boundary: 'senders-detail' },
      }),
    );
  });

  it.each(['senders', 'activity', 'brief', 'autopilot'] as const)(
    'forwards the per-feature "%s" boundary tag verbatim',
    async (boundary) => {
      // FOUNDER-FOLLOWUPS 2026-06-06 — each authed surface gets its own
      // route-segment error.tsx so Sentry groups them distinctly.
      await captureErrorBoundaryException(new Error('boom'), { boundary });
      expect(captureExceptionSpy).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { boundary },
        }),
      );
    },
  );

  it('normalises unknown boundary values to "unknown" in the Sentry tag', async () => {
    await captureErrorBoundaryException(new Error('boom'), {
      // @ts-expect-error — exercise the runtime guard with a value not
      // in the compile-time `ErrorBoundary` union.
      boundary: 'route-segment-error',
    });
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { boundary: 'unknown' },
      }),
    );
  });
});
