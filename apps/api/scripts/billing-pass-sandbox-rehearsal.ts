/** Isolated CI sandbox only. No Gmail, production data, live key, or email delivery. */
import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { asc, eq } from 'drizzle-orm';
import { entitlementGrants, schema, users, workspaces } from '@declutrmail/db';
import {
  checkoutDiscountId,
  OFFERS,
  PROMO_DISCOUNT_IDS,
  SANDBOX_PRICE_IDS,
} from '@declutrmail/shared/entitlements';
import { AutopilotReadService } from '../src/autopilot/autopilot.read-service.js';
import { BillingCatalog } from '../src/billing/billing-catalog.js';
import { BillingUpgradeRefundService } from '../src/billing/billing-upgrade-refund.service.js';
import { BillingWebhookService } from '../src/billing/billing-webhook.service.js';
import type { DrizzleDb } from '../src/db/db.module.js';
import { PaddleAdapter } from '../src/billing/paddle.adapter.js';
import {
  describeRehearsalFailure,
  formatRehearsalExit,
  formatRehearsalFailure,
  installRehearsalFailureHandlers,
  rehearsalOutcome,
  runOnce,
  type RehearsalFailure,
} from './helpers/rehearsal-failure.js';
import {
  discountIsUnexpired,
  discountMatchesPercent,
  discountPriceIds,
  paddleProviderCode,
  passTransactionCreateBody,
  rehearsalPayUrl,
  renderSandboxPayPage,
  renewalIsFullPrice,
  SANDBOX_API_ORIGIN,
  withinWindow,
} from './helpers/pass-rehearsal-assertions.js';
import {
  assertSandboxRehearsalEnvironment,
  listenRehearsalServer,
} from './helpers/sandbox-rehearsal-boundary.js';
import { paySandboxCheckout, type CheckoutPayFailure } from './helpers/sandbox-checkout-pay.js';

assertSandboxRehearsalEnvironment(process.env);
const publicUrl = process.env.REHEARSAL_PUBLIC_URL!;
const reportPath = process.env.REHEARSAL_REPORT_PATH!;
if (!process.env.RUNNER_TEMP || !reportPath?.startsWith(process.env.RUNNER_TEMP + '/'))
  throw new Error('Runner-local report path required');
const key = process.env.PADDLE_API_KEY!;
const runId = process.env.GITHUB_RUN_ID!;
const resourceName = `Backlog Pass ${runId}-${process.env.GITHUB_RUN_ATTEMPT}`;
const pg = postgres(process.env.DATABASE_URL!, { max: 8 });
const db = drizzle(pg, { schema }) as unknown as DrizzleDb;
const PASS = SANDBOX_PRICE_IDS.pass_onetime;
const ANNUAL = SANDBOX_PRICE_IDS.plus_annual;
const DISCOUNT = PROMO_DISCOUNT_IDS.sandbox;
const DAY_MS = 24 * 60 * 60 * 1000;

const cleanup: Record<string, boolean | string> = {};
const evidence: Record<string, unknown> = { sandboxOnly: true, fixtureOnly: true, cleanup };
const subscriptionIds = new Set<string>();
const transactionIds = new Set<string>();
const customerIds = new Set<string>();
const workspaceIds = new Set<string>();
let destinationId = '';
let endpointSecret = '';
let destinationAttempted = false;
let clientToken = '';
let tokenId = '';
let stopping = false;
let finished = false;
let paddle: PaddleAdapter | undefined;
let projector: BillingWebhookService | undefined;
const captured: { pass: { body: Buffer; json: Record<string, unknown> } | null } = {
  pass: null,
};
let passTransactionId = '';

function signWorkspace(workspaceId: string): string {
  return createHmac('sha256', endpointSecret)
    .update(`paddle:workspace:${workspaceId}`)
    .digest('hex');
}

