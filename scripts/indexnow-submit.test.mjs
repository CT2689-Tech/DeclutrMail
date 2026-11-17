import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertKeyFileBody,
  buildPayloads,
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  parseSitemapUrls,
  run,
  SITE_ORIGIN,
} from './indexnow-submit.mjs';

const PUBLIC_DIR = fileURLToPath(new URL('../apps/web/public/', import.meta.url));
const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;
const KEY_URL = `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`;

const sitemap = (...locs) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs
    .map((loc) => `<url>\n<loc>${loc}</loc>\n<lastmod>2026-11-01</lastmod>\n</url>`)
    .join('\n')}\n</urlset>\n`;

/** A fetch stand-in serving `routes[url]`; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const route = routes[url];
    if (route === undefined) throw new TypeError('fetch failed');
    const { status = 200, body = '' } = typeof route === 'string' ? { body: route } : route;
    return new Response(status >= 300 && status < 400 ? null : body, { status });
  };
  return { impl, calls };
}

const liveSite = (overrides = {}) => ({
  [SITEMAP_URL]: sitemap(`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/pricing`),
  [KEY_URL]: INDEXNOW_KEY,
  [INDEXNOW_ENDPOINT]: { status: 200 },
  ...overrides,
});

const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test('the key is 32 hex characters and the public key file is named and filled with it', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
  const keyFiles = readdirSync(PUBLIC_DIR).filter((name) => /^[a-f0-9]{32}\.txt$/.test(name));
  assert.deepEqual(keyFiles, [`${INDEXNOW_KEY}.txt`]);
  assert.equal(readFileSync(`${PUBLIC_DIR}${INDEXNOW_KEY}.txt`, 'utf8'), INDEXNOW_KEY);
});

test('parseSitemapUrls returns each loc once, in order, with XML entities decoded', () => {
  const xml = sitemap(
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/vs/a?x=1&amp;y=2`,
    `${SITE_ORIGIN}/pricing`,
    `${SITE_ORIGIN}/`,
  );
  assert.deepEqual(parseSitemapUrls(xml), [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/vs/a?x=1&y=2`,
    `${SITE_ORIGIN}/pricing`,
  ]);
});

test('starved: a sitemap with no URLs throws instead of submitting nothing', () => {
  assert.throws(() => parseSitemapUrls(sitemap()), /zero URLs/);
  assert.throws(() => parseSitemapUrls(''), /zero URLs/);
  assert.throws(() => parseSitemapUrls('<html><body>Not found</body></html>'), /zero URLs/);
});

test('a URL on any other host throws and names it', () => {
  for (const foreign of [
    'https://www.declutrmail.com/pricing',
    'https://app.declutrmail.com/home',
    'http://declutrmail.com/pricing',
    'http://localhost:3000/pricing',
    'https://declutrmail.com.evil.example/pricing',
    '/pricing',
  ]) {
    assert.throws(
      () => parseSitemapUrls(sitemap(`${SITE_ORIGIN}/`, foreign)),
      (error) =>
        error.message.includes('outside https://declutrmail.com') &&
        error.message.includes(foreign),
      foreign,
    );
  }
});

test('a sitemap index is refused rather than submitted as page URLs', () => {
  const index = `<sitemapindex><sitemap><loc>${SITE_ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`;
  assert.throws(() => parseSitemapUrls(index), /sitemap index/);
});

test('buildPayloads carries host, key and keyLocation and splits at the batch size', () => {
  const urls = Array.from({ length: 5 }, (_, i) => `${SITE_ORIGIN}/p${i}`);
  const payloads = buildPayloads(urls, { batchSize: 2 });
  assert.deepEqual(
    payloads.map((payload) => payload.urlList.length),
    [2, 2, 1],
  );
  assert.deepEqual(
    payloads.flatMap((payload) => payload.urlList),
    urls,
  );
  for (const payload of payloads) {
    assert.equal(payload.host, 'declutrmail.com');
    assert.equal(payload.key, INDEXNOW_KEY);
    assert.equal(payload.keyLocation, KEY_URL);
  }
});

test('buildPayloads defaults to one request per 10,000 URLs', () => {
  const urls = Array.from({ length: 10_001 }, (_, i) => `${SITE_ORIGIN}/p${i}`);
  assert.deepEqual(
    buildPayloads(urls).map((payload) => payload.urlList.length),
    [10_000, 1],
  );
});

test('assertKeyFileBody accepts the key (trailing newline allowed) and nothing else', () => {
  assertKeyFileBody(INDEXNOW_KEY);
  assertKeyFileBody(`${INDEXNOW_KEY}\n`);
  assert.throws(() => assertKeyFileBody(''), /key file body/);
  assert.throws(() => assertKeyFileBody('<!doctype html><title>404</title>'), /key file body/);
});

test('run POSTs the sitemap URLs to IndexNow after confirming the key file', async () => {
  const { impl, calls } = fakeFetch(liveSite());
  await quiet(() => run({ fetchImpl: impl }));
  assert.deepEqual(
    calls.map((call) => call.url),
    [SITEMAP_URL, KEY_URL, INDEXNOW_ENDPOINT],
  );
  const post = calls[2].init;
  assert.equal(post.method, 'POST');
  assert.deepEqual(JSON.parse(post.body), {
    host: 'declutrmail.com',
    key: INDEXNOW_KEY,
    keyLocation: KEY_URL,
    urlList: [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/pricing`],
  });
});

