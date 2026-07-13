import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetForTests,
  __testing,
  addBreadcrumb,
  captureFeatureException,
  captureRouterTransitionStart,
  captureSentryBoundaryException,
  initSentryBrowser,
  scheduleSentryBrowserInit,
  type BrowserSentryRuntime,
} from './sentry';

function makeRuntime(operationOrder?: string[]): BrowserSentryRuntime {
  return {
    addBreadcrumb: vi.fn((crumb) => {
      operationOrder?.push(`breadcrumb:${crumb.message}`);
    }),
    captureFeatureException: vi.fn((error, context) => {
      operationOrder?.push(
        `feature:${error instanceof Error ? error.message : 'unknown'}:${context.reason}`,
      );
    }),
    captureEarlyGlobalException: vi.fn((error, source) => {
      operationOrder?.push(`global:${error.message}:${source}`);
    }),
    captureBoundaryException: vi.fn(() => true),
    captureRouterTransitionStart: vi.fn(),
  };
}

function dispatchEarlyError(error: unknown): void {
  window.dispatchEvent(
    new ErrorEvent('error', {
      error,
      message: error instanceof Error ? error.message : 'Script error.',
    }),
  );
}

function dispatchResourceError(): void {
  window.dispatchEvent(new Event('error'));
}

function dispatchNullErrorEvent(message: string, filename: string): void {
  window.dispatchEvent(
    new ErrorEvent('error', {
      error: null,
      message,
      filename,
      lineno: 27,
      colno: 9,
    }),
  );
}

function dispatchEarlyRejection(reason: unknown): void {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
}