async function record() {
  await writeFile(reportPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) throw new Error('Body bound');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(SANDBOX_API_ORIGIN + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    let providerCode: string | null;
    try {
      providerCode = paddleProviderCode(await response.json());
    } catch {
      providerCode = null;
    }
    if (providerCode) {
      evidence.providerCode = providerCode;
      console.error(`rehearsal.provider_code=${providerCode}`);
    }
    throw new Error(`sandbox_http_${response.status}`);
  }
  if (response.status === 204) return { data: {} as Record<string, unknown> };
  return (await response.json()) as { data: Record<string, unknown> };
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function webhook(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const header = req.headers['paddle-signature'];
  if (
    !paddle ||
    !projector ||
    !paddle.verifyWebhookSignature({
      rawBody: body,
      signatureHeader: typeof header === 'string' ? header : undefined,
      secret: endpointSecret,
    }).ok
  ) {
    json(res, 401, { error: 'invalid_signature' });
    return;
  }
  const envelope = JSON.parse(body.toString()) as Record<string, unknown>;
  const event = paddle.mapWebhookEvent(envelope);
  const workspaceId =
    event.kind === 'payment'
      ? event.workspaceId
      : event.kind === 'subscription'
        ? event.subscription.workspaceId
        : null;
  if (!workspaceId || !workspaceIds.has(workspaceId)) {
    json(res, 200, { ignored: 'outside_fixture' });
    return;
  }
  if (event.kind === 'subscription') subscriptionIds.add(event.subscription.providerSubscriptionId);
  if (
    event.kind === 'payment' &&
    event.outcome === 'succeeded' &&
    event.providerTransactionId === passTransactionId
  )
    captured.pass = { body, json: envelope };
  const result = await projector.process('paddle', event, envelope);
  json(res, result.kind === 'unresolved' ? 503 : 200, {
    outcome: result.kind,
    effect: result.kind === 'processed' ? result.effect : result.kind,
  });
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (stopping) {
        json(res, 503, { error: 'fixture_stopping' });
        return;
      }
      const url = new URL(req.url ?? '/', publicUrl);
      if (req.method === 'POST' && url.pathname === '/paddle-webhook') {
        await webhook(req, res);
        return;
      }
      const txn = url.searchParams.get('_ptxn') ?? '';
      if (
        req.method === 'GET' &&
        url.pathname === '/pay' &&
        clientToken &&
        transactionIds.has(txn)
      ) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(renderSandboxPayPage(clientToken, txn));
        return;
      }
      json(res, 403, { error: 'private' });
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'fixture' });
    }
  })();
});

async function fixture(name: 'pass' | 'annual'): Promise<{ workspaceId: string; email: string }> {
  const email = `${name}-${runId}-${process.env.GITHUB_RUN_ATTEMPT}@example.test`;
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `Synthetic ${name} backlog pass` })
    .returning();
  await db.insert(users).values({ workspaceId: workspace!.id, email });
  workspaceIds.add(workspace!.id);
  return { workspaceId: workspace!.id, email };
}

async function customerFor(email: string): Promise<{ customerId: string; addressId: string }> {
  const customer = await api('/customers', 'POST', { email, name: 'Synthetic Fixture' });
  const customerId = String(customer.data.id);
  if (!/^ctm_[a-z\d]{26}$/.test(customerId)) throw new Error('Sandbox customer was not created');
  customerIds.add(customerId);
  const address = await api(`/customers/${customerId}/addresses`, 'POST', {
    country_code: 'US',
    postal_code: '10001',
    region: 'NY',
    city: 'New York',
    first_line: '1 Synthetic Street',
  });
  const addressId = String(address.data.id);
  if (!/^add_[a-z\d]{26}$/.test(addressId)) throw new Error('Sandbox address was not created');
  return { customerId, addressId };
}

async function openTransaction(input: {
  priceId: string;
  workspaceId: string;
  customerId: string;
  addressId: string;
  discountId?: string;
}): Promise<{ id: string; url: string; subtotal: string; discount: string }> {
  const created = await api(
    '/transactions',
    'POST',
    passTransactionCreateBody({
      ...input,
      signature: signWorkspace(input.workspaceId),
    }),
  );
  const id = String(created.data.id);
  if (!/^txn_[a-z\d]{26}$/.test(id)) throw new Error('Sandbox transaction was not created');
  transactionIds.add(id);
  const url = rehearsalPayUrl(publicUrl, id);
  const money = moneyOf(created.data);
  return { id, url, ...money };
}

