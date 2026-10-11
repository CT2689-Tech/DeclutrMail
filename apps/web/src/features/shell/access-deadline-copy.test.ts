import { describe, expect, it } from 'vitest';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

import { accessDeadlineCopy, serverDeadlineLabel } from './access-deadline-copy';

type Subscription = NonNullable<BillingSubscription['subscription']>;

const DEADLINE = '2026-11-03T07:00:00.000Z';

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    provider: 'paddle',
    tier: 'plus',
    status: 'active',
    cycle: 'monthly',
    currentPeriodEnd: DEADLINE,
    entitlementEndsAt: DEADLINE,
    cancelAtPeriodEnd: false,
    cancelSource: null,
    pauseUntil: null,
    foundingMember: false,
    scheduledChange: null,
    ...overrides,
  };
}

describe('accessDeadlineCopy', () => {
  it('uses the server calendar date and ignores the browser zone', () => {
    expect(serverDeadlineLabel(DEADLINE)).toBe('November 3, 2026');
    expect(serverDeadlineLabel('not-a-date')).toBeNull();
  });

  it('shows the past-due banner with the server date', () => {
    const banner = accessDeadlineCopy('plus', sub({ status: 'past_due' }));
    expect(banner?.kind).toBe('past_due');
    expect(banner?.showCardUpdate).toBe(true);
    expect(banner?.message).toBe(
      WS2_COPY.banners.pastDue.banner
        .replaceAll('{deadline}', 'November 3, 2026')
        .replaceAll('{planName}', 'Plus'),
    );
  });

  it('shows the quieter ending line for a scheduled cancel or a refund', () => {
    const scheduled = accessDeadlineCopy('pro', sub({ cancelAtPeriodEnd: true, tier: 'pro' }));
    expect(scheduled?.kind).toBe('plan_ends');
    expect(scheduled?.showCardUpdate).toBe(false);
    expect(scheduled?.message).toContain('Pro ends on November 3, 2026');
    const refund = accessDeadlineCopy('plus', sub({ cancelSource: 'refund' }));
    expect(refund?.kind).toBe('plan_ends');
  });

  it('omits the banner when the plan is active, the deadline is missing, or the workspace is Free', () => {
    expect(accessDeadlineCopy('plus', sub())).toBeNull();
    expect(
      accessDeadlineCopy('plus', sub({ status: 'past_due', entitlementEndsAt: null })),
    ).toBeNull();
    expect(
      accessDeadlineCopy('plus', sub({ status: 'past_due', entitlementEndsAt: undefined })),
    ).toBeNull();
    expect(accessDeadlineCopy('free', sub({ status: 'past_due' }))).toBeNull();
    expect(accessDeadlineCopy('plus', null)).toBeNull();
    expect(
      accessDeadlineCopy('plus', sub({ status: 'canceled', cancelSource: 'refund' })),
    ).toBeNull();
  });
});
