import { beforeEach, describe, expect, it } from 'vitest';

import {
  attributionSource,
  captureAttribution,
  parseAttribution,
  readAttribution,
} from './attribution';
import { storeConsent } from './cookie-consent';

const CONSENT_STORAGE_KEY = 'dm-cookie-consent';
const CONSENT_COOKIE = 'dm_cookie_consent';
const ATTRIBUTION_COOKIE = 'dm_attribution';

function clearAll(): void {
  window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
  document.cookie = `${ATTRIBUTION_COOKIE}=; Max-Age=0; Path=/`;
}

/** happy-dom exposes a settable `location`; keep each case self-contained. */
function visit(search: string, referrer = ''): void {
  window.history.replaceState({}, '', `/${search}`);
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true });
}

describe('parseAttribution', () => {
  it('reads utm_source and the optional utm_* dimensions', () => {
    const result = parseAttribution(
      '?utm_source=reddit&utm_medium=social&utm_campaign=launch&utm_content=comment&utm_term=gmail',
      '',
      'declutrmail.com',
    );
    expect(result).toEqual({
      source: 'reddit',
      medium: 'social',
      campaign: 'launch',
      content: 'comment',
      term: 'gmail',
    });
  });

  it('honours a bare ?ref= when utm_source is absent', () => {
    expect(parseAttribution('?ref=producthunt', '', 'declutrmail.com')).toEqual({
      source: 'producthunt',
    });
  });

  it('falls back to the referrer host, stripping www.', () => {
    expect(parseAttribution('', 'https://www.reddit.com/r/gmail', 'declutrmail.com')).toEqual({
      source: 'reddit.com',
    });
  });

  it('prefers utm_source over ref, and ref over the referrer', () => {
    expect(
      parseAttribution('?utm_source=newsletter&ref=producthunt', 'https://reddit.com', 'x.com')
        ?.source,
    ).toBe('newsletter');
    expect(parseAttribution('?ref=producthunt', 'https://reddit.com', 'x.com')?.source).toBe(
      'producthunt',
    );
  });

  it('returns null for a same-site referrer — internal navigation is not a channel', () => {
    expect(parseAttribution('', 'https://declutrmail.com/pricing', 'declutrmail.com')).toBeNull();
    expect(
      parseAttribution('', 'https://www.declutrmail.com/pricing', 'declutrmail.com'),
    ).toBeNull();
  });

  it('returns null for a direct visit rather than inventing "direct"', () => {
    expect(parseAttribution('', '', 'declutrmail.com')).toBeNull();
  });

  it.each([
    ['whitespace', '?utm_source=two%20words'],
    ['markup', '?utm_source=%3Cscript%3E'],
    ['the composing colon', '?utm_source=a%3Ab'],
    ['a leading symbol', '?utm_source=-reddit'],
    ['over 64 chars', `?utm_source=${'a'.repeat(65)}`],
  ])('drops a source containing %s rather than repairing it', (_label, search) => {
    expect(parseAttribution(search, '', 'declutrmail.com')).toBeNull();
  });

  it('drops only the offending dimension, keeping a valid source', () => {
    const result = parseAttribution(
      '?utm_source=reddit&utm_medium=two%20words&utm_campaign=launch',
      '',
      'declutrmail.com',
    );
    expect(result).toEqual({ source: 'reddit', campaign: 'launch' });
  });

  it('lowercases and trims before matching', () => {
    expect(parseAttribution('?utm_source=%20Reddit%20', '', 'declutrmail.com')?.source).toBe(
      'reddit',
    );
  });
});

describe('captureAttribution — consent gate (D147)', () => {
  beforeEach(clearAll);

  it('writes nothing without consent', () => {
    visit('?utm_source=reddit');
    expect(captureAttribution()).toBeNull();
    expect(document.cookie).not.toContain(ATTRIBUTION_COOKIE);
    expect(readAttribution()).toBeNull();
  });

  it('writes nothing on "Essential only"', () => {
    storeConsent('essential');
    visit('?utm_source=reddit');
    expect(captureAttribution()).toBeNull();
    expect(document.cookie).not.toContain(ATTRIBUTION_COOKIE);
  });

  it('captures after an explicit "Accept all"', () => {
    storeConsent('all');
    visit('?utm_source=reddit&utm_campaign=launch');
    expect(captureAttribution()).toEqual({ source: 'reddit', campaign: 'launch' });
    expect(readAttribution()).toEqual({ source: 'reddit', campaign: 'launch' });
  });
});

describe('captureAttribution — first touch wins', () => {
  beforeEach(() => {
    clearAll();
    storeConsent('all');
  });

  it('does not overwrite an existing record on a later visit', () => {
    visit('?utm_source=reddit');
    captureAttribution();

    visit('?utm_source=twitter');
    expect(captureAttribution()).toEqual({ source: 'reddit' });
    expect(readAttribution()).toEqual({ source: 'reddit' });
  });

  it('returns the record already in force when the new visit has no signal', () => {
    visit('?utm_source=reddit');
    captureAttribution();

    visit('');
    expect(captureAttribution()).toEqual({ source: 'reddit' });
  });
});

describe('readAttribution — re-validates the client-writable cookie', () => {
  beforeEach(() => {
    clearAll();
    storeConsent('all');
  });

  it('rejects a hand-written cookie whose source is not a slug', () => {
    document.cookie = `${ATTRIBUTION_COOKIE}=${encodeURIComponent(
      JSON.stringify({ source: '<script>' }),
    )}; Path=/`;
    expect(readAttribution()).toBeNull();
  });

  it('rejects malformed JSON', () => {
    document.cookie = `${ATTRIBUTION_COOKIE}=not-json; Path=/`;
    expect(readAttribution()).toBeNull();
  });

  it('drops an invalid dimension while keeping a valid source', () => {
    document.cookie = `${ATTRIBUTION_COOKIE}=${encodeURIComponent(
      JSON.stringify({ source: 'reddit', medium: 'two words' }),
    )}; Path=/`;
    expect(readAttribution()).toEqual({ source: 'reddit' });
  });
});

describe('attributionSource', () => {
  beforeEach(() => {
    clearAll();
    storeConsent('all');
  });

  it('returns the bare surface when nothing is attributed', () => {
    expect(attributionSource('pricing')).toBe('pricing');
  });

  it('composes surface:channel when a first touch exists', () => {
    visit('?utm_source=reddit');
    captureAttribution();
    expect(attributionSource('pricing')).toBe('pricing:reddit');
  });
});
