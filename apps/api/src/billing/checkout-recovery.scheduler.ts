import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { BillingReconciliationService } from './billing-reconciliation.service.js';
import { durableCheckoutEnabled } from './checkout-attempts.js';

const RECOVERY_INTERVAL_MS = 60_000;

/** Provider verification belongs on the API, which holds the checkout signing secret. */
@Injectable()
export class CheckoutRecoveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutRecoveryScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly reconciliation: BillingReconciliationService) {}

  onModuleInit(): void {
    if (process.env.BILLING_ENABLED !== 'true' || !durableCheckoutEnabled()) return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.reconciliation.reconcileCheckoutAttempts();
      if (result.checked || result.unavailable)
        this.logger.log(JSON.stringify({ kind: 'billing.checkout_recovery.swept', ...result }));
    } catch {
      this.logger.error(JSON.stringify({ kind: 'billing.checkout_recovery.failed' }));
    } finally {
      this.running = false;
    }
  }
}
