#!/usr/bin/env node
/**
 * Picks the URL one `lighthouse` matrix leg scores (ci.yml), from
 * apps/web/lighthouserc.cjs — the one list the gate is defined by.
 *
 * Fails closed when the matrix and the config disagree. A config URL with
 * no leg would never be scored, and a URL that matches no `assertMatrix`
 * pattern, or only blocks with no assertions, would be scored and asserted
 * against nothing: LHCI passes that run without a word. Every URL must
 * also keep D160's performance floor as an error.
 *
 * Usage: PAGE=<1-based leg> PAGES=<legs> node scripts/select-lighthouse-url.mjs
 * Prints `url=<url>` for $GITHUB_OUTPUT.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function selectLighthouseUrl(config, page, pages) {
  const urls = config?.ci?.collect?.url;
  const matrix = config?.ci?.assert?.assertMatrix;
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('lighthouserc.cjs lists no ci.collect.url entries');
  }
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error('lighthouserc.cjs has no ci.assert.assertMatrix');
  }
  if (pages !== urls.length) {
    throw new Error(
      `lighthouserc.cjs lists ${urls.length} URL(s) but the lighthouse matrix has ${pages} leg(s); ` +
        `set \`page:\` in ci.yml to 1..${urls.length}`,
    );
  }
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    throw new Error(`leg ${page} is outside 1..${pages}`);
  }
  for (const url of urls) {
    const blocks = matrix.filter(({ matchingUrlPattern }) =>
      new RegExp(matchingUrlPattern).test(url),
    );
    if (blocks.length === 0) {
      throw new Error(`${url} matches no assertMatrix pattern, so nothing would be asserted`);
    }
    const asserted = blocks.filter(
      ({ assertions }) =>
        assertions && typeof assertions === 'object' && Object.keys(assertions).length > 0,
    );
    if (asserted.length === 0) {
      throw new Error(`${url} matches only empty assertion blocks, so nothing would be asserted`);
    }
    const performance = asserted
      .map(({ assertions }) => assertions[PERFORMANCE])
      .filter((value) => value !== undefined);
    if (performance.length === 0 || !performance.every(holdsD160)) {
      throw new Error(
        `${url} must assert ${PERFORMANCE} as ['error', { minScore: >= ${D160_MIN_SCORE} }] (D160) ` +
          'in every block that sets it, and at least one block must',
      );
    }
  }
  return urls[page - 1];
}

const PERFORMANCE = 'categories:performance';
const D160_MIN_SCORE = 0.9;

function holdsD160(value) {
  return (
    Array.isArray(value) &&
    value[0] === 'error' &&
    typeof value[1]?.minScore === 'number' &&
    value[1].minScore >= D160_MIN_SCORE
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = createRequire(import.meta.url)('../apps/web/lighthouserc.cjs');
  try {
    const url = selectLighthouseUrl(config, Number(process.env.PAGE), Number(process.env.PAGES));
    console.log(`url=${url}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
