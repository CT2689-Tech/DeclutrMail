import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CancelModal } from './cancel-modal';

describe('CancelModal money-action lock', () => {
  it('withholds cancellation and dismissal until an unresolved pause settles', async () => {
    let settlePause!: () => void;
    const pendingPause = new Promise<void>((resolve) => (settlePause = resolve));
    const cancel = vi.fn();
    const close = vi.fn();
    function Harness() {
      const [pausing, setPausing] = useState(false);
      return (
        <CancelModal
          open
          sub={{
            provider: 'paddle',
            tier: 'pro',
            status: 'active',
            cycle: 'monthly',
            currentPeriodEnd: '2026-11-03T12:00:00Z',
            cancelAtPeriodEnd: false,
            cancelSource: null,
            pauseUntil: null,
            foundingMember: false,
            scheduledChange: null,
          }}
          backsEntitlement
          entitlementTier="pro"
          onClose={close}
          onConfirm={cancel}
          isCanceling={false}
          cancelError={null}
          onPause={() => {
            setPausing(true);
            void pendingPause.then(() => setPausing(false));
          }}
          isPausing={pausing}
          pauseError={null}
        />
      );
    }
    render(<Harness />);
    const cancellation = screen.getByRole('button', { name: 'Cancel subscription' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause for 30 days' }));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: 'Pausing…' })
          .every((button) => button.hasAttribute('disabled')),
      ).toBe(true),
    );
    expect(cancellation).toBeDisabled();
    fireEvent.click(cancellation);
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Keep current plan' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('cancel-modal'));
    expect(close).not.toHaveBeenCalled();

    await act(async () => settlePause());
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeEnabled();
  });
});

describe('CancelModal on a record that does not grant the plan', () => {
  it('names the plan the account is actually on', () => {
    render(
      <CancelModal
        open
        sub={{
          provider: 'paddle',
          tier: 'plus',
          status: 'paused',
          cycle: 'annual',
          currentPeriodEnd: '2026-11-03T12:00:00Z',
          cancelAtPeriodEnd: false,
          cancelSource: null,
          pauseUntil: '2026-11-03T12:00:00Z',
          foundingMember: false,
          scheduledChange: null,
        }}
        backsEntitlement={false}
        entitlementTier="plus"
        entitlementName="Backlog Pass"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isCanceling={false}
        cancelError={null}
        onPause={vi.fn()}
        isPausing={false}
        pauseError={null}
      />,
    );
    expect(screen.getByTestId('cancel-modal')).toHaveTextContent(
      'Your account is on Backlog Pass today',
    );
  });
});
