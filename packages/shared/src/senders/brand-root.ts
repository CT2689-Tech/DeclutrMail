/**
 * Brand-level root domain.
 *
 * Bulk senders mail from provider-prefixed subdomains
 * (`mail1.brand.com`, `email.brand.com`, `notify.brand.com`), all of
 * which are the same brand to a human. Collapsing them matters in two
 * places that must agree:
 *
 *   - `Avatar`'s monogram tint (ADR-0024) — otherwise one brand shows
 *     a different colour depending on which of its subdomains happened
 *     to send the message.
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
 * decide the fallback, since they differ: the monogram falls back to
 * the display name, the icon cache declines to look anything up.
 */
export function brandRoot(domain: string | undefined | null): string {
  return (domain ?? '').trim().toLowerCase().replace(/^.*@/, '').replace(BULK_PREFIX, '');
}
