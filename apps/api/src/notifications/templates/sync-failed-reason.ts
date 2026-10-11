export type SyncFailedNotice = 'needsYou' | 'needsReconnect' | 'permanent';

const RECONNECT = new Set(['InvalidGrantError', 'AuthExpiredError', 'ProviderPermissionError']);
const RETRIED = new Set(['TransientError', 'RateLimitError', 'GmailQuotaError']);

/**
 * The email is sent only once recovery is used up or the error needs
 * the user. Reconnect codes go out immediately. Transient classes map
 * to needsYou because the send itself means the retry budget is spent.
 */
export function syncFailedNotice(errorCode: string): SyncFailedNotice {
  if (RECONNECT.has(errorCode)) return 'needsReconnect';
  if (RETRIED.has(errorCode)) return 'needsYou';
  return 'permanent';
}
