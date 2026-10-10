import type {
  NormalizedBillingEvent,
  NormalizedSubscription,
} from './billing-provider.interface.js';

/** Explicit provider metadata only. Never raw custom data or payment details. */
export interface PaddleUpgradeState {
  id: string;
  status: string;
  priceId: string;
  periodStart: string;
  periodEnd: string;
  nextBilledAt: string | null;
  updatedAt: string;
  scheduledAction: string | null;
  scheduledAt: string | null;
  discountId: string | null;
  discountEndsAt: string | null;
  normalized: NormalizedSubscription;
}

export interface PaddleRefundTransaction {
  id: string;
  subscriptionId: string;
  origin: string;
  status: string;
  /** Present only after verifying the server signature. */
  upgradeIntentId: string | null;
  upgradePriceId: string | null;
  positiveCharge: boolean;
  createdAt: string | null;
  lines: Array<{
    priceId: string;
    quantity: number;
    total: string;
    rate: string;
    periodStart: string;
    periodEnd: string;
  }> | null;
}

export interface RefundReference {
  adjustmentId: string;
  transactionId: string;
}

export type RefundEvent = Extract<
  NormalizedBillingEvent,
  { kind: 'cancellation_scheduled' | 'cancellation_revoked' | 'refund_settled' }
>;
export type UpgradeRefundDecision =
  | { kind: 'ordinary' }
  | { kind: 'inert' | 'hold'; reason: string }
  | {
      kind: 'restored';
      subscription: NormalizedSubscription;
      confirmedAt: string;
      adjustmentId: string;
      intentId: string;
    };

/** Production compositions must wire this port; tests may supply ordinary-refund fixtures. */
export interface UpgradeRefundPolicy {
  observeCompletedTransaction(subscriptionId: string): Promise<void>;
  resolve(event: RefundEvent): Promise<UpgradeRefundDecision>;
  confirmProjectedRestoration(
    decision: Extract<UpgradeRefundDecision, { kind: 'restored' }>,
  ): Promise<boolean>;
}
