import { createHmac } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaddleAdapter } from '../paddle.adapter.js';
import {
  paddleAdjustmentCreated,
  paddleAdjustmentUpdated,
  paddleSubscriptionActivated,
  paddleTransactionCompleted,
} from './fixtures.js';

/**
 * PaddleAdapter unit tests (D117, D180).
 *
 * Signature tests compute REAL HMAC-SHA256 vectors with a test secret
 * — the verification math is proven, not mocked (U11 contract: "prove
 * verification math"). Webhook mapping runs against recorded-shape
 * fixtures; API calls (cancel) run against a mocked global fetch.
 */

const SECRET = 'pdl_ntfset_test_secret_01';
const WORKSPACE = '11111111-2222-4333-8444-555555555555';

/** Build a valid Paddle-Signature header for `body` at `tsSec`. */
function sign(body: string, tsSec: number, secret = SECRET): string {
  const h1 = createHmac('sha256', secret).update(`${tsSec}:${body}`).digest('hex');
  return `ts=${tsSec};h1=${h1}`;
}

function makeAdapter(env: Record<string, string> = {}): PaddleAdapter {
  // PADDLE_WEBHOOK_SECRET keys the custom_data attribution signature as
  // well as the Paddle-Signature HMAC, so it is present by default —
  // individual tests override it to exercise the unsigned path.
  return new PaddleAdapter({ PADDLE_WEBHOOK_SECRET: SECRET, ...env } as NodeJS.ProcessEnv);
}

describe('PaddleAdapter.verifyWebhookSignature', () => {
  const body = JSON.stringify(paddleSubscriptionActivated({ workspaceId: WORKSPACE }));
  const nowMs = 1_781_430_000_000;
  const nowSec = Math.floor(nowMs / 1000);

  it('accepts a correctly signed body inside the skew window', () => {
    const adapter = makeAdapter();
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: sign(body, nowSec),
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts when a rotated (second) h1 matches', () => {
    const adapter = makeAdapter();
    const stale = createHmac('sha256', 'old_secret').update(`${nowSec}:${body}`).digest('hex');
    const good = createHmac('sha256', SECRET).update(`${nowSec}:${body}`).digest('hex');
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: `ts=${nowSec};h1=${stale};h1=${good}`,
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a wrong-secret signature as signature_mismatch', () => {
    const adapter = makeAdapter();
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: sign(body, nowSec, 'wrong_secret'),
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a TAMPERED body even with a previously valid header', () => {
    const adapter = makeAdapter();
    const tampered = body.replace(WORKSPACE, '99999999-9999-4999-8999-999999999999');
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(tampered),
      signatureHeader: sign(body, nowSec),
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects timestamps older than the 5s skew window (replay defense)', () => {
    const adapter = makeAdapter();
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: sign(body, nowSec - 6),
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'timestamp_skew' });
  });

  it('accepts exactly at the 5s boundary, honors PADDLE_WEBHOOK_MAX_SKEW_SEC override', () => {
    expect(
      makeAdapter().verifyWebhookSignature({
        rawBody: Buffer.from(body),
        signatureHeader: sign(body, nowSec - 5),
        secret: SECRET,
        nowMs,
      }),
    ).toEqual({ ok: true });
    expect(
      makeAdapter({ PADDLE_WEBHOOK_MAX_SKEW_SEC: '60' }).verifyWebhookSignature({
        rawBody: Buffer.from(body),
        signatureHeader: sign(body, nowSec - 59),
        secret: SECRET,
        nowMs,
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    [undefined],
    [''],
    ['garbage'],
    ['h1=deadbeef'], // no ts
    ['ts=123'], // no h1
    ['ts=abc;h1=deadbeef'], // non-numeric ts
  ])('rejects malformed header %j as malformed_header', (header) => {
    const adapter = makeAdapter();
    const result = adapter.verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: header as string | undefined,
      secret: SECRET,
      nowMs,
    });
    expect(result).toEqual({ ok: false, reason: 'malformed_header' });
  });
});

