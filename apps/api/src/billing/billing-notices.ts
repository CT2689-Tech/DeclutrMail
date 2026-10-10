import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { entitlementGrants, subscriptions, users, workspaces } from '@declutrmail/db';
import {
  BillingLifecycleChangedPayloadSchema,
  TOPICS,
  type BillingLifecycleChangedPayload,
} from '@declutrmail/events';
import {
  OutboxPublisher,
  enqueueEmailSend,
  type EmailSendJobData,
  type OutboxTx,
} from '@declutrmail/workers';
import type { Queue } from 'bullmq';
import { TIER_RANK, type TierId } from '@declutrmail/shared/entitlements';
import type { DrizzleDb } from '../db/db.module.js';
import {
  highestLiveGrantForWorkspace,
  applyGrantFloor,
} from '../common/entitlements/entitlement-grants.js';
import { billingAccessEmail } from '../notifications/templates/billing-access.js';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type Store = DrizzleDb | Tx;
type Subscription = typeof subscriptions.$inferSelect;
const DAY = 86_400_000;
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function billingNoticeStart(): number | null {
  const start = Date.parse(process.env.BILLING_APP_NOTICES_START_AT ?? '');
  return process.env.BILLING_APP_NOTICES_ENABLED === 'true' && Number.isFinite(start)
    ? start
    : null;
}
function revision(row: Subscription) {
  return hash([
    row.status,
    row.tier,
    row.providerPriceId,
    row.cancelAtPeriodEnd,
    row.cancelSource,
    row.currentPeriodEnd?.toISOString(),
    row.entitlementEndsAt?.toISOString(),
    row.pauseUntil?.toISOString(),
  ]);
}
function grantRevision(row: typeof entitlementGrants.$inferSelect) {
  return hash([row.tier, row.expiresAt?.toISOString(), row.revokedAt?.toISOString()]);
}
function noticeId(payload: BillingLifecycleChangedPayload) {
  const digest = hash([
    payload.workspaceId,
    payload.recordId,
    payload.recipientUserId,
    payload.source,
    payload.kind,
    payload.revision,
    payload.source === 'subscription' ? payload.dueAt : null,
  ]);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
async function publish(tx: Store, payload: BillingLifecycleChangedPayload) {
  if (billingNoticeStart() === null) return;
  await new OutboxPublisher().publish(tx as OutboxTx, {
    id: noticeId(payload),
    topic: TOPICS.BILLING_LIFECYCLE_CHANGED,
    aggregateId: `${payload.source}:${payload.recordId}`,
    payload,
    schema: BillingLifecycleChangedPayloadSchema,
  });
}
export async function subscriptionNoticeSnapshot(tx: Store, provider: string, id: string) {
  const start = billingNoticeStart();
  if (start === null || Date.now() < start) return null;
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.provider, provider as Subscription['provider']),
        eq(subscriptions.providerSubscriptionId, id),
      ),
    );
  return row ?? null;
}
/** Called under the existing subscription lock, in the business transaction. */
export async function publishSubscriptionNotices(tx: Store, before: Subscription | null) {
  const start = billingNoticeStart();
  if (!before || start === null || Date.now() < start) return;
  const after = await subscriptionNoticeSnapshot(
    tx,
    before.provider,
    before.providerSubscriptionId,
  );
  if (!after) return;
  let kind: BillingLifecycleChangedPayload['kind'] | null = null;
  let expectedAt: Date | null = null;
  if (before.status !== 'paused' && after.status === 'paused') {
    kind = 'paused';
    expectedAt = after.pauseUntil;
  } else if (
    after.entitlementEndsAt &&
    before.entitlementEndsAt?.getTime() !== after.entitlementEndsAt.getTime()
  ) {
    kind = 'access_deadline';
    expectedAt = after.entitlementEndsAt;
  } else if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) {
    kind = 'cancellation';
    expectedAt = after.currentPeriodEnd;
  } else if (before.status !== 'canceled' && after.status === 'canceled') {
    kind = 'access_deadline';
    expectedAt = after.entitlementEndsAt ?? new Date();
  }
  if (!kind) return;
  await publish(tx, {
    workspaceId: after.workspaceId,
    recordId: after.id,
    source: 'subscription',
    kind,
    revision: revision(after),
    expectedAt: expectedAt?.toISOString() ?? null,
    dueAt: new Date().toISOString(),
  });
}
/** Bounded keyset scan; enroll current future expiries, never historical expirations. */
export async function publishGrantExpiryNotices(db: DrizzleDb): Promise<void> {
  const start = billingNoticeStart();
  if (start === null || Date.now() < start) return;
  const now = new Date();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const rows = await db
      .select()
      .from(entitlementGrants)
      .where(
        and(
          isNull(entitlementGrants.revokedAt),
          gt(entitlementGrants.expiresAt, new Date(Math.max(start, now.getTime() - DAY))),
          lte(entitlementGrants.expiresAt, new Date(now.getTime() + 3 * DAY)),
          ...(cursor ? [gt(entitlementGrants.id, cursor)] : []),
        ),
      )
      .orderBy(asc(entitlementGrants.id))
      .limit(200);
    for (const grant of rows) {
      const holders = await db
        .select({ id: users.id, workspaceId: users.workspaceId })
        .from(users)
        .where(eq(users.email, grant.email));
      for (const holder of holders)
        await publish(db, {
          workspaceId: holder.workspaceId,
          recipientUserId: holder.id,
          recordId: grant.id,
          source: 'grant',
          kind: grant.expiresAt!.getTime() <= now.getTime() ? 'grant_expired' : 'grant_expiring',
          revision: grantRevision(grant),
          expectedAt: grant.expiresAt!.toISOString(),
          dueAt: now.toISOString(),
        });
    }
    if (rows.length < 200) return;
    cursor = rows.at(-1)!.id;
  }
  console.warn('billing.notice.grant_scan_capped — remaining expiries unverified');
}
export function buildBillingNoticeHandler(db: DrizzleDb, queue: Queue<EmailSendJobData>) {
  return async (payload: BillingLifecycleChangedPayload, eventId: string): Promise<void> => {
    if (billingNoticeStart() === null)
      throw new Error('Billing notice consumer disabled; event retained for retry');
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.workspaceId, payload.workspaceId),
          ...(payload.recipientUserId ? [eq(users.id, payload.recipientUserId)] : []),
        ),
      )
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(1);
    if (!user) return;
    await enqueueEmailSend(queue, {
      kind: 'billing-lifecycle',
      userId: user.id,
      subject: 'Pending billing notice',
      text: 'Pending fresh-state rendering',
      billingContext: payload,
      idempotencyKey: `email__billing__${eventId}`,
    });
  };
}
/** Billing owns semantic validation; the email worker owns current address/suppression. */
export function buildBillingNoticeResolver(db: DrizzleDb, appUrl: string) {
  return async (untrusted: BillingLifecycleChangedPayload, userId: string) => {
    const payload = BillingLifecycleChangedPayloadSchema.parse(untrusted);
    const start = billingNoticeStart(),
      now = Date.now();
    if (
      start === null ||
      Date.parse(payload.dueAt) < start ||
      now < Date.parse(payload.dueAt) ||
      now - Date.parse(payload.dueAt) >= DAY
    )
      return null;
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.workspaceId, payload.workspaceId)));
    if (!user || (payload.recipientUserId && user.id !== payload.recipientUserId)) return null;
    if (payload.source === 'subscription') {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.id, payload.recordId),
            eq(subscriptions.workspaceId, payload.workspaceId),
          ),
        );
      if (!sub || revision(sub) !== payload.revision) return null;
      if (payload.kind === 'cancellation' && !sub.cancelAtPeriodEnd) return null;
      if (payload.kind === 'paused' && sub.status !== 'paused') return null;
      if (payload.kind === 'access_deadline' && !sub.entitlementEndsAt && sub.status !== 'canceled')
        return null;
    } else {
      const [grant] = await db
        .select()
        .from(entitlementGrants)
        .where(
          and(eq(entitlementGrants.id, payload.recordId), eq(entitlementGrants.email, user.email)),
        );
      if (
        !grant ||
        grant.revokedAt ||
        grantRevision(grant) !== payload.revision ||
        !grant.expiresAt
      )
        return null;
      if ((payload.kind === 'grant_expired') !== grant.expiresAt.getTime() <= now) return null;
    }
    const paid = await db
      .select({ tier: subscriptions.tier })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, payload.workspaceId),
          inArray(subscriptions.status, ['active', 'past_due']),
          or(
            isNull(subscriptions.entitlementEndsAt),
            gt(subscriptions.entitlementEndsAt, new Date(now)),
          ),
        ),
      );
    let paidTier: TierId = 'free';
    for (const sub of paid) if (TIER_RANK[sub.tier] > TIER_RANK[paidTier]) paidTier = sub.tier;
    const resolved = applyGrantFloor(
      paidTier,
      (await highestLiveGrantForWorkspace(db, payload.workspaceId))?.tier ?? null,
    );
    const [workspace] = await db
      .select({ tier: workspaces.tier })
      .from(workspaces)
      .where(eq(workspaces.id, payload.workspaceId));
    if (!workspace) return null;
    return billingAccessEmail({
      kind: payload.kind,
      expectedAt: payload.expectedAt,
      currentTier: workspace.tier === resolved ? resolved : null,
      billingUrl: new URL('/billing', appUrl).href,
    });
  };
}
