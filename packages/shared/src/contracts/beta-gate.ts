/**
 * Private-beta invite gate contract (buildout F7).
 *
 * The API's Google OAuth callback gates NEW USER CREATION when
 * `BETA_GATE_ENABLED=true`: a first-time email that is not on the
 * `BETA_INVITE_EMAILS` allowlist is NOT bootstrapped — no user,
 * workspace, mailbox, or session is created. Instead the callback
 * 302-redirects to the public waitlist page:
 *
 *   <WEB_URL>/beta?reason=not_invited
 *
 * Existing users (and emails already connected as secondary mailboxes,
 * whose owner is an existing user) always pass — the gate fires ONLY
 * at the point a brand-new user row would be created.
 *
 * These literals are the API ↔ web contract for that redirect: the
 * controller builds the URL from them and the `/beta` page reads the
 * reason param to distinguish a gate denial from an organic visit
 * (only the denial fires the `beta_gate_denied` observability event).
 *
 * Env contract (.env.example):
 *   BETA_GATE_ENABLED  — gate is active ONLY when exactly 'true';
 *                        unset/anything else → open signup.
 *   BETA_INVITE_EMAILS — comma-separated allowlist; case-insensitive,
 *                        whitespace-trimmed, empty entries ignored.
 */

/** Public web route the denied signup is redirected to. */
export const BETA_DENIED_PATH = '/beta';

/** Query param carrying the redirect reason. */
export const BETA_DENIED_REASON_PARAM = 'reason';

/** Reason value for a beta-gate denial (the only producer today). */
export const BETA_DENIED_REASON = 'not_invited';
