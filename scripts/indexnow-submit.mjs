#!/usr/bin/env node
/**
 * indexnow-submit.mjs
 *
 * Submits every URL in the production sitemap to IndexNow
 * (https://www.indexnow.org/documentation), which shares it with Bing,
 * Yandex and the other participating engines. Run by
 * .github/workflows/indexnow-submit.yml after a production web deploy.
 *
 * Zero npm dependencies — plain Node >= 22 (global fetch).
 *
 * Fails closed, exit 1, naming the cause, when:
 *   - the sitemap is unreachable, redirected or not 2xx
 *   - the sitemap yields zero URLs, or is a sitemap index
 *   - any sitemap URL is on a host other than the canonical one
 *   - the key file is not live at the canonical origin with the key as its
 *     body (IndexNow would answer 403)
 *   - IndexNow answers anything but 2xx
 *
 * Usage:
 *   node scripts/indexnow-submit.mjs              submit
 *   node scripts/indexnow-submit.mjs --dry-run    print the batches, no POST
 *   node scripts/indexnow-submit.mjs --dry-run --fetch-from http://localhost:3000
 *       read the sitemap and key file from another origin (dry run only —
 *       a real submission always verifies the canonical origin)
 */
import { pathToFileURL } from 'node:url';

/**
 * The IndexNow key. Public by design: it proves site ownership only because
 * the same value is served at `${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`
 * (apps/web/public/<key>.txt — indexnow-submit.test.mjs pins the pair).
 */
export const INDEXNOW_KEY = '447c04bdb0c44ab5fe5973a09ba63d95';
export const SITE_ORIGIN = 'https://declutrmail.com';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** IndexNow's documented per-request ceiling. */
export const MAX_URLS_PER_REQUEST = 10_000;

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/**
 * The `<loc>` URLs of a `<urlset>` sitemap, de-duplicated, in order.
 * Throws when there are none or when any is off `origin`.
 */
export function parseSitemapUrls(xml, origin = SITE_ORIGIN) {
  if (/<sitemapindex[\s>]/.test(xml))
    throw new Error('sitemap is a sitemap index; this script reads a single <urlset>');
  const urls = [
    ...new Set(
      [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((match) =>
        match[1].replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]),
      ),
    ),
  ];
  if (urls.length === 0) throw new Error('sitemap yielded zero URLs');
  const foreign = urls.filter((url) => !URL.canParse(url) || new URL(url).origin !== origin);
  if (foreign.length > 0)
    throw new Error(
      `sitemap has ${foreign.length} URL(s) outside ${origin}: ${foreign.slice(0, 5).join(', ')}`,
    );
  return urls;
}

/** One IndexNow JSON body per batch of at most `batchSize` URLs. */
export function buildPayloads(
  urls,
  { key = INDEXNOW_KEY, origin = SITE_ORIGIN, batchSize = MAX_URLS_PER_REQUEST } = {},
) {
  const payloads = [];
  for (let start = 0; start < urls.length; start += batchSize) {
    payloads.push({
      host: new URL(origin).host,
      key,
      keyLocation: `${origin}/${key}.txt`,
      urlList: urls.slice(start, start + batchSize),
    });
  }
  return payloads;
}

/** A served key file is valid only when its body is exactly the key. */
export function assertKeyFileBody(body, key = INDEXNOW_KEY) {
  if (body.trim() !== key) throw new Error('key file body does not equal the IndexNow key');
}

async function fetchText(url, fetchImpl) {
  let response;
  try {
    // A redirect is a failure: IndexNow reads the key file at keyLocation
    // itself, and a sitemap served from elsewhere is not the canonical one.
    response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`${url} unreachable: ${error.cause?.message ?? error.message}`, {
      cause: error,
    });
  }
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.text();
}

export async function run({ dryRun = false, fetchFrom = SITE_ORIGIN, fetchImpl = fetch } = {}) {
  if (!dryRun && fetchFrom !== SITE_ORIGIN)
    throw new Error('--fetch-from is only allowed with --dry-run');

  const urls = parseSitemapUrls(await fetchText(`${fetchFrom}/sitemap.xml`, fetchImpl));
  assertKeyFileBody(await fetchText(`${fetchFrom}/${INDEXNOW_KEY}.txt`, fetchImpl));
  const payloads = buildPayloads(urls);
  console.log(
    `sitemap: ${urls.length} URL(s) from ${fetchFrom}; key file live; ${payloads.length} batch(es)`,
  );

  for (const [index, payload] of payloads.entries()) {
    const label = `batch ${index + 1}/${payloads.length} (${payload.urlList.length} URLs)`;
    if (dryRun) {
      console.log(`DRY RUN — would POST ${label} to ${INDEXNOW_ENDPOINT}:`);
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }
    let response;
    try {
      response = await fetchImpl(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(
        `IndexNow unreachable on ${label}: ${error.cause?.message ?? error.message}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`IndexNow answered HTTP ${response.status} on ${label}: ${detail}`);
    }
    console.log(`IndexNow answered HTTP ${response.status} for ${label}`);
  }
  return { urls, payloads };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const fetchFromAt = args.indexOf('--fetch-from');
  try {
    const unknown = args.filter(
      (arg, index) =>
        arg !== '--dry-run' &&
        arg !== '--fetch-from' &&
        !(fetchFromAt !== -1 && index === fetchFromAt + 1),
    );
    if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')}`);
    if (fetchFromAt !== -1 && !URL.canParse(args[fetchFromAt + 1] ?? ''))
      throw new Error('--fetch-from needs an origin, e.g. http://localhost:3000');
    await run({
      dryRun: args.includes('--dry-run'),
      fetchFrom: fetchFromAt === -1 ? SITE_ORIGIN : new URL(args[fetchFromAt + 1]).origin,
    });
  } catch (error) {
    console.error(`indexnow-submit FAILED: ${error.message}`);
    process.exit(1);
  }
}
