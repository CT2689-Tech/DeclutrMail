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
 * WHY THESE LIMITS. Every route has a hard cap in the generated table
 * `scripts/web-bundle-budget.json`: its measured size plus a guaranteed
 * headroom floor of max(5%, 5 kB), rounded up to a whole kB (`budgetFor`).
 * They are a ratchet — "this route may not get heavier by accident" — not
 * a claim that any route is fast enough. A route that exceeds its cap
 * fails the run.
 *
 * Hand-tuned limits with 0.1-0.4 kB of headroom failed 15 of 41 CI runs
 * and 3 of 4 merge-queue ejections from Oct 1-10 2026. In the queue, two
 * PRs that each passed alone went over when combined. The floor absorbs
 * that drift. Growth past it still fails, and it now needs one generated
 * commit:
 *
 *   pnpm --filter @declutrmail/web build && pnpm check:bundle --rebaseline
 *
 * That rewrites the table from this build, deterministically (sorted
 * keys, fixed rounding, no dates). A measured route with no entry fails
 * the run, so a page added since the last rebaseline, or an entry deleted
 * by hand, cannot borrow a looser cap: every route is held to its own
 * measurement. The contract test fails when a committed entry does not
 * match the formula, so a hand-tightened cap cannot creep back in.
 *
 * GROWTH WARNING. With `--baseline <file>` (main's measured sizes, which
 * push-to-main CI uploads), any route that grew more than 2 kB is named
 * in a warning and the step summary. It is advice for the reviewer and
 * never changes the exit code. When there is no baseline, the summary says
 * growth was not compared rather than reading as "no growth".
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
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

// The committed budget table, which `--rebaseline` rewrites.
export const TABLE_PATH = path.join(repoRoot, 'scripts/web-bundle-budget.json');
const tablePath = process.env.BUNDLE_BUDGET_TABLE ?? TABLE_PATH;

/** Growth vs main above this is named in a non-blocking warning. */
export const GROWTH_WARN_KB = 2;

/**
 * The hard cap for a route measured at `kb`: at least 5% and at least
 * 5 kB above it, rounded up to a whole kB. Computed in tenths of a kB, so
 * the same measurement always yields the same cap on every machine.
 */
export function budgetFor(kb) {
  const tenths = Math.round(kb * 10);
  const headroom = Math.max(Math.ceil(tenths / 20), 50);
  return Math.ceil((tenths + headroom) / 10);
}

const round1 = (kb) => Math.round(kb * 10) / 10;

/**
 * The table for these measurements (route key → kB), in its committed
 * form: keys sorted, sizes to 0.1 kB, and nothing else, so two runs over
 * the same build write identical bytes.
 */
export function buildTable(measured) {
  const routes = {};
  for (const route of Object.keys(measured).sort()) {
    const measuredKb = round1(measured[route]);
    routes[route] = { measuredKb, budgetKb: budgetFor(measuredKb) };
  }
  return {
    $comment:
      'Generated by `pnpm check:bundle --rebaseline` after `pnpm --filter @declutrmail/web build`. ' +
      'budgetKb = measuredKb + max(5%, 5 kB), rounded up. A measured route missing here fails the check.',
    routes,
  };
}

export const serializeTable = (table) => `${JSON.stringify(table, null, 2)}\n`;

function readTable(file) {
  const table = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof table.routes !== 'object' || table.routes === null) throw new Error('no routes');
  for (const [route, entry] of Object.entries(table.routes)) {
    if (!Number.isFinite(entry?.budgetKb)) throw new Error(`${route} has no numeric budgetKb`);
  }
  return table;
}

/**
 * Pages that answer with a redirect by design, and where to. Such a page
 * ships no JS of its own: the browser follows the redirect, and the
 * target is budgeted as its own route. The run still fails if the page
 * stops redirecting there, so a page that starts rendering gets measured.
 */
export const REDIRECTS = {
  '/(app)/quiet/page': '/autopilot/settings',
  '/(marketing)/demo/page': '/inbox-simulator', // launch-post links, 308 (SEO sweep 2026-08-04)
  // Flag-off only. A build with PRICING_V2=true renders this page and
  // must drop this line so the rendered route is measured.
  ...(process.env.PRICING_V2 === 'true'
    ? {}
    : { '/(marketing)/pricing/changelog/page': '/pricing' }),
};

