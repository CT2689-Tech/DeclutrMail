/**
 * Does this URL work as a sender avatar? Answers before you collect a hundred of them.
 *
 * Curating brand logos by hand is cheap to do and expensive to redo, and
 * the failure mode is silent: a URL that looks perfect in a browser can
 * be rejected by the pipeline for a reason the browser never shows you —
 * a press-kit wordmark is 6:1 and our tile is square, a favicon is
 * `.ico` and we never decode ICO, an SVG carries a script tag and the
 * safety gate drops it.
 *
 *   pnpm check-logo <url> [<url> ...]
 *
 * IT CALLS THE REAL GATES, IT DOES NOT REIMPLEMENT THEM. The first cut
 * of this script copied the resolver's limits as local constants and
 * argued that was fine because importing "pulls the whole chain in for
 * four numbers". It was not fine: the copy skipped
 * `normalizeSquareIcon` for SVG, so a wide SVG wordmark scored PASS
 * here and was rejected by the pipeline — the exact mistake the script
 * exists to prevent, shipped inside the script itself. A checker is
 * only worth running if a PASS is a promise, and the only way to
 * promise is to run the same code:
 *
 *   - `validateBimiSvg`     — the SVG safety gate (BIMI Tiny PS rules)
 *   - `normalizeSquareIcon` — size, aspect, decode and re-encode; the
 *                             single acceptance gate every tier passes
 *                             artwork through, SVG included
 */

import { normalizeSquareIcon, validateBimiSvg } from '@declutrmail/workers';
import sharp from 'sharp';

/**
 * Mirrors the resolver's accepted set. This one IS a local copy, and
 * deliberately: it exists only to turn "unsupported type" into a useful
 * sentence before the real gates run. Getting it wrong costs a worse
 * error message, never a wrong verdict — every PASS still has to clear
 * `normalizeSquareIcon` below.
 */
const SVG_MIME = 'image/svg+xml';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', SVG_MIME]);

type Verdict = { ok: true; detail: string } | { ok: false; reason: string; hint?: string };

/** Best-effort shape, for the message only — never for the verdict. */
async function describe(body: Buffer): Promise<string> {
  try {
    const meta = await sharp(body).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) return '';
    return `${width}x${height}, ${(width / height).toFixed(2)}:1`;
  } catch {
    return '';
  }
}

async function check(url: string): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    return { ok: false, reason: `could not fetch: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `HTTP ${res.status}`,
      hint:
        res.status === 403 || res.status === 429
          ? 'the host blocks automated fetches — find the same logo on a CDN or press host'
          : undefined,
    };
  }

  const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!IMAGE_MIMES.has(mime)) {
    return {
      ok: false,
      reason: `unsupported type "${mime || 'unknown'}"`,
      hint:
        mime === 'text/html'
          ? 'this is a page, not an image — open the logo itself and copy THAT address'
          : mime.includes('icon')
            ? 'ICO is never decoded; use the PNG or SVG version'
            : 'needs PNG, JPEG, WebP or SVG',
    };
  }

  const body = Buffer.from(await res.arrayBuffer());

  if (mime === SVG_MIME) {
    const validation = validateBimiSvg(body);
    if (!validation.ok) {
      return {
        ok: false,
        reason: `SVG failed the safety gate: ${validation.reason}`,
        hint: 'prefer a PNG of the same mark',
      };
    }
  }

  // The verdict. Same call the worker makes, so a PASS here is the
  // pipeline's own answer rather than an imitation of it.
  const normalized = await normalizeSquareIcon(body);
  const shape = await describe(body);
  if (!normalized) {
    return {
      ok: false,
      reason: `failed the quality gate${shape ? ` (${shape})` : ''}`,
      hint: 'must be at least 32px and between 1:2 and 2:1 — a wordmark is too wide, look for the square glyph',
    };
  }

  return {
    ok: true,
    detail: `${shape ? `${shape}, ` : ''}${mime} → ${(normalized.byteLength / 1024).toFixed(1)}kB avatar`,
  };
}

// Wrapped rather than top-level await: this file is transpiled to CJS.
async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('usage: pnpm check-logo <url> [<url> ...]');
    process.exit(2);
  }

  let failed = 0;
  for (const url of urls) {
    const verdict = await check(url);
    if (verdict.ok) {
      console.log(`PASS  ${url}\n        ${verdict.detail}`);
    } else {
      failed += 1;
      console.log(
        `FAIL  ${url}\n        ${verdict.reason}${verdict.hint ? `\n        → ${verdict.hint}` : ''}`,
      );
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

void main();
