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

  it('agreeing stores read straight through', () => {
    document.cookie = `${COOKIE_NAME}=all; Path=/`;
    window.localStorage.setItem(STORAGE_KEY, 'all');
    expect(readStoredConsent()).toBe('all');
    expect(hasAnalyticsConsent()).toBe(true);
  });

  it('a stale localStorage "all" cannot outlive a withdrawal — divergence fails closed', () => {
    // `storeConsent` swallows a rejected `localStorage.setItem` (quota /
    // private mode) and still writes the cookie, so after "Essential only"
    // the two stores can disagree with localStorage holding the OLD "all".
    // Preferring localStorage here would leave analytics running against
    // the visitor's stated choice.
    document.cookie = `${COOKIE_NAME}=essential; Path=/`;
    window.localStorage.setItem(STORAGE_KEY, 'all');

    expect(readStoredConsent()).toBe('essential');
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('divergence fails closed in the other direction too', () => {
    // A failed localStorage write of "all" is the mirror case. Treating the
    // visitor as declined is the safe way to be wrong.
    document.cookie = `${COOKIE_NAME}=all; Path=/`;
    window.localStorage.setItem(STORAGE_KEY, 'essential');

    expect(readStoredConsent()).toBe('essential');
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('a withdrawal survives localStorage refusing the write', () => {
    // Storage that still READS the old "all" but rejects every write — the
    // quota / private-mode case `storeConsent` swallows. Swapped wholesale
    // rather than spied: happy-dom's localStorage is Proxy-backed, so both
    // assigning `.setItem` and spying on `Storage.prototype` leave the real
    // write working and this test would pass vacuously.
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key === STORAGE_KEY ? 'all' : null),
        setItem: () => {
          throw new DOMException('QuotaExceededError');
        },
        removeItem: () => undefined,
      },
    });

    try {
      storeConsent('essential');

      // The cookie took the write even though localStorage refused it...
      expect(document.cookie).toContain(`${COOKIE_NAME}=essential`);
      // ...and the stale "all" still readable in localStorage must not win.
      expect(readStoredConsent()).toBe('essential');
      expect(hasAnalyticsConsent()).toBe(false);
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
    }
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
