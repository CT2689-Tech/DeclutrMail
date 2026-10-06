import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES } from '@declutrmail/shared/contracts';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from './app-exception.js';

const sentryHarness = vi.hoisted(() => ({
  captured: [] as Error[],
  tags: [] as Array<Record<string, unknown>>,
  fingerprints: [] as string[][],
}));

vi.mock('@sentry/node', () => ({
  withScope(
    callback: (scope: {
      setTags(tags: Record<string, unknown>): void;
      setTag(key: string, value: string): void;
      setFingerprint(parts: string[]): void;
    }) => void,
  ) {
    callback({
      setTags(tags) {
        sentryHarness.tags.push(tags);
      },
      setTag(key, value) {
        sentryHarness.tags.push({ [key]: value });
      },
      setFingerprint(parts) {
        sentryHarness.fingerprints.push(parts);
      },
    });
  },
  captureException(error: Error) {
    sentryHarness.captured.push(error);
  },
}));

/**
 * Tests for the D168 error envelope + D169 severity classification.
 *
 * Locks in: the full envelope shape, the 429 → 'RATE_LIMITED' mapping
 * the rate-limit interceptor depends on (D156), status-derived
 * retryable/severityTier (D169), AppException passthrough (incl. D170
 * critical_trust), the CLIENT-facing 5xx message staying generic
 * (unrelated to and unaffected by the Sentry/log policy below), the
 * real exception now reaching Sentry/Cloud Logging for 5xx (founder
 * decision 2026-08-28 — those are internal tooling), and the defensive
 * correlationId fallback when the middleware did not run.
 */
function invoke(
  filter: AllExceptionsFilter,
  exception: unknown,
  req: Record<string, unknown> = { method: 'GET', path: '/api/test' },
): { status: number; body: { error: Record<string, unknown> } } {
  const statusFn = vi.fn().mockReturnThis();
  const jsonFn = vi.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusFn, json: jsonFn }),
      getRequest: () => req,
    }),
  };

  filter.catch(exception, host as unknown as Parameters<AllExceptionsFilter['catch']>[1]);

  return {
    status: statusFn.mock.calls[0]?.[0] as number,
    body: jsonFn.mock.calls[0]?.[0] as { error: Record<string, unknown> },
  };
}

const REQ_WITH_CORRELATION = {
  method: 'POST',
  path: '/api/actions',
  correlationId: '7f2a91d4-0000-4000-8000-000000000000',
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  displayId: 'DM-7F2A91',
};

