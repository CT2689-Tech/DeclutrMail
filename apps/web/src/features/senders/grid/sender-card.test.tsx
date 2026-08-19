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

// The peek mounts TanStack queries; stub it so card tests stay
// unit-scoped. The backdrop deliberately does NOT stop propagation —
// the real SenderPeek portals to <body> but React events still bubble
// the REACT tree into the card, which is exactly the path the
// backdrop-reopen regression rode (Codex review 2026-07-28).
vi.mock('./sender-peek', () => ({
  SenderPeek: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="peek-stub">
      <div data-testid="peek-backdrop" onClick={onClose} />
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

  it('backdrop dismissal sticks — the closing click must not reopen through the card', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('sender-card-sender-1'));
    expect(screen.getByRole('dialog', { name: 'peek-stub' })).toBeInTheDocument();

    // The backdrop click closes the peek AND bubbles into the card's
    // whole-card opener (portal events bubble the React tree). The
    // card must treat "was open when the click started" as ignore.
    fireEvent.click(screen.getByTestId('peek-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'peek-stub' })).not.toBeInTheDocument();
  });

  it('still opens from the identity button (the accessible opener)', () => {
    renderCard();
    // Accessible name = display name + the address line (2026-08-19);
    // it was name + domain before the card started rendering addresses.
    fireEvent.click(screen.getByRole('button', { name: /acme newsletter news@acme\.com/i }));
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

/**
 * Identity line (2026-08-19 founder smoke — "why 2 redfin results?").
 *
 * Senders are keyed by ADDRESS, so one brand legitimately owns several
 * rows. The card used to render only the domain, which made those rows
 * pixel-identical and read as a duplicate bug.
 */
describe('SenderCard — identity line renders the address', () => {
  it('shows the full address, not just the domain', () => {
    renderCard({ displayName: 'Redfin', email: 'listings@redfin.com', domain: 'redfin.com' });
    expect(screen.getByText('listings@redfin.com')).toBeInTheDocument();
  });

  it('distinguishes two senders sharing a display name and domain', () => {
    const shared = { displayName: 'Redfin', domain: 'redfin.com' };
    renderCard({ ...shared, id: 'sender-1', email: 'listings@redfin.com' });
    renderCard({ ...shared, id: 'sender-2', email: 'no-reply@redfin.com' });
    expect(screen.getByText('listings@redfin.com')).toBeInTheDocument();
    expect(screen.getByText('no-reply@redfin.com')).toBeInTheDocument();
  });

  it('falls back to the domain when there is no display name — never the address twice', () => {
    renderCard({ displayName: '', email: 'bare@redfin.com', domain: 'redfin.com' });
    // The name line already IS the address; the line below must not repeat it.
    expect(screen.getAllByText('bare@redfin.com')).toHaveLength(1);
    expect(screen.getByText('redfin.com')).toBeInTheDocument();
  });
});
