/**
 * Tests for `TierGate` (D68/D77) — Pro feature screens render only for
 * granted tiers; under-tier workspaces get the placeholder + upgrade
 * CTA and the children NEVER mount (no under-tier data fetching).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
      cleanupRemaining: null,
    },
  }),
}));

import { TierGate } from './tier-gate';

function renderGate(capability: 'brief' | 'triage' | 'screener' = 'brief') {
  // NOTE (D251): `screener` is now a PLUS capability, so it is the fixture
  // for "the gate names the cheapest granting plan". `brief` stays Pro and
  // is the fixture for the Pro path.
  let childMounted = false;
  function Child() {
    childMounted = true;
    return <div data-testid="gated-child">Brief content</div>;
  }
  const result = render(
    <TierGate
      capability={capability}
      title="Your Morning Brief"
      pitch="A daily summary."
      bullets={['REPLY — what actually needs you']}
    >
      <Child />
    </TierGate>,
  );
  return { result, childMounted: () => childMounted };
}

describe('TierGate', () => {
  it('free tier: placeholder + manifest-price upgrade CTA; children never mount', () => {
    mockTier = 'free';
    const { childMounted } = renderGate();

    expect(screen.getByTestId('tier-gate-placeholder')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Morning Brief' })).toBeInTheDocument();
    expect(screen.getByText('REPLY — what actually needs you')).toBeInTheDocument();
    // D19 manifest price + D121 note, no hardcoded dollars in the gate.
    expect(screen.getByRole('link', { name: 'Upgrade to Pro → $19/mo' })).toHaveAttribute(
      'href',
      '/billing?plan=pro&cycle=monthly',
    );
    expect(screen.getByText('30-day money-back guarantee')).toBeInTheDocument();
    expect(screen.queryByTestId('gated-child')).not.toBeInTheDocument();
    expect(childMounted()).toBe(false);
  });

  it('plus tier: still gated for the Pro-only automation set (D77, narrowed by D251)', () => {
    mockTier = 'plus';
    renderGate('brief');
    expect(screen.getByTestId('tier-gate-placeholder')).toBeInTheDocument();
  });

  it('plus tier: NOT gated for the Screener, which D251 moved to Plus', () => {
    mockTier = 'plus';
    const { childMounted } = renderGate('screener');
    expect(screen.queryByTestId('tier-gate-placeholder')).not.toBeInTheDocument();
    expect(childMounted()).toBe(true);
  });

  it('names the CHEAPEST granting plan and its manifest price, not always Pro', () => {
    mockTier = 'free';
    renderGate('screener');

    // D251 — Screener is granted by Plus, so the gate must route to Plus at
    // $9. Before D251 this said Pro/$19. The price and plan are derived from
    // the manifest, so this assertion moves with the ladder by construction.
    expect(screen.getByRole('link', { name: 'Upgrade to Plus → $9/mo' })).toHaveAttribute(
      'href',
      '/billing?plan=plus&cycle=monthly',
    );
  });

  it('pro tier: children render, no placeholder', () => {
    mockTier = 'pro';
    const { childMounted } = renderGate();
    expect(screen.getByTestId('gated-child')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-gate-placeholder')).not.toBeInTheDocument();
    expect(childMounted()).toBe(true);
  });

  it('team/enterprise tiers rank at pro for feature gates (D19)', () => {
    mockTier = 'team';
    renderGate();
    expect(screen.getByTestId('gated-child')).toBeInTheDocument();
  });

  it('Triage is Free (A3): the gate passes every tier straight through', () => {
    mockTier = 'free';
    render(
      <TierGate capability="triage" title="Triage" pitch="Review a focused sender queue.">
        <div data-testid="triage-content">Triage content</div>
      </TierGate>,
    );
    expect(screen.getByTestId('triage-content')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-gate-placeholder')).not.toBeInTheDocument();
  });
});
