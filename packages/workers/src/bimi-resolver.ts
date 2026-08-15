import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import {
  buildPinnedLookup,
  classifyAddress,
  DNS_RESOLVE_HOST,
  type ResolveHost,
} from './ssrf-guard.js';
import { verifyVmc, type VmcOptions, type VmcResult } from './vmc-verifier.js';

/**
 * BIMI logo resolution (ADR-0034 §4).
 *
 * BIMI ("Brand Indicators for Message Identification") is a DNS TXT
 * record at `default._bimi.<domain>` in which a brand publishes a URL
 * to its own logo as SVG:
 *
 *   v=BIMI1; l=https://brand.example/logo.svg; a=https://brand.example/vmc.pem
 *
 * It is the source we prefer over any logo vendor: no account, no bill,
 * no licensing question, and the artwork is published by the brand
 * itself rather than scraped. It is also SVG, which is why Phase 1
 * needs no raster pipeline — one vector renders at every avatar size.
 *
 * ─── THE RECORD ALONE PROVES NOTHING ──────────────────────────────────
 *
 * A BIMI record is just DNS the domain owner published, so `l=` on its
 * own is an assertion, not evidence: anyone can register
 * `chase-security-alerts.example` and point it at Chase's artwork.
 * Rendering that beside the sender would lend our UI's credibility to
 * a lookalike.
 *
 * So NOTHING is stored unless the `a=` certificate verifies —
 * chain to a publicly trusted root, the BIMI extended-key-usage, a SAN
 * covering this domain, and a commitment to the exact bytes behind
 * `l=`. See `vmc-verifier.ts`; founder decision 2026-08-15 was to build
 * that before enabling logos at all, which is the same bar Gmail sets.
 *
 * A record with no `a=` tag therefore yields no logo, however
 * well-formed it otherwise is.
 * ──────────────────────────────────────────────────────────────────────
 *
 * The `l=` URL is attacker-controlled by construction, so the fetch
 * runs behind the same SSRF guard as the one-click unsubscribe POST
 * (`ssrf-guard.ts`): https only, every resolved address classified,
 * the socket pinned to the validated address so DNS rebinding cannot
 * swap it, a redirect budget with the full guard re-run per hop, a
 * response-size ceiling, and a wall-clock timeout.
 */

/** Refuse to buffer more than this. SVG Tiny PS marks are a few KB. */
export const BIMI_MAX_BYTES = 64 * 1024;

/** Wall-clock cap for one hop. */
export const BIMI_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Redirect budget. Brands commonly serve logos from a CDN behind one
 * hop, so refusing redirects outright would cost real coverage. Each
 * hop re-runs the FULL guard (scheme + address classification + pin),
 * so a redirect cannot be used to reach an address the first check
 * would have refused.
 */
export const BIMI_MAX_REDIRECTS = 2;

/** Only SVG. BIMI mandates SVG Tiny PS; anything else is not a BIMI logo. */
const SVG_MIME = 'image/svg+xml';

/**
 * Tokens that must not appear in a stored mark.
 *
 * SVG Tiny PS forbids scripting, external references, and animation
 * outright, so a conforming BIMI logo contains none of these and
 * REJECTING is both spec-correct and safer than stripping: a partial
 * strip that misses one vector stores a live payload, while a
 * false-positive rejection costs one monogram.
 *
 * We serve these bytes from our own origin, so this is defence in depth
 * on top of the `<img>` rendering context (which does not execute
 * script) and the endpoint's `Content-Security-Policy: sandbox`.
 */
