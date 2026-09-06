/* global document */
/** Crawl the entire local production sitemap, then reconcile links and SEO metadata.
 * Run from the repo root: SMOKE_WEB_URL=http://127.0.0.1:3117 node docs/eval/public-site-audit.cjs
 * Read-only; never follows OAuth or external links.
 */
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const { chromium } = createRequire(process.cwd() + '/packages/e2e/package.json')(
  '@playwright/test',
);
const base = process.env.SMOKE_WEB_URL || 'http://127.0.0.1:3117';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Local audit only');
(async () => {
  const sitemap = await fetch(base + '/sitemap.xml');
  if (!sitemap.ok) throw new Error('Sitemap unavailable');
  const urls = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1]));
  if (!urls.length) throw new Error('Empty sitemap');
  const browser = await chromium.launch();
  const rows = [],
    failures = [];
  try {
    const page = await browser.newPage();
    for (const url of urls) {
      const response = await page.goto(base + url.pathname, { waitUntil: 'domcontentloaded' });
      const row = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content,
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        robots: document.querySelector('meta[name="robots"]')?.content || '',
        headings: [...document.querySelectorAll('h1')].map((h) => h.textContent),
        image: document.querySelector('meta[property="og:image"]')?.content,
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
        schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
          try {
            return JSON.parse(s.textContent);
          } catch {
            return 'INVALID';
          }
        }),
      }));
      row.path = url.pathname;
      if (
        response.status() !== 200 ||
        !row.title ||
        !row.description ||
        !row.image ||
        row.headings.length !== 1 ||
        /noindex/i.test(row.robots) ||
        row.schemas.includes('INVALID')
      )
        failures.push(`${url.pathname}: status, metadata, heading, or schema`);
      if (row.canonical?.replace(/\/$/, '') !== url.href.replace(/\/$/, ''))
        failures.push(`${url.pathname}: canonical does not match sitemap`);
      // Social crawlers need metadata in HTML, without executing JavaScript.
      const raw = await page.request.get(base + url.pathname, {
        headers: { 'User-Agent': 'Twitterbot/1.0' },
      });
      const head = (await raw.text()).split('</head>')[0];
      if (
        !/<title>/.test(head) ||
        !/property="og:image"/.test(head) ||
        !/rel="canonical"/.test(head)
      )
        failures.push(`${url.pathname}: crawler head metadata missing`);
      rows.push(row);
    }
    const indexed = new Map(rows.map((r) => [r.path, r]));
    const additional = new Set(),
      images = new Set();
    for (const row of rows) {
      images.add(row.image);
      for (const link of row.links) {
        const url = new URL(link, row.canonical);
        if (url.origin !== new URL(row.canonical).origin) continue;
        const target = indexed.get(url.pathname);
        if (target && url.hash && !target.ids.includes(decodeURIComponent(url.hash.slice(1))))
          failures.push(`${row.path}: broken anchor ${link}`);
        else if (!target && !url.pathname.startsWith('/api/')) additional.add(url.pathname);
      }
    }
    for (const path of additional) {
      if (!(await page.request.get(base + path)).ok()) failures.push(`Broken destination: ${path}`);
    }
    for (const image of images) {
      const url = new URL(image);
      const response = await page.request.get(base + url.pathname + url.search);
      if (!response.ok() || !response.headers()['content-type']?.startsWith('image/'))
        failures.push(`Broken share image: ${url.pathname}`);
    }
    for (const key of ['title', 'description', 'canonical']) {
      if (new Set(rows.map((r) => r[key])).size !== rows.length) failures.push(`Duplicate ${key}`);
    }
    writeFileSync(
      '/tmp/declutr-public-site-audit.json',
      JSON.stringify({ rows, failures }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          pages: rows.length,
          additionalDestinations: additional.size,
          shareImages: images.size,
          failures,
        },
        null,
        2,
      ),
    );
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
