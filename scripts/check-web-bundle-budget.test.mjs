import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// its group default.
const PAGES = {
  '/layout': ['root.js'],
  '/(marketing)/layout': ['site.js'],
  '/(marketing)/zz-public/page': ['public-page.js'],
  '/(app)/layout': ['chrome.js'],
  '/(app)/zz-app/page': ['app-page.js'],
};
const CHUNKS = {
  'root.js': kib(1),
  'site.js': kib(1),
  'public-page.js': kib(1),
  'chrome.js': kib(1),
  'app-page.js': kib(1),
};
const SITE = {
  '/zz-public': page('root.js', 'site.js', 'public-page.js'),
  '/zz-app': page('root.js', 'chrome.js', 'app-page.js'),
};

/** A fixture build plus the site its stand-in server answers with. */
function fixture(t, { pages = {}, chunks = {}, site = {}, prerendered = [], hang = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'static/chunks'), { recursive: true });
  for (const [name, bytes] of Object.entries({ ...CHUNKS, ...chunks })) {
    writeFileSync(join(dir, 'static/chunks', name), bytes);
  }
  const listed = Object.entries({ ...PAGES, ...pages })
    .filter(([, names]) => names !== null)
    .map(([key, names]) => [key, names.map((n) => `static/chunks/${n}`)]);
  writeFileSync(
    join(dir, 'app-build-manifest.json'),
    JSON.stringify({ pages: Object.fromEntries(listed) }),
  );
  writeFileSync(
    join(dir, 'prerender-manifest.json'),
    JSON.stringify({ routes: Object.fromEntries(prerendered.map((url) => [url, {}])) }),
  );
  writeFileSync(join(dir, 'site.json'), JSON.stringify({ hang, pages: { ...SITE, ...site } }));
  writeFileSync(join(dir, 'server.mjs'), SERVER);
  return dir;
}

function run(dir, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: {
      PATH: process.env.PATH,
      BUNDLE_BUDGET_NEXT_DIR: dir,
      BUNDLE_BUDGET_SERVER: join(dir, 'server.mjs'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

/** True once the stand-in server's process no longer exists. */
function stopped(dir) {
  const pid = Number(readFileSync(join(dir, 'server.pid'), 'utf8'));
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

test('a heavy app layout fails every route under it — the page alone would pass', (t) => {
  const dir = fixture(t, { chunks: { 'chrome.js': kib(AUTHED_DEFAULT_KB + 5) } });
  const { code, out } = run(dir);

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(app\)\/zz-app\/page/);
  assert.ok(stopped(dir), 'the server outlived the run');
});

test('a public route is held to its layouts too', (t) => {
  const { code, out } = run(fixture(t, { chunks: { 'site.js': kib(DEFAULT_KB + 5) } }));

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(marketing\)\/zz-public\/page/);
});

test('a chunk filed under another route counts when the HTML loads it', (t) => {
  const { code, out } = run(
    fixture(t, {
      pages: { '/(marketing)/zz-home/page': ['home-entry.js'] },
      chunks: { 'home-entry.js': kib(DEFAULT_KB + 5) },
      site: {
        '/zz-home': page('root.js', 'site.js', 'home-entry.js'),
        '/zz-public': page('root.js', 'site.js', 'public-page.js', 'home-entry.js'),
      },
    }),
  );

  assert.equal(code, 1, out);
  assert.match(out, /OVER .*\/\(marketing\)\/zz-public\/page/);
});

test('a chunk named by a script tag and a client reference counts once', (t) => {
  const twice = page('root.js', 'chrome.js', 'shared.js');
  twice.html +=
    '<script>self.__next_f.push([1,"5:I[1,[\\"1\\",\\"static/chunks/shared.js\\"]]"])</script>';
  const { code, out } = run(
    fixture(t, {
      // Counted twice, 0.7x the default would read 1.4x and fail.
      chunks: { 'shared.js': kib(AUTHED_DEFAULT_KB * 0.7) },
      site: { '/zz-app': twice },
    }),
  );

  assert.equal(code, 0, out);
  assert.match(out, /ok .*\/\(app\)\/zz-app\/page/);
});

test('a <script noModule> is not counted — modern browsers never fetch it', (t) => {
  const polyfilled = page('root.js', 'site.js', 'public-page.js');
  polyfilled.html += '<script src="/_next/static/chunks/polyfills.js" noModule=""></script>';
  const { code, out } = run(
    fixture(t, {
      chunks: { 'polyfills.js': kib(DEFAULT_KB + 5) },
      site: { '/zz-public': polyfilled },
    }),
  );

  assert.equal(code, 0, out);
});

test('a dynamic route is fetched at a prerendered path, else at a placeholder', (t) => {
  const { code, out } = run(
    fixture(t, {
      pages: {
        '/(marketing)/zz-blog/[slug]/page': ['blog.js'],
        '/(app)/zz-things/[id]/page': ['thing.js'],
      },
      chunks: { 'blog.js': kib(1), 'thing.js': kib(1) },
      prerendered: ['/zz-blog/hello'],
      site: {
        '/zz-blog/hello': page('root.js', 'site.js', 'blog.js'),
        '/zz-things/budget-probe': page('root.js', 'chrome.js', 'thing.js'),
      },
    }),
  );

  assert.equal(code, 0, out);
  assert.match(out, /ok .*\/\(marketing\)\/zz-blog\/\[slug\]\/page/);
});

test('a declared redirect is verified, not measured, and fails once it renders instead', (t) => {
  const redirect = { '/(marketing)/demo/page': ['demo.js'] };
  const verified = run(
    fixture(t, {
      pages: redirect,
      chunks: { 'demo.js': kib(1) },
      site: { '/demo': { status: 308, location: '/inbox-simulator' } },
    }),
  );
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /1 declared redirect\(s\) verified/);

  const rendered = run(
    fixture(t, {
      pages: redirect,
      chunks: { 'demo.js': kib(1) },
      site: { '/demo': page('root.js', 'site.js', 'demo.js') },
    }),
  );
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

test('fails by name when a route renders outside its own layout', (t) => {
  // The shape of a sign-in page rendered in place: the marketing chrome.
  const { code, out } = run(
    fixture(t, { site: { '/zz-app': page('root.js', 'site.js', 'public-page.js') } }),
  );

  assert.equal(code, 1, out);
  assert.ok(
    out.includes("/(app)/zz-app/page (/zz-app): its HTML named none of /(app)/layout's"),
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

for (const missing of ['/layout', '/(app)/layout', '/(marketing)/layout']) {
  test(`fails by name when ${missing} is missing from the manifest`, (t) => {
    const { code, out } = run(fixture(t, { pages: { [missing]: null } }));

    assert.equal(code, 1, out);
    assert.ok(out.includes(`no ${missing} in the manifest`), out);
  });
}

test('chunk paths are read decoded, the way they sit on disk', () => {
  const html = '<script src="/_next/static/chunks/app/blog/%5Bslug%5D/page-a.js"></script>';

  assert.deepEqual([...chunkRefs(html)], ['static/chunks/app/blog/[slug]/page-a.js']);
});
