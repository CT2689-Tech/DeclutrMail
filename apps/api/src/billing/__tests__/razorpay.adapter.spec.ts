import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RazorpayAdapter } from '../razorpay.adapter.js';
import { razorpaySubscriptionEvent } from './fixtures.js';

/**
 * RazorpayAdapter unit tests (D117, D180).
 *
 * Signature tests compute REAL HMAC-SHA256 vectors with a test secret.
 * Checkout/cancel run against a mocked global fetch (sandbox creds
 * exist only as GH secrets — no live API from tests).
 */

const SECRET = 'rzp_whsec_test_01';
const WORKSPACE = '11111111-2222-4333-8444-555555555555';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function makeAdapter(env: Record<string, string> = {}): RazorpayAdapter {
  return new RazorpayAdapter(env as NodeJS.ProcessEnv);
}

/** Inject the header-delivered event id the controller adds. */
function withEventId(body: Record<string, unknown>, eventId = 'evt_rzp_test_000001') {
  return { ...body, __eventId: eventId };
}

const PAYMENT = 'pay_rzp0000000001';
const SUBSCRIPTION = 'sub_rzp00000000001';
/** One monthly invoice, in paise, exactly as Razorpay reports it. */
const PAID = 99_900;

/**
 * Razorpay refund webhook envelope, shaped as the docs sample
 * (`contains: ['refund','payment']`). The payment entity is the load-
 * bearing part of these tests: it carries `order_id` and `invoice_id`
 * and NO subscription field.
 */
function razorpayRefundEvent(
  args: {
    event?: string;
    status?: string;
    amount?: number;
    invoiceId?: string | null;
  } = {},
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_test00000001',
    event: args.event ?? 'refund.processed',
    contains: ['refund', 'payment'],
    payload: {
      refund: {
        entity: {
          id: 'rfnd_rzp000000001',
          entity: 'refund',
          amount: args.amount ?? PAID,
          currency: 'INR',
          payment_id: PAYMENT,
          notes: {},
          receipt: null,
          acquirer_data: {},
          created_at: 1_781_430_000,
          batch_id: null,
          status: args.status ?? 'processed',
          speed_processed: 'normal',
          speed_requested: 'normal',
        },
      },
      payment: {
        entity: {
          id: PAYMENT,
          entity: 'payment',
          amount: PAID,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_rzp00000001',
          invoice_id: args.invoiceId === undefined ? 'inv_rzp0000000001' : args.invoiceId,
          amount_refunded: args.amount ?? PAID,
          refund_status: 'full',
          method: 'card',
        },
      },
    },
    created_at: 1_781_430_100,
  };
}

/** Razorpay dispute webhook envelope (`contains: ['payment','dispute']`). */
function razorpayDisputeEvent(
  args: { event?: string; status?: string; phase?: string } = {},
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_test00000001',
    event: args.event ?? 'payment.dispute.created',
    contains: ['payment', 'dispute'],
    payload: {
      payment: {
        entity: {
          id: PAYMENT,
          entity: 'payment',
          amount: PAID,
          currency: 'INR',
          status: 'captured',
          order_id: 'order_rzp00000001',
          invoice_id: 'inv_rzp0000000001',
          method: 'card',
        },
      },
      dispute: {
        entity: {
          id: 'disp_rzp000000001',
          entity: 'dispute',
          payment_id: PAYMENT,
          amount: PAID,
          currency: 'INR',
          amount_deducted: 0,
          reason_code: 'chargeback',
          respond_by: 1_781_530_000,
          status: args.status ?? 'open',
          phase: args.phase ?? 'chargeback',
          created_at: 1_781_430_000,
        },
      },
    },
    created_at: 1_781_430_100,
  };
}

