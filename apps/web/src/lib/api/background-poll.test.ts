import { describe, expect, it } from 'vitest';

import { billingSubscriptionQueryOptions } from '@/features/billing/api/query-options';
import { screenerCountQueryOptions } from '@/features/screener/api/query-options';
import { laterRecoveryQueryOptions } from '@/features/snoozed/api/query-options';

describe('background polls keep a numeric interval', () => {
  it('does not clear the screener or Later timer, and does not stack query retries', () => {
    const screener = screenerCountQueryOptions(async () => ({ pending: 0 }));
    const later = laterRecoveryQueryOptions((async () => {
      throw new Error('not called');
    }) as never);
    expect(screener.refetchInterval).toBe(60_000);
    expect(later.refetchInterval).toBe(60_000);
    expect(screener.refetchIntervalInBackground).toBe(false);
    expect(later.refetchIntervalInBackground).toBe(false);
    expect(screener.retry).toBe(false);
    expect(later.retry).toBe(false);
  });

  it('does not retry a billing read on top of the client GET retry', () => {
    const billing = billingSubscriptionQueryOptions((async () => {
      throw new Error('not called');
    }) as never);
    expect(billing.retry).toBe(false);
    expect(billing.retryOnMount).toBe(false);
  });
});
