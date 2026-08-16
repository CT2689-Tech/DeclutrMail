#!/usr/bin/env node
/**
 * First Load JS budget for every route — public marketing AND the
 * authed app.
 *
 * D160 lists "Bundle size budget (frontend)" among the checks CI must
 * run (docs/execution/Implementation-Plan.md:4144). It was never built,
 * and the implementation log records D160 as verified anyway — so until
 * now nothing could observe a marketing page doubling its JS.
 *
 * WHY THE AUTHED ROUTES ARE HERE NOW. The first version of this script
 * covered `(marketing)` only, and the Lighthouse gate scores four
 * marketing URLs — so the two HEAVIEST routes in the product, the ones
 * a paying user actually lives in, were the only ones nothing watched.
 * Measuring the page-load complaint on 2026-08-15 put numbers on it:
 * `/senders` at 221.5 kB and `/triage` at 211.3 kB, roughly double the
 * marketing long tail, and neither had ever been observed. A budget
 * that skips the routes that matter most is the failure mode this file
 * already warns about two paragraphs down.
 *
 * WHAT IT MEASURES. For each route, the union of the JS chunks Next
 * lists for it in `.next/app-build-manifest.json`, gzipped and summed.
 * Gzip is what makes the number comparable to Next's own "First Load
 * JS" column — that column is compressed, and summing raw bytes instead
 * reads ~3.3x higher, which is how the first draft of this script
 * managed to fail every route at once.
 *
 * WHY DERIVED, NOT LISTED. The route set comes from the manifest, so a
 * new page is budgeted the day it ships. A hand-maintained list would
 * let a new page arrive unmeasured, which is the failure mode this repo
 * already knows: a check that passes because it is looking at nothing.
 *
 * WHY THESE LIMITS. A per-group default plus an override table, each
 * set from the measured value rounded up to the next 5 kB. They are a
 * ratchet — "this route may not get heavier by accident" — not a claim
 * that any route is fast enough. `/senders` at 221.5 kB is emphatically
 * NOT a blessing of 221.5 kB; it is a floor under the regression.
 * Raising one is a deliberate edit that belongs in a commit message;
 * lowering one as routes get lighter is always welcome.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = path.join(repoRoot, 'apps/web/.next');

/**
 * Budget for any public route without an override, in gzipped kB.
 *
 * Baseline as of the `optimizePackageImports` change: the long tail of
 * content pages sits at 108.4-108.7 kB, the two ProductStory pages and
 * /sign-in at 113.7.
 */
const DEFAULT_KB = 120;

/**
 * Budget for an authed `(app)` route without an override.
 *
 * Set at 195 because the mid-weight cluster — settings, brief, activity,
 * autopilot, billing, screener — sits at 188.0-192.4 kB and shares
 * essentially one chunk graph. A NEW authed screen landing under this
 * is normal; landing over it means it pulled in something the others do
 * not, which is exactly the moment worth a second look.
 */
const AUTHED_DEFAULT_KB = 195;

/**
 * Routes that legitimately carry more, keyed by manifest page key.
 * Measured 2026-08-15; comments carry the observed value so drift is
 * visible in the diff when someone edits a number.
 */
const OVERRIDES_KB = {
  '/(marketing)/page': 125, // 117.2 — hero + ledger demo + FAQ
  '/(marketing)/pricing/page': 130, // 121.5 — cycle toggle, tier cards, compare table
  '/(marketing)/inbox-simulator/page': 190, // 181.8 — the only real interactive surface

  // The three heaviest surfaces in the product. Each is above the authed
  // default for a reason worth naming, so a future reader can tell an
  // earned cost from an accident.
  '/(app)/senders/page': 225, // 221.5 — grid + table + compose strip + saved views
  '/(app)/triage/page': 215, // 211.3 — action sheet, preview, undo tray
  '/(app)/senders/[id]/page': 210, // 207.8 — detail: timeseries + history + messages

  // Below the authed default, pinned tighter than it so they cannot
  // silently drift up into the cluster.
  '/(app)/settings/senders/page': 180, // 179.6
  '/(app)/quiet/page': 175, // 174.6
  '/(app)/settings/privacy/page': 175, // 173.4
  '/(app)/later/page': 145, // 144.0
  '/(app)/followups/page': 145, // 141.0
  '/(app)/admin/security/page': 125, // 120.4
  '/(app)/settings/help/page': 115, // 112.2
};

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(nextDir, 'app-build-manifest.json'), 'utf8'));
} catch {
  console.error(
    '✗ bundle budget: no .next/app-build-manifest.json.\n' +
      '  Run `pnpm --filter @declutrmail/web build` first.',
  );
  process.exit(1);
}

const gzipCache = new Map();
function gzippedSize(file) {
  const cached = gzipCache.get(file);
  if (cached !== undefined) return cached;
  let size;
  try {
    size = gzipSync(readFileSync(path.join(nextDir, file))).length;
  } catch {
    // A listed chunk missing from disk is a broken build, not a budget
    // question — surface it rather than silently under-counting.
    console.error(`✗ bundle budget: ${file} is in the manifest but not on disk`);
    process.exit(1);
  }
  gzipCache.set(file, size);
  return size;
}

/**
 * The two route groups this script budgets, each with its own default.
 * A route in NEITHER group (`/onboarding`, the root `/_not-found`) is
 * deliberately unmeasured — add it here when it deserves a ratchet.
 */
const GROUPS = [
  { label: 'public', prefix: '/(marketing)/', defaultKb: DEFAULT_KB },
  { label: 'authed', prefix: '/(app)/', defaultKb: AUTHED_DEFAULT_KB },
];

const rows = [];
for (const group of GROUPS) {
  const routes = Object.keys(manifest.pages)
    .filter((key) => key.startsWith(group.prefix) && key.endsWith('/page'))
    .sort();

  // Each group is asserted non-empty SEPARATELY. A single combined check
  // would let one group vanish — a renamed route group, a build that
  // emitted only half the app — while the other kept the script green,
  // which is the "passes because it is looking at nothing" failure this
  // file exists to avoid.
  if (routes.length === 0) {
    console.error(
      `✗ bundle budget: no ${group.prefix} routes in the manifest — that group went unmeasured.`,
    );
    process.exit(1);
  }

  for (const route of routes) {
    const files = new Set(manifest.pages[route].filter((f) => f.endsWith('.js')));
    const kb = [...files].reduce((sum, file) => sum + gzippedSize(file), 0) / 1024;
    const budgetKb = OVERRIDES_KB[route] ?? group.defaultKb;
    rows.push({ route, kb, budgetKb, over: kb > budgetKb, group: group.label });
  }
}

rows.sort((a, b) => b.kb - a.kb);
for (const row of rows) {
  console.log(
    `${row.over ? 'OVER' : 'ok  '} ${row.kb.toFixed(1).padStart(6)} kB / ${String(row.budgetKb).padStart(3)} kB  ${row.route}`,
  );
}

const failed = rows.filter((row) => row.over);
if (failed.length > 0) {
  console.error(`\n✗ bundle budget: ${failed.length} of ${rows.length} route(s) over.`);
  process.exit(1);
}

const counts = GROUPS.map(
  (g) => `${rows.filter((r) => r.group === g.label).length} ${g.label}`,
).join(' + ');
console.log(`\n✓ bundle budget: ${rows.length} route(s) within budget (${counts}, gzipped).`);