/**
 * The two route groups this script budgets.
 * A route in NEITHER group (`/onboarding`, the root `/_not-found`) is
 * deliberately unmeasured — add it here when it deserves a ratchet.
 */
const GROUPS = [
  { label: 'public', prefix: '/(marketing)/' },
  { label: 'authed', prefix: '/(app)/' },
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
  // Organic beta retires at GA, but the OAuth denial page still renders.
  // Measure that recovery variant and verify its own chunks as usual.
  if (url === '/beta') return '/beta?reason=not_invited';
  if (!url.includes('[')) return url;
  const built = Object.entries(prerendered).find(([, entry]) => entry.srcRoute === url);
  // Comparison pages read runtime pricing, so a known slug may have no prerendered entry.
  if (!built && url === '/vs/[competitor]') return '/vs/clean-email';
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

const USAGE =
  'usage: check-web-bundle-budget.mjs [--rebaseline] [--sizes-out <file>] [--baseline <file>]';

/** Unknown flags fail: a mistyped `--rebaseline` must not quietly run a check. */
export function parseArgs(argv) {
  const options = { rebaseline: false, sizesOut: null, baseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue; // `pnpm check:bundle -- --rebaseline` forwards a literal `--`.
    if (arg === '--rebaseline') {
      options.rebaseline = true;
    } else if ((arg === '--sizes-out' || arg === '--baseline') && argv[i + 1]) {
      options[arg === '--baseline' ? 'baseline' : 'sizesOut'] = argv[(i += 1)];
    } else {
      throw new BudgetError(`unknown or incomplete argument ${arg}\n  ${USAGE}`);
    }
  }
  return options;
}

/**
 * Routes that grew more than `limitKb` against `baseline` (route → kB).
 * Compared in tenths, the precision both sides are recorded at, so 2.0 kB
 * of growth is never read as 2.0000001. A route main does not have is new,
 * not grown.
 */
export function growthOver(rows, baseline, limitKb = GROWTH_WARN_KB) {
  return rows
    .filter(({ route }) => typeof baseline[route] === 'number')
    .map(({ route, kb }) => ({
      route,
      fromKb: baseline[route],
      toKb: round1(kb),
      grewTenths: Math.round(kb * 10) - Math.round(baseline[route] * 10),
    }))
    .filter(({ grewTenths }) => grewTenths > limitKb * 10)
    .sort((a, b) => b.grewTenths - a.grewTenths || a.route.localeCompare(b.route));
}

/**
 * The non-blocking growth report: a workflow warning per grown route plus
 * the step summary. It never affects the exit code. An unreadable baseline,
 * or one sharing no route with this build, is reported as "not compared",
 * never as "no growth".
 */
function reportGrowth(rows, baselinePath) {
  const lines = [`### Bundle growth vs main (warning above ${GROWTH_WARN_KB} kB)`, ''];
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (typeof baseline.routes !== 'object' || baseline.routes === null) {
      throw new Error('it lists no routes');
    }
  } catch (error) {
    notCompared(lines, `main's measured sizes could not be read (${error.code ?? error.message})`);
    return;
  }
  const against = baseline.commit ? `main @ ${String(baseline.commit).slice(0, 7)}` : 'main';
  const compared = rows.filter(({ route }) => typeof baseline.routes[route] === 'number').length;
  if (compared === 0) {
    notCompared(lines, `${against}'s measured sizes share no route with this build`);
    return;
  }
  const grown = growthOver(rows, baseline.routes);
  for (const { route, fromKb, toKb, grewTenths } of grown) {
    console.log(
      `::warning title=Bundle growth::${route} grew ${(grewTenths / 10).toFixed(1)} kB vs ${against} (${fromKb} → ${toKb} kB)`,
    );
  }
  if (grown.length === 0) {
    lines.push(
      `No route grew more than ${GROWTH_WARN_KB} kB vs ${against} (${compared} compared).`,
    );
  } else {
    lines.push(
      `${grown.length} of ${compared} route(s) grew more than ${GROWTH_WARN_KB} kB vs ${against}:`,
      '',
    );
    lines.push('| Route | main | this build | growth |', '|---|---:|---:|---:|');
    for (const { route, fromKb, toKb, grewTenths } of grown) {
      lines.push(
        `| \`${route}\` | ${fromKb} kB | ${toKb} kB | +${(grewTenths / 10).toFixed(1)} kB |`,
      );
    }
  }
  writeSummary(lines);
}

