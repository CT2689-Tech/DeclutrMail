import { describe, expect, it } from 'vitest';

import { registrableDomain, rollupByDomain } from './domain-rollup';
import type { Sender } from './data';

function sender(overrides: Partial<Sender> & { id: string; domain: string }): Sender {
  return {
    name: overrides.id,
    monthly: 10,
    group: 'promotions',
    read: 0.1,
    spark: [1, 2, 3, 4],
    lastDays: 3,
    unread: 0,
    firstSeenMo: 12,
    total: 100,
    ...overrides,
  };
}

describe('registrableDomain (eTLD+1, pragmatic suffix list)', () => {
  it('strips subdomains down to the registrable domain', () => {
    expect(registrableDomain('mail.google.com')).toBe('google.com');
    expect(registrableDomain('a.b.c.amazon.com')).toBe('amazon.com');
    expect(registrableDomain('github.com')).toBe('github.com');
  });

  it('keeps three labels for known multi-part public suffixes', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('shop.myer.com.au')).toBe('myer.com.au');
    expect(registrableDomain('mail.irctc.co.in')).toBe('irctc.co.in');
    expect(registrableDomain('alerts.hmrc.gov.uk')).toBe('hmrc.gov.uk');
  });

  it('lowercases, trims, and tolerates degenerate inputs', () => {
    expect(registrableDomain('Mail.GOOGLE.com')).toBe('google.com');
    expect(registrableDomain('google.com.')).toBe('google.com');
    expect(registrableDomain('localhost')).toBe('localhost');
    expect(registrableDomain('')).toBe('');
  });

  it('documented limitation: unknown multi-part suffixes fall back to two labels', () => {
    // Not on the pragmatic list — falls back to last-two-labels.
    expect(registrableDomain('example.pvt.k12.ma.us')).toBe('ma.us');
  });
});

describe('rollupByDomain', () => {
  it('groups >= 3 senders sharing a registrable domain into one entry at first-member position', () => {
    const list = [
      sender({ id: 'a1', domain: 'mail.amazon.com', monthly: 5, total: 100 }),
      sender({ id: 'x', domain: 'x.com' }),
      sender({ id: 'a2', domain: 'marketing.amazon.com', monthly: 7, total: 200 }),
      sender({ id: 'a3', domain: 'amazon.com', monthly: 1, total: 50 }),
    ];
    const entries = rollupByDomain(list);
    expect(entries.map((e) => e.kind)).toEqual(['group', 'sender']);
    const group = entries[0]!;
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.domain).toBe('amazon.com');
    expect(group.senderCount).toBe(3);
    expect(group.senders.map((s) => s.id)).toEqual(['a1', 'a2', 'a3']);
    expect(group.volume30d).toBe(13);
    expect(group.totalReceived).toBe(350);
  });

  it('passes 1-2 sender domains through in order, ungrouped', () => {
    const list = [
      sender({ id: 'a', domain: 'a.com' }),
      sender({ id: 'b1', domain: 'b.com' }),
      sender({ id: 'b2', domain: 'mail.b.com' }),
    ];
    const entries = rollupByDomain(list);
    expect(entries.map((e) => e.kind)).toEqual(['sender', 'sender', 'sender']);
    expect(entries.map((e) => (e.kind === 'sender' ? e.sender.id : 'group'))).toEqual([
      'a',
      'b1',
      'b2',
    ]);
  });

  it('honors a custom minGroupSize', () => {
    const list = [
      sender({ id: 'b1', domain: 'b.com' }),
      sender({ id: 'b2', domain: 'mail.b.com' }),
    ];
    const entries = rollupByDomain(list, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('group');
  });

  it('sums missing lifetime totals as 0 rather than NaN', () => {
    const list = [
      // Malformed runtime rows whose `total` is missing (the rollup
      // guards `?? 0`); the cast stages a state the `Sender` type
      // forbids at compile time.
      sender({ id: 'c1', domain: 'c.com', total: undefined as unknown as number }),
      sender({ id: 'c2', domain: 'c.com', total: 10 }),
      sender({ id: 'c3', domain: 'c.com', total: undefined as unknown as number }),
    ];
    const entries = rollupByDomain(list);
    const group = entries[0]!;
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.totalReceived).toBe(10);
  });

  it('never groups empty domains together', () => {
    const list = [
      sender({ id: 'e1', domain: '' }),
      sender({ id: 'e2', domain: '' }),
      sender({ id: 'e3', domain: '' }),
    ];
    const entries = rollupByDomain(list);
    expect(entries.map((e) => e.kind)).toEqual(['sender', 'sender', 'sender']);
  });
});