const FORBIDDEN_SVG_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script/i, reason: 'script element' },
  { pattern: /<\s*foreignObject/i, reason: 'foreignObject element' },
  { pattern: /<\s*image\b/i, reason: 'raster image element' },
  { pattern: /<\s*use\b/i, reason: 'use element' },
  { pattern: /<!\s*ENTITY/i, reason: 'entity declaration' },
  { pattern: /<!\s*DOCTYPE/i, reason: 'doctype declaration' },
  // `on…=` handlers. Requires a preceding space so `version=` and
  // friends do not match.
  { pattern: /\son[a-z]+\s*=/i, reason: 'event handler attribute' },
  { pattern: /javascript:/i, reason: 'javascript: url' },
  // Any absolute reference out of the document — SVG Tiny PS is
  // self-contained, and an external ref would re-introduce exactly the
  // third-party fetch ADR-0024 removed, this time from our own origin.
  { pattern: /(href|src)\s*=\s*["']?\s*(https?:|\/\/)/i, reason: 'external reference' },
];

export interface BimiOk {
  status: 'ok';
  image: Buffer;
  mime: typeof SVG_MIME;
}

export interface BimiNone {
  status: 'none';
  /** Why nothing was stored. Logged; never surfaced to a user. */
  reason: string;
}

export type BimiResolution = BimiOk | BimiNone;

/** One HTTP hop's outcome. The body is only populated for a 2xx. */
export interface BimiHttpResponse {
  status: number;
  contentType: string | null;
  /** Absent unless 2xx. Never larger than `BIMI_MAX_BYTES`. */
  body?: Buffer;
  /** `Location` on a 3xx. */
  location?: string | null;
  /** Set when the response exceeded the byte ceiling and was abandoned. */
  tooLarge?: boolean;
}

export interface BimiHttpPort {
  get(
    url: string,
    opts: { timeoutMs: number; maxBytes: number; pinnedAddress: string; family: 4 | 6 },
  ): Promise<BimiHttpResponse>;
}

export interface BimiDeps {
  /** DNS TXT seam. Defaults to `node:dns`. */
  resolveTxt?: (name: string) => Promise<string[][]>;
  /** Address resolution seam for the SSRF pre-flight. */
  resolveHost?: ResolveHost;
  /** Outbound HTTP seam — injectable so tests never leave the process. */
  http?: BimiHttpPort;
  /**
   * VMC verification seam. Injectable so the resolver's own tests can
   * exercise record/fetch/SSRF behaviour without carrying a cert
   * fixture through every case; `vmc-verifier.test.ts` tests the real
   * thing against a real chain.
   */
  verifyVmc?: (opts: VmcOptions) => VmcResult;
}

/**
 * Parse a BIMI TXT record into its tags. Returns null when the record
 * is not a BIMI v1 record at all.
 *
 * Record syntax is `key=value` pairs separated by `;`, with arbitrary
 * surrounding whitespace. A long record arrives from DNS split into
 * 255-byte chunks, which the caller joins before parsing.
 */
export function parseBimiRecord(record: string): Record<string, string> | null {
  const tags: Record<string, string> = {};
  for (const part of record.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    // First occurrence wins — a duplicated tag is malformed, and
    // letting a later one overwrite would let a crafted record smuggle
    // a second `l=` past a reader that validated the first.
    if (!(key in tags)) tags[key] = value;
  }
  if ((tags.v ?? '').toUpperCase() !== 'BIMI1') return null;
  return tags;
}

/**
 * Validate fetched bytes as a storable BIMI mark. Rejection is always
 * the safe outcome — the caller falls back to a monogram.
 */
export function validateBimiSvg(bytes: Buffer): { ok: true } | { ok: false; reason: string } {
  if (bytes.byteLength === 0) return { ok: false, reason: 'empty body' };
  if (bytes.byteLength > BIMI_MAX_BYTES) return { ok: false, reason: 'oversize' };

  const text = bytes.toString('utf8');
  // An `<svg` root must actually be present — a 200 serving an HTML
  // error page is the common real-world case.
  if (!/<\s*svg[\s>]/i.test(text)) return { ok: false, reason: 'not an svg document' };

  for (const { pattern, reason } of FORBIDDEN_SVG_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: `forbidden content: ${reason}` };
  }
  return { ok: true };
}

