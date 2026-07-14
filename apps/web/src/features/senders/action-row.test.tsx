// Pins the ADR-0016 A5 verb→tone lock for the lead CTA on the Senders
// list surfaces (card + table row via `SenderActionRow`). Guards the
// drift the design-system-agent flagged on PR #263: Keep rendered
// `dark` (colliding with Archive's tone) and Delete rendered `warn`
// (colliding with Unsubscribe's amber).
//
// Also pins the ADR-0019 fact-rule primary derivation now that the
// `unsub_ready` fact rides the wire (`Sender.unsubscribeMethod`):
// registry rule order (protected → Keep wins), the one_click-only
// reading of unsub-ready (mailto is manual at launch per D230), and
// the capability agreement between the primary CTA and the ⋯ popover.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { derivePrimaryVerbId, leadButtonTone, SenderActionRow } from './action-row';
import type { Sender } from './data';

describe('leadButtonTone — ADR-0016 A5 tone lock', () => {
  it.each([
    ['Keep', 'primary'],
    ['Archive', 'dark'],
    ['Unsubscribe', 'warn'],
    ['Later', 'default'],
    ['Delete', 'danger'],
  ] as const)('%s → %s', (verb, tone) => {
    expect(leadButtonTone(verb)).toBe(tone);
  });
});

/** A noisy, unprotected promotions sender — the archetypal cleanup row. */
function sender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 's1',
    name: 'Acme Deals',
    domain: 'acme.com',
    monthly: 30,
    group: 'promotions',
    read: 0.05,
    spark: [8, 8, 7, 8],
    lastDays: 2,
    unread: 12,
    firstSeenMo: 14,
    ...overrides,
  };
}

describe('derivePrimaryVerbId — ADR-0019 fact-rule primary (D227 verbs)', () => {
  it('derives Unsubscribe for a one-click sender (the wire fact, not a stub)', () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click' }))).toBe('unsubscribe');
  });

  it('protected wins over unsub-ready — registry rule order (D42/D43)', () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click', protected: true }))).toBe(
      'keep',
    );
  });

  it('VIP wins over unsub-ready — VIP rides the same standing-protect input', () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click', isVip: true }))).toBe(
      'keep',
    );
  });

  it("one-click in group 'primary' never derives Unsubscribe — the primary CTA must agree with the popover's canUnsubscribe gate", () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click', group: 'primary' }))).toBe(
      'keep',
    );
  });

  it('mailto is NOT unsub-ready — manual at launch (D230), never auto-recommended', () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'mailto' }))).toBe('keep');
  });

  it('no method + quiet > 180d falls to Archive (fact rule 3)', () => {
    expect(derivePrimaryVerbId(sender({ lastDays: 250 }))).toBe('archive');
  });

  it('no method + recent falls to Keep (fact rule 4)', () => {
    expect(derivePrimaryVerbId(sender())).toBe('keep');
  });

  it('ignores a high-confidence engine verdict when observed facts derive Keep (D245)', () => {
    expect(
      derivePrimaryVerbId(
        sender({
          lastReview: {
            at: '2026-06-01T00:00:00.000Z',
            verdict: 'unsubscribe',
            generatedBy: 'llm_haiku',
            confidence: 0.92,
          },
        }),
      ),
    ).toBe('keep');
  });
});

describe('SenderActionRow — one-click unsub-ready row', () => {
  it('renders Unsubscribe as the primary CTA and the ⋯ popover still lists K/A/U/L/D', () => {
    const onAction = vi.fn();
    const row = sender({ unsubscribeMethod: 'one_click' });
    render(<SenderActionRow sender={row} onAction={onAction} />);

    // Primary CTA derives from the wire fact and emits the legacy verb.
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onAction).toHaveBeenCalledWith({ verb: 'Unsubscribe', senders: [row] });

    // The ⋯ popover still renders the full canonical verb set (D227).
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const menu = screen.getByRole('menu');
    for (const label of ['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });
});
