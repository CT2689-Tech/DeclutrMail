/** Isolated CI sandbox only. No Gmail, production data, live key or email delivery. */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, subscriptions, users, workspaces } from '@declutrmail/db';
import {
  assertSandboxRehearsalEnvironment,
  rehearsalCase,
  isRehearsalOperator,
} from './helpers/sandbox-rehearsal-boundary.js';
import { buildRehearsalClient } from './helpers/sandbox-rehearsal-client.js';
import { BillingCatalog } from '../src/billing/billing-catalog.js';
import { PaddleAdapter } from '../src/billing/paddle.adapter.js';
import { RazorpayAdapter } from '../src/billing/razorpay.adapter.js';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingWebhookService } from '../src/billing/billing-webhook.service.js';
import { BillingUpgradeRefundService } from '../src/billing/billing-upgrade-refund.service.js';
import { BillingReconciliationService } from '../src/billing/billing-reconciliation.service.js';
import { AutopilotReadService } from '../src/autopilot/autopilot.read-service.js';
import { upgradeRecords } from '../src/billing/upgrade-intents.js';
import type { DrizzleDb } from '../src/db/db.module.js';
import type { NormalizedBillingEvent } from '../src/billing/billing-provider.interface.js';

assertSandboxRehearsalEnvironment(process.env);
const BASE = 'https://sandbox-api.paddle.com';
const publicUrl = process.env.REHEARSAL_PUBLIC_URL!;
const reportPath = process.env.REHEARSAL_REPORT_PATH!;
if (
  !reportPath ||
  !process.env.RUNNER_TEMP ||
  !reportPath.startsWith(process.env.RUNNER_TEMP + '/')
)
  throw new Error('Runner-local report path required');
