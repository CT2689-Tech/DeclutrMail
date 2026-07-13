import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initSentryBrowserRuntime } from './sentry-browser-runtime';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  getClient: vi.fn(() => ({})),
  setTag: vi.fn(),
}));
const scrub = vi.hoisted(() => vi.fn((value: unknown) => value));

vi.mock('@sentry/nextjs', () => ({
  init: sdk.init,
  addBreadcrumb: sdk.addBreadcrumb,
  captureException: sdk.captureException,
  captureRouterTransitionStart: sdk.captureRouterTransitionStart,
  getClient: sdk.getClient,
  withScope: (callback: (scope: { setTag: typeof sdk.setTag }) => void) =>
    callback({ setTag: sdk.setTag }),
}));

vi.mock('@declutrmail/shared/observability', () => ({
  scrubTelemetryPayload: scrub,
}));

describe('heavy Sentry browser runtime', () => {
  beforeAll(() => {
    sdk.init.mockClear();
  });

  it('initialises once with the existing privacy and integration options', () => {
    const first = initSentryBrowserRuntime('https://stub@sentry.io/123');
    const second = initSentryBrowserRuntime('https://ignored@sentry.io/456');

    expect(second).toBe(first);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://stub@sentry.io/123',
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        sendDefaultPii: false,
        integrations: [],
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );

    const options = sdk.init.mock.calls[0]?.[0];
    const event = { extra: { body: 'private' } };
    options?.beforeSend?.(event, {} as never);
    expect(scrub).toHaveBeenCalledWith(event);
  });

  it('preserves breadcrumb, feature, early-global, boundary, and router forwarding', () => {
    const runtime = initSentryBrowserRuntime('https://stub@sentry.io/123');
    const error = new Error('boom');

    runtime.addBreadcrumb({ category: 'sync', message: 'start', level: 'warning' });
    runtime.captureFeatureException(error, { surface: 'sync', reason: 'manual' });
    runtime.captureEarlyGlobalException(error, 'unhandled-rejection');
    expect(runtime.captureBoundaryException(error, 'senders', 'digest')).toBe(true);
    runtime.captureRouterTransitionStart('/senders', 'push');

    expect(sdk.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'sync', level: 'warning' }),
    );
    expect(sdk.setTag).toHaveBeenCalledWith('surface', 'sync');
    expect(sdk.setTag).toHaveBeenCalledWith('reason', 'manual');
    expect(sdk.captureException).toHaveBeenCalledWith(error, {
      mechanism: {
        handled: false,
        type: 'auto.browser.global_handlers.onunhandledrejection',
      },
    });
    expect(sdk.captureException).toHaveBeenCalledWith(error, {
      tags: { boundary: 'senders' },
      extra: { digest: 'digest' },
    });
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith('/senders', 'push');
  });
});
