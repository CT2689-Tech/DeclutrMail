import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const { getToken, getTokenInfo, verifyIdToken } = vi.hoisted(() => ({
  getToken: vi.fn(),
  getTokenInfo: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    getToken = getToken;
    getTokenInfo = getTokenInfo;
    verifyIdToken = verifyIdToken;
  },
}));

import { GmailScopeNotGrantedError, GoogleOAuthService } from './google-oauth.service.js';

const GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
const SIGN_IN = 'openid https://www.googleapis.com/auth/userinfo.email';
const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;

/** Google's token response, with `scope` omitted when `undefined`. */
function tokenResponse(scope: string | undefined, accessToken: string | null = 'access-token') {
  return {
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      ...(scope === undefined ? {} : { scope }),
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('Expected exchangeCode to reject.');
}

/**
 * Google's consent screen can finish with the sign-in permissions but
 * not Gmail: the exchange then succeeds with a refresh token that can
 * identify the account but cannot read or change mail. The signup lost
 * on 2026-09-04 got exactly that grant and a scan that 403'd on every
 * call. `exchangeCode` must refuse it before anything is stored.
 */
describe('GoogleOAuthService.exchangeCode — the Gmail grant (D108)', () => {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';
    getToken.mockReset();
    getTokenInfo.mockReset();
    verifyIdToken.mockReset();
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'user@example.com' }) });
  });

  afterEach(() => {
    warn.mockRestore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('returns the account when Google granted Gmail', async () => {
    getToken.mockResolvedValue(tokenResponse(`${GMAIL} ${SIGN_IN}`));

    await expect(new GoogleOAuthService().exchangeCode('code')).resolves.toEqual({
      email: 'user@example.com',
      refreshToken: 'refresh-token',
    });
  });

  it('finds Gmail anywhere in the granted list', async () => {
    getToken.mockResolvedValue(tokenResponse(` ${SIGN_IN}  ${GMAIL} `));

    await expect(new GoogleOAuthService().exchangeCode('code')).resolves.toEqual({
      email: 'user@example.com',
      refreshToken: 'refresh-token',
    });
  });

  it.each([
    ['sign-in scopes only', SIGN_IN],
    ['a different Gmail scope', `https://www.googleapis.com/auth/gmail.metadata ${SIGN_IN}`],
    ['a longer scope that merely contains Gmail’s', `${GMAIL}.extra ${SIGN_IN}`],
  ])('refuses a partial grant: %s', async (_label, scope) => {
    getToken.mockResolvedValue(tokenResponse(scope));

    const err = await rejection(new GoogleOAuthService().exchangeCode('code'));

    expect(err).toBeInstanceOf(GmailScopeNotGrantedError);
  });

  // Google's token response lists the granted scopes. If one ever arrives
  // without the list, neither "granted" nor "refused" is known: ask Google's
  // token-info endpoint instead of guessing either way.
  describe.each([
    ['absent', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('when the scope list is %s', (_label, scope) => {
    it('accepts the grant once token info shows Gmail', async () => {
      getToken.mockResolvedValue(tokenResponse(scope));
      getTokenInfo.mockResolvedValue({ scopes: [GMAIL, 'openid'] });

      await expect(new GoogleOAuthService().exchangeCode('code')).resolves.toEqual({
        email: 'user@example.com',
        refreshToken: 'refresh-token',
      });
      expect(getTokenInfo).toHaveBeenCalledWith('access-token');
      // The only sign that Google changed its token response.
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('refuses a near-miss Gmail scope from token info', async () => {
      getToken.mockResolvedValue(tokenResponse(scope));
      getTokenInfo.mockResolvedValue({
        scopes: [`${GMAIL}.extra`, 'https://www.googleapis.com/auth/gmail.metadata'],
      });

      await expect(new GoogleOAuthService().exchangeCode('code')).rejects.toBeInstanceOf(
        GmailScopeNotGrantedError,
      );
    });

    it('refuses the grant when token info shows no Gmail', async () => {
      getToken.mockResolvedValue(tokenResponse(scope));
      getTokenInfo.mockResolvedValue({ scopes: ['openid'] });

      await expect(new GoogleOAuthService().exchangeCode('code')).rejects.toBeInstanceOf(
        GmailScopeNotGrantedError,
      );
    });
  });

  it('fails like any broken exchange when token info cannot answer', async () => {
    const lookupFailure = new Error('tokeninfo unavailable');
    getToken.mockResolvedValue(tokenResponse(undefined));
    getTokenInfo.mockRejectedValue(lookupFailure);

    const err = await rejection(new GoogleOAuthService().exchangeCode('code'));

    expect(err).toBe(lookupFailure);
    expect(err).not.toBeInstanceOf(GmailScopeNotGrantedError);
  });

  it('does not ask token info when Google listed the scopes', async () => {
    getToken.mockResolvedValue(tokenResponse(SIGN_IN));

    await rejection(new GoogleOAuthService().exchangeCode('code'));

    expect(getTokenInfo).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  // Gmail is the thing the person can act on; report it before a missing
  // refresh token, which the same retry with Gmail allowed also fixes.
  it('reports missing Gmail before a missing refresh token', async () => {
    const { tokens } = tokenResponse(SIGN_IN);
    getToken.mockResolvedValue({ tokens: { ...tokens, refresh_token: undefined } });

    await expect(new GoogleOAuthService().exchangeCode('code')).rejects.toBeInstanceOf(
      GmailScopeNotGrantedError,
    );
  });

  it('fails the exchange when Google sent neither a scope list nor an access token', async () => {
    getToken.mockResolvedValue(tokenResponse(undefined, null));

    const err = await rejection(new GoogleOAuthService().exchangeCode('code'));

    expect(err).toBeInstanceOf(BadRequestException);
    expect(getTokenInfo).not.toHaveBeenCalled();
  });
});
