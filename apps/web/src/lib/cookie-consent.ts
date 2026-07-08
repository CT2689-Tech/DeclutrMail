/**
 * Cookie-consent persistence (D147).
 *
 * The banner offers exactly two choices — "Accept all" or "Essential
 * only". Essential cookies (sign-in, billing) never require consent;
 * the ONLY thing the stored choice gates is optional product analytics
 * (PostHog, D159 — see `lib/posthog.ts`). No stored choice means the
 * visitor has not consented yet, so analytics stays OFF: decline is
 * the default, exactly as the privacy policy promises ("initialized
 * only after you accept it in the cookie banner; it is off by
 * default").
 *
 * Persistence is deliberately doubled (both written, either read):
 *   - localStorage — D147's stated store
 *   - a mirror cookie — survives localStorage clearing and stays
 *     readable server-side should a future surface want to suppress
 *     the banner during SSR
 *
 * Consent is per-browser BY DESIGN: cookie/analytics consent attaches
 * to the device under ePrivacy, so D147's cross-device
 * `users.preferences.cookie_consent` sync is intentionally not part of
 * this module (a synced "all" must never auto-enable tracking on a
 * browser that was not asked).
 */

export type CookieConsent = 'all' | 'essential';

/**
 * Fired on `window` by `storeConsent` so the consent surfaces stay in
 * sync WITHIN a tab: the banner and the preferences card can be mounted
 * at once (e.g. a first visit landing on /cookies or Settings), and a
 * choice made on either must reflect on the other immediately — the
 * `storage` event only fires in OTHER tabs.
 */
export const CONSENT_CHANGE_EVENT = 'dm-cookie-consent-change';

const STORAGE_KEY = 'dm-cookie-consent';
const COOKIE_NAME = 'dm_cookie_consent';
/**
 * 12 months. Applies to the mirror cookie only — localStorage does not
 * expire, so in practice the banner returns only when site data is
 * cleared.
 */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function isCookieConsent(value: string | null | undefined): value is CookieConsent {
  return value === 'all' || value === 'essential';
}

function readConsentCookie(): CookieConsent | null {
  const pair = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = pair?.slice(COOKIE_NAME.length + 1);
  return isCookieConsent(value) ? value : null;
}

/**
 * The visitor's stored choice, or `null` when they have not chosen yet
 * (⇒ show the banner; analytics stays off). Unrecognized values read
 * as `null` — fail closed, never fail into tracking.
 */
export function readStoredConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCookieConsent(stored)) return stored;
  } catch {
    // localStorage can throw (storage disabled, private-mode quota).
    // The mirror cookie below is the designed fallback path.
  }
  return readConsentCookie();
}

/** Persist a choice to both stores. The banner never returns after this. */
export function storeConsent(choice: CookieConsent): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage disabled/full — the cookie write below still persists
    // the choice, and `readStoredConsent` reads either store.
  }
  document.cookie = `${COOKIE_NAME}=${choice}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

/**
 * TRUE only for an explicit "Accept all". This is the single gate
 * `lib/posthog.ts` checks before loading, initializing, or capturing
 * anything (D147).
 */
export function hasAnalyticsConsent(): boolean {
  return readStoredConsent() === 'all';
}
