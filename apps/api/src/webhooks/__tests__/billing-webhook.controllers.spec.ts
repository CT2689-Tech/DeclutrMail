import { createHmac } from 'node:crypto';

import { subscriptionEvents, subscriptions, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { RawBodyRequest } from '@nestjs/common';

import { AppException } from '../../common/app-exception.js';
import type { DrizzleDb } from '../../db/db.module.js';
import type { SecurityEventsService } from '../../security-events/security-events.service.js';
import { BillingCatalog, type CatalogEntry } from '../../billing/billing-catalog.js';
import {
  BillingWebhookService,
  REFUND_PENDING_GRACE_DAYS,
} from '../../billing/billing-webhook.service.js';
import { PaddleAdapter } from '../../billing/paddle.adapter.js';
import { RazorpayAdapter } from '../../billing/razorpay.adapter.js';
import {
  paddleSubscriptionActivated,
  signedCustomData,
  razorpaySubscriptionEvent,
  TEST_PRICE_IDS,
} from '../../billing/__tests__/fixtures.js';
import { BillingPaddleWebhookController } from '../billing-paddle.controller.js';
import { BillingRazorpayWebhookController } from '../billing-razorpay.controller.js';

/**
 * Billing webhook controllers — end-to-end through the REAL adapters
 * (real HMAC verification) and the REAL BillingWebhookService against
 * PGlite (D117, D180, D181):
 *
 *   - 503 when the signing-secret env is unset (fail closed),
 *   - 401 + `webhook.signature_failure` audit row on a bad signature,
 *   - 400 on verified-but-malformed envelopes,
 *   - 200 + tier flip on a correctly signed fixture,
 *   - replay of the same delivery → `duplicate`, ONE event row, ONE flip.
 */

async function freshDb(): Promise<DrizzleDb> {
  return (await freshTestDb()) as unknown as DrizzleDb;
}

function testCatalog(): BillingCatalog {
  const entries: CatalogEntry[] = [
    {
      planCode: 'plus_monthly',
      tierId: 'plus',
      cycle: 'monthly',
      founding: false,
      usdCents: 900,
      paddlePriceId: TEST_PRICE_IDS.paddle.plus_monthly,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.plus_monthly,
    },
    {
      planCode: 'pro_annual',
      tierId: 'pro',
      cycle: 'annual',
      founding: false,
      usdCents: 19000,
      paddlePriceId: TEST_PRICE_IDS.paddle.pro_annual,
      razorpayPlanId: TEST_PRICE_IDS.razorpay.pro_annual,
    },
  ];
  return new BillingCatalog(entries, 250);
}

const PADDLE_SECRET = 'pdl_ntfset_ctrl_secret';
const RAZORPAY_SECRET = 'rzp_whsec_ctrl_secret';

function rawReq(body: string): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(body) } as RawBodyRequest<Request>;
}

function paddleSign(body: string, secret = PADDLE_SECRET, tsSec = Math.floor(Date.now() / 1000)) {
  const h1 = createHmac('sha256', secret).update(`${tsSec}:${body}`).digest('hex');
  return `ts=${tsSec};h1=${h1}`;
}