function moneyOf(data: Record<string, unknown>): { subtotal: string; discount: string } {
  const details = data.details as
    { totals?: { subtotal?: unknown; discount?: unknown } } | undefined;
  const subtotal = details?.totals?.subtotal;
  const discount = details?.totals?.discount;
  if (typeof subtotal !== 'string' || typeof discount !== 'string')
    throw new Error('Payment total was missing');
  return { subtotal, discount };
}

async function transaction(id: string) {
  const exact = await api(`/transactions/${id}`);
  if (exact.data.id !== id) throw new Error('Sandbox transaction did not match');
  const subscriptionId = exact.data.subscription_id;
  if (typeof subscriptionId === 'string') subscriptionIds.add(subscriptionId);
  return exact.data;
}

async function transactionPaid(id: string): Promise<boolean> {
  try {
    const exact = await transaction(id);
    return exact.status === 'completed' || exact.status === 'paid';
  } catch {
    return false;
  }
}

async function waitUntil(message: string, ready: () => Promise<boolean>, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(message);
}

async function grantsFor(email: string) {
  return db
    .select({
      expiresAt: entitlementGrants.expiresAt,
      providerTransactionId: entitlementGrants.providerTransactionId,
      tier: entitlementGrants.tier,
      source: entitlementGrants.source,
    })
    .from(entitlementGrants)
    .where(eq(entitlementGrants.email, email))
    .orderBy(asc(entitlementGrants.createdAt));
}

function signBody(body: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const h1 = createHmac('sha256', endpointSecret).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

async function replay(raw: Record<string, unknown>): Promise<{ outcome: string; effect: string }> {
  const body = JSON.stringify(raw);
  const response = await fetch(`http://127.0.0.1:4049/paddle-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paddle-Signature': signBody(body) },
    body,
  });
  if (!response.ok) throw new Error('Replay signature was rejected');
  return (await response.json()) as { outcome: string; effect: string };
}

async function shutdown() {
  stopping = true;
  server.close();
  if (destinationId) {
    try {
      await api(`/notification-settings/${destinationId}`, 'PATCH', { active: false });
      cleanup.destinationStopped =
        (await api(`/notification-settings/${destinationId}`)).data.active === false;
    } catch {
      cleanup.destinationStopped = false;
    }
  } else if (destinationAttempted) cleanup.destinationStopped = false;
  for (const id of transactionIds) {
    try {
      const exact = await transaction(id);
      if (exact.status === 'draft' || exact.status === 'ready')
        await api(`/transactions/${id}`, 'PATCH', { status: 'canceled' });
    } catch {
      cleanup.transactionsCanceled = false;
    }
  }
  if (cleanup.transactionsCanceled !== false) cleanup.transactionsCanceled = true;
  let stopped = true;
  for (const id of subscriptionIds) {
    try {
      await api(`/subscriptions/${id}/cancel`, 'POST', { effective_from: 'immediately' });
    } catch {
      /* A second read decides. */
    }
    const deadline = Date.now() + 45_000;
    let state: 'stopped' | 'billable' | 'unknown' = 'unknown';
    while (Date.now() < deadline) {
      state = paddle ? await paddle.deletionBillingState(id).catch(() => 'unknown') : 'unknown';
      if (state === 'stopped') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (state !== 'stopped') stopped = false;
  }
  cleanup.subscriptionsStopped = stopped;
  let archived = 0;
  for (const id of customerIds) {
    try {
      const response = await fetch(`${SANDBOX_API_ORIGIN}/customers/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Paddle-Version': '1',
        },
        body: JSON.stringify({ status: 'archived' }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) archived += 1;
      else if (response.status === 401 || response.status === 403)
        cleanup.customersArchived = false;
      else cleanup.customerArchive = 'unsupported';
    } catch {
      cleanup.customersArchived = false;
    }
  }
  if (customerIds.size > 0 && archived === customerIds.size) cleanup.customersArchived = true;
  if (tokenId) {
    try {
      await api(`/client-tokens/${tokenId}`, 'PATCH', { status: 'revoked' });
      cleanup.tokenRevoked = (await api(`/client-tokens/${tokenId}`)).data.status === 'revoked';
    } catch {
      cleanup.tokenRevoked = false;
    }
  }
  if (Object.values(cleanup).some((value) => value === false)) process.exitCode = 1;
  evidence.completed = finished && process.exitCode !== 1;
  await record();
  server.closeAllConnections();
  await pg.end();
}

