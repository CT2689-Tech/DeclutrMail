import { describe, expect, it } from 'vitest';

import { CsrfService } from './csrf.service.js';

/**
 * CsrfService unit tests (D155 double-submit cookie).
 */
describe('CsrfService (D155)', () => {
  const svc = new CsrfService();

  it('issues distinct base64url tokens', () => {
    const a = svc.issue();
    const b = svc.issue();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(32);
  });

  it('verifies matching cookie + header values', () => {
    const t = svc.issue();
    expect(svc.verify(t, t)).toBe(true);
  });

  it('rejects mismatched values', () => {
    expect(svc.verify(svc.issue(), svc.issue())).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(svc.verify(undefined, undefined)).toBe(false);
    expect(svc.verify('valid', undefined)).toBe(false);
    expect(svc.verify(123 as unknown, 'valid')).toBe(false);
  });

  it('rejects different-length inputs', () => {
    expect(svc.verify('short', 'a-longer-value')).toBe(false);
  });
});
