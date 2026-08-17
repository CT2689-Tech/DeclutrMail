import { FETCH_BIMI_HTTP_PORT, type BimiHttpPort, type BimiHttpResponse } from './bimi-resolver.js';
import { DNS_RESOLVE_HOST, isTransientHttpStatus, type ResolveHost } from './ssrf-guard.js';
import { guardedIconGet, normalizeSquareIcon } from './website-icon-resolver.js';
import { PermanentError, RateLimitError, TransientError } from './worker-errors.js';

export type BrandfetchIconHttpPort = BimiHttpPort;

export type BrandfetchIconResolution =
  { status: 'ok'; image: Buffer; mime: 'image/png' } | { status: 'none'; reason: string };

export interface BrandfetchIconDeps {
  /** Brand API secret. Server-side only; never expose as NEXT_PUBLIC_*. */
  apiKey: string;
  resolveHost?: ResolveHost;
  http?: BrandfetchIconHttpPort;
}

const API_ORIGIN = 'https://api.brandfetch.io';
const API_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 1024 * 1024;
const BRANDFETCH_USER_AGENT = 'DeclutrMail/1.0 (+https://declutrmail.com)';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface BrandfetchFormat {
  src?: unknown;
  format?: unknown;
  width?: unknown;
  height?: unknown;
}

interface BrandfetchLogo {
  type?: unknown;
  formats?: unknown;
}

/**
 * Resolve a Brandfetch Brand API icon as the final server-side tier.
 * Both metadata and artwork are bounded, SSRF-guarded fetches; the
 * credential is attached only to the fixed API request and never to
 * an artwork host or redirect.
 */
export async function resolveBrandfetchIcon(
  domain: string,
  deps: BrandfetchIconDeps,
): Promise<BrandfetchIconResolution> {
  const apiKey = deps.apiKey.trim();
  if (!apiKey) throw new PermanentError('Brandfetch API key is not configured', 'missingApiKey');

  const http = deps.http ?? FETCH_BIMI_HTTP_PORT;
  const resolveHost = deps.resolveHost ?? DNS_RESOLVE_HOST;
  const apiUrl = `${API_ORIGIN}/v2/brands/domain/${encodeURIComponent(domain)}`;

  let metadata: BimiHttpResponse & { url: string };
  try {
    metadata = await guardedIconGet(apiUrl, http, resolveHost, API_MAX_BYTES, 'application/json', {
      authorization: `Bearer ${apiKey}`,
      userAgent: BRANDFETCH_USER_AGENT,
    });
  } catch {
    throw new TransientError('Brandfetch metadata request failed');
  }

  if (metadata.status === 404) return { status: 'none', reason: 'brandfetch has no brand' };
  if (metadata.status === 401 || metadata.status === 403) {
    throw new PermanentError('Brandfetch rejected the server API credential', 'invalidApiKey');
  }
  if (metadata.status === 429) throw new RateLimitError('Brandfetch request quota exhausted');
  if (isTransientHttpStatus(metadata.status)) {
    throw new TransientError(`Brandfetch metadata request failed with HTTP ${metadata.status}`);
  }
  if (metadata.tooLarge) return { status: 'none', reason: 'brandfetch metadata oversize' };
  if (metadata.status !== 200 || !metadata.body) {
    return { status: 'none', reason: `brandfetch http ${metadata.status}` };
  }
  if (mimeOf(metadata.contentType) !== 'application/json') {
    return { status: 'none', reason: 'brandfetch returned non-json metadata' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata.body.toString('utf8'));
  } catch {
    return { status: 'none', reason: 'brandfetch returned malformed metadata' };
  }
  const assetUrl = bestRasterAsset(parsed);
  if (!assetUrl) return { status: 'none', reason: 'brandfetch has no usable icon' };

  let asset: BimiHttpResponse & { url: string };
  try {
    asset = await guardedIconGet(
      assetUrl,
      http,
      resolveHost,
      IMAGE_MAX_BYTES,
      'image/png,image/jpeg,image/webp',
      { userAgent: BRANDFETCH_USER_AGENT },
    );
  } catch {
    throw new TransientError('Brandfetch artwork request failed');
  }
  if (isTransientHttpStatus(asset.status)) {
    throw new TransientError(`Brandfetch artwork request failed with HTTP ${asset.status}`);
  }
  if (asset.tooLarge) return { status: 'none', reason: 'brandfetch artwork oversize' };
  if (asset.status !== 200 || !asset.body) {
    return { status: 'none', reason: `brandfetch artwork http ${asset.status}` };
  }
  if (!IMAGE_MIMES.has(mimeOf(asset.contentType))) {
    return { status: 'none', reason: 'brandfetch artwork has unsupported content-type' };
  }

  const image = await normalizeSquareIcon(asset.body);
  if (!image) return { status: 'none', reason: 'brandfetch artwork failed quality gate' };
  return { status: 'ok', image, mime: 'image/png' };
}

function bestRasterAsset(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const logos = (value as { logos?: unknown }).logos;
  if (!Array.isArray(logos)) return null;

  const candidates: Array<{ src: string; score: number }> = [];
  for (const rawLogo of logos.slice(0, 32)) {
    if (!rawLogo || typeof rawLogo !== 'object') continue;
    const logo = rawLogo as BrandfetchLogo;
    if (!Array.isArray(logo.formats)) continue;
    const iconBonus = logo.type === 'icon' ? 1_000_000 : 0;
    for (const rawFormat of logo.formats.slice(0, 32)) {
      if (!rawFormat || typeof rawFormat !== 'object') continue;
      const format = rawFormat as BrandfetchFormat;
      if (typeof format.src !== 'string' || format.src.length === 0) continue;
      const kind = typeof format.format === 'string' ? format.format.toLowerCase() : '';
      if (!['png', 'jpeg', 'jpg', 'webp'].includes(kind)) continue;
      const width = typeof format.width === 'number' ? format.width : 0;
      const height = typeof format.height === 'number' ? format.height : 0;
      const ratio = width > 0 && height > 0 ? width / height : 1;
      // Prefer Brandfetch's square `icon`, but keep a mildly rectangular
      // mark as a last resort when that is the only real brand artwork.
      // The shared normalizer applies the same 1:2–2:1 decoded-image gate.
      if (ratio < 1 / 2 || ratio > 2) continue;
      candidates.push({ src: format.src, score: iconBonus + Math.min(width, height) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.src ?? null;
}

function mimeOf(contentType: string | null): string {
  return (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
}