/**
 * Resolve one domain's BIMI logo. Never throws for an expected
 * condition — a missing record, a hostile URL, or unusable bytes all
 * return `{status:'none'}` with a reason, which the worker stores as a
 * cached miss. Only genuinely unexpected faults propagate.
 */
export async function resolveBimiIcon(
  domain: string,
  deps: BimiDeps = {},
): Promise<BimiResolution> {
  const resolveTxt = deps.resolveTxt ?? dnsResolveTxt;
  const http = deps.http ?? FETCH_BIMI_HTTP_PORT;

  let records: string[][];
  try {
    records = await resolveTxt(`default._bimi.${domain}`);
  } catch {
    // NXDOMAIN is the overwhelmingly common answer and is not an error
    // worth retrying — the vast majority of domains publish no BIMI.
    return { status: 'none', reason: 'no bimi record' };
  }

  const tags = records
    .map((chunks) => parseBimiRecord(chunks.join('')))
    .find((parsed): parsed is Record<string, string> => parsed !== null);
  if (!tags) return { status: 'none', reason: 'no bimi record' };

  const logoUrl = tags.l ?? '';
  // An empty `l=` is a brand explicitly declining to publish a mark.
  if (logoUrl === '') return { status: 'none', reason: 'record declines a logo' };

  // No `a=`, no logo. The certificate is the only thing that makes the
  // `l=` claim checkable, so a record without one is unusable to us
  // however well-formed it otherwise is.
  const vmcUrl = tags.a ?? '';
  if (vmcUrl === '') return { status: 'none', reason: 'record carries no vmc tag' };

  const resolveHost = deps.resolveHost ?? DNS_RESOLVE_HOST;

  const fetched = await fetchGuarded(logoUrl, http, resolveHost, SVG_MIME);
  if (fetched.status === 'none') return fetched;

  const valid = validateBimiSvg(fetched.image);
  if (!valid.ok) return { status: 'none', reason: valid.reason };

  // The VMC is fetched through the SAME guard: its URL comes from the
  // same attacker-controlled record. No content-type constraint —
  // issuers serve PEM as everything from application/pkix-cert to
  // text/plain, and the bytes are validated by parsing them as X.509,
  // which is a far stronger check than a header.
  const vmc = await fetchGuarded(vmcUrl, http, resolveHost, null);
  if (vmc.status === 'none') return { status: 'none', reason: `vmc fetch: ${vmc.reason}` };

  const verified = (deps.verifyVmc ?? verifyVmc)({
    pem: vmc.image.toString('utf8'),
    domain,
    logo: fetched.image,
  });
  if (!verified.ok) return { status: 'none', reason: verified.reason };

  return { status: 'ok', image: fetched.image, mime: SVG_MIME };
}

/**
 * Fetch `url` behind the SSRF guard, following at most
 * `BIMI_MAX_REDIRECTS` hops and re-validating every one.
 */
async function fetchGuarded(
  url: string,
  http: BimiHttpPort,
  resolveHost: ResolveHost,
  /** Required response mime, or null to accept any (see the VMC call). */
  expectMime: string | null,
): Promise<{ status: 'ok'; image: Buffer } | BimiNone> {
  let current = url;

  for (let hop = 0; hop <= BIMI_MAX_REDIRECTS; hop++) {
    const target = await validateTarget(current, resolveHost);
    if (!target.ok) return { status: 'none', reason: target.reason };

    let response: BimiHttpResponse;
    try {
      response = await http.get(current, {
        timeoutMs: BIMI_REQUEST_TIMEOUT_MS,
        maxBytes: BIMI_MAX_BYTES,
        pinnedAddress: target.pinnedAddress,
        family: target.family,
      });
    } catch {
      return { status: 'none', reason: 'fetch failed' };
    }

    if (response.status >= 300 && response.status < 400) {
      if (hop === BIMI_MAX_REDIRECTS) return { status: 'none', reason: 'too many redirects' };
      if (!response.location) return { status: 'none', reason: 'redirect without location' };
      // Resolve relative Locations against the CURRENT url, then loop
      // — the next iteration re-runs the full guard on the result.
      try {
        current = new URL(response.location, current).toString();
      } catch {
        return { status: 'none', reason: 'invalid redirect target' };
      }
      continue;
    }

    if (response.status !== 200) return { status: 'none', reason: `http ${response.status}` };
    if (response.tooLarge) return { status: 'none', reason: 'oversize' };
    if (!response.body) return { status: 'none', reason: 'empty body' };

    if (expectMime !== null) {
      // Content-type may carry parameters (`image/svg+xml; charset=utf-8`).
      const mime = (response.contentType ?? '').split(';', 1)[0]?.trim().toLowerCase();
      if (mime !== expectMime) {
        return { status: 'none', reason: `unexpected content-type: ${mime}` };
      }
    }

    return { status: 'ok', image: response.body };
  }

  return { status: 'none', reason: 'too many redirects' };
}

