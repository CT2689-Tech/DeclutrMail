import { render, screen } from '@testing-library/react';
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

import { PlanCoverage } from './plan-coverage';

const UNIT = 'cleanup' + ' action';

describe('PlanCoverage', () => {
  beforeEach(() => {
    auth.me.tier = 'free';
    auth.me.meterV2 = false;
    auth.me.pricingV2 = false;
    auth.me.cleanupLimit = null;
    auth.me.cleanupRemaining = 1000;
  });

  it('keeps the sender-counting sentence once when the email meter is off', () => {
    render(<PlanCoverage tier="free" />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    expect(coverage).toHaveTextContent(
      `50 ${UNIT}s per month. One ${UNIT} counts one sender acted on, not one email.`,
    );
    expect(coverage.textContent?.match(new RegExp(UNIT, 'g'))).toHaveLength(2);
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

  it('uses the r19 Pass lines when the Pass is the plan', () => {
    auth.me.tier = 'plus';
    auth.me.pricingV2 = true;
    render(<PlanCoverage tier="plus" pass />);
    const coverage = screen.getByRole('region', { name: 'Your plan includes' });
    const passLines = [
      'No monthly limit for 30 days',
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
});
