import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

import { welcomeRedirect } from './welcome-redirect';

const require = createRequire(import.meta.url);

const { getRedirectStatus } = require('next/dist/lib/redirect-status.js') as {
  getRedirectStatus: (route: { permanent?: boolean; statusCode?: number }) => number;
};

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

const PTXN = 'txn_01abcdefghijklmnopqrstuvwx';

/** Same inputs the Next router uses when it builds a redirect Location. */
function redirected(search: Record<string, string>) {
  const rule = welcomeRedirect();
  return prepareDestination({
    appendParamsToQuery: false,
    destination: rule.destination,
    params: {},
    query: search,
  }).parsedDestination;
}

describe('Paddle /welcome payment link', () => {
  it('308s /welcome to the billing page and leaves the query for Next to merge', () => {
    const rule = welcomeRedirect();
    expect(rule).toEqual({ source: '/welcome', destination: '/billing', permanent: true });
    expect(getRedirectStatus(rule)).toBe(308);
    expect(existsSync(path.join(process.cwd(), 'src/app/(app)/billing/page.tsx'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'src/app/(app)/welcome/page.tsx'))).toBe(false);
    expect(readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')).toContain(
      'welcomeRedirect()',
    );
  });

  it('keeps _ptxn on /billing and does not add one when the link has none', () => {
    expect(redirected({ _ptxn: PTXN })).toMatchObject({
      pathname: '/billing',
      query: { _ptxn: PTXN },
    });
    expect(redirected({ _ptxn: PTXN, utm_source: 'paddle' }).query).toEqual({
      _ptxn: PTXN,
      utm_source: 'paddle',
    });
    expect(redirected({}).query).toEqual({});
  });

  it('keeps _ptxn when the apex sends /billing on to the app host', () => {
    const result = middleware(new NextRequest(`https://declutrmail.com/billing?_ptxn=${PTXN}`));
    expect(result.status).toBe(307);
    expect(result.headers.get('location')).toBe(
      `https://app.declutrmail.com/billing?_ptxn=${PTXN}`,
    );
  });
});
