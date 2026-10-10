import { onboardingPathKeepingOAuthResult } from '@/features/onboarding/onboarding-return-to';
import { describe, expect, it } from 'vitest';

import { connectErrorCode, oauthResultIn } from './oauth-result';

describe('oauthResultIn', () => {
  it('reads a closed reconnect result and its line', () => {
    expect(oauthResultIn('?reconnect_result=gmail_access_missing')).toMatchObject({
      param: 'reconnect_result',
      value: 'gmail_access_missing',
      copy: { liveRole: 'status' },
    });
  });

  it('drops a reconnect or start result it does not know', () => {
    expect(oauthResultIn('?reconnect_result=not-a-result')).toBeNull();
    expect(oauthResultIn('?connect_start_result=not-a-result')).toBeNull();
  });

  it.each(['something-new', 'toString', '__proto__'])(
    'reads the unlisted connect_error %s as a plain connect failure',
    (code) => {
      expect(oauthResultIn(`?connect_error=${code}`)).toEqual({
        param: 'connect_error',
        value: 'connect_failed',
        copy: {
          message: 'Could not connect that Gmail account. Try again.',
          tone: 'danger',
          liveRole: 'alert',
        },
      });
    },
  );

  it('ignores an empty connect_error', () => {
    expect(oauthResultIn('?connect_error=')).toBeNull();
  });
});

describe('connectErrorCode', () => {
  it('keeps a listed code and maps anything else to connect_failed', () => {
    expect(connectErrorCode('MAILBOX_OWNED_BY_OTHER_WORKSPACE')).toBe(
      'MAILBOX_OWNED_BY_OTHER_WORKSPACE',
    );
    expect(connectErrorCode('hasOwnProperty')).toBe('connect_failed');
  });
});

describe('onboardingPathKeepingOAuthResult', () => {
  it('keeps only the closed result, never the mailbox hash or other params', () => {
    expect(
      onboardingPathKeepingOAuthResult('?reconnect_result=success&mailbox=abc&returnTo=/billing'),
    ).toBe('/onboarding?reconnect_result=success&returnTo=%2Fbilling');
    expect(onboardingPathKeepingOAuthResult('?connect_error=weird')).toBe(
      '/onboarding?connect_error=connect_failed',
    );
    expect(onboardingPathKeepingOAuthResult('?returnTo=/billing')).toBe(
      '/onboarding?returnTo=%2Fbilling',
    );
  });
});
