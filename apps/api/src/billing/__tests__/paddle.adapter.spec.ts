import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaddleAdapter } from '../paddle.adapter.js';
import {
  paddleAdjustmentCreated,
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

  it('ignores unrecognized event types and throws on missing event_id', () => {
    expect(
      adapter.mapWebhookEvent({ event_id: 'evt_x', event_type: 'customer.updated', data: {} }),
    ).toEqual({ kind: 'ignored', providerEventId: 'evt_x', eventType: 'customer.updated' });
    expect(() => adapter.mapWebhookEvent({ data: {} })).toThrow(/event_id/);
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
    expect(init.body).toBe(JSON.stringify({ effective_from: 'next_billing_period' }));
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
});