describe('AllExceptionsFilter — D168 envelope + D169 tiers', () => {
  it('resolves inherited icon/OAuth filters with actual SWC dependency metadata, with and without the reader', () => {
    // Exercise the API startup loader and actual route-scoped subclasses;
    // a base-class/readiness-only harness misses inherited DI requirements.
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        '@swc-node/register/esm-register',
        '--input-type=module',
        '-e',
        `
        import 'reflect-metadata';
        import assert from 'node:assert/strict';
        import { Test } from '@nestjs/testing';
        import { IconErrorFilter } from './src/icons/icon-error.filter.ts';
        import { ConnectMailboxStartFilter } from './src/auth/connect-mailbox-start.filter.ts';
        import { LoginStartExitFilter, OAuthCallbackExitFilter } from './src/auth/oauth-exit.filter.ts';
        import { JwtService } from './src/auth/jwt.service.ts';
        import { DbModule, API_POOL_DIAGNOSTICS } from './src/db/db.module.ts';
        const filters = [IconErrorFilter, ConnectMailboxStartFilter, LoginStartExitFilter, OAuthCallbackExitFilter];
        await assert.rejects(
          Test.createTestingModule({ providers: [OAuthCallbackExitFilter] }).compile(),
          /JwtService/,
        );
        for (const mode of ['absent', 'present', 'throwing']) {
          const imports = mode === 'present' ? [DbModule] : [];
          const module = await Test.createTestingModule({
            imports, providers: [
              ...filters, { provide: JwtService, useValue: { openOAuthState: () => null } },
              ...(mode === 'throwing' ? [{ provide: API_POOL_DIAGNOSTICS, useValue: () => {
                throw new Error('synthetic diagnostic failure');
              } }] : []),
            ],
          }).compile();
          try {
            const records = [];
            const original = console.error;
            console.error = (line) => records.push(JSON.parse(line));
            try {
              const req = { method: 'GET', route: { path: '/api/test' }, query: {}, cookies: {} };
              const responses = [];
              const res = {
                req, headersSent: false,
                status(code) { responses.push(['status', code]); return this; }, json() {},
                end() { responses.push(['end']); }, removeHeader() {}, clearCookie() {},
                redirect(code, url) { responses.push(['redirect', code, url]); },
              };
              const host = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
              for (const Filter of filters) module.get(Filter).catch(new Error('synthetic failure'), host);
              assert.deepEqual(responses, [
                ['status', 500], ['end'],
                ['redirect', 302, 'https://fixture.example.test/settings?connect_start_result=failed#mailboxes'],
                ['redirect', 302, 'https://fixture.example.test/sign-in?auth_result=failed'],
                ['redirect', 302, 'https://fixture.example.test/sign-in?auth_result=failed'],
              ]);
            } finally { console.error = original; }
            assert.equal(records.length, filters.length);
            for (const record of records) {
              assert.equal(record.kind, 'exception.5xx');
              if (imports.length) assert.deepEqual(record.databasePool, {
                driver: 'node-postgres', total: 0, idle: 0, waiting: 0, checkedOut: 0, oldestCheckoutMs: 0,
              });
              else assert.equal(record.databasePool, undefined);
            }
          } finally { await module.close(); }
        }
        console.log('filter-metadata-ok');
      `,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          SENTRY_DSN: '',
          WEB_URL: 'https://fixture.example.test',
          DATABASE_URL: 'postgres://synthetic:local@127.0.0.1:1/db',
          API_DB_DRIVER: 'node-postgres',
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('filter-metadata-ok');
  });
  it('adds pool context only to the existing 5xx log and preserves failure handling if it throws', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const snapshot = {
      driver: 'node-postgres' as const,
      total: 10,
      idle: 0,
      waiting: 20,
      checkedOut: 10,
      oldestCheckoutMs: 65_000,
    };
    const read = vi.fn(() => snapshot);
    try {
      const response = invoke(
        new AllExceptionsFilter().withPoolDiagnostics(read),
        new Error('synthetic outage'),
      );
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('databasePool');
      expect(JSON.parse(log.mock.calls[0]![0]).databasePool).toEqual(snapshot);
      expect(read).toHaveBeenCalledTimes(1);
      read.mockClear();
      invoke(
        new AllExceptionsFilter().withPoolDiagnostics(read),
        new BadRequestException('synthetic input'),
      );
      expect(read).not.toHaveBeenCalled();
      const failed = invoke(
        new AllExceptionsFilter().withPoolDiagnostics(() => {
          throw new Error('diagnostic failure');
        }),
        new Error('original failure'),
      );
      expect(failed.status).toBe(500);
      expect(failed.body.error.message).toBe(ERROR_CODES.INTERNAL_ERROR.message);
      expect(JSON.parse(log.mock.calls[1]![0])).toMatchObject({ message: 'original failure' });
      expect(JSON.parse(log.mock.calls[1]![0])).not.toHaveProperty('databasePool');
    } finally {
      log.mockRestore();
    }
  });
  it('preserves the Autopilot preview expiry code for client refresh recovery', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new HttpException(
        {
          code: 'AUTOPILOT_PREVIEW_EXPIRED',
          message: 'This preview expired. Refresh to see current matches.',
        },
        HttpStatus.GONE,
      ),
      REQ_WITH_CORRELATION,
    );
    expect(status).toBe(410);
    expect(body.error).toMatchObject({
      code: 'AUTOPILOT_PREVIEW_EXPIRED',
      retryable: false,
      severityTier: 'inline_recoverable',
    });
  });

  it('maps HTTP 429 to RATE_LIMITED, retryable, inline_recoverable', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new HttpException('Too many requests.', HttpStatus.TOO_MANY_REQUESTS),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(429);
    expect(body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
      correlationId: '7f2a91d4-0000-4000-8000-000000000000',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      displayId: 'DM-7F2A91',
      retryable: true,
      severityTier: 'inline_recoverable',
    });
  });

  it('classifies a 4xx client error as non-retryable', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new BadRequestException('bad input'),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'BAD_REQUEST',
      retryable: false,
      severityTier: 'inline_recoverable',
    });
  });

  it('genericizes 5xx messages and marks them retryable (D7)', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new HttpException('db dsn leaked', HttpStatus.INTERNAL_SERVER_ERROR),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(500);
    expect(body.error.message).toBe(ERROR_CODES.INTERNAL_ERROR.message);
    expect(body.error.retryable).toBe(true);
  });

  it('passes through AppException code/retryable/severityTier (D170)', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new AppException({
        code: 'OAUTH_REVOKED',
        message: 'Reconnect your Gmail account.',
        status: HttpStatus.CONFLICT,
        retryable: false,
        severityTier: 'critical_trust',
      }),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'OAUTH_REVOKED',
      message: 'Reconnect your Gmail account.',
      severityTier: 'critical_trust',
      retryable: false,
    });
  });

  it('preserves a registered domain code from the exception body (ADR-0014)', () => {
    // The mailbox guard throws `new ConflictException({ code, message })`.
    // The filter must surface that domain code, not flatten it to CONFLICT.
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new ConflictException({
        code: 'NO_ACTIVE_MAILBOX',
        message: 'No active Gmail account is connected. Connect one to continue.',
      }),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'NO_ACTIVE_MAILBOX',
      message: 'No active Gmail account is connected. Connect one to continue.',
      severityTier: 'inline_recoverable',
      retryable: false,
    });
  });

  it('falls back to the status code when the body code is unregistered', () => {
    const { body } = invoke(
      new AllExceptionsFilter(),
      new ConflictException({ code: 'NOT_A_REAL_CODE', message: 'nope' }),
      REQ_WITH_CORRELATION,
    );

    expect(body.error.code).toBe('CONFLICT');
  });

  it('treats an unknown thrown value as a 500 INTERNAL_ERROR', () => {
    const { status, body } = invoke(
      new AllExceptionsFilter(),
      new Error('boom'),
      REQ_WITH_CORRELATION,
    );

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe(ERROR_CODES.INTERNAL_ERROR.message);
  });

  it('defensively fills correlation ids when the middleware did not run', () => {
    const { body } = invoke(new AllExceptionsFilter(), new BadRequestException('x'));

    expect(typeof body.error.correlationId).toBe('string');
    expect((body.error.correlationId as string).length).toBeGreaterThan(0);
    expect(body.error.displayId).toMatch(/^DM-[0-9A-F]{6}$/);
    expect(body.error.traceId).toBeNull();
  });

  it('templates the route regardless of the message policy, and sends the real exception to Sentry + logs', async () => {
    const marker = 'MARKER_undo_31ed0f12';
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://public@example.invalid/1';
    sentryHarness.captured.length = 0;
    sentryHarness.tags.length = 0;
    sentryHarness.fingerprints.length = 0;
    let constructorGetterCalls = 0;
    try {
      const exception = Object.assign(new Error(marker), {
        code: 'ECONNRESET',
        response: { status: 502 },
      });
      Object.defineProperty(exception, 'constructor', {
        get() {
          constructorGetterCalls += 1;
          throw new Error(marker);
        },
      });
      exception.stack = `Error: ${marker}\n    at ${marker}`;
      invoke(new AllExceptionsFilter(), exception, {
        ...REQ_WITH_CORRELATION,
        path: `/api/undo/${marker}`,
        route: { path: '/api/undo/:token' },
      });
      await vi.waitFor(() => expect(sentryHarness.captured).toHaveLength(1));

      // The raw request PATH never appears anywhere — only the templated
      // route. `requestOperation()` never reads the path for a matched
      // route, so this protection is independent of, and unaffected by,
      // the message policy asserted below.
      const structural = JSON.stringify({
        logger: loggerSpy.mock.calls,
        tags: sentryHarness.tags,
        fingerprints: sentryHarness.fingerprints,
      });
      expect(structural).not.toContain(marker);
      expect(structural).toContain('/api/undo/:token');
      // Hostile-getter defense: a crafted Error subclass with a throwing
      // `constructor` getter still can't make errorName() throw.
      expect(constructorGetterCalls).toBe(0);

      // The real exception now reaches Sentry and the structured console
      // log (founder decision 2026-08-28: Sentry/Cloud Logging are
      // internal tooling, not a public surface). This is what would have
      // let the 2026-08-28 Supavisor pool-exhaustion incident be
      // diagnosed from Sentry directly instead of raw Postgres/pooler
      // logs — every 5xx used to arrive as an unactionable generic
      // "Server exception". The CLIENT-facing response body is untouched
      // (see the 'genericizes 5xx messages' test above) — this is only
      // about what internal tooling sees.
      const captured = sentryHarness.captured[0]!;
      expect(captured.message).toBe(marker);
      expect(captured.stack).toContain(marker);
      const detail = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(detail.message).toBe(marker);
      expect(detail.code).toBe('ECONNRESET');
      expect(sentryHarness.tags).toContainEqual({ error_code: 'ECONNRESET' });
    } finally {
      if (previousDsn === undefined) {
        delete process.env.SENTRY_DSN;
      } else {
        process.env.SENTRY_DSN = previousDsn;
      }
      loggerSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it('omits numeric and unregistered exception codes from 5xx telemetry', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      invoke(new AllExceptionsFilter(), Object.assign(new Error('failure'), { code: 424_242 }), {
        ...REQ_WITH_CORRELATION,
        route: { path: '/api/test' },
      });

      const detail = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(detail).not.toHaveProperty('code');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('labels an unresolved route as unmatched instead of logging attacker text', () => {
    const leakMarker = 'LEAK_MARKER_unmatched_f8fd951b';
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      invoke(new AllExceptionsFilter(), new BadRequestException('bad input'), {
        ...REQ_WITH_CORRELATION,
        path: `/${leakMarker}`,
      });

      const serialized = JSON.stringify(loggerSpy.mock.calls);
      expect(serialized).not.toContain(leakMarker);
      expect(serialized).toContain('unmatched');
    } finally {
      loggerSpy.mockRestore();
    }
  });
});
