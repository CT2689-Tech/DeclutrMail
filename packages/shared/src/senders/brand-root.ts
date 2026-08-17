import { getDomain } from 'tldts';

/**
 * Brand-level root domain.
 *
 * Bulk senders mail from provider-prefixed subdomains
 * (`mail1.brand.com`, `email.brand.com`, `notify.brand.com`), all of
 * which are the same brand to a human. Collapsing them matters in two
 * places that must agree:
 *
 *   - The brand icon cache key (ADR-0034) — otherwise each subdomain
 *     is a separate row and a separate outbound fetch, for artwork
 *     that is identical.
 *
 * Shared rather than duplicated because a drift between the two would
 * be invisible: the tint and the logo would silently disagree about
 * what counts as one brand.
 */
const BULK_PREFIX = /^(mail\d*|e\d*|em|email|news|notify|notification|alerts?|updates?|mailer)\./i;

/**
 * Reduce a sender domain (or a full address) to its brand root.
 * Returns an empty string when there is nothing usable — callers
 * decide the fallback; the icon cache declines to look anything up.
 */
export function brandRoot(domain: string | undefined | null): string {
  return (domain ?? '').trim().toLowerCase().replace(/^.*@/, '').replace(BULK_PREFIX, '');
}

/**
 * Public-Suffix-List-backed organizational domain for brand artwork.
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
