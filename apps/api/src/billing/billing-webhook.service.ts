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
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
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
  | { kind: 'processed'; effect: string }
  | { kind: 'duplicate' }
  | { kind: 'ignored' }
  // Verified but not yet resolvable (unknown workspace / unprovisioned
  // price). Deliberately NOT stamped processed: the dedup gate's
  // resume path re-drives it on the provider's next retry, and the
  // controller answers 503 so a retry actually happens. Stamping here
  // is what made a real sandbox payment permanently unrecoverable
  // (2026-07-20) — every retry short-circuited as `duplicate`.
  | { kind: 'unresolved'; reason: 'unknown_price' | 'unattributable' };

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
      .returning({ id: subscriptionEvents.id, createdAt: subscriptionEvents.createdAt });

    let eventRowId: string;
    // Arrival order of THIS event. A retry reuses the original row, so
    // this stays the first-attempt timestamp — which is what makes it
    // usable as a staleness reference against later-arrived events.
    let eventCreatedAt: Date;
    if (inserted.length === 0) {
      const [existing] = await this.db
        .select({
          id: subscriptionEvents.id,
          processedAt: subscriptionEvents.processedAt,
          createdAt: subscriptionEvents.createdAt,
        })
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
      eventCreatedAt = existing.createdAt;
      this.logger.warn(
        `billing.webhook.resume_unprocessed provider=${provider} event=${event.providerEventId}`,
      );
    } else {
      eventRowId = inserted[0]!.id;
      eventCreatedAt = inserted[0]!.createdAt;
    }

    // 2. Apply the domain effect + stamp processed_at atomically.
    switch (event.kind) {
      case 'subscription':
        return this.applySubscription(provider, event, eventRowId, eventCreatedAt);
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
    eventCreatedAt: Date,
  ): Promise<WebhookProcessOutcome> {
    const sub = event.subscription;
    const entry = this.catalog.resolveByPriceId(provider, sub.providerPriceId);
    if (!entry) {
      // Catalog drift — a price id we did not provision. Left
      // UNPROCESSED so the provider keeps retrying: drift is fixable
      // (patch the manifest / BILLING_CATALOG_JSON and the next retry
      // lands), and the alternative is discarding a real payment.
      this.logger.error(
        `billing.webhook.unknown_price provider=${provider} price=${sub.providerPriceId} event=${event.providerEventId}`,
      );
      return { kind: 'unresolved', reason: 'unknown_price' };
    }

    const workspaceId = await this.resolveWorkspace(provider, sub);
    if (!workspaceId) {
      // Same: attribution can become possible later (a sibling event
      // seeds billing_customers), so never stamp this one terminal.
      this.logger.error(
        `billing.webhook.unattributable provider=${provider} sub=${sub.providerSubscriptionId} event=${event.providerEventId}`,
      );
      return { kind: 'unresolved', reason: 'unattributable' };
    }

    // STALENESS GUARD. Leaving unresolved events unprocessed means a
    // provider can re-deliver an OLD event after newer ones already
    // landed — e.g. a `subscription.created` retry that only becomes
    // attributable after a `subscription.canceled` has been applied.
    // Re-driving it would upsert `status: active` over the cancel and
    // hand back entitlement. Arrival order (`created_at`, stamped on
    // first receipt and preserved across retries) is the ordering
    // truth: providers give no reliable monotonic sequence, and
    // `occurred_at` lives only inside the audit payload.
    const outcome = await this.db.transaction(async (tx) => {
      // Serialize every writer for THIS subscription. The staleness
      // check below is read-then-write: without the lock, two events
      // delivered concurrently both read "no newer event" and both
      // upsert, and the loser's stale state can land last.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${sub.providerSubscriptionId}`}))`,
      );

      const [newer] = await tx
        .select({ id: subscriptionEvents.id })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.provider, provider),
            isNotNull(subscriptionEvents.processedAt),
            gt(subscriptionEvents.createdAt, eventCreatedAt),
            sql`${subscriptionEvents.payload}->>'provider_subscription_id' = ${sub.providerSubscriptionId}`,
            // ONLY state-writing kinds count as "newer state". A payment
            // event carries the same provider_subscription_id but writes
            // no subscription row — and `transaction.completed` is
            // precisely what seeds billing_customers to make a stranded
            // activation attributable. Counting it here would discard
            // the activation this recovery path exists to rescue.
            sql`${subscriptionEvents.payload}->>'kind' IN ('subscription', 'cancellation_scheduled')`,
          ),
        )
        .limit(1);
      if (newer) {
        // Terminal: a newer event already won. Stamp it so the provider
        // stops retrying — unlike the unresolved cases above, replaying
        // this can never produce a better outcome.
        this.logger.warn(
          `billing.webhook.stale_replay provider=${provider} sub=${sub.providerSubscriptionId} event=${event.providerEventId}`,
        );
        await tx
          .update(subscriptionEvents)
          .set({ processedAt: new Date() })
          .where(eq(subscriptionEvents.id, eventRowId));
        return { kind: 'ignored' } as const;
      }

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
            // KNOWN GAP (2026-07-20): a refund/chargeback sets this
            // flag locally, and the next renewal event overwrites it
            // back to false — the user keeps entitlement they were
            // refunded for. Mirroring the provider is still correct
            // here: a locally-sticky flag has NO clearing path (an
            // un-cancel in Paddle's portal and a plain renewal are the
            // same payload), which would strand active subscriptions
            // showing "cancellation scheduled" forever. The real fix
            // is a provenance column so local and provider-derived
            // cancellations are distinguishable. Tracked, not stubbed.
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
      return null;
    });
    // Stale replays exit here; everything below is the applied path.
    if (outcome) return outcome;

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
    // NOTE: the founder chose "chargeback revokes entitlement now,
    // voluntary refund holds to period end" (2026-07-20). That is NOT
    // implemented here yet — writing tier=free on a chargeback is
    // undone by the very next subscription.* event, which re-grants
    // `entry.tierId` from the provider payload. Landing it soundly
    // needs the same provenance column as the flag above, so it ships
    // in that change rather than as a revert-prone half-measure.
    const outcome = await this.db.transaction(async (tx) => {
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
        // The subscription this cancels was never recorded — usually a
        // sibling activation that is still unresolved. Leave the event
        // UNPROCESSED so it re-drives once attribution succeeds; a
        // 'processed' return here dropped refunds on the floor.
        this.logger.error(
          `billing.webhook.cancel_unknown_sub provider=${provider} sub=${event.providerSubscriptionId}`,
        );
        return { kind: 'unresolved', reason: 'unattributable' } as const;
      }

      this.logger.log(
        `billing.subscription_changed workspace=${row.workspaceId} tier=${row.tier} cancel_at_period_end=true reason=${event.reason} provider=${provider}`,
      );

      await tx
        .update(subscriptionEvents)
        .set({ processedAt: new Date() })
        .where(eq(subscriptionEvents.id, eventRowId));
      return { kind: 'processed', effect: `cancellation_scheduled:${event.reason}` } as const;
    });

    return outcome;
  }

  private async applyPayment(
    provider: BillingProviderId,
    event: Extract<NormalizedBillingEvent, { kind: 'payment' }>,
    eventRowId: string,
  ): Promise<WebhookProcessOutcome> {
    // Seed `billing_customers` from the payment's own attribution.
    // Subscription state still arrives via subscription.* events, but
    // those may reach us with no usable attribution (the provider does
    // not reliably echo checkout custom_data onto the subscription
    // entity). This gives resolveWorkspace a second, independent link
    // — without it, one missing field strands a real payment.
    if (event.providerCustomerId && event.workspaceId) {
      const [ws] = await this.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, event.workspaceId))
        .limit(1);
      // Validated against `workspaces` — a forged or typo'd id must
      // never mint a customer mapping onto someone else's row.
      if (ws) {
        await this.db
          .insert(billingCustomers)
          .values({
            workspaceId: ws.id,
            provider,
            providerCustomerId: event.providerCustomerId,
            region: provider === 'razorpay' ? 'india' : 'international',
          })
          .onConflictDoNothing();
      } else {
        this.logger.warn(
          `billing.webhook.payment_unknown_workspace provider=${provider} event=${event.providerEventId}`,
        );
      }
    }

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
