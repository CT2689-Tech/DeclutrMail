import { describe, expect, it } from 'vitest';

import { MARKETING_PATHS } from '@/app/sitemap';

import {
  CANONICAL_ORIGIN,
  LEGACY_HOST_PATTERN,
  WWW_HOST_PATTERN,
  legacyDomainRedirects,
  resolveLegacyPath,
  wwwApexRedirects,
} from './legacy-domain-redirects';

/**
 * Every URL in V1's sitemap (`https://declutrmail.ai/sitemap.xml`,
 * fetched 2026-07-21). This is the indexed set — the URLs that carry
 * link equity and that Search Console will follow during the Change of
 * Address. Each one must land on a page that exists on V2.
 */
const V1_SITEMAP = [
  '/',
  '/blog',
  '/blog/email-overload-problem',
  '/blog/is-unroll-me-safe',
  '/blog/launch-announcement',
  '/blog/privacy-first-design',
  '/blog/psychology-of-digital-clutter',
  '/compare',
  '/compare/clean-email-vs-declutrmail',
  '/compare/declutrmail-vs-unroll-me-vs-leave-me-alone',
  '/compare/leave-me-alone-vs-declutrmail',
  '/compare/mailstrom-vs-declutrmail',
  '/compare/sanebox-vs-declutrmail',
  '/compare/unroll-me-vs-declutrmail',
  '/contact',
  '/faq',
  '/guides',
  '/guides/auto-archive-gmail',
  '/guides/digital-minimalism-email',
  '/guides/email-management-glossary',
  '/guides/find-all-email-subscriptions-gmail',
  '/guides/gmail-storage-full',
  '/guides/inbox-zero-strategy',
  '/guides/privacy-first-email-management',
  '/guides/unsubscribe-from-airbnb',
  '/guides/unsubscribe-from-amazon',
  '/guides/unsubscribe-from-facebook',
  '/guides/unsubscribe-from-instagram',
  '/guides/unsubscribe-from-linkedin',
  '/guides/unsubscribe-from-netflix',
  '/guides/unsubscribe-from-pinterest',
  '/guides/unsubscribe-from-reddit',
  '/guides/unsubscribe-from-spotify',
  '/guides/unsubscribe-from-tiktok',
  '/guides/unsubscribe-from-twitter',
  '/guides/unsubscribe-from-uber',
  '/guides/unsubscribe-from-walmart',
  '/guides/unsubscribe-safely',
  '/legal/privacy',
  '/legal/refund',
  '/legal/terms',
  '/pricing',
  '/tools/email-cleanup-calculator',
  '/topics',
] as const;

/** V1's AI-context files, linked from its `robots.txt` rather than the sitemap. */
const V1_AI_CONTEXT = ['/llms.txt', '/llms-full.txt', '/ai.txt'] as const;

/**
 * Routes that exist on V2. The public set is the sitemap itself, not a
 * copy of it: a hand-maintained mirror silently went stale as V2 gained
 * routes, so a redirect could only be proved against the list's last
 * edit. Non-sitemap public files and the authed targets are added by
 * hand because nothing enumerates them.
 */
const V2_ROUTES = new Set<string>([
  ...MARKETING_PATHS,
  // Served from `public/`, so absent from the sitemap.
  '/llms.txt',
  // Authed app routes — redirect targets for V1's old app URLs.
  '/activity',
  '/autopilot',
  '/senders',
  '/triage',
]);