const cleanupOnce = runOnce(shutdown);
function recordFailure(failure: RehearsalFailure) {
  if (evidence.error) return;
  evidence.error = failure;
  evidence.errorPhase = evidence.phase ?? 'unknown';
}
const shotsDir = join(dirname(reportPath), 'pass-sandbox-shots');
function noteUnpaid(unpaid: CheckoutPayFailure) {
  evidence.checkoutFrames = unpaid.frames;
  evidence.checkoutHosts = unpaid.hosts;
  evidence.checkoutOverlay = unpaid.overlay;
  evidence.checkoutCard = unpaid.card;
  evidence.checkoutPay = unpaid.pay;
  evidence.checkoutEvents = unpaid.events;
  evidence.checkoutConsole = unpaid.consoleLines;
  evidence.checkoutShots = unpaid.shots;
  evidence.checkoutFields = unpaid.fields;
}
async function failUnpaid(unpaid: CheckoutPayFailure, id: string): Promise<never> {
  noteUnpaid(unpaid);
  try {
    const status = (await transaction(id)).status;
    evidence.transactionStatus =
      typeof status === 'string' &&
      /^(draft|ready|paid|completed|canceled|past_due|billed)$/.test(status)
        ? status
        : 'unread';
  } catch {
    evidence.transactionStatus = 'unread';
  }
  throw new Error('Sandbox checkout payment was not completed');
}
installRehearsalFailureHandlers({
  onFailure: recordFailure,
  phase: () => evidence.phase,
  shutdown: cleanupOnce,
});

