import { createHmac } from 'node:crypto';

// Recorded-shape webhook fixtures for the D117 billing adapters.
//
// Shapes mirror the providers' documented webhook payloads (Paddle
// Billing API v2 notifications; Razorpay Subscriptions webhooks) —
// trimmed to the fields the adapters read plus enough surrounding
// structure to prove the mappers tolerate real envelopes. Sandbox
// keys exist only as GH secrets (no live API access from tests), so
// these fixtures + real-HMAC signature vectors are the integration
// surface (per the U11 build contract + D183's recorded-fixture tier).

/**
 * Webhook secret the billing specs run the adapters with. It keys BOTH
 * the `Paddle-Signature` HMAC and the `custom_data` attribution
 * signature, so fixtures must sign with the same value the adapter
 * under test is constructed with.
 */
export const TEST_PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_test_secret_01';

/**
 * A correctly-signed `custom_data` blob. `custom_data` reaches Paddle
 * through the browser, so the webhook only trusts a signed workspace
 * id — an unsigned fixture would be silently discarded and every
 * attribution assertion would fail for the wrong reason.
 */
export function signedCustomData(
  workspaceId: string | undefined,
  secret: string = TEST_PADDLE_WEBHOOK_SECRET,
): Record<string, unknown> {
  if (!workspaceId) return {};
  return {
    workspace_id: workspaceId,
    sig: createHmac('sha256', secret).update(`paddle:workspace:${workspaceId}`).digest('hex'),
  };
}

/** Test catalog ids used across the billing specs. */
export const TEST_PRICE_IDS = {
  paddle: {
    plus_monthly: 'pri_test_plus_monthly',
    pro_annual: 'pri_test_pro_annual',
    pro_annual_founding: 'pri_test_pro_founding',
  },
  razorpay: {
    plus_monthly: 'plan_test_plus_monthly',
    pro_annual: 'plan_test_pro_annual',
    pro_annual_founding: 'plan_test_pro_founding',
  },
} as const;

/** Paddle `subscription.activated` (API v2 notification envelope). */
export function paddleSubscriptionActivated(args: {
  eventId?: string;
  subscriptionId?: string;
  priceId?: string;
  workspaceId?: string;
  /**
   * Raw `custom_data` echo. Pass a real `createCheckout()` session's
   * `customData` to prove the writer and reader agree on the key —
   * `workspaceId` alone hardcodes the reader's shape and cannot.
   */
  customData?: Record<string, unknown>;
  status?: string;
  customerId?: string;
  scheduledChange?: { action: string; effective_at: string } | null;
  periodEndsAt?: string | null;
  eventType?: string;
  occurredAt?: string;
}): Record<string, unknown> {
  return {
    event_id: args.eventId ?? 'evt_01paddle_activated_000001',
    event_type: args.eventType ?? 'subscription.activated',
    occurred_at: args.occurredAt ?? '2026-06-11T10:00:00.000000Z',
    notification_id: 'ntf_01paddle000001',
    data: {
      id: args.subscriptionId ?? 'sub_01paddle000001',
      status: args.status ?? 'active',
      customer_id: args.customerId ?? 'ctm_01paddle000001',
      address_id: 'add_01paddle000001',
      business_id: null,
      currency_code: 'USD',
      created_at: '2026-06-11T09:59:00.000000Z',
      updated_at: '2026-06-11T10:00:00.000000Z',
      started_at: '2026-06-11T10:00:00.000000Z',
      first_billed_at: '2026-06-11T10:00:00.000000Z',
      next_billed_at: '2026-07-11T10:00:00.000000Z',
      paused_at: null,
      canceled_at: null,
      collection_mode: 'automatic',
      billing_details: null,
      current_billing_period:
        args.periodEndsAt === null
          ? null
          : {
              starts_at: '2026-06-11T10:00:00.000000Z',
              ends_at: args.periodEndsAt ?? '2026-07-11T10:00:00.000000Z',
            },
      billing_cycle: { interval: 'month', frequency: 1 },
      scheduled_change: args.scheduledChange ?? null,
      items: [
        {
          status: 'active',
          quantity: 1,
          recurring: true,
          price: {
            id: args.priceId ?? TEST_PRICE_IDS.paddle.plus_monthly,
            product_id: 'pro_01paddle000001',
            description: 'Plus monthly',
            unit_price: { amount: '900', currency_code: 'USD' },
          },
        },
      ],
      custom_data: args.customData ?? signedCustomData(args.workspaceId),
    },
  };
}

