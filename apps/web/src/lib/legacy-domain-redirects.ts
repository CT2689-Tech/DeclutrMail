/**
 * Legacy-domain redirects: `declutrmail.ai` → `declutrmail.com`.
 *
 * V1 shipped on `declutrmail.ai`; V2 was rebuilt on `declutrmail.com`
 * (D128 canonical origin). The `.ai` registration is NOT retired — it is
 * the Google Workspace primary domain and the GCP organization root
 * (`declutrmail.ai`, org `630332136083`), so it stays registered forever
 * and simply serves 301s.
 *
 * Wired into `next.config.ts` (routing layer, not middleware) so the
 * redirect is handled by the edge router with no function invocation.
 *
 * TWO INVARIANTS, both tested in `legacy-domain-redirects.test.ts`:
 *
 *   1. Every rule is gated on `has: [{ type: 'host' }]` matching the
 *      `.ai` host only. An ungated rule would also match
 *      `declutrmail.com` and redirect the canonical origin to itself —
 *      an infinite loop that takes production down.
 *
 *   2. Every URL in V1's sitemap resolves to a route that EXISTS on V2.
 *      V1 and V2 share only six paths (`/`, `/blog`, `/compare`,
 *      `/contact`, `/faq`, `/pricing`); the other 38 indexed URLs live
 *      under sections V2 does not have (`/guides/*`, `/topics`,
 *      `/tools/*`, `/legal/*`) or use slugs V2 renamed. A bare
 *      path-preserving catch-all would 301 all of them onto V2 404s,
 *      which is strictly worse than leaving them alone: Google drops
 *      the URL and the visitor hits a dead end mid-move.
 */
import type { NextConfig } from 'next';

type Redirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number];

/** Canonical V2 origin (D128). */
export const CANONICAL_ORIGIN = 'https://declutrmail.com';

/**
 * Matches the retired origin's apex + www hosts, and nothing else.
 * Next matches `has.value` against the `Host` header as a full-string
 * regex, so no anchors are needed (and adding them breaks the match).
 */
export const LEGACY_HOST_PATTERN = '(www\\.)?declutrmail\\.ai';

/**
 * V1 URL → nearest V2 equivalent, for every V1 path that does not exist
 * verbatim on V2. Sourced from `https://declutrmail.ai/sitemap.xml`
 * (the indexed set) plus the app routes in V1's `robots.txt`.
 *
 * Where V2 has no topical counterpart the target is the section hub
 * rather than a loosely-related page — a hub is an honest landing spot,
 * a mismatched article is not.
 */
const LEGACY_PATH_MAP: Record<string, string> = {
  // --- Blog: V2 renamed every slug, none carry over -------------------
  '/blog/email-overload-problem': '/blog/why-cleanup-starts-with-senders',
  '/blog/is-unroll-me-safe': '/answers/is-it-safe-to-connect-gmail-app',
  '/blog/launch-announcement': '/changelog',
  '/blog/privacy-first-design': '/blog/metadata-only-is-a-design-constraint',
  '/blog/psychology-of-digital-clutter': '/blog/why-cleanup-starts-with-senders',

  // --- Comparisons: V1 `/compare/<x>-vs-declutrmail` → V2 `/vs/<x>` ---
  '/compare/clean-email-vs-declutrmail': '/vs/clean-email',
  '/compare/leave-me-alone-vs-declutrmail': '/vs/leave-me-alone',
  '/compare/sanebox-vs-declutrmail': '/vs/sanebox',
  // Mailstrom + Unroll.Me have no V2 page — the index is the honest target.
  '/compare/mailstrom-vs-declutrmail': '/compare',
  '/compare/unroll-me-vs-declutrmail': '/compare',
  '/compare/declutrmail-vs-unroll-me-vs-leave-me-alone': '/compare',

  // --- Guides: V2 has no `/guides` section; content split how-to/answers
  '/guides': '/help',
  '/guides/auto-archive-gmail': '/how-to/auto-archive-future-emails-in-gmail',
  '/guides/find-all-email-subscriptions-gmail': '/how-to/unsubscribe-from-emails-gmail',
  '/guides/gmail-storage-full': '/how-to/bulk-delete-emails-from-one-sender',
  '/guides/unsubscribe-safely': '/how-to/unsubscribe-from-emails-gmail',
  '/guides/inbox-zero-strategy': '/answers/best-way-to-clean-gmail-2026',
  '/guides/digital-minimalism-email': '/blog/why-cleanup-starts-with-senders',
  '/guides/privacy-first-email-management': '/answers/what-is-metadata-only-email-analysis',
  '/guides/email-management-glossary': '/help',

  // --- Legal: V1 nested under /legal, V2 is top-level -----------------
  '/legal/privacy': '/privacy',
  '/legal/terms': '/terms',
  '/legal/refund': '/refunds',

  // --- Misc V1-only sections ------------------------------------------
  '/topics': '/blog',
  '/tools/email-cleanup-calculator': '/inbox-simulator',
  // V2 serves `/llms.txt` only; the other two AI-context files are gone.
  '/llms-full.txt': '/llms.txt',
  '/ai.txt': '/llms.txt',

  // --- V1 app routes: never indexed (robots-disallowed), but bookmarked
  '/dashboard': '/triage',
  '/review': '/triage',
  '/undo': '/activity',
  '/auto-clean': '/autopilot',
  '/rules': '/autopilot',
  '/categories': '/senders',
  '/simulate': '/inbox-simulator',
  '/auth/callback': '/sign-in',
};

/**
 * Pattern rules for the one V1 section that is open-ended: V1 published
 * a per-brand unsubscribe guide (`/guides/unsubscribe-from-netflix` …),
 * 13 of which are in the sitemap and more of which may be linked
 * externally. Applied after the exact map, before the catch-all.
 */
const LEGACY_PATTERN_MAP: ReadonlyArray<{ source: string; destination: string }> = [
  {
    source: '/guides/unsubscribe-from-:brand',
    destination: '/how-to/unsubscribe-from-emails-gmail',
  },
  { source: '/guides/:path*', destination: '/help' },
];

/**
 * Resolve a V1 path the way Next will, for tests: exact map wins, then
 * patterns in order, then the path-preserving catch-all.
 */
export function resolveLegacyPath(path: string): string {
  const exact = LEGACY_PATH_MAP[path];
  if (exact) return exact;

  if (path.startsWith('/guides/')) {
    const rest = path.slice('/guides/'.length);
    // `:brand` is a single segment — a deeper path falls to the hub rule.
    if (rest.startsWith('unsubscribe-from-') && !rest.includes('/')) {
      return '/how-to/unsubscribe-from-emails-gmail';
    }
    return '/help';
  }

  return path;
}

/**
 * 301 (not Next's `permanent: true`, which emits 308) because Search
 * Console's Change of Address tool documents 301 as the expected signal.
 */
export function legacyDomainRedirects(): Redirect[] {
  const host = [{ type: 'host', value: LEGACY_HOST_PATTERN }] as const;

  const rule = (source: string, destination: string): Redirect => ({
    source,
    has: [...host],
    destination: `${CANONICAL_ORIGIN}${destination}`,
    statusCode: 301,
  });

  return [
    // Exact renames first — Next matches in array order.
    ...Object.entries(LEGACY_PATH_MAP).map(([source, destination]) => rule(source, destination)),
    ...LEGACY_PATTERN_MAP.map(({ source, destination }) => rule(source, destination)),
    // Everything else keeps its path (`/`, `/pricing`, `/faq`, …).
    rule('/:path*', '/:path*'),
  ];
}
