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
 * WHAT IT MEASURES. For each route, the JavaScript the browser loads to
 * show it, as served to a signed-out request: `next start` serves the
 * build on a free local port, every route is fetched once, and every JS
 * chunk its HTML names — the `<script>` tags and the client references
 * in the React Server Components payload, which React loads before it
 * hydrates — is counted once, gzipped and summed. Gzip keeps the number
 * comparable to a compressed transfer — summing raw bytes reads ~3.3x
 * higher, which is how the first draft of this script managed to fail
 * every route at once.
 *
 * NOT COUNTED: `<script noModule>` (the polyfills, which modern browsers
 * never fetch), and anything that loads after that first response — a
 * `next/dynamic` chunk, a link prefetch, a client component that only
 * renders once someone is signed in or data arrives.
 *
 * WHY SERVED HTML, NOT THE BUILD MANIFEST (2026-09-27). This script used
 * to sum `app-build-manifest.json`'s entry for the page alone — as does
 * Next's "First Load JS" column. The browser loads more than that entry
 * — 36-47 kB more on a public route, 64-132 kB on a signed-in one: every
 * layout above the page, the error and loading boundaries on its path,
 * and chunks filed under OTHER routes when a shared client component was
 * bundled there first (/settings/help loads 14 kB of /settings' page
 * entry). None of it was budgeted: it could grow with nothing failing,
 * and moving weight off it could not register (#804 cut 4.7-4.8 kB from
 * 16 of 17 signed-in routes' real first load while this read +0.03). A
 * layout change now spends the headroom of every route under it at once
 * — which is the point.
 *
 * WHY IT FAILS CLOSED. A measure that quietly looks at the wrong page is
 * worse than none. The run fails, naming the route, when the server never
 * starts or answers, a route answers anything but 200 (a redirect to
 * sign-in included) and is not a declared redirect below, its HTML names
 * no chunks, or it names none of the route's own page chunks — the sign
 * of some other page served in its place (a sign-in page, a 404). Layout
 * chunks cannot show that: the layouts list chunks every page shares. The
 * server is stopped on every way out the script can catch.
 *
 * WHY DERIVED, NOT LISTED. The route set comes from the build manifest,
 * and every route in it is measured or the run fails, so a new page is
 * budgeted the day it ships. A hand-maintained list would let a new page
 * arrive unmeasured, which is the failure mode this repo already knows:
 * a check that passes because it is looking at nothing.
 *
 * WHY THESE LIMITS. A per-group default plus an override table. They are
 * a ratchet — "this route may not get heavier by accident" — not a claim
 * that any route is fast enough. `/senders` at 289.0 kB is
 * emphatically NOT a blessing of 289.0 kB; it is a floor under the
 * regression. Raising one is a deliberate edit that belongs in a commit
 * message; lowering one as routes get lighter is always welcome.
 *
 * RE-BASED 2026-09-27 onto this measure. Each existing override moved by
 * what its route loads beyond its old page entry, rounded up, so it kept
 * its headroom (/settings/senders, lowered instead, says why where it
 * sits). Routes on a default share one limit per layout chain, so
 * equal real weight gets an equal budget: headroom that only existed
 * because a chunk was filed under a layout or another route's entry went.
 * Dated notes below quote the page-entry measure of their day.
 *
 * FIXED, NOT JUST RE-BUDGETED (2026-09-28). Seven marketing routes leaked
 * ~8 kB of the home page's chunks because each rendered `next/link` only
 * via the shared header/footer, never directly — so their OWN entry had
 * no correct manifest mapping for it and inherited whichever entry's
 * mapping won the group merge (the home page's, larger). Converting an
 * existing internal `<a>` in each route's own server-rendered content to
 * `next/link`'s `Link` (compare, vs/[competitor] and alternatives/[tool]'s
 * cross-links; how-it-works, methodology and security's in-copy links;
 * sign-in's privacy/security links) gives each route its OWN correct
 * mapping, self-correcting exactly as /faq already did by accident. All
 * seven now measure within 0.2 kB of the long tail; the override is gone.
 * The same fix does not reach two SMALLER leaks (1.6 kB, /pricing and
 * /inbox-simulator): both route through a `'use client'` screen, and a
 * `next/link` rendered from inside an already-client tree does not get
 * its own manifest entry the same way. /settings/help's 14 kB leak (a
 * different client reference, `HydrationBoundary`) is unfixed for the
 * same reason as those two: no genuine content on the route would use
 * either client reference directly, and adding one just to change a
 * manifest entry would be measuring the fix, not making one.
 */

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(repoRoot, 'apps/web');
// The contract test points these at a fixture build and a fixture server.
const nextDir = process.env.BUNDLE_BUDGET_NEXT_DIR ?? path.join(webDir, '.next');
const fixtureServer = process.env.BUNDLE_BUDGET_SERVER;
const readyTimeoutMs = Number(process.env.BUNDLE_BUDGET_READY_TIMEOUT_MS ?? 60_000);
const ROUTE_TIMEOUT_MS = 30_000;
const CONCURRENCY = 4;

/**
 * Budget for any public route without an override, in gzipped kB.
 *
 * Every public route renders inside the same two layouts. As served
 * (2026-09-27), the long tail of content pages loads 147.0-147.2 kB and
 * /cookies, the heaviest, 149.5; 151 keeps /cookies' headroom. (On the
 * page-entry measure the same tail read 111.2-113.7 against 115.)
 */
export const DEFAULT_KB = 151;

/**
 * Budget for an authed `(app)` route without an override.
 *
 * Set at 264, combining two same-day increases that both landed in the
 * shared chunk graph this default's cluster pulls from: zod 4.4.3 → 4.6.5
 * grew the shared zod chunk every authed route loads by about 7 kB gzip,
 * and zone-explicit `daysSince` (DECLUTRMAIL-WEB-2C) added
 * `Intl.DateTimeFormat` calendar math to the shared senders/data chunk.
 * Measured together (PR #764 merge, 2026-09-28): /activity, the heaviest
 * route on this default, is 261.4 kB (/autopilot and /settings/help follow
 * at 260.4-260.5). 264 leaves about 2.6 kB. A NEW authed screen landing
 * under this is normal; landing over it means it pulled in something the
 * others do not, which is exactly the moment worth a second look.
 */
export const AUTHED_DEFAULT_KB = 264;

/**
 * Routes that legitimately carry more, or are pinned tighter, keyed by
 * manifest page key. Trailing comments carry the observed value as served
 * (2026-09-27) so drift is visible in the diff when someone edits a
 * number; dated notes quote the page-entry measure of their day.
 */
export const OVERRIDES_KB = {
  '/(marketing)/page': 156, // 154.3 — hero + ledger demo + FAQ
  '/(marketing)/pricing/page': 166, // 165.4 — cycle toggle, tier cards, compare table
  // Raised 175 -> 177 on 2026-08-27. The comment said 169.8 (measured
  // 2026-08-16) but the route had already drifted to 174.3 on main, so
  // the headroom was 0.7 kB and nobody knew. This change adds 0.7 more:
  // every `UNIFORM_UNDO_WINDOW_DAYS` consumer moved to the direct
  // `@declutrmail/shared/entitlements/undo-window` subpath, which costs
  // a little barrel dedupe and buys back a shipped `undefined` (see
  // that module's consumers). 177 restores real headroom AND records
  // the true number.
  '/(marketing)/inbox-simulator/page': 218, // 201.5 — the only real interactive surface

  // The three heaviest surfaces in the product. Each is above the authed
  // default for a reason worth naming, so a future reader can tell an
  // earned cost from an accident.
  // Raised 292 -> 300 on 2026-09-28 (PR #764 merge), combining the
  // zod-chunk raise (see AUTHED_DEFAULT_KB) with zone-explicit `daysSince`
  // (DECLUTRMAIL-WEB-2C) on the same route: measured 298.0 together. 300
  // leaves ~2 kB, same shape as the prior raise.
  '/(app)/senders/page': 300, // 298.0 — grid + table + compose strip + saved views + mobile dialect
  // Raised 210 -> 216 on 2026-08-30 (D54): measured 212.0, up from 206.5
  // on main. The phone dialect (ADR-0018) added a third row-rendering
  // path — swipe/long-press gestures on `SenderListRow`, the
  // `ConfirmActionModal` sheet variant, and `SelectionFab` — all real,
  // user-reached code on this route, none of it behind a lazy boundary
  // (the phone/desktop branch is a runtime `useIsAtMost` check, not a
  // route split, so both ship in the same chunk). 216 restores the
  // same ~4 kB headroom the prior raise left, not more.
  // Raised 200 -> 206 on 2026-08-27; measured 202.2, up from 198.2 on
  // main (the 195.9 in the old comment was stale). The D226 preview
  // gained the verification detail the senders confirm modal already
  // carried — where the sender's mail actually is, the Gmail
  // cross-check, the current-match sample, and the cleanup cost — so
  // the reader can check the real set before confirming on the fastest
  // surface in the product. The block sits in its own module and
  // reaches both preview paths as a rendered node, which is what keeps
  // it OUT of the public inbox simulator's chunk (that route imports
  // `TriageRow`, and importing the block there put it at 175.5 against
  // a 175 budget). Headroom is deliberately small: 206 leaves ~4 kB, so
  // the next addition here still has to argue for itself.
  '/(app)/triage/page': 283, // 281.1 — action sheet, preview + verification detail, undo tray
  // 199.9 (was 191.3), measured after the 2026-09-02 sender-detail QA
  // batch (18 findings — mailbox-scope-reset guard, fuller/more accurate
  // KPI + hero copy, the toolbar's primaryVerbReason). Checked this was
  // real: the route's own page chunk carries the new code (confirmed via
  // app-build-manifest.json + grepping the built chunks for symbols
  // unique to the diff — none leaked into a shared chunk), not a barrel
  // import dragging in unrelated weight. 204 leaves ~4 kB, same margin as
  // /triage above.
  '/(app)/senders/[id]/page': 284, // 281.5
  // Editorial integration (2026-09-22): measured 186.2 / 180.6 / 125.0 kB
  // for billing / screener / admin. The public theme and refreshed shared
  // tokens also reach billing's shell. Allow its measured 0.2 kB increase
  // while keeping the general 180 kB ratchet and other routes unchanged.
  '/(app)/billing/page': 266, // 263.5 — checkout + invoices + plan controls + editorial shell
  '/(app)/screener/page': 261, // 258.8 — queue + decision controls + editorial shell
  // 2026-09-24: the scannable Brief and optional generated-note view measure 180.2 kB.
  // Keep a route-specific ceiling instead of relaxing the 180 kB app default.
  '/(app)/brief/page': 260, // 257.5

  // Was riding the AUTHED_DEFAULT_KB ceiling with 0 kB headroom (180.0
  // against 180 — "ok" by the barest possible margin, same shape the
  // /inbox-simulator entry above already warns about: a comment saying
  // there was headroom while the route had already drifted to none).
  // The 2026-09-02 sender-detail QA batch's `packages/shared` copy edits
  // (D226 preview hint, `scoredAgeLabel`, the data-export description)
  // are in the shared chunk graph this whole authed-default cluster
  // pulls from, not anything settings-specific — a few bytes of net
  // string growth there was enough to tip the one route with zero
  // margin left. 184 restores real headroom.
  //
  // This also absorbs a second, independent +0.1 kB (measured 180.1 on
  // this branch alone, pre-merge): `apiErrorDisplayId` (D168) gaining
  // its first production call site (technicalErrorDetails) means it can
  // no longer be dead-code-eliminated from the shared `api/client.ts`
  // chunk. Both deltas land in the same shared cluster; 184 covers both
  // with headroom to spare rather than stacking a second override.
  '/(app)/settings/page': 254, // 251.9

  // Below the authed default, pinned tighter than it so they cannot
  // silently drift up into the cluster.
  '/(app)/settings/privacy/page': 256, // 254.3 — data controls + explainer
  // Lowered from its re-based 266 on 2026-09-27: pinned at 165 against
  // 161.4, it got 16.6 kB lighter and the budget never followed. 250
  // keeps the 3.6 kB margin it was pinned with.
  '/(app)/settings/senders/page': 255, // 253.2
  '/(app)/quiet/page': 249, // 247.0 — schedule controls + explainer
  '/(app)/later/page': 249, // 246.6 — return queue + explainer
  '/(app)/followups/page': 251, // 248.9 — follow-up queue + explainer
  '/(app)/admin/security/page': 244, // 242.0 — operator log + editorial shell
};

/**
 * Pages that answer with a redirect by design, and where to. Such a page
 * ships no JS of its own: the browser follows the redirect, and the
 * target is budgeted as its own route. The run still fails if the page
 * stops redirecting there, so a page that starts rendering gets measured.
 */
export const REDIRECTS = {
  '/(marketing)/demo/page': '/inbox-simulator', // launch-post links, 308 (SEO sweep 2026-08-04)
};

/**
 * The two route groups this script budgets, each with its own default.
 * A route in NEITHER group (`/onboarding`, the root `/_not-found`) is
 * deliberately unmeasured — add it here when it deserves a ratchet.
 */
const GROUPS = [
  { label: 'public', prefix: '/(marketing)/', defaultKb: DEFAULT_KB },
  { label: 'authed', prefix: '/(app)/', defaultKb: AUTHED_DEFAULT_KB },
];

/** A failure the run can name: the build, the server or one route. */
class BudgetError extends Error {}

const CHUNK = /static\/chunks\/[^"'\s<>\\]+?\.js/g;

/**
 * Every JS chunk an HTML response names, each once and decoded to its
 * path on disk (Next URL-encodes each segment, so `[id]` arrives as
 * `%5Bid%5D`): `<script src>` tags and the RSC payload's client
 * references alike. A `<script noModule>` is dropped, because modern
 * browsers never fetch it.
 */
export function chunkRefs(html) {
  const named = (text) => (text.match(CHUNK) ?? []).map((file) => decodeURIComponent(file));
  const refs = new Set(named(html));
  for (const tag of html.match(/<script\b[^>]*\bnomodule\b[^>]*>/gi) ?? []) {
    for (const file of named(tag)) refs.delete(file);
  }
  return refs;
}

/**
 * The URL a page key is served at: route groups dropped, and a dynamic
 * segment filled with a path the build prerendered FROM this route (its
 * `srcRoute`) — else a placeholder, which a client-rendered page like
 * /senders/[id] answers like any id.
 */
export function urlFor(route, prerendered) {
  const url = `/${route
    .split('/')
    .slice(1, -1)
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join('/')}`;
  if (!url.includes('[')) return url;
  const built = Object.entries(prerendered).find(([, entry]) => entry.srcRoute === url);
  return built?.[0] ?? url.replace(/\[[^\]]+\]+/g, 'budget-probe');
}

/** The chunks the manifest files under the route's own page entry. */
function ownPageChunks(manifest, route) {
  const prefix = `static/chunks/app${route.slice(0, -'/page'.length)}/page-`;
  return manifest.pages[route].filter((file) => file.startsWith(prefix) && file.endsWith('.js'));
}

const gzipCache = new Map();
function gzippedSize(file) {
  const cached = gzipCache.get(file);
  if (cached !== undefined) return cached;
  let size;
  try {
    size = gzipSync(readFileSync(path.join(nextDir, file))).length;
  } catch (error) {
    // A named chunk that cannot be read is a broken build, not a budget
    // question — surface it rather than silently under-counting.
    throw new BudgetError(`${file} is named by the HTML but cannot be read (${error.code})`);
  }
  gzipCache.set(file, size);
  return size;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * `next start` on the build (or the contract test's fixture server) in a
 * process group of its own, so `stop` takes anything it forked with it.
 * `stop` also runs on exit and on SIGINT, SIGTERM and SIGHUP; only a
 * SIGKILL of this script can leave the server behind.
 */
async function startServer() {
  const port = await freePort();
  const entry =
    fixtureServer ?? createRequire(path.join(webDir, 'package.json')).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [entry, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: fixtureServer ? path.dirname(fixtureServer) : webDir,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  const keep = (data) => {
    log = (log + data).slice(-2000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  const stop = () => {
    if (child.pid === undefined) return; // It never started.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(
          `✗ bundle budget: could not stop the server (pid ${child.pid}): ${error.message}`,
        );
      }
    }
  };
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      stop();
      process.exit(1);
    });
  }
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    stop,
    log: () => log,
    spawnError: () => spawnError,
  };
}