describe('PaddleAdapter.mapWebhookEvent', () => {
  const adapter = makeAdapter();

  it('maps subscription.activated to a normalized subscription', () => {
    const event = adapter.mapWebhookEvent(
      paddleSubscriptionActivated({ workspaceId: WORKSPACE, priceId: 'pri_x' }),
    );
    expect(event).toMatchObject({
      kind: 'subscription',
      providerEventId: 'evt_01paddle_activated_000001',
      eventType: 'subscription.activated',
      subscription: {
        providerSubscriptionId: 'sub_01paddle000001',
        providerCustomerId: 'ctm_01paddle000001',
        providerPriceId: 'pri_x',
        status: 'active',
        currentPeriodEnd: '2026-07-11T10:00:00.000000Z',
        cancelAtPeriodEnd: false,
        workspaceId: WORKSPACE,
      },
    });
  });

  // `custom_data` reaches Paddle through the BROWSER, so a client can
  // put any workspace id in it. Unsigned or mis-signed attribution must
  // resolve to null — otherwise a forged checkout binds a paid
  // subscription (and a billing_customers mapping) onto someone else's
  // workspace.
  it.each([
    ['unsigned', { workspace_id: WORKSPACE }],
    ['forged signature', { workspace_id: WORKSPACE, sig: 'deadbeef' }],
    [
      'valid signature for a DIFFERENT workspace',
      {
        workspace_id: WORKSPACE,
        sig: createHmac('sha256', SECRET)
          .update('paddle:workspace:99999999-9999-4999-8999-999999999999')
          .digest('hex'),
      },
    ],
  ])('refuses %s attribution', (_label, customData) => {
    const event = adapter.mapWebhookEvent(paddleSubscriptionActivated({ customData }));
    if (event.kind !== 'subscription') throw new Error('expected a subscription event');
    expect(event.subscription.workspaceId).toBeNull();
  });

  it('maps scheduled_change=cancel to cancelAtPeriodEnd and paused status to paused', () => {
    const canceling = adapter.mapWebhookEvent(
      paddleSubscriptionActivated({
        workspaceId: WORKSPACE,
        eventType: 'subscription.updated',
        scheduledChange: { action: 'cancel', effective_at: '2026-07-11T10:00:00.000000Z' },
      }),
    );
    expect(canceling).toMatchObject({
      kind: 'subscription',
      subscription: { cancelAtPeriodEnd: true, status: 'active' },
    });

    const paused = adapter.mapWebhookEvent(
      paddleSubscriptionActivated({
        workspaceId: WORKSPACE,
        eventType: 'subscription.paused',
        status: 'paused',
        periodEndsAt: null,
      }),
    );
    expect(paused).toMatchObject({
      kind: 'subscription',
      subscription: { status: 'paused', currentPeriodEnd: null },
    });
  });

  it('maps transaction.completed / payment_failed to payment effects', () => {
    expect(adapter.mapWebhookEvent(paddleTransactionCompleted({}))).toMatchObject({
      kind: 'payment',
      outcome: 'succeeded',
      providerSubscriptionId: 'sub_01paddle000001',
    });
    const failed = paddleTransactionCompleted({ eventId: 'evt_fail_1' });
    (failed as { event_type: string }).event_type = 'transaction.payment_failed';
    expect(adapter.mapWebhookEvent(failed)).toMatchObject({ kind: 'payment', outcome: 'failed' });
  });

  it('maps refund/chargeback adjustments to cancellation_scheduled; ignores unlinked ones', () => {
    expect(adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'refund' }))).toMatchObject({
      kind: 'cancellation_scheduled',
      reason: 'refund',
      providerSubscriptionId: 'sub_01paddle000001',
    });
    expect(
      adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'chargeback' })),
    ).toMatchObject({ kind: 'cancellation_scheduled', reason: 'chargeback' });
    expect(adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'credit' }))).toMatchObject({
      kind: 'ignored',
    });
    expect(
      adapter.mapWebhookEvent(paddleAdjustmentCreated({ subscriptionId: null })),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('a PARTIAL refund is not an exit — the subscription is left alone', () => {
    // Paddle fires the same event for "$2 back for the trouble" as for
    // "here is your money back". Treating both as an exit ended the plan
    // of a customer being apologised to — and now that the verdict also
    // drives a provider-side cancel, it would cancel their subscription.
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ action: 'refund', itemTypes: ['partial'] }),
      ),
    ).toMatchObject({ kind: 'ignored' });
    // One partial item among full ones is still a part-refund.
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ action: 'refund', itemTypes: ['full', 'partial'] }),
      ),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('recognizes a full transaction refund with a partial prorated item while pending', () => {
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ adjustmentType: 'full', itemTypes: ['partial'] }),
      ),
    ).toMatchObject({ kind: 'cancellation_scheduled', reason: 'refund' });
  });

  it.each([
    ['approved', 'refund_settled'],
    ['rejected', 'cancellation_revoked'],
    ['pending_approval', 'ignored'],
  ] as const)('maps %s full prorated refund updates to %s', (status, kind) => {
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentUpdated({ status, adjustmentType: 'full', itemTypes: ['partial'] }),
      ),
    ).toMatchObject({ kind });
  });

  it('settles an approved full refund and lifts a rejected one on adjustment.updated', () => {
    expect(adapter.mapWebhookEvent(paddleAdjustmentUpdated({ status: 'approved' }))).toMatchObject({
      kind: 'refund_settled',
      providerSubscriptionId: 'sub_01paddle000001',
    });
    expect(adapter.mapWebhookEvent(paddleAdjustmentUpdated({ status: 'rejected' }))).toMatchObject({
      kind: 'cancellation_revoked',
      reason: 'refund_rejected',
      providerSubscriptionId: 'sub_01paddle000001',
    });
  });

  it('ignores pending, partial, unrelated, and unlinked adjustment updates', () => {
    for (const event of [
      paddleAdjustmentUpdated({ status: 'pending_approval' }),
      paddleAdjustmentUpdated({ status: 'approved', itemTypes: ['partial'] }),
      paddleAdjustmentUpdated({ status: 'rejected', itemTypes: ['partial'] }),
      paddleAdjustmentUpdated({ status: 'approved', action: 'credit' }),
      paddleAdjustmentUpdated({ status: 'approved', subscriptionId: null }),
    ]) {
      expect(adapter.mapWebhookEvent(event)).toMatchObject({ kind: 'ignored' });
    }
  });

  it('a full refund still revokes — including the dashboard shape and an unreadable one', () => {
    // Paddle's adjustment-level `type` defaults to `partial`, and a
    // dashboard full-amount refund can arrive as `partial` with every
    // ITEM marked `full` — retained as the fallback for this shape.
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ action: 'refund', itemTypes: ['full', 'full'] }),
      ),
    ).toMatchObject({ kind: 'cancellation_scheduled', reason: 'refund' });
    // No items to read → keep the pre-existing behaviour. Failing to
    // revoke a real refund is the worse of the two errors.
    expect(
      adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'refund', itemTypes: [] })),
    ).toMatchObject({ kind: 'cancellation_scheduled', reason: 'refund' });
  });

  it('chargeback_reverse maps to cancellation_revoked — the dispute was won', () => {
    expect(
      adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'chargeback_reverse' })),
    ).toMatchObject({
      kind: 'cancellation_revoked',
      reason: 'chargeback_reverse',
      providerSubscriptionId: 'sub_01paddle000001',
    });
    // Unlinked to a subscription there is nothing to restore.
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ action: 'chargeback_reverse', subscriptionId: null }),
      ),
    ).toMatchObject({ kind: 'ignored' });
  });

  it('a partial CHARGEBACK is never filtered — Paddle raises it and the money is gone', () => {
    expect(
      adapter.mapWebhookEvent(
        paddleAdjustmentCreated({ action: 'chargeback', itemTypes: ['partial'] }),
      ),
    ).toMatchObject({ kind: 'cancellation_scheduled', reason: 'chargeback' });
  });

  it('ignores unrecognized event types and throws on missing event_id', () => {
    expect(
      adapter.mapWebhookEvent({ event_id: 'evt_x', event_type: 'customer.updated', data: {} }),
    ).toEqual({ kind: 'ignored', providerEventId: 'evt_x', eventType: 'customer.updated' });
    expect(() => adapter.mapWebhookEvent({ data: {} })).toThrow(/event_id/);
  });

  it('maps SYNCHRONOUSLY and asks Paddle nothing — the seam allows async, this mapper is not', () => {
    // The `BillingProvider` seam accepts a promise-returning mapper
    // because Razorpay's must resolve a subscription id through the
    // invoices API. Paddle's payloads carry `subscription_id` inline, so
    // its mapper stays pure — and its own signature says so. A future
    // edit that adds a fetch here has to change that signature and every
    // synchronous call site, which is the point of not widening it.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const event = adapter.mapWebhookEvent(paddleAdjustmentCreated({ action: 'refund' }));
      expect(event).not.toBeInstanceOf(Promise);
      expect(event).toMatchObject({ kind: 'cancellation_scheduled', reason: 'refund' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PaddleAdapter checkout + cancel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createCheckout returns the overlay payload without any API call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_CLIENT_TOKEN: 'test_abc', PADDLE_ENV: 'sandbox' });
    const session = await adapter.createCheckout({
      workspaceId: WORKSPACE,
      userEmail: 'user@example.com',
      tierId: 'plus',
      cycle: 'monthly',
      providerPriceId: 'pri_x',
    });
    expect(session).toEqual({
      provider: 'paddle',
      kind: 'overlay',
      priceId: 'pri_x',
      clientToken: 'test_abc',
      environment: 'sandbox',
      customData: { workspace_id: WORKSPACE, sig: expect.any(String) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Regression (2026-07-20): the writer emitted `workspaceId` while the
  // reader looked for `custom_data.workspace_id`, so EVERY first purchase
  // was unattributable — the webhook 200'd and wrote nothing. Both sides
  // passed their own fixtures; only feeding the writer's output through
  // the reader catches it. Paddle stores custom_data verbatim, so this
  // round-trip mirrors production exactly.
  it('createCheckout customData round-trips through the webhook reader', async () => {
    const adapter = makeAdapter({ PADDLE_CLIENT_TOKEN: 'test_abc' });
    const session = await adapter.createCheckout({
      workspaceId: WORKSPACE,
      userEmail: 'user@example.com',
      tierId: 'plus',
      cycle: 'monthly',
      providerPriceId: 'pri_x',
    });

    if (session.provider !== 'paddle') throw new Error('expected a paddle session');

    // Paddle echoes customData back on the subscription as `custom_data`.
    const echoed = paddleSubscriptionActivated({ customData: session.customData });
    const event = adapter.mapWebhookEvent(echoed);

    if (event.kind !== 'subscription') throw new Error('expected a subscription event');
    expect(event.subscription.workspaceId).toBe(WORKSPACE);
  });

  it('createCheckout fails closed without a client token', async () => {
    const adapter = makeAdapter({});
    await expect(
      adapter.createCheckout({
        workspaceId: WORKSPACE,
        userEmail: 'user@example.com',
        tierId: 'plus',
        cycle: 'monthly',
        providerPriceId: 'pri_x',
      }),
    ).rejects.toMatchObject({ code: 'BILLING_NOT_PROVISIONED' });
  });

  it('cancelSubscription POSTs next_billing_period to the sandbox host', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
    await adapter.cancelSubscription('sub_01paddle000001');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox-api.paddle.com/subscriptions/sub_01paddle000001/cancel');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pdl_test_key');
    expect((init.headers as Record<string, string>)['Paddle-Version']).toBe('1');
    expect(init.body).toBe(JSON.stringify({ effective_from: 'next_billing_period' }));
  });

  // QA-billing-20260901-07: Paddle mints a $0, `ready`-status transaction
  // with this origin every time a customer updates their card through
  // `paymentMethodSession`'s own portal. It never bills and carries no
  // document, so it must never reach the customer's invoice list under
  // the same "Due" label a genuine past-due dunning invoice gets.
  describe('listInvoices', () => {
    function transactionsResponse(rows: unknown[]) {
      return new Response(JSON.stringify({ data: rows, meta: { pagination: {} } }), {
        status: 200,
      });
    }

    it('drops a subscription_payment_method_change transaction from the list', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        transactionsResponse([
          {
            id: 'txn_paid',
            status: 'paid',
            billed_at: '2026-07-30T18:00:27.000Z',
            currency_code: 'USD',
            details: { totals: { grand_total: '18101' } },
          },
          {
            id: 'txn_card_verify',
            status: 'ready',
            origin: 'subscription_payment_method_change',
            billed_at: null,
            created_at: '2026-08-17T02:05:17.000Z',
            currency_code: 'USD',
            details: { totals: { grand_total: '0' } },
          },
        ]),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
      const result = await adapter.listInvoices('sub_01paddle000001');
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0]?.id).toBe('txn_paid');
      // Not a hidden/omitted row either — it isn't a billing document at
      // all, so counting it as "couldn't be displayed" would be its own
      // false claim.
      expect(result.omitted).toBe(0);
    });

    it('keeps a $0 transaction of any OTHER origin (never-fabricate: origin is the only signal read)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        transactionsResponse([
          {
            id: 'txn_zero_other',
            status: 'billed',
            billed_at: '2026-07-30T18:00:27.000Z',
            currency_code: 'USD',
            details: { totals: { grand_total: '0' } },
          },
        ]),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
      const result = await adapter.listInvoices('sub_01paddle000001');
      expect(result.invoices).toHaveLength(1);
      expect(result.invoices[0]?.id).toBe('txn_zero_other');
    });
  });

  // The gate on the ONE outbound cancel. On a live account
  // `adjustment.created` fires while a refund is still
  // `pending_approval`, and sandbox auto-approves — so the pending shape
  // is invisible to every other test here.
  // The gate on the ONE outbound cancel, and the only thing allowed to
  // lift a local verdict. On a live account `adjustment.created` fires
  // while a refund is still `pending_approval`, and sandbox
  // auto-approves — so the pending shape is invisible to every other
  // test here.
  describe('providerCancellationFacts', () => {
    const adjustmentsBody = (rows: unknown[]) =>
      new Response(JSON.stringify({ data: rows, meta: { pagination: { has_more: false } } }), {
        status: 200,
      });
    const facts = (rows: unknown[]) => {
      const identified = rows.map((row, i) => ({
        ...(row as Record<string, unknown>),
        id: `adj_fixture_${i}`,
        transaction_id: `txn_fixture_${i}`,
      }));
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('/transactions/')
            ? new Response(
                JSON.stringify({
                  data: {
                    id: url.split('/').pop(),
                    subscription_id: 'sub_x',
                    origin: 'subscription_recurring',
                    status: 'completed',
                    details: { totals: { grand_total: '900' } },
                  },
                }),
              )
            : adjustmentsBody(identified),
        ),
      );
      return makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x');
    };
    const FULL = [{ type: 'full' }];

    it('asks for THIS subscription only', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(adjustmentsBody([]));
      vi.stubGlobal('fetch', fetchSpy);
      await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_01paddle000001');
      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe(
        'https://sandbox-api.paddle.com/adjustments?subscription_id=sub_01paddle000001&per_page=50',
      );
    });

    it('an APPROVED full refund is settled', async () => {
      expect(await facts([{ action: 'refund', status: 'approved', items: FULL }])).toEqual({
        settled: 'refund',
        refuted: { refund: false, chargeback: false },
      });
    });

    it('a still-pending refund is neither settled nor refuted', async () => {
      // Nothing has been decided — the caller must neither cancel at the
      // provider nor lift the local verdict.
      expect(await facts([{ action: 'refund', status: 'pending_approval', items: FULL }])).toEqual({
        settled: null,
        refuted: { refund: false, chargeback: false },
      });
    });

    it.each(['rejected', 'reversed'])('a %s refund REFUTES the refund verdict', async (status) => {
      // Checking only `rejected` left an approved-then-`reversed` refund
      // counting as neither settled nor refuted, so its verdict stood
      // forever over a paying customer (Codex stop-review, 2026-07-31).
      expect(await facts([{ action: 'refund', status, items: FULL }])).toEqual({
        settled: null,
        refuted: { refund: true, chargeback: false },
      });
    });

    it.each([
      ['approved', 'refund', false],
      ['pending_approval', null, false],
      ['rejected', null, true],
      ['reversed', null, true],
    ] as const)(
      'reads %s full prorated refunds consistently with webhooks',
      async (status, settled, refuted) => {
        expect(
          await facts([{ action: 'refund', type: 'full', status, items: [{ type: 'partial' }] }]),
        ).toEqual({ settled, refuted: { refund: refuted, chargeback: false } });
      },
    );

    it('an approved PARTIAL refund is not an exit — same rule as the webhook mapping', async () => {
      expect(
        await facts([{ action: 'refund', status: 'approved', items: [{ type: 'partial' }] }]),
      ).toEqual({ settled: null, refuted: { refund: false, chargeback: false } });
    });

    it('a chargeback needs no approval — Paddle raised it and the funds are gone', async () => {
      expect(await facts([{ action: 'chargeback', status: 'pending_approval' }])).toEqual({
        settled: 'chargeback',
        refuted: { refund: false, chargeback: false },
      });
    });

    it('a reversed chargeback REFUTES the chargeback verdict only', async () => {
      // The refund side must stay false. Collapsing both into one
      // "something was refuted" flag let a reversed chargeback lift a
      // refund verdict Paddle had never rejected.
      expect(
        await facts([
          { action: 'chargeback', status: 'reversed' },
          { action: 'chargeback_reverse', status: 'approved' },
        ]),
      ).toEqual({ settled: null, refuted: { refund: false, chargeback: true } });
    });

    it('a reversed chargeback beside a PENDING refund refutes neither the refund', async () => {
      // The exact mis-erase: our row says `refund`, the refund is still
      // pending, and an unrelated old chargeback was reversed. Reporting
      // the facts separately is what stops the caller lifting the refund.
      expect(
        await facts([
          { action: 'chargeback', status: 'reversed' },
          { action: 'refund', status: 'pending_approval', items: FULL },
        ]),
      ).toEqual({ settled: null, refuted: { refund: false, chargeback: true } });
    });

    it('a LATER chargeback still counts after an earlier one was reversed', async () => {
      // An earlier revision suppressed every chargeback whenever ANY
      // `chargeback_reverse` row existed, so a subscription that won
      // dispute A and then genuinely lost dispute B reported nothing
      // settled forever while Paddle kept billing.
      expect(
        await facts([
          { action: 'chargeback', status: 'reversed' },
          { action: 'chargeback_reverse', status: 'approved' },
          { action: 'chargeback', status: 'approved' },
        ]),
      ).toMatchObject({ settled: 'chargeback' });
    });

    it('SETTLED outranks refuted — a live chargeback beside a rejected refund', async () => {
      expect(
        await facts([
          { action: 'refund', status: 'rejected', items: FULL },
          { action: 'chargeback', status: 'approved' },
        ]),
      ).toEqual({ settled: 'chargeback', refuted: { refund: true, chargeback: false } });
    });

    it('an unreadable provider answers null, never a fact', async () => {
      // Any object would read as "Paddle confirms…", a claim a failed
      // read cannot make.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      expect(await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('s')).toBeNull();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
      expect(await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('s')).toBeNull();

      // A 200 whose body is not the documented shape is equally unread.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('{"data":null}', { status: 200 })),
      );
      expect(await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('s')).toBeNull();
    });

    // 2026-08-25. The failure above is correct and was, for eleven days,
    // undiagnosable: the log line carried `status=403` and nothing else,
    // so a missing API-key permission looked identical to a revoked key,
    // a wrong environment and a blocked account. It took a hand-run curl
    // to learn that Paddle had been naming the cause in the response body
    // on every one of 1,223 attempts.
    //
    // The line now carries that body. This test pins the fact that it
    // reaches the log, because the whole defect was a diagnostic that
    // existed and was discarded.
    it('logs the provider error BODY, not just the status, on a failed read', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                error: {
                  type: 'request_error',
                  code: 'forbidden',
                  detail: 'You do not have permission to perform this request (adjustment.read)',
                },
              }),
              { status: 403 },
            ),
          ),
        );
        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('s'),
        ).toBeNull();

        const line = errorSpy.mock.calls
          .map((call) => String(call[0]))
          .find((text) => text.includes('paddle.api_read.failed'));
        expect(line).toBeDefined();
        expect(line).toContain('status=403');
        // The half that was missing — the sentence that names the fix.
        expect(line).toContain('adjustment.read');
      } finally {
        errorSpy.mockRestore();
      }
    });

    // Pagination (D253). `settled` is about to gate whether a refunded
    // customer may buy again, so "which page was the chargeback on?" is
    // the difference between a lockout and a repurchase during a live
    // dispute. Paddle answers `meta.pagination.has_more` + a `next` URL
    // carrying the `after` cursor.
    describe('pagination', () => {
      const page = (rows: unknown[], pagination: Record<string, unknown>) =>
        new Response(JSON.stringify({ data: rows, meta: { pagination } }), { status: 200 });
      const nextUrl = (after: string) =>
        `https://sandbox-api.paddle.com/adjustments?subscription_id=sub_x&per_page=50&after=${after}`;

      it.each([undefined, {}, { has_more: 'false' }])(
        'refuses an incomplete absence proof %j',
        async (pagination) => {
          vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(page([], pagination as Record<string, unknown>)),
          );
          expect(
            await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
          ).toBeNull();
        },
      );
      it('keeps the original subscription filter on a hostile or incomplete cursor', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input) => {
            const url = new URL(String(input));
            calls.push(String(input));
            expect(url.host).toBe('sandbox-api.paddle.com');
            expect(url.searchParams.get('subscription_id')).toBe('sub_x');
            expect(url.searchParams.get('per_page')).toBe('50');
            expect(url.searchParams.has('action')).toBe(false);
            expect(url.searchParams.has('status')).toBe(false);
            return calls.length === 1
              ? page([], {
                  has_more: true,
                  next: 'https://wrong.example/adjustments?subscription_id=sub_other&after=cursor&action=refund&status=approved',
                })
              : page([], { has_more: false });
          }),
        );
        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
        ).toEqual({ settled: null, refuted: { refund: false, chargeback: false } });
        expect(calls).toHaveLength(2);
      });

      it('walks past page one — a chargeback on page two is still settled', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn(async (url: string | URL) => {
            calls.push(String(url));
            return calls.length === 1
              ? page([{ action: 'refund', status: 'approved', items: FULL }], {
                  per_page: 50,
                  next: nextUrl('adj_p1_last'),
                  has_more: true,
                })
              : // `next` is populated on the last page too — only
                // `has_more` may end the walk.
                page([{ action: 'chargeback', status: 'approved' }], {
                  per_page: 50,
                  next: nextUrl('adj_p2_last'),
                  has_more: false,
                });
          }),
        );

        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
        ).toEqual({ settled: 'chargeback', refuted: { refund: false, chargeback: false } });
        expect(calls).toHaveLength(2);
        // Paddle's cursor, our host.
        expect(calls[1]).toBe(nextUrl('adj_p1_last'));
      });

      it('a page it could not read is UNREAD, never the pages it did read', async () => {
        // The subtler form of the same bug: page one holds an approved
        // refund, page two is unknown — answering `refund` here would
        // unlock repurchase over a chargeback nobody fetched.
        const fetchSpy = vi
          .fn()
          .mockResolvedValueOnce(
            page([{ action: 'refund', status: 'approved', items: FULL }], {
              per_page: 50,
              next: nextUrl('adj_p1_last'),
              has_more: true,
            }),
          )
          .mockResolvedValueOnce(new Response('{}', { status: 500 }));
        vi.stubGlobal('fetch', fetchSpy);

        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
        ).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('reports UNREAD at the page cap instead of a truncated scan', async () => {
        const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const fetchSpy = vi.fn(async () =>
          page([{ action: 'refund', status: 'approved', items: FULL }], {
            per_page: 50,
            next: nextUrl('adj_endless'),
            has_more: true,
          }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
        ).toBeNull();
        expect(fetchSpy).toHaveBeenCalledTimes(10);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('paddle.cancellation_facts.page_cap sub=sub_x'),
        );
        warnSpy.mockRestore();
      });

      it('reads one adjustment page and the exact transaction, without speculative paging', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn(async (url: string) => {
            calls.push(url);
            return url.includes('/transactions/')
              ? new Response(
                  JSON.stringify({
                    data: {
                      id: 'txn_ordinary',
                      subscription_id: 'sub_x',
                      origin: 'subscription_recurring',
                      status: 'completed',
                      details: { totals: { grand_total: '900' } },
                    },
                  }),
                )
              : adjustmentsBody([
                  {
                    id: 'adj_ordinary',
                    transaction_id: 'txn_ordinary',
                    action: 'refund',
                    status: 'approved',
                    items: FULL,
                  },
                ]);
          }),
        );
        expect(
          await makeAdapter({ PADDLE_API_KEY: 'k' }).providerCancellationFacts('sub_x'),
        ).toEqual({ settled: 'refund', refuted: { refund: false, chargeback: false } });
        expect(calls).toEqual([
          'https://sandbox-api.paddle.com/adjustments?subscription_id=sub_x&per_page=50',
          'https://sandbox-api.paddle.com/transactions/txn_ordinary',
        ]);
      });
    });
  });

  it('cancelSubscription maps provider 4xx/5xx + network errors to BILLING_PROVIDER_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":{}}', { status: 409 })),
    );
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
    await expect(adapter.cancelSubscription('sub_x')).rejects.toMatchObject({
      code: 'BILLING_PROVIDER_ERROR',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(adapter.cancelSubscription('sub_x')).rejects.toMatchObject({
      code: 'BILLING_PROVIDER_ERROR',
    });
  });

  it('changePlan prorates upgrades immediately', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });

    await adapter.changePlan('sub_upgrade', 'pri_pro_a', { kind: 'immediate_prorated' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox-api.paddle.com/subscriptions/sub_upgrade');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      items: [{ price_id: 'pri_pro_a', quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
    });
  });

  it('deferred preview validates the renewal separately from the no-bill item update', async () => {
    const effectiveAt = '2026-08-20T12:00:00.000Z';
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { next_billed_at: effectiveAt, update_summary: null } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              updated_at: '2026-07-20T12:00:00.000Z',
              items: [{ price: { id: 'pri_plus_m' } }],
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });

    await adapter.previewPlanChange('sub_downgrade', 'pri_plus_m', {
      kind: 'next_period_no_proration',
      effectiveAt,
    });
    const result = await adapter.changePlan('sub_downgrade', 'pri_plus_m', {
      kind: 'next_period_no_proration',
      effectiveAt,
    });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://sandbox-api.paddle.com/subscriptions/sub_downgrade/preview',
      'https://sandbox-api.paddle.com/subscriptions/sub_downgrade',
    ]);
    for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
      expect(JSON.parse(String(init.body))).toEqual({
        items: [{ price_id: 'pri_plus_m', quantity: 1 }],
        proration_billing_mode: 'do_not_bill',
      });
    }
    expect(result).toEqual({
      providerPriceId: 'pri_plus_m',
      providerUpdatedAt: '2026-07-20T12:00:00.000Z',
    });
  });

  it.each([
    { next_billed_at: '2027-08-20T12:00:00.000Z', update_summary: null },
    { next_billed_at: '2026-08-20T12:00:00.000Z' },
    { next_billed_at: '2026-08-20T12:00:00.000Z', update_summary: {} },
    {
      next_billed_at: '2026-08-20T12:00:00.000Z',
      update_summary: { result: { action: 'charge', amount: 0, currency_code: 'USD' } },
    },
    { next_billed_at: null },
    { next_billed_at: 'invalid' },
    {
      next_billed_at: '2026-08-20T12:00:00.000Z',
      update_summary: { result: { action: 'charge', amount: '100', currency_code: 'USD' } },
    },
    {
      next_billed_at: '2026-08-20T12:00:00.000Z',
      update_summary: { result: { action: 'credit', amount: '-100', currency_code: 'USD' } },
    },
  ])(
    'refuses a deferred update when the preview violates the paid-period contract: %j',
    async (data) => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);
      await expect(
        makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' }).previewPlanChange(
          'sub_deferred',
          'pri_plus_a',
          {
            kind: 'next_period_no_proration',
            effectiveAt: '2026-08-20T12:00:00.000Z',
          },
        ),
      ).rejects.toMatchObject({
        code: 'PLAN_CHANGE_UNSUPPORTED',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/preview$/);
    },
  );

  it.each(['charge', 'credit'])(
    'accepts an explicit zero %s while preserving renewal',
    async (action) => {
      const nextBilledAt = '2026-08-20T12:00:00.000Z';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              data: {
                next_billed_at: nextBilledAt,
                update_summary: { result: { action, amount: '0', currency_code: 'USD' } },
              },
            }),
            { status: 200 },
          ),
        ),
      );
      await expect(
        makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' }).previewPlanChange(
          'sub_zero',
          'pri_plus_m',
          {
            kind: 'next_period_no_proration',
            effectiveAt: nextBilledAt,
          },
        ),
      ).resolves.toEqual({ result: { action, amount: '0', currencyCode: 'USD' }, nextBilledAt });
    },
  );

  it('a failed deferred preview returns the provider error without attempting a mutation', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' }).previewPlanChange(
        'sub_deferred',
        'pri_plus_m',
        {
          kind: 'next_period_no_proration',
          effectiveAt: '2026-08-20T12:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_PROVIDER_ERROR',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/preview$/);
  });

  it('previewPlanChange hits the read-only preview endpoint and returns the update summary', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            next_billed_at: '2027-07-30T18:00:27.060Z',
            update_summary: {
              credit: { amount: '-18999', currency_code: 'USD' },
              charge: { amount: '1900', currency_code: 'USD' },
              result: { action: 'charge', amount: '18101', currency_code: 'USD' },
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });

    const preview = await adapter.previewPlanChange('sub_prev', 'pri_pro_a', {
      kind: 'immediate_prorated',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox-api.paddle.com/subscriptions/sub_prev/preview');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      items: [{ price_id: 'pri_pro_a', quantity: 1 }],
      proration_billing_mode: 'prorated_immediately',
    });
    expect(preview).toEqual({
      result: { action: 'charge', amount: '18101', currencyCode: 'USD' },
      nextBilledAt: '2027-07-30T18:00:27.060Z',
    });
  });

  it('previewPlanChange returns null fields on a malformed summary and throws on 5xx', async () => {
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
    // Provider answered 200 with an unexpected shape — no invented
    // numbers, null fields instead.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: { update_summary: { result: { action: 'refund' } } } }),
          {
            status: 200,
          },
        ),
      ),
    );
    expect(
      await adapter.previewPlanChange('sub_odd', 'pri_pro_a', { kind: 'immediate_prorated' }),
    ).toEqual({ result: null, nextBilledAt: null });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(
      adapter.previewPlanChange('sub_down', 'pri_pro_a', { kind: 'immediate_prorated' }),
    ).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR' });
  });

  it('classifies provider 4xx as definitive but keeps 5xx ambiguous', async () => {
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 422 })));
    await expect(
      adapter.changePlan('sub_4xx', 'pri_plus_m', { kind: 'immediate_prorated' }),
    ).rejects.toMatchObject({ details: { providerOutcome: 'definitive' } });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(
      adapter.changePlan('sub_5xx', 'pri_plus_m', { kind: 'immediate_prorated' }),
    ).rejects.toMatchObject({ details: undefined });
  });

  it('resume continues the retained period without starting a charge', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });

    await adapter.resumeSubscription('sub_paused');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox-api.paddle.com/subscriptions/sub_paused/resume');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      effective_from: 'immediately',
      on_resume: 'continue_existing_billing_period',
    });
  });

  it('resume reports an ended retained period without falling back to a charge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'subscription_continuing_existing_billing_period_not_allowed' },
          }),
          { status: 400 },
        ),
      ),
    );
    const adapter = makeAdapter({ PADDLE_API_KEY: 'pdl_test_key' });

    await expect(adapter.resumeSubscription('sub_expired_pause')).rejects.toMatchObject({
      code: 'RESUME_PERIOD_ENDED',
    });
  });
});

