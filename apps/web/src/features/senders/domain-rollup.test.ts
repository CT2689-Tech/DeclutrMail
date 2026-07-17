import { describe, expect, it } from 'vitest';

import { registrableDomain, rollupByDomain } from './domain-rollup';
import type { Sender } from './data';
import { makeSender } from './testing/make-sender';

function sender(overrides: Partial<Sender> & { id: string; domain: string }): Sender {
  return makeSender({
    displayName: overrides.id,
    monthlyVolume: 10,
    totalReceived: 100,
    ...overrides,
  });
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
      sender({ id: 'a1', domain: 'mail.amazon.com', monthlyVolume: 5, totalReceived: 100 }),
      sender({ id: 'x', domain: 'x.com' }),
      sender({ id: 'a2', domain: 'marketing.amazon.com', monthlyVolume: 7, totalReceived: 200 }),
      sender({ id: 'a3', domain: 'amazon.com', monthlyVolume: 1, totalReceived: 50 }),
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

  // Intent updated with the wire unification: `totalReceived` is now a
  // required wire field (no missing-total state to guard), while
  // `monthlyVolume` is nullable ("no timeseries yet") — the rollup must
  // sum the null cadence as 0, never NaN.
  it('sums a null monthlyVolume as 0 rather than NaN', () => {
    const list = [
      sender({ id: 'c1', domain: 'c.com', monthlyVolume: null }),
      sender({ id: 'c2', domain: 'c.com', monthlyVolume: 10 }),
      sender({ id: 'c3', domain: 'c.com', monthlyVolume: null }),
    ];
    const entries = rollupByDomain(list);
    const group = entries[0]!;
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.volume30d).toBe(10);
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

  it('never groups consumer mail providers — 13 humans at gmail.com are not a brand', () => {
    const list = [
      sender({ id: 'g1', domain: 'gmail.com' }),
      sender({ id: 'g2', domain: 'gmail.com' }),
      sender({ id: 'g3', domain: 'gmail.com' }),
      sender({ id: 'g4', domain: 'googlemail.com' }),
      sender({ id: 'o1', domain: 'outlook.com' }),
      sender({ id: 'o2', domain: 'outlook.com' }),
      sender({ id: 'o3', domain: 'outlook.com' }),
    ];
    const entries = rollupByDomain(list);
    expect(entries.every((e) => e.kind === 'sender')).toBe(true);
  });

  it('excludes replied-to senders from groups without swallowing their row', () => {
    const list = [
      sender({ id: 'r1', domain: 'brand.com', repliedCount: 4 }),
      sender({ id: 'b1', domain: 'brand.com' }),
      sender({ id: 'b2', domain: 'mail.brand.com' }),
      sender({ id: 'b3', domain: 'news.brand.com' }),
    ];
    const entries = rollupByDomain(list);
    // r1 emits as its own row; b1–b3 still form the brand group.
    const standalone = entries.filter((e) => e.kind === 'sender');
    const groups = entries.filter((e) => e.kind === 'group');
    expect(standalone.map((e) => (e.kind === 'sender' ? e.sender.id : ''))).toEqual(['r1']);
    expect(groups).toHaveLength(1);
    if (groups[0]!.kind !== 'group') throw new Error('expected group');
    expect(groups[0]!.senders.map((s) => s.id).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('drops the group entirely when replied-to exclusions push it under minGroupSize', () => {
    const list = [
      sender({ id: 'r1', domain: 'brand.com', repliedCount: 1 }),
      sender({ id: 'b1', domain: 'brand.com' }),
      sender({ id: 'b2', domain: 'brand.com' }),
    ];
    const entries = rollupByDomain(list);
    expect(entries.every((e) => e.kind === 'sender')).toBe(true);
  });
});
