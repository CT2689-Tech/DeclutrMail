import { isIP } from 'node:net';

import sharp from 'sharp';

import {
  FETCH_BIMI_HTTP_PORT,
  validateBimiSvg,
  type BimiHttpPort,
  type BimiHttpResponse,
} from './bimi-resolver.js';
import {
  classifyAddress,
  describeNetworkError,
  DNS_RESOLVE_HOST,
  isTransientDnsError,
  isTransientHttpStatus,
  type ResolveHost,
} from './ssrf-guard.js';
import { TransientError } from './worker-errors.js';

export type WebsiteIconHttpPort = BimiHttpPort;

export type WebsiteIconResolution =
  { status: 'ok'; image: Buffer; mime: 'image/png' } | { status: 'none'; reason: string };

export interface WebsiteIconDeps {
  resolveHost?: ResolveHost;
  http?: WebsiteIconHttpPort;
}

// Modern brand homepages frequently inline framework state and exceed
// 512 KiB before the closing head tag (Amex, Netflix, Uber, Airbnb in
// the live coverage sample). Four concurrent workers cap this at 8 MiB.
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 64 * 1024;
const IMAGE_MAX_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const WEBSITE_USER_AGENT = 'DeclutrMail/1.0 (+https://declutrmail.com)';
const OUTPUT_SIZE = 128;
// A 32px source remains crisp at the 24–40px sizes used by the sender
// table and cards. The previous 96px floor discarded the standard
// favicon published by many otherwise well-known brands.
const MIN_SOURCE_SIZE = 32;
const MIN_ASPECT_RATIO = 1 / 2;
const MAX_ASPECT_RATIO = 2;
const MAX_SOURCE_PIXELS = 16 * 1024 * 1024;
const SVG_MIME = 'image/svg+xml';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', SVG_MIME]);

/**
 * Resolve avatar-ready, website-published brand artwork after BIMI misses.
 * This tier deliberately starts with Apple Touch icons: they are
 * high-resolution application marks rather than arbitrary page
 * favicons, and are the best match for DeclutrMail's avatar tile.
 */
export async function resolveWebsiteIcon(
  domain: string,
  deps: WebsiteIconDeps = {},
): Promise<WebsiteIconResolution> {
  const http = deps.http ?? FETCH_BIMI_HTTP_PORT;
  const resolveHost = deps.resolveHost ?? DNS_RESOLVE_HOST;
  let page: (BimiHttpResponse & { url: string; body: Buffer }) | null = null;
  let pageReason = 'website unavailable';
  let transientPageStatus: number | null = null;
  const homepageUrls = [
    `https://${domain}/`,
    ...(domain.startsWith('www.') ? [] : [`https://www.${domain}/`]),
  ];
  for (const homepageUrl of homepageUrls) {
    const candidate = await guardedIconGet(
      homepageUrl,
      http,
      resolveHost,
      PAGE_MAX_BYTES,
      'text/html,application/xhtml+xml;q=0.9',
    );
    if (candidate.tooLarge) {
      pageReason = 'website response oversize';
      continue;
    }
    if (candidate.status !== 200 || !candidate.body) {
      if (isTransientHttpStatus(candidate.status)) transientPageStatus = candidate.status;
      pageReason = `website http ${candidate.status}`;
      continue;
    }
    const pageMime = mimeOf(candidate.contentType);
    if (pageMime !== 'text/html' && pageMime !== 'application/xhtml+xml') {
      pageReason = `website content-type: ${pageMime}`;
      continue;
    }
    page = { ...candidate, body: candidate.body };
    break;
  }
  if (!page) {
    if (transientPageStatus !== null) {
      throw new TransientError(`Website homepage fetch failed with HTTP ${transientPageStatus}`);
    }
    return { status: 'none', reason: pageReason };
  }

  const html = page.body.toString('utf8');
  const manifest = manifestHref(html);
  // Keep the tiers lazy. A homepage often advertises both a touch icon
  // and a manifest; fetching the manifest before trying the preferred
  // touch icon adds latency and creates an unnecessary failure point.
  const iconTiers: Array<() => Promise<string[]>> = [
    async () => appleTouchIconHrefs(html),
    async () => {
      if (!manifest) return [];
      let manifestUrl: string;
      try {
        manifestUrl = new URL(manifest, page.url).toString();
      } catch {
        return [];
      }
      return await manifestIconHrefs(manifestUrl, http, resolveHost);
    },
    async () => standardIconHrefs(html),
    async () => tileImageHrefs(html),
    async () => {
      try {
        return [new URL('/apple-touch-icon.png', page.url).toString()];
      } catch {
        // `page.url` came from a validated absolute URL, so this is only
        // defensive against an injected test adapter returning junk.
        return [];
      }
    },
  ];

  let lastReason = 'website has no usable apple touch icon';
  let transientIconStatus: number | null = null;
  const seen = new Set<string>();
  let attempted = 0;
  for (const loadTier of iconTiers) {
    if (attempted >= 8) break;
    const iconHrefs = await loadTier();
    for (const iconHref of iconHrefs) {
      if (attempted >= 8) break;
      let iconUrl: string;
      try {
        iconUrl = new URL(iconHref, page.url).toString();
      } catch {
        lastReason = 'website icon has invalid url';
        continue;
      }
      if (seen.has(iconUrl)) continue;
      seen.add(iconUrl);
      attempted++;

      const icon = await guardedIconGet(
        iconUrl,
        http,
        resolveHost,
        IMAGE_MAX_BYTES,
        'image/png,image/jpeg,image/webp,image/svg+xml',
      );
      if (icon.tooLarge) {
        lastReason = 'website icon oversize';
        continue;
      }
      if (icon.status !== 200 || !icon.body) {
        if (isTransientHttpStatus(icon.status)) transientIconStatus = icon.status;
        lastReason = `website icon http ${icon.status}`;
        continue;
      }
      const iconMime = mimeOf(icon.contentType);
      if (!IMAGE_MIMES.has(iconMime)) {
        lastReason = `website icon content-type: ${iconMime}`;
        continue;
      }
      if (iconMime === SVG_MIME) {
        const validation = validateBimiSvg(icon.body);
        if (!validation.ok) {
          lastReason = `website svg failed safety gate: ${validation.reason}`;
          continue;
        }
      }

      const normalized = await normalizeSquareIcon(icon.body);
      if (!normalized) {
        lastReason = 'website icon failed quality gate';
        continue;
      }
      return { status: 'ok', image: normalized, mime: 'image/png' };
    }
  }

  if (transientIconStatus !== null) {
    throw new TransientError(`Website icon fetch failed with HTTP ${transientIconStatus}`);
  }
  return { status: 'none', reason: lastReason };
}

