import { describe, expect, it } from 'vitest';

import { TRIAGE_QUEUE } from './data';
import { MIN_BATCH_RUN, findDomainBatches } from './domain-batch';

describe('amazon.com domain batch — Plan 4 step 1', () => {
  const batch = findDomainBatches(TRIAGE_QUEUE).find((b) => b.domain === 'amazon.com');

  it('forms a batch', () => {
    expect(batch).toBeDefined();
  });

  it('carries six senders, four with confident cleanup recommendations', () => {
    expect(batch!.rows.length).toBe(6);
    expect(batch!.eligibleRows.length).toBe(4);
    expect(batch!.eligibleRows.length).toBeGreaterThanOrEqual(MIN_BATCH_RUN);
  });

  it('excludes the protected sender from the actionable set', () => {
    const protectedRows = batch!.rows.filter((r) => r.protectionReason !== null);
    expect(protectedRows.length).toBe(1);
    expect(batch!.eligibleRows).not.toContainEqual(protectedRows[0]);
  });

  it('leaves the new, low-signal order sender for individual review', () => {
    const uncertain = batch!.rows.find((r) => r.id === 't-amazon-orders');
    expect(uncertain?.verdict).toBe('later');
    expect(batch!.eligibleRows).not.toContainEqual(uncertain);
  });

  it('shows the engine disagreeing — the batch is not one verdict repeated', () => {
    const verdicts = new Set(batch!.eligibleRows.map((r) => r.verdict));
    expect(verdicts.size).toBeGreaterThan(1);
  });
});
