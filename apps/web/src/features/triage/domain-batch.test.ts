// Tests for the domain-batch grouping helpers (D37, D32, D222).
//
// These pure helpers decide when a "decide together?" card replaces a
// run of rows. What this file locks in:
//
//   - a batch is ≥3 CONSECUTIVE rows sharing a REGISTRABLE domain
//     (D222 — literal sender domain, never a predicted category)
//   - runs never overlap; a row belongs to at most one batch
//   - dismissed domains fall back to per-row flow
//   - subdomains collapse to eTLD+1 (mail.amazon.com → amazon.com),
//     including the common second-level suffixes (bbc.co.uk)
//   - `planQueueItems` interleaves single rows and batch cards in queue
//     order with no index drift

import { describe, expect, it } from 'vitest';
import type { TriageDecisionRow } from './data';
import { TRIAGE_QUEUE } from './data';
import {
  findDomainBatches,
  MIN_BATCH_RUN,
  planQueueItems,
  registrableDomain,
} from './domain-batch';

/** Minimal row carrying just the fields the grouping reads. */
function row(id: string, senderDomain: string): TriageDecisionRow {
  return { ...TRIAGE_QUEUE[0]!, id, senderId: `sid-${id}`, senderKey: `sk_${id}`, senderDomain };
}

describe('registrableDomain — eTLD+1 collapse', () => {
  it('trims subdomains to the registrable domain', () => {
    expect(registrableDomain('mail.amazon.com')).toBe('amazon.com');
    expect(registrableDomain('amazon.com')).toBe('amazon.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('handles the common second-level suffixes', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('shop.myer.com.au')).toBe('myer.com.au');
  });

  it('lowercases and tolerates trailing/spurious dots', () => {
    expect(registrableDomain('MAIL.Amazon.COM')).toBe('amazon.com');
    expect(registrableDomain('amazon.com.')).toBe('amazon.com');
  });
});

describe('findDomainBatches — consecutive same-domain runs', () => {
  it('groups a run of ≥3 consecutive same-domain rows', () => {
    const rows = [
      row('a', 'amazon.com'),
      row('b', 'mail.amazon.com'),
      row('c', 'orders.amazon.com'),
      row('d', 'linkedin.com'),
    ];
    const batches = findDomainBatches(rows);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.domain).toBe('amazon.com');
    expect(batches[0]!.startIndex).toBe(0);
    expect(batches[0]!.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it(`does not group a run shorter than MIN_BATCH_RUN (${MIN_BATCH_RUN})`, () => {
    const rows = [row('a', 'amazon.com'), row('b', 'amazon.com'), row('c', 'linkedin.com')];
    expect(findDomainBatches(rows)).toHaveLength(0);
  });

  it('only groups CONSECUTIVE rows — a gap breaks the run', () => {
    const rows = [
      row('a', 'amazon.com'),
      row('b', 'amazon.com'),
      row('c', 'linkedin.com'),
      row('d', 'amazon.com'),
    ];
    // Two amazon rows, a linkedin row, then one amazon — no run of 3.
    expect(findDomainBatches(rows)).toHaveLength(0);
  });

  it('finds multiple non-overlapping runs', () => {
    const rows = [
      row('a', 'amazon.com'),
      row('b', 'amazon.com'),
      row('c', 'amazon.com'),
      row('d', 'substack.com'),
      row('e', 'substack.com'),
      row('f', 'substack.com'),
    ];
    const batches = findDomainBatches(rows);
    expect(batches.map((b) => b.domain)).toEqual(['amazon.com', 'substack.com']);
    expect(batches[1]!.startIndex).toBe(3);
  });

  it('skips domains dismissed this session', () => {
    const rows = [row('a', 'amazon.com'), row('b', 'amazon.com'), row('c', 'amazon.com')];
    expect(findDomainBatches(rows, ['amazon.com'])).toHaveLength(0);
  });
});

describe('planQueueItems — interleaved render plan', () => {
  it('interleaves single rows and batch cards in queue order', () => {
    const rows = [
      row('lead', 'nytimes.com'),
      row('a', 'amazon.com'),
      row('b', 'amazon.com'),
      row('c', 'amazon.com'),
      row('tail', 'stripe.com'),
    ];
    const items = planQueueItems(rows);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ kind: 'row', row: rows[0] });
    expect(items[1]!.kind).toBe('batch');
    expect(items[2]).toEqual({ kind: 'row', row: rows[4] });
  });

  it('is all single rows when nothing groups', () => {
    const rows = [row('a', 'a.com'), row('b', 'b.com'), row('c', 'c.com')];
    const items = planQueueItems(rows);
    expect(items.every((i) => i.kind === 'row')).toBe(true);
    expect(items).toHaveLength(3);
  });

  it('returns a dismissed run to per-row items', () => {
    const rows = [row('a', 'amazon.com'), row('b', 'amazon.com'), row('c', 'amazon.com')];
    const items = planQueueItems(rows, ['amazon.com']);
    expect(items.every((i) => i.kind === 'row')).toBe(true);
    expect(items).toHaveLength(3);
  });
});