describe('lazy browser Sentry facade', () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  let requestIdleCallback: ReturnType<typeof vi.fn>;
  let cancelIdleCallback: ReturnType<typeof vi.fn>;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let idleCallback: (() => void) | undefined;

  beforeEach(() => {
    vi.useRealTimers();
    __resetForTests();
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://stub@sentry.io/123';
    idleCallback = undefined;
    requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 41;
    });
    cancelIdleCallback = vi.fn();
    Object.assign(window, { requestIdleCallback, cancelIdleCallback });
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    __resetForTests();
    vi.useRealTimers();
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    warnSpy.mockRestore();
    Reflect.deleteProperty(window, 'requestIdleCallback');
    Reflect.deleteProperty(window, 'cancelIdleCallback');
    if (originalDsn === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    }
  });

  it('does not import, schedule, or install listeners without a DSN', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const importer = vi.fn();
    __testing.setRuntimeImporter(importer);

    scheduleSentryBrowserInit();
    addBreadcrumb({ category: 'sync', message: 'ignored', level: 'info' });
    captureFeatureException(new Error('ignored'), { surface: 'sync', reason: 'test' });
    captureRouterTransitionStart('/ignored', 'push');
    await initSentryBrowser();

    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(importer).not.toHaveBeenCalled();
    expect(
      addEventListenerSpy.mock.calls.filter(
        ([type]) => type === 'error' || type === 'unhandledrejection',
      ),
    ).toHaveLength(0);
  });

  it('loads once in a bounded idle callback and never replays stale router timing', async () => {
    const runtime = makeRuntime();
    const init = vi.fn(() => runtime);
    const importer = vi.fn(async () => ({ initSentryBrowserRuntime: init }));
    __testing.setRuntimeImporter(importer);

    addBreadcrumb({ category: 'sync', message: 'queued', level: 'info' });
    captureRouterTransitionStart('/first', 'push');
    captureRouterTransitionStart('/stale', 'replace');

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2_000,
    });
    expect(importer).not.toHaveBeenCalled();

    idleCallback?.();
    await initSentryBrowser();

    expect(importer).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith('https://stub@sentry.io/123');
    expect(runtime.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'queued' }),
    );
    expect(runtime.captureRouterTransitionStart).not.toHaveBeenCalled();

    captureRouterTransitionStart('/current', 'push');
    expect(runtime.captureRouterTransitionStart).toHaveBeenCalledOnce();
    expect(runtime.captureRouterTransitionStart).toHaveBeenCalledWith('/current', 'push');
  });

  it('captures early global errors once, sanitizes rejection payloads, and removes the bridge before replay', async () => {
    const runtime = makeRuntime();
    let releaseImport:
      ((module: { initSentryBrowserRuntime: () => BrowserSentryRuntime }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ initSentryBrowserRuntime: () => BrowserSentryRuntime }>((resolve) => {
          releaseImport = resolve;
        }),
    );
    __testing.setRuntimeImporter(importer);
    scheduleSentryBrowserInit();

    const earlyError = Object.assign(new Error('early crash'), {
      body: { snippet: 'private response body' },
      cause: { payload: 'private cause graph' },
    });
    dispatchEarlyError(earlyError);
    dispatchEarlyRejection({
      message: 'provider rejection',
      payload: { snippet: 'private mailbox content' },
    });
    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    expect(cancelIdleCallback).toHaveBeenCalledWith(41);

    releaseImport?.({ initSentryBrowserRuntime: () => runtime });
    await initSentryBrowser();

    expect(runtime.captureEarlyGlobalException).toHaveBeenCalledTimes(2);
    const replayedError = vi.mocked(runtime.captureEarlyGlobalException).mock.calls[0]?.[0];
    expect(replayedError).not.toBe(earlyError);
    expect(replayedError).toMatchObject({ name: 'Error', message: 'early crash' });
    expect(replayedError).not.toHaveProperty('body');
    expect(replayedError).not.toHaveProperty('cause');
    expect(JSON.stringify(replayedError)).not.toContain('private response body');
    expect(runtime.captureEarlyGlobalException).toHaveBeenNthCalledWith(
      1,
      replayedError,
      'window-error',
    );
    const replayedRejection = vi.mocked(runtime.captureEarlyGlobalException).mock.calls[1]?.[0];
    expect(replayedRejection).toMatchObject({
      name: 'NonErrorException',
      message: 'A non-Error value reached an exception boundary.',
    });
    expect(replayedRejection).not.toHaveProperty('payload');
    expect(JSON.stringify(replayedRejection)).not.toContain('private mailbox content');

    const bridgeRemovalOrders = removeEventListenerSpy.mock.calls
      .map(([type], index) => ({
        type,
        order: removeEventListenerSpy.mock.invocationCallOrder[index] ?? 0,
      }))
      .filter(({ type }) => type === 'error' || type === 'unhandledrejection')
      .map(({ order }) => order);
    const firstReplayOrder = vi.mocked(runtime.captureEarlyGlobalException).mock
      .invocationCallOrder[0];
    expect(bridgeRemovalOrders).toHaveLength(2);
    expect(Math.max(...bridgeRemovalOrders)).toBeLessThan(firstReplayOrder ?? 0);

    dispatchEarlyError(new Error('after init'));
    expect(runtime.captureEarlyGlobalException).toHaveBeenCalledTimes(2);
  });

  it('drops plain resource error Events without starting an eager import', async () => {
    const importer = vi.fn();
    __testing.setRuntimeImporter(importer);
    scheduleSentryBrowserInit();

    dispatchResourceError();
    await Promise.resolve();

    expect(importer).not.toHaveBeenCalled();
    expect(cancelIdleCallback).not.toHaveBeenCalled();
  });

  it('captures a null-error ErrorEvent as a bounded generic location snapshot', async () => {
    const runtime = makeRuntime();
    let releaseImport:
      ((module: { initSentryBrowserRuntime: () => BrowserSentryRuntime }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ initSentryBrowserRuntime: () => BrowserSentryRuntime }>((resolve) => {
          releaseImport = resolve;
        }),
    );
    __testing.setRuntimeImporter(importer);
    scheduleSentryBrowserInit();

    dispatchNullErrorEvent(
      `Script error: ${'x'.repeat(2_000)}`,
      'https://cdn.example.com/assets/app.js?token=private-token#fragment',
    );
    await vi.waitFor(() => expect(importer).toHaveBeenCalledOnce());
    releaseImport?.({ initSentryBrowserRuntime: () => runtime });
    await initSentryBrowser();

    const snapshot = vi.mocked(runtime.captureEarlyGlobalException).mock.calls[0]?.[0];
    expect(snapshot).toMatchObject({ name: 'WindowErrorEvent' });
    expect(snapshot?.message.length).toBeLessThanOrEqual(1_024);
    expect(snapshot?.message).toContain('https://cdn.example.com/assets/app.js:27:9');
    expect(snapshot?.message).not.toContain('private-token');
    expect(runtime.captureEarlyGlobalException).toHaveBeenCalledOnce();
    expect(runtime.captureEarlyGlobalException).toHaveBeenCalledWith(snapshot, 'window-error');
  });

  it('removes the bridge immediately before synchronous SDK init to avoid an init-time duplicate', async () => {
    const runtime = makeRuntime();
    const sdkGlobalHandler = vi.fn();
    const init = vi.fn(() => {
      window.addEventListener('error', sdkGlobalHandler);
      dispatchEarlyError(new Error('during init'));
      window.removeEventListener('error', sdkGlobalHandler);
      return runtime;
    });
    const importer = vi.fn(async () => ({ initSentryBrowserRuntime: init }));
    __testing.setRuntimeImporter(importer);
    scheduleSentryBrowserInit();
    const bridgeListeners = addEventListenerSpy.mock.calls
      .filter(([type]) => type === 'error' || type === 'unhandledrejection')
      .map(([, listener]) => listener);

    idleCallback?.();
    await initSentryBrowser();

    const bridgeRemovalOrders = removeEventListenerSpy.mock.calls
      .map(([, listener], index) => ({
        listener,
        order: removeEventListenerSpy.mock.invocationCallOrder[index] ?? 0,
      }))
      .filter(({ listener }) => bridgeListeners.includes(listener))
      .map(({ order }) => order);
    expect(bridgeRemovalOrders).toHaveLength(2);
    expect(Math.max(...bridgeRemovalOrders)).toBeLessThan(init.mock.invocationCallOrder[0] ?? 0);
    expect(sdkGlobalHandler).toHaveBeenCalledOnce();
    expect(runtime.captureEarlyGlobalException).not.toHaveBeenCalled();
  });

  it('publishes the runtime before app microtasks queued by init can reinstall the bridge', async () => {
    const runtime = makeRuntime();
    const sdkGlobalHandler = vi.fn();
    const init = vi.fn(() => {
      window.addEventListener('error', sdkGlobalHandler);
      queueMicrotask(() => {
        captureFeatureException(new Error('feature from init microtask'), {
          surface: 'sync',
          reason: 'init-microtask',
        });
        dispatchEarlyError(new Error('global from init microtask'));
      });
      return runtime;
    });
    const importer = vi.fn(async () => ({ initSentryBrowserRuntime: init }));
    __testing.setRuntimeImporter(importer);
    scheduleSentryBrowserInit();

    idleCallback?.();
    await initSentryBrowser();
    await Promise.resolve();
    window.removeEventListener('error', sdkGlobalHandler);

    expect(runtime.captureFeatureException).toHaveBeenCalledOnce();
    expect(runtime.captureFeatureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'feature from init microtask' }),
      { surface: 'sync', reason: 'init-microtask' },
    );
    expect(sdkGlobalHandler).toHaveBeenCalledOnce();
    expect(runtime.captureEarlyGlobalException).not.toHaveBeenCalled();
    // The initial bridge contributes one listener per type. A stale facade
    // would reinstall both from the queued capture before dispatching error.
    expect(
      addEventListenerSpy.mock.calls.filter(([type]) => type === 'unhandledrejection'),
    ).toHaveLength(1);
    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'error')).toHaveLength(2); // temporary bridge + simulated SDK handler
  });

  it('preserves breadcrumb/exception chronology through the ordered queue', async () => {
    const operationOrder: string[] = [];
    const runtime = makeRuntime(operationOrder);
    let releaseImport:
      ((module: { initSentryBrowserRuntime: () => BrowserSentryRuntime }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ initSentryBrowserRuntime: () => BrowserSentryRuntime }>((resolve) => {
          releaseImport = resolve;
        }),
    );
    __testing.setRuntimeImporter(importer);

    addBreadcrumb({ category: 'sync', message: 'before', level: 'info' });
    captureFeatureException(new Error('first'), { surface: 'sync', reason: 'one' });
    addBreadcrumb({ category: 'sync', message: 'between', level: 'info' });
    captureFeatureException(new Error('second'), { surface: 'sync', reason: 'two' });

    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    releaseImport?.({ initSentryBrowserRuntime: () => runtime });
    await initSentryBrowser();

    expect(operationOrder).toEqual([
      'breadcrumb:before',
      'feature:first:one',
      'breadcrumb:between',
      'feature:second:two',
    ]);
  });

  it('bounds breadcrumb and exception operations by evicting the oldest same-kind entry', async () => {
    const runtime = makeRuntime();
    let releaseImport:
      ((module: { initSentryBrowserRuntime: () => BrowserSentryRuntime }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ initSentryBrowserRuntime: () => BrowserSentryRuntime }>((resolve) => {
          releaseImport = resolve;
        }),
    );
    __testing.setRuntimeImporter(importer);

    for (let index = 0; index < __testing.limits.breadcrumbs + 5; index += 1) {
      addBreadcrumb({ category: 'sync', message: `crumb-${index}`, level: 'info' });
    }
    for (let index = 0; index < __testing.limits.exceptions + 5; index += 1) {
      captureFeatureException(new Error(`error-${index}`), {
        surface: 'sync',
        reason: `reason-${index}`,
      });
    }

    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    releaseImport?.({ initSentryBrowserRuntime: () => runtime });
    await initSentryBrowser();

    expect(runtime.addBreadcrumb).toHaveBeenCalledTimes(__testing.limits.breadcrumbs);
    expect(runtime.captureFeatureException).toHaveBeenCalledTimes(__testing.limits.exceptions);
    expect(runtime.addBreadcrumb).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'crumb-5' }),
    );
    expect(runtime.captureFeatureException).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'error-5' }),
      expect.objectContaining({ reason: 'reason-5' }),
    );
  });

  it('never retains or replays an arbitrary non-Error feature payload', async () => {
    const runtime = makeRuntime();
    let releaseImport:
      ((module: { initSentryBrowserRuntime: () => BrowserSentryRuntime }) => void) | undefined;
    const importer = vi.fn(
      () =>
        new Promise<{ initSentryBrowserRuntime: () => BrowserSentryRuntime }>((resolve) => {
          releaseImport = resolve;
        }),
    );
    __testing.setRuntimeImporter(importer);
    const rejection = {
      message: 'provider failure',
      payload: { snippet: 'private mailbox content' },
    };

    captureFeatureException(rejection, {
      surface: 'sync',
      reason: 'provider-rejection',
    });
    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    releaseImport?.({ initSentryBrowserRuntime: () => runtime });
    await initSentryBrowser();

    const replayed = vi.mocked(runtime.captureFeatureException).mock.calls[0]?.[0];
    expect(replayed).toBeInstanceOf(Error);
    expect(replayed).not.toBe(rejection);
    expect(replayed).toMatchObject({
      name: 'NonErrorException',
      message: 'A non-Error value reached an exception boundary.',
    });
    expect(replayed).not.toHaveProperty('payload');
    expect(JSON.stringify(replayed)).not.toContain('private mailbox content');
  });

  it('warns generically once, drops failed-attempt errors, then recovers on one backoff retry', async () => {
    vi.useFakeTimers();
    const runtime = makeRuntime();
    const init = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('private init failure detail');
      })
      .mockReturnValueOnce(runtime);
    const importer = vi.fn().mockResolvedValue({ initSentryBrowserRuntime: init });
    __testing.setRuntimeImporter(importer);

    captureFeatureException(new Error('drop after failed attempt'), {
      surface: 'sync',
      reason: 'first',
    });
    await initSentryBrowser();

    expect(importer).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      '[sentry] Browser observability failed to load; one retry will be attempted.',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('private init failure detail');
    expect(
      addEventListenerSpy.mock.calls.filter(
        ([type]) => type === 'error' || type === 'unhandledrejection',
      ),
    ).toHaveLength(4);

    captureFeatureException(new Error('retain during backoff'), {
      surface: 'sync',
      reason: 'second',
    });
    dispatchEarlyError(new Error('global during backoff'));
    await vi.advanceTimersByTimeAsync(__testing.retryBackoffMs);
    await initSentryBrowser();

    expect(importer).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(runtime.captureFeatureException).toHaveBeenCalledTimes(1);
    expect(runtime.captureFeatureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'retain during backoff' }),
      expect.objectContaining({ reason: 'second' }),
    );
    expect(runtime.captureEarlyGlobalException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'global during backoff' }),
      'window-error',
    );
  });

  it('limits failures to one retry and removes temporary listeners when exhausted', async () => {
    vi.useFakeTimers();
    const importer = vi.fn().mockRejectedValue(new Error('chunk unavailable'));
    __testing.setRuntimeImporter(importer);

    captureFeatureException(new Error('first'), { surface: 'sync', reason: 'first' });
    await initSentryBrowser();
    await vi.advanceTimersByTimeAsync(__testing.retryBackoffMs);
    await initSentryBrowser();

    expect(importer).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(
      removeEventListenerSpy.mock.calls.filter(
        ([type]) => type === 'error' || type === 'unhandledrejection',
      ),
    ).toHaveLength(2);

    captureFeatureException(new Error('third'), { surface: 'sync', reason: 'third' });
    await initSentryBrowser();
    await vi.runOnlyPendingTimersAsync();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('times out a stuck import, releases awaited boundaries, and retries without retained errors', async () => {
    vi.useFakeTimers();
    const runtime = makeRuntime();
    const neverSettles = new Promise<{
      initSentryBrowserRuntime: () => BrowserSentryRuntime;
    }>(() => undefined);
    const importer = vi
      .fn()
      .mockReturnValueOnce(neverSettles)
      .mockResolvedValueOnce({ initSentryBrowserRuntime: () => runtime });
    __testing.setRuntimeImporter(importer);

    captureFeatureException(
      Object.assign(new Error('must be released'), {
        body: { snippet: 'private retained body' },
      }),
      { surface: 'sync', reason: 'stuck-import' },
    );
    const boundaryCapture = captureSentryBoundaryException(
      new Error('boundary'),
      'senders',
      'digest-timeout',
    );

    await vi.advanceTimersByTimeAsync(__testing.loadAttemptTimeoutMs);
    await expect(boundaryCapture).resolves.toBe(false);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(__testing.retryBackoffMs);
    await initSentryBrowser();

    expect(importer).toHaveBeenCalledTimes(2);
    expect(runtime.captureFeatureException).not.toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
  });

  it('uses an exception as the immediate fast path and cancels the idle load', async () => {
    const runtime = makeRuntime();
    const importer = vi.fn(async () => ({ initSentryBrowserRuntime: () => runtime }));
    __testing.setRuntimeImporter(importer);

    scheduleSentryBrowserInit();
    captureFeatureException(new Error('boom'), { surface: 'brief', reason: 'refresh' });
    await initSentryBrowser();

    expect(cancelIdleCallback).toHaveBeenCalledWith(41);
    expect(runtime.captureFeatureException).toHaveBeenCalledWith(expect.any(Error), {
      surface: 'brief',
      reason: 'refresh',
    });
  });

  it('lets an awaited boundary capture report SDK availability', async () => {
    const runtime = makeRuntime();
    const importer = vi.fn(async () => ({ initSentryBrowserRuntime: () => runtime }));
    __testing.setRuntimeImporter(importer);
    const error = new Error('boundary');

    await expect(captureSentryBoundaryException(error, 'senders', 'digest-2')).resolves.toBe(true);
    expect(runtime.captureBoundaryException).toHaveBeenCalledWith(error, 'senders', 'digest-2');
  });
});
