import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { securityHeadersMiddleware } from './security-headers.middleware.js';

function run(): { headersSet: Record<string, string>; nextCalled: boolean } {
  const headersSet: Record<string, string> = {};
  const req = {} as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      headersSet[k] = v;
    },
  } as unknown as Response;
  let nextCalled = false;
  const next: NextFunction = vi.fn(() => {
    nextCalled = true;
  });

  securityHeadersMiddleware(req, res, next);
  return { headersSet, nextCalled };
}

describe('securityHeadersMiddleware (D175)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('sets the helmet-equivalent API header set on every response', () => {
    const { headersSet, nextCalled } = run();

    expect(headersSet['Content-Security-Policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(headersSet['X-Content-Type-Options']).toBe('nosniff');
    expect(headersSet['X-Frame-Options']).toBe('DENY');
    expect(headersSet['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(nextCalled).toBe(true);
  });

  it('omits HSTS outside production (no https pinning on localhost)', () => {
    process.env.NODE_ENV = 'test';
    const { headersSet } = run();
    expect(headersSet['Strict-Transport-Security']).toBeUndefined();
  });

  it('sets HSTS in production — 1y + subdomains, preload OFF (one-way door)', () => {
    process.env.NODE_ENV = 'production';
    const { headersSet } = run();
    expect(headersSet['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headersSet['Strict-Transport-Security']).not.toContain('preload');
  });
});
