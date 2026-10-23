import { describe, expect, it } from 'vitest';
import {
  isUserScopedAppPath,
  parseAppReturnTo,
  parseBillingReturnTo,
  parseUpgradeReturnTo,
} from './app-navigation';

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
  it('preserves the one-time Pass choice through login and onboarding recovery', () => {
    const path = '/billing?plan=plus&cycle=annual&offer=pass_onetime';
    expect(parseAppReturnTo(path)).toBe(path);
    expect(parseBillingReturnTo(path)).toBe(path);
    expect(parseAppReturnTo(`${path}&from=%2Fsenders`)).toBe(`${path}&from=%2Fsenders`);
  });
  it.each([
    '/billing?plan=plus&cycle=annual&offer=unknown',
    '/billing?plan=pro&cycle=annual&offer=pass_onetime',
    '/billing?plan=plus&cycle=monthly&offer=pass_onetime',
    '/billing?offer=pass_onetime',
    '/billing?plan=plus&cycle=annual&offer=pass_onetime&offer=pass_onetime',
  ])('rejects invalid or conflicting one-time offer intent: %s', (path) => {
    expect(parseAppReturnTo(path)).toBeUndefined();
  });
  it('keeps a Paddle transaction id on billing', () => {
    expect(parseAppReturnTo('/billing?_ptxn=txn_test')).toBe('/billing?_ptxn=txn_test');
    expect(parseAppReturnTo('/billing?_ptxn=TXN_01ABCDEFGHIJKLMNOPQRSTUVWX')).toBe(
      '/billing?_ptxn=TXN_01ABCDEFGHIJKLMNOPQRSTUVWX',
    );
    expect(parseBillingReturnTo('/billing?_ptxn=txn_01abcdefghijklmnopqrstuvwx')).toBe(
      '/billing?_ptxn=txn_01abcdefghijklmnopqrstuvwx',
    );
  });
  it('keeps /billing after stripping unknown query keys', () => {
    expect(parseAppReturnTo('/billing?utm_source=paddle&a=1%202')).toBe('/billing');
    expect(parseAppReturnTo('/billing?_ptxn=txn_test&utm_source=x')).toBe(
      '/billing?_ptxn=txn_test',
    );
  });
  it('strips a malformed _ptxn and still returns /billing', () => {
    expect(parseAppReturnTo('/billing?_ptxn=not-a-txn')).toBe('/billing');
    expect(parseAppReturnTo('/billing?_ptxn=txn_bad-id')).toBe('/billing');
    expect(parseAppReturnTo('/billing?_ptxn=javascript%3Aalert(1)')).toBe('/billing');
    expect(parseAppReturnTo(`/billing?_ptxn=txn_${'a'.repeat(64)}`)).toBe('/billing');
    expect(parseBillingReturnTo('/billing?_ptxn=not-a-txn')).toBe('/billing');
  });
  it('exempts account controls, while keeping sender policies gated', () => {
    for (const path of ['/settings', '/settings/privacy', '/settings/help', '/billing'])
      expect(isUserScopedAppPath(path)).toBe(true);
    expect(isUserScopedAppPath('/settings/senders')).toBe(false);
  });
});

it.each([
  '/settings',
  'https://evil.test/billing',
  '/billing-evil',
  '/billing?from=https%3A%2F%2Fevil.test',
])('rejects non-Billing or unsafe recovery destinations: %s', (value) => {
  const result = parseBillingReturnTo(value);
  // The existing destination parser rejects unsafe nested origins.
  expect(result).toBeUndefined();
});
it('retains the selected plan, cycle, promotion and validated app origin', () => {
  const value = '/billing?plan=pro&cycle=annual&promo=foundingPro&from=%2Fbrief';
  expect(parseBillingReturnTo(value)).toBe(value);
});
