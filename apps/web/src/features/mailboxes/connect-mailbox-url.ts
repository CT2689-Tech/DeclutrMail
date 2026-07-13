/** Authenticated OAuth entry point for adding or re-authorizing Gmail. */
const CONNECT_MAILBOX_START_PATH = '/api/auth/google/connect-mailbox/start';

/**
 * Build the connect-mailbox OAuth URL.
 *
 * A reconnect target is an opaque mailbox UUID. The API validates that it
 * belongs to the signed-in user and binds Google's returned identity to it;
 * email addresses never ride in the browser URL.
 */
export function connectMailboxStartUrl(reconnectMailboxId?: string): string {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const start = `${apiBase}${CONNECT_MAILBOX_START_PATH}`;
  return reconnectMailboxId === undefined
    ? start
    : `${start}?reconnectMailboxId=${encodeURIComponent(reconnectMailboxId)}`;
}

/** OAuth must be a full-page navigation, not an in-app router transition. */
export function startMailboxConnect(reconnectMailboxId?: string): void {
  window.location.assign(connectMailboxStartUrl(reconnectMailboxId));
}
