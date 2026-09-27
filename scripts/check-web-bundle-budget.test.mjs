import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AUTHED_DEFAULT_KB, DEFAULT_KB, chunkRefs } from './check-web-bundle-budget.mjs';

const SCRIPT = fileURLToPath(new URL('./check-web-bundle-budget.mjs', import.meta.url));

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

// One route per group, unknown to the override table, so each is held to
// its group default. Both layouts list `shared-1.js`, the way the real
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
function fixture(t, { pages = {}, chunks = {}, site = {}, prerendered = {}, hang = false } = {}) {
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
  return dir;
}

const envFor = (dir, env = {}) => ({
  PATH: process.env.PATH,
  BUNDLE_BUDGET_NEXT_DIR: dir,
  BUNDLE_BUDGET_SERVER: join(dir, 'server.mjs'),
  ...env,
});

function run(dir, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT], {
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