const key = process.env.PADDLE_API_KEY!;
const resourceName = `Refund rehearsal ${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const pg = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(pg, { schema }) as unknown as DrizzleDb;
const prices = {
  plus: 'pri_01ky067arw41802a6ssessknxh',
  pro: 'pri_01ky067az9z6fefyqmnqnt6a8q',
  annual: 'pri_01ky067b1m8t3psj66sjza5jb1',
};
const ownedSubscriptions = new Set<string>();
const cleanup: {
  tokenId?: string;
  destinationId?: string;
  destinationStopped?: boolean;
  tokenRevoked?: boolean;
  subscriptionsStopped?: boolean;
  recoveryVerified?: boolean;
  handlersDrained?: boolean;
} = {};
let tokenAttempted = false,
  destinationAttempted = false,
  actionBusy = false;
const evidence: Record<string, unknown> = {
  sandboxOnly: true,
  startedAt: new Date().toISOString(),
  fixtureOnly: true,
  cleanup,
};
let endpointSecret = '',
  clientToken = '',
  finished = false,
  verifiedWebhooks = 0,
  rejectedSignatures = 0;
let stopping = false;
type CaseName = 'monthly' | 'cycle';
type Fixture = {
  workspaceId: string;
  userId: string;
  stage: string;
  originalEnd?: string;
  beforeRefundPositiveCount?: number;
  beforeRefundTransactionIds?: string[];
  adjustmentId?: string;
  result?: Record<string, unknown>;
};
const fixtures = {} as Record<CaseName, Fixture>;
const verifiedEvents: Array<{ event: NormalizedBillingEvent; occurredAt: unknown }> = [];
async function record() {
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ...evidence,
        verifiedWebhooks,
        rejectedSignatures,
        ownedSubscriptionIds: [...ownedSubscriptions],
        fixtures: Object.fromEntries(
          Object.entries(fixtures).map(([k, f]) => [
            k,
            {
              stage: f.stage,
              originalEnd: f.originalEnd,
              adjustmentId: f.adjustmentId,
              result: f.result,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`sandbox_http_${response.status}`);
  if (response.status === 204) return { data: {} };
  return (await response.json()) as {
    data: Record<string, unknown>;
    meta?: { pagination?: { has_more?: boolean } };
  };
}
async function list(path: string, prefix: string, filters: Record<string, string> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ per_page: '200', order_by: 'id[ASC]', ...filters });
    if (after) query.set('after', after);
    const response = await api(path + '?' + query);
    if (!Array.isArray(response.data) || typeof response.meta?.pagination?.has_more !== 'boolean')
      throw new Error('Incomplete sandbox ownership scan');
    rows.push(...(response.data as Array<Record<string, unknown>>));
    if (!response.meta.pagination.has_more) return rows;
    const last = response.data.at(-1) as { id?: unknown } | undefined;
    if (
      typeof last?.id !== 'string' ||
      !new RegExp(`^${prefix}_[a-z\\d]{26}$`).test(last.id) ||
      last.id === after
    )
      throw new Error('Incomplete sandbox cursor');
    after = last.id;
  }
  throw new Error('Sandbox ownership scan bound exhausted');
}
async function transactionProof(id: string) {
  if (!ownedSubscriptions.has(id)) throw new Error('Unowned subscription refused');
  const response = await api(`/transactions?subscription_id=${encodeURIComponent(id)}&per_page=30`);
  if (!Array.isArray(response.data) || response.meta?.pagination?.has_more !== false)
    throw new Error('Incomplete fixture transaction scan');
  let count = 0;
  for (const t of response.data as Array<{ id: string }>) {
    const exact = await paddle.readRefundTransaction(t.id);
    if (!exact || exact.subscriptionId !== id) throw new Error('Unowned or unread fixture charge');
    if (exact.status === 'completed' && exact.positiveCharge) count++;
  }
  return { count, ids: (response.data as Array<{ id: string }>).map((t) => t.id).sort() };
}
let paddle: PaddleAdapter,
  service: BillingService,
  projector: BillingWebhookService,
  reconciler: BillingReconciliationService;
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function rawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000) throw new Error('Body too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function ownSubscription(f: Fixture) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.workspaceId, f.workspaceId), eq(subscriptions.provider, 'paddle')));
  if (!sub || !ownedSubscriptions.has(sub.providerSubscriptionId))
    throw new Error('Verified fixture subscription required');
  return sub;
}
async function webhook(req: IncomingMessage, res: ServerResponse) {
  const raw = await rawBody(req);
  const sig = req.headers['paddle-signature'];
  if (
    !paddle.verifyWebhookSignature({
      rawBody: raw,
      signatureHeader: typeof sig === 'string' ? sig : undefined,
      secret: endpointSecret,
    }).ok
  ) {
    rejectedSignatures++;
    json(res, 401, { error: 'invalid_signature' });
    return;
  }
  const body = JSON.parse(raw.toString()) as { occurred_at?: unknown };
  const event = paddle.mapWebhookEvent(body);
  const workspace =
    'subscription' === event.kind
      ? event.subscription.workspaceId
      : event.kind === 'payment'
        ? event.workspaceId
        : null;
  const id =
    event.kind === 'subscription'
      ? event.subscription.providerSubscriptionId
      : 'providerSubscriptionId' in event
        ? event.providerSubscriptionId
        : null;
  const owner = Object.values(fixtures).some((f) => f.workspaceId === workspace);
  if (owner && id) ownedSubscriptions.add(id);
  if (!owner && (!id || !ownedSubscriptions.has(id))) {
    json(res, 200, { ignored: 'outside_fixture' });
    return;
  }
  verifiedWebhooks++;
  const result = await projector.process('paddle', event, body);
  if (result.kind === 'processed') verifiedEvents.push({ event, occurredAt: body.occurred_at });
  await record();
  json(res, result.kind === 'unresolved' ? 503 : 200, { outcome: result.kind });
}
const stateFlights = new Map<CaseName, Promise<unknown>>();
function state(name: CaseName): Promise<unknown> {
  const current = stateFlights.get(name);
  if (current) return current;
  const flight = readState(name).finally(() => stateFlights.delete(name));
  stateFlights.set(name, flight);
  return flight;
}
async function readState(name: CaseName) {
  const f = fixtures[name];
  if (f.adjustmentId) {
    f.stage = 'refund_requested';
    delete f.result;
  }
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, f.workspaceId));
  if (rows[0]) await reconciler.reconcileWorkspaceSubscriptions(f.workspaceId);
  const subscription = await service.getSubscription(f.workspaceId);
  const sub = rows[0];
  if (sub && f.adjustmentId) {
    const provider = await paddle.readUpgradeState(sub.providerSubscriptionId);
    const records = await upgradeRecords(db, sub.providerSubscriptionId);
    if (
      name === 'monthly' &&
      subscription.subscription?.tier === 'plus' &&
      !subscription.billingReviewPending &&
      provider?.priceId === prices.plus &&
      provider.status === 'active' &&
      provider.periodEnd === f.originalEnd &&
      provider.nextBilledAt === f.originalEnd &&
      records.some(
        (r) =>
          r.eventType === 'local.upgrade_restore_completed' &&
          (r.payload as { adjustment_id?: unknown }).adjustment_id === f.adjustmentId,
      )
    ) {
      const proof = await transactionProof(sub.providerSubscriptionId);
      const noExtraCharge =
        proof.count === f.beforeRefundPositiveCount &&
        JSON.stringify(proof.ids) === JSON.stringify(f.beforeRefundTransactionIds);
      if (!noExtraCharge) throw new Error('Unexpected extra completed charge');
      f.stage = 'passed';
      f.result = {
        basePlanRestored: true,
        originalRenewalRetained: true,
        noExtraCharge,
        verifiedWebhooks,
      };
    } else if (name === 'cycle' && subscription.billingReviewPending) {
      if (
        records.some(
          (r) =>
            r.eventType === 'local.upgrade_refund_held' &&
            (r.payload as { reason?: unknown; adjustment_id?: unknown }).reason ===
              'original_renewal_requires_support' &&
            (r.payload as { adjustment_id?: unknown }).adjustment_id === f.adjustmentId,
        ) &&
        provider?.priceId === prices.annual &&
        subscription.subscription?.tier === 'pro' &&
        provider.status === 'active'
      ) {
        const proof = await transactionProof(sub.providerSubscriptionId);
        const noExtraCharge =
          proof.count === f.beforeRefundPositiveCount &&
          JSON.stringify(proof.ids) === JSON.stringify(f.beforeRefundTransactionIds);
        if (!noExtraCharge) throw new Error('Unexpected new transaction artifact');
        f.stage = 'support_hold_verified';
        f.result = {
          supportHold: true,
          reviewBarrierPresent: true,
          noExtraCharge,
        };
      }
    }
  }
  await record();
  return { scenario: name, stage: f.stage, subscription, result: f.result };
}
let clientJs = '';
const activeHandlers = new Set<Promise<void>>();
const server = createServer((req, res) => {
  if (stopping) {
    json(res, 503, { error: 'fixture_stopping' });
    return;
  }
  const handler = (async () => {
    const url = new URL(req.url ?? '/', publicUrl);
    if (req.method === 'POST' && url.pathname === '/paddle-webhook') {
      await webhook(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Isolated billing sandbox rehearsal</title></head><body><h1>Paddle sandbox — synthetic fixture only</h1><p>No real money, Gmail or app email delivery. Use virtual test card 4242 4242 4242 4242 and a reserved example.test email.</p><label>Private operator key <input id="operator" type="password" autocomplete="off"></label><button id="authenticate">Authenticate operator</button><label>Scenario <select id="scenario"><option value="monthly">Monthly upgrade reversal</option><option value="cycle">Cycle-change support hold</option></select></label><button id="buy">Buy synthetic Plus monthly</button><button id="upgrade">Upgrade fixture</button><button id="refund">Refund upgrade-only charge</button><button id="finish">Finish and clean up</button><p id="message"></p><pre id="state"></pre><script type="module" src="/client.js"></script></body></html>',
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(clientJs);
      return;
    }
    const name = rehearsalCase(url.searchParams.get('case'));
    if (!isRehearsalOperator(req.headers['x-rehearsal-key'], process.env.REHEARSAL_OPERATOR_KEY!)) {
      json(res, 403, { error: 'private_operator_required' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/state' && name) {
      json(res, 200, await state(name));
      return;
    }
    if (req.method !== 'POST' || req.headers.origin !== publicUrl) {
      json(res, 403, { error: 'fixture_origin_required' });
      return;
    }
    if (actionBusy || stopping) throw new Error('Fixture action already running or stopped');
    actionBusy = true;
    try {
      if (url.pathname === '/finish') {
        await state('monthly');
        await state('cycle');
        if (fixtures.monthly.stage !== 'passed' || fixtures.cycle.stage !== 'support_hold_verified')
          throw new Error('Both fixture proofs are required');
        for (const e of verifiedEvents) {
          const result = await projector.process('paddle', e.event, { occurred_at: e.occurredAt });
          if (result.kind !== 'duplicate') throw new Error('Verified replay was not deduplicated');
        }
        evidence.verifiedReplayDedup = true;
        finished = true;
        json(res, 200, { finished: true });
        return;
      }
      if (!name) {
        json(res, 400, { error: 'fixed_scenario_required' });
        return;
      }
      const f = fixtures[name];
      if (url.pathname === '/checkout') {
        if (f.stage !== 'initialized') throw new Error('Fixture checkout is one-use');
        f.stage = 'checkout_open';
        json(
          res,
          200,
          await service.createCheckout(f, { provider: 'paddle', tierId: 'plus', cycle: 'monthly' }),
        );
        return;
      }
      if (url.pathname === '/upgrade') {
        const sub = await ownSubscription(f);
        if (sub.tier !== 'plus' || f.originalEnd)
          throw new Error('One verified base purchase required');
        const prior = await paddle.readUpgradeState(sub.providerSubscriptionId);
        if (!prior || prior.priceId !== prices.plus) throw new Error('Base state unverified');
        f.originalEnd = prior.periodEnd;
        f.stage = 'upgrade_pending';
        try {
          await service.changePlan(f, {
            tierId: 'pro',
            cycle: name === 'cycle' ? 'annual' : 'monthly',
          });
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            !['PLAN_CHANGE_UNCONFIRMED', 'PLAN_CHANGE_PENDING'].includes(String(error.code))
          )
            throw error;
        }
        json(res, 200, await state(name));
        return;
      }
      if (url.pathname === '/refund') {
        const sub = await ownSubscription(f);
        if (!f.originalEnd || f.adjustmentId || f.stage === 'refund_requested')
          throw new Error('One upgrade-only refund required; uncertain writes are never retried');
        await projector.recoverUpgradeOperation(sub.providerSubscriptionId);
        const bound = (await upgradeRecords(db, sub.providerSubscriptionId)).find(
          (r) => r.eventType === 'local.upgrade_transaction_bound',
        );
        const transactionId = (bound?.payload as { transaction_id?: string } | undefined)
          ?.transaction_id;
        if (!transactionId) throw new Error('Exact signed original upgrade charge is not bound');
        const proof = await transactionProof(sub.providerSubscriptionId);
        f.beforeRefundPositiveCount = proof.count;
        f.beforeRefundTransactionIds = proof.ids;
        f.stage = 'refund_requested';
        await record();
        const adjustment = await api('/adjustments', 'POST', {
          action: 'refund',
          type: 'full',
          transaction_id: transactionId,
          reason: resourceName,
        });
        if (typeof adjustment.data.id !== 'string') throw new Error('Adjustment outcome unknown');
        f.adjustmentId = adjustment.data.id;
        await record();
        json(res, 200, await state(name));
        return;
      }
      json(res, 404, { error: 'fixture_route_not_found' });
    } finally {
      actionBusy = false;
    }
  })().catch(() =>
    json(res, 503, {
      error: 'fixture_operation_unconfirmed',
      support: 'Read the sanitized workflow evidence; do not retry a charged action.',
    }),
  );
  activeHandlers.add(handler);
  void handler.finally(() => activeHandlers.delete(handler));
});
async function shutdown() {
  stopping = true;
  // Recover our own uncertain creations by a unique run-attempt name, never by shared settings.
  try {
    if (tokenAttempted && !cleanup.tokenId) {
      const matches = (await list('/client-tokens', 'ctkn', { status: 'active,revoked' })).filter(
        (t) => t.name === resourceName && t.description === 'Disposable isolated sandbox fixture',
      );
      if (matches.length !== 1) throw new Error('Client token outcome unverified');
      cleanup.tokenId = String(matches[0]!.id);
    }
    if (destinationAttempted && !cleanup.destinationId) {
      const matches = (await list('/notification-settings', 'ntfset')).filter(
        (d) => d.description === resourceName && d.destination === publicUrl + '/paddle-webhook',
      );
      if (matches.length !== 1) throw new Error('Destination outcome unverified');
      cleanup.destinationId = String(matches[0]!.id);
    }
    cleanup.recoveryVerified = true;
  } catch {
    cleanup.recoveryVerified = false;
  }
  if (cleanup.destinationId) {
    try {
      await api(`/notification-settings/${cleanup.destinationId}`, 'PATCH', { active: false });
      const readback = await api(`/notification-settings/${cleanup.destinationId}`);
      cleanup.destinationStopped = readback.data.active === false;
    } catch {
      cleanup.destinationStopped = false;
    }
  }
  if (cleanup.tokenId) {
    try {
      await api(`/client-tokens/${cleanup.tokenId}`, 'PATCH', { status: 'revoked' });
      const readback = await api(`/client-tokens/${cleanup.tokenId}`);
      cleanup.tokenRevoked = readback.data.status === 'revoked';
    } catch {
      cleanup.tokenRevoked = false;
    }
  }
  // Stop new connections and drain requests already doing provider work before final ownership reads.
  server.close();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const drained = await Promise.race([
    Promise.allSettled([...activeHandlers]).then(() => true),
    new Promise<boolean>((r) => {
      timeout = setTimeout(() => r(false), 45000);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  cleanup.handlersDrained = drained;
  try {
    if (paddle && Object.keys(fixtures).length) {
      for (const data of await list('/subscriptions', 'sub', {
        status: 'active,canceled,paused,past_due,trialing',
      })) {
        const normalized = paddle.mapWebhookEvent({
          event_id: 'fixture-cleanup-read',
          event_type: 'subscription.updated',
          data,
        });
        if (
          normalized.kind === 'subscription' &&
          Object.values(fixtures).some((f) => f.workspaceId === normalized.subscription.workspaceId)
        )
          ownedSubscriptions.add(normalized.subscription.providerSubscriptionId);
      }
    }
  } catch {
    cleanup.recoveryVerified = false;
  }
  let stopped = true;
  for (const id of ownedSubscriptions) {
    try {
      await api(`/subscriptions/${id}/cancel`, 'POST', { effective_from: 'immediately' });
    } catch {
      /* An already-stopped subscription is verified by the fresh read below. */
    }
    const providerState = await paddle.deletionBillingState(id).catch(() => 'unknown');
    if (providerState !== 'stopped') stopped = false;
  }
  cleanup.subscriptionsStopped = stopped;
  if (
    !cleanup.recoveryVerified ||
    !cleanup.handlersDrained ||
    !cleanup.subscriptionsStopped ||
    (tokenAttempted && !cleanup.tokenRevoked) ||
    (destinationAttempted && !cleanup.destinationStopped)
  )
    process.exitCode = 1;
  await record();
  server.closeAllConnections();
  await pg.end();
}
try {
  evidence.phase = 'bundle';
  clientJs = await buildRehearsalClient();
  evidence.phase = 'catalog';
  for (const price of Object.values(prices)) {
    const p = await api(`/prices/${price}`);
    if (p.data.id !== price || p.data.status !== 'active')
      throw new Error('Sandbox catalog mismatch');
  }
  evidence.catalogRead = true;
  // Inspect destinations before adding a separate disposable destination; never update existing routes.
  await api('/notification-settings');
  evidence.destinationsRead = true;
  evidence.phase = 'create_token';
  tokenAttempted = true;
  const token = await api('/client-tokens', 'POST', {
    name: resourceName,
    description: 'Disposable isolated sandbox fixture',
  });
  if (
    typeof token.data.token !== 'string' ||
    !token.data.token.startsWith('test_') ||
    typeof token.data.id !== 'string'
  )
    throw new Error('Sandbox client token required');
  clientToken = token.data.token;
  cleanup.tokenId = token.data.id;
  console.log(`::add-mask::${clientToken}`);
  await record();
  evidence.phase = 'create_destination';
  destinationAttempted = true;
  const destination = await api('/notification-settings', 'POST', {
    description: resourceName,
    type: 'url',
    destination: publicUrl + '/paddle-webhook',
    api_version: 1,
    include_sensitive_fields: false,
    traffic_source: 'platform',
    subscribed_events: [
      'subscription.created',
      'subscription.updated',
      'subscription.activated',
      'subscription.canceled',
      'transaction.completed',
      'adjustment.created',
      'adjustment.updated',
    ],
  });
  if (
    typeof destination.data.endpoint_secret_key !== 'string' ||
    typeof destination.data.id !== 'string'
  )
    throw new Error('Own signature secret required');
  endpointSecret = destination.data.endpoint_secret_key;
  cleanup.destinationId = destination.data.id;
  console.log(`::add-mask::${endpointSecret}`);
  await record();
  process.env.BILLING_UPGRADE_REFUND_RESTORE_ENABLED = 'true';
  paddle = new PaddleAdapter({
    PADDLE_ENV: 'sandbox',
    PADDLE_API_KEY: key,
    PADDLE_CLIENT_TOKEN: clientToken,
    PADDLE_WEBHOOK_SECRET: endpointSecret,
  });
  const catalog = new BillingCatalog([
    {
      planCode: 'plus_monthly',
      tierId: 'plus',
      cycle: 'monthly',
      founding: false,
      usdCents: 900,
      paddlePriceId: prices.plus,
      razorpayPlanId: null,
    },
    {
      planCode: 'pro_monthly',
      tierId: 'pro',
      cycle: 'monthly',
      founding: false,
      usdCents: 1900,
      paddlePriceId: prices.pro,
      razorpayPlanId: null,
    },
    {
      planCode: 'pro_annual',
      tierId: 'pro',
      cycle: 'annual',
      founding: false,
      usdCents: 19000,
      paddlePriceId: prices.annual,
      razorpayPlanId: null,
    },
  ]);
  const upgrades = new BillingUpgradeRefundService(db, catalog, paddle);
  projector = new BillingWebhookService(db, catalog, new AutopilotReadService(db), upgrades);
  const razorpay = new RazorpayAdapter({});
  reconciler = new BillingReconciliationService(db, catalog, projector, paddle, razorpay);
  service = new BillingService(db, catalog, paddle, razorpay, reconciler, upgrades);
  evidence.phase = 'fixtures';
  for (const name of ['monthly', 'cycle'] as const) {
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Synthetic ${name} refund fixture` })
      .returning();
    const [u] = await db
      .insert(users)
      .values({
        workspaceId: w!.id,
        email: `refund-${process.env.GITHUB_RUN_ID}-${name}@example.test`,
      })
      .returning();
    fixtures[name] = { workspaceId: w!.id, userId: u!.id, stage: 'initialized' };
  }
  // Bundled and checked before any provider write below.
  await new Promise<void>((r) => server.listen(4045, '127.0.0.1', r));
  const unauthorized = await fetch('http://127.0.0.1:4045/state?case=monthly');
  if (unauthorized.status !== 403) throw new Error('Unauthenticated state was not refused');
  const invalidSignature = await fetch('http://127.0.0.1:4045/paddle-webhook', {
    method: 'POST',
    body: '{}',
  });
  if (invalidSignature.status !== 401) throw new Error('Invalid signature was not refused');
  evidence.privateOperatorEnforced = true;
  evidence.invalidSignatureRejected = true;
  evidence.phase = 'awaiting_synthetic_browser';
  console.log(`Synthetic sandbox fixture UI: ${publicUrl}`);
  await record();
  const stop = new Promise<void>((r) => {
    const end = () => {
      stopping = true;
      r();
    };
    process.once('SIGTERM', end);
    process.once('SIGINT', end);
  });
  const deadline = Date.now() + 45 * 60 * 1000;
  while (!finished && !stopping && Date.now() < deadline) {
    await Promise.race([stop, new Promise<void>((r) => setTimeout(r, 1000))]);
    if (!server.listening) break;
  }
  evidence.completed = finished;
} catch {
  evidence.error = 'sandbox_rehearsal_unconfirmed';
  process.exitCode = 1;
} finally {
  await shutdown();
  if (!finished) process.exitCode = 1;
}
