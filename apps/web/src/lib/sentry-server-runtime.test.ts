import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrubSentryEvent } from '@declutrmail/shared/observability';

const { init, captureRequestError } = vi.hoisted(() => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ init, captureRequestError }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  init.mockReset();
});

for (const runtime of ['server', 'edge'] as const) {
  describe(`${runtime} Sentry boundary`, () => {
    async function boot() {
      if (runtime === 'server') await import('../../sentry.server.config');
      else await import('../../sentry.edge.config');
    }
    it('does nothing without a DSN', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      await boot();
      expect(init).not.toHaveBeenCalled();
    });
    it('scrubs every egress channel while retaining source-map identity', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
      await boot();
      const options = init.mock.calls[0]![0];
      expect(options.defaultIntegrations).toBe(false);
      expect(options.dataCollection).toMatchObject({
        httpHeaders: { request: false, response: false },
        urlQueryParams: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      });
      const secret = 'synthetic-mailbox-content@example.invalid';
      const event = {
        event_id: 'a'.repeat(32),
        release: 'abcdef123456',
        message: secret,
        user: { email: secret },
        extra: { subject: secret },
        request: { headers: { subject: secret } },
        contexts: { arbitrary: { text: secret } },
        exception: {
          values: [
            {
              type: 'TypeError',
              value: secret,
              stacktrace: {
                frames: [
                  {
                    filename: '/.next/server/app/(app)/senders/[id]/page.js',
                    function: 'render',
                    lineno: 42,
                    vars: { secret },
                  },
                ],
              },
            },
          ],
        },
      };
      const clean = options.beforeSend(event);
      expect(JSON.stringify(clean)).not.toContain(secret);
      expect(clean).toMatchObject({
        release: 'abcdef123456',
        exception: {
          values: [
            {
              type: 'TypeError',
              stacktrace: {
                frames: [
                  {
                    filename: 'app:///.next/server/app/(app)/senders/[id]/page.js',
                    function: 'render',
                    lineno: 42,
                  },
                ],
              },
            },
          ],
        },
      });
      for (const hook of ['beforeSendLog', 'beforeSendMetric', 'beforeSendTransaction'])
        expect(options[hook]({ message: secret })).toBeNull();
      expect(
        JSON.stringify(
          options.beforeBreadcrumb({
            category: 'console',
            message: secret,
            data: { subject: secret },
          }),
        ),
      ).not.toContain(secret);
      const instrumentation = await import('../../instrumentation');
      await instrumentation.onRequestError(
        new Error('synthetic'),
        { path: '/', method: 'GET', headers: {} },
        { routerKind: 'App Router', routePath: '/', routeType: 'render' },
      );
      expect(captureRequestError).toHaveBeenCalled();
    });
    it('does not abort application bootstrap when Sentry throws', async () => {
      vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
      init.mockImplementationOnce(() => {
        throw new Error('private-sdk-error');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(boot()).resolves.toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-sdk-error');
    });
  });
}

it('retains only static Next route-template paths for server symbolication', () => {
  for (const segment of ['(app)', '[id]', '[...slug]', '[[...slug]]']) {
    const filename = `/.next/server/app/${segment}/page.js`;
    const result = scrubSentryEvent(
      { exception: { values: [{ type: 'Error', stacktrace: { frames: [{ filename }] } }] } },
      'server',
    );
    expect(JSON.stringify(result)).toContain(`app://${filename}`);
  }
  for (const segment of ['[private@example.invalid]', '(private message)', '[id]?token=private']) {
    const result = scrubSentryEvent(
      {
        exception: {
          values: [
            {
              type: 'Error',
              stacktrace: { frames: [{ filename: `/.next/server/app/${segment}/page.js` }] },
            },
          ],
        },
      },
      'server',
    );
    expect(JSON.stringify(result)).not.toContain('private');
  }
});

it('keeps SDK capture failures out of the Next request-error path', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  captureRequestError.mockRejectedValueOnce(new Error('private-sdk-details'));
  const instrumentation = await import('../../instrumentation');
  await expect(
    instrumentation.onRequestError(
      new Error('synthetic'),
      { path: '/', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/', routeType: 'render' },
    ),
  ).resolves.toBeUndefined();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-sdk-details');
});