/**
 * SSRF pre-flight for one hop. Mirrors `UnsubExecutionWorker`'s: https
 * only, every resolved address classified, and the validated address
 * returned so the socket can be pinned to it.
 *
 * There is no `allowInsecureTargets` escape hatch here. The unsub
 * worker has one so a local smoke can POST at a 127.0.0.1 fake; icon
 * resolution is exercised through the injected `http` port instead, so
 * loopback never needs to be reachable and the rule stays absolute.
 */
async function validateTarget(
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
  // Credentials in the URL would be sent to the target; a BIMI logo
  // never needs them and their presence signals a crafted record.
  if (url.username || url.password) return { ok: false, reason: 'url carries credentials' };

  // `URL.hostname` brackets IPv6 literals — strip for isIP/lookup.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolveHost(hostname);
    } catch {
      return { ok: false, reason: 'dns failure' };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns failure' };

  for (const address of addresses) {
    if (classifyAddress(address) !== 'public') {
      return { ok: false, reason: 'private target' };
    }
  }

  const pinnedAddress = addresses[0]!;
  return { ok: true, pinnedAddress, family: isIP(pinnedAddress) === 6 ? 6 : 4 };
}

/**
 * Production adapter — `node:https.request` pinned to the pre-validated
 * address, with no auto-follow (the caller owns the redirect budget so
 * every hop is re-validated) and a hard byte ceiling enforced while
 * streaming, so an endless response is abandoned rather than buffered.
 * TLS SNI stays the hostname so certificate validation is unchanged.
 */
export const FETCH_BIMI_HTTP_PORT: BimiHttpPort = {
  get(url, opts) {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    return new Promise<BimiHttpResponse>((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: parsed.protocol,
          hostname,
          port: parsed.port ? Number(parsed.port) : 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers: {
            Accept: SVG_MIME,
            'User-Agent': BIMI_USER_AGENT,
          },
          lookup: buildPinnedLookup(opts.pinnedAddress, opts.family) as never,
          servername: hostname,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const contentType = res.headers['content-type'] ?? null;
          const location = res.headers.location ?? null;

          if (status !== 200) {
            res.resume();
            res.destroy();
            resolve({ status, contentType, location });
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > opts.maxBytes) {
              // Abandon rather than buffer — the ceiling is the whole
              // protection against a hostile endless body.
              res.destroy();
              resolve({ status, contentType, tooLarge: true });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        },
      );
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error(`BIMI fetch timed out after ${opts.timeoutMs}ms`));
      });
      req.on('error', reject);
      req.end();
    });
  },
};

/**
 * Identify ourselves, for the same reason the unsubscribe POST does: a
 * UA-less request is a stock bot signature that CDNs answer with a 403,
 * and naming ourselves with a resolvable URL is the honest thing to
 * send.
 */
export const BIMI_USER_AGENT = 'DeclutrMail/1.0 (+https://declutrmail.com)';