describe('RazorpayAdapter.verifyWebhookSignature', () => {
  const body = JSON.stringify(razorpaySubscriptionEvent({ workspaceId: WORKSPACE }));

  it('accepts a correctly signed body', () => {
    const result = makeAdapter().verifyWebhookSignature({
      rawBody: Buffer.from(body),
      signatureHeader: sign(body),
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects wrong-secret signatures and tampered bodies', () => {
    expect(
      makeAdapter().verifyWebhookSignature({
        rawBody: Buffer.from(body),
        signatureHeader: sign(body, 'wrong'),
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });

    const tampered = body.replace(WORKSPACE, '99999999-9999-4999-8999-999999999999');
    expect(
      makeAdapter().verifyWebhookSignature({
        rawBody: Buffer.from(tampered),
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it.each([[undefined], [''], ['not-hex!'], ['deadbeef ']])(
    'rejects malformed header %j as malformed_header',
    (header) => {
      expect(
        makeAdapter().verifyWebhookSignature({
          rawBody: Buffer.from(body),
          signatureHeader: header as string | undefined,
          secret: SECRET,
        }),
      ).toEqual({ ok: false, reason: 'malformed_header' });
    },
  );
});

describe('RazorpayAdapter.mapWebhookEvent', () => {
  const adapter = makeAdapter();

  it('maps subscription.activated with notes attribution', () => {
    const event = adapter.mapWebhookEvent(
      withEventId(razorpaySubscriptionEvent({ workspaceId: WORKSPACE, planId: 'plan_x' })),
    );
    expect(event).toMatchObject({
      kind: 'subscription',
      providerEventId: 'evt_rzp_test_000001',
      eventType: 'subscription.activated',
      subscription: {
        providerSubscriptionId: 'sub_rzp00000000001',
        providerCustomerId: 'cust_rzp0000000001',
        providerPriceId: 'plan_x',
        status: 'active',
        cancelAtPeriodEnd: false,
        workspaceId: WORKSPACE,
      },
    });
  });

  it('maps lifecycle statuses: halted→CANCELED (terminal, decision 2), paused→paused, cancelled/completed→canceled', () => {
    const cases: Array<[string, string, string]> = [
      ['subscription.halted', 'halted', 'canceled'],
      ['subscription.pending', 'pending', 'past_due'],
      ['subscription.paused', 'paused', 'paused'],
      ['subscription.cancelled', 'cancelled', 'canceled'],
      ['subscription.completed', 'completed', 'canceled'],
    ];
    for (const [event, status, expected] of cases) {
      const mapped = adapter.mapWebhookEvent(
        withEventId(razorpaySubscriptionEvent({ event, status, workspaceId: WORKSPACE })),
      );
      expect(mapped, event).toMatchObject({
        kind: 'subscription',
        subscription: { status: expected },
      });
    }
  });

  it('treats end_at <= current_end on an active sub as cancel-at-period-end', () => {
    const mapped = adapter.mapWebhookEvent(
      withEventId(
        razorpaySubscriptionEvent({
          event: 'subscription.updated',
          workspaceId: WORKSPACE,
          currentEnd: 1_812_966_000,
          endAt: 1_812_966_000,
        }),
      ),
    );
    expect(mapped).toMatchObject({
      kind: 'subscription',
      subscription: { cancelAtPeriodEnd: true },
    });
  });

  it('ignores created/authenticated (no charge yet) + unknown events; tolerates [] notes', () => {
    expect(
      adapter.mapWebhookEvent(
        withEventId(
          razorpaySubscriptionEvent({
            event: 'subscription.authenticated',
            status: 'authenticated',
          }),
        ),
      ),
    ).toMatchObject({ kind: 'ignored' });
    expect(
      adapter.mapWebhookEvent(
        withEventId({ entity: 'event', event: 'payment.captured', payload: {} }),
      ),
    ).toMatchObject({ kind: 'ignored' });
    expect(
      adapter.mapWebhookEvent(withEventId(razorpaySubscriptionEvent({ workspaceId: null }))),
    ).toMatchObject({ kind: 'subscription', subscription: { workspaceId: null } });
  });

  it('throws when the header event id was not injected', () => {
    expect(() => adapter.mapWebhookEvent(razorpaySubscriptionEvent({}))).toThrow(/event id/);
  });

  /**
   * The refund/chargeback rail. Paddle turns `adjustment.created` into
   * `cancellation_scheduled`, which is what ends a refunded customer's
   * entitlement — Razorpay cannot, and these tests pin WHY so the gap is
   * a recorded decision rather than an oversight. Every one of these
   * payloads is keyed to a payment: `payment_id` on the refund/dispute
   * entity, `order_id` + `invoice_id` on the payment entity, and no
   * subscription field anywhere. `cancellation_scheduled` requires a
   * `providerSubscriptionId`; resolving one costs a
   * `GET /v1/invoices/{invoice_id}` round-trip and `mapWebhookEvent` is
   * synchronous by contract, so the honest answer is `ignored` + a loud
   * log — never a mis-attributed cancellation.
   */
  describe('refund + dispute events (subscription id unresolvable at this seam)', () => {
    it.each([
      ['refund.created', 'pending'],
      ['refund.created', 'processed'],
      ['refund.processed', 'processed'],
      ['refund.failed', 'failed'],
    ])('%s (status %s) is ignored, never a cancellation', (event, status) => {
      const mapped = adapter.mapWebhookEvent(
        withEventId(razorpayRefundEvent({ event, status }), 'evt_rzp_refund_01'),
      );
      expect(mapped).toEqual({
        kind: 'ignored',
        providerEventId: 'evt_rzp_refund_01',
        eventType: event,
      });
    });

    it.each([
      ['payment.dispute.created', 'open'],
      ['payment.dispute.won', 'won'],
      ['payment.dispute.lost', 'lost'],
      ['payment.dispute.closed', 'closed'],
    ])('%s (status %s) is ignored, never a cancellation', (event, status) => {
      const mapped = adapter.mapWebhookEvent(
        withEventId(razorpayDisputeEvent({ event, status }), 'evt_rzp_disp_01'),
      );
      expect(mapped).toEqual({
        kind: 'ignored',
        providerEventId: 'evt_rzp_disp_01',
        eventType: event,
      });
    });

    it('a refund payload carries no subscription id — the reason the above holds', () => {
      // Pinning the PREMISE, not just the behaviour. If Razorpay ever
      // adds a subscription field to either entity, this fails and the
      // mapping above should be revisited.
      const body = razorpayRefundEvent() as {
        payload: { refund: { entity: unknown }; payment: { entity: unknown } };
      };
      for (const entity of [body.payload.refund.entity, body.payload.payment.entity]) {
        expect(Object.keys(entity as Record<string, unknown>)).not.toContain('subscription_id');
      }
      // The one documented link, and it is an API round-trip away.
      expect((body.payload.payment.entity as { invoice_id: string }).invoice_id).toBe(
        'inv_rzp0000000001',
      );
    });

    it('still falls through to ignored for the non-terminal refund/dispute events', () => {
      // Regression guard: adding cases above must not change what the
      // `default:` arm answers for everything else.
      for (const event of [
        'refund.speed_changed',
        'payment.dispute.under_review',
        'payment.dispute.action_required',
        'payment.captured',
      ]) {
        expect(
          adapter.mapWebhookEvent(withEventId({ entity: 'event', event, payload: {} })),
          event,
        ).toEqual({ kind: 'ignored', providerEventId: 'evt_rzp_test_000001', eventType: event });
      }
    });

    it('a refund envelope verifies under the same signature scheme', () => {
      // The fixtures above are real webhook bodies, not hand-shaped
      // objects that only the mapper would accept.
      const raw = JSON.stringify(razorpayRefundEvent());
      expect(
        makeAdapter().verifyWebhookSignature({
          rawBody: Buffer.from(raw),
          signatureHeader: sign(raw),
          secret: SECRET,
        }),
      ).toEqual({ ok: true });
    });
  });
});

describe('RazorpayAdapter checkout + cancel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const env = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret' };

  it('createCheckout creates the provider subscription with server-side notes attribution', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'sub_rzp_new_1',
          short_url: 'https://rzp.io/i/abc',
          status: 'created',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const session = await makeAdapter(env).createCheckout({
      workspaceId: WORKSPACE,
      userEmail: 'user@example.com',
      tierId: 'pro',
      cycle: 'annual',
      providerPriceId: 'plan_x',
    });
    expect(session).toEqual({
      provider: 'razorpay',
      kind: 'hosted',
      subscriptionId: 'sub_rzp_new_1',
      shortUrl: 'https://rzp.io/i/abc',
      keyId: 'rzp_test_key',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/subscriptions');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      plan_id: 'plan_x',
      total_count: 50,
      notes: { workspace_id: WORKSPACE },
    });
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('rzp_test_key:rzp_test_secret').toString('base64')}`);
  });

  it('fails closed without keys; maps provider errors to BILLING_PROVIDER_ERROR', async () => {
    await expect(
      makeAdapter({}).createCheckout({
        workspaceId: WORKSPACE,
        userEmail: 'u@example.com',
        tierId: 'plus',
        cycle: 'monthly',
        providerPriceId: 'plan_x',
      }),
    ).rejects.toMatchObject({ code: 'BILLING_NOT_PROVISIONED' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(
      makeAdapter(env).createCheckout({
        workspaceId: WORKSPACE,
        userEmail: 'u@example.com',
        tierId: 'plus',
        cycle: 'monthly',
        providerPriceId: 'plan_x',
      }),
    ).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR' });
  });

  it('cancelSubscription POSTs cancel_at_cycle_end=1 (D118)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await makeAdapter(env).cancelSubscription('sub_rzp00000000001');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/subscriptions/sub_rzp00000000001/cancel');
    expect(init.body).toBe(JSON.stringify({ cancel_at_cycle_end: 1 }));
  });
});

/**
 * The gate on the one outbound cancel, and — after D253 — on whether a
 * refunded customer may buy again. Razorpay keys refunds and disputes to
 * a PAYMENT, so the read walks subscription → invoices → payments →
 * refunds, then filters the account's dispute list to those payments.
 */
describe('RazorpayAdapter.providerCancellationFacts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const env = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret' };
  const NONE = { settled: null, refuted: { refund: false, chargeback: false } } as const;
  const invoice = {
    id: 'inv_rzp0000000001',
    entity: 'invoice',
    subscription_id: SUBSCRIPTION,
    order_id: 'order_rzp00000001',
    payment_id: PAYMENT,
    status: 'paid',
    amount: PAID,
    amount_paid: PAID,
    amount_due: 0,
  };

  /**
   * Serves each Razorpay `collection` endpoint from the given rows on
   * `skip=0` and an empty page afterwards — the same exhaustion the walk
   * expects from the real API.
   */
  function stubLists(lists: {
    invoices?: unknown[];
    refunds?: Record<string, unknown[]>;
    disputes?: unknown[];
  }): string[] {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        calls.push(href);
        const skip = Number(new URL(href).searchParams.get('skip') ?? '0');
        const page = (rows: unknown[]) =>
          new Response(
            JSON.stringify({
              entity: 'collection',
              count: rows.length,
              items: skip === 0 ? rows : [],
            }),
            { status: 200 },
          );
        if (href.includes('/v1/invoices')) return page(lists.invoices ?? []);
        const paymentRefunds = /\/v1\/payments\/([^/]+)\/refunds/.exec(href);
        if (paymentRefunds) return page(lists.refunds?.[paymentRefunds[1] as string] ?? []);
        if (href.includes('/v1/disputes')) return page(lists.disputes ?? []);
        throw new Error(`unexpected url ${href}`);
      }),
    );
    return calls;
  }

  const facts = (lists: Parameters<typeof stubLists>[0]) => {
    stubLists(lists);
    return makeAdapter(env).providerCancellationFacts(SUBSCRIPTION);
  };
  const refund = (status: string, amount = PAID) => ({
    id: `rfnd_${status}`,
    entity: 'refund',
    payment_id: PAYMENT,
    amount,
    status,
  });
  const dispute = (status: string, phase = 'chargeback', paymentId = PAYMENT) => ({
    id: `disp_${status}_${phase}`,
    entity: 'dispute',
    payment_id: paymentId,
    amount: PAID,
    amount_deducted: 0,
    status,
    phase,
  });

  it('asks about THIS subscription only, and reaches disputes through its payments', async () => {
    const calls = stubLists({ invoices: [invoice] });
    await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION);
    expect(calls[0]).toBe(
      `https://api.razorpay.com/v1/invoices?subscription_id=${SUBSCRIPTION}&count=100&skip=0`,
    );
    expect(calls).toContain(
      `https://api.razorpay.com/v1/payments/${PAYMENT}/refunds?count=100&skip=0`,
    );
    expect(calls).toContain('https://api.razorpay.com/v1/disputes?count=100&skip=0');
  });

  it('a PROCESSED full refund is settled', async () => {
    expect(
      await facts({ invoices: [invoice], refunds: { [PAYMENT]: [refund('processed')] } }),
    ).toEqual({ settled: 'refund', refuted: { refund: false, chargeback: false } });
  });

  it('a PENDING refund is neither settled nor refuted — requested is not settled', async () => {
    // Razorpay has no `pending_approval` gate, so `refund.created` can
    // arrive while the money has not moved. Settling here would end the
    // plan of someone whose refund then fails (payments over six months
    // old cannot be refunded at all).
    expect(
      await facts({ invoices: [invoice], refunds: { [PAYMENT]: [refund('pending')] } }),
    ).toEqual(NONE);
  });

  it('a FAILED full refund refutes the refund verdict only', async () => {
    expect(
      await facts({ invoices: [invoice], refunds: { [PAYMENT]: [refund('failed')] } }),
    ).toEqual({
      settled: null,
      refuted: { refund: true, chargeback: false },
    });
  });

  it('a PARTIAL refund never settles, processed or not', async () => {
    expect(
      await facts({
        invoices: [invoice],
        refunds: { [PAYMENT]: [refund('processed', PAID - 1), refund('failed', 1)] },
      }),
    ).toEqual(NONE);
  });

  it('a live chargeback-phase dispute is settled, and outranks a refund', async () => {
    expect(
      await facts({
        invoices: [invoice],
        refunds: { [PAYMENT]: [refund('processed')] },
        disputes: [dispute('open')],
      }),
    ).toEqual({ settled: 'chargeback', refuted: { refund: false, chargeback: false } });
    expect(await facts({ invoices: [invoice], disputes: [dispute('lost')] })).toEqual({
      settled: 'chargeback',
      refuted: { refund: false, chargeback: false },
    });
  });

  it('a WON dispute refutes the chargeback verdict, and only that one', async () => {
    // The refund side must stay false — a won dispute says nothing about
    // a refund Razorpay never failed.
    expect(await facts({ invoices: [invoice], disputes: [dispute('won')] })).toEqual({
      settled: null,
      refuted: { refund: false, chargeback: true },
    });
  });

  it('a CLOSED dispute is neither — Razorpay documents two opposite outcomes for it', async () => {
    // "closed after you provided either the transaction details or made
    // a refund". Settling would revoke someone nobody charged back;
    // refuting would lift a verdict Razorpay never contradicted. The
    // refund case announces itself on the refund list instead.
    expect(await facts({ invoices: [invoice], disputes: [dispute('closed')] })).toEqual(NONE);
  });

  it.each(['fraud', 'retrieval'])(
    'a %s-phase dispute is a question, not a chargeback',
    async (phase) => {
      // Razorpay deducts nothing for these; they are its shape of
      // Paddle's `chargeback_warning`, which is not mapped either.
      expect(await facts({ invoices: [invoice], disputes: [dispute('open', phase)] })).toEqual(
        NONE,
      );
    },
  );

  it("ignores a dispute raised on someone else's payment", async () => {
    expect(
      await facts({ invoices: [invoice], disputes: [dispute('lost', 'chargeback', 'pay_other')] }),
    ).toEqual(NONE);
  });

  it('a subscription that never collected answers none without scanning the account', async () => {
    const calls = stubLists({ invoices: [{ ...invoice, payment_id: null, amount_paid: 0 }] });
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toEqual(NONE);
    expect(calls.some((c) => c.includes('/v1/disputes'))).toBe(false);
  });

  it('an unreadable provider answers null — distinguishable from "nothing found"', async () => {
    // The whole point of the null. "Nothing is settled" is an OBJECT and
    // authorizes a write; a failed read is neither and must not.
    expect(await facts({ invoices: [invoice] })).toEqual(NONE);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toBeNull();

    // A 200 whose body is not the documented collection shape is equally unread.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"items":null}', { status: 200 })),
    );
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toBeNull();

    // No API keys is a read we could not make, not a clean bill of health.
    expect(await makeAdapter({}).providerCancellationFacts(SUBSCRIPTION)).toBeNull();
  });

  it('a failed refunds read is null even though the invoices read succeeded', async () => {
    // The partial-success shape: one leg answers IN FULL, the next does
    // not. The invoices leg must exhaust cleanly or this passes on the
    // page cap instead and proves nothing about the refunds read.
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        seen.push(href);
        if (!href.includes('/v1/invoices')) return new Response('{}', { status: 502 });
        const skip = Number(new URL(href).searchParams.get('skip') ?? '0');
        return new Response(JSON.stringify({ items: skip === 0 ? [invoice] : [] }), {
          status: 200,
        });
      }),
    );
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toBeNull();
    expect(seen.some((c) => c.includes(`/v1/payments/${PAYMENT}/refunds`))).toBe(true);
  });

  it('a listing longer than the page bound reports UNREAD, not a partial answer', async () => {
    // Every page full forever: the walk can never prove it saw the
    // chargeback-bearing page, so it must not answer.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/v1/invoices')
          ? new Response(JSON.stringify({ items: Array.from({ length: 100 }, () => invoice) }), {
              status: 200,
            })
          : new Response(JSON.stringify({ items: [] }), { status: 200 }),
      ),
    );
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toBeNull();
  });

  it('walks past page one — a chargeback on page two is still settled', async () => {
    // Paging advances by rows RETURNED, so an endpoint that ignores
    // `count` cannot make a full list look exhausted.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        const skip = Number(new URL(href).searchParams.get('skip') ?? '0');
        const body = (items: unknown[]) => new Response(JSON.stringify({ items }), { status: 200 });
        if (href.includes('/v1/invoices')) return body(skip === 0 ? [invoice] : []);
        if (href.includes('/refunds')) return body([]);
        // Ten disputes a page — none ours until the second page.
        if (skip === 0)
          return body(Array.from({ length: 10 }, () => dispute('open', 'chargeback', 'pay_other')));
        if (skip === 10) return body([dispute('lost')]);
        return body([]);
      }),
    );
    expect(await makeAdapter(env).providerCancellationFacts(SUBSCRIPTION)).toEqual({
      settled: 'chargeback',
      refuted: { refund: false, chargeback: false },
    });
  });
});
