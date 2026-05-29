import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { correlationMiddleware, parseTraceId } from './correlation.middleware.js';

function run(headers: Record<string, string | string[]>): {
  req: Request;
  headersSet: Record<string, string>;
  nextCalled: boolean;
} {
  const headersSet: Record<string, string> = {};
  const req = { headers } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      headersSet[k] = v;
    },
  } as unknown as Response;
  let nextCalled = false;
  const next: NextFunction = vi.fn(() => {
    nextCalled = true;
  });

  correlationMiddleware(req, res, next);
  return { req, headersSet, nextCalled };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlationMiddleware (D168)', () => {
  it('mints a uuid correlationId + DM display id when no header is supplied', () => {
    const { req, headersSet, nextCalled } = run({});

    expect(req.correlationId).toMatch(UUID_RE);
    expect(req.displayId).toMatch(/^DM-[0-9A-F]{6}$/);
    expect(req.traceId).toBeNull();
    expect(headersSet['X-Correlation-Id']).toBe(req.correlationId);
    expect(headersSet['X-Display-Id']).toBe(req.displayId);
    expect(nextCalled).toBe(true);
  });

  it('reuses a well-formed inbound X-Request-Id', () => {
    const inbound = '7f2a91d4-1111-4000-8000-000000000000';
    const { req } = run({ 'x-request-id': inbound });

    expect(req.correlationId).toBe(inbound);
    expect(req.displayId).toBe('DM-7F2A91');
  });

  it('ignores a malformed inbound id and mints a fresh one', () => {
    const { req } = run({ 'x-request-id': 'not-a-uuid' });
    expect(req.correlationId).toMatch(UUID_RE);
    expect(req.correlationId).not.toBe('not-a-uuid');
  });

  it('propagates a W3C traceparent trace-id', () => {
    const { req } = run({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(req.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

describe('parseTraceId', () => {
  it('returns null for missing / malformed / all-zero trace-ids', () => {
    expect(parseTraceId(undefined)).toBeNull();
    expect(parseTraceId('garbage')).toBeNull();
    expect(parseTraceId('00-short-span-01')).toBeNull();
    expect(parseTraceId('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
  });

  it('extracts a valid trace-id', () => {
    expect(parseTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
  });
});
