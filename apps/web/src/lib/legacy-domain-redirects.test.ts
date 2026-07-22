import { describe, expect, it } from 'vitest';

import {
  CANONICAL_ORIGIN,
  LEGACY_HOST_PATTERN,
  legacyDomainRedirects,
  resolveLegacyPath,
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
 * Routes that exist on V2. Public set mirrors
 * `https://declutrmail.com/sitemap.xml` (fetched 2026-07-21); the authed
 * set mirrors `apps/web/src/app/(app)`. If a redirect target is missing
 * here, it is missing on the live site too.
 */
const V2_ROUTES = new Set([
  '/',
  '/answers/best-way-to-clean-gmail-2026',
  '/answers/how-undo-works-for-gmail-cleanup',
  '/answers/is-it-safe-to-connect-gmail-app',
  '/answers/sender-level-vs-message-level-cleanup',
  '/answers/what-is-metadata-only-email-analysis',
  '/beta',
  '/blog',
  '/blog/metadata-only-is-a-design-constraint',
  '/blog/reversible-does-not-mean-risk-free',
  '/blog/why-cleanup-starts-with-senders',
  '/changelog',
  '/compare',
  '/contact',
  '/cookies',
  '/faq',
  '/help',
  '/how-it-works',
  '/how-to/auto-archive-future-emails-in-gmail',
  '/how-to/bulk-delete-emails-from-one-sender',
  '/how-to/clean-gmail-by-sender',
  '/how-to/stop-promotional-emails-gmail',
  '/how-to/unsubscribe-from-emails-gmail',
  '/inbox-simulator',
  '/llms.txt',
  '/methodology',
  '/pricing',
  '/privacy',
  '/refunds',
  '/security',
  '/sign-in',
  '/terms',
  '/vs/clean-email',
  '/vs/gmail-filters',
  '/vs/leave-me-alone',
  '/vs/sanebox',
  '/vs/trimbox',
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
