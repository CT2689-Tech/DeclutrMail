import { beforeEach, describe, expect, it } from 'vitest';

import { hasAnalyticsConsent, readStoredConsent, storeConsent } from './cookie-consent';

const STORAGE_KEY = 'dm-cookie-consent';
const COOKIE_NAME = 'dm_cookie_consent';

function clearBothStores(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}

describe('cookie-consent persistence (D147)', () => {
  beforeEach(clearBothStores);

  it('reads null when no choice is stored — decline is the default', () => {
    expect(readStoredConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('storeConsent writes BOTH stores (localStorage + mirror cookie)', () => {
    storeConsent('all');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('all');
    expect(document.cookie).toContain(`${COOKIE_NAME}=all`);
    expect(readStoredConsent()).toBe('all');
  });

  it('falls back to the mirror cookie when localStorage is empty', () => {
    storeConsent('essential');
    window.localStorage.removeItem(STORAGE_KEY);
    expect(readStoredConsent()).toBe('essential');
  });

  it('prefers localStorage over the cookie when both are present', () => {
    document.cookie = `${COOKIE_NAME}=essential; Path=/`;
    window.localStorage.setItem(STORAGE_KEY, 'all');
    expect(readStoredConsent()).toBe('all');
  });

  it('reads unrecognized values as null — fails closed, never into tracking', () => {
    window.localStorage.setItem(STORAGE_KEY, 'yes-please');
    document.cookie = `${COOKIE_NAME}=granted; Path=/`;
    expect(readStoredConsent()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('a garbage localStorage value still falls through to a valid cookie', () => {
    window.localStorage.setItem(STORAGE_KEY, 'garbage');
    document.cookie = `${COOKIE_NAME}=essential; Path=/`;
    expect(readStoredConsent()).toBe('essential');
  });

  it('hasAnalyticsConsent is true ONLY for an explicit "all"', () => {
    storeConsent('essential');
    expect(hasAnalyticsConsent()).toBe(false);
    storeConsent('all');
    expect(hasAnalyticsConsent()).toBe(true);
  });
});