describe('PaddleAdapter exact upgrade-charge evidence', () => {
  afterEach(() => vi.unstubAllGlobals());
  const start = '2026-10-10T11:59:58.000Z',
    end = '2026-10-10T11:59:59.000Z';
  const intent = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    sub = 'sub_exact';
  it.each([
    { type: 'full', items: [{ type: 'partial' }], full: true },
    { type: 'partial', items: [{ type: 'full' }], full: false },
    { type: 'partial', items: [{ type: 'tax' }], full: false },
    { items: [], full: null },
  ])('requires explicit full adjustment coverage: %j', async ({ full, ...coverage }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              id: 'adj_exact',
              transaction_id: 'txn_exact',
              subscription_id: sub,
              action: 'refund',
              status: 'approved',
              ...coverage,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await makeAdapter({
      PADDLE_API_KEY: 'sandbox-fixture',
      PADDLE_ENV: 'sandbox',
    }).readRefundAdjustment({ adjustmentId: 'adj_exact', transactionId: 'txn_exact' }, sub);
    expect(result).toEqual({ status: 'approved', full });
  });
  function rawTransaction(id = 'txn_exact', status = 'completed') {
    const signature = createHmac('sha256', SECRET)
      .update(`paddle:upgrade:${intent}:${WORKSPACE}:${sub}:pri_target`)
      .digest('hex');
    return {
      id,
      subscription_id: sub,
      origin: 'subscription_update',
      status,
      created_at: '2026-10-10T11:59:58.500Z',
      custom_data: {
        workspace_id: WORKSPACE,
        sig: createHmac('sha256', SECRET).update(`paddle:workspace:${WORKSPACE}`).digest('hex'),
        upgrade_intent_id: intent,
        upgrade_price_id: 'pri_target',
        upgrade_sig: signature,
      },
      details: {
        totals: { grand_total: '1000' },
        line_items: [
          {
            price_id: 'pri_target',
            quantity: 1,
            totals: { total: '1900' },
            proration: {
              rate: '0.9',
              billing_period: {
                starts_at: '2026-10-10T11:59:58.500Z',
                ends_at: '2026-11-09T12:00:00.000Z',
              },
            },
          },
          {
            price_id: 'pri_base',
            quantity: -1,
            totals: { total: '-900' },
            proration: {
              rate: '0.9',
              billing_period: {
                starts_at: '2026-10-10T11:59:58.500Z',
                ends_at: '2026-11-09T12:00:00.000Z',
              },
            },
          },
        ],
      },
    };
  }
  function install(
    rows: Array<{ id: string; status?: string }>,
    pagination = { has_more: false, next: '' },
  ) {
    const fetchMock = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/transactions')
        return new Response(JSON.stringify({ data: rows, meta: { pagination } }), { status: 200 });
      const id = url.pathname.split('/').at(-1)!;
      return new Response(
        JSON.stringify({ data: rawTransaction(id, rows.find((r) => r.id === id)?.status) }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  it('verifies both signatures and exposes only explicit prorated debit/credit metadata', async () => {
    install([{ id: 'txn_exact' }]);
    const value = await makeAdapter({
      PADDLE_API_KEY: 'sandbox-fixture',
      PADDLE_ENV: 'sandbox',
    }).readRefundTransaction('txn_exact');
    expect(value).toMatchObject({
      upgradeIntentId: intent,
      upgradePriceId: 'pri_target',
      positiveCharge: true,
      lines: [
        { priceId: 'pri_target', quantity: 1, total: '1900' },
        { priceId: 'pri_base', quantity: -1, total: '-900' },
      ],
    });
    expect(value).not.toHaveProperty('custom_data');
    expect(value).not.toHaveProperty('workspace_id');
  });
  it('does not accept a tampered intent even with the original workspace signature', async () => {
    const t = rawTransaction();
    t.custom_data.upgrade_intent_id = 'tampered';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: t }), { status: 200 })),
    );
    expect(
      await makeAdapter({
        PADDLE_API_KEY: 'sandbox-fixture',
        PADDLE_ENV: 'sandbox',
      }).readRefundTransaction(t.id),
    ).toMatchObject({ upgradeIntentId: null, upgradePriceId: null });
  });
  it('discovers one exact transaction inside frozen filters without a status filter', async () => {
    const fetchMock = install([{ id: 'txn_exact' }]);
    const found = await makeAdapter({
      PADDLE_API_KEY: 'sandbox-fixture',
      PADDLE_ENV: 'sandbox',
    }).discoverUpgradeTransaction(sub, intent, start, end);
    expect(found?.id).toBe('txn_exact');
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.host).toBe('sandbox-api.paddle.com');
    expect(url.searchParams.get('subscription_id')).toBe(sub);
    expect(url.searchParams.get('created_at[GTE]')).toBe(start);
    expect(url.searchParams.get('created_at[LTE]')).toBe(end);
    expect(url.searchParams.has('status')).toBe(false);
  });
  it('rejects a second inherited-token candidate even when it is not completed', async () => {
    install([{ id: 'txn_exact' }, { id: 'txn_other', status: 'billed' }]);
    expect(
      await makeAdapter({
        PADDLE_API_KEY: 'sandbox-fixture',
        PADDLE_ENV: 'sandbox',
      }).discoverUpgradeTransaction(sub, intent, start, end),
    ).toBeNull();
  });
  it('reports unknown when pagination is missing or exceeds the bounded scan', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'sandbox-fixture', PADDLE_ENV: 'sandbox' });
    expect(await adapter.discoverUpgradeTransaction(sub, intent, start, end)).toBeNull();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [],
            meta: {
              pagination: {
                has_more: true,
                next: 'https://sandbox-api.paddle.com/transactions?after=cursor',
              },
            },
          }),
          { status: 200 },
        ),
    );
    expect(await adapter.discoverUpgradeTransaction(sub, intent, start, end)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('retains frozen filters and never sends the API key to a cursor-supplied host', async () => {
    let page = 0;
    const mock = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.host).toBe('sandbox-api.paddle.com');
      if (url.pathname !== '/transactions')
        return new Response(JSON.stringify({ data: rawTransaction() }), { status: 200 });
      expect(url.searchParams.get('subscription_id')).toBe(sub);
      expect(url.searchParams.get('created_at[LTE]')).toBe(end);
      expect(url.searchParams.has('status')).toBe(false);
      return new Response(
        JSON.stringify(
          page++ === 0
            ? {
                data: [],
                meta: {
                  pagination: {
                    has_more: true,
                    next: 'https://wrong.example/transactions?after=cursor&status=completed',
                  },
                },
              }
            : { data: [{ id: 'txn_exact' }], meta: { pagination: { has_more: false } } },
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', mock);
    expect(
      (
        await makeAdapter({
          PADDLE_API_KEY: 'sandbox-fixture',
          PADDLE_ENV: 'sandbox',
        }).discoverUpgradeTransaction(sub, intent, start, end)
      )?.id,
    ).toBe('txn_exact');
  });
  it('requires explicit no immediate transaction and a zero update summary before preview is safe', async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { next_billed_at: end, immediate_transaction: null, update_summary: null },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', mock);
    const adapter = makeAdapter({ PADDLE_API_KEY: 'sandbox-fixture', PADDLE_ENV: 'sandbox' });
    expect(await adapter.restoreUpgradeStage(sub, { priceId: 'pri_base' }, true)).toEqual({
      noBill: true,
      nextBilledAt: end,
    });
    expect(JSON.parse(String(mock.mock.calls[0]![1].body))).toEqual({
      items: [{ price_id: 'pri_base', quantity: 1 }],
      proration_billing_mode: 'do_not_bill',
    });
    mock.mockResolvedValue(
      new Response(JSON.stringify({ data: { next_billed_at: end } }), { status: 200 }),
    );
    expect((await adapter.restoreUpgradeStage(sub, { priceId: 'pri_base' }, true)).noBill).toBe(
      false,
    );
  });
});

describe('Paddle deletion billing evidence', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['canceled', 'stopped'],
    ['active', 'billable'],
    ['paused', 'billable'],
    ['past_due', 'billable'],
    ['future_status', 'unknown'],
  ])('classifies raw %s as %s', async (status, expected) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: { id: 'sub_delete', status } }))),
    );
    expect(
      await makeAdapter({
        PADDLE_API_KEY: 'sandbox_test',
        PADDLE_ENV: 'sandbox',
      }).deletionBillingState('sub_delete'),
    ).toBe(expected);
  });
  it.each([null, { id: 'other', status: 'canceled' }, { id: 'sub_delete' }])(
    'does not accept missing or malformed evidence %j',
    async (data) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            data === null
              ? new Response('', { status: 404 })
              : new Response(JSON.stringify({ data })),
          ),
      );
      expect(
        await makeAdapter({
          PADDLE_API_KEY: 'sandbox_test',
          PADDLE_ENV: 'sandbox',
        }).deletionBillingState('sub_delete'),
      ).toBe('unknown');
    },
  );
});
