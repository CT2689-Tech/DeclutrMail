/**
 * Gmail deep-link helpers (D41, D231-precursor).
 *
 * DeclutrMail never renders message bodies (D7) — clicking a subject
 * row, an "Open all in Gmail" button, or a search anchor leaves the
 * app and lands on Gmail's own UI. These helpers build the canonical
 * URL shapes for each surface.
 *
 * Privacy posture: the URL carries an EMAIL ADDRESS (e.g.
 * `from:noreply@robinhood.com`) in the query. The address is already
 * present on the FE — this lib does not derive any new identifier
 * from message data, just composes a navigation target. Gmail itself
 * sees the same address whenever the user types it.
 *
 * Future: D231's `GmailOpenLinkService` will own this; today the
 * helpers are the FE source of truth so each call site doesn't roll
 * its own template.
 */

/** Open one Gmail thread (inbox view) by thread id. */
export function gmailThreadDeepLink(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

/**
 * Open ALL Gmail messages from one sender — drives the "Open all in
 * Gmail" button on Sender Detail. `from:` is Gmail's quoted-search
 * operator; quoting the address with single quotes keeps `+`-tagged
 * addresses (e.g. `noreply+tag@…`) from being misinterpreted by Gmail's
 * search parser.
 */
export function gmailAllFromSenderDeepLink(email: string): string {
  // Gmail's URL fragment is NOT URL-decoded server-side, but the
  // `+` and `:` characters survive the hash without further encoding.
  // We trim defensively so a malformed BE response can't blank out the
  // search.
  const trimmed = email.trim();
  return `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(trimmed)}`;
}

/**
 * Generic Gmail search deep link — used when the surface wants to
 * encode a richer query (subject + date window, etc.). Keep callers
 * thin so they don't construct URL fragments by hand.
 */
export function gmailSearchDeepLink(rawQuery: string): string {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(rawQuery)}`;
}