/** Paddle `transaction.completed` (payment observability path). */
export function paddleTransactionCompleted(args: {
  eventId?: string;
  subscriptionId?: string | null;
  customerId?: string;
  /** Checkout attribution Paddle copies onto the transaction. */
  workspaceId?: string;
}): Record<string, unknown> {
  return {
    event_id: args.eventId ?? 'evt_01paddle_txn_000001',
    event_type: 'transaction.completed',
    occurred_at: '2026-06-11T10:00:05.000000Z',
    data: {
      id: 'txn_01paddle000001',
      status: 'completed',
      customer_id: args.customerId ?? 'ctm_01paddle000001',
      subscription_id:
        args.subscriptionId === undefined ? 'sub_01paddle000001' : args.subscriptionId,
      currency_code: 'USD',
      details: { totals: { grand_total: '900' } },
      ...(args.workspaceId ? { custom_data: signedCustomData(args.workspaceId) } : {}),
    },
  };
}

/** Paddle `adjustment.created` — refund/chargeback (D117 downgrade path). */
export function paddleAdjustmentCreated(args: {
  eventId?: string;
  action?: string;
  subscriptionId?: string | null;
}): Record<string, unknown> {
  return {
    event_id: args.eventId ?? 'evt_01paddle_adj_000001',
    event_type: 'adjustment.created',
    occurred_at: '2026-06-12T10:00:00.000000Z',
    data: {
      id: 'adj_01paddle000001',
      action: args.action ?? 'refund',
      transaction_id: 'txn_01paddle000001',
      subscription_id:
        args.subscriptionId === undefined ? 'sub_01paddle000001' : args.subscriptionId,
      reason: 'requested_by_customer',
      status: 'pending_approval',
    },
  };
}

/**
 * Razorpay subscription webhook envelope. NOTE: the event id is NOT in
 * the body — Razorpay delivers it in the `x-razorpay-event-id` header;
 * the controller injects it as `__eventId` before mapping.
 */
export function razorpaySubscriptionEvent(args: {
  event?: string;
  subscriptionId?: string;
  planId?: string;
  status?: string;
  workspaceId?: string | null;
  customerId?: string | null;
  currentEnd?: number | null;
  endAt?: number | null;
}): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_test00000001',
    event: args.event ?? 'subscription.activated',
    contains: ['subscription'],
    payload: {
      subscription: {
        entity: {
          id: args.subscriptionId ?? 'sub_rzp00000000001',
          entity: 'subscription',
          plan_id: args.planId ?? TEST_PRICE_IDS.razorpay.pro_annual,
          customer_id: args.customerId === undefined ? 'cust_rzp0000000001' : args.customerId,
          status: args.status ?? 'active',
          current_start: 1781430000,
          current_end: args.currentEnd === undefined ? 1812966000 : args.currentEnd,
          ended_at: null,
          quantity: 1,
          charge_at: 1812966000,
          start_at: 1781430000,
          end_at: args.endAt === undefined ? 2129000000 : args.endAt,
          auth_attempts: 0,
          total_count: 50,
          paid_count: 1,
          customer_notify: true,
          created_at: 1781429000,
          expire_by: null,
          short_url: 'https://rzp.io/i/test0001',
          has_scheduled_changes: false,
          remaining_count: 49,
          notes:
            args.workspaceId === null
              ? []
              : { workspace_id: args.workspaceId ?? '00000000-0000-0000-0000-000000000000' },
        },
      },
    },
    created_at: 1781430100,
  };
}
