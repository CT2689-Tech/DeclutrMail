// apps/api/src/billing/billing-webhook.service.ts — applies normalized
// billing webhook events to the database (D117, D118, D126).
//
// CONTRACT (replay-safe, crash-safe):
//
//   1. INSERT-FIRST DEDUP. The event is inserted into
//      `subscription_events` with `ON CONFLICT DO NOTHING` on
//      `(provider, provider_event_id)` BEFORE any processing. On
//      conflict, the existing row's `processed_at` decides:
//        - set     → true duplicate, ack silently (`duplicate`).
//        - null    → a previous delivery crashed AFTER the insert
//                    committed but BEFORE the effect applied; this
//                    retry RESUMES processing (at-least-once safety).
//
//   2. ONE TRANSACTION per effect. Subscription upsert + workspace
//      tier flip + founding-member assignment + `processed_at` stamp
//      commit atomically — a crash leaves `processed_at` null and the
//      provider's retry re-drives the effect.
//
//   3. FOUNDING PRO COUNTER (D126). First 250 paying subscriptions on
//      the `pro_annual_founding` price get `founding_member = true`.
//      Counted inside the tx under `pg_advisory_xact_lock` so two
//      racing webhooks cannot both claim spot #250.
//
// TIER RESOLUTION. After any subscription write, the workspace tier is
// recomputed from ALL of its subscription rows:
//   - `active` and `past_due` grant their tier (past_due = dunning
//     grace — the provider is still retrying payment; hard removal
//     arrives as a `canceled` status event).
//   - `paused` grants nothing (D118: "Pro features lock during pause").
//   - `canceled` grants nothing.
//   - No granting subscription → `free`.
// `workspaces.founding_member` mirrors "any granting subscription has
// founding_member" so the D126 price-lock badge follows the sub.
//
// OBSERVABILITY (D159). Every applied effect emits a structured
// `billing_event` log line with the taxonomy's payload fields
// (docs/observability/event-taxonomy.md → `billing_event`). PostHog
// server-side capture is not wired in apps/api yet — the log line is
// the greppable source until it is.
//
// PRIVACY (D7/D228). The raw provider body is NEVER persisted — it
// carries customer PII (email, name, address, phone, card metadata).
// `projectWebhookPayload` (exported below) is the single enforcement
// point that reduces it to allowlisted billing metadata before the
// `subscription_events` insert.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { billingCustomers, subscriptionEvents, subscriptions, workspaces } from '@declutrmail/db';
import { TIER_RANK } from '@declutrmail/shared/entitlements';
import type { BillingProviderId } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  NormalizedBillingEvent,
  NormalizedSubscription,
} from './billing-provider.interface.js';
import { BillingCatalog } from './billing-catalog.js';

/** Advisory-lock key for the D126 founding counter (arbitrary, unique). */
const FOUNDING_LOCK_KEY = 117_126;

/** Statuses that grant their tier (see header — paused grants nothing). */
const GRANTING_STATUSES = ['active', 'past_due'] as const;

export type WebhookProcessOutcome =
  { kind: 'processed'; effect: string } | { kind: 'duplicate' } | { kind: 'ignored' };

