import { createHash } from 'node:crypto';

/**
 * Browser-facing pieces shared by the Google OAuth routes and their exit
 * filters (D108). Their own module so a filter can use them without
 * importing the controller that applies it.
 */

/** Cookie carrying the OAuth state — nonce + post-callback intent. */
export const STATE_COOKIE = 'oauth_state';
/**
 * New OAuth starts use one cookie per flow. A fixed cookie name lets a
 * second tab overwrite the first flow; when either callback clears it, the
 * other callback arrives as `missing_state_cookie`. The nonce-derived suffix
 * keeps each browser-bound state independent without exposing the nonce.
 *
 * `STATE_COOKIE` remains a callback-only fallback during rolling deploys so
 * consent screens opened by the previous revision can still finish.
 */
export const STATE_COOKIE_PREFIX = `${STATE_COOKIE}_`;
/** Cookie path — scoped to the connect routes only. */
export const STATE_COOKIE_PATH = '/api/auth/google';

const OAUTH_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/** Deterministic, cookie-name-safe identity for one OAuth nonce. */
export function stateCookieName(state: unknown): string | null {
  if (typeof state !== 'string' || !OAUTH_NONCE_PATTERN.test(state)) return null;

  // The source nonce has 256 bits of entropy. A truncated SHA-256 suffix keeps
  // the cookie name fixed-width without revealing or logging the nonce.
  const suffix = createHash('sha256').update(state, 'utf8').digest('hex').slice(0, 16);
  return `${STATE_COOKIE_PREFIX}${suffix}`;
}

/** Privacy-safe correlation value for start/callback security events. */
export function oauthFlowId(state: unknown): string | null {
  return stateCookieName(state)?.slice(STATE_COOKIE_PREFIX.length) ?? null;
}

/**
 * Accept the single public-to-product destination supported at launch.
 * The returned path is canonical so OAuth state never carries arbitrary
 * hosts, fragments, duplicate parameters, or future unreviewed routes.
 */
export function parseBillingReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#')
  ) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value, 'https://declutrmail.invalid');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://declutrmail.invalid' || url.pathname !== '/billing') {
    return undefined;
  }

  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !['plan', 'cycle', 'promo'].includes(key))) return undefined;
  if (new Set(keys).size !== keys.length) return undefined;

  const plan = url.searchParams.get('plan');
  const cycle = url.searchParams.get('cycle');
  const promo = url.searchParams.get('promo');
  if ((plan !== 'plus' && plan !== 'pro') || (cycle !== 'monthly' && cycle !== 'annual')) {
    return undefined;
  }
  if (promo !== null && promo !== 'foundingPro') return undefined;
  if (promo === 'foundingPro' && (plan !== 'pro' || cycle !== 'annual')) return undefined;

  const query = new URLSearchParams({ plan, cycle });
  if (promo === 'foundingPro') query.set('promo', promo);
  return `/billing?${query.toString()}`;
}
