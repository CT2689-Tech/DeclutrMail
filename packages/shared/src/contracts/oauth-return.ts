/**
 * OAuth return contract — the closed results the Google OAuth routes put
 * on the page a person lands on (D108). One set of literals shared by the
 * API that redirects and the web pages that read them, so the two cannot
 * drift apart. Unknown or non-scalar values render nothing.
 *
 * `gmail_access_missing`: Google's consent screen can finish with the
 * sign-in permissions but not Gmail. When Google's grant shows Gmail was
 * not granted, the callback discards it (no token stored, no scan queued,
 * no session issued) and sends the person back to the surface whose
 * button restarts consent:
 *
 *   sign-in               → /sign-in?auth_result=<value>
 *   add a mailbox         → /settings?connect_start_result=<value>#mailboxes
 *   reconnect/reactivate  → /settings?reconnect_result=<value>#mailbox-<id>
 */
export const GMAIL_ACCESS_MISSING_RESULT = 'gmail_access_missing';

/**
 * `?auth_result=` values on /sign-in. `failed` and `rate_limited` are the
 * exits for a sign-in that did not complete, so a browser never lands on
 * API JSON.
 */
export const SIGN_IN_RESULTS = [
  'inbox_limit',
  GMAIL_ACCESS_MISSING_RESULT,
  'failed',
  'rate_limited',
] as const;

export type SignInResult = (typeof SIGN_IN_RESULTS)[number];

/** Narrow an untrusted query value to a closed /sign-in result. */
export function parseSignInResult(value: unknown): SignInResult | undefined {
  return (SIGN_IN_RESULTS as readonly unknown[]).includes(value)
    ? (value as SignInResult)
    : undefined;
}
