import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GROWTH_WARN_KB,
  TABLE_PATH,
  budgetFor,
  buildTable,
  chunkRefs,
  growthOver,
  parseArgs,
  serializeTable,
} from './check-web-bundle-budget.mjs';

const SCRIPT = fileURLToPath(new URL('./check-web-bundle-budget.mjs', import.meta.url));

// Fixture caps every listed fixture route gets, so the committed table can
// be rebaselined without touching these tests.
const DEFAULT_KB = 151;
const AUTHED_DEFAULT_KB = 264;

/** Random bytes do not compress, so a file's gzipped size is its size. */
const kib = (n) => randomBytes(Math.round(n * 1024));

// Stands in for `next start`: serves site.json (URL → status, html,
// location) on $PORT and records its pid, so a test can check the script
// stopped it. With `hang` it stays alive but never listens.
const SERVER = `
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
const site = JSON.parse(readFileSync(new URL('./site.json', import.meta.url), 'utf8'));
writeFileSync(new URL('./server.pid', import.meta.url), String(process.pid));
if (site.hang) setInterval(() => {}, 60_000);
else
  createServer((req, res) => {
    const page = site.pages[req.url] ?? { status: 404 };
    res.writeHead(page.status, page.location ? { location: page.location } : {});
    res.end(page.html ?? '');
  }).listen(Number(process.env.PORT), '127.0.0.1');
`;

/** A served page that loads each chunk with a script tag. */
const page = (...chunks) => ({
  status: 200,
  html: chunks.map((c) => `<script src="/_next/static/chunks/${c}" async=""></script>`).join(''),
});

// One route per group, each listed at its group's fixture cap. Both layouts list `shared-1.js`, the way the real
// build's layouts share chunks every page loads.
const PUBLIC = ['webpack-1.js', 'app/layout-1.js', 'shared-1.js', 'app/(marketing)/layout-1.js'];
const APP = ['webpack-1.js', 'app/layout-1.js', 'shared-1.js', 'app/(app)/layout-1.js'];
const PAGES = {
  '/layout': ['webpack-1.js', 'app/layout-1.js'],
  '/(marketing)/layout': ['webpack-1.js', 'shared-1.js', 'app/(marketing)/layout-1.js'],
  '/(marketing)/zz-public/page': ['webpack-1.js', 'app/(marketing)/zz-public/page-1.js'],
  '/(app)/layout': ['webpack-1.js', 'shared-1.js', 'app/(app)/layout-1.js'],
  '/(app)/zz-app/page': ['webpack-1.js', 'app/(app)/zz-app/page-1.js'],
};
const SITE = {
  '/zz-public': page(...PUBLIC, 'app/(marketing)/zz-public/page-1.js'),
  '/zz-app': page(...APP, 'app/(app)/zz-app/page-1.js'),
};

