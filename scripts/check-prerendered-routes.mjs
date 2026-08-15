#!/usr/bin/env node
/**
 * The public site must actually be prerendered (Option A′, founder
 * 2026-08-14). Run after `next build`, from the repo root.
 *
 * WHY A SCRIPT AND NOT THE ROUTE TABLE. `next build` prints a `○ ● ƒ`
 * column that is NOT trustworthy for this question: before this change
 * it marked `/blog/[slug]` and `/vs/[competitor]` as `●` (SSG) because
 * they declare `generateStaticParams`, printed "Generating static pages
 * (71/71)", and emitted zero HTML files. `prerender-manifest.json` is
 * the authority — a route is in it only if HTML was really written.
 *
 * WHAT IT CATCHES. One `headers()` / `cookies()` / `searchParams` read
 * in any shared node — a layout, or the root `not-found.tsx`, which Next
 * folds into every route's tree — silently un-statics the whole public
 * site. Nothing else fails when that happens: types pass, tests pass,
 * pages render. The only signal is this manifest going quiet, so it is
 * asserted in CI rather than trusted to review.
 *
 * The expected set is DERIVED from the route files, so a new marketing
 * page is covered the day it lands without editing this script.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..', 'apps', 'web');
const MARKETING = path.join(WEB, 'src', 'app', '(marketing)');
const MANIFEST = path.join(WEB, '.next', 'prerender-manifest.json');

/**
 * Public routes that are dynamic ON PURPOSE, each for a stated reason.
 * Adding to this list is a decision, not a fix — it costs that page its
 * CDN cache.
 */
const INTENTIONALLY_DYNAMIC = new Map([
  ['/', 'quotes prices via PricingTeaser; needs edge geo for the D117 rail'],
  ['/pricing', 'the page where someone decides to pay; needs edge geo'],
  ['/beta', 'reads searchParams (invite code)'],
  ['/sign-in', 'reads searchParams (return destination)'],
  ['/changelog/rss.xml', 'route handler, not a page'],
  ['/pricing.md', 'route handler, not a page'],
]);

/** Every route the `(marketing)` group defines, as URL paths. */
function marketingRoutes(dir = MARKETING, prefix = '') {
  const routes = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(...marketingRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === 'page.tsx' || entry.name === 'route.ts') {
      routes.push(prefix === '' ? '/' : prefix);
    }
  }
  return routes;
}

if (!existsSync(MANIFEST)) {
  console.error(`✗ ${path.relative(process.cwd(), MANIFEST)} not found — run the web build first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const prerendered = new Set(Object.keys(manifest.routes));

const missing = [];
let staticCount = 0;

for (const route of marketingRoutes().sort()) {
  if (INTENTIONALLY_DYNAMIC.has(route)) continue;

  if (route.includes('[')) {
    // A dynamic segment prerenders as concrete children (`/vs/gmail`),
    // never under its bracket form. One child is proof the segment ran.
    const base = `${route.slice(0, route.indexOf('/['))}/`;
    const children = [...prerendered].filter((r) => r.startsWith(base));
    if (children.length === 0) missing.push(`${route} (no prerendered children under ${base})`);
    else staticCount += children.length;
    continue;
  }

  if (prerendered.has(route)) staticCount += 1;
  else missing.push(route);
}

// The root not-found is the trap this script exists for: it is shared by
// every route, so it must be prerendered too.
if (!prerendered.has('/_not-found')) missing.push('/_not-found (root not-found.tsx went dynamic)');

if (missing.length > 0) {
  console.error(`✗ ${missing.length} public route(s) are NOT prerendered:\n`);
  for (const route of missing) console.error(`    ${route}`);
  console.error(`\n  A per-request read (headers/cookies/searchParams) in a SHARED node is the`);
  console.error(`  usual cause — the root layout, (marketing)/layout.tsx, or not-found.tsx.`);
  console.error(`  See docs/execution/static-marketing-csp-options-2026-08-14.md.`);
  process.exit(1);
}

console.log(`✓ ${staticCount} public routes prerendered as static HTML.`);
for (const [route, why] of INTENTIONALLY_DYNAMIC) console.log(`  · ${route} — dynamic: ${why}`);
