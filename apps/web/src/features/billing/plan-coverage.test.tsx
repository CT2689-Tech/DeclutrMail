import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  me: {
    user: { id: 'u', email: 'me@example.com', workspaceId: 'w', timezone: 'UTC' },
    activeMailboxId: 'mb-1',
    mailboxes: [
      {
        id: 'mb-1',
        email: 'me@example.com',
        status: 'active' as const,
        connectedAt: null,
        readiness: 'ready' as const,
      },
    ],
    tier: 'free' as 'free' | 'plus',
    cleanupRemaining: 1000 as number | null,
    cleanupResetsAt: '2026-11-09T00:00:00.000Z',
    cleanupLimit: null as number | null,
    meterV2: false,
    pricingV2: false,
  },
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => auth,
  useOptionalAuth: () => auth,
}));

import { PlanConsequences, PlanCoverage } from './plan-coverage';

const UNIT = 'cleanup' + ' action';

describe('PlanCoverage', () => {
  beforeEach(() => {
    auth.me.tier = 'free';
    auth.me.meterV2 = false;
    auth.me.pricingV2 = false;
    auth.me.cleanupLimit = null;
    auth.me.cleanupRemaining = 1000;
  });

  it('states the free email allowance when the plan is Free', () => {
    render(<PlanCoverage tier="free" />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage).toHaveTextContent('1 of 1 connected');
    expect(coverage).toHaveTextContent(
      'Clear 1,000 emails a month free. Unsubscribe, Keep, Later and Undo stay free.',
    );
    expect(coverage.textContent).not.toContain(UNIT);
  });

  it('states the email allowance on a metered Free plan', () => {
    auth.me.meterV2 = true;
    auth.me.cleanupLimit = 1000;
    auth.me.cleanupRemaining = 640;
    render(<PlanCoverage tier="free" />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage).toHaveTextContent('Clear 1,000 emails a month free');
    expect(coverage.textContent).not.toContain(UNIT);
  });

  it('uses the r19 unlimited line on Plus when launch pricing is on', () => {
    auth.me.tier = 'plus';
    auth.me.meterV2 = true;
    auth.me.pricingV2 = true;
    auth.me.cleanupLimit = null;
    auth.me.cleanupRemaining = null;
    render(<PlanCoverage tier="plus" />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage).toHaveTextContent('No monthly limit');
    expect(coverage.textContent).not.toContain(UNIT);
    expect(coverage.textContent).not.toContain('Unlimited cleanup');
  });

  it.each(['free', 'plus', 'pro'] as const)(
    'shows %s benefits as text and keeps account management linked',
    (tier) => {
      render(<PlanCoverage tier={tier} />);
      expect(screen.getByRole('link', { name: /Gmail accounts/ })).toHaveAttribute(
        'href',
        '/settings#mailboxes',
      );
      expect(screen.getAllByRole('link')).toHaveLength(1);
      const benefits = screen.getByRole('list', { name: 'Included features' });
      expect(within(benefits).getByText('Sender cleanup')).toBeInTheDocument();
      expect(within(benefits).queryByText('Daily Brief') !== null).toBe(tier === 'pro');
      expect(within(benefits).queryByText('Autopilot') !== null).toBe(tier !== 'free');
      if (tier !== 'free')
        expect(screen.getByText('No monthly limit on emails cleared.')).toBeInTheDocument();
    },
  );

  it('uses the r19 Pass lines when the Pass is the plan', () => {
    auth.me.tier = 'plus';
    auth.me.pricingV2 = true;
    render(<PlanCoverage tier="plus" pass />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    const passLines = [
      'No monthly limit for 30 days',
      'For one Gmail account',
      'The Screener and Autopilot while it lasts',
      'Buy again any time to add 30 more days',
      'Then you’re back on Free. Email you cleared stays where you put it.',
    ];
    let cursor = -1;
    for (const line of passLines) {
      const at = coverage.textContent?.indexOf(line) ?? -1;
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(coverage.textContent).not.toContain('{passDays}');
    expect(coverage.textContent).not.toContain('{freeName}');
    expect(coverage.textContent).not.toContain('Unlimited cleanup');
  });

  it('keeps the buy-again line for a paid Backlog Pass', () => {
    auth.me.tier = 'plus';
    auth.me.pricingV2 = true;
    render(<PlanCoverage tier="plus" pass freeManualPass={false} />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage).toHaveTextContent('Buy again any time to add 30 more days');
    expect(coverage).toHaveTextContent('No monthly limit for 30 days');
  });

  it('omits the buy-again line for a free manual Backlog Pass', () => {
    auth.me.tier = 'plus';
    auth.me.pricingV2 = true;
    render(<PlanCoverage tier="plus" pass freeManualPass />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage.textContent).not.toContain('Buy again any time to add 30 more days');
    expect(coverage).toHaveTextContent('No monthly limit for 30 days');
    expect(coverage).toHaveTextContent(
      'Then you’re back on Free. Email you cleared stays where you put it.',
    );
  });
});

describe('PlanConsequences', () => {
  it('states the destination plan’s allowance as its own sentence', () => {
    const { container } = render(<PlanConsequences fromTier="plus" toTier="free" pricingV2 />);
    // It once read "1 connected Gmail account and Clear 1,000 emails … stay free.."
    expect(container.textContent).toContain('Free includes 1 connected Gmail account. Clear');
    expect(container.textContent).not.toContain(' and Clear');
    expect(container.textContent).not.toContain('..');
  });

  it('warns about the account limit when launch Plus (2 accounts) moves to Free (1)', () => {
    render(<PlanConsequences fromTier="plus" toTier="free" pricingV2 />);
    expect(screen.getByText(/Existing connected Gmail accounts keep working/)).toBeInTheDocument();
  });
});
