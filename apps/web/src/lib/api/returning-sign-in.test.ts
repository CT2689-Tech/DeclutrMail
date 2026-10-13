import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { welcomeRedirect } from '../welcome-redirect';

import { returningSignInPath } from './returning-sign-in';

const require = createRequire(import.meta.url);

const { prepareDestination } =
  require('next/dist/shared/lib/router/utils/prepare-destination.js') as {
    prepareDestination: (args: {
      appendParamsToQuery: boolean;
      destination: string;
      params: Record<string, string>;
      query: Record<string, string>;
    }) => {
      parsedDestination: {
        pathname: string | null;
        query: Record<string, string | string[] | undefined>;
      };
    };
  };

const PTXN = 'txn_test';

function setLocation(pathname: string, search = '', hash = '') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname, search, hash },
  });
}

function signInReturnTo(): string | null {
  return new URL(returningSignInPath(), 'http://localhost').searchParams.get('returnTo');
}

function redirectedSearch(search: Record<string, string>) {
  const rule = welcomeRedirect();
  return prepareDestination({
    appendParamsToQuery: false,
    destination: rule.destination,
    params: {},
    query: search,
  }).parsedDestination;
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/', search: '', hash: '' },
  });
});

describe('signed-out billing return after a Paddle /welcome link', () => {
  it('keeps /billing?_ptxn=... after /welcome 308', () => {
    const dest = redirectedSearch({ _ptxn: PTXN });
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(dest.query)) {
      if (typeof value === 'string') query.set(key, value);
    }
    setLocation(dest.pathname ?? '/billing', query.size ? `?${query}` : '');
    expect(signInReturnTo()).toBe(`/billing?_ptxn=${PTXN}`);
  });

  it('keeps a Paddle transaction id on /billing', () => {
    setLocation('/billing', `?_ptxn=${PTXN}`);
    expect(signInReturnTo()).toBe(`/billing?_ptxn=${PTXN}`);
  });

  it('keeps /billing when an unknown param is stripped', () => {
    setLocation('/billing', `?_ptxn=${PTXN}&utm_source=paddle&a=1%202`);
    expect(signInReturnTo()).toBe(`/billing?_ptxn=${PTXN}`);
    setLocation('/billing', '?utm_source=paddle');
    expect(signInReturnTo()).toBe('/billing');
  });

  it('strips a malformed _ptxn and still returns /billing', () => {
    setLocation('/billing', '?_ptxn=not-a-txn');
    expect(signInReturnTo()).toBe('/billing');
  });
});
