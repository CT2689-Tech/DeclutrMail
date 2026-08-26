import { afterEach, describe, expect, it } from 'vitest';

import { SIGNUP_REF_COOKIE } from '@declutrmail/shared/contracts';

import { oauthStartUrl } from './landing/urls';
import {
  captureSignupRef,
  readCapturedSignupRef,
  simulatorShareUrl,
  withSignupRef,
} from './signup-ref';

afterEach(() => {
  document.cookie = `${SIGNUP_REF_COOKIE}=; Path=/; Max-Age=0`;
  sessionStorage.clear();
});

describe('withSignupRef', () => {
  it('appends ref to OAuth start and leaves a later simulator off an existing hn', () => {
    expect(withSignupRef('https://api.example/api/auth/google/start', 'hn')).toBe(
      'https://api.example/api/auth/google/start?ref=hn',
    );
    expect(
      withSignupRef('https://api.example/api/auth/google/start?returnTo=%2Fbilling', 'hn'),
    ).toBe('https://api.example/api/auth/google/start?returnTo=%2Fbilling&ref=hn');
    expect(withSignupRef('https://api.example/api/auth/google/start?ref=hn', 'simulator')).toBe(
      'https://api.example/api/auth/google/start?ref=hn',
    );
  });

  it('does not decorate non-OAuth links', () => {
    expect(withSignupRef('https://declutrmail.com/inbox-simulator', 'hn')).toBe(
      'https://declutrmail.com/inbox-simulator',
    );
  });
});

describe('captureSignupRef (set-once)', () => {
  it('keeps hn when the visitor later opens the simulator', () => {
    expect(captureSignupRef('/', '?ref=hn')).toBe('hn');
    expect(captureSignupRef('/inbox-simulator', '')).toBe('hn');
    expect(readCapturedSignupRef()).toBe('hn');
  });

  it('attributes a bare simulator visit when nothing is captured yet', () => {
    expect(captureSignupRef('/inbox-simulator', '')).toBe('simulator');
    expect(readCapturedSignupRef()).toBe('simulator');
  });
});

describe('simulatorShareUrl', () => {
  it('always stamps ref=simulator for recipients', () => {
    expect(simulatorShareUrl('https://declutrmail.com')).toBe(
      'https://declutrmail.com/inbox-simulator?ref=simulator',
    );
  });
});

describe('oauthStartUrl stays server-renderable', () => {
  /**
   * The regression this pins is a HYDRATION MISMATCH, not a wrong URL.
   *
   * `oauthStartUrl()` is called during the server render of the marketing
   * CTAs, including the `'use client'` inbox simulator whose primary CTA is
   * in the first paint. The middleware sets `dm_signup_ref` on the SAME
   * response that renders the page, so if this function reads the cookie
   * the server emits a bare href and hydration emits `?ref=simulator` —
   * every first visit to /inbox-simulator logs a mismatch on its main CTA.
   *
   * The `ref` is attached where no server render can disagree: on click.
   */
  it('never reads the capture cookie', () => {
    document.cookie = `${SIGNUP_REF_COOKIE}=hn; Path=/`;
    expect(readCapturedSignupRef()).toBe('hn');

    expect(oauthStartUrl()).not.toContain('ref=');
    expect(oauthStartUrl('/billing?plan=plus')).not.toContain('ref=');
  });

  it('is still decoratable at click time', () => {
    document.cookie = `${SIGNUP_REF_COOKIE}=hn; Path=/`;
    expect(withSignupRef(oauthStartUrl())).toContain('ref=hn');
  });
});
