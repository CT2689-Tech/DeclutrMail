import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { RequestTimingInterceptor } from './request-timing.interceptor.js';

@Controller('senders')
class SendersProbeController {
  @Get('summary')
  summary(): { ok: true } {
    return { ok: true };
  }
}

@Controller('healthz')
class HealthProbeController {
  @Get()
  ping(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

function makeContext(opts: {
  handler: (...args: unknown[]) => unknown;
  controller: new () => unknown;
  method?: string;
  statusCode?: number;
  correlationId?: string;
  url?: string;
}): ExecutionContext {
  const req = {
    method: opts.method ?? 'GET',
    correlationId: opts.correlationId,
    url: opts.url ?? '/api/senders/summary?email=secret@example.com',
    query: { email: 'secret@example.com' },
  };
  const res = { statusCode: opts.statusCode ?? 200 } as unknown as Response;
  return {
    getType: () => 'http',
    getHandler: () => opts.handler,
    getClass: () => opts.controller,
    switchToHttp: () => ({
      getRequest: () => req as unknown as Request,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('RequestTimingInterceptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs method, route template, status, and duration_ms — not the raw URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const interceptor = new RequestTimingInterceptor();
    const controller = new SendersProbeController();
    const ctx = makeContext({
      handler: controller.summary,
      controller: SendersProbeController,
      correlationId: '11111111-1111-4111-8111-111111111111',
    });

    const obs = interceptor.intercept(ctx, { handle: () => of({ ok: true }) } as CallHandler);
    await new Promise<void>((resolve) => obs.subscribe({ next: () => resolve() }));

    expect(log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      level: 'info',
      kind: 'http.request',
      method: 'GET',
      route: 'GET /api/senders/summary',
      status: 200,
      correlationId: '11111111-1111-4111-8111-111111111111',
    });
    expect(typeof payload.duration_ms).toBe('number');
    expect(JSON.stringify(payload)).not.toContain('secret@example.com');
    expect(payload).not.toHaveProperty('url');
    expect(payload).not.toHaveProperty('query');
  });

  it('logs the HTTP status from a thrown HttpException', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const interceptor = new RequestTimingInterceptor();
    const controller = new SendersProbeController();
    const ctx = makeContext({
      handler: controller.summary,
      controller: SendersProbeController,
    });

    const obs = interceptor.intercept(ctx, {
      handle: () => throwError(() => new HttpException('nope', HttpStatus.NOT_FOUND)),
    } as CallHandler);
    await new Promise<void>((resolve, reject) =>
      obs.subscribe({ error: () => resolve(), next: () => reject(new Error('expected error')) }),
    );

    const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload.status).toBe(404);
    expect(JSON.stringify(payload)).not.toContain('nope');
  });

  it('does not log Cloud Run probe routes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const interceptor = new RequestTimingInterceptor();
    const controller = new HealthProbeController();
    const ctx = makeContext({
      handler: controller.ping,
      controller: HealthProbeController,
    });

    const obs = interceptor.intercept(ctx, { handle: () => of({ status: 'ok' }) } as CallHandler);
    await new Promise<void>((resolve) => obs.subscribe({ next: () => resolve() }));

    expect(log).not.toHaveBeenCalled();
  });
});