function razorpaySign(body: string, secret = RAZORPAY_SECRET) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('billing webhook controllers', () => {
  let db: DrizzleDb;
  let service: BillingWebhookService;
  let record: ReturnType<typeof vi.fn>;
  let securityEvents: SecurityEventsService;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new BillingWebhookService(db, testCatalog(), new AutopilotReadService(db));
    record = vi.fn().mockResolvedValue(undefined);
    securityEvents = { record } as unknown as SecurityEventsService;
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Hook WS' })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('Paddle controller', () => {
    function makeController(): BillingPaddleWebhookController {
      return new BillingPaddleWebhookController(
        new PaddleAdapter(process.env),
        service,
        securityEvents,
      );
    }

    it('503s (fail closed) when PADDLE_WEBHOOK_SECRET is unset', async () => {
      vi.stubEnv('PADDLE_WEBHOOK_SECRET', '');
      const controller = makeController();
      const body = JSON.stringify(paddleSubscriptionActivated({ workspaceId }));
      await expect(controller.receive(rawReq(body), paddleSign(body))).rejects.toMatchObject({
        status: 503,
      });
      expect(record).not.toHaveBeenCalled();
    });

    it('401s on a bad signature and records the D181 audit row first', async () => {
      vi.stubEnv('PADDLE_WEBHOOK_SECRET', PADDLE_SECRET);
      const controller = makeController();
      const body = JSON.stringify(paddleSubscriptionActivated({ workspaceId }));
      await expect(
        controller.receive(rawReq(body), paddleSign(body, 'wrong_secret')),
      ).rejects.toMatchObject({ status: 401 });
      expect(record).toHaveBeenCalledWith({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: { source: 'billing.paddle', reason: 'signature_mismatch' },
      });
      expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
    });

    it('400s on a verified-but-malformed envelope', async () => {
      vi.stubEnv('PADDLE_WEBHOOK_SECRET', PADDLE_SECRET);
      const controller = makeController();
      const body = JSON.stringify({ data: { nope: true } }); // no event_id
      await expect(controller.receive(rawReq(body), paddleSign(body))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('200-processes a signed fixture, then replays as duplicate — one row, one flip', async () => {
      vi.stubEnv('PADDLE_WEBHOOK_SECRET', PADDLE_SECRET);
      const controller = makeController();
      // custom_data must be signed with the SAME secret the controller
      // runs under — attribution is verified, not trusted.
      const body = JSON.stringify(
        paddleSubscriptionActivated({ customData: signedCustomData(workspaceId, PADDLE_SECRET) }),
      );

      expect(await controller.receive(rawReq(body), paddleSign(body))).toEqual({
        status: 'processed',
      });
      expect(await controller.receive(rawReq(body), paddleSign(body))).toEqual({
        status: 'duplicate',
      });

      expect(await db.select().from(subscriptionEvents)).toHaveLength(1);
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      expect(ws!.tier).toBe('plus');
    });

    /**
     * Mirrors the Razorpay "refund rail" 502 test one describe block
     * down. Paddle's real mapper cannot throw an AppException today — it
     * is synchronous and makes no network call — so this pins the
     * CONTRACT (an AppException the mapper throws must survive to the
     * caller) rather than a reachable-today code path, which is why the
     * mapper is stubbed rather than driven through a real fixture
     * (ultrareview, 2026-08-14).
     */
    it('preserves a retryable AppException the mapper throws — never collapses it to a terminal 400', async () => {
      vi.stubEnv('PADDLE_WEBHOOK_SECRET', PADDLE_SECRET);
      const controller = makeController();
      vi.spyOn(controller['adapter'], 'mapWebhookEvent').mockImplementation(() => {
        throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
      });
      const body = JSON.stringify(paddleSubscriptionActivated({ workspaceId }));

      await expect(controller.receive(rawReq(body), paddleSign(body))).rejects.toMatchObject({
        code: 'BILLING_PROVIDER_ERROR',
        status: 502,
      });
      // No dedup row — a 400 or a 200 here would each retire the
      // delivery from Paddle's retry queue in a different wrong way.
      expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
    });
  });

  describe('Razorpay controller', () => {
    function makeController(): BillingRazorpayWebhookController {
      return new BillingRazorpayWebhookController(
        new RazorpayAdapter(process.env),
        service,
        securityEvents,
      );
    }

    it('503s (fail closed) when RAZORPAY_WEBHOOK_SECRET is unset', async () => {
      vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', '');
      const controller = makeController();
      const body = JSON.stringify(razorpaySubscriptionEvent({ workspaceId }));
      await expect(
        controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_ctrl_1'),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('401s on a bad signature and records the D181 audit row', async () => {
      vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
      const controller = makeController();
      const body = JSON.stringify(razorpaySubscriptionEvent({ workspaceId }));
      await expect(
        controller.receive(rawReq(body), razorpaySign(body, 'wrong'), 'evt_rzp_ctrl_1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(record).toHaveBeenCalledWith({
        eventType: 'webhook.signature_failure',
        severity: 'warning',
        payload: { source: 'billing.razorpay', reason: 'signature_mismatch' },
      });
    });

    it('400s when the x-razorpay-event-id header is missing (dedup key required)', async () => {
      vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
      const controller = makeController();
      const body = JSON.stringify(razorpaySubscriptionEvent({ workspaceId }));
      await expect(
        controller.receive(rawReq(body), razorpaySign(body), undefined),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('200-processes a signed fixture, then replays as duplicate — one row, one flip', async () => {
      vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
      const controller = makeController();
      const body = JSON.stringify(razorpaySubscriptionEvent({ workspaceId }));

      expect(await controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_ctrl_1')).toEqual({
        status: 'processed',
      });
      expect(await controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_ctrl_1')).toEqual({
        status: 'duplicate',
      });

      expect(await db.select().from(subscriptionEvents)).toHaveLength(1);
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      expect(ws!.tier).toBe('pro');
    });

    it('400s on a verified-but-malformed envelope', async () => {
      // The mapper's envelope guard is a REJECTION now (the mapper is
      // async), and it must still land as the terminal 400 — not as the
      // retryable 5xx the provider-read failure gets.
      vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
      const controller = makeController();
      const body = JSON.stringify({ entity: 'event', payload: {} }); // no `event`
      await expect(
        controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_ctrl_bad'),
      ).rejects.toMatchObject({ status: 400 });
    });

    /**
     * The async seam (D253). A Razorpay refund payload names no
     * subscription, so the mapper resolves one through
     * `GET /v1/invoices/{id}` — an outbound call, made from inside a
     * webhook handler, which puts three things under test: it happens
     * only AFTER the signature check, it ends the plan when it succeeds,
     * and it refuses to guess when it fails.
     */
    describe('refund rail', () => {
      const RZP_KEYS = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret' };
      const INVOICE = 'inv_rzp_ctrl_0001';
      /** The annual charge, in paise — refund amount must equal it to end the plan. */
      const PAID = 1_900_000;

      /** Signed refund envelope for the fixture's subscription payment. */
      function refundBody(): string {
        return JSON.stringify({
          entity: 'event',
          account_id: 'acc_test00000001',
          event: 'refund.processed',
          contains: ['refund', 'payment'],
          payload: {
            refund: {
              entity: {
                id: 'rfnd_rzp_ctrl_1',
                entity: 'refund',
                amount: PAID,
                payment_id: 'pay_rzp_ctrl_1',
                status: 'processed',
              },
            },
            payment: {
              entity: {
                id: 'pay_rzp_ctrl_1',
                entity: 'payment',
                amount: PAID,
                status: 'captured',
                invoice_id: INVOICE,
              },
            },
          },
          created_at: 1_781_430_100,
        });
      }

      function stubInvoice(subscriptionId: string | null, status = 200): ReturnType<typeof vi.fn> {
        const spy = vi.fn(async () =>
          status === 200
            ? new Response(
                JSON.stringify({ id: INVOICE, entity: 'invoice', subscription_id: subscriptionId }),
                { status: 200 },
              )
            : new Response('{}', { status }),
        );
        vi.stubGlobal('fetch', spy);
        return spy;
      }

      it('verifies the signature BEFORE calling Razorpay — an unsigned body reaches no API', async () => {
        vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
        vi.stubEnv('RAZORPAY_KEY_ID', RZP_KEYS.RAZORPAY_KEY_ID);
        vi.stubEnv('RAZORPAY_KEY_SECRET', RZP_KEYS.RAZORPAY_KEY_SECRET);
        const spy = stubInvoice('sub_rzp00000000001');
        const controller = makeController();
        const body = refundBody();

        await expect(
          controller.receive(rawReq(body), razorpaySign(body, 'wrong'), 'evt_rzp_unsigned'),
        ).rejects.toMatchObject({ status: 401 });
        // The whole reason the ordering matters: an unauthenticated
        // request must never become outbound traffic (nor an event row).
        expect(spy).not.toHaveBeenCalled();
        expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
      });

      it('ends the plan of a refunded Razorpay customer — the D253 chain, end to end', async () => {
        vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
        vi.stubEnv('RAZORPAY_KEY_ID', RZP_KEYS.RAZORPAY_KEY_ID);
        vi.stubEnv('RAZORPAY_KEY_SECRET', RZP_KEYS.RAZORPAY_KEY_SECRET);
        const controller = makeController();

        const activate = JSON.stringify(razorpaySubscriptionEvent({ workspaceId }));
        expect(
          await controller.receive(rawReq(activate), razorpaySign(activate), 'evt_rzp_act_1'),
        ).toEqual({ status: 'processed' });

        // The invoice names the subscription the fixture activated.
        stubInvoice('sub_rzp00000000001');
        const body = refundBody();
        expect(
          await controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_refund_1'),
        ).toEqual({ status: 'processed' });

        const [sub] = await db.select().from(subscriptions);
        // `cancel_source` is what the D253 verdict pass selects on — with
        // it null, no Razorpay row was ever watched, confirmed, or freed.
        expect(sub!.cancelSource).toBe('refund');
        expect(sub!.cancelAtPeriodEnd).toBe(true);

        // The plan is HELD, not ended — 2026-08-25, and the same rule as
        // the Paddle rail. A Razorpay refund is equally a request the
        // provider has not finished processing, and the point of the
        // asymmetry that used to live here (revoke on request, release on
        // confirmation) was never Razorpay-specific.
        //
        // The deadline is what proves the verdict is armed rather than
        // ignored: a row that had NOT recorded the refund would carry a
        // null deadline and grant indefinitely.
        const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
        // Read off the ROW, not hardcoded — this fixture is a `pro`
        // subscription and an earlier revision of this assertion said
        // `plus`, which would have gone green the day the fixture changed
        // tier for an unrelated reason.
        expect(ws!.tier).toBe(sub!.tier);
        expect(sub!.entitlementEndsAt).not.toBeNull();
        expect(sub!.entitlementEndsAt!.getTime()).toBeLessThanOrEqual(
          Date.now() + REFUND_PENDING_GRACE_DAYS * 24 * 60 * 60 * 1000 + 60_000,
        );
      });

      it('answers a RETRYABLE 502 when the invoice read fails, and records nothing', async () => {
        vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
        vi.stubEnv('RAZORPAY_KEY_ID', RZP_KEYS.RAZORPAY_KEY_ID);
        vi.stubEnv('RAZORPAY_KEY_SECRET', RZP_KEYS.RAZORPAY_KEY_SECRET);
        stubInvoice(null, 500);
        const controller = makeController();
        const body = refundBody();

        await expect(
          controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_unread'),
        ).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR', status: 502 });
        // No dedup row, so the provider's redelivery re-drives from
        // scratch. A 200 + `ignored` would have stamped this processed
        // and dropped the refund permanently.
        expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
      });

      it('records an ignored event when the invoice names no subscription — never a guess', async () => {
        vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', RAZORPAY_SECRET);
        vi.stubEnv('RAZORPAY_KEY_ID', RZP_KEYS.RAZORPAY_KEY_ID);
        vi.stubEnv('RAZORPAY_KEY_SECRET', RZP_KEYS.RAZORPAY_KEY_SECRET);
        stubInvoice(null);
        const controller = makeController();
        const body = refundBody();

        expect(
          await controller.receive(rawReq(body), razorpaySign(body), 'evt_rzp_unlinked'),
        ).toEqual({ status: 'ignored' });
        const [row] = await db.select().from(subscriptionEvents);
        expect(row!.payload).toMatchObject({ kind: 'ignored' });
        expect(row!.payload).not.toHaveProperty('provider_subscription_id');
      });
    });
  });
});
