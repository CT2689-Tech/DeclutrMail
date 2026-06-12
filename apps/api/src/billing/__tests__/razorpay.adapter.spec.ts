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

  it('maps lifecycle statuses: halted→past_due, paused→paused, cancelled/completed→canceled', () => {
    const cases: Array<[string, string, string]> = [
      ['subscription.halted', 'halted', 'past_due'],
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
