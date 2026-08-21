import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CanActivate } from '@nestjs/common';
import { ConflictException, Injectable } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { correlationMiddleware } from './correlation.middleware.js';
import { requestTimingMiddleware } from './request-timing.middleware.js';

/**
 * Booted against a real Nest app, deliberately.
 *
 * The version this replaces was an interceptor tested through a
 * hand-rolled ExecutionContext. That harness could not observe the defect
 * that mattered: Nest runs guards BEFORE interceptors, so a guard
 * rejection never reached it and every 401/409 went unlogged. A fake
 * context cannot reproduce ordering — only a booted app can, so these
 * tests drive real HTTP.
 */
@Injectable()
class RejectingGuard implements CanActivate {
  canActivate(): boolean {
    throw new ConflictException({ code: 'NO_ACTIVE_MAILBOX' });
  }
}

@Controller('probe')
class ProbeController {
  @Get()
  index(): { ok: true } {
    return { ok: true };
  }

  @Get('guarded')
  @UseGuards(RejectingGuard)
  guarded(): { ok: true } {
    return { ok: true };
  }
}

@Controller('healthz')
class HealthzController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

describe('requestTimingMiddleware', () => {
  let app: INestApplication;
  let log: ReturnType<typeof vi.spyOn>;
  let base: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController, HealthzController],
      providers: [RejectingGuard],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(correlationMiddleware);
    app.use(requestTimingMiddleware);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await app.listen(0);
    base = await app.getUrl();
  });

  afterEach(async () => {
    log.mockRestore();
    await app.close();
  });

  const lines = (): Array<Record<string, unknown>> =>
    (log.mock.calls as unknown[][])
      .map((c): Record<string, unknown> => {
        try {
          return JSON.parse(String(c[0])) as Record<string, unknown>;
        } catch {
          return {};
        }
      })
      .filter((l: Record<string, unknown>) => l.kind === 'http.request');

  it('logs a route template and status for a successful request', async () => {
    await fetch(`${base}/api/probe`);
    const [line] = lines();
    expect(line).toMatchObject({ method: 'GET', status: 200 });
    expect(line?.route).toBe('GET /api/probe');
    // Never the raw URL (D7): query strings and path params carry emails.
    expect(JSON.stringify(line)).not.toContain('?');
  });

  it('LOGS A GUARD REJECTION — the case an interceptor could not see', async () => {
    // The defect this file exists for. Guards run before interceptors, so
    // the previous implementation emitted nothing for 401/409/404 — the
    // 409-storm class (CLAUDE.md §8) was structurally invisible.
    const res = await fetch(`${base}/api/probe/guarded`);
    expect(res.status).toBe(409);
    const [line] = lines();
    expect(line).toMatchObject({ status: 409, route: 'GET /api/probe/guarded' });
  });

  it('logs an unmatched route without leaking the URL', async () => {
    await fetch(`${base}/api/nope/secret-token-abc`);
    const [line] = lines();
    expect(line?.route).toBe('GET unmatched');
    expect(JSON.stringify(line)).not.toContain('secret-token-abc');
  });

  it('skips health probes', async () => {
    await fetch(`${base}/api/healthz`);
    expect(lines()).toHaveLength(0);
  });

  it('measures real elapsed time, not zero', async () => {
    // A shape assertion (`typeof === 'number'`) passed even when the timer
    // was started at emit time. This constrains the value.
    await fetch(`${base}/api/probe`);
    const [line] = lines();
    expect(typeof line?.durationMs).toBe('number');
    expect(line?.durationMs as number).toBeGreaterThan(0);
  });

  it('uses field names that join with the rest of the repo', async () => {
    await fetch(`${base}/api/probe`);
    const [line] = lines();
    // `durationMs` (60 uses) not `duration_ms`; `cid` matching
    // AllExceptionsFilter, not `correlationId`.
    expect(line).toHaveProperty('durationMs');
    expect(line).not.toHaveProperty('duration_ms');
    expect(line).toHaveProperty('cid');
    expect(line).not.toHaveProperty('correlationId');
  });
});
