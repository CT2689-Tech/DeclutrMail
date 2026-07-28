/**
 * SenderCard — grid affordance + face-fact tests (launch-audit grid
 * pass, 2026-07-28).
 *
 * The card is the DEFAULT view's unit (D49) and the only per-sender
 * surface a phone gets, so its peek affordance must not be hover-only:
 * the whole card body opens the peek (pointer convenience mirroring
 * the table's whole-row expand), while checkbox / verbs / links keep
 * their own clicks. The face also carries the "in inbox" count when
 * the wire provides it — the one number that predicts whether a verb
 * is a no-op (ADR-0028 companion).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeSender } from '../testing/make-sender';
import type { ActionRequest } from '../data';
import { SenderCard } from './sender-card';

// The peek mounts TanStack queries; stub it so card tests stay unit-scoped.
vi.mock('./sender-peek', () => ({
  SenderPeek: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="peek-stub">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

function renderCard(overrides: Parameters<typeof makeSender>[0] = {}) {
  const onToggleSelect = vi.fn();
  const onAction = vi.fn<(req: ActionRequest) => void>();
  const sender = makeSender(overrides);
  render(
    <SenderCard
      sender={sender}
      selected={false}
      onToggleSelect={onToggleSelect}
      onAction={onAction}
      globalMaxTotal={500}
    />,
  );
  return { sender, onToggleSelect, onAction };
}

describe('SenderCard — peek reachability (grid↔table parity)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the peek from a plain card-body click (touch has no hover)', () => {
    renderCard();
    // The card body — click the article itself, not any control.
    const card = screen.getByTestId('sender-card-sender-1');
    fireEvent.click(card);
    expect(screen.getByRole('dialog', { name: 'peek-stub' })).toBeInTheDocument();
  });

  it('does NOT open the peek from the selection checkbox', () => {
    const { onToggleSelect } = renderCard();
    fireEvent.click(screen.getByRole('checkbox', { name: /select acme newsletter/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onToggleSelect).toHaveBeenCalledWith('sender-1', false);
  });

  it('does NOT open the peek from a verb button', () => {
    const { onAction } = renderCard();
    // The primary verb button lives in the shared SenderActionRow.
    const buttons = screen.getAllByRole('button');
    const verbButton = buttons.find((b) =>
      /archive|unsubscribe|keep|later|delete/i.test(b.textContent ?? ''),
    );
    expect(verbButton).toBeDefined();
    fireEvent.click(verbButton!);
    expect(screen.queryByRole('dialog', { name: 'peek-stub' })).not.toBeInTheDocument();
    expect(onAction).toHaveBeenCalled();
  });

  it('still opens from the identity button (the accessible opener)', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /acme newsletter acme\.com/i }));
    expect(screen.getByRole('dialog', { name: 'peek-stub' })).toBeInTheDocument();
  });
});

describe('SenderCard — in-inbox fact on the card face', () => {
  it('renders "N in inbox" beside the received count when the wire provides it', () => {
    renderCard({ inboxCount: 3 });
    expect(screen.getByText(/144 received · 3 in inbox/)).toBeInTheDocument();
  });

  it('renders a 0 honestly — the no-op predictor must be visible', () => {
    renderCard({ inboxCount: 0 });
    expect(screen.getByText(/144 received · 0 in inbox/)).toBeInTheDocument();
  });

  it('omits the segment entirely when the wire does not carry it — never a fabricated 0', () => {
    // Default fixture row carries no inboxCount — the absent-on-wire case.
    renderCard();
    expect(screen.getByText(/144 received/)).toBeInTheDocument();
    expect(screen.queryByText(/in inbox/)).not.toBeInTheDocument();
  });
});
