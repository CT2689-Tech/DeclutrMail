import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { sdkInit } = vi.hoisted(() => ({ sdkInit: vi.fn() }));
vi.mock('@sentry/node', () => ({
  init: sdkInit,
  anthropicAIIntegration: () => ({ name: 'AnthropicAI' }),
}));
import { __resetForTests, getInitializedSentry, initSentry } from './sentry';

beforeEach(() => {
  __resetForTests();
  sdkInit.mockReset();
  vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('optional Sentry bootstrap', () => {
  it.each([undefined, 'false', '1'])(
    'does not initialize configured development reporting for opt-in %s',
    async (optIn) => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('SENTRY_DEV_ENABLED', optIn);
      expect(await initSentry()).toBe(false);
      expect(sdkInit).not.toHaveBeenCalled();
      expect(getInitializedSentry()).toBeUndefined();
    },
  );
  it.each(['development', 'production'])(
    'preserves intentional reporting in %s',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('SENTRY_DEV_ENABLED', environment === 'development' ? 'true' : 'false');
      expect(await initSentry()).toBe(true);
      expect(sdkInit).toHaveBeenCalledTimes(1);
      expect(sdkInit.mock.calls[0]![0].environment).toBe(environment);
    },
  );
  it('treats an unspecified environment as development', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('SENTRY_DEV_ENABLED', undefined);
    expect(await initSentry()).toBe(false);
    expect(sdkInit).not.toHaveBeenCalled();
  });
  it('does not load an unconfigured SDK', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(await initSentry()).toBe(false);
    expect(sdkInit).not.toHaveBeenCalled();
  });
  it('initializes concurrent callers once and clears the timeout', async () => {
    vi.useFakeTimers();
    expect(await Promise.all([initSentry(), initSentry()])).toEqual([true, true]);
    expect(sdkInit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(await initSentry()).toBe(true);
    expect(sdkInit).toHaveBeenCalledTimes(1);
  });
  it('fails open, emits no SDK detail and permits a retry', async () => {
    sdkInit.mockImplementationOnce(() => {
      throw new Error('secret-dsn-content');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await initSentry()).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-dsn-content');
    expect(await initSentry()).toBe(true);
  });
});

it('bounds a stalled SDK import, avoids duplicate initialization, and recovers when it loads', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let releaseImport!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  const delayedInit = vi.fn();
  const captureException = vi.fn();
  vi.doMock('@sentry/node', async () => {
    await gate;
    return {
      init: delayedInit,
      anthropicAIIntegration: () => ({ name: 'AnthropicAI' }),
      captureException,
      withScope: (callback: (scope: unknown) => void) =>
        callback({ setTags: vi.fn(), setContext: vi.fn() }),
    };
  });
  try {
    const module = await import('./sentry');
    const first = module.initSentry();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toBe(false);
    const { createSentryWorkerObserver } = await import('./sentry-worker-observer');
    const observer = await createSentryWorkerObserver({
      dsnSet: false,
      getSdk: module.getInitializedSentry,
    });
    observer.captureBackgroundFailure(new Error('synthetic'), {
      kind: 'reconciler.failed',
      tags: {},
    });
    expect(captureException).not.toHaveBeenCalled();
    const second = module.initSentry();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await second).toBe(false);
    expect(delayedInit).not.toHaveBeenCalled();
    releaseImport();
    await vi.advanceTimersByTimeAsync(0);
    expect(await module.initSentry()).toBe(true);
    expect(delayedInit).toHaveBeenCalledTimes(1);
    observer.captureBackgroundFailure(new Error('synthetic'), {
      kind: 'reconciler.failed',
      tags: {},
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    releaseImport();
    vi.doUnmock('@sentry/node');
    vi.resetModules();
  }
});

it('fails open when the SDK chunk cannot load', async () => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.doMock('@sentry/node', () => {
    throw new Error('private-loader-details');
  });
  try {
    const module = await import('./sentry');
    expect(await module.initSentry()).toBe(false);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      'private-loader-details',
    );
  } finally {
    vi.doUnmock('@sentry/node');
    vi.resetModules();
  }
});
