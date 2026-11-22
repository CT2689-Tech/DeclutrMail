import { ordinaryRefundPolicy } from '../../billing/__tests__/fixtures.js';
import { createHmac } from 'node:crypto';

import { subscriptionEvents, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { AutopilotReadService } from '../../autopilot/autopilot.read-service.js';
import type { RawBodyRequest } from '@nestjs/common';

import { AppException } from '../../common/app-exception.js';
import type { DrizzleDb } from '../../db/db.module.js';
import type { SecurityEventsService } from '../../security-events/security-events.service.js';
import { BillingCatalog, type CatalogEntry } from '../../billing/billing-catalog.js';
import { BillingWebhookService } from '../../billing/billing-webhook.service.js';
import { PaddleAdapter } from '../../billing/paddle.adapter.js';
import {
  paddleSubscriptionActivated,
  signedCustomData,
  TEST_PRICE_IDS,
} from '../../billing/__tests__/fixtures.js';
import { BillingPaddleWebhookController } from '../billing-paddle.controller.js';

/**
 * Billing webhook controller — end-to-end through the REAL adapter
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
    },
    {
      planCode: 'pro_annual',
      tierId: 'pro',
      cycle: 'annual',
      founding: false,
      usdCents: 19000,
      paddlePriceId: TEST_PRICE_IDS.paddle.pro_annual,
    },
  ];
  return new BillingCatalog(entries, 250);
}

const PADDLE_SECRET = 'pdl_ntfset_ctrl_secret';

function rawReq(body: string): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(body) } as RawBodyRequest<Request>;
}

function paddleSign(body: string, secret = PADDLE_SECRET, tsSec = Math.floor(Date.now() / 1000)) {
  const h1 = createHmac('sha256', secret).update(`${tsSec}:${body}`).digest('hex');
  return `ts=${tsSec};h1=${h1}`;
}

describe('billing webhook controllers', () => {
  let db: DrizzleDb;
  let service: BillingWebhookService;
  let record: ReturnType<typeof vi.fn>;
  let securityEvents: SecurityEventsService;
  let workspaceId: string;

  beforeEach(async () => {
    db = await freshDb();
    service = new BillingWebhookService(
      db,
      testCatalog(),
      new AutopilotReadService(db),
      ordinaryRefundPolicy,
    );
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
     * Paddle's real mapper cannot throw an AppException today — it
     * is synchronous and makes no network call — so this pins the
     * CONTRACT (an AppException the mapper throws must survive to the
     * caller) rather than a reachable-today code path, which is why the
     * mapper is stubbed rather than driven through a real fixture
     * (ultrareview, 2026-08-14).
     */
    it('preserves a retryable AppException the mapper throws instead of misclassifying it as 400', async () => {
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
      // No dedup row — a 200 would retire the delivery, while a 400
      // would misclassify the transient failure. Paddle retries non-2xx.
      expect(await db.select().from(subscriptionEvents)).toHaveLength(0);
    });
  });
});