/** A fixture build plus the site its stand-in server answers with. */
function fixture(
  t,
  {
    pages = {},
    chunks = {},
    site = {},
    prerendered = {},
    hang = false,
    routes = {},
    unlisted = [],
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listed = { ...PAGES, ...pages };
  const sizes = Object.fromEntries(
    Object.values(listed)
      .flat()
      .map((name) => [name, kib(1)]),
  );
  for (const [name, bytes] of Object.entries({ ...sizes, ...chunks })) {
    const file = join(dir, 'static/chunks', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const manifest = Object.entries(listed).map(([key, names]) => [
    key,
    names.map((n) => `static/chunks/${n}`),
  ]);
  writeFileSync(
    join(dir, 'app-build-manifest.json'),
    JSON.stringify({ pages: Object.fromEntries(manifest) }),
  );
  writeFileSync(join(dir, 'prerender-manifest.json'), JSON.stringify({ routes: prerendered }));
  writeFileSync(join(dir, 'site.json'), JSON.stringify({ hang, pages: { ...SITE, ...site } }));
  writeFileSync(join(dir, 'server.mjs'), SERVER);
  const caps = { '/(marketing)/': DEFAULT_KB, '/(app)/': AUTHED_DEFAULT_KB };
  const table = {};
  for (const key of Object.keys(listed).filter((k) => k.endsWith('/page'))) {
    const cap = Object.entries(caps).find(([prefix]) => key.startsWith(prefix))?.[1];
    if (cap && !unlisted.includes(key)) table[key] = { measuredKb: 1, budgetKb: cap };
  }
  writeFileSync(join(dir, 'table.json'), JSON.stringify({ routes: { ...table, ...routes } }));
  return dir;
}

const envFor = (dir, env = {}) => ({
  PATH: process.env.PATH,
  BUNDLE_BUDGET_NEXT_DIR: dir,
  BUNDLE_BUDGET_SERVER: join(dir, 'server.mjs'),
  BUNDLE_BUDGET_TABLE: join(dir, 'table.json'),
  ...env,
});

function run(dir, env = {}, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: envFor(dir, env),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

/** The stand-in server's pid once it has written one; the file can exist empty first. */
function serverPid(dir) {
  const file = join(dir, 'server.pid');
  const pid = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
  return pid > 0 ? pid : null;
}

/** True once the stand-in server's process no longer exists. */
function stopped(dir) {
  const pid = serverPid(dir);
  assert.ok(pid, 'the stand-in server never recorded its pid');
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

test('a heavy app layout fails every route under it — the page alone would pass', (t) => {
  const dir = fixture(t, { chunks: { 'app/(app)/layout-1.js': kib(AUTHED_DEFAULT_KB + 5) } });
  const { code, out } = run(dir);

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(app\)\/zz-app\/page/);
  assert.ok(stopped(dir), 'the server outlived the run');
});

test('a public route is held to its layouts too', (t) => {
  const { code, out } = run(
    fixture(t, { chunks: { 'app/(marketing)/layout-1.js': kib(DEFAULT_KB + 5) } }),
  );

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(marketing\)\/zz-public\/page/);
});

test('a chunk filed under another route counts when the HTML loads it', (t) => {
  const home = 'app/(marketing)/zz-home/page-1.js';
  const { code, out } = run(
    fixture(t, {
      pages: { '/(marketing)/zz-home/page': ['webpack-1.js', home] },
      chunks: { [home]: kib(DEFAULT_KB + 5) },
      site: {
        '/zz-home': page(...PUBLIC, home),
        '/zz-public': page(...PUBLIC, 'app/(marketing)/zz-public/page-1.js', home),
      },
    }),
  );

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(marketing\)\/zz-public\/page/);
});

test('a chunk named by a script tag and a client reference counts once', (t) => {
  const own = 'app/(app)/zz-app/page-1.js';
  const twice = page(...APP, own);
  twice.html += `<script>self.__next_f.push([1,"5:I[1,[\\"1\\",\\"static/chunks/${own}\\"]]"])</script>`;
  const { code, out } = run(
    fixture(t, {
      // Counted twice, 0.7x the default would read 1.4x and fail.
      chunks: { [own]: kib(AUTHED_DEFAULT_KB * 0.7) },
      site: { '/zz-app': twice },
    }),
  );

  assert.equal(code, 0, out);
  assert.match(out, /ok .*\/\(app\)\/zz-app\/page/);
});

test('a <script noModule> is not counted — modern browsers never fetch it', (t) => {
  const polyfilled = page(...PUBLIC, 'app/(marketing)/zz-public/page-1.js');
  polyfilled.html += '<script src="/_next/static/chunks/polyfills-1.js" noModule=""></script>';
  const { code, out } = run(
    fixture(t, {
      chunks: { 'polyfills-1.js': kib(DEFAULT_KB + 5) },
      site: { '/zz-public': polyfilled },
    }),
  );

  assert.equal(code, 0, out);
});

test('a URL-encoded chunk path is counted, at its path on disk', (t) => {
  const { code, out } = run(
    fixture(t, {
      chunks: { 'app/(app)/@modal/x-1.js': kib(AUTHED_DEFAULT_KB + 5) },
      site: {
        '/zz-app': page(...APP, 'app/(app)/zz-app/page-1.js', 'app/(app)/%40modal/x-1.js'),
      },
    }),
  );

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(app\)\/zz-app\/page/);
});

test('a dynamic route is fetched at a path built from it, else at a placeholder', (t) => {
  const blog = 'app/(marketing)/zz-blog/[slug]/page-1.js';
  const thing = 'app/(app)/zz-things/[id]/page-1.js';
  const { code, out } = run(
    fixture(t, {
      pages: {
        '/(marketing)/zz-blog/[slug]/page': ['webpack-1.js', blog],
        '/(app)/zz-things/[id]/page': ['webpack-1.js', thing],
      },
      // A static page beside the dynamic one must not stand in for it.
      prerendered: {
        '/zz-blog/archive': { srcRoute: '/zz-blog/archive' },
        '/zz-blog/hello': { srcRoute: '/zz-blog/[slug]' },
      },
      site: {
        '/zz-blog/hello': page(...PUBLIC, 'app/(marketing)/zz-blog/%5Bslug%5D/page-1.js'),
        '/zz-things/budget-probe': page(...APP, 'app/(app)/zz-things/%5Bid%5D/page-1.js'),
      },
    }),
  );

  assert.equal(code, 0, out);
  assert.match(out, /ok .*\/\(marketing\)\/zz-blog\/\[slug\]\/page/);
  assert.match(out, /ok .*\/\(app\)\/zz-things\/\[id\]\/page/);
});

test('beta recovery is measured even when organic beta redirects', (t) => {
  const own = 'app/(marketing)/beta/page-1.js';
  const { code, out } = run(
    fixture(t, {
      pages: { '/(marketing)/beta/page': ['webpack-1.js', own] },
      site: {
        '/beta': { status: 307, location: '/how-it-works' },
        '/beta?reason=not_invited': page(...PUBLIC, own),
      },
    }),
  );
  assert.equal(code, 0, out);
  assert.match(out, /ok .*\/\(marketing\)\/beta\/page/);
});

test('a declared redirect is verified, not measured, and fails once it renders instead', (t) => {
  const demo = 'app/(marketing)/demo/page-1.js';
  const pages = { '/(marketing)/demo/page': ['webpack-1.js', demo] };
  const verified = run(
    fixture(t, { pages, site: { '/demo': { status: 308, location: '/inbox-simulator' } } }),
  );
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /1 declared redirect\(s\) verified/);

  const rendered = run(fixture(t, { pages, site: { '/demo': page(...PUBLIC, demo) } }));
  assert.equal(rendered.code, 1, rendered.out);
  assert.ok(rendered.out.includes('not a redirect to /inbox-simulator as declared'), rendered.out);
});

