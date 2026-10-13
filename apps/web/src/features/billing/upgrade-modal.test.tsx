/**
 * Tests for `UpgradeModal` (D19/D77/D81 — the U13 402 upgrade flow).
 *
 * Pins the D123 nudge ladder: Free/Plus get the upgrade CTA with the
 * money-back note; Pro gets the honest limit statement with NO nudge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Parametrizable tier — useTier() reads useAuth() from this module.
let mockTier = 'free';
let mockPricingV2 = false;
vi.mock('next/navigation', () => ({
  usePathname: () => '/senders',
  useSearchParams: () => new URLSearchParams('sender=sender-1&q=news'),
}));
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
      pricingV2: mockPricingV2,
      cleanupRemaining: mockTier === 'free' ? 0 : null,
    },
  }),
}));

import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';

import { UpgradeModal } from './upgrade-modal';
import { UpgradeModalHost } from './upgrade-modal-host';

beforeEach(() => {
  mockTier = 'free';
  mockPricingV2 = false;
  useUpgradeGateStore.getState().dismiss();
});

afterEach(() => {
  useUpgradeGateStore.getState().dismiss();
});

// ─── matchMedia stub (mirrors triage-row.test.tsx) ──────────────────
const originalMatchMedia = window.matchMedia;
function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const limit = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    const matches = limit != null && width <= Number(limit[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('UpgradeModal', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('loads the global dialog only after a gate hit and dismisses it', async () => {
    render(<UpgradeModalHost />);
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
    act(() => {
      useUpgradeGateStore.getState().report({
        reason: 'free_cap',
        details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
      });
    });
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(useUpgradeGateStore.getState().hit).toBeNull();
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
  });

  it('renders as a bottom sheet at phone width', () => {
    setViewportWidth(375);
    render(<UpgradeModal />);
    act(() => {
      useUpgradeGateStore.getState().report({
        reason: 'free_cap',
        details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
      });
    });
    const dialog = screen.getByTestId('upgrade-modal');
    // Phone layout is pure CSS now (tokens.css ≤520px): the sheet classes
    // pin the panel to the bottom edge with no post-hydration jump.
    expect(dialog).toHaveClass('dm-sheet-panel');
    expect(dialog.parentElement).toHaveClass('dm-sheet-layer');
  });

  it('renders nothing without a gate hit', () => {
    render(<UpgradeModal />);
    expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();
  });

  it('opens on a 402 arriving AFTER mount without a hook-order violation', () => {
    // The real paywall moment: the modal is mounted (no hit) and a 402
    // flips the store. useRegionProvider used to sit below the early
    // return, so this exact transition fired React's hook-order error
    // (billing audit 2026-07-28). Assert the transition is silent.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<UpgradeModal />);
      expect(screen.queryByTestId('upgrade-modal')).not.toBeInTheDocument();

      act(() => {
        useUpgradeGateStore.getState().report({
          reason: 'free_cap',
          details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
        });
      });

      expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
      const hookOrderError = consoleError.mock.calls.find((args) =>
        args.some((a) => typeof a === 'string' && a.includes('change in the order of Hooks')),
      );
      expect(hookOrderError).toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('free_cap (spent): headline + Plus pitch + money-back note + Plus deep link', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
    });
    render(<UpgradeModal />);

    expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
    expect(screen.getByText('Not enough free emails left this month')).toBeInTheDocument();
    // Manifest-derived price (D19) of the plan the CTA buys: Plus $9/mo.
    expect(screen.getByText(/Plus removes the monthly cap/)).toBeInTheDocument();
    expect(screen.getAllByText(/30-day money-back guarantee/)).toHaveLength(1);
    expect(screen.queryByText(/14-day money-back on any purchase/)).not.toBeInTheDocument();
    // ONE checkout path (D117): the CTA deep-links the nudged plan into
    // /billing's confirm step via the validated billing intent.
    expect(screen.getByRole('link', { name: /^Upgrade to Plus\s*\$9\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=monthly&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
    // The pitch names only Plus, so the other plans stay one click away.
    const compare = screen.getByRole('link', { name: /compare plans/i });
    expect(compare).toHaveAttribute(
      'href',
      '/billing?from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
    fireEvent.click(compare);
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });

  it('PRICING_V2 shows the deck refund line on the same layout', () => {
    mockPricingV2 = true;
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 0, limit: 50, used: 50, requiredUnits: 1, resetsAt: null },
    });
    render(<UpgradeModal />);

    expect(
      screen.getAllByText(/14-day money-back on any purchase, once per customer/),
    ).toHaveLength(1);
    expect(screen.queryByText(/30-day money-back guarantee/)).not.toBeInTheDocument();
    expect(screen.getByText('Unsubscribe, Keep, Later and Undo stay free.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Plus' })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=annual&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
    expect(screen.getByText('$59 a year · no monthly limit')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /\$9\/mo/ })).not.toBeInTheDocument();
  });

  it('PRICING_V2 points a Plus feature gate at annual', () => {
    mockPricingV2 = true;
    useUpgradeGateStore.getState().report({
      reason: 'pro_feature',
      details: { capability: 'quiet', tier: 'free', requiredTier: 'plus' },
    });
    render(<UpgradeModal />);

    expect(screen.getByRole('link', { name: /^Upgrade to Plus\s*\$59 a year$/ })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=annual&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('PRICING_V2 points a Pro feature gate at annual', () => {
    mockPricingV2 = true;
    mockTier = 'plus';
    useUpgradeGateStore.getState().report({
      reason: 'pro_feature',
      details: { capability: 'followups', tier: 'plus', requiredTier: 'pro' },
    });
    render(<UpgradeModal />);

    expect(screen.getByRole('link', { name: /^Upgrade to Pro\s*\$19\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=annual&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('emails-cleared 402 offers clear-what-fits then Plus', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: {
        remaining: 100,
        limit: 1000,
        used: 900,
        requiredUnits: 2708,
        requested: 2708,
        suggestedPreset: 30,
        resetsAt: '2026-11-09T00:00:00.000Z',
      },
    });
    render(<UpgradeModal />);

    expect(
      screen.getByRole('heading', { name: 'Not enough free emails left this month' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This clears 2,708 emails. You have 100 of 1,000 free emails left until Nov 9.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Only emails older than 30 days, within your free total'),
    ).toBeInTheDocument();
    expect(screen.getByText('$59 a year · no monthly limit')).toBeInTheDocument();
    expect(screen.getByText('Unsubscribe, Keep, Later and Undo stay free.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Plus' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear what fits free' }));
    expect(useUpgradeGateStore.getState().pendingWindowPreset).toBe(30);
    expect(useUpgradeGateStore.getState().hit).toBeNull();
  });

  it('emails-cleared 402 links Plus without a fitting preset', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: {
        remaining: 0,
        limit: 1000,
        used: 1000,
        requiredUnits: 12,
        requested: 12,
        suggestedPreset: null,
        resetsAt: null,
      },
    });
    render(<UpgradeModal />);

    expect(screen.getByText(/used all 1,000 free emails this month/)).toBeInTheDocument();
    expect(screen.getByText('$59 a year · no monthly limit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear what fits free' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get Plus' })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=annual&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('free_cap (partial): bulk-needs-more headline', () => {
    useUpgradeGateStore.getState().report({
      reason: 'free_cap',
      details: { remaining: 2, limit: 50, used: 48, requiredUnits: 4, resetsAt: null },
    });
    render(<UpgradeModal />);

    expect(screen.getByText('Not enough free emails left this month')).toBeInTheDocument();
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
    expect(screen.getByText(/Pro unlocks all-matching cleanup/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Upgrade to Pro\s*\$19\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('pro_feature (Plus-gated): names the plan and offers the Plus path', () => {
    useUpgradeGateStore.getState().report({
      reason: 'pro_feature',
      details: { capability: 'quiet', tier: 'free', requiredTier: 'plus' },
    });
    render(<UpgradeModal />);

    expect(screen.getByText('This feature is part of Plus')).toBeInTheDocument();
    expect(screen.getByText('Plus unlocks this feature.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Upgrade to Plus\s*\$9\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=monthly&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('pro_feature (Pro-gated): names the plan and offers the Pro path', () => {
    mockTier = 'plus';
    useUpgradeGateStore.getState().report({
      reason: 'pro_feature',
      details: { capability: 'followups', tier: 'plus', requiredTier: 'pro' },
    });
    render(<UpgradeModal />);

    expect(screen.getByText('This feature is part of Pro')).toBeInTheDocument();
    expect(screen.getByText('Pro unlocks this feature.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Upgrade to Pro\s*\$19\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('inbox_limit on Plus: upgrade nudge toward Pro', () => {
    mockTier = 'plus';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 1, connected: 1 } });
    render(<UpgradeModal />);

    expect(
      screen.getByText('Your Plus plan includes 1 connected Gmail account'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pro raises the limit to 5 connected Gmail accounts/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Upgrade to Pro\s*\$19\/mo$/ })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly&from=%2Fsenders%3Fsender%3Dsender-1%26q%3Dnews',
    );
  });

  it('inbox_limit on Pro: honest limit statement, NO upgrade nudge (D123)', () => {
    mockTier = 'pro';
    useUpgradeGateStore
      .getState()
      .report({ reason: 'inbox_limit', details: { limit: 2, connected: 2 } });
    render(<UpgradeModal />);

    expect(
      screen.getByText('Your Pro plan includes 2 connected Gmail accounts'),
    ).toBeInTheDocument();
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
