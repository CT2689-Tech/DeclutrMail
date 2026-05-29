import { describe, expect, it } from 'vitest';

import { ERROR_CODES, isErrorCode } from './error-codes';

describe('ERROR_CODES registry (ADR-0014)', () => {
  it('every entry is a well-formed spec', () => {
    for (const [code, spec] of Object.entries(ERROR_CODES)) {
      expect(spec.status, code).toBeGreaterThanOrEqual(400);
      expect(['silent_transient', 'inline_recoverable', 'critical_trust']).toContain(
        spec.severityTier,
      );
      expect(typeof spec.retryable, code).toBe('boolean');
      expect(spec.message.length, code).toBeGreaterThan(0);
    }
  });

  it('classifies the known domain + trust codes', () => {
    expect(ERROR_CODES.NO_ACTIVE_MAILBOX).toMatchObject({
      status: 409,
      severityTier: 'inline_recoverable',
      retryable: false,
    });
    // D170 critical-trust: OAuth revoked surfaces as a banner-worthy tier.
    expect(ERROR_CODES.OAUTH_REVOKED).toMatchObject({
      status: 409,
      severityTier: 'critical_trust',
      retryable: false,
    });
    // Rate limiting is the one generic code that is retryable.
    expect(ERROR_CODES.RATE_LIMITED.retryable).toBe(true);
  });
});

describe('isErrorCode', () => {
  it('accepts registered codes and rejects everything else', () => {
    expect(isErrorCode('NO_ACTIVE_MAILBOX')).toBe(true);
    expect(isErrorCode('RATE_LIMITED')).toBe(true);
    expect(isErrorCode('NOT_A_REAL_CODE')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    // Must not be fooled by inherited Object.prototype keys.
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('constructor')).toBe(false);
  });
});
