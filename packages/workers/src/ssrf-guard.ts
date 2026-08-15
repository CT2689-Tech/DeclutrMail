import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Shared SSRF primitives for outbound fetches of attacker-influenced
 * URLs.
 *
 * DeclutrMail dials third-party URLs it did not choose in two places,
 * and both hand the destination to someone hostile by construction:
 *
 *   - `UnsubExecutionWorker` (D9) POSTs an RFC 8058 one-click URL that
 *     arrived in an email header.
 *   - `DomainIconWorker` (ADR-0034) GETs the `l=` URL from a sender
 *     domain's BIMI DNS record.
 *
 * These functions were written for the first and are shared with the
 * second rather than copied. A duplicated address classifier is not a
 * style problem: the two copies drift, and the drift is a
 * vulnerability in whichever one stopped being updated.
 *
 * The pair implements defence in two stages. `classifyAddress` decides
 * whether a resolved IP may be dialed at all; `buildPinnedLookup`
 * forces the socket to dial exactly the address that was classified,
 * which is what closes the DNS-rebinding TOCTOU between the check and
 * the connect.
 */

/** The `dns.lookup`-compatible shape `node:http(s)` request options accept. */
export type PinnedLookup = (
  hostname: string,
  optionsOrCb: { all?: boolean } | PinnedLookupCallback,
  maybeCb?: PinnedLookupCallback,
) => void;
type PinnedLookupCallback = (
  err: Error | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup`-compatible function that ALWAYS yields the pre-validated
 * pinned address, ignoring the requested hostname. This is what closes
 * the DNS-rebinding TOCTOU: the connector resolves through this instead
 * of a real resolver, so the socket can only dial the address the SSRF
 * pre-flight already classified. Honors the undici-style `options.all`
 * (array) form for safety, though Node's own connector calls the
 * non-`all` `(hostname, options, cb)` form.
 *
 * Exported for direct unit testing — the pin is the whole security
 * property, so it gets its own test rather than only the integration.
 */
export function buildPinnedLookup(pinnedAddress: string, family: 4 | 6): PinnedLookup {
  return (_hostname, optionsOrCb, maybeCb) => {
    const all = typeof optionsOrCb === 'function' ? false : optionsOrCb.all === true;
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb!;
    if (all) {
      cb(null, [{ address: pinnedAddress, family }]);
    } else {
      cb(null, pinnedAddress, family);
    }
  };
}

/**
 * Classify one resolved IP. 'loopback' is split out because the
 * insecure-targets flag exempts loopback ONLY (a 127.0.0.1 smoke fake)
 * while RFC 1918 / link-local / ULA stay blocked unconditionally.
 */
export function classifyAddress(address: string): 'public' | 'loopback' | 'private' {
  // Normalize IPv4-mapped IPv6 (`::ffff:10.0.0.1`) to the v4 form so
  // the v4 range checks below apply.
  const normalized = address.toLowerCase().startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;

  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map((o) => Number.parseInt(o, 10));
    const [a, b] = octets as [number, number, number, number];
    if (a === 127) return 'loopback';
    if (a === 0) return 'private'; // 0.0.0.0/8 — "this network"
    if (a === 10) return 'private'; // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return 'private'; // RFC 1918
    if (a === 192 && b === 168) return 'private'; // RFC 1918
    if (a === 169 && b === 254) return 'private'; // link-local (incl. GCP metadata)
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
    return 'public';
  }

  // IPv6.
  const lower = normalized.toLowerCase();
  if (lower === '::1') return 'loopback';
  if (lower === '::') return 'private'; // unspecified
  const firstGroup = lower.split(':', 1)[0] ?? '';
  // fc00::/7 — unique local.
  if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) return 'private';
  // fe80::/10 — link-local (fe80–febf).
  if (/^fe[89ab]/.test(firstGroup)) return 'private';
  return 'public';
}

/** Resolver seam — `node:dns` lookup in production; injectable for tests. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export const DNS_RESOLVE_HOST: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};
