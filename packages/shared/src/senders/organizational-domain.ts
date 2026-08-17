import { getDomain } from 'tldts';

import { brandRoot } from './brand-root';

/**
 * Public-Suffix-List-backed organizational domain for brand artwork.
 *
 * This lives behind a server-only package subpath. `brandRoot` is used by
 * every browser-rendered avatar, so importing `tldts` from that lightweight
 * module would add the Public Suffix database to every web route.
 *
 * `brandRoot` intentionally recognizes only common bulk-mail prefixes,
 * which leaves open-ended sender hosts such as `alertsp.chase.com` and
 * `rs.email.nextdoor.com` fragmented. Artwork is brand-level, so this
 * second normalization collapses arbitrary subdomains while respecting
 * multi-label and private suffixes (`bbc.co.uk`, `shop.github.io`).
 *
 * Unknown/reserved TLDs are returned unchanged so `.example` fixtures
 * and future DNS names still reach the existing resolvability guard.
 */
export function organizationalDomain(domain: string | undefined | null): string {
  const root = brandRoot(domain).replace(/\.$/, '');
  if (root.length === 0) return '';
  // `tldts` helpfully extracts a host from full URLs. This boundary
  // accepts domain strings only; leave anything else untouched so the
  // worker's existing resolvability guard rejects it terminally.
  if (!/^[a-z0-9.-]+$/i.test(root)) return root;
  return getDomain(root, { allowPrivateDomains: true }) ?? root;
}
