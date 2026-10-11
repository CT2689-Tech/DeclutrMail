/** ADR-0046: sandbox-only provider proof. Production checkout/deletion stay unchanged. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, subscriptionEvents, subscriptions, users, workspaces } from '@declutrmail/db';
import {
  assertSandboxRehearsalEnvironment,
  isRehearsalOperator,
  listenRehearsalServer,
} from './helpers/sandbox-rehearsal-boundary.js';
import { buildCheckoutRevocationClient } from './helpers/checkout-revocation-client.js';
import { proposedCheckoutHold, sandboxReplayRefusal } from './helpers/checkout-revocation-proof.js';
import { collectSandboxAttemptCleanup } from './helpers/checkout-revocation-cleanup.js';
import {
  PaddleAdapter,
  type SandboxCheckoutFacts,
  type SandboxCheckoutIdentity,
  verifiedWorkspaceId,
} from '../src/billing/paddle.adapter.js';
import { RazorpayAdapter } from '../src/billing/razorpay.adapter.js';
import { BillingCatalog } from '../src/billing/billing-catalog.js';
import { BillingWebhookService } from '../src/billing/billing-webhook.service.js';
import { BillingDeletionGuard } from '../src/billing/billing-deletion-guard.js';
import { AutopilotReadService } from '../src/autopilot/autopilot.read-service.js';
import { BillingUpgradeRefundService } from '../src/billing/billing-upgrade-refund.service.js';
import type { DrizzleDb } from '../src/db/db.module.js';
import type { NormalizedBillingEvent } from '../src/billing/billing-provider.interface.js';

assertSandboxRehearsalEnvironment(process.env);
const key = process.env.PADDLE_API_KEY!;
const publicUrl = process.env.REHEARSAL_PUBLIC_URL!;
const reportPath = process.env.REHEARSAL_REPORT_PATH!;
if (!process.env.RUNNER_TEMP || !reportPath?.startsWith(process.env.RUNNER_TEMP + '/'))
  throw new Error('Runner-local report required');
const resourceName = `Checkout revocation ${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const priceId = 'pri_01ky067arw41802a6ssessknxh';
const startedAt = new Date(Date.now() - 1000).toISOString();
const pg = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(pg, { schema }) as unknown as DrizzleDb;
type CaseName = 'cancel' | 'unopened' | 'pay' | 'race' | 'crash' | 'legacy' | 'modified';
const cases = ['cancel', 'unopened', 'pay', 'race', 'crash', 'legacy', 'modified'] as const;
type Fixture = SandboxCheckoutIdentity & {
  userId: string;
  createdAt: string;
  attempted: boolean;
  bound?: string;
  observations: string[];
  errors?: Array<{ mode: string; code: string }>;
  originalFrameClosed?: boolean;
  originalFrameRefused?: boolean;
  opened: boolean;
  hostedReplay?: boolean;
  overlayReplayRefused?: boolean;
  hostedReplayRefused?: boolean;
  orderingVerified?: boolean;
  raceInitiated?: boolean;
  replayStarted?: boolean;
  revocation?: SandboxCheckoutFacts;
  crashRecovered?: boolean;
  last?: Record<string, unknown>;
};
const fixtures = {} as Record<CaseName, Fixture>;
const ownedSubscriptions = new Set<string>();
const ownedTransactions = new Map<string, SandboxCheckoutIdentity>();
const cleanup: Record<string, boolean | string> = {};
const evidence: Record<string, unknown> = {
  sandboxOnly: true,
  fixtureOnly: true,
  startedAt,
  cleanup,
  productionCheckoutUnchanged: true,
  productionDeletionHoldsUnchanged: true,
  razorpay: 'not_rehearsed_no_test_credentials_confirmed',
};
let clientToken = '',
  endpointSecret = '',
  tokenId = '',
  destinationId = '',
  clientJs = '';
let tokenAttempted = false,
  destinationAttempted = false,
  stopping = false,
  finished = false,
  busy = false;
let verifiedWebhooks = 0,
  rejectedSignatures = 0;
let paddle: PaddleAdapter, projector: BillingWebhookService, guard: BillingDeletionGuard;
const verifiedEvents: Array<{ event: NormalizedBillingEvent; occurredAt: unknown }> = [];
const active = new Set<Promise<void>>();
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch('https://sandbox-api.paddle.com' + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`sandbox_http_${response.status}`);
  return response.status === 204
    ? { data: {} }
    : ((await response.json()) as {
        data: Record<string, unknown>;
        meta?: { pagination?: { has_more?: unknown } };
      });
}
async function list(path: string, filters: Record<string, string> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  let after = '';
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ per_page: '30', order_by: 'id[ASC]', ...filters });
    if (after) query.set('after', after);
    const response = await api(path + '?' + query);
    if (!Array.isArray(response.data) || typeof response.meta?.pagination?.has_more !== 'boolean')
      throw new Error('Incomplete ownership scan');
    rows.push(...response.data);
    if (!response.meta.pagination.has_more) return rows;
    const last = response.data.at(-1)?.id;
    if (typeof last !== 'string' || !/^[a-z]+_[a-z\d]{26}$/.test(last) || after === last)
      throw new Error('Unverified cursor');
    after = last;
  }
  throw new Error('Ownership scan bound exhausted');
}
async function record() {
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ...evidence,
        resourceName,
        tokenId: tokenId || undefined,
        destinationId: destinationId || undefined,
        verifiedWebhooks,
        rejectedSignatures,
        fixtures: Object.fromEntries(
          Object.entries(fixtures).map(([name, f]) => [
            name,
            {
              workspaceId: f.workspaceId,
              attemptId: f.attemptId,
              createdAt: f.createdAt,
              attempted: f.attempted,
              bound: f.bound,
              observations: f.observations,
              errors: f.errors,
              originalFrameClosed: f.originalFrameClosed,
              originalFrameRefused: f.originalFrameRefused,
              replayStarted: f.replayStarted,
              hostedReplay: f.hostedReplay,
              overlayReplayRefused: f.overlayReplayRefused,
              hostedReplayRefused: f.hostedReplayRefused,
              orderingVerified: f.orderingVerified,
              raceInitiated: f.raceInitiated,
              crashRecovered: f.crashRecovered,
              providerRevocation: f.revocation,
              result: f.last,
            },
          ]),
        ),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
async function journal(f: Fixture, type: string, payload: Record<string, unknown>) {
  await db
    .insert(subscriptionEvents)
    .values({
      provider: 'paddle',
      providerEventId: `${type}_${f.attemptId}`,
      eventType: type,
      payload: { workspaceId: f.workspaceId, attemptId: f.attemptId, ...payload },
      processedAt: new Date(),
    })
    .onConflictDoNothing();
}
async function paidSeen(f: Fixture) {
  const rows = await db
    .select()
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.provider, 'paddle'),
        eq(subscriptionEvents.providerEventId, `local.sandbox_checkout_paid_${f.attemptId}`),
      ),
    );
  return rows.length > 0;
}
async function state(name: CaseName) {
  const f = fixtures[name];
  let provider: SandboxCheckoutFacts | null = null;
  if (f.bound && name !== 'legacy')
    provider = await paddle.readSandboxCheckout(f, f.bound).catch(() => null);
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, f.workspaceId));
  let productionGuard = 'held';
  try {
    await guard.assertStopped(f.userId);
    productionGuard = 'unexpectedly_clear';
  } catch {
    /* Existing conservative hold required. */
  }
  const paid = await paidSeen(f);
  const [workspace] = await db
    .select({ tier: workspaces.tier })
    .from(workspaces)
    .where(eq(workspaces.id, f.workspaceId));
  // Browser errors alone cannot clear a hold. Saved-replay observation + fresh
  // canceled readback are a proposed-model proof, never real deletion permission.
  let replacementUnproven = true;
  let transactionIds: string[] = [];
  try {
    const owned = (await list('/transactions', { 'created_at[GTE]': f.createdAt })).filter(
      (t) =>
        verifiedWorkspaceId(
          t.custom_data as { workspace_id?: string; sig?: string } | null,
          endpointSecret,
        ) === f.workspaceId,
    );
    transactionIds = owned.map((t) => String(t.id)).sort();
    replacementUnproven = !f.bound || transactionIds.length !== 1 || transactionIds[0] !== f.bound;
  } catch {
    /* Unavailable/capped scans cannot establish absence. */
  }
  const proposedHold = proposedCheckoutHold({
    legacy: name === 'legacy',
    paymentSeen: paid,
    grantingSubscription: !!sub && sub.status !== 'canceled',
    replayErrorObserved:
      f.replayStarted === true && f.overlayReplayRefused === true && f.hostedReplayRefused === true,
    replacementUnproven,
    provider,
  });
  f.last = {
    provider,
    proposedHold,
    productionGuard,
    paymentSticky: paid,
    workspaceTier: workspace?.tier ?? null,
    replacementUnproven,
    transactionIds,
    localSubscription: sub ? { status: sub.status, tier: sub.tier } : null,
  };
  await record();
  return { scenario: name, ...f.last };
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function raw(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error('Body bound');
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}
async function webhook(req: IncomingMessage, res: ServerResponse) {
  const body = await raw(req);
  const sig = req.headers['paddle-signature'];
  if (
    !paddle.verifyWebhookSignature({
      rawBody: body,
      signatureHeader: typeof sig === 'string' ? sig : undefined,
      secret: endpointSecret,
    }).ok
  ) {
    rejectedSignatures++;
    json(res, 401, { error: 'invalid_signature' });
    return;
  }
  const envelope = JSON.parse(body.toString()) as {
    occurred_at?: unknown;
    data?: Record<string, unknown>;
  };
  const event = paddle.mapWebhookEvent(envelope);
  const workspaceId =
    event.kind === 'payment'
      ? event.workspaceId
      : event.kind === 'subscription'
        ? event.subscription.workspaceId
        : null;
  const f = Object.values(fixtures).find((f) => f.workspaceId === workspaceId);
  const subId =
    event.kind === 'subscription'
      ? event.subscription.providerSubscriptionId
      : 'providerSubscriptionId' in event
        ? event.providerSubscriptionId
        : null;
  if (!f && (!subId || !ownedSubscriptions.has(subId))) {
    json(res, 200, { ignored: 'outside_fixture' });
    return;
  }
  if (event.kind === 'payment' && event.outcome === 'succeeded' && f) {
    const transactionId = envelope.data?.id;
    const isLegacy = f === fixtures.legacy;
    if (
      !isLegacy &&
      (!f.bound ||
        transactionId !== f.bound ||
        (await paddle.readSandboxCheckout(f, f.bound)).hold !== 'paid')
    ) {
      json(res, 503, { error: 'exact_transaction_unconfirmed' });
      return;
    }
    if (isLegacy) {
      if (typeof transactionId !== 'string' || !/^txn_[a-z\d]{26}$/.test(transactionId))
        throw new Error('Invalid legacy transaction');
      const exact = await api(`/transactions/${transactionId}`);
      if (
        !['paid', 'completed'].includes(String(exact.data.status)) ||
        verifiedWorkspaceId(
          exact.data.custom_data as { workspace_id?: string; sig?: string },
          endpointSecret,
        ) !== f.workspaceId
      )
        throw new Error('Unverified legacy payment');
    }
    await journal(f, 'local.sandbox_checkout_paid', { transactionId });
  }
  if (subId) ownedSubscriptions.add(subId);
  verifiedWebhooks++;
  const result = await projector.process('paddle', event, envelope);
  if (result.kind === 'processed') verifiedEvents.push({ event, occurredAt: envelope.occurred_at });
  await record();
  json(res, result.kind === 'unresolved' ? 503 : 200, { outcome: result.kind });
}
async function checkoutPayload(name: CaseName) {
  const f = fixtures[name];
  if (name === 'modified') {
    if (!f.bound) throw new Error('Prepared artifact required');
    const exact = await api(`/transactions/${f.bound}`);
    await paddle.readSandboxCheckout(f, f.bound);
    return { kind: 'legacy', priceId, customData: exact.data.custom_data, clientToken };
  }
  if (name === 'legacy') {
    const session = await paddle.createCheckout({
      workspaceId: f.workspaceId,
      userEmail: `revocation-${process.env.GITHUB_RUN_ID}-legacy@example.test`,
      tierId: 'plus',
      cycle: 'monthly',
      providerPriceId: priceId,
    });
    if (session.provider !== 'paddle') throw new Error('Wrong fixture provider');
    return { kind: 'legacy', priceId, customData: session.customData, clientToken };
  }
  if (!f.bound) throw new Error('Bound artifact required');
  return { kind: 'transaction', transactionId: f.bound, clientToken };
}
const server = createServer((req, res) => {
  if (stopping) {
    json(res, 503, { error: 'fixture_stopping' });
    return;
  }
  const handler = (async () => {
    try {
      const url = new URL(req.url ?? '/', publicUrl);
      if (req.method === 'POST' && url.pathname === '/paddle-webhook') {
        await webhook(req, res);
        return;
      }
      if (req.method === 'GET' && ['/', '/pay', '/overlay-replay'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"><title>Sandbox checkout revocation</title></head><body><h1>Sandbox checkout revocation</h1><p>Synthetic test cards and example.test identities only. Production deletion stays held.</p><label>Private operator key <input id="operator" type="password" autocomplete="off"></label><button id="authenticate">Authenticate operator</button><label>Scenario <select id="scenario"><option value="cancel">Cancel unpaid and replay</option><option value="unopened">Cancel before first open</option><option value="modified">Copied prepared metadata</option><option value="pay">Payment wins</option><option value="race">Payment and cancellation race</option><option value="crash">Crash before binding</option><option value="legacy">Legacy copied payload</option></select></label><button id="prepare">Prepare once</button><button id="open">Open saved checkout</button><button id="revoke">Cancel unpaid attempt</button><button id="replay">Replay exact saved payload</button><button id="recover">Recover omitted binding</button><button id="finish">Finish and clean up</button><button id="abort">Abort and clean up</button><p id="message"></p><pre id="state"></pre><script type="module" src="/client.js"></script></body></html>',
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(clientJs);
        return;
      }
      if (
        !isRehearsalOperator(req.headers['x-rehearsal-key'], process.env.REHEARSAL_OPERATOR_KEY!)
      ) {
        json(res, 403, { error: 'private_operator_required' });
        return;
      }
      const name = url.searchParams.get('case');
      if (!cases.includes(name as CaseName)) {
        json(res, 400, { error: 'fixed_case_required' });
        return;
      }
      const selected = name as CaseName,
        f = fixtures[selected];
      if (req.method === 'GET' && url.pathname === '/state') {
        json(res, 200, await state(selected));
        return;
      }
      if (req.method !== 'POST' || req.headers.origin !== publicUrl) {
        json(res, 403, { error: 'fixture_origin_required' });
        return;
      }
      if (url.pathname === '/observation') {
        const observation = JSON.parse((await raw(req)).toString()) as {
          event?: unknown;
          mode?: unknown;
          replay?: unknown;
          requestedTransactionId?: unknown;
          observedTransactionId?: unknown;
          errorCode?: unknown;
          errorType?: unknown;
        };
        const allow = [
          'checkout.loaded',
          'checkout.error',
          'checkout.payment.initiated',
          'checkout.payment.error',
          'checkout.payment.failed',
          'checkout.completed',
          'checkout.closed',
        ];
        if (typeof observation.event !== 'string' || !allow.includes(observation.event))
          throw new Error('Fixed event required');
        const legacy = selected === 'legacy' || selected === 'modified';
        if (!legacy && observation.requestedTransactionId !== f.bound)
          throw new Error('Wrong requested transaction');
        if (
          ['checkout.loaded', 'checkout.payment.initiated', 'checkout.completed'].includes(
            observation.event,
          ) &&
          !legacy &&
          observation.observedTransactionId !== f.bound
        )
          throw new Error('Uncorrelated provider event');
        const isOriginal =
          selected === 'cancel' && observation.mode === 'overlay' && observation.replay === false;
        if (isOriginal && observation.event === 'checkout.closed') f.originalFrameClosed = true;
        const refusalCode = sandboxReplayRefusal({
          event: observation.event,
          code: observation.errorCode,
          type: observation.errorType,
          requestedId: observation.requestedTransactionId,
          boundId: f.bound,
          replay: observation.replay === true || isOriginal,
          stopped: f.revocation?.hold === 'stopped',
        });
        if (refusalCode) {
          if (observation.mode === 'hosted' && f.hostedReplay) f.hostedReplayRefused = true;
          if (observation.mode === 'overlay' && observation.replay === true && f.replayStarted)
            f.overlayReplayRefused = true;
          if (isOriginal && f.orderingVerified && !f.originalFrameClosed)
            f.originalFrameRefused = true;
        }
        // Fixed codes only; generic/network/domain errors remain unconfirmed.
        if (
          observation.event === 'checkout.error' ||
          observation.event === 'checkout.payment.error'
        ) {
          const allowed = [
            'transaction_not_ready_cannot_process_payment',
            'transaction_status_must_be_ready',
            'transaction_immutable',
            'validation',
            'transaction_checkout_url_domain_is_not_approved',
            'transaction_checkout_not_enabled',
            'transaction_default_checkout_url_not_set',
          ];
          const code = allowed.includes(String(observation.errorCode))
            ? String(observation.errorCode)
            : 'unknown';
          const mode = observation.mode === 'hosted' ? 'hosted' : 'overlay';
          (f.errors ??= []).push({ mode, code });
          await journal(f, 'local.sandbox_checkout_error_observed', { mode, code });
        }
        const value =
          observation.event === 'checkout.error' && f.replayStarted
            ? 'checkout.error_after_replay'
            : observation.event;
        if (!f.observations.includes(value)) f.observations.push(value);
        await record();
        json(res, 200, { recorded: true });
        return;
      }
      if (busy) throw new Error('Action already running');
      busy = true;
      try {
        if (url.pathname === '/abort') {
          evidence.aborted = true;
          stopping = true;
          json(res, 200, { aborted: true });
          return;
        }
        if (url.pathname === '/prepare') {
          if (f.attempted) throw new Error('Never retry uncertain create');
          f.attempted = true;
          f.createdAt = new Date(Date.now() - 1000).toISOString();
          // The production guard sees this unknown attempt. Transaction references
          // are deliberately NOT put in the subscription-reference artifact event.
          await db.insert(subscriptionEvents).values({
            provider: 'paddle',
            providerEventId: f.attemptId,
            eventType: 'local.checkout_attempted',
            payload: { workspaceId: f.workspaceId },
            processedAt: new Date(),
          });
          await record();
          if (selected !== 'legacy') {
            const facts = await paddle.prepareSandboxCheckout(
              f,
              `${publicUrl}/pay?case=${selected}`,
            );
            ownedTransactions.set(facts.transactionId, f);
            if (selected === 'crash') {
              evidence.crashBeforeBindingInjected = true; /* Intentionally omit durable binding, as a crash would. */
            } else {
              f.bound = facts.transactionId;
              await journal(f, 'local.sandbox_checkout_bound', { transactionId: f.bound });
            }
          }
          json(res, 200, await state(selected));
          return;
        }
        if (
          url.pathname === '/open' ||
          url.pathname === '/hosted-open' ||
          url.pathname === '/replay-open'
        ) {
          if (!f.attempted) throw new Error('Prepare first');
          if (f.opened || f.revocation?.hold === 'stopped' || url.pathname === '/replay-open')
            f.replayStarted = true;
          if (url.pathname === '/hosted-open') f.hostedReplay = true;
          f.opened = true;
          json(res, 200, {
            ...(await checkoutPayload(selected)),
            replay: f.replayStarted === true,
          });
          return;
        }
        if (url.pathname === '/replay') {
          if (!f.opened) throw new Error('Saved payload required');
          f.replayStarted = true;
          await record();
          json(res, 200, { replayRecorded: true });
          return;
        }
        if (url.pathname === '/recover') {
          if (selected !== 'crash' || !f.attempted || f.bound)
            throw new Error('Omitted binding required');
          const facts = await paddle.recoverSandboxCheckout(f, f.createdAt);
          f.bound = facts.transactionId;
          ownedTransactions.set(f.bound, f);
          await journal(f, 'local.sandbox_checkout_bound', { transactionId: f.bound });
          f.crashRecovered = true;
          json(res, 200, await state(selected));
          return;
        }
        if (url.pathname === '/revoke' || url.pathname === '/race-revoke') {
          if (!f.bound || selected === 'legacy') throw new Error('Owned new transaction required');
          if (selected === 'cancel') {
            if (
              !f.opened ||
              !f.observations.includes('checkout.loaded') ||
              f.originalFrameClosed ||
              f.replayStarted ||
              f.revocation
            )
              throw new Error('Loaded-before-revoke required');
            f.orderingVerified = true;
          }
          if (selected === 'unopened') {
            if (f.opened || f.revocation) throw new Error('Revoke-before-open required');
            f.orderingVerified = true;
          }
          if (selected === 'race') {
            if (
              url.pathname !== '/race-revoke' ||
              !f.opened ||
              !f.observations.includes('checkout.payment.initiated') ||
              f.raceInitiated
            )
              throw new Error('Actual initiation required');
            f.raceInitiated = true;
          }
          f.revocation = await paddle.revokeSandboxCheckout(f, f.bound);
          await journal(f, 'local.sandbox_checkout_revoke_observed', {
            status: f.revocation.status,
            hold: f.revocation.hold,
          });
          json(res, 200, await state(selected));
          return;
        }
        if (url.pathname === '/finish') {
          for (const c of cases) await state(c);
          if (
            fixtures.cancel.last?.proposedHold !== 'attempt_stopped_replay_observed' ||
            fixtures.unopened.last?.proposedHold !== 'attempt_stopped_replay_observed' ||
            !fixtures.cancel.hostedReplay ||
            !fixtures.unopened.hostedReplay ||
            !fixtures.modified.observations.includes('checkout.loaded') ||
            fixtures.modified.last?.replacementUnproven !== true ||
            !fixtures.cancel.orderingVerified ||
            !fixtures.cancel.originalFrameRefused ||
            !fixtures.unopened.orderingVerified ||
            fixtures.pay.last?.proposedHold !== 'paid' ||
            fixtures.pay.last?.paymentSticky !== true ||
            fixtures.pay.last?.workspaceTier !== 'plus' ||
            (fixtures.pay.last?.localSubscription as { status?: unknown; tier?: unknown } | null)
              ?.status !== 'active' ||
            !verifiedEvents.some(
              (e) =>
                e.event.kind === 'payment' &&
                e.event.workspaceId === fixtures.pay.workspaceId &&
                e.event.outcome === 'succeeded',
            ) ||
            !verifiedEvents.some(
              (e) =>
                e.event.kind === 'subscription' &&
                e.event.subscription.workspaceId === fixtures.pay.workspaceId &&
                e.event.subscription.status === 'active',
            ) ||
            !fixtures.race.raceInitiated ||
            !['paid', 'stopped'].includes(fixtures.race.revocation?.hold ?? '') ||
            !fixtures.crash.crashRecovered ||
            !fixtures.legacy.observations.includes('checkout.loaded') ||
            !fixtures.race.revocation ||
            cases.some((c) => fixtures[c].last?.productionGuard !== 'held')
          )
            throw new Error('All fixed proofs required');
          for (const e of verifiedEvents)
            if (
              (await projector.process('paddle', e.event, { occurred_at: e.occurredAt })).kind !==
              'duplicate'
            )
              throw new Error('Replay dedup failed');
          evidence.verifiedReplayDedup = true;
          evidence.proofAssertionsPassed = true;
          finished = true;
          json(res, 200, { completed: true });
          return;
        }
        json(res, 404, { error: 'fixed_action_required' });
      } finally {
        busy = false;
      }
    } catch {
      if (!res.headersSent) json(res, 503, { error: 'action_unconfirmed_hold_retained' });
    }
  })();
  active.add(handler);
  void handler.finally(() => active.delete(handler));
});
async function shutdown() {
  stopping = true;
  server.close();
  try {
    if (tokenAttempted && !tokenId) {
      const found = (await list('/client-tokens', { status: 'active,revoked' })).filter(
        (t) =>
          t.name === resourceName && t.description === 'Disposable checkout revocation fixture',
      );
      if (found.length !== 1) throw new Error('Unknown token');
      tokenId = String(found[0]!.id);
    }
    if (destinationAttempted && !destinationId) {
      const found = (await list('/notification-settings')).filter(
        (d) => d.description === resourceName && d.destination === publicUrl + '/paddle-webhook',
      );
      if (found.length !== 1) throw new Error('Unknown destination');
      destinationId = String(found[0]!.id);
    }
    cleanup.capabilityRecoveryVerified = true;
  } catch {
    cleanup.capabilityRecoveryVerified = false;
  }
  if (destinationId)
    try {
      await api(`/notification-settings/${destinationId}`, 'PATCH', { active: false });
      cleanup.destinationStopped =
        (await api(`/notification-settings/${destinationId}`)).data.active === false;
    } catch {
      cleanup.destinationStopped = false;
    }
  if (tokenId)
    try {
      await api(`/client-tokens/${tokenId}`, 'PATCH', { status: 'revoked' });
      cleanup.tokenRevoked = (await api(`/client-tokens/${tokenId}`)).data.status === 'revoked';
    } catch {
      cleanup.tokenRevoked = false;
    }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drained = await Promise.race([
    Promise.allSettled([...active]).then(() => true),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), 45_000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  cleanup.handlersDrained = drained;
  // Recover all owned provider artifacts, including browser-created legacy
  // transactions and creates whose response was lost. Never mutate other fixtures.
  // An empty provider scan cannot disprove an accepted-but-unseen create.
  // Every started server attempt needs an exact signed owned record for cleanup.
  const attempts = cases
    .filter((name) => fixtures[name])
    .map((name) => ({ ...fixtures[name], legacy: name === 'legacy' }));
  const recovered = await collectSandboxAttemptCleanup(attempts, paddle);
  const attemptsRecovered = recovered.complete;
  for (const { facts, identity } of recovered.records)
    ownedTransactions.set(facts.transactionId, identity);
  cleanup.attemptsRecovered = attemptsRecovered;
  try {
    if (paddle) {
      for (const t of await list('/transactions', { 'created_at[GTE]': startedAt })) {
        const normalized = paddle.mapWebhookEvent({
          event_id: 'cleanup-read',
          event_type: 'transaction.completed',
          data: t,
        });
        const f =
          normalized.kind === 'payment'
            ? Object.values(fixtures).find((f) => f.workspaceId === normalized.workspaceId)
            : undefined;
        if (f && typeof t.id === 'string') {
          if (typeof t.subscription_id === 'string') ownedSubscriptions.add(t.subscription_id);
          if (t.status === 'draft' || t.status === 'ready') {
            await api(`/transactions/${t.id}`, 'PATCH', { status: 'canceled' });
            if ((await api(`/transactions/${t.id}`)).data.status !== 'canceled')
              throw new Error('Unpaid artifact unconfirmed');
          } else if (!['canceled', 'paid', 'completed'].includes(String(t.status)))
            throw new Error('Unknown owned transaction');
        }
      }
      for (const s of await list('/subscriptions', {
        status: 'active,canceled,paused,past_due,trialing',
      })) {
        const mapped = paddle.mapWebhookEvent({
          event_id: 'cleanup-sub-read',
          event_type: 'subscription.updated',
          data: s,
        });
        if (
          mapped.kind === 'subscription' &&
          Object.values(fixtures).some((f) => f.workspaceId === mapped.subscription.workspaceId)
        )
          ownedSubscriptions.add(mapped.subscription.providerSubscriptionId);
      }
    }
    cleanup.providerRecoveryVerified = attemptsRecovered;
  } catch {
    cleanup.providerRecoveryVerified = false;
  }
  let stopped = true;
  for (const id of ownedSubscriptions) {
    try {
      await api(`/subscriptions/${id}/cancel`, 'POST', { effective_from: 'immediately' });
    } catch {
      /* Fresh read decides. */
    }
    if ((await paddle.deletionBillingState(id).catch(() => 'unknown')) !== 'stopped')
      stopped = false;
  }
  cleanup.subscriptionsStopped = stopped;
  for (const [id, identity] of ownedTransactions) {
    const facts = await paddle.revokeSandboxCheckout(identity, id).catch(() => null);
    if (!facts || (facts.hold !== 'stopped' && facts.hold !== 'paid'))
      cleanup.providerRecoveryVerified = false;
    if (facts?.subscriptionId) ownedSubscriptions.add(facts.subscriptionId);
  }
  // A payment may link its subscription after the first ownership scan. Wait
  // within a fixed settlement bound, then stop every freshly observed owned sub.
  const settlementDeadline = Date.now() + 30_000;
  let settled = false;
  while (!settled && Date.now() < settlementDeadline) {
    try {
      const all = (await list('/transactions', { 'created_at[GTE]': startedAt })).filter((t) =>
        Object.values(fixtures).some(
          (f) =>
            verifiedWorkspaceId(
              t.custom_data as { workspace_id?: string; sig?: string } | null,
              endpointSecret,
            ) === f.workspaceId,
        ),
      );
      settled = true;
      for (const t of all) {
        if (typeof t.id !== 'string' || !/^txn_[a-z\d]{26}$/.test(t.id))
          throw new Error('Unknown transaction');
        let exact = (await api(`/transactions/${t.id}`)).data;
        if (['draft', 'ready'].includes(String(exact.status))) {
          try {
            await api(`/transactions/${t.id}`, 'PATCH', { status: 'canceled' });
          } catch {
            /* Payment may have won; fresh read below. */
          }
          exact = (await api(`/transactions/${t.id}`)).data;
        }
        if (exact.status === 'canceled' && exact.subscription_id === null) continue;
        if (exact.status !== 'completed' || typeof exact.subscription_id !== 'string') {
          settled = false;
          continue;
        }
        ownedSubscriptions.add(exact.subscription_id);
      }
    } catch {
      settled = false;
    }
    if (!settled) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!settled) cleanup.providerRecoveryVerified = false;
  for (const id of ownedSubscriptions) {
    try {
      await api(`/subscriptions/${id}/cancel`, 'POST', { effective_from: 'immediately' });
    } catch {
      /* Fresh terminal read remains necessary. */
    }
    if ((await paddle.deletionBillingState(id).catch(() => 'unknown')) !== 'stopped')
      stopped = false;
  }
  cleanup.subscriptionsStopped = stopped;
  cleanup.finalSettlementVerified = settled;
  if (
    !drained ||
    !cleanup.capabilityRecoveryVerified ||
    !cleanup.providerRecoveryVerified ||
    !stopped ||
    (tokenAttempted && !cleanup.tokenRevoked) ||
    (destinationAttempted && !cleanup.destinationStopped)
  )
    process.exitCode = 1;
  evidence.completed = finished && process.exitCode !== 1;
  await record();
  server.closeAllConnections();
  await pg.end();
}
try {
  clientJs = await buildCheckoutRevocationClient();
  const price = await api(`/prices/${priceId}`);
  if (price.data.id !== priceId || price.data.status !== 'active')
    throw new Error('Catalog mismatch');
  evidence.catalogRead = true;
  await api('/notification-settings');
  evidence.destinationsRead = true;
  for (const name of cases) {
    const [w] = await db
      .insert(workspaces)
      .values({ name: `Synthetic ${name} checkout revocation` })
      .returning();
    const [u] = await db
      .insert(users)
      .values({
        workspaceId: w!.id,
        email: `revocation-${process.env.GITHUB_RUN_ID}-${name}@example.test`,
      })
      .returning();
    fixtures[name] = {
      workspaceId: w!.id,
      userId: u!.id,
      attemptId: randomUUID(),
      priceId,
      createdAt: startedAt,
      attempted: false,
      observations: [],
      opened: false,
    };
  }
  await record();
  tokenAttempted = true;
  const token = await api('/client-tokens', 'POST', {
    name: resourceName,
    description: 'Disposable checkout revocation fixture',
  });
  if (
    typeof token.data.id !== 'string' ||
    typeof token.data.token !== 'string' ||
    !token.data.token.startsWith('test_')
  )
    throw new Error('Sandbox token required');
  tokenId = token.data.id;
  clientToken = token.data.token;
  console.log(`::add-mask::${clientToken}`);
  await record();
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
    ],
  });
  if (
    typeof destination.data.id !== 'string' ||
    typeof destination.data.endpoint_secret_key !== 'string'
  )
    throw new Error('Own destination required');
  destinationId = destination.data.id;
  endpointSecret = destination.data.endpoint_secret_key;
  console.log(`::add-mask::${endpointSecret}`);
  paddle = new PaddleAdapter({
    PADDLE_ENV: 'sandbox',
    BILLING_CHECKOUT_REVOCATION_REHEARSAL: 'sandbox',
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
      paddlePriceId: priceId,
      razorpayPlanId: null,
    },
  ]);
  projector = new BillingWebhookService(
    db,
    catalog,
    new AutopilotReadService(db),
    new BillingUpgradeRefundService(db, catalog, paddle),
  );
  guard = new BillingDeletionGuard(db, paddle, new RazorpayAdapter({}));
  await listenRehearsalServer(server);
  if ((await fetch('http://127.0.0.1:4049/state?case=cancel')).status !== 403)
    throw new Error('Operator gate unconfirmed');
  if (
    (await fetch('http://127.0.0.1:4049/paddle-webhook', { method: 'POST', body: '{}' })).status !==
    401
  )
    throw new Error('Signature gate unconfirmed');
  evidence.privateOperatorEnforced = true;
  evidence.invalidSignatureRejected = true;
  evidence.phase = 'awaiting_synthetic_browser';
  await record();
  console.log(`Synthetic checkout revocation UI: ${publicUrl}`);
  const stop = new Promise<void>((r) => {
    const end = () => {
      stopping = true;
      r();
    };
    process.once('SIGTERM', end);
    process.once('SIGINT', end);
  });
  const deadline = Date.now() + 45 * 60_000;
  while (!finished && !stopping && Date.now() < deadline)
    await Promise.race([stop, new Promise<void>((r) => setTimeout(r, 1000))]);
} catch {
  evidence.error = 'sandbox_rehearsal_unconfirmed';
  process.exitCode = 1;
} finally {
  await shutdown();
  if (!finished) process.exitCode = 1;
}
