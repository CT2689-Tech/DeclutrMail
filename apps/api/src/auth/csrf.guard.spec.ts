import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';

function makeCtx(input: {
  method: string;
  cookieValue?: string;
  headerValue?: string;
}): ExecutionContext {
  const cookies = input.cookieValue === undefined ? {} : { dm_csrf: input.cookieValue };
  const headers = input.headerValue === undefined ? {} : { 'x-csrf-token': input.headerValue };
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: input.method, cookies, headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard (D155 double-submit)', () => {
  const guard = new CsrfGuard(new CsrfService());

  it('passes through safe methods without checking', () => {
    expect(guard.canActivate(makeCtx({ method: 'GET' }))).toBe(true);
    expect(guard.canActivate(makeCtx({ method: 'HEAD' }))).toBe(true);
    expect(guard.canActivate(makeCtx({ method: 'OPTIONS' }))).toBe(true);
  });

  it('rejects POST without the header', () => {
    expect(() => guard.canActivate(makeCtx({ method: 'POST', cookieValue: 'abc' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects POST without the cookie', () => {
    expect(() => guard.canActivate(makeCtx({ method: 'POST', headerValue: 'abc' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects mismatched cookie / header', () => {
    expect(() =>
      guard.canActivate(makeCtx({ method: 'DELETE', cookieValue: 'abc', headerValue: 'xyz' })),
    ).toThrow(ForbiddenException);
  });

  it('passes when cookie + header are equal', () => {
    expect(
      guard.canActivate(makeCtx({ method: 'POST', cookieValue: 'tok-1', headerValue: 'tok-1' })),
    ).toBe(true);
  });

  it('enforces CSRF on PATCH', () => {
    expect(() => guard.canActivate(makeCtx({ method: 'PATCH' }))).toThrow(ForbiddenException);
    expect(
      guard.canActivate(makeCtx({ method: 'PATCH', cookieValue: 'x', headerValue: 'x' })),
    ).toBe(true);
  });
});
