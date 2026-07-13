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

vi.mock('@sentry/nextjs', () => ({
  init: sdk.init,
  addBreadcrumb: sdk.addBreadcrumb,
  captureException: sdk.captureException,
  captureRouterTransitionStart: sdk.captureRouterTransitionStart,
  getClient: sdk.getClient,
  withScope: (callback: (scope: { setTag: typeof sdk.setTag }) => void) =>
    callback({ setTag: sdk.setTag }),
}));

describe('heavy Sentry browser runtime', () => {
  beforeAll(() => {
    sdk.init.mockClear();
  });

  it('initialises once with explicit deny-by-default collection and integrations', () => {
    const first = initSentryBrowserRuntime('https://stub@sentry.io/123');
    const second = initSentryBrowserRuntime('https://ignored@sentry.io/456');

    expect(second).toBe(first);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://stub@sentry.io/123',
        tracesSampleRate: 0,
        traceLifecycle: 'static',
        streamGenAiSpans: false,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        profilesSampleRate: 0,
        profileSessionSampleRate: 0,
        enableLogs: false,
        enableMetrics: false,
        sendClientReports: false,
        sendDefaultPii: false,
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          queryParams: false,
          genAI: { inputs: false, outputs: false },
          stackFrameVariables: false,
          frameContextLines: 0,
        },
        integrations: expect.any(Function),
        beforeSend: expect.any(Function),
        beforeSendTransaction: expect.any(Function),
        beforeSendLog: expect.any(Function),
        beforeSendMetric: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );

    const options = sdk.init.mock.calls[0]?.[0];
    const defaults = [
      'InboundFilters',
      'FunctionToString',
      'ConversationId',
      'BrowserApiErrors',
      'Breadcrumbs',
      'GlobalHandlers',
      'LinkedErrors',
      'Dedupe',
      'HttpContext',
      'CultureContext',
      'BrowserSession',
      'BrowserTracing',
      'NextjsClientStackFrameNormalization',
      'FutureSdkCollector',
    ].map((name) => ({ name }));
    expect(
      options?.integrations?.(defaults).map((integration: { name: string }) => integration.name),
    ).toEqual([
      'InboundFilters',
      'FunctionToString',
      'GlobalHandlers',
      'LinkedErrors',
      'Dedupe',
      'NextjsClientStackFrameNormalization',
    ]);

    const leak = 'private.user@example.com';
    expect(
      options?.beforeSend?.(
        {
          message: leak,
          user: { email: leak },
          exception: { values: [{ type: 'TypeError', value: leak }] },
          tags: { surface: 'sync', workspace_id: leak },
        },
        {} as never,
      ),
    ).toEqual({
      exception: { values: [{ type: 'TypeError' }] },
      tags: { surface: 'sync' },
    });

    expect(
      options?.beforeBreadcrumb?.(
        { category: 'console', message: leak, data: { arguments: [leak] } },
        {} as never,
      ),
    ).toBeNull();
    expect(
      options?.beforeBreadcrumb?.(
        {
          category: 'declutrmail.action',
          message: leak,
          data: { verb: 'archive', sender_id: leak, url: `https://example.com/${leak}` },
        },
        {} as never,
      ),
    ).toEqual({
      category: 'declutrmail.action',
      message: 'declutrmail.action',
      data: { verb: 'archive' },
    });
    expect(
      options?.beforeSendTransaction?.({ transaction: leak } as never, {} as never),
    ).toBeNull();
    expect(options?.beforeSendLog?.({ body: leak } as never)).toBeNull();
    expect(options?.beforeSendMetric?.({ name: leak } as never)).toBeNull();
  });

  it('sanitizes manual breadcrumbs and preserves exception and router forwarding', () => {
    sdk.addBreadcrumb.mockClear();
    sdk.captureException.mockClear();
    sdk.captureRouterTransitionStart.mockClear();
    sdk.setTag.mockClear();
    const runtime = initSentryBrowserRuntime('https://stub@sentry.io/123');
    const error = new Error('boom');

    runtime.addBreadcrumb({
      category: 'sync',
      message: 'sync start private.user@example.com',
      level: 'warning',
      data: {
        message_count: 2,
        mailbox_id: 'private-id',
        url: 'https://example.com/private',
      },
    });
    runtime.captureFeatureException(error, { surface: 'sync', reason: 'manual' });
    runtime.captureEarlyGlobalException(error, 'unhandled-rejection');
    expect(runtime.captureBoundaryException(error, 'senders', 'abcdef1234567890')).toBe(true);
    runtime.captureRouterTransitionStart('/senders', 'push');

    expect(sdk.addBreadcrumb).toHaveBeenCalledWith({
      category: 'declutrmail.sync',
      message: 'declutrmail.sync',
      level: 'warning',
      data: { message_count: 2 },
    });
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
      extra: { digest: 'abcdef1234567890' },
    });
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledWith('/senders', 'push');
  });
});
