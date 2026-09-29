import { Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { GmailScopeNotGrantedError, GoogleOAuthService } from './google-oauth.service.js';

const GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;

/** Google's token-endpoint JSON, in the shape its web-server guide documents. */
function tokenJson(scope: string | undefined) {
  return {
    access_token: 'placeholder-access-token',
    expires_in: 3599,
    token_type: 'Bearer',
    refresh_token: 'placeholder-refresh-token',
    id_token: 'placeholder-id-token',
    ...(scope === undefined ? {} : { scope }),
  };
}

type TransportRequest = { url?: unknown; headers?: unknown };

/**
 * The service spec mocks `OAuth2Client` entirely, so it cannot see the
 * library's own parsing of Google's responses. This spec keeps the real
 * client and stubs only the network transport under it (and Google's
 * id_token signature check), so a library upgrade that reshapes
 * `tokens.scope` or token-info `scopes` fails here instead of refusing
 * every sign-in in production.
 */
describe('GoogleOAuthService.exchangeCode — through the real google-auth-library', () => {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const transport = Object.getPrototypeOf(new OAuth2Client().transporter) as {
    request: (opts: TransportRequest) => Promise<unknown>;
  };
  let request: MockInstance;
  let warn: MockInstance;
  let responses: Record<string, unknown>;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/google/callback';
    responses = {};
    request = vi.spyOn(transport, 'request').mockImplementation(async (opts) => {
      const url = String(opts.url);
      if (!(url in responses)) throw new Error(`unexpected request to ${url}`);
      return { data: responses[url], status: 200, statusText: 'OK', headers: new Headers() };
    });
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: 'user@example.com' }),
    } as never);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    warn.mockRestore();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('accepts a grant whose scope list includes Gmail', async () => {
    responses[TOKEN_URL] = tokenJson(`${GMAIL} openid ${EMAIL_SCOPE}`);

    await expect(new GoogleOAuthService().exchangeCode('code')).resolves.toEqual({
      email: 'user@example.com',
      refreshToken: 'placeholder-refresh-token',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refuses a grant whose scope list has only the sign-in scopes', async () => {
    responses[TOKEN_URL] = tokenJson(`openid ${EMAIL_SCOPE}`);

    await expect(new GoogleOAuthService().exchangeCode('code')).rejects.toBeInstanceOf(
      GmailScopeNotGrantedError,
    );
  });

  it('asks token info, with the access token, when the scope list is absent', async () => {
    responses[TOKEN_URL] = tokenJson(undefined);
    responses[TOKEN_INFO_URL] = {
      aud: 'client-id',
      scope: `${GMAIL} openid`,
      expires_in: '3599',
      email: 'user@example.com',
    };

    await expect(new GoogleOAuthService().exchangeCode('code')).resolves.toEqual({
      email: 'user@example.com',
      refreshToken: 'placeholder-refresh-token',
    });
    const infoCall = request.mock.calls.find(([opts]) => String(opts.url) === TOKEN_INFO_URL);
    const headers = (infoCall?.[0] as TransportRequest).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer placeholder-access-token');
  });

  it('fails the exchange, not the Gmail check, when token info cannot say', async () => {
    responses[TOKEN_URL] = tokenJson(undefined);
    responses[TOKEN_INFO_URL] = { aud: 'client-id', expires_in: '3599' };

    const outcome = new GoogleOAuthService().exchangeCode('code');

    await expect(outcome).rejects.toThrow();
    await expect(outcome).rejects.not.toBeInstanceOf(GmailScopeNotGrantedError);
  });
});
