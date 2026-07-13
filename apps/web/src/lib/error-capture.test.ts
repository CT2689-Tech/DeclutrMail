// Boundary behavior stays independent of how the browser SDK is loaded:
// validate the tag, use the lazy facade, and retain the one-shot console
// fallback if the configured runtime is unavailable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests, captureErrorBoundaryException } from './error-capture';

const sentryFacade = vi.hoisted(() => ({
  capture:
    vi.fn<(error: unknown, boundary: string, digest: string | undefined) => Promise<boolean>>(),
}));

vi.mock('./sentry', () => ({
  captureSentryBoundaryException: (error: unknown, boundary: string, digest: string | undefined) =>
    sentryFacade.capture(error, boundary, digest),
}));

describe('captureErrorBoundaryException', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    __resetForTests();
    sentryFacade.capture.mockReset();
    sentryFacade.capture.mockResolvedValue(true);
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

  it('forwards to the lazy Sentry facade when the runtime is available', async () => {
    const error = new Error('boom');
    await captureErrorBoundaryException(error, {
      boundary: 'app-router-error',
      digest: 'digest-1',
    });

    expect(sentryFacade.capture).toHaveBeenCalledWith(error, 'app-router-error', 'digest-1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no-ops when NEXT_PUBLIC_SENTRY_DSN is unset', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'app-router-error',
    });

    expect(sentryFacade.capture).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('falls back to console.error when the lazy runtime is unavailable', async () => {
    sentryFacade.capture.mockResolvedValue(false);
    await captureErrorBoundaryException(new Error('boom'), {
      boundary: 'app-router-error',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[error-capture] boundary capture (fallback)',
      expect.objectContaining({ boundary: 'app-router-error' }),
    );
  });

  it('logs the unavailable-runtime warning once while preserving every fallback', async () => {
    sentryFacade.capture.mockResolvedValue(false);
    await captureErrorBoundaryException(new Error('first'), {
      boundary: 'app-router-error',
    });
    await captureErrorBoundaryException(new Error('second'), {
      boundary: 'app-router-error',
    });
    await captureErrorBoundaryException(new Error('third'), {
      boundary: 'app-router-global-error',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('__resetForTests releases the warning latch', async () => {
    sentryFacade.capture.mockResolvedValue(false);
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

  it.each(['senders-detail', 'senders', 'activity', 'brief', 'autopilot'] as const)(
    'forwards the per-feature "%s" boundary tag verbatim',
    async (boundary) => {
      await captureErrorBoundaryException(new Error('boom'), { boundary });
      expect(sentryFacade.capture).toHaveBeenCalledWith(expect.any(Error), boundary, undefined);
    },
  );

  it('normalises an unknown runtime boundary to "unknown"', async () => {
    await captureErrorBoundaryException(new Error('boom'), {
      // @ts-expect-error exercise the runtime allowlist.
      boundary: 'route-segment-error',
    });
    expect(sentryFacade.capture).toHaveBeenCalledWith(expect.any(Error), 'unknown', undefined);
  });
});
