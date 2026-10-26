import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaddleAdapter } from '../paddle.adapter.js';
import type { CheckoutTransactionOwner } from '../billing-provider.interface.js';
const ID = '11111111-1111-4111-8111-111111111111';
const WS = '22222222-2222-4222-8222-222222222222';
const TXN = 'txn_01abcdefghjkmnpqrstvwxyz12';
const PRICE = 'pri_01abcdefghjkmnpqrstvwxyz12';
const secret = 'synthetic_webhook_secret';
const owner: CheckoutTransactionOwner & { createdAt: Date } = {
  id: ID,
  workspaceId: WS,
  providerPriceId: PRICE,
  currencyCode: 'USD',
  offer: 'pass_onetime',
  createdAt: new Date(),
};
function custom() {
  return {
    workspace_id: WS,
    checkout_attempt_id: ID,
    checkout_offer: 'pass_onetime',
    checkout_binding_version: '1',
    sig: createHmac('sha256', secret)
      .update(`paddle:checkout:${WS}:${ID}:pass_onetime`)
      .digest('hex'),
  };
}
const adapter = () =>
  new PaddleAdapter({
    PADDLE_ENV: 'sandbox',
    PADDLE_API_KEY: 'synthetic_sandbox_key',
    PADDLE_CLIENT_TOKEN: 'synthetic_client',
    PADDLE_WEBHOOK_SECRET: secret,
  });
const transaction = (over: Record<string, unknown> = {}) => ({
  id: TXN,
  status: 'ready',
  currency_code: 'USD',
  subscription_id: null,
  customer_id: null,
  custom_data: custom(),
  items: [{ price: { id: PRICE }, quantity: 1 }],
  payments: [],
  ...over,
});
function stub(data: unknown) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 })),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe('exact Paddle checkout attempt boundary', () => {
  it('creates a transaction with signed attempt identity and exposes only its ID and public token', async () => {
    stub({ id: TXN, currency_code: 'USD' });
    const result = await adapter().createCheckout({
      workspaceId: WS,
      checkoutAttemptId: ID,
      checkoutOffer: 'pass_onetime',
      userEmail: 'synthetic@example.test',
      tierId: 'plus',
      cycle: 'annual',
      providerPriceId: PRICE,
    });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.custom_data).toEqual(custom());
    expect(result).toMatchObject({ transactionId: TXN, attemptId: ID });
    expect(result).not.toHaveProperty('customData');
    expect(result).not.toHaveProperty('priceId');
  });
  it.each([
    'workspace',
    'attempt',
    'offer',
    'signature',
    'price',
    'quantity',
    'currency',
    'missing payments',
  ] as const)('refuses mismatched %s evidence', async (mismatch) => {
    const data = transaction();
    if (mismatch === 'workspace') data.custom_data.workspace_id = ID;
    if (mismatch === 'attempt') data.custom_data.checkout_attempt_id = WS;
    if (mismatch === 'offer') data.custom_data.checkout_offer = 'subscription';
    if (mismatch === 'signature') data.custom_data.sig = 'forged';
    if (mismatch === 'price') data.items[0]!.price.id = 'pri_other';
    if (mismatch === 'quantity') data.items[0]!.quantity = 2;
    if (mismatch === 'currency') data.currency_code = 'INR';
    const payload = mismatch === 'missing payments' ? { ...data, payments: undefined } : data;
    stub(payload);
    expect(await adapter().readCheckoutAttempt(TXN, owner)).toBeNull();
  });
  it('distinguishes an unpaid snapshot from terminal provider stopping', async () => {
    stub(transaction());
    expect((await adapter().readCheckoutAttempt(TXN, owner))!.state).toBe('unpaid');
    stub(transaction({ status: 'canceled' }));
    expect((await adapter().readCheckoutAttempt(TXN, owner))!.state).toBe('stopped');
  });
  it('requires complete linkage for a completed subscription while allowing completed one-time Passes', async () => {
    stub(transaction({ status: 'completed' }));
    expect(await adapter().readCheckoutAttempt(TXN, { ...owner, offer: null })).toBeNull();
    stub(
      transaction({
        status: 'completed',
        subscription_id: 'sub_bound',
        custom_data: {
          ...custom(),
          checkout_offer: 'subscription',
          sig: createHmac('sha256', secret)
            .update(`paddle:checkout:${WS}:${ID}:subscription`)
            .digest('hex'),
        },
      }),
    );
    expect((await adapter().readCheckoutAttempt(TXN, { ...owner, offer: null }))!.state).toBe(
      'completed',
    );
    stub(transaction({ status: 'completed' }));
    expect((await adapter().readCheckoutAttempt(TXN, owner))!.state).toBe('completed');
  });
  it('payment evidence outranks canceled or unpaid transaction snapshots', async () => {
    stub(transaction({ status: 'canceled', payments: [{ status: 'captured' }] }));
    expect((await adapter().readCheckoutAttempt(TXN, owner))!.state).toBe('paid');
    stub(transaction({ payments: [{ status: 'authorized' }] }));
    expect((await adapter().readCheckoutAttempt(TXN, owner))!.state).toBe('in_flight');
  });
  it('preserves attempt identity and validates quantity on normalized payment events', () => {
    const mapped = adapter().mapWebhookEvent({
      event_id: 'evt_quantity',
      event_type: 'transaction.completed',
      data: transaction({ status: 'completed', items: [{ price: { id: PRICE }, quantity: 2 }] }),
    });
    expect(mapped).toMatchObject({
      kind: 'payment',
      workspaceId: WS,
      checkoutAttemptId: ID,
      checkoutItemsValid: false,
    });
  });
  it('normalizes exact attempt identity on subscription events for admission fencing', () => {
    const mapped = adapter().mapWebhookEvent({
      event_id: 'evt_subscription',
      event_type: 'subscription.activated',
      data: {
        id: 'sub_attempt',
        status: 'active',
        custom_data: custom(),
        items: [{ price: { id: PRICE } }],
      },
    });
    expect(mapped).toMatchObject({
      kind: 'subscription',
      subscription: { checkoutAttemptId: ID, workspaceId: WS },
    });
  });
  it('a capped ownership scan remains uncertain and never retries creation', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [transaction()],
          meta: { pagination: { has_more: true, next: '/transactions?after=next' } },
        }),
      ),
    );
    // Each fetch needs a fresh consumable body.
    request.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [transaction()],
            meta: { pagination: { has_more: true, next: '/transactions?after=next' } },
          }),
        ),
    );
    vi.stubGlobal('fetch', request);
    expect(await adapter().recoverCheckoutAttempt(owner)).toBeNull();
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.every((call) => !call[1] || call[1].method !== 'POST')).toBe(true);
  });
  it('cancellation stays disabled without its explicit activation flag', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(adapter().stopCheckoutAttempt(TXN)).rejects.toMatchObject({
      code: 'BILLING_NOT_PROVISIONED',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
