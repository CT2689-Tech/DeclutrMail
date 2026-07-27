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

  it('free_cap (spent): headline + Plus/Pro pitch + money-back note + Plus deep link', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
    });
    render(<UpgradeModal />);

    expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    expect(
      screen.getByText("You've used all 50 cleanup actions for this month"),
    ).toBeInTheDocument();
    // Manifest-derived prices (D19): Plus $9/mo, Pro $19/mo.
    expect(screen.getByText(/Plus unlocks unlimited cleanup for \$9\/mo/)).toBeInTheDocument();
    expect(screen.getByText(/\$19\/mo — 30-day money-back guarantee/)).toBeInTheDocument();
    // ONE checkout path (D117): the CTA deep-links the nudged plan into
    // /billing's confirm step via the validated billing intent.
    expect(screen.getByRole('link', { name: 'Upgrade to Plus' })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=monthly',
    );
  });

  it('free_cap (partial): bulk-needs-more headline', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 2, limit: 50, used: 48, requiredUnits: 4, resetsAt: null },
    });
    render(<UpgradeModal />);

    expect(
      screen.getByText('That needs 4 cleanup actions — only 2 of your 50 are left this month'),
    ).toBeInTheDocument();
  });

  it('free_cap: names the reset date when the server supplies one', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: {
        remaining: 0,
        limit: 50,
        used: 50,
        requiredUnits: 1,
        resetsAt: '2026-08-27T10:00:00.000Z',
      },
    });
    render(<UpgradeModal />);
    expect(screen.getByText(/your quota resets on Aug 27/)).toBeInTheDocument();
  });

  it('action_tier: explains the all-matching selector and offers the Pro path (A3)', () => {
    useUpgradeGateStore.getState().report({
      reason: 'action_tier',
      details: {
        tier: 'free',
        requiredTier: 'pro',
        selector: 'sender-filter',
        verb: 'archive',
      },
    });
    render(<UpgradeModal />);

    expect(screen.getByText('All-matching actions are part of Pro')).toBeInTheDocument();
    expect(screen.getByText(/Pro unlocks all-matching cleanup for \$19\/mo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly',
    );
  });

  it('inbox_limit on Plus: upgrade nudge toward Pro', () => {
    mockTier = 'plus';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 1, connected: 1 } });
    render(<UpgradeModal />);

    expect(screen.getByText('Your Plus plan includes 1 connected inbox')).toBeInTheDocument();
    expect(screen.getByText(/Pro raises the limit to 3 connected inboxes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly',
    );
  });

  it('inbox_limit on Pro: honest limit statement, NO upgrade nudge (D123)', () => {
    mockTier = 'pro';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 2, connected: 2 } });
    render(<UpgradeModal />);

    expect(screen.getByText('Your Pro plan includes 2 connected inboxes')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Upgrade to/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/money-back/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep current inboxes' })).toBeInTheDocument();
  });

  it('dismisses via the Not now button', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1, resetsAt: null },
    });
    render(<UpgradeModal />);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(useUpgradeGateStore.getState().hit).toBeNull();
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
  });

  it('dismisses on Escape', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1, resetsAt: null },
    });
    render(<UpgradeModal />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });
});