/** Decode untrusted artwork and emit one opaque, metadata-free avatar PNG. */
export async function normalizeSquareIcon(input: Buffer): Promise<Buffer | null> {
  try {
    const decoder = sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_SOURCE_PIXELS,
      animated: false,
    });
    const metadata = await decoder.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const ratio = width / height;
    if (
      width < MIN_SOURCE_SIZE ||
      height < MIN_SOURCE_SIZE ||
      !Number.isFinite(ratio) ||
      ratio < MIN_ASPECT_RATIO ||
      ratio > MAX_ASPECT_RATIO
    ) {
      return null;
    }

    // Decoding then re-encoding strips EXIF/profile metadata and turns
    // every accepted source into one inert, predictable browser format.
    return await decoder
      .rotate()
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      // Avatar's monogram is always painted underneath. An alpha
      // channel would let its initial show through a transparent mark,
      // so website-derived tiles are intentionally opaque.
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }
}

function appleTouchIconHrefs(html: string): string[] {
  const candidates: Array<{ href: string; size: number }> = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = htmlAttributes(match[0]);
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.includes('apple-touch-icon') && attrs.href) {
      candidates.push({ href: attrs.href, size: declaredSize(attrs.sizes) });
    }
  }
  return candidates.sort((a, b) => b.size - a.size).map((candidate) => candidate.href);
}

function manifestHref(html: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = htmlAttributes(match[0]);
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.includes('manifest') && attrs.href) return attrs.href;
  }
  return null;
}

function standardIconHrefs(html: string): string[] {
  const candidates: Array<{ href: string; size: number }> = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = htmlAttributes(match[0]);
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const size = declaredSize(attrs.sizes);
    if (
      rel.includes('icon') &&
      !rel.includes('apple-touch-icon') &&
      attrs.href &&
      (!attrs.type || IMAGE_MIMES.has(mimeOf(attrs.type)))
    ) {
      candidates.push({ href: attrs.href, size });
    }
  }
  return candidates.sort((a, b) => b.size - a.size).map((candidate) => candidate.href);
}

function tileImageHrefs(html: string): string[] {
  const candidates: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = htmlAttributes(match[0]);
    const key = (attrs.name ?? attrs.property ?? '').toLowerCase();
    if (!attrs.content) continue;
    if (key === 'msapplication-tileimage') {
      candidates.push(attrs.content);
    }
  }
  return candidates;
}

