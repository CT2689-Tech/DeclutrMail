import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MARKETING_PATHS } from '@/app/sitemap';

import { NOINDEX_SOURCES, noindexHeaderRules } from './noindex-headers';

describe('noindex headers', () => {
  it('sends X-Robots-Tag noindex on app and onboarding routes only', () => {
    const rules = noindexHeaderRules();
    for (const rule of rules) {
      expect(rule.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
    }
    const sources = rules.map((rule) => rule.source);
    expect(sources).toEqual([...NOINDEX_SOURCES]);
    for (const route of ['/home', '/senders/:path*', '/onboarding', '/billing']) {
      expect(sources).toContain(route);
    }
    for (const route of MARKETING_PATHS) {
      expect(sources, route).not.toContain(route);
    }
  });

  it('is wired from next.config and keeps the login and signup 308s', () => {
    const config = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config).toContain('noindexHeaderRules');
    expect(config).toContain(
      "source: '/login', destination: '/sign-in?returning=1', permanent: true",
    );
    expect(config).toContain("source: '/signup', destination: '/sign-in', permanent: true");
  });
});

describe('canonical host redirect', () => {
  it('308s declutr-mail.vercel.app to declutrmail.com and leaves other hosts alone', () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
      redirects: Array<{
        source: string;
        destination: string;
        permanent: boolean;
        has: Array<{ type: string; value: string }>;
      }>;
    };
    expect(vercel.redirects.length).toBeGreaterThan(0);
    for (const redirect of vercel.redirects) {
      expect(redirect.permanent).toBe(true);
      expect(redirect.has).toEqual([{ type: 'host', value: 'declutr-mail.vercel.app' }]);
      const destination = new URL(redirect.destination.replaceAll(':path*', 'kept-path'));
      expect(destination.protocol).toBe('https:');
      expect(destination.hostname).toBe('declutrmail.com');
    }
    expect(vercel.redirects.some((redirect) => redirect.destination.includes(':path*'))).toBe(true);
    expect(JSON.stringify(vercel.redirects)).not.toContain('preview');
  });
});
