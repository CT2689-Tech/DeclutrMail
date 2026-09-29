/**
 * Browser-facing pieces shared by the Google OAuth routes and their exit
 * filters (D108). Their own module so a filter can use them without
 * importing the controller that applies it.
 */

/** Cookie carrying the OAuth state — nonce + post-callback intent. */
export const STATE_COOKIE = 'oauth_state';
/** Cookie path — scoped to the connect routes only. */
export const STATE_COOKIE_PATH = '/api/auth/google';

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