describe('legacy-domain redirects (declutrmail.ai → declutrmail.com)', () => {
  const rules = legacyDomainRedirects();

  /**
   * The regression this suite exists for. A path-preserving catch-all
   * alone permanently redirects 38 of V1's 44 indexed URLs onto V2 404s.
   */
  describe('no indexed V1 URL is 301d onto a V2 404', () => {
    it.each([...V1_SITEMAP, ...V1_AI_CONTEXT])('%s resolves to a live V2 route', (path) => {
      const destination = resolveLegacyPath(path);

      expect(V2_ROUTES.has(destination), `${path} → ${destination} does not exist on V2`).toBe(
        true,
      );
    });

    it('sends both V1 Unroll.Me comparisons to the V2 page rather than the hub', () => {
      expect(resolveLegacyPath('/compare/unroll-me-vs-declutrmail')).toBe('/vs/unroll-me');
      expect(resolveLegacyPath('/compare/declutrmail-vs-unroll-me-vs-leave-me-alone')).toBe(
        '/vs/unroll-me',
      );
      expect(resolveLegacyPath('/blog/is-unroll-me-safe')).toBe('/vs/unroll-me');
      // Mailstrom still has no page of its own; the hub stays the target.
      expect(resolveLegacyPath('/compare/mailstrom-vs-declutrmail')).toBe('/compare');
    });

    it('keeps the six shared paths on their own URL instead of rerouting them', () => {
      for (const shared of ['/', '/blog', '/compare', '/contact', '/faq', '/pricing']) {
        expect(resolveLegacyPath(shared)).toBe(shared);
      }
    });

    it('sends every per-brand unsubscribe guide to the V2 how-to, including unlisted brands', () => {
      const howTo = '/how-to/unsubscribe-from-emails-gmail';

      expect(resolveLegacyPath('/guides/unsubscribe-from-netflix')).toBe(howTo);
      // Not in the sitemap — pattern rule must still catch it.
      expect(resolveLegacyPath('/guides/unsubscribe-from-doordash')).toBe(howTo);
    });

    it('falls back to the help hub for any other guide path', () => {
      expect(resolveLegacyPath('/guides/some-guide-we-never-listed')).toBe('/help');
      expect(resolveLegacyPath('/guides/nested/deeper/page')).toBe('/help');
    });
  });

  /**
   * The other way this change can brick production: a rule that is not
   * host-gated matches `declutrmail.com` too and loops it to itself.
   */
  describe('host gating', () => {
    it('gates EVERY rule on the host header', () => {
      for (const rule of rules) {
        expect(rule.has, `rule "${rule.source}" has no host gate`).toEqual([
          { type: 'host', value: LEGACY_HOST_PATTERN },
        ]);
      }
    });

    it('matches the retired apex + www hosts and rejects the canonical host', () => {
      // Next matches `has.value` as a full-string regex against `Host`.
      const matches = (host: string) => new RegExp(`^(?:${LEGACY_HOST_PATTERN})$`).test(host);

      expect(matches('declutrmail.ai')).toBe(true);
      expect(matches('www.declutrmail.ai')).toBe(true);

      expect(matches('declutrmail.com')).toBe(false);
      expect(matches('www.declutrmail.com')).toBe(false);
      expect(matches('app.declutrmail.com')).toBe(false);
      // The `.` in the pattern is escaped, so a lookalike cannot match.
      expect(matches('declutrmailxai')).toBe(false);
      expect(matches('evil-declutrmail.ai.attacker.test')).toBe(false);
    });
  });

  describe('rule shape', () => {
    it('sends 301 (not 308) so Search Console Change of Address accepts the move', () => {
      for (const rule of rules) {
        expect(rule.statusCode).toBe(301);
        expect(rule).not.toHaveProperty('permanent');
      }
    });

    it('points every destination at the canonical origin', () => {
      for (const rule of rules) {
        expect(rule.destination.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
      }
    });

    it('orders exact renames ahead of the guide patterns ahead of the catch-all', () => {
      const sourceIndex = (source: string) => rules.findIndex((rule) => rule.source === source);

      expect(sourceIndex('/guides/auto-archive-gmail')).toBeLessThan(
        sourceIndex('/guides/unsubscribe-from-:brand'),
      );
      expect(sourceIndex('/guides/unsubscribe-from-:brand')).toBeLessThan(
        sourceIndex('/guides/:path*'),
      );
      expect(rules.at(-1)?.source).toBe('/:path*');
      expect(rules.filter((rule) => rule.source === '/:path*')).toHaveLength(1);
    });
  });
});

describe('www → apex redirects (D128)', () => {
  const rules = wwwApexRedirects();
  const matches = (host: string) => new RegExp(`^(?:${WWW_HOST_PATTERN})$`).test(host);

  it('is a single path-preserving 301 gated on www only', () => {
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      source: '/:path*',
      has: [{ type: 'host', value: WWW_HOST_PATTERN }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      statusCode: 301,
    });
    expect(rules[0]).not.toHaveProperty('permanent');
  });

  it('matches www and rejects the apex, app subdomain, and the retired .ai hosts', () => {
    expect(matches('www.declutrmail.com')).toBe(true);

    expect(matches('declutrmail.com')).toBe(false);
    expect(matches('app.declutrmail.com')).toBe(false);
    expect(matches('declutrmail.ai')).toBe(false);
    expect(matches('www.declutrmail.ai')).toBe(false);
    expect(matches('www.declutrmail.com.attacker.test')).toBe(false);
  });
});