/** Safe property read — no throw on null/array/scalar inputs. */
function prop(obj: unknown, key: string): unknown {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/** Keep string/number scalars only — objects can nest PII, drop them. */
function scalar(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * Raw scalars the normalization drops but the audit trail keeps:
 * verbatim provider status (lossy mapping — Razorpay `pending` and
 * `halted` both normalize to `past_due`), the provider's own event
 * timestamp, period start, and pause/cancel stamps. Paddle carries
 * these under `data.*`; Razorpay under `payload.subscription.entity.*`.
 */
function pickRawAuditScalars(rawPayload: unknown): Record<string, unknown> {
  const data = prop(rawPayload, 'data'); // Paddle
  const entity = prop(prop(prop(rawPayload, 'payload'), 'subscription'), 'entity'); // Razorpay
  const picked: Record<string, unknown> = {
    provider_status: scalar(prop(data, 'status') ?? prop(entity, 'status')),
    occurred_at: scalar(prop(rawPayload, 'occurred_at') ?? prop(rawPayload, 'created_at')),
    period_start: scalar(
      prop(prop(data, 'current_billing_period'), 'starts_at') ?? prop(entity, 'current_start'),
    ),
    canceled_at: scalar(prop(data, 'canceled_at') ?? prop(entity, 'ended_at')),
    paused_at: scalar(prop(data, 'paused_at')),
  };
  for (const key of Object.keys(picked)) {
    if (picked[key] === undefined) delete picked[key];
  }
  return picked;
}

/**
 * D7 ENFORCEMENT POINT — the ONLY shape ever persisted to
 * `subscription_events.payload`.
 *
 * Provider webhook bodies carry customer PII — Paddle nests email/
 * name/address under `data.customer` / `data.billing_details`,
 * Razorpay nests email/contact/card under `payload.payment.entity` —
 * none of it in the D7 allowlist, so the raw body never reaches the
 * database. This pure function projects the event down to billing
 * metadata only: the normalized fields the handler applies plus the
 * small explicit raw pick above. Every value is a scalar read from an
 * explicit path — no spread of any raw object — so new provider
 * fields can never leak through.
 *
 * Referenced by the schema doc
 * (packages/db/src/schema/subscription-events.ts) and locked by the
 * PII-scrub tests in `__tests__/billing-webhook.service.spec.ts`.
 */
export function projectWebhookPayload(
  event: NormalizedBillingEvent,
  rawPayload: unknown,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    kind: event.kind,
    provider_event_id: event.providerEventId,
    event_type: event.eventType,
    ...pickRawAuditScalars(rawPayload),
  };
  switch (event.kind) {
    case 'subscription': {
      const sub = event.subscription;
      projected.provider_subscription_id = sub.providerSubscriptionId;
      projected.provider_customer_id = sub.providerCustomerId;
      projected.provider_price_id = sub.providerPriceId;
      projected.status = sub.status;
      projected.current_period_end = sub.currentPeriodEnd;
      projected.cancel_at_period_end = sub.cancelAtPeriodEnd;
      projected.pause_until = sub.pauseUntil;
      projected.workspace_id = sub.workspaceId;
      break;
    }
    case 'payment':
      projected.outcome = event.outcome;
      projected.provider_subscription_id = event.providerSubscriptionId;
      break;
    case 'cancellation_scheduled':
      projected.provider_subscription_id = event.providerSubscriptionId;
      projected.cancellation_reason = event.reason;
      break;
    case 'ignored':
      break;
  }
  return projected;
}

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalog: BillingCatalog,
  ) {}

  async process(
    provider: BillingProviderId,
    event: NormalizedBillingEvent,
    rawPayload: unknown,
  ): Promise<WebhookProcessOutcome> {
    // 1. Insert-first dedup gate. The stored payload is the D7-safe
    //    projection, never the raw body (see projectWebhookPayload).
    const inserted = await this.db
      .insert(subscriptionEvents)
      .values({
        provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payload: projectWebhookPayload(event, rawPayload),
      })
      .onConflictDoNothing()
      .returning({ id: subscriptionEvents.id });

    let eventRowId: string;
    if (inserted.length === 0) {
      const [existing] = await this.db
        .select({ id: subscriptionEvents.id, processedAt: subscriptionEvents.processedAt })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.provider, provider),
            eq(subscriptionEvents.providerEventId, event.providerEventId),
          ),
        )
        .limit(1);
      if (!existing || existing.processedAt !== null) {
        this.logger.log(
          `billing.webhook.dedup_hit provider=${provider} event=${event.providerEventId}`,
        );
        return { kind: 'duplicate' };
      }
      // Crash-recovery resume: insert committed, effect didn't.
      eventRowId = existing.id;
      this.logger.warn(
        `billing.webhook.resume_unprocessed provider=${provider} event=${event.providerEventId}`,
      );
    } else {
      eventRowId = inserted[0]!.id;
    }

    // 2. Apply the domain effect + stamp processed_at atomically.
    switch (event.kind) {
      case 'subscription':
        return this.applySubscription(provider, event, eventRowId);
      case 'cancellation_scheduled':
        return this.applyScheduledCancellation(provider, event, eventRowId);
      case 'payment':
        return this.applyPayment(provider, event, eventRowId);
      case 'ignored':
        await this.markProcessed(eventRowId);
        this.logger.log(
          `billing.webhook.ignored provider=${provider} type=${event.eventType} event=${event.providerEventId}`,
        );
        return { kind: 'ignored' };
    }
  }

  private async markProcessed(eventRowId: string): Promise<void> {
    await this.db
      .update(subscriptionEvents)
      .set({ processedAt: new Date() })
      .where(eq(subscriptionEvents.id, eventRowId));
  }

  private async applySubscription(
    provider: BillingProviderId,
    event: Extract<NormalizedBillingEvent, { kind: 'subscription' }>,
    eventRowId: string,
  ): Promise<WebhookProcessOutcome> {
    const sub = event.subscription;
    const entry = this.catalog.resolveByPriceId(provider, sub.providerPriceId);
    if (!entry) {
      // Catalog drift — a price id we did not provision. Loud log (the
      // founder must reconcile), processed stamp (retries cannot fix
      // drift; the audit row in subscription_events preserves it).
      this.logger.error(
        `billing.webhook.unknown_price provider=${provider} price=${sub.providerPriceId} event=${event.providerEventId}`,
      );
      await this.markProcessed(eventRowId);
      return { kind: 'ignored' };
    }

    const workspaceId = await this.resolveWorkspace(provider, sub);
    if (!workspaceId) {
      this.logger.error(
        `billing.webhook.unattributable provider=${provider} sub=${sub.providerSubscriptionId} event=${event.providerEventId}`,
      );
      await this.markProcessed(eventRowId);
      return { kind: 'ignored' };
    }

    await this.db.transaction(async (tx) => {
      // Customer record (webhook hot path resolves workspace from it).
      if (sub.providerCustomerId) {
        await tx
          .insert(billingCustomers)
          .values({
            workspaceId,
            provider,
            providerCustomerId: sub.providerCustomerId,
            region: provider === 'razorpay' ? 'india' : 'international',
          })
          .onConflictDoNothing();
      }

      // D126 founding assignment — advisory lock + count, race-safe.
      let founding = false;
      if (entry.founding) {
        const [existing] = await tx
          .select({ foundingMember: subscriptions.foundingMember })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, provider),
              eq(subscriptions.providerSubscriptionId, sub.providerSubscriptionId),
            ),
          )
          .limit(1);
        if (existing?.foundingMember) {
          founding = true; // already claimed — replays never re-count
        } else {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`);
          const [row] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(subscriptions)
            .where(eq(subscriptions.foundingMember, true));
          founding = (row?.count ?? 0) < this.catalog.foundingMaxRedemptions;
          if (!founding) {
            this.logger.warn(
              `billing.founding.sold_out_purchase sub=${sub.providerSubscriptionId} — pro_annual_founding past 250, granting pro without price-lock flag`,
            );
          }
        }
      }

      await tx
        .insert(subscriptions)
        .values({
          workspaceId,
          provider,
          providerSubscriptionId: sub.providerSubscriptionId,
          tier: entry.tierId,
          status: sub.status,
          providerPriceId: sub.providerPriceId,
          billingCycle: entry.cycle,
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          pauseUntil: sub.pauseUntil ? new Date(sub.pauseUntil) : null,
          foundingMember: founding,
        })
        .onConflictDoUpdate({
          target: [subscriptions.provider, subscriptions.providerSubscriptionId],
          set: {
            tier: entry.tierId,
            status: sub.status,
            providerPriceId: sub.providerPriceId,
            billingCycle: entry.cycle,
            currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            pauseUntil: sub.pauseUntil ? new Date(sub.pauseUntil) : null,
            foundingMember: founding,
            updatedAt: new Date(),
          },
        });

      await this.recomputeWorkspaceTier(tx, workspaceId);

      await tx
        .update(subscriptionEvents)
        .set({ processedAt: new Date() })
        .where(eq(subscriptionEvents.id, eventRowId));
    });

    // D159 billing_event — taxonomy kinds.
    const kind =
      sub.status === 'canceled'
        ? 'subscription_canceled'
        : event.eventType.endsWith('created') || event.eventType.endsWith('activated')
          ? 'subscription_created'
          : 'subscription_updated';
    this.logger.log(
      `billing_event kind=${kind} tier=${entry.tierId} provider=${provider} status=${sub.status} workspace=${workspaceId}`,
    );
    this.logger.log(
      `billing.subscription_changed workspace=${workspaceId} tier=${entry.tierId} status=${sub.status} provider=${provider} founding=${entry.founding}`,
    );
    return { kind: 'processed', effect: `subscription:${sub.status}` };
  }

  private async applyScheduledCancellation(
    provider: BillingProviderId,
    event: Extract<NormalizedBillingEvent, { kind: 'cancellation_scheduled' }>,
    eventRowId: string,
  ): Promise<WebhookProcessOutcome> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(
          and(
            eq(subscriptions.provider, provider),
            eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
          ),
        )
        .returning({ workspaceId: subscriptions.workspaceId, tier: subscriptions.tier });
      if (!row) {
        this.logger.error(
          `billing.webhook.cancel_unknown_sub provider=${provider} sub=${event.providerSubscriptionId}`,
        );
      } else {
        this.logger.log(
          `billing.subscription_changed workspace=${row.workspaceId} tier=${row.tier} cancel_at_period_end=true reason=${event.reason} provider=${provider}`,
        );
      }
      await tx
        .update(subscriptionEvents)
        .set({ processedAt: new Date() })
        .where(eq(subscriptionEvents.id, eventRowId));
    });
    return { kind: 'processed', effect: `cancellation_scheduled:${event.reason}` };
  }

  private async applyPayment(
    provider: BillingProviderId,
    event: Extract<NormalizedBillingEvent, { kind: 'payment' }>,
    eventRowId: string,
  ): Promise<WebhookProcessOutcome> {
    // Observability only — subscription state always arrives via its
    // own subscription.* events on both providers.
    let tier = 'free';
    if (event.providerSubscriptionId) {
      const [row] = await this.db
        .select({ tier: subscriptions.tier })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.provider, provider),
            eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId),
          ),
        )
        .limit(1);
      if (row) tier = row.tier;
    }
    await this.markProcessed(eventRowId);
    this.logger.log(
      `billing_event kind=payment_${event.outcome} tier=${tier} provider=${provider} sub=${event.providerSubscriptionId ?? 'none'}`,
    );
    return { kind: 'processed', effect: `payment:${event.outcome}` };
  }

  /**
   * Resolve which workspace a subscription event belongs to:
   *   1. existing `subscriptions` row (later events on a known sub),
   *   2. `billing_customers` by the provider's customer id,
   *   3. the payload's own attribution (Paddle custom_data / Razorpay
   *      notes) — validated against `workspaces` so a typo'd or forged
   *      id can never flip a random row.
   */
  private async resolveWorkspace(
    provider: BillingProviderId,
    sub: NormalizedSubscription,
  ): Promise<string | null> {
    const [bySub] = await this.db
      .select({ workspaceId: subscriptions.workspaceId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, provider),
          eq(subscriptions.providerSubscriptionId, sub.providerSubscriptionId),
        ),
      )
      .limit(1);
    if (bySub) return bySub.workspaceId;

    if (sub.providerCustomerId) {
      const [byCustomer] = await this.db
        .select({ workspaceId: billingCustomers.workspaceId })
        .from(billingCustomers)
        .where(
          and(
            eq(billingCustomers.provider, provider),
            eq(billingCustomers.providerCustomerId, sub.providerCustomerId),
          ),
        )
        .limit(1);
      if (byCustomer) return byCustomer.workspaceId;
    }

    if (sub.workspaceId && /^[0-9a-f-]{36}$/i.test(sub.workspaceId)) {
      const [ws] = await this.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, sub.workspaceId))
        .limit(1);
      if (ws) return ws.id;
    }

    return null;
  }

  /** Recompute `workspaces.tier` + `founding_member` from all sub rows. */
  private async recomputeWorkspaceTier(
    tx: Pick<DrizzleDb, 'select' | 'update'>,
    workspaceId: string,
  ): Promise<void> {
    const granting = await tx
      .select({ tier: subscriptions.tier, foundingMember: subscriptions.foundingMember })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, workspaceId),
          inArray(subscriptions.status, [...GRANTING_STATUSES]),
        ),
      );

    let tier: (typeof granting)[number]['tier'] = 'free';
    let founding = false;
    for (const row of granting) {
      if (TIER_RANK[row.tier] > TIER_RANK[tier]) tier = row.tier;
      if (row.foundingMember) founding = true;
    }

    await tx
      .update(workspaces)
      .set({ tier, foundingMember: founding, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }
}