try {
  evidence.phase = 'catalog';
  if (checkoutDiscountId(process.env, ANNUAL) !== DISCOUNT)
    throw new Error('Discount rehearsal requires an unexpired configured promotion');
  const passPrice = await api(`/prices/${PASS}`);
  const annualPrice = await api(`/prices/${ANNUAL}`);
  const discount = await api(`/discounts/${DISCOUNT}`);
  const passCycle = passPrice.data.billing_cycle;
  const annualCycle = annualPrice.data.billing_cycle as { interval?: unknown } | null;
  const unit = (row: Record<string, unknown>) =>
    (row.unit_price as { amount?: unknown; currency_code?: unknown } | undefined) ?? {};
  if (
    passPrice.data.status !== 'active' ||
    passCycle !== null ||
    unit(passPrice.data).amount !== '1900' ||
    unit(passPrice.data).currency_code !== 'USD'
  )
    throw new Error('Pass price was not the launch amount');
  if (
    annualPrice.data.status !== 'active' ||
    annualCycle?.interval !== 'year' ||
    unit(annualPrice.data).amount !== '5900' ||
    unit(annualPrice.data).currency_code !== 'USD'
  )
    throw new Error('Annual price was not the launch amount');
  const restrict = discount.data.restrict_to;
  evidence.discountPriceCount = Array.isArray(restrict)
    ? restrict.filter((id) => typeof id === 'string' && id.startsWith('pri_')).length
    : 0;
  if (discount.data.status !== 'active') throw new Error('Discount was not active');
  if (!discountIsUnexpired(discount.data.expires_at))
    throw new Error('Discount expiry was invalid or elapsed');
  if (discount.data.type !== 'percentage' || Number(discount.data.amount) !== 30)
    throw new Error('Discount was not thirty percent');
  if (discount.data.recur !== false) throw new Error('Discount was not first payment only');
  if (discount.data.code !== 'PH30') throw new Error('Discount code did not match');
  if (!discountPriceIds(restrict, [PASS, ANNUAL]))
    throw new Error('Discount did not cover both prices');
  if (OFFERS.backlogPass.durationDays !== 30) throw new Error('Pass duration was not thirty days');
  evidence.catalogRead = true;
  await record();

  evidence.phase = 'destination';
  destinationAttempted = true;
  const destination = await api('/notification-settings', 'POST', {
    description: resourceName,
    type: 'url',
    destination: `${publicUrl}/paddle-webhook`,
    api_version: 1,
    include_sensitive_fields: false,
    traffic_source: 'platform',
    subscribed_events: [
      'transaction.completed',
      'subscription.created',
      'subscription.activated',
      'subscription.updated',
      'subscription.canceled',
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
    PADDLE_API_KEY: key,
    PADDLE_WEBHOOK_SECRET: endpointSecret,
  });
  const catalog = new BillingCatalog(
    [
      {
        planCode: 'plus_annual',
        tierId: 'plus',
        cycle: 'annual',
        founding: false,
        usdCents: 5900,
        paddlePriceId: ANNUAL,
        razorpayPlanId: null,
      },
    ],
    0,
    PASS,
  );
  projector = new BillingWebhookService(
    db,
    catalog,
    new AutopilotReadService(db),
    new BillingUpgradeRefundService(db, catalog, paddle),
  );
  const token = await api('/client-tokens', 'POST', {
    name: resourceName,
    description: 'Disposable backlog pass checkout',
  });
  if (
    typeof token.data.id !== 'string' ||
    typeof token.data.token !== 'string' ||
    !/^test_[A-Za-z0-9_]{8,200}$/.test(token.data.token)
  )
    throw new Error('Sandbox client token required');
  tokenId = token.data.id;
  clientToken = token.data.token;
  console.log(`::add-mask::${clientToken}`);
  evidence.clientTokenCreated = true;
  await listenRehearsalServer(server);
  if ((await fetch('http://127.0.0.1:4049/state')).status !== 403)
    throw new Error('Operator gate unconfirmed');

  evidence.phase = 'pass_first';
  const pass = await fixture('pass');
  const passCustomer = await customerFor(pass.email);
  const first = await openTransaction({
    priceId: PASS,
    workspaceId: pass.workspaceId,
    ...passCustomer,
  });
  passTransactionId = first.id;
  const unpaid = await paySandboxCheckout(first.url, pass.email, () => transactionPaid(first.id), {
    shotsDir,
    label: 'pass-first',
  });
  if (unpaid) await failUnpaid(unpaid, first.id);
  await waitUntil(
    'Pass grant did not arrive',
    async () => (await grantsFor(pass.email)).length === 1,
  );
  const [firstGrant] = await grantsFor(pass.email);
  if (
    !firstGrant?.expiresAt ||
    firstGrant.tier !== 'plus' ||
    firstGrant.source !== 'pass' ||
    firstGrant.providerTransactionId !== first.id ||
    !withinWindow(firstGrant.expiresAt, Date.now() + 30 * DAY_MS, 15 * 60 * 1000)
  )
    throw new Error('First pass grant was not thirty days');
  const [passWorkspace] = await db
    .select({ tier: workspaces.tier })
    .from(workspaces)
    .where(eq(workspaces.id, pass.workspaceId));
  if (passWorkspace?.tier !== 'plus') throw new Error('Workspace tier was not plus');
  evidence.passFirst = true;
  await record();

  evidence.phase = 'pass_second';
  const second = await openTransaction({
    priceId: PASS,
    workspaceId: pass.workspaceId,
    ...passCustomer,
  });
  const secondUnpaid = await paySandboxCheckout(
    second.url,
    pass.email,
    () => transactionPaid(second.id),
    { shotsDir, label: 'pass-second' },
  );
  if (secondUnpaid) await failUnpaid(secondUnpaid, second.id);
  await waitUntil(
    'Pass extension did not arrive',
    async () => (await grantsFor(pass.email)).length === 2,
  );
  const both = await grantsFor(pass.email);
  const extended = both[1];
  if (
    !extended?.expiresAt ||
    !firstGrant.expiresAt ||
    extended.providerTransactionId !== second.id ||
    Math.abs(extended.expiresAt.getTime() - firstGrant.expiresAt.getTime() - 30 * DAY_MS) > 60_000
  )
    throw new Error('Pass extension did not add thirty days');
  evidence.passExtended = true;
  await record();

  evidence.phase = 'replay';
  const stored = captured.pass;
  if (!stored) throw new Error('Pass webhook did not arrive');
  const replayed = structuredClone(stored.json);
  replayed.event_id = `evt_replay${randomUUID().replace(/-/g, '')}`;
  const replayResult = await replay(replayed);
  if (replayResult.effect !== 'pass:duplicate') throw new Error('Replay did not stay a duplicate');
  const afterReplay = await grantsFor(pass.email);
  if (
    afterReplay.length !== 2 ||
    afterReplay.some((row, index) => row.expiresAt?.getTime() !== both[index]?.expiresAt?.getTime())
  )
    throw new Error('Replay inserted another grant');
  evidence.passReplay = true;
  await record();

  evidence.phase = 'annual';
  const annual = await fixture('annual');
  const annualCustomer = await customerFor(annual.email);
  const annualTxn = await openTransaction({
    priceId: ANNUAL,
    workspaceId: annual.workspaceId,
    discountId: DISCOUNT,
    ...annualCustomer,
  });
  if (
    !discountMatchesPercent(annualTxn.subtotal, annualTxn.discount, 30) ||
    annualTxn.subtotal !== '5900'
  )
    throw new Error('Discount was not thirty percent of the annual price');
  const annualUnpaid = await paySandboxCheckout(
    annualTxn.url,
    annual.email,
    () => transactionPaid(annualTxn.id),
    { shotsDir, label: 'annual' },
  );
  if (annualUnpaid) await failUnpaid(annualUnpaid, annualTxn.id);
  await waitUntil('Annual payment did not complete', async () => {
    const exact = await transaction(annualTxn.id);
    return exact.status === 'completed' && typeof exact.subscription_id === 'string';
  });
  const paid = await transaction(annualTxn.id);
  const paidMoney = moneyOf(paid);
  if (
    !discountMatchesPercent(paidMoney.subtotal, paidMoney.discount, 30) ||
    paid.discount_id !== DISCOUNT
  )
    throw new Error('Completed payment did not keep the discount');
  const subscriptionId = String(paid.subscription_id);
  let renewalSubtotal = '';
  let renewalDiscount = '';
  let subscriptionDiscount: 'none' | 'present' = 'present';
  await waitUntil('Renewal total was missing', async () => {
    const subscription = await api(
      `/subscriptions/${subscriptionId}?include=recurring_transaction_details`,
    );
    const recurring = subscription.data.recurring_transaction_details as
      { totals?: { subtotal?: unknown; discount?: unknown } } | undefined;
    if (
      typeof recurring?.totals?.subtotal !== 'string' ||
      typeof recurring.totals.discount !== 'string'
    )
      return false;
    renewalSubtotal = recurring.totals.subtotal;
    renewalDiscount = recurring.totals.discount;
    subscriptionDiscount = subscription.data.discount === null ? 'none' : 'present';
    return true;
  });
  if (!renewalIsFullPrice(renewalSubtotal, renewalDiscount, paidMoney.subtotal))
    throw new Error('Renewal still carried the discount');
  evidence.annual = {
    subtotalCents: paidMoney.subtotal,
    discountCents: paidMoney.discount,
    renewalSubtotalCents: renewalSubtotal,
    renewalDiscountCents: renewalDiscount,
    subscriptionDiscount,
  };
  evidence.phase = 'done';
  finished = true;
  await record();
} catch (error) {
  const failure = describeRehearsalFailure(error, 'main');
  console.error(formatRehearsalFailure(failure, evidence.phase));
  recordFailure(failure);
  process.exitCode = 1;
} finally {
  try {
    await cleanupOnce();
  } catch (error) {
    const failure = describeRehearsalFailure(error, 'shutdown');
    console.error(formatRehearsalFailure(failure, evidence.phase));
    recordFailure(failure);
    process.exitCode = 1;
    await record().catch(() => undefined);
    server.closeAllConnections();
    await pg.end({ timeout: 5 }).catch(() => undefined);
  }
  if (!finished) process.exitCode = 1;
  console.error(
    formatRehearsalExit(
      rehearsalOutcome({ finished, aborted: evidence.aborted, error: evidence.error, cleanup }),
      evidence.phase,
    ),
  );
}