async function manifestIconHrefs(
  manifestUrl: string,
  http: WebsiteIconHttpPort,
  resolveHost: ResolveHost,
): Promise<string[]> {
  const response = await guardedIconGet(
    manifestUrl,
    http,
    resolveHost,
    MANIFEST_MAX_BYTES,
    'application/manifest+json,application/json;q=0.9',
  );
  if (response.tooLarge) return [];
  if (isTransientHttpStatus(response.status)) {
    throw new TransientError(`Website manifest fetch failed with HTTP ${response.status}`);
  }
  if (response.status !== 200 || !response.body) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString('utf8'));
  } catch {
    return [];
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { icons?: unknown }).icons)
  ) {
    return [];
  }

  const candidates: Array<{ href: string; size: number }> = [];
  for (const icon of (parsed as { icons: unknown[] }).icons.slice(0, 32)) {
    if (!icon || typeof icon !== 'object') continue;
    const { src, sizes, type } = icon as { src?: unknown; sizes?: unknown; type?: unknown };
    if (typeof src !== 'string' || src.length === 0) continue;
    if (typeof type === 'string' && type.length > 0 && !IMAGE_MIMES.has(mimeOf(type))) continue;
    try {
      candidates.push({
        href: new URL(src, response.url).toString(),
        size: declaredSize(typeof sizes === 'string' ? sizes : undefined),
      });
    } catch {
      continue;
    }
  }
  return candidates.sort((a, b) => b.size - a.size).map((candidate) => candidate.href);
}

function declaredSize(raw: string | undefined): number {
  if (!raw) return 0;
  let largest = 0;
  for (const token of raw.toLowerCase().split(/\s+/)) {
    const match = /^(\d+)x(\d+)$/.exec(token);
    if (!match) continue;
    const width = Number.parseInt(match[1]!, 10);
    const height = Number.parseInt(match[2]!, 10);
    if (width === height) largest = Math.max(largest, width);
  }
  return largest;
}

function htmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (!name || name.startsWith('<')) continue;
    attrs[name] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeHtmlAttribute(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (whole, raw: string) => {
    const entity = raw.toLowerCase();
    if (!entity.startsWith('#')) return named[entity] ?? whole;
    const codePoint = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (
      !Number.isSafeInteger(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return whole;
    }
    return String.fromCodePoint(codePoint);
  });
}

function mimeOf(contentType: string | null): string {
  return (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
}

/**
 * Fetch one bounded HTTPS resource with DNS rebinding protection.
 * An optional credential is sent on the first hop only and is always
 * stripped before following a redirect.
 */
export async function guardedIconGet(
  startUrl: string,
  http: WebsiteIconHttpPort,
  resolveHost: ResolveHost,
  maxBytes: number,
  accept: string,
  options: { authorization?: string; userAgent?: string } = {},
): Promise<BimiHttpResponse & { url: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await publicTarget(current, resolveHost);
    if (!target.ok) return { status: 0, contentType: null, url: current };
    let response: BimiHttpResponse;
    try {
      response = await http.get(current, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes,
        pinnedAddress: target.pinnedAddress,
        family: target.family,
        accept,
        userAgent: options.userAgent ?? WEBSITE_USER_AGENT,
        ...(hop === 0 && options.authorization ? { authorization: options.authorization } : {}),
      });
    } catch (err) {
      throw new TransientError(`Icon fetch failed: ${describeNetworkError(err)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECTS || !response.location) {
        return { status: response.status, contentType: response.contentType, url: current };
      }
      try {
        current = new URL(response.location, current).toString();
      } catch {
        return { status: response.status, contentType: response.contentType, url: current };
      }
      continue;
    }
    return { ...response, url: current };
  }
  return { status: 0, contentType: null, url: current };
}

async function publicTarget(
  rawUrl: string,
  resolveHost: ResolveHost,
): Promise<{ ok: true; pinnedAddress: string; family: 4 | 6 } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'insecure scheme' };
  if (url.username || url.password) return { ok: false, reason: 'url carries credentials' };

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolveHost(hostname);
    } catch (err) {
      if (isTransientDnsError(err)) {
        throw new TransientError(`Icon host lookup failed: ${describeNetworkError(err)}`);
      }
      return { ok: false, reason: 'dns failure' };
    }
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => classifyAddress(address) !== 'public')
  ) {
    return { ok: false, reason: 'private or unresolved target' };
  }
  const pinnedAddress = addresses[0]!;
  return { ok: true, pinnedAddress, family: isIP(pinnedAddress) === 6 ? 6 : 4 };
}
