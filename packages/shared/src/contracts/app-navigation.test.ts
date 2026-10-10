import { describe, expect, it } from 'vitest';
import { isUserScopedAppPath, parseAppReturnTo, parseUpgradeReturnTo } from './app-navigation';

describe('app destinations surviving login', () => {
  it.each([
    '/senders/sender-123',
    '/senders?sender=sender-123&q=news',
    '/settings?cancelDeletion=1',
    '/settings#mailbox-mb-123',
    '/quiet',
    '/brief?date=2026-10-10',
    '/onboarding?mailbox=mb-123&reconnect=1',
  ])('preserves %s', (path) => {
    expect(parseAppReturnTo(path)).toBe(path);
  });
  it.each([
    'https://evil.test/home',
    '//evil.test/home',
    '/\\evil.test/home',
    '/home\n',
    '/unknown',
    '/senders/../home',
    '/senders/%2e%2e/home',
    '/%68ome',
    '/home#settings',
    '/billing?from=%2Fbilling',
    '/billing?from=%2Fhome%3Ffrom%3D%2Fsenders',
    '/billing?plan=plus&cycle=annual&promo=foundingPro',
    '/billing?plan=pro&plan=plus&cycle=annual',
  ])('rejects %s', (path) => {
    expect(parseAppReturnTo(path)).toBeUndefined();
  });
  it('keeps upgrade origin with a canonical billing choice', () => {
    expect(parseAppReturnTo('/billing?cycle=monthly&plan=pro&from=%2Fsenders%3Fsender%3Ds-1')).toBe(
      '/billing?plan=pro&cycle=monthly&from=%2Fsenders%3Fsender%3Ds-1',
    );
    expect(parseUpgradeReturnTo('/billing')).toBeUndefined();
  });
  it('exempts account controls, while keeping sender policies gated', () => {
    for (const path of ['/settings', '/settings/privacy', '/settings/help', '/billing'])
      expect(isUserScopedAppPath(path)).toBe(true);
    expect(isUserScopedAppPath('/settings/senders')).toBe(false);
  });
});
