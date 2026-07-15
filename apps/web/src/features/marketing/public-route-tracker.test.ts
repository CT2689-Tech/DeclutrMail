import { describe, expect, it } from 'vitest';

import { publicPageForPath } from './public-route-tracker';

describe('publicPageForPath', () => {
  it.each([
    ['/', 'landing'],
    ['/how-it-works', 'how_it_works'],
    ['/methodology', 'methodology'],
    ['/compare', 'compare'],
    ['/vs/gmail-filters', 'comparison'],
    ['/how-to/clean-gmail-by-sender', 'how_to'],
    ['/answers/is-it-safe-to-connect-gmail-app', 'answer'],
    ['/blog', 'blog'],
    ['/blog/reversible-does-not-mean-risk-free', 'blog'],
    ['/changelog', 'changelog'],
    ['/faq', 'faq'],
    ['/sign-in', 'sign_in'],
  ] as const)('maps %s to %s', (path, page) => {
    expect(publicPageForPath(path)).toBe(page);
  });

  it('defers routes that already emit their own page view', () => {
    for (const path of [null, '/pricing', '/privacy', '/help', '/inbox-simulator']) {
      expect(publicPageForPath(path)).toBeNull();
    }
  });
});
