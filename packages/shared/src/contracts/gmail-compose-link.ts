const GMAIL_BASE = 'https://mail.google.com/mail/';

/**
 * Gmail COMPOSE link from a `mailto:` List-Unsubscribe URL — the manual
 * unsubscribe path. DeclutrMail never sends the opt-out itself: this link
 * opens Gmail's compose window prefilled with the address and any
 * `subject` / `body` the sender's header carried, and the person presses
 * Send. List processors verify the subscribed address, so the mail has to
 * come from the person's own mailbox.
 *
 * One implementation for the web app and the MCP connector (ADR-0048 rule
 * 5), so the two cannot hand out different links for the same sender.
 *
 * Parsing (RFC 6068): the part before `?` is the address, itself
 * percent-encoded; `subject` and `body` are matched case-insensitively.
 * Returns null for anything that is not a parseable `mailto:` with a
 * non-empty address — callers skip the link rather than emit a broken one.
 */
export function gmailComposeUrlFromMailto(mailboxEmail: string, mailtoUrl: string): string | null {
  const account = mailboxEmail.trim();
  if (account.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(mailtoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'mailto:') return null;

  // `URL.pathname` for a mailto carries the (possibly percent-encoded)
  // address list. A malformed escape must not throw out of a render path.
  let address = parsed.pathname;
  try {
    address = decodeURIComponent(address);
  } catch {
    // Keep the raw form — still a usable recipient for Gmail.
  }
  address = address.trim();
  if (address.length === 0) return null;

  let subject: string | null = null;
  let body: string | null = null;
  for (const [key, value] of parsed.searchParams) {
    const k = key.toLowerCase();
    if (k === 'subject' && subject === null) subject = value;
    if (k === 'body' && body === null) body = value;
  }

  const params = new URLSearchParams({ authuser: account, view: 'cm', fs: '1', to: address });
  if (subject && subject.trim().length > 0) params.set('su', subject.trim());
  if (body && body.trim().length > 0) params.set('body', body.trim());
  return `${GMAIL_BASE}?${params.toString()}`;
}
