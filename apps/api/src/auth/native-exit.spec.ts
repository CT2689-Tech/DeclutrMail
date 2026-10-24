import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { NativeAuthService } from './native-auth.service.js';
import { interceptNativeRedirects, sendNativeReturn, webPathOf } from './native-exit.js';

const WEB = 'https://app.declutrmail.test';

describe('webPathOf', () => {
  it.each([
    [`${WEB}/home`, '/home'],
    [
      `${WEB}/settings?connect_start_result=failed#mailboxes`,
      '/settings?connect_start_result=failed#mailboxes',
    ],
    [
      `${WEB}/onboarding?${new URLSearchParams({ returnTo: '/billing?plan=pro' })}`,
      '/onboarding?returnTo=%2Fbilling%3Fplan%3Dpro',
    ],
  ])('maps %s into the app', (url, path) => expect(webPathOf(WEB, url)).toBe(path));

  it('tolerates a trailing slash on the configured base', () => {
    expect(webPathOf(`${WEB}/`, `${WEB}/home`)).toBe('/home');
  });

  it.each([
    ['Google', 'https://accounts.google.com/o/oauth2/v2/auth?state=x'],
    ['a look-alike host', 'https://app.declutrmail.test.evil.com/home'],
    ['a look-alike prefix', 'https://app.declutrmail.testing/home'],
    ['the bare origin', WEB],
    ['a protocol-relative path', `${WEB}//evil.com`],
    ['a backslash path', `${WEB}/\\evil.com`],
    ['a non-string', undefined],
  ])('does not map %s', (_name, url) => expect(webPathOf(WEB, url)).toBeNull());
});

function fakeResponse() {
  const redirect = vi.fn();
  const sent: { status?: number; headers: Record<string, string>; body?: string } = { headers: {} };
  const res = {
    headersSent: false,
    redirect,
    status(code: number) {
      sent.status = code;
      return res;
    },
    type() {
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(sent.headers, headers);
      return res;
    },
    send(body: string) {
      sent.body = body;
      res.headersSent = true;
      return res;
    },
  };
  return { res: res as unknown as Response, redirect, sent };
}

describe('interceptNativeRedirects', () => {
  it('turns a redirect into the web app into a return to the app', () => {
    const { res, redirect, sent } = fakeResponse();
    interceptNativeRedirects(res, WEB);
    res.redirect(302, `${WEB}/settings?x=1`);
    expect(redirect).not.toHaveBeenCalled();
    expect(sent.status).toBe(200);
    expect(sent.body).toContain('com.declutrmail.app://auth/return?to=%2Fsettings%3Fx%3D1');
  });

  it('accepts the one-argument form', () => {
    const { res, sent } = fakeResponse();
    interceptNativeRedirects(res, WEB);
    res.redirect(`${WEB}/home`);
    expect(sent.body).toContain('to=%2Fhome');
  });

  it('passes every other redirect through unchanged', () => {
    const { res, redirect, sent } = fakeResponse();
    interceptNativeRedirects(res, WEB);
    res.redirect(302, 'https://accounts.google.com/o/oauth2/v2/auth?state=x');
    expect(redirect).toHaveBeenCalledWith(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?state=x',
    );
    expect(sent.body).toBeUndefined();
  });
});

describe('sendNativeReturn', () => {
  it('serves a script-free, uncacheable page that cannot be framed or fetched into', () => {
    const { res, sent } = fakeResponse();
    sendNativeReturn(res, { kind: 'navigate', to: '/home' });
    expect(sent.headers['Cache-Control']).toBe('no-store');
    expect(sent.headers['Referrer-Policy']).toBe('no-referrer');
    expect(sent.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(sent.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(sent.headers['Content-Security-Policy']).not.toContain('script-src');
    expect(sent.body).not.toMatch(/<script/i);
  });

  it('offers the link as a refresh and as a tap target', () => {
    const { res, sent } = fakeResponse();
    sendNativeReturn(res, { kind: 'session', code: 'A'.repeat(43) });
    const link = `com.declutrmail.app://auth/return?code=${'A'.repeat(43)}`;
    expect(sent.body).toContain(`http-equiv="refresh" content="0;url=${link}"`);
    expect(sent.body).toContain(`<a href="${link}">Open DeclutrMail</a>`);
  });

  it('does nothing once the response has been sent', () => {
    const { res, sent } = fakeResponse();
    (res as unknown as { headersSent: boolean }).headersSent = true;
    sendNativeReturn(res, { kind: 'navigate', to: '/home' });
    expect(sent.body).toBeUndefined();
  });
});

describe('NativeAuthService.verifierMatches (RFC 7636 S256)', () => {
  // The worked example in RFC 7636 Appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('accepts the matching pair', () => {
    expect(NativeAuthService.verifierMatches(verifier, challenge)).toBe(true);
  });

  it.each([
    ['a different verifier', 'x'.repeat(43), challenge],
    ['a different challenge', verifier, 'x'.repeat(43)],
    ['a challenge of another length', verifier, challenge.slice(1)],
    ['the verifier used as its own challenge', verifier, verifier],
  ])('refuses %s', (_name, v, c) => {
    expect(NativeAuthService.verifierMatches(v, c)).toBe(false);
  });
});
