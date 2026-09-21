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

type InitOptions = NonNullable<(typeof sdk.init)['mock']['calls'][number]>[0];

// Vitest 5 clears mock call history before every test (`clearMocks: true`).
// `initSentryBrowserRuntime` is a singleton, so only the first boot records
// `Sentry.init`. Capture that options object once and reuse it.
let cachedInitOptions: InitOptions | undefined;

function boot(dsn = 'https://stub@sentry.io/123') {
  const runtime = initSentryBrowserRuntime(dsn);
  cachedInitOptions ??= sdk.init.mock.calls[0]?.[0];
  return runtime;
}

function initOptions(): InitOptions {
  boot();
  if (cachedInitOptions === undefined) {
    throw new Error('Sentry.init options were not captured');
  }
  return cachedInitOptions;
}

describe('heavy Sentry browser runtime', () => {
  beforeAll(() => {
    sdk.init.mockClear();
    cachedInitOptions = undefined;
  });

  it('initialises once with explicit deny-by-default collection and integrations', () => {
    const first = boot('https://stub@sentry.io/123');
    const second = boot('https://ignored@sentry.io/456');

    expect(second).toBe(first);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://stub@sentry.io/123',
        tracesSampleRate: 0.2,
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
      // Tracing is fail-closed by NAME here, so this assertion is what
      // proves the sample rate is not a silent no-op (D159, 2026-08-18).
      'BrowserTracing',
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

  // The scrubber drops `exception.value` for D7, so an uncaught React
  // invariant used to arrive as a bare, message-less `Error`: captured,
  // transported, and impossible to find. A production #418 on the public
  // site (2026-09-19) had `__sentry_captured__: true` and zero search hits.
  it('labels React invariant errors with a closed-set reason that survives the scrub', () => {
    const options = initOptions();
    const send = (value: string, tags?: Record<string, string>) =>
      options?.beforeSend?.(
        { exception: { values: [{ type: 'Error', value }] }, ...(tags ? { tags } : {}) },
        {} as never,
      );

    // Exhaustive `toEqual`: the message and its `args[]` URL are gone.
    expect(
      send(
        'Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message',
      ),
    ).toEqual({
      exception: { values: [{ type: 'Error' }] },
      tags: { reason: 'react-error-418' },
      fingerprint: ['react-error-418'],
    });

    // `next dev` words the same invariant differently.
    expect(
      send("Hydration failed because the server rendered text didn't match the client."),
    ).toMatchObject({ tags: { reason: 'react-error-418' } });

    // Any other minified invariant keeps its own number.
    expect(send('Minified React error #425; visit https://react.dev/errors/425')).toMatchObject({
      tags: { reason: 'react-error-425' },
      fingerprint: ['react-error-425'],
    });

    // Anchored: prose that merely mentions the phrase is not classified.
    expect(send('Saw "Minified React error #418; x" in a log')).toEqual({
      exception: { values: [{ type: 'Error' }] },
    });

    // Runs outside the scrubber's try/catch: a malformed event must not
    // throw, or Sentry drops it.
    for (const malformed of [
      { exception: { values: 'nope' } },
      { exception: { values: [null] } },
      { exception: null },
      { exception: { values: [{ value: 'Minified React error #418; x' }] }, tags: 'nope' },
    ]) {
      expect(() => options?.beforeSend?.(malformed as never, {} as never)).not.toThrow();
    }

    // A wrapper must not hide the invariant: Sentry puts causes FIRST.
    expect(
      options?.beforeSend?.(
        {
          exception: {
            values: [
              { type: 'Error', value: 'Minified React error #418; visit' },
              { type: 'Error', value: 'render failed' },
            ],
          },
        } as never,
        {} as never,
      ),
    ).toMatchObject({ tags: { reason: 'react-error-418' } });

    // Sibling tags are kept when the reason is added.
    expect(send('Minified React error #418; visit', { surface: 'senders' })).toMatchObject({
      tags: { surface: 'senders', reason: 'react-error-418' },
    });

    // A capture site's own reason wins; this only fills the gap.
    expect(
      send('Minified React error #418; visit', { surface: 'senders', reason: 'manual' }),
    ).toMatchObject({ tags: { surface: 'senders', reason: 'manual' } });
  });

  it('sanitizes manual breadcrumbs and preserves exception and router forwarding', () => {
    sdk.addBreadcrumb.mockClear();
    sdk.captureException.mockClear();
    sdk.captureRouterTransitionStart.mockClear();
    sdk.setTag.mockClear();
    const runtime = boot();
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
