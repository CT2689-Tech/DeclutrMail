/**
 * Does this URL work as a sender avatar? Answers before you collect a hundred of them.
 *
 * Curating brand logos by hand is cheap to do and expensive to redo, and
 * the failure mode is silent: a URL that looks perfect in a browser can
 * be rejected by the pipeline for a reason the browser never shows you —
 * a press-kit wordmark is 6:1 and our tile is square, a favicon is
 * `.ico` and we never decode ICO, an SVG carries a script tag and the
 * safety gate drops it. This applies the SAME rules the resolver does,
 * against the real bytes, so a "PASS" here means the ingest will keep it.
 *
 *   pnpm check-logo <url> [<url> ...]
 *
 * Rules mirrored from `website-icon-resolver.ts`. If that file's limits
 * move, move them here in the same change — a checker that disagrees
 * with the thing it checks is worse than no checker.
 */

import sharp from 'sharp';

/** A 32px source stays crisp at the 24-40px sizes the avatar uses. */
const MIN_SOURCE_SIZE = 32;
/** The tile is square; anything longer than 2:1 either crops or shrinks to nothing. */
const MIN_ASPECT_RATIO = 1 / 2;
const MAX_ASPECT_RATIO = 2;
const SVG_MIME = 'image/svg+xml';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', SVG_MIME]);
/** Same ceiling as the resolver: a decompression bomb is not artwork. */
const MAX_SOURCE_PIXELS = 16 * 1024 * 1024;

type Verdict = { ok: true; detail: string } | { ok: false; reason: string; hint?: string };

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
    const text = body.toString('utf8');
    // Cheap stand-in for the BIMI Tiny PS gate the worker applies. It is
    // deliberately stricter to flag rather than to bless: better a false
    // warning here than a surprise rejection during ingest.
    const unsafe = /<script|xlink:href\s*=\s*["']https?:|<image[^>]+href\s*=\s*["']https?:/i.test(
      text,
    );
    if (unsafe) {
      return {
        ok: false,
        reason: 'SVG references scripts or remote assets',
        hint: 'the safety gate drops these — prefer a PNG of the same mark',
      };
    }
    return { ok: true, detail: `SVG, ${(body.byteLength / 1024).toFixed(1)}kB` };
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(body, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
  } catch (err) {
    return { ok: false, reason: `not decodable: ${err instanceof Error ? err.message : err}` };
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < MIN_SOURCE_SIZE || height < MIN_SOURCE_SIZE) {
    return { ok: false, reason: `${width}x${height} — smaller than ${MIN_SOURCE_SIZE}px` };
  }
  const ratio = width / height;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
    return {
      ok: false,
      reason: `${width}x${height} is ${ratio.toFixed(1)}:1 — outside 1:2 to 2:1`,
      hint: 'this is a wordmark; look for the square app-icon or glyph version',
    };
  }
  return { ok: true, detail: `${width}x${height}, ${ratio.toFixed(2)}:1, ${mime}` };
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
