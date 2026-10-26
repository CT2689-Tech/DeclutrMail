import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckoutRecoveryScheduler } from '../checkout-recovery.scheduler.js';
import type { BillingReconciliationService } from '../billing-reconciliation.service.js';

describe('API checkout recovery scheduling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('does not start while durable checkout is disabled', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    vi.stubEnv('BILLING_CHECKOUT_ATTEMPTS_ENABLED', 'false');
    const reconcileCheckoutAttempts = vi.fn();
    const scheduler = new CheckoutRecoveryScheduler({
      reconcileCheckoutAttempts,
    } as unknown as BillingReconciliationService);

    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconcileCheckoutAttempts).not.toHaveBeenCalled();
    scheduler.onModuleDestroy();
  });

  it('runs on boot and each interval without overlapping provider reads', async () => {
    vi.stubEnv('BILLING_ENABLED', 'true');
    vi.stubEnv('BILLING_CHECKOUT_ATTEMPTS_ENABLED', 'true');
    let finishFirst!: (value: {
      checked: number;
      recovered: number;
      unavailable: number;
      capped: boolean;
    }) => void;
    const reconcileCheckoutAttempts = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue({ checked: 0, recovered: 0, unavailable: 0, capped: false });
    const scheduler = new CheckoutRecoveryScheduler({
      reconcileCheckoutAttempts,
    } as unknown as BillingReconciliationService);

    scheduler.onModuleInit();
    expect(reconcileCheckoutAttempts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconcileCheckoutAttempts).toHaveBeenCalledTimes(1);
    finishFirst({ checked: 0, recovered: 0, unavailable: 0, capped: false });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconcileCheckoutAttempts).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconcileCheckoutAttempts).toHaveBeenCalledTimes(2);
  });
});
