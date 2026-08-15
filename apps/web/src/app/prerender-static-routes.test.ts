/**
 * The public site is prerenderable, and only source discipline keeps it
 * that way (Option A′, founder 2026-08-14).
 *
 * ONE per-request read in a shared node — `headers()`, `cookies()`, or a
 * `searchParams` prop — opts every route beneath it out of static
 * generation. That is not a build error, not a type error, and not a test
 * failure anywhere else: the site simply goes back to rendering 30+ pages
 * per request as a Node function, silently, and nobody notices until a
 * launch spike. The repo shipped in exactly that state until this change.
 *
 * These tests read SOURCE rather than rendering, because what must not
 * come back is a call in a file. A render test cannot see it: reading
 * `headers()` renders perfectly well — it just costs the prerender.
 *
 * The authoritative check is the build itself
 * (`scripts/check-prerendered-routes.mjs` against
 * `.next/prerender-manifest.json`, run in CI). This suite is the fast
 * one that fails in the editor, before a build is ever run.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/** Shared nodes: a per-request read here un-statics everything below. */
const MUST_STAY_STATIC = [
  'src/app/layout.tsx',
  'src/app/(marketing)/layout.tsx',
  // `/` quotes prices but stays STATIC anyway: a dynamic route defers
  // every <head> tag past </head>, which blanks the link preview on the
  // most-shared URL the product has. See the page's docblock.
  'src/app/(marketing)/page.tsx',
  'src/app/(marketing)/security/page.tsx',
  'src/app/(marketing)/privacy/page.tsx',
  'src/app/(marketing)/how-it-works/page.tsx',
  'src/app/(marketing)/compare/page.tsx',
  'src/app/(marketing)/faq/page.tsx',
  'src/app/(marketing)/changelog/page.tsx',
  'src/app/(marketing)/blog/[slug]/page.tsx',
  'src/app/(marketing)/vs/[competitor]/page.tsx',
  'src/app/(marketing)/how-to/clean-gmail-by-sender/page.tsx',
  'src/app/(marketing)/answers/how-undo-works-for-gmail-cleanup/page.tsx',
] as const;

/**
 * The deliberate exception. `/pricing` is the page where someone decides
 * to pay, and the India rail is live-provisioned, so it must see the
 * visitor's geo even at the cost of its own <head> tags. `/beta` and
 * `/sign-in` read `searchParams` and were never prerenderable.
 */
const INTENTIONALLY_DYNAMIC = ['src/app/(marketing)/pricing/page.tsx'] as const;

const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8');

/**
 * Source with comments stripped. Load-bearing: the files being guarded
 * carry docblocks that NAME the calls they must not make, so matching
 * raw source flags the very warning that keeps the rule alive.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `headers()` / `cookies()` from next/headers, or a searchParams prop. */
const PER_REQUEST_READ = /from 'next\/headers'|\bcookies\(\)|\bsearchParams\b/;

describe('static prerendering of the public site (Option A′)', () => {
  it.each(MUST_STAY_STATIC)('%s makes no per-request read', (file) => {
    expect(code(file)).not.toMatch(PER_REQUEST_READ);
  });

  it('the root layout is not even async — it has nothing to await', () => {
    // A stricter, cheaper signal than the regex: the moment someone
    // needs `await headers()` here they must also make this async.
    expect(read('src/app/layout.tsx')).toContain('export default function RootLayout');
  });

  it.each(INTENTIONALLY_DYNAMIC)('%s reads geo deliberately, and says why', (file) => {
    const source = read(file);
    expect(code(file)).toMatch(PER_REQUEST_READ);
    // The read must be the billing rail and nothing else — any other
    // per-request dependency on a public page is a new decision.
    expect(source).toContain('COUNTRY_HEADER');
    expect(source).toContain('BillingCurrencyProvider');
    expect(source).toContain('DYNAMIC ON PURPOSE');
  });

  it('every authed group sources its own nonce, since the root no longer can', () => {
    // Their CSP keeps 'strict-dynamic', under which 'self' authorizes
    // nothing — an un-nonced theme script there is a page that never
    // resolves its theme.
    for (const file of ['src/app/(app)/layout.tsx', 'src/app/onboarding/layout.tsx']) {
      const source = read(file);
      expect(source, `${file} must read the nonce`).toContain(`get('x-nonce')`);
      expect(source, `${file} must pass it to ThemeScript`).toMatch(/<ThemeScript nonce=/);
    }
  });

  it('the public group renders the theme script WITHOUT a nonce', () => {
    // A nonce baked into prerendered HTML is stale by definition; the
    // public CSP authorizes the script by 'self' instead.
    const source = read('src/app/(marketing)/layout.tsx');
    expect(source).toContain('<ThemeScript />');
    expect(source).not.toContain('x-nonce');
  });
});
