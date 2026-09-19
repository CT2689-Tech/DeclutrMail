import { describe, expect, it } from 'vitest';

import { isCountedHost, scrubAnalyticsUrl } from './site-analytics';

describe('scrubAnalyticsUrl', () => {
  it('keeps campaign attribution and the signup ref', () => {
    expect(
      scrubAnalyticsUrl(
        'https://declutrmail.com/vs/meta-muse?utm_source=reddit&utm_campaign=muse&ref=ph',
      ),
    ).toBe('https://declutrmail.com/vs/meta-muse?utm_source=reddit&utm_campaign=muse&ref=ph');
  });

  it('drops every other parameter and the fragment', () => {
    expect(
      scrubAnalyticsUrl(
        'https://declutrmail.com/sign-in?error=access_denied&next=%2Fsenders&email=a%40b.co&utm_medium=social#top',
      ),
    ).toBe('https://declutrmail.com/sign-in?utm_medium=social');
  });

  it('does not keep a parameter that merely starts with an allowed name', () => {
    expect(scrubAnalyticsUrl('https://declutrmail.com/?ref_token=secret&utm_sourcex=1')).toBe(
      'https://declutrmail.com/',
    );
  });

  it('keeps ref only when it is a known campaign value', () => {
    expect(scrubAnalyticsUrl('https://declutrmail.com/?ref=a%40b.co')).toBe(
      'https://declutrmail.com/',
    );
    expect(scrubAnalyticsUrl('https://declutrmail.com/?ref=reddit')).toBe(
      'https://declutrmail.com/?ref=reddit',
    );
  });

  it('drops every signed-in app path, because the app shares the counted host', () => {
    for (const path of ['/senders', '/senders/abc123', '/settings', '/triage', '/activity']) {
      expect(scrubAnalyticsUrl(`https://declutrmail.com${path}`), path).toBeNull();
    }
    // A public path that merely starts like an app path is still counted.
    expect(scrubAnalyticsUrl('https://declutrmail.com/settings-guide')).toBe(
      'https://declutrmail.com/settings-guide',
    );
  });

  it('fails closed on a URL it cannot parse', () => {
    expect(scrubAnalyticsUrl('not a url')).toBeNull();
  });
});

describe('isCountedHost', () => {
  it('counts only the public production hosts', () => {
    expect(isCountedHost('declutrmail.com')).toBe(true);
    expect(isCountedHost('www.declutrmail.com')).toBe(true);
  });

  it('never counts the app host, previews, or localhost', () => {
    for (const host of [
      'app.declutrmail.com',
      'localhost',
      'declutr-mail-git-main-chintanathakkar-gmailcoms-projects.vercel.app',
      'evil-declutrmail.com',
      '',
    ]) {
      expect(isCountedHost(host), host).toBe(false);
    }
  });
});