test('--dry-run never contacts IndexNow', async () => {
  const { impl, calls } = fakeFetch(liveSite());
  await quiet(() => run({ dryRun: true, fetchImpl: impl }));
  assert.ok(!calls.some((call) => call.url === INDEXNOW_ENDPOINT));
});

const failures = [
  ['the sitemap is unreachable', { [SITEMAP_URL]: undefined }, /sitemap\.xml unreachable/],
  ['the sitemap is a 500', { [SITEMAP_URL]: { status: 500 } }, /sitemap\.xml answered HTTP 500/],
  ['the sitemap redirects', { [SITEMAP_URL]: { status: 308 } }, /sitemap\.xml answered HTTP 308/],
  ['the sitemap is empty', { [SITEMAP_URL]: sitemap() }, /zero URLs/],
  [
    'the sitemap holds another host',
    { [SITEMAP_URL]: sitemap('https://www.declutrmail.com/pricing') },
    /outside https:\/\/declutrmail\.com/,
  ],
  ['the key file is missing', { [KEY_URL]: { status: 404 } }, /\.txt answered HTTP 404/],
  ['the key file holds something else', { [KEY_URL]: 'not-the-key' }, /key file body/],
];
for (const [name, overrides, expected] of failures) {
  test(`run rejects before any POST when ${name}`, async () => {
    const { impl, calls } = fakeFetch(liveSite(overrides));
    await assert.rejects(
      quiet(() => run({ fetchImpl: impl })),
      expected,
    );
    assert.ok(!calls.some((call) => call.url === INDEXNOW_ENDPOINT));
  });
}

test('run rejects when IndexNow answers non-2xx or is unreachable', async () => {
  for (const status of [400, 403, 422, 429]) {
    const { impl } = fakeFetch(liveSite({ [INDEXNOW_ENDPOINT]: { status, body: 'nope' } }));
    await assert.rejects(
      quiet(() => run({ fetchImpl: impl })),
      new RegExp(`IndexNow answered HTTP ${status}`),
    );
  }
  const { impl } = fakeFetch(liveSite({ [INDEXNOW_ENDPOINT]: undefined }));
  await assert.rejects(
    quiet(() => run({ fetchImpl: impl })),
    /IndexNow unreachable/,
  );
});

test('a real submission cannot read the sitemap or key file from another origin', async () => {
  const { impl, calls } = fakeFetch(liveSite());
  await assert.rejects(
    run({ fetchFrom: 'http://localhost:3000', fetchImpl: impl }),
    /only allowed with --dry-run/,
  );
  assert.equal(calls.length, 0);
});
