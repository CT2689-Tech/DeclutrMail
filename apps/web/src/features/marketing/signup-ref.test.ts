import { afterEach, describe, expect, it } from 'vitest';

import { SIGNUP_REF_COOKIE } from '@declutrmail/shared/contracts';

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
