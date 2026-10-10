import { describe, expect, it } from 'vitest';
import { initialRecoveryDelay } from './initial-sync-recovery.js';

describe('terminal initial-scan recovery policy', () => {
  it('allows exactly three durable recoveries at 15, 30 and 60 minutes', () => {
    expect([0, 1, 2, 3].map((n) => initialRecoveryDelay('TransientError', n))).toEqual([
      900_000,
      1_800_000,
      3_600_000,
      null,
    ]);
  });
  it('honors longer provider Retry-After and rejects invalid delays', () => {
    expect(initialRecoveryDelay('RateLimitError', 0, 7_200_000)).toBe(7_200_000);
    for (const delay of [NaN, Infinity, -1])
      expect(initialRecoveryDelay('RateLimitError', 0, delay)).toBe(900_000);
  });
  it.each([
    'InvalidGrantError',
    'AuthExpiredError',
    'ProviderPermissionError',
    'PermanentError',
    'ValidationError',
    'Error',
  ])('does not automatically retry %s', (code) => {
    expect(initialRecoveryDelay(code, 0)).toBeNull();
  });
});
