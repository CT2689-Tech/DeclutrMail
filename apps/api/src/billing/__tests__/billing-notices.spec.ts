import { entitlementGrants, outboxEvents, subscriptions, users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { EmailSendWorker, type EmailSendJobData } from '@declutrmail/workers';
import {
  BillingLifecycleChangedPayloadSchema,
  type BillingLifecycleChangedPayload,
} from '@declutrmail/events';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrizzleDb } from '../../db/db.module.js';
import {
  buildBillingNoticeResolver,
  publishGrantExpiryNotices,
  publishSubscriptionNotices,
  subscriptionNoticeSnapshot,
} from '../billing-notices.js';
let db: DrizzleDb, ws: string, userId: string, subId: string, now: Date;
const DAY = 86_400_000;
async function cancel() {
  await db.transaction(async (tx) => {
    const before = await subscriptionNoticeSnapshot(tx, 'paddle', 'sub_notice');
    await tx
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(subscriptions.id, subId));
    await publishSubscriptionNotices(tx, before);
  });
}
async function notice(kind?: string) {
  const rows = await db.select().from(outboxEvents);
  const row = kind ? rows.find((r) => (r.payload as { kind: string }).kind === kind) : rows[0];
  return BillingLifecycleChangedPayloadSchema.parse(row!.payload);
}
beforeEach(async () => {
  now = new Date();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  process.env.BILLING_APP_NOTICES_ENABLED = 'true';
  process.env.BILLING_APP_NOTICES_START_AT = new Date(now.getTime() - DAY).toISOString();
  db = (await freshTestDb()) as unknown as DrizzleDb;
  const [w] = await db
    .insert(workspaces)
    .values({ name: 'Synthetic billing notice', tier: 'plus' })
    .returning();
  ws = w!.id;
  const [u] = await db
    .insert(users)
    .values({ workspaceId: ws, email: 'billing-notice@example.test' })
    .returning();
  userId = u!.id;
  const [s] = await db
    .insert(subscriptions)
    .values({
      workspaceId: ws,
      provider: 'paddle',
      providerSubscriptionId: 'sub_notice',
      providerPriceId: 'pri_plus',
      tier: 'plus',
      status: 'active',
      billingCycle: 'monthly',
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
    })
    .returning();
  subId = s!.id;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.BILLING_APP_NOTICES_ENABLED;
  delete process.env.BILLING_APP_NOTICES_START_AT;
});
describe('billing app notices', () => {
  it('renders fresh state and resolves the current email immediately before delivery', async () => {
    await cancel();
    const payload: EmailSendJobData = {
      kind: 'billing-lifecycle',
      userId,
      billingContext: await notice(),
      idempotencyKey: 'email__billing__synthetic',
      subject: 'Stale subject',
      text: 'Stale text',
      html: 'Stale HTML',
    };
    await db.update(users).set({ email: 'updated-notice@example.test' });
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerId: 'synthetic' });
    const worker = new EmailSendWorker({
      db: db as never,
      delivery: { deliver },
      resolveBillingNotice: buildBillingNoticeResolver(db, 'https://declutrmail.com'),
    });
    expect(await worker.processJob(payload, { jobId: 'synthetic' } as never)).toMatchObject({
      outcome: 'sent',
    });
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'updated-notice@example.test',
        subject: 'Your DeclutrMail access update',
      }),
    );
    expect(deliver.mock.calls[0]![0].html).not.toContain('Stale HTML');
    await db.update(subscriptions).set({ cancelAtPeriodEnd: false });
    expect(await worker.processJob(payload, { jobId: 'synthetic' } as never)).toMatchObject({
      outcome: 'skipped_recovered',
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    await expect(
      worker.processJob({ ...payload, recipientOverride: 'other@example.test' }, {
        jobId: 'synthetic',
      } as never),
    ).rejects.toThrow('no recipient override');
  });
  it('deduplicates local cancellation/provider echoes while permitting a new cancellation episode', async () => {
    await cancel();
    await cancel();
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
    const rendered = await buildBillingNoticeResolver(db, 'https://declutrmail.com')(
      await notice(),
      userId,
    );
    expect(rendered!.text).toContain('scheduled to cancel');
    expect(rendered!.text).toContain('Current app access: Plus.');
    await db.update(subscriptions).set({ cancelAtPeriodEnd: false });
    expect(
      await buildBillingNoticeResolver(db, 'https://declutrmail.com')(await notice(), userId),
    ).toBeNull();
    vi.setSystemTime(new Date(now.getTime() + 1000));
    await cancel();
    expect(await db.select().from(outboxEvents)).toHaveLength(2);
  });
  it('rolls back notice publication with its canonical state write', async () => {
    await expect(
      db.transaction(async (tx) => {
        const before = await subscriptionNoticeSnapshot(tx, 'paddle', 'sub_notice');
        await tx.update(subscriptions).set({ status: 'paused' });
        await publishSubscriptionNotices(tx, before);
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    expect((await db.select().from(subscriptions))[0]!.status).toBe('active');
  });
  it('does not send to a moved or deleted recipient and refuses historical redelivery', async () => {
    await cancel();
    const payload = await notice();
    const resolve = buildBillingNoticeResolver(db, 'https://declutrmail.com');
    expect(
      await resolve({ ...payload, dueAt: new Date(now.getTime() - DAY).toISOString() }, userId),
    ).toBeNull();
    const [other] = await db.insert(workspaces).values({ name: 'Other fixture' }).returning();
    await db.update(users).set({ workspaceId: other!.id });
    expect(await resolve(payload, userId)).toBeNull();
    await db.delete(users).where(eq(users.id, userId));
    expect(await resolve(payload, userId)).toBeNull();
  });
  it('deduplicates grant expiry by semantic revision and suppresses extensions/revocations', async () => {
    const [g] = await db
      .insert(entitlementGrants)
      .values({
        email: 'billing-notice@example.test',
        tier: 'pro',
        reason: 'test',
        grantedBy: 'test',
        expiresAt: new Date(now.getTime() + DAY),
      })
      .returning();
    await db.update(workspaces).set({ tier: 'pro' });
    await publishGrantExpiryNotices(db);
    await publishGrantExpiryNotices(db);
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
    const payload = await notice();
    const resolve = buildBillingNoticeResolver(db, 'https://declutrmail.com');
    expect((await resolve(payload, userId))!.text).toContain('Current app access: Pro.');
    // Simulate a raw operator extension that does NOT bump updatedAt.
    await db
      .update(entitlementGrants)
      .set({ expiresAt: new Date(now.getTime() + 2 * DAY) })
      .where(eq(entitlementGrants.id, g!.id));
    expect(await resolve(payload, userId)).toBeNull();
    await publishGrantExpiryNotices(db);
    expect(await db.select().from(outboxEvents)).toHaveLength(2);
    const updated = (await db.select().from(outboxEvents)).at(-1)!
      .payload as BillingLifecycleChangedPayload;
    await db.update(entitlementGrants).set({ revokedAt: new Date() });
    expect(await resolve(updated, userId)).toBeNull();
  });
  it('names an expired grant without claiming Free over a retained paid plan', async () => {
    await db.insert(entitlementGrants).values({
      email: 'billing-notice@example.test',
      tier: 'pro',
      reason: 'test',
      grantedBy: 'test',
      expiresAt: new Date(now.getTime() - 1000),
    });
    await publishGrantExpiryNotices(db);
    const rendered = await buildBillingNoticeResolver(db, 'https://declutrmail.com')(
      await notice('grant_expired'),
      userId,
    );
    expect(rendered!.text).toContain('grant expired');
    expect(rendered!.text).toContain('Current app access: Plus.');
    expect(rendered!.text).not.toContain('Current app access: Free.');
    await db.update(workspaces).set({ tier: 'pro' });
    expect(
      (await buildBillingNoticeResolver(db, 'https://declutrmail.com')(
        await notice('grant_expired'),
        userId,
      ))!.text,
    ).toContain('Access verification is pending');
  });
  it('remains off until explicitly enrolled and never backfills old expired grants', async () => {
    delete process.env.BILLING_APP_NOTICES_ENABLED;
    await cancel();
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    process.env.BILLING_APP_NOTICES_ENABLED = 'true';
    await db.insert(entitlementGrants).values({
      email: 'billing-notice@example.test',
      tier: 'pro',
      reason: 'test',
      grantedBy: 'test',
      expiresAt: new Date(now.getTime() - 2 * DAY),
    });
    await publishGrantExpiryNotices(db);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });
});
