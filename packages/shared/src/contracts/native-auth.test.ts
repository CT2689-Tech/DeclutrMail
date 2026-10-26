import { describe, expect, it } from 'vitest';

import {
  buildNativeReturnUrl,
  isNativeSafePath,
  NATIVE_APP_SCHEME,
  nativeConnectTicketRequestSchema,
  nativeExchangeRequestSchema,
  parseNativeReturnUrl,
  PKCE_CHALLENGE_PATTERN,
  PKCE_VERIFIER_PATTERN,
} from './native-auth';

const CODE = 'A'.repeat(43);
const VERIFIER = 'v'.repeat(43);

describe('native return link', () => {
  it('round-trips a session return carrying only the code', () => {
    const url = buildNativeReturnUrl({ kind: 'session', code: CODE });
    expect(url).toBe(`${NATIVE_APP_SCHEME}://auth/return?code=${CODE}`);
    expect(parseNativeReturnUrl(url)).toEqual({ kind: 'session', code: CODE });
  });

  it('round-trips a navigate return with an encoded path, query and fragment', () => {
    const to = '/settings?connect_start_result=failed#mailboxes';
    const url = buildNativeReturnUrl({ kind: 'navigate', to });
    // The fragment lives inside the encoded `to` value, so the link itself
    // still has none (the "fragment" rejection below is about the link).
    expect(new URL(url).hash).toBe('');
    expect(parseNativeReturnUrl(url)).toEqual({ kind: 'navigate', to });
  });

  it('refuses to build a link from a malformed code or an unsafe path', () => {
    expect(() => buildNativeReturnUrl({ kind: 'session', code: 'short' })).toThrow();
    expect(() => buildNativeReturnUrl({ kind: 'navigate', to: '//evil.com' })).toThrow();
  });

  it.each([
    ['wrong scheme', `https://auth/return?code=${CODE}`],
    ['other app scheme', `com.example.app://auth/return?code=${CODE}`],
    ['wrong host', `${NATIVE_APP_SCHEME}://other/return?code=${CODE}`],
    ['wrong path', `${NATIVE_APP_SCHEME}://auth/elsewhere?code=${CODE}`],
    ['no parameter', `${NATIVE_APP_SCHEME}://auth/return`],
    ['both parameters', `${NATIVE_APP_SCHEME}://auth/return?code=${CODE}&to=/home`],
    ['extra parameter', `${NATIVE_APP_SCHEME}://auth/return?code=${CODE}&x=1`],
    ['repeated code', `${NATIVE_APP_SCHEME}://auth/return?code=${CODE}&code=${CODE}`],
    ['short code', `${NATIVE_APP_SCHEME}://auth/return?code=abc`],
    ['code with a bad character', `${NATIVE_APP_SCHEME}://auth/return?code=${'A'.repeat(42)}!`],
    ['absolute to', `${NATIVE_APP_SCHEME}://auth/return?to=https://evil.com/x`],
    ['protocol-relative to', `${NATIVE_APP_SCHEME}://auth/return?to=//evil.com`],
    ['backslash to', `${NATIVE_APP_SCHEME}://auth/return?to=/%5Cevil.com`],
    ['fragment', `${NATIVE_APP_SCHEME}://auth/return?code=${CODE}#x`],
    ['credentials', `${NATIVE_APP_SCHEME}://u:p@auth/return?code=${CODE}`],
    ['not a url', 'not a url'],
  ])('rejects %s', (_name, link) => {
    expect(parseNativeReturnUrl(link)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseNativeReturnUrl(undefined)).toBeNull();
    expect(parseNativeReturnUrl(42)).toBeNull();
  });
});

describe('isNativeSafePath', () => {
  it.each(['/home', '/settings?x=1', '/senders/abc', '/onboarding?returnTo=%2Fbilling'])(
    'accepts %s',
    (path) => expect(isNativeSafePath(path)).toBe(true),
  );

  it.each([
    '',
    'home',
    '//evil.com',
    'https://evil.com',
    '/\\evil.com',
    '/a b',
    '/a\nb',
    `/${'a'.repeat(2048)}`,
  ])('rejects %j', (path) => expect(isNativeSafePath(path)).toBe(false));

  it('rejects non-strings', () => {
    expect(isNativeSafePath(null)).toBe(false);
    expect(isNativeSafePath(1)).toBe(false);
  });
});

describe('PKCE patterns (RFC 7636)', () => {
  it('accepts a 43-char base64url challenge and nothing else', () => {
    expect(PKCE_CHALLENGE_PATTERN.test('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(PKCE_CHALLENGE_PATTERN.test('short')).toBe(false);
    expect(PKCE_CHALLENGE_PATTERN.test(`${'a'.repeat(43)}=`)).toBe(false);
  });

  it('accepts 43 to 128 unreserved characters in a verifier', () => {
    expect(PKCE_VERIFIER_PATTERN.test('a'.repeat(43))).toBe(true);
    expect(PKCE_VERIFIER_PATTERN.test('a'.repeat(128))).toBe(true);
    expect(PKCE_VERIFIER_PATTERN.test('a'.repeat(42))).toBe(false);
    expect(PKCE_VERIFIER_PATTERN.test('a'.repeat(129))).toBe(false);
    expect(PKCE_VERIFIER_PATTERN.test(`${'a'.repeat(43)} `)).toBe(false);
  });
});

describe('wire schemas', () => {
  it('exchange takes exactly a code and a verifier', () => {
    expect(nativeExchangeRequestSchema.safeParse({ code: CODE, verifier: VERIFIER }).success).toBe(
      true,
    );
    expect(
      nativeExchangeRequestSchema.safeParse({ code: CODE, verifier: VERIFIER, extra: 1 }).success,
    ).toBe(false);
    expect(nativeExchangeRequestSchema.safeParse({ code: CODE }).success).toBe(false);
    expect(nativeExchangeRequestSchema.safeParse({ code: 'x', verifier: VERIFIER }).success).toBe(
      false,
    );
  });

  it('connect ticket options take only the recovery targets and a billing return', () => {
    expect(nativeConnectTicketRequestSchema.safeParse({}).success).toBe(true);
    expect(
      nativeConnectTicketRequestSchema.safeParse({
        reconnectMailboxId: '3f2b8c1e-5d7a-4c11-9a3e-0a1b2c3d4e5f',
      }).success,
    ).toBe(true);
    expect(nativeConnectTicketRequestSchema.safeParse({ reconnectMailboxId: 'nope' }).success).toBe(
      false,
    );
    expect(nativeConnectTicketRequestSchema.safeParse({ userId: 'x' }).success).toBe(false);
  });
});
