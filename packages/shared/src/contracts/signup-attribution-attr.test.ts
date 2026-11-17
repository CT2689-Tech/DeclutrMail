import { describe, expect, it } from 'vitest';
import {
  directorySourceFromReferrer,
  organicSourceFromReferrer,
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

describe('search and AI first touch', () => {
  it.each([
    ['https://www.google.com/', 'google', 'organic'],
    ['https://www.google.co.in/search?q=private+query', 'google', 'organic'],
    ['https://google.com.au/', 'google', 'organic'],
    ['https://www.bing.com/search?q=private', 'bing', 'organic'],
    ['https://duckduckgo.com/', 'duckduckgo', 'organic'],
    ['https://search.brave.com/', 'brave', 'organic'],
    ['https://chatgpt.com/', 'chatgpt', 'ai'],
    ['https://www.perplexity.ai/search/abc', 'perplexity', 'ai'],
    ['https://gemini.google.com/app', 'gemini', 'ai'],
  ])('retains only a fixed source for %s', (referrer, source, medium) => {
    expect(capture(referrer, '/vs/clean-email')).toEqual({
      utmSource: source,
      utmMedium: medium,
      landingPath: '/vs/clean-email',
    });
  });
  it.each([
    'https://accounts.google.com/',
    'https://mail.google.com/',
    'https://google.com.attacker.com/',
    'https://notgoogle.com/',
    'https://evil.com/?www.google.com',
    'https://user:pass@www.google.com/',
    'https://declutrmail.com/pricing',
    '',
    // Hostnames that name inherited object members: an object-literal lookup
    // returned a Function or Object here and wrote it into the cookie.
    'http://constructor/',
    'http://__proto__/',
  ])('ignores non-search referrers: %s', (value) => {
    expect(organicSourceFromReferrer(value)).toBeUndefined();
    expect(capture(value)).toBeUndefined();
  });
  it('keeps explicit campaigns ahead of search inference', () => {
    expect(capture('https://www.google.com/', '/', 'utm_source=newsletter')).toEqual({
      utmSource: 'newsletter',
      landingPath: '/',
    });
  });
  it('attributes search-to-demo traffic to the search engine, not the demo', () => {
    expect(capture('https://www.google.com/', '/inbox-simulator')).toEqual({
      utmSource: 'google',
      utmMedium: 'organic',
      landingPath: '/inbox-simulator',
    });
  });
});