test('fails by name, and stops the server, when a route answers anything but 200', (t) => {
  const dir = fixture(t, { site: { '/zz-app': { status: 307, location: '/sign-in' } } });
  const { code, out } = run(dir);

  assert.equal(code, 1, out);
  assert.ok(out.includes('/(app)/zz-app/page (/zz-app): answered 307 → /sign-in, not 200'), out);
  assert.ok(stopped(dir), 'the server outlived the run');
});

test('fails by name when a route serves some other page, shared layout chunks and all', (t) => {
  // The public page names shared-1.js, which /(app)/layout also lists: a
  // check on layout chunks would take this sign-in-shaped page as /zz-app.
  const { code, out } = run(
    fixture(t, { site: { '/zz-app': page(...PUBLIC, 'app/(marketing)/zz-public/page-1.js') } }),
  );

  assert.equal(code, 1, out);
  assert.ok(
    out.includes('/(app)/zz-app/page (/zz-app): its HTML named none of the 1 chunk(s) of its own'),
    out,
  );
});

test('fails by name when the server serves pages with no chunks', (t) => {
  const empty = { status: 200, html: '<html><body></body></html>' };
  const { code, out } = run(fixture(t, { site: { '/zz-public': empty, '/zz-app': empty } }));

  assert.equal(code, 1, out);
  assert.ok(
    out.includes('/(marketing)/zz-public/page (/zz-public): its HTML named no JS chunks'),
    out,
  );
  assert.ok(out.includes('/(app)/zz-app/page (/zz-app): its HTML named no JS chunks'), out);
});

test('fails by name, and stops the server, when it never becomes ready', (t) => {
  const dir = fixture(t, { hang: true });
  const { code, out } = run(dir, { BUNDLE_BUDGET_READY_TIMEOUT_MS: '1500' });

  assert.equal(code, 1, out);
  assert.ok(out.includes('the server did not answer within 1.5s'), out);
  assert.ok(stopped(dir), 'the server outlived the run');
});

