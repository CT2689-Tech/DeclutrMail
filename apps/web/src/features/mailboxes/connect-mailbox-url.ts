import { openOAuthInShell } from '@/lib/native/oauth-shell';

/** Authenticated OAuth entry point for adding or re-authorizing Gmail. */
const CONNECT_MAILBOX_START_PATH = '/api/auth/google/connect-mailbox/start';

/**
 * Build the connect-mailbox OAuth URL.
 *
 * A reconnect target is an opaque mailbox UUID. The API validates that it
 * belongs to the signed-in user and binds Google's returned identity to it;
 * email addresses never ride in the browser URL.
 */
export function connectMailboxStartUrl(
  reconnectMailboxId?: string,
  billingReturnTo?: string,
): string {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const start = `${apiBase}${CONNECT_MAILBOX_START_PATH}`;
  const target =
    reconnectMailboxId === undefined
      ? start
      : `${start}?reconnectMailboxId=${encodeURIComponent(reconnectMailboxId)}`;
  // Billing callers already parse the intent. This shared URL builder only
  // carries a bounded Billing-path hint; the API validates the full query
  // again before signing it. Keep the full app-route parser off every page
  // that offers an ordinary Gmail reconnect.
  const destination =
    typeof billingReturnTo === 'string' &&
    billingReturnTo.length <= 1024 &&
    /^\/billing(?:\?|$)/.test(billingReturnTo)
      ? billingReturnTo
      : undefined;
  return destination
    ? `${target}${target.includes('?') ? '&' : '?'}billingReturnTo=${encodeURIComponent(destination)}`
    : target;
}

/**
 * OAuth must be a full-page navigation, not an in-app router transition. In
 * the native app shell it runs in the system browser instead, because Google
 * refuses OAuth in an embedded WebView.
 */
export function startMailboxConnect(reconnectMailboxId?: string, billingReturnTo?: string): void {
  const url = connectMailboxStartUrl(reconnectMailboxId, billingReturnTo);
  if (!openOAuthInShell(url)) window.location.assign(url);
}

/**
 * Build the OAuth URL for restoring one disconnected mailbox.
 *
 * Reactivation is deliberately distinct from active-mailbox reconnect:
 * it can consume an inbox slot, while the API must still bind Google's
 * returned identity to the exact disconnected mailbox the user chose.
 */
export function reactivateMailboxStartUrl(mailboxId: string): string {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const start = `${apiBase}${CONNECT_MAILBOX_START_PATH}`;
  return `${start}?reactivateMailboxId=${encodeURIComponent(mailboxId)}`;
}

/** OAuth reactivation is a full-page navigation to a mailbox-bound start. */
export function startMailboxReactivation(mailboxId: string): void {
  const url = reactivateMailboxStartUrl(mailboxId);
  if (!openOAuthInShell(url)) window.location.assign(url);
}
