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

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PreviewSheet } from '@declutrmail/shared';
import { derivePrimaryVerbId, leadButtonTone, SenderActionRow } from './action-row';
import { makeSender } from './testing/make-sender';
import { canUnsubscribe } from './data';

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
const sender: typeof makeSender = (overrides = {}) =>
  makeSender({
    displayName: 'Acme Deals',
    gmailCategory: 'promotions',
    monthlyVolume: 30,
    readRate: 0.05,
    lastDays: 2,
    ...overrides,
  });

/** Standing-protection wire flags (D42/D43) for override brevity. */
const PROTECTED = {
  isProtected: true,
  protectionReason: 'user_defined',
  protectionSetAt: '2026-06-01T00:00:00.000Z',
} as const;

describe('derivePrimaryVerbId — ADR-0019 fact-rule primary (D227 verbs)', () => {
  it('derives Unsubscribe for a one-click sender (the wire fact, not a stub)', () => {
    expect(derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click' }))).toBe('unsubscribe');
  });

  it('protected wins over unsub-ready — registry rule order (D42/D43)', () => {
    expect(
      derivePrimaryVerbId(sender({ unsubscribeMethod: 'one_click', protectionFlags: PROTECTED })),
    ).toBe('keep');
  });

  it("one-click in category 'primary' leads with Unsubscribe — the header outranks the tab", () => {
    // Founder decision 2026-09-26: Primary keeps a sender only when it
    // offers no unsubscribe link. A one-click header marks list or
    // mailing-system mail, so the tab gives it no exemption here either.
    const row = sender({ unsubscribeMethod: 'one_click', gmailCategory: 'primary' });
    expect(derivePrimaryVerbId(row)).toBe('unsubscribe');
    expect(canUnsubscribe(row)).toBe(true);
  });

  it("one-click with no majority Gmail tab ('unknown') leads with Unsubscribe", () => {
    // Before mig 0079 these senders were stored as 'primary' by default
    // and a one-click newsletter led with Keep.
    const row = sender({ unsubscribeMethod: 'one_click', gmailCategory: 'unknown' });
    expect(derivePrimaryVerbId(row)).toBe('unsubscribe');
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
  it('disables empty-mail menu actions while retaining explicit Keep', () => {
    const onAction = vi.fn();
    render(
      <SenderActionRow
        sender={sender({
          inboxCount: 0,
          archivedCount: 0,
          lastDays: 250,
          unsubscribeMethod: 'none',
        })}
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Acme Deals' }));
    for (const verb of ['Archive', 'Later', 'Delete']) {
      const item = screen.getByRole('menuitem', { name: new RegExp(`^${verb}`) });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(item);
      fireEvent.keyDown(item, { key: verb[0]!.toLowerCase() });
    }
    expect(onAction).not.toHaveBeenCalled();
  });
  it('shows accepted status after readback and keeps repeat unsubscribe inert in the menu', () => {
    const onAction = vi.fn();
    render(
      <SenderActionRow
        sender={sender({
          unsubscribeMethod: 'one_click',
          policyType: 'unsubscribe',
          unsubStatus: 'endpoint_accepted',
        })}
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Request accepted').closest('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Acme Deals' }));
    const repeat = screen.getByRole('menuitem', { name: /Unsubscribe/ });
    expect(repeat).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(repeat);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ verb: 'Keep' }));
  });
  it('renders Unsubscribe as the primary CTA and the ⋯ popover still lists K/A/U/L/D', () => {
    const onAction = vi.fn();
    const row = sender({ unsubscribeMethod: 'one_click' });
    render(<SenderActionRow sender={row} onAction={onAction} />);

    // Primary CTA derives from the wire fact and emits the legacy verb.
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onAction).toHaveBeenCalledWith({ verb: 'Unsubscribe', senders: [row] });

    // The ⋯ popover still renders the full canonical verb set (D227).
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Acme Deals' }));
    const menu = screen.getByRole('menu', { name: 'Actions for Acme Deals' });
    for (const label of ['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });
});

describe('SenderActionRow — menu focus returns to the opener', () => {
  function openMenu() {
    const opener = screen.getByRole('button', { name: 'More actions for Acme Deals' });
    fireEvent.click(opener);
    expect(screen.getByRole('menu', { name: 'Actions for Acme Deals' })).toBeInTheDocument();
    return opener;
  }

  it('returns focus to the opener on Escape', () => {
    render(<SenderActionRow sender={sender()} onAction={vi.fn()} />);
    const opener = openMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returns focus to the opener on A, including after the confirm closes', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <SenderActionRow
            sender={sender({ inboxCount: 3 })}
            onAction={(req) => {
              if (req.verb === 'Archive') setOpen(true);
            }}
          />
          {open && (
            <PreviewSheet
              title="Archive emails?"
              onClose={() => setOpen(false)}
              primary={{ label: 'Archive', onClick: () => setOpen(false) }}
            />
          )}
        </>
      );
    }
    render(<Host />);
    const opener = openMenu();
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.queryByRole('menu')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Archive emails?' });
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('returns focus to the opener on a click, including after the confirm closes', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <SenderActionRow
            sender={sender({ inboxCount: 3 })}
            onAction={(req) => {
              if (req.verb === 'Archive') setOpen(true);
            }}
          />
          {open && (
            <PreviewSheet
              title="Archive emails?"
              onClose={() => setOpen(false)}
              primary={{ label: 'Archive', onClick: () => setOpen(false) }}
            />
          )}
        </>
      );
    }
    render(<Host />);
    const opener = openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Archive emails?' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('SenderActionRow — relevant actions', () => {
  it.each(['none', null] as const)(
    'omits unavailable Unsubscribe from the menu for %s',
    (unsubscribeMethod) => {
      const onAction = vi.fn();
      render(<SenderActionRow sender={sender({ unsubscribeMethod })} onAction={onAction} />);
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Acme Deals' }));
      expect(screen.queryByRole('menuitem', { name: /Unsubscribe/ })).toBeNull();
      fireEvent.keyDown(window, { key: 'u' });
      expect(onAction).not.toHaveBeenCalled();
    },
  );
  it('states the saved Keep effect', () => {
    render(<SenderActionRow sender={sender({ policyType: 'keep' })} onAction={vi.fn()} />);
    expect(screen.getByText('Skipped in suggested review')).toBeInTheDocument();
    expect(screen.queryByText('Kept')).toBeNull();
  });
});