test('fails by name when the server cannot start at all', (t) => {
  const { code, out } = run(fixture(t), {
    BUNDLE_BUDGET_SERVER: join(tmpdir(), 'no-such-dir-bundle-budget', 'server.mjs'),
  });

  assert.equal(code, 1, out);
  assert.ok(out.includes('the server could not start'), out);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`stops the server when the run gets ${signal}`, async (t) => {
    const dir = fixture(t, { hang: true });
    const script = spawn(process.execPath, [SCRIPT], {
      env: envFor(dir, { BUNDLE_BUDGET_READY_TIMEOUT_MS: '30000' }),
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => script.once('exit', resolve));
    for (let i = 0; !serverPid(dir); i += 1) {
      assert.ok(i < 200, 'the stand-in server never started');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    script.kill(signal);

    assert.equal(await exited, 1);
    // The run exits right after its SIGKILL, so the server can sit unreaped
    // for a moment; a live one would never go.
    for (let i = 0; !stopped(dir) && i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(stopped(dir), `the server outlived a ${signal}`);
  });
}

test('chunk paths are read decoded, the way they sit on disk, without noModule', () => {
  const html =
    '<script src="/_next/static/chunks/app/blog/%5Bslug%5D/page-a.js"></script>' +
    '<script src="/_next/static/chunks/app/%40modal/x.js"></script>' +
    '<script src="/_next/static/chunks/polyfills-a.js" noModule=""></script>';

  assert.deepEqual(
    [...chunkRefs(html)],
    ['static/chunks/app/blog/[slug]/page-a.js', 'static/chunks/app/@modal/x.js'],
  );
});

test('the headroom floor is max(5%, 5 kB), rounded up to a whole kB', () => {
  assert.equal(budgetFor(50), 55, '5 kB wins below 100 kB');
  assert.equal(budgetFor(100), 105, 'they meet at 100 kB');
  assert.equal(budgetFor(150.7), 159, '5% wins above 100 kB: 150.7 + 7.535');
  assert.equal(budgetFor(270), 284, '/billing-sized: 270 + 13.5');
  assert.equal(budgetFor(140), 147, 'no floating-point overshoot past an exact whole kB');
  for (let tenths = 0; tenths <= 4000; tenths += 1) {
    const kb = tenths / 10;
    const floor = kb + Math.max(kb * 0.05, 5);
    const budget = budgetFor(kb);
    assert.ok(budget >= floor - 1e-9, `${kb} kB got ${budget}, below its ${floor} floor`);
    assert.ok(budget < floor + 1, `${kb} kB got ${budget}, more than 1 kB past its floor`);
  }
});

test('the committed table is exactly what --rebaseline generates from its own measurements', () => {
  const text = readFileSync(TABLE_PATH, 'utf8');
  const committed = JSON.parse(text);
  const entries = Object.entries(committed.routes);
  assert.ok(
    entries.some(([route]) => route.startsWith('/(marketing)/')),
    'no public routes',
  );
  assert.ok(
    entries.some(([route]) => route.startsWith('/(app)/')),
    'no authed routes',
  );
  for (const [route, { measuredKb, budgetKb }] of entries) {
    assert.equal(budgetKb, budgetFor(measuredKb), `${route} was edited off the headroom floor`);
  }
  const measured = Object.fromEntries(entries.map(([route, entry]) => [route, entry.measuredKb]));
  assert.equal(serializeTable(buildTable(measured)), text, 'hand-edited or not regenerated');
});

test('--rebaseline writes every route at its floor, byte-identically, and the check then holds it', (t) => {
  const own = 'app/(marketing)/zz-public/page-1.js';
  const dir = fixture(t);
  const first = run(dir, {}, ['--rebaseline']);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /rebaselined 2 route\(s\)/);
  const written = readFileSync(join(dir, 'table.json'), 'utf8');
  const table = JSON.parse(written);
  assert.deepEqual(Object.keys(table.routes), [
    '/(app)/zz-app/page',
    '/(marketing)/zz-public/page',
  ]);
  for (const { measuredKb, budgetKb } of Object.values(table.routes)) {
    assert.equal(budgetKb, budgetFor(measuredKb));
  }
  assert.deepEqual(Object.keys(table).sort(), ['$comment', 'routes']);

  assert.equal(run(dir, {}, ['--rebaseline']).code, 0);
  assert.equal(readFileSync(join(dir, 'table.json'), 'utf8'), written, 'not deterministic');

  const { measuredKb, budgetKb } = table.routes['/(marketing)/zz-public/page'];
  const spare = budgetKb - measuredKb;
  writeFileSync(join(dir, 'static/chunks', own), kib(1 + spare - 0.5));
  const within = run(dir);
  assert.equal(within.code, 0, within.out);

  writeFileSync(join(dir, 'static/chunks', own), kib(1 + spare + 0.5));
  const over = run(dir);
  assert.equal(over.code, 1, over.out);
  assert.match(over.out, /OVER .*\/\(marketing\)\/zz-public\/page/);
  assert.ok(over.out.includes('pnpm check:bundle --rebaseline'), over.out);
});

test('a listed route is held to its own cap', (t) => {
  const { code, out } = run(
    fixture(t, { routes: { '/(app)/zz-app/page': { measuredKb: 1, budgetKb: 2 } } }),
  );
  assert.equal(code, 1, out);
  assert.match(out, /OVER .* \/ +2 kB {2}\/\(app\)\/zz-app\/page/);
  assert.match(out, /ok .*\/\(marketing\)\/zz-public\/page/);
});

test('deleting a route from the table fails the run instead of loosening its cap', (t) => {
  const dir = fixture(t);
  assert.equal(run(dir, {}, ['--rebaseline']).code, 0);
  const file = join(dir, 'table.json');
  const table = JSON.parse(readFileSync(file, 'utf8'));
  delete table.routes['/(app)/zz-app/page'];
  writeFileSync(file, serializeTable(table));

  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /NONE .*\/\(app\)\/zz-app\/page {2}\(not in the table\)/);
  assert.match(out, /1 measured route\(s\) have no cap in the table:\n {2}\/\(app\)\/zz-app\/page/);
  assert.ok(out.includes('pnpm check:bundle --rebaseline'), out);
});

test('a route added since the last rebaseline fails until the table is rebaselined', (t) => {
  const added = 'app/(marketing)/zz-new/page-1.js';
  const dir = fixture(t, {
    pages: { '/(marketing)/zz-new/page': ['webpack-1.js', added] },
    site: { '/zz-new': page(...PUBLIC, added) },
    unlisted: ['/(marketing)/zz-new/page'],
  });
  const unbudgeted = run(dir);
  assert.equal(unbudgeted.code, 1, unbudgeted.out);
  assert.match(unbudgeted.out, /have no cap in the table:\n {2}\/\(marketing\)\/zz-new\/page/);
  assert.match(unbudgeted.out, /ok .*\/\(marketing\)\/zz-public\/page/);

  assert.equal(run(dir, {}, ['--rebaseline']).code, 0);
  const { routes } = JSON.parse(readFileSync(join(dir, 'table.json'), 'utf8'));
  const { measuredKb, budgetKb } = routes['/(marketing)/zz-new/page'];
  assert.equal(budgetKb, budgetFor(measuredKb));
  const rebased = run(dir);
  assert.equal(rebased.code, 0, rebased.out);
});

test('--rebaseline writes nothing when a route cannot be measured', (t) => {
  const dir = fixture(t, { site: { '/zz-app': { status: 307, location: '/sign-in' } } });
  const before = readFileSync(join(dir, 'table.json'), 'utf8');
  const { code, out } = run(dir, {}, ['--rebaseline']);
  assert.equal(code, 1, out);
  assert.equal(readFileSync(join(dir, 'table.json'), 'utf8'), before);
});

test('fails closed when the budget table is missing', (t) => {
  const dir = fixture(t);
  const { code, out } = run(dir, { BUNDLE_BUDGET_TABLE: join(dir, 'nope.json') });
  assert.equal(code, 1, out);
  assert.ok(out.includes('cannot read the budget table'), out);
});

test('an unknown flag fails instead of quietly running the check', () => {
  assert.throws(() => parseArgs(['--rebasline']), /unknown or incomplete argument --rebasline/);
  assert.throws(() => parseArgs(['--baseline']), /incomplete/);
  assert.deepEqual(parseArgs(['--', '--rebaseline']), {
    rebaseline: true,
    sizesOut: null,
    baseline: null,
  });
});

test('growth is compared in tenths: 2.0 kB is not a warning, 2.1 kB is', () => {
  const rows = [
    { route: '/a', kb: 152.04 },
    { route: '/b', kb: 152.14 },
    { route: '/new', kb: 300 },
  ];
  assert.equal(GROWTH_WARN_KB, 2);
  assert.deepEqual(growthOver(rows, { '/a': 150, '/b': 150 }), [
    { route: '/b', fromKb: 150, toKb: 152.1, grewTenths: 21 },
  ]);
});

/** Measures the fixture once and returns its sizes, as main's CI would upload them. */
function sizesOf(dir) {
  const file = join(dir, 'sizes.json');
  const { code, out } = run(dir, {}, ['--sizes-out', file]);
  assert.equal(code, 0, out);
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('a route that grew more than 2 kB vs main is warned about, without failing the run', (t) => {
  const dir = fixture(t);
  const sizes = sizesOf(dir);
  const app = sizes.routes['/(app)/zz-app/page'];
  const pub = sizes.routes['/(marketing)/zz-public/page'];
  const baseline = join(dir, 'main.json');
  writeFileSync(
    baseline,
    JSON.stringify({
      commit: 'abcdef1234',
      routes: {
        '/(app)/zz-app/page': Math.round((app - 2.5) * 10) / 10,
        '/(marketing)/zz-public/page': Math.round((pub - 2) * 10) / 10,
      },
    }),
  );
  const summary = join(dir, 'summary.md');
  const { code, out } = run(dir, { GITHUB_STEP_SUMMARY: summary }, ['--baseline', baseline]);

  assert.equal(code, 0, out);
  assert.match(
    out,
    /::warning title=Bundle growth::\/\(app\)\/zz-app\/page grew 2\.5 kB vs main @ abcdef1/,
  );
  assert.ok(!out.includes('zz-public/page grew'), 'exactly 2 kB must not warn');
  const report = readFileSync(summary, 'utf8');
  assert.match(report, /1 of 2 route\(s\) grew more than 2 kB vs main @ abcdef1/);
  assert.match(report, /\| `\/\(app\)\/zz-app\/page` \| .* \| \+2\.5 kB \|/);
});

test('the growth warning still reports when the run is over budget', (t) => {
  const own = 'app/(app)/zz-app/page-1.js';
  const dir = fixture(t);
  const baseline = join(dir, 'main.json');
  writeFileSync(baseline, JSON.stringify(sizesOf(dir)));
  writeFileSync(join(dir, 'static/chunks', own), kib(AUTHED_DEFAULT_KB + 5));
  const { code, out } = run(dir, {}, ['--baseline', baseline]);
  assert.equal(code, 1, out);
  assert.match(out, /::warning title=Bundle growth::\/\(app\)\/zz-app\/page grew/);
});

test('a baseline sharing no route with this build reads as "not compared"', (t) => {
  const dir = fixture(t);
  const baseline = join(dir, 'main.json');
  writeFileSync(
    baseline,
    JSON.stringify({ commit: 'abcdef1234', routes: { '/(app)/gone/page': 1 } }),
  );
  const summary = join(dir, 'summary.md');
  const { code, out } = run(dir, { GITHUB_STEP_SUMMARY: summary }, ['--baseline', baseline]);

  assert.equal(code, 0, out);
  assert.match(
    out,
    /::notice title=Bundle growth not compared::main @ abcdef1's measured sizes share no route/,
  );
  const report = readFileSync(summary, 'utf8');
  assert.match(report, /Not compared: .*share no route with this build/);
  assert.ok(!/No route grew/.test(report), report);
});

test('an unreadable main baseline reads as "not compared", never as "no growth"', (t) => {
  const dir = fixture(t);
  const summary = join(dir, 'summary.md');
  const { code, out } = run(dir, { GITHUB_STEP_SUMMARY: summary }, [
    '--baseline',
    join(dir, 'missing.json'),
  ]);

  assert.equal(code, 0, out);
  assert.match(out, /::notice title=Bundle growth not compared::.*ENOENT/);
  const report = readFileSync(summary, 'utf8');
  assert.match(report, /Not compared: main's measured sizes could not be read/);
  assert.ok(!/No route grew/.test(report), report);
});