async function waitUntilReady(server) {
  const deadline = Date.now() + readyTimeoutMs;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (server.spawnError()) {
      throw new BudgetError(`the server could not start: ${server.spawnError().message}`);
    }
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new BudgetError(
        `the server exited (${server.child.exitCode ?? server.child.signalCode}) before answering.\n${server.log()}`,
      );
    }
    try {
      await fetch(`${server.base}/`, { signal: AbortSignal.timeout(2_000) });
      return; // Any HTTP answer means it is up; each route checks its own status.
    } catch (error) {
      last = error.cause?.code ?? error.message; // Not listening yet — retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new BudgetError(
    `the server did not answer within ${readyTimeoutMs / 1000}s (last: ${last}).\n${server.log()}`,
  );
}

async function measureRoute(server, manifest, route, url) {
  const response = await fetch(server.base + url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });
  const to = response.headers.get('location');
  if (route in REDIRECTS) {
    const redirects = response.status >= 300 && response.status < 400;
    if (redirects && to === REDIRECTS[route]) return null;
    throw new BudgetError(
      `answered ${response.status}${to ? ` → ${to}` : ''}, not a redirect to ${REDIRECTS[route]} as declared`,
    );
  }
  if (response.status !== 200) {
    throw new BudgetError(
      `answered ${response.status}${to ? ` → ${to}` : ''}, not 200: that is some other page`,
    );
  }
  const refs = chunkRefs(await response.text());
  if (refs.size === 0) throw new BudgetError('its HTML named no JS chunks at all');
  const own = ownPageChunks(manifest, route);
  if (!own.some((file) => refs.has(file))) {
    throw new BudgetError(
      `its HTML named none of the ${own.length} chunk(s) of its own page: it rendered some other page`,
    );
  }
  return [...refs].reduce((sum, file) => sum + gzippedSize(file), 0) / 1024;
}

