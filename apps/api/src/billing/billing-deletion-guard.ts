import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  billingCustomers,
  subscriptionEvents,
  subscriptions,
  pendingCheckouts,
  users,
  workspaces,
} from '@declutrmail/db';
import { AppException } from '../common/app-exception.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';

export type DeletionBillingBlock = 'subscription' | 'checkout' | 'verification';
type Reader = Pick<DrizzleDb, 'select'>;
type Snapshot = Awaited<ReturnType<typeof billingSnapshot>>;

/** Exact identifiers and local revision, never an inference from entitlement. */
async function billingSnapshot(db: Reader, workspaceId: string) {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .orderBy(asc(subscriptions.id));
  const claims = await db
    .select()
    .from(pendingCheckouts)
    .where(eq(pendingCheckouts.workspaceId, workspaceId));
  const attempts = await db
    .select()
    .from(subscriptionEvents)
    .where(
      and(
        inArray(subscriptionEvents.eventType, [
          'local.checkout_attempted',
          'local.checkout_artifact',
          'local.checkout_attempt_resolved',
        ]),
        sql`${subscriptionEvents.payload}->>'workspaceId' = ${workspaceId}`,
      ),
    )
    .orderBy(asc(subscriptionEvents.arrivalSeq));
  const customers = await db
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, workspaceId))
    .orderBy(asc(billingCustomers.id));
  // Insert-first verified events may name a billable subscription even when
  // row application failed (catalog drift, live conflict or process crash).
  const events = await db
    .select()
    .from(subscriptionEvents)
    .where(
      or(
        sql`${subscriptionEvents.payload}->>'workspace_id' = ${workspaceId}`,
        ...customers.map((customer) =>
          and(
            eq(subscriptionEvents.provider, customer.provider),
            sql`COALESCE(${subscriptionEvents.payload}->>'provider_customer_id', ${subscriptionEvents.payload}->>'customer_id') = ${customer.providerCustomerId}`,
          ),
        ),
      ),
    )
    .orderBy(asc(subscriptionEvents.arrivalSeq));
  return { rows, claims, attempts, customers, events };
}

/**
 * Billing's read-only deletion facade. Provider HTTP is outside transactions;
 * a workspace row lock then checks that the inspected evidence has not changed.
 * Unknown outcomes fail closed. No cancellation or refund is performed here.
 */
@Injectable()
export class BillingDeletionGuard {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly paddle: PaddleAdapter,
    private readonly razorpay: RazorpayAdapter,
  ) {}

  async blockReason(userId: string): Promise<DeletionBillingBlock | null> {
    try {
      await this.inspect(userId);
      return null;
    } catch (error) {
      if (error instanceof AppException && error.code === 'DELETION_BILLING_BLOCKED') {
        return 'subscription';
      }
      return 'verification';
    }
  }

  async assertStopped(userId: string): Promise<void> {
    await this.inspect(userId);
  }

  async withVerifiedStopped<T>(userId: string, action: (tx: DrizzleDb) => Promise<T>): Promise<T> {
    const evidence = await this.inspect(userId);
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, evidence.workspaceId))
        .for('update');
      const [user] = await tx
        .select({ workspaceId: users.workspaceId })
        .from(users)
        .where(eq(users.id, userId));
      if (
        !user ||
        user.workspaceId !== evidence.workspaceId ||
        JSON.stringify(await billingSnapshot(tx, evidence.workspaceId)) !==
          JSON.stringify(evidence.snapshot)
      ) {
        throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
      }
      return action(tx);
    });
  }

  private async inspect(userId: string): Promise<{ workspaceId: string; snapshot: Snapshot }> {
    const [user] = await this.db
      .select({ workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new AppException({ code: 'NOT_FOUND' });
    const snapshot = await billingSnapshot(this.db, user.workspaceId);
    if (snapshot.claims.length > 0) throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
    if (snapshot.rows.some((row) => row.status !== 'canceled')) {
      throw new AppException({ code: 'DELETION_BILLING_BLOCKED' });
    }
    const refs = snapshot.rows.map((row) => ({
      provider: row.provider,
      ref: row.providerSubscriptionId,
    }));
    for (const event of snapshot.events) {
      const ref = (event.payload as { provider_subscription_id?: unknown })
        .provider_subscription_id;
      if (typeof ref === 'string' && ref) refs.push({ provider: event.provider, ref });
    }
    // The claim's TTL and the customer's release assertion are not evidence
    // that an external artifact cannot bill. Keep an append-only attempt ledger.
    for (const attempt of snapshot.attempts.filter(
      (row) => row.eventType === 'local.checkout_attempted',
    )) {
      const artifacts = snapshot.attempts.filter(
        (row) =>
          row.eventType === 'local.checkout_artifact' &&
          row.provider === attempt.provider &&
          (row.payload as { attemptId?: unknown }).attemptId === attempt.providerEventId,
      );
      let hasArtifact = false;
      for (const artifact of artifacts) {
        const ref = (artifact.payload as { providerRef?: unknown }).providerRef;
        if (typeof ref !== 'string' || !ref)
          throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
        refs.push({ provider: attempt.provider, ref });
        hasArtifact = true;
      }
      const resolutions = snapshot.attempts.filter((row) => {
        const payload = row.payload as {
          attemptId?: unknown;
          resolution?: unknown;
          operatorId?: unknown;
          evidenceReference?: unknown;
          providerRefs?: unknown;
        };
        return (
          row.eventType === 'local.checkout_attempt_resolved' &&
          row.provider === attempt.provider &&
          payload.attemptId === attempt.providerEventId &&
          payload.resolution === 'provider-reviewed' &&
          typeof payload.operatorId === 'string' &&
          payload.operatorId.length > 0 &&
          typeof payload.evidenceReference === 'string' &&
          payload.evidenceReference.length > 0 &&
          Array.isArray(payload.providerRefs) &&
          payload.providerRefs.every((ref) => typeof ref === 'string' && ref.length > 0)
        );
      });
      if (resolutions.length > 0) {
        // Operator review clears only the unknown-attempt blocker. All known
        // artifacts and reviewed subscriptions still need fresh terminal reads.
        for (const resolved of resolutions) {
          for (const ref of (resolved.payload as { providerRefs: string[] }).providerRefs)
            refs.push({ provider: attempt.provider, ref });
        }
      } else if (!hasArtifact) {
        throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
      }
    }
    try {
      const unique = [
        ...new Map(refs.map((entry) => [`${entry.provider}:${entry.ref}`, entry])).values(),
      ];
      // Small bounded batches keep historical reads below the purge deadline
      // without issuing an unbounded fan-out or caching terminal evidence.
      for (let offset = 0; offset < unique.length; offset += 4) {
        const states = await Promise.all(
          unique
            .slice(offset, offset + 4)
            .map(({ provider, ref }) =>
              (provider === 'paddle' ? this.paddle : this.razorpay).deletionBillingState(ref),
            ),
        );
        if (states.includes('billable'))
          throw new AppException({ code: 'DELETION_BILLING_BLOCKED' });
        if (states.some((state) => state !== 'stopped'))
          throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
      }
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.code === 'DELETION_BILLING_BLOCKED' || error.code === 'DELETION_BILLING_UNVERIFIED')
      )
        throw error;
      throw new AppException({ code: 'DELETION_BILLING_UNVERIFIED' });
    }
    return { workspaceId: user.workspaceId, snapshot };
  }
}
