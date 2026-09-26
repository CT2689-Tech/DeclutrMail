import { describe, expect, it } from 'vitest';

import { GMAIL_ACCESS_MISSING_RESULT, parseSignInResult, SIGN_IN_RESULTS } from './oauth-return';

describe('parseSignInResult (D108)', () => {
  it('accepts every closed /sign-in result', () => {
    for (const result of SIGN_IN_RESULTS) {
      expect(parseSignInResult(result)).toBe(result);
    }
    expect(SIGN_IN_RESULTS).toContain(GMAIL_ACCESS_MISSING_RESULT);
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'unexpected'],
    ['non-scalar', ['failed']],
    ['case variant', 'FAILED'],
  ])('rejects a %s value', (_label, value) => {
    expect(parseSignInResult(value)).toBeUndefined();
  });
});
