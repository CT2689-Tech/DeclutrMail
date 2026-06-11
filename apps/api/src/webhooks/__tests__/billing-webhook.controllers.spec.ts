import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { schema, subscriptionEvents, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';

import type { DrizzleDb } from '../../db/db.module.js';
import type { SecurityEventsService } from '../../security-events/security-events.service.js';
import { BillingCatalog, type CatalogEntry } from '../../billing/billing-catalog.js';
import { BillingWebhookService } from '../../billing/billing-webhook.service.js';
import { PaddleAdapter } from '../../billing/paddle.adapter.js';
import { RazorpayAdapter } from '../../billing/razorpay.adapter.js';
import {
  paddleSubscriptionActivated,
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

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

async function freshDb(): Promise<DrizzleDb> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema }) as unknown as DrizzleDb;
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
    service = new BillingWebhookService(db, testCatalog());
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
      const body = JSON.stringify(paddleSubscriptionActivated({ workspaceId }));

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
  });
});
