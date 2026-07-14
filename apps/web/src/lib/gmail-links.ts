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
 * D231's `GmailOpenLinkService` owns URL construction. These wrappers
 * retain the surface-specific API while requiring callers to supply
 * the mailbox that Gmail must open.
 */

import { GmailOpenLinkService } from './gmail/open-link';

/** Open one Gmail thread (all-mail view) by thread id. */
export function gmailThreadDeepLink(mailboxEmail: string, threadId: string): string | null {
  return GmailOpenLinkService.buildOpenLink({
    mailboxEmail,
    gmailMessageId: threadId,
  });
}

/**
 * Open ALL Gmail messages from one sender — drives the "Open all in
 * Gmail" button on Sender Detail. `from:` is Gmail's search operator;
 * quoting the address keeps `+`-tagged
 * addresses (e.g. `noreply+tag@…`) from being misinterpreted by Gmail's
 * search parser.
 */
export function gmailAllFromSenderDeepLink(mailboxEmail: string, email: string): string | null {
  return GmailOpenLinkService.buildFromSearchLink({
    mailboxEmail,
    from: email,
  });
}

/**
 * Generic Gmail search deep link — used when the surface wants to
 * encode a richer query (subject + date window, etc.). Keep callers
 * thin so they don't construct URL fragments by hand.
 */
export function gmailSearchDeepLink(mailboxEmail: string, rawQuery: string): string | null {
  return GmailOpenLinkService.buildSearchLink({ mailboxEmail, query: rawQuery });
}

/**
 * Gmail COMPOSE deep link from a `mailto:` List-Unsubscribe URL —
 * D230's manual unsubscribe path. DeclutrMail NEVER auto-sends the
 * opt-out (hard guardrail): this link opens Gmail's compose window
 * prefilled with the address + any `subject` / `body` query params
 * the sender's header carried, and the USER hits Send. List
 * processors verify the subscribed address, so the mail must come
 * from the user's own mailbox.
 *
 * Parsing notes (RFC 6068): the part before `?` is the address
 * (itself percent-encoded in the mailto); query params of interest
 * are `subject` / `body` (matched case-insensitively per common
 * practice). Returns null for anything that isn't a parseable
 * `mailto:` with a non-empty address — callers skip the affordance
 * rather than emit a broken compose link.
 */
export function gmailComposeUrlFromMailto(mailboxEmail: string, mailtoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(mailtoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'mailto:') {
    return null;
  }
  // `URL.pathname` for a mailto carries the (possibly percent-encoded)
  // address list. Decode defensively — a malformed escape must not
  // throw out of a render path.
  let address = parsed.pathname;
  try {
    address = decodeURIComponent(address);
  } catch {
    // Keep the raw form — still a usable recipient for Gmail.
  }
  address = address.trim();
  if (address.length === 0) {
    return null;
  }

  let subject: string | null = null;
  let body: string | null = null;
  for (const [key, value] of parsed.searchParams) {
    const k = key.toLowerCase();
    if (k === 'subject' && subject === null) subject = value;
    if (k === 'body' && body === null) body = value;
  }

  return GmailOpenLinkService.buildComposeLink({
    mailboxEmail,
    to: address,
    subject,
    body,
  });
}
