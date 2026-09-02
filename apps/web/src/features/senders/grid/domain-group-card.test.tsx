/**
 * DomainGroupCard — naming + verbosity fixes (QA-senders-20260901-05/-06).
 *
 * The card called itself "brand group" while the component, the file,
 * and a sibling filter chip all say "domain" — one grouping, two names.
 * Its stat strip also repeated the sender-count pill and the 90d-volume
 * line verbatim, with "received" the only fact not shown elsewhere.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DomainGroupCard } from './domain-group-card';

function renderCard() {
  render(
    <DomainGroupCard
      domain="homeaway.com"
      senderCount={4}
      volume90d={0}
      totalReceived={12}
      expanded={false}
      onToggleExpand={vi.fn()}
    />,
  );
}

describe('DomainGroupCard', () => {
  it('names itself a "domain group", not a "brand group"', () => {
    renderCard();

    expect(screen.getByText('domain group')).toBeInTheDocument();
    expect(screen.queryByText('brand group')).toBeNull();
  });

  it('states the received total once, inline, instead of a repeated 3-cell stat grid', () => {
    renderCard();

    // The 90d-volume line now carries "received" inline...
    expect(screen.getByText(/12 received/)).toBeInTheDocument();
    // ...and the old standalone "Senders" / "90d volume" stat cells
    // (which just repeated the pill above and this same line) are gone.
    expect(screen.queryByText('Senders')).toBeNull();
    expect(screen.queryByText('90d volume')).toBeNull();
  });
});
