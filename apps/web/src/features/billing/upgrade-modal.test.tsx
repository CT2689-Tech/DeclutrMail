/**
 * Tests for `UpgradeModal` (D19/D77/D81 — the U13 402 upgrade flow).
 *
 * Pins the D123 nudge ladder: Free/Plus get the upgrade CTA with the
 * money-back note; Pro gets the honest limit statement with NO nudge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Parametrizable tier — useTier() reads useAuth() from this module.
let mockTier = 'free';
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: {
      user: { id: 'u', email: 'me@example.com', workspaceId: 'w' },
      activeMailboxId: 'mb-1',
      mailboxes: [
        {
          id: 'mb-1',
          email: 'me@example.com',
          status: 'active',
          connectedAt: null,
          readiness: 'ready',
        },
      ],
      tier: mockTier,
      cleanupRemaining: mockTier === 'free' ? 0 : null,
    },
  }),
}));

import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';

import { UpgradeModal } from './upgrade-modal';

beforeEach(() => {
  mockTier = 'free';
  useUpgradeGateStore.getState().dismiss();
});

afterEach(() => {
  useUpgradeGateStore.getState().dismiss();
});

describe('UpgradeModal', () => {
  it('renders nothing without a gate hit', () => {
    render(<UpgradeModal />);
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
  });

  it('free_cap (spent): headline + Plus/Pro pitch + money-back note + See plans', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
    });
    render(<UpgradeModal />);

    expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    expect(screen.getByText("You've used all 5 free cleanup actions")).toBeInTheDocument();
    // Manifest-derived prices (D19): Plus $9/mo, Pro $19/mo.
    expect(screen.getByText(/Plus unlocks unlimited cleanup for \$9\/mo/)).toBeInTheDocument();
    expect(screen.getByText(/\$19\/mo — 30-day money-back guarantee/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
  });

  it('free_cap (partial): bulk-needs-more headline', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 2, limit: 5, used: 3, requiredUnits: 4 },
    });
    render(<UpgradeModal />);

    expect(
      screen.getByText('That needs 4 cleanup actions — only 2 of your 5 free ones are left'),
    ).toBeInTheDocument();
  });

  it('action_tier: explains Free single-sender access and offers the Plus path', () => {
    useUpgradeGateStore.getState().report({
      reason: 'action_tier',
      details: {
        tier: 'free',
        requiredTier: 'plus',
        selector: 'multi-sender',
        verb: 'archive',
      },
    });
    render(<UpgradeModal />);

    expect(screen.getByText('Multi-sender actions are part of Plus')).toBeInTheDocument();
    expect(
      screen.getByText(/five lifetime cleanup actions, one sender at a time/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Plus unlocks multi-sender cleanup for \$9\/mo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/billing');
  });

  it('inbox_limit on Plus: upgrade nudge toward Pro', () => {
    mockTier = 'plus';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 1, connected: 1 } });
    render(<UpgradeModal />);

    expect(screen.getByText('Your Plus plan includes 1 connected inbox')).toBeInTheDocument();
    expect(screen.getByText(/Pro raises the limit to 2 connected inboxes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('inbox_limit on Pro: honest limit statement, NO upgrade nudge (D123)', () => {
    mockTier = 'pro';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 2, connected: 2 } });
    render(<UpgradeModal />);

    expect(screen.getByText('Your Pro plan includes 2 connected inboxes')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See plans' })).not.toBeInTheDocument();
    expect(screen.queryByText(/money-back/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('dismisses via the Not now button', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
    });
    render(<UpgradeModal />);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(useUpgradeGateStore.getState().hit).toBeNull();
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
    });
    render(<UpgradeModal />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });
});
