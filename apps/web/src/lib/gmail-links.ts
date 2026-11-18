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
 * Gmail COMPOSE deep link from a `mailto:` List-Unsubscribe URL — D230's
 * manual unsubscribe path. The implementation is shared with the MCP
 * connector, so both hand out the same link for the same sender.
 */
export { gmailComposeUrlFromMailto } from '@declutrmail/shared/contracts';