export async function main() {
  let manifest;
  let prerendered;
  try {
    manifest = JSON.parse(readFileSync(path.join(nextDir, 'app-build-manifest.json'), 'utf8'));
    prerendered = JSON.parse(
      readFileSync(path.join(nextDir, 'prerender-manifest.json'), 'utf8'),
    ).routes;
  } catch (error) {
    console.error(
      `✗ bundle budget: cannot read the build (${error.message}).\n` +
        '  Run `pnpm --filter @declutrmail/web build` first.',
    );
    return 1;
  }

  const routes = [];
  for (const group of GROUPS) {
    const keys = Object.keys(manifest.pages)
      .filter((key) => key.startsWith(group.prefix) && key.endsWith('/page'))
      .sort();

    // Each group is asserted non-empty SEPARATELY. A single combined check
    // would let one group vanish — a renamed route group, a build that
    // emitted only half the app — while the other kept the script green,
    // which is the "passes because it is looking at nothing" failure this
    // file exists to avoid.
    if (keys.length === 0) {
      console.error(
        `✗ bundle budget: no ${group.prefix} routes in the manifest — that group went unmeasured.`,
      );
      return 1;
    }
    for (const route of keys) routes.push({ route, group, url: urlFor(route, prerendered) });
  }

  const server = await startServer();
  const rows = [];
  const redirected = [];
  const failures = [];
  try {
    await waitUntilReady(server);
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < routes.length) {
          const { route, group, url } = routes[next++];
          try {
            const kb = await measureRoute(server, manifest, route, url);
            if (kb === null) {
              redirected.push(route);
              continue;
            }
            const budgetKb = OVERRIDES_KB[route] ?? group.defaultKb;
            rows.push({ route, kb, budgetKb, over: kb > budgetKb, group: group.label });
          } catch (error) {
            failures.push(`${route} (${url}): ${error.message}`);
          }
        }
      }),
    );
  } catch (error) {
    if (!(error instanceof BudgetError)) throw error;
    console.error(`✗ bundle budget: ${error.message}`);
    return 1;
  } finally {
    server.stop();
  }

  // Every route the build has is measured (or verified as a declared
  // redirect), or the run fails naming it.
  if (failures.length > 0) {
    console.error(
      `✗ bundle budget: ${failures.length} of ${routes.length} route(s) not measured:\n  ${failures.sort().join('\n  ')}`,
    );
    return 1;
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
    return 1;
  }

  const counts = GROUPS.map(
    (g) => `${rows.filter((r) => r.group === g.label).length} ${g.label}`,
  ).join(' + ');
  console.log(
    `\n✓ bundle budget: ${rows.length} route(s) within budget (${counts}, gzipped, as served to a signed-out request)` +
      (redirected.length > 0 ? `; ${redirected.length} declared redirect(s) verified.` : '.'),
  );
  return 0;
}

// Both sides resolved: under --preserve-symlinks-main, import.meta.url
// keeps a symlink's path, and a one-sided compare would exit 0 unmeasured.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main();
}
