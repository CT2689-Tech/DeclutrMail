import { describe, expect, it } from 'vitest';
import {
  directorySourceFromReferrer,
  parseDmAttr,
  resolveFirstTouchCampaign,
} from './signup-attribution-attr';

function capture(referrer: string, pathname = '/', query = '') {
  return parseDmAttr(
    resolveFirstTouchCampaign({
      existing: undefined,
      searchParams: new URLSearchParams(query),
      pathname,
      referrer,
    }),
  );
}

describe('directory first touch', () => {
  it.each([
    ['https://alternativeto.net/software/declutrmail/?private=secret', 'alternativeto'],
    ['https://www.saashub.com/', 'saashub'],
  ])('retains only a fixed source for %s', (referrer, source) => {
    expect(capture(referrer)).toEqual({
      utmSource: source,
      utmMedium: 'referral',
      landingPath: '/',
    });
  });
  it.each([
    'https://alternativeto.net.attacker.com/',
    'https://evil.com/?saashub.com',
    'https://accounts.google.com/',
    'https://user:pass@saashub.com/',
    'javascript:saashub.com',
    '/saashub.com',
    '',
  ])('ignores unrelated or malformed referrers: %s', (value) => {
    expect(directorySourceFromReferrer(value)).toBeUndefined();
    expect(capture(value)).toBeUndefined();
  });
  it('keeps direct directory-to-demo traffic attributed to the directory', () => {
    expect(capture('https://saashub.com/', '/inbox-simulator')).toEqual({
      utmSource: 'saashub',
      utmMedium: 'referral',
      landingPath: '/inbox-simulator',
    });
    expect(capture('', '/inbox-simulator')).toEqual({
      ref: 'simulator',
      landingPath: '/inbox-simulator',
    });
  });
  it('keeps explicit campaigns and first-touch cookies ahead of referrer inference', () => {
    expect(
      capture('https://saashub.com/', '/inbox-simulator', 'utm_source=newsletter&utm_medium=email'),
    ).toEqual({ utmSource: 'newsletter', utmMedium: 'email', landingPath: '/inbox-simulator' });
    expect(capture('https://saashub.com/', '/', 'ref=hn')).toEqual({ ref: 'hn', landingPath: '/' });
    expect(
      resolveFirstTouchCampaign({
        existing: 'utm_source=alternativeto&landing=%2F',
        searchParams: new URLSearchParams('ref=simulator'),
        pathname: '/inbox-simulator',
        referrer: 'https://saashub.com/',
      }),
    ).toBeUndefined();
  });
});