function notCompared(lines, reason) {
  console.log(`::notice title=Bundle growth not compared::${reason}`);
  lines.push(`Not compared: ${reason}. The budget check itself still ran.`);
  writeSummary(lines);
}

function writeSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  let table;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`✗ bundle budget: ${error.message}`);
    return 1;
  }
  if (!options.rebaseline) {
    try {
      table = readTable(tablePath);
    } catch (error) {
      console.error(
        `✗ bundle budget: cannot read the budget table ${tablePath} (${error.message}).\n` +
          '  Regenerate it with `pnpm check:bundle --rebaseline`.',
      );
      return 1;
    }
  }

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
            rows.push({ route, kb, group: group.label });
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
  // redirect), or the run fails naming it — and nothing is rebaselined.
  if (failures.length > 0) {
    console.error(
      `✗ bundle budget: ${failures.length} of ${routes.length} route(s) not measured:\n  ${failures.sort().join('\n  ')}`,
    );
    return 1;
  }

  const measured = Object.fromEntries(rows.map(({ route, kb }) => [route, kb]));
  if (options.sizesOut) {
    const sizes = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((route) => [route, round1(measured[route])]),
    );
    writeFileSync(
      options.sizesOut,
      `${JSON.stringify({ commit: process.env.GITHUB_SHA ?? null, routes: sizes }, null, 2)}\n`,
    );
  }

  if (options.rebaseline) {
    const rebased = buildTable(measured);
    writeFileSync(tablePath, serializeTable(rebased));
    console.log(
      `✓ bundle budget: rebaselined ${rows.length} route(s) into ${path.relative(repoRoot, tablePath)}. Commit it.`,
    );
    return 0;
  }

  rows.sort((a, b) => b.kb - a.kb);
  for (const row of rows) {
    const listed = Object.hasOwn(table.routes, row.route) ? table.routes[row.route] : null;
    if (!listed) {
      row.unlisted = true;
      console.log(
        `NONE ${row.kb.toFixed(1).padStart(6)} kB / ??? kB  ${row.route}  (not in the table)`,
      );
      continue;
    }
    row.budgetKb = listed.budgetKb;
    row.over = row.kb > row.budgetKb;
    console.log(
      `${row.over ? 'OVER' : 'ok  '} ${row.kb.toFixed(1).padStart(6)} kB / ${String(row.budgetKb).padStart(3)} kB  ${row.route}`,
    );
  }
  const stale = Object.keys(table.routes).filter(
    (route) => !(route in measured) && !redirected.includes(route),
  );
  if (stale.length > 0) {
    console.log(
      `\nNote: the budget table lists ${stale.length} route(s) this build does not have ` +
        `(${stale.sort().join(', ')}); the next rebaseline drops them.`,
    );
  }

  if (options.baseline) reportGrowth(rows, options.baseline);

  const unlisted = rows.filter((row) => row.unlisted);
  if (unlisted.length > 0) {
    console.error(
      `\n✗ bundle budget: ${unlisted.length} measured route(s) have no cap in the table:\n  ` +
        `${unlisted
          .map((row) => row.route)
          .sort()
          .join('\n  ')}\n` +
        '  Run `pnpm --filter @declutrmail/web build && pnpm check:bundle --rebaseline`\n' +
        '  and commit scripts/web-bundle-budget.json so each route gets its own cap.',
    );
  }
  const failed = rows.filter((row) => row.over);
  if (failed.length > 0) {
    console.error(
      `\n✗ bundle budget: ${failed.length} of ${rows.length} route(s) over.\n` +
        '  If the growth is intended, run `pnpm --filter @declutrmail/web build && pnpm check:bundle --rebaseline`\n' +
        '  and commit scripts/web-bundle-budget.json; the diff shows what grew.',
    );
  }
  if (unlisted.length > 0 || failed.length > 0) return 1;

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
