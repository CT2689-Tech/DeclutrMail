// DomainBatchCard count truth (D245 + D226 — 2026-07-26 finding 5.4).
//
// The card's headline, the sheet's preview set, and the enqueue payload
// must all read ONE eligibility set (`batch.eligibleRows`). Constructing
// through `findDomainBatches` pins the real production path: a run whose
// protected rows leave <MIN_BATCH_RUN actionable senders produces no
// batch at all, so the card can never offer a set the bulk flow rejects.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TriageDecisionRow } from './data';
import { TRIAGE_QUEUE } from './data';
import { DomainBatchCard } from './domain-batch-card';
import { findDomainBatches } from './domain-batch';

function row(
  id: string,
  protectionReason: TriageDecisionRow['protectionReason'] = null,
): TriageDecisionRow {
  return {
    ...TRIAGE_QUEUE[0]!,
    id,
    senderId: `sid-${id}`,
    senderKey: `sk_${id}`,
    senderDomain: 'amazon.com',
    protectionReason,
  };
}

describe('DomainBatchCard — count reads the eligible set (D245)', () => {
  it('headline counts eligible senders; protected members are named separately', () => {
    const [batch] = findDomainBatches([row('a'), row('b', 'replied'), row('c'), row('d')]);
    expect(batch).toBeDefined();
    render(<DomainBatchCard batch={batch!} onVerb={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/3 senders from amazon\.com — decide together\?/)).toBeInTheDocument();
    expect(screen.getByText(/1 protected sender stay untouched/)).toBeInTheDocument();
  });

  it('a run left with one actionable sender yields no card to render', () => {
    const batches = findDomainBatches([row('a'), row('b', 'replied'), row('c', 'replied')]);
    expect(batches).toHaveLength(0);
  });
});
