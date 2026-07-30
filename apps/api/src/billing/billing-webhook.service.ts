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
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  pendingCheckouts,
  billingCustomers,
  subscriptionEvents,
  subscriptions,
  workspaces,
} from '@declutrmail/db';
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

/**
 * Founder decision 2026-07-28: a failed payment keeps its tier for 14
 * days past the period end, then entitlement drops. Terminal provider
 * states (Razorpay `halted` → canceled) drop immediately — the window
 * applies ONLY to genuine retry states.
 */
const DUNNING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Postgres unique_violation (23505) on a NAMED constraint/index. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  // Drizzle wraps the driver error as `cause`; postgres.js exposes the
  // index name as `constraint_name`, PGlite/pg as `constraint`. Check
  // both shapes on both levels.
  type PgErr = { code?: string; constraint_name?: string; constraint?: string };
  const e = err as PgErr & { cause?: PgErr };
  const code = e?.code ?? e?.cause?.code;
  const name =
    e?.constraint_name ?? e?.constraint ?? e?.cause?.constraint_name ?? e?.cause?.constraint;
  return code === '23505' && name === constraint;
}

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
  | { kind: 'unresolved'; reason: 'unknown_price' | 'unattributable' | 'live_conflict' };

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

/**
 * Serialize every writer of ONE subscription's state. Must be taken by
 * EVERY path that mutates a `subscriptions` row — the webhook upsert,
 * the scheduled-cancellation flag, and the user-initiated cancel in
 * `BillingService` — inside the same transaction as the write. The
 * webhook's staleness check is read-then-write, so an unlocked writer
 * elsewhere can interleave between the check and the upsert and land
 * last. Keyed on provider + subscription id, so unrelated
 * subscriptions never contend.
 *
 * Exported because the writers live in two services; a second lock
 * expression would silently stop excluding the first.
 */
export async function lockSubscription(
  tx: DrizzleDb,
  provider: BillingProviderId,
  providerSubscriptionId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${provider}:${providerSubscriptionId}`}))`,
  );
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
      .returning({
        id: subscriptionEvents.id,
        arrivalSeq: subscriptionEvents.arrivalSeq,
      });

    let eventRowId: string;
    // Arrival order of THIS event. A retry reuses the original row, so
    // this stays the first-attempt timestamp — which is what makes it
    // usable as a staleness reference against later-arrived events.
    let eventArrivalSeq: number;
    if (inserted.length === 0) {
      const [existing] = await this.db
        .select({
          id: subscriptionEvents.id,
          processedAt: subscriptionEvents.processedAt,
          arrivalSeq: subscriptionEvents.arrivalSeq,
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
      eventArrivalSeq = existing.arrivalSeq;
      this.logger.warn(
        `billing.webhook.resume_unprocessed provider=${provider} event=${event.providerEventId}`,
      );
    } else {
      eventRowId = inserted[0]!.id;
      eventArrivalSeq = inserted[0]!.arrivalSeq;
    }

    // 2. Apply the domain effect + stamp processed_at atomically.
    switch (event.kind) {
      case 'subscription':
        return this.applySubscription(provider, event, eventRowId, eventArrivalSeq);
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

  private async lockSubscription(
    tx: DrizzleDb,
    provider: BillingProviderId,
    providerSubscriptionId: string,
  ): Promise<void> {
    await lockSubscription(tx, provider, providerSubscriptionId);
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
    eventArrivalSeq: number,
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
    // hand back entitlement. Arrival order (`arrival_seq`, stamped on
    // first receipt and preserved across retries) is the ordering
    // truth: providers give no reliable monotonic sequence, and
    // `occurred_at` lives only inside the audit payload.
    let appliedTier: 'free' | 'plus' | 'pro' | 'team' | 'enterprise' = entry.tierId;
    let outcome: WebhookProcessOutcome | null;
    try {
      outcome = await this.db.transaction(async (tx) => {
        await this.lockSubscription(tx, provider, sub.providerSubscriptionId);

        // Peers = every processed, STATE-WRITING event for this
        // subscription, excluding this row.
        //
        // Ordering is by the PROVIDER's `occurred_at`, not by arrival.
        // Arrival is wrong for late FIRST deliveries: a `subscription.
        // updated` stamped 10:00 can be delayed past a `subscription.
        // canceled` stamped 10:05, land at 10:07 with the newest
        // created_at of all, and resurrect the cancelled subscription.
        // Filtering peers by arrival would hide exactly that case, so
        // every peer is considered and compared on event time.
        //
        // `arrival_seq` is the fallback when either side lacks
        // occurred_at — a bigint identity stamped at insert, so arrival
        // is a total order and the created_at tie class (transaction-
        // scoped now(); uuid coin-flip) is gone by construction (0051).
        const [self] = await tx
          .select({ occurredAt: sql<string | null>`${subscriptionEvents.payload}->>'occurred_at'` })
          .from(subscriptionEvents)
          .where(eq(subscriptionEvents.id, eventRowId))
          .limit(1);
        const selfOccurredAt = self?.occurredAt ?? null;

        const peers = await tx
          .select({
            arrivalSeq: subscriptionEvents.arrivalSeq,
            occurredAt: sql<string | null>`${subscriptionEvents.payload}->>'occurred_at'`,
            status: sql<string | null>`${subscriptionEvents.payload}->>'status'`,
          })
          .from(subscriptionEvents)
          .where(
            and(
              eq(subscriptionEvents.provider, provider),
              isNotNull(subscriptionEvents.processedAt),
              sql`${subscriptionEvents.id} <> ${eventRowId}::uuid`,
              sql`${subscriptionEvents.payload}->>'provider_subscription_id' = ${sub.providerSubscriptionId}`,
              // ONLY state-writing kinds count as "newer state". A payment
              // event carries the same provider_subscription_id but writes
              // no subscription row — and `transaction.completed` is
              // precisely what seeds billing_customers to make a stranded
              // activation attributable. Counting it here would discard
              // the activation this recovery path exists to rescue.
              sql`${subscriptionEvents.payload}->>'kind' IN ('subscription', 'cancellation_scheduled')`,
            ),
          );

        // Providers disagree on format: Paddle sends an ISO string,
        // Razorpay unix SECONDS. Normalize to epoch millis so a marker
        // written by our own cancel path (ISO) compares correctly against
        // either. A subscription belongs to one provider, but the local
        // cancel marker crosses that boundary.
        const toMillis = (value: string | null): number | null => {
          if (value === null) return null;
          if (/^\d+$/.test(value)) return Number(value) * 1000;
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? null : parsed;
        };
        const selfMs = toMillis(selfOccurredAt);

        // Does THIS event grant a tier? Only a granting event can wrongly
        // resurrect a committed non-granting state. Derived from the SAME
        // GRANTING_STATUSES that recomputeWorkspaceTier uses, so the
        // partition can never drift between the two.
        const selfGrants = (GRANTING_STATUSES as readonly string[]).includes(sub.status);
        const nonGranting = (status: string | null): boolean =>
          status !== null && !(GRANTING_STATUSES as readonly string[]).includes(status);

        const isNewer = (peer: {
          arrivalSeq: number;
          occurredAt: string | null;
          status: string | null;
        }): boolean => {
          const peerMs = toMillis(peer.occurredAt);
          // Distinct event times: the provider's order is authoritative.
          // A genuine resume (occurred_at strictly after the pause) is
          // resolved HERE and correctly applies.
          if (peerMs !== null && selfMs !== null && peerMs !== selfMs) return peerMs > selfMs;
          // Equal (or missing) event time — fall back to arrival order.
          // `arrival_seq` is a bigint identity, so arrival is a TOTAL
          // order (0051): two events can never tie the way `created_at`
          // could when transaction-scoped now() stamped them identically.
          //   - a user-cancel marker, written AFTER an in-flight renewal
          //     arrived, wins and refuses the renewal (its flag-revert);
          //   - a real cancel arriving after a committed active peer is
          //     NOT refused — it arrived later, so it is not older.
          if (peer.arrivalSeq > eventArrivalSeq) return true;
          // On an unresolved event-time tie a granting event must NOT
          // overwrite a committed NON-GRANTING peer (paused or canceled) —
          // the stale-active resurrection the arrival order cannot catch
          // because it genuinely arrives last. `canceled` is also caught
          // by the terminal floor below; `paused` (D118 tier lock) has no
          // other guard.
          return selfGrants && nonGranting(peer.status);
        };

        if (peers.some(isNewer)) {
          // Terminal: a newer event already won. Stamp it so the provider
          // stops retrying — unlike the unresolved cases above, replaying
          // this can never produce a better outcome. Deferring instead
          // would loop forever: both timestamps are fixed, so every retry
          // re-runs the same comparison.
          this.logger.warn(
            `billing.webhook.stale_replay provider=${provider} sub=${sub.providerSubscriptionId} event=${event.providerEventId}`,
          );
          await tx
            .update(subscriptionEvents)
            .set({ processedAt: new Date() })
            .where(eq(subscriptionEvents.id, eventRowId));
          return { kind: 'ignored' } as const;
        }

        // TERMINAL-CANCELED FLOOR. `canceled` is terminal on both
        // providers — the same subscription id never reactivates
        // (reactivation is a fresh subscription). This catches the one
        // resurrection the timestamp guard above cannot: a stale active
        // event sharing the cancel's event-time (Razorpay stamps unix
        // SECONDS, so any two events in the same second are unorderable)
        // that arrives AFTER the cancel — nothing in the event stream
        // marks it older, yet it must not move the row out of canceled.
        const [current] = await tx
          .select({
            status: subscriptions.status,
            tier: subscriptions.tier,
            billingCycle: subscriptions.billingCycle,
            providerPriceId: subscriptions.providerPriceId,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            scheduledTier: subscriptions.scheduledTier,
            scheduledBillingCycle: subscriptions.scheduledBillingCycle,
            scheduledProviderPriceId: subscriptions.scheduledProviderPriceId,
            scheduledChangeAt: subscriptions.scheduledChangeAt,
            scheduledChangeState: subscriptions.scheduledChangeState,
            scheduledChangeRequestedAt: subscriptions.scheduledChangeRequestedAt,
            cancelSource: subscriptions.cancelSource,
            entitlementEndsAt: subscriptions.entitlementEndsAt,
          })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, provider),
              eq(subscriptions.providerSubscriptionId, sub.providerSubscriptionId),
            ),
          )
          .limit(1);
        if (current?.status === 'canceled' && sub.status !== 'canceled') {
          this.logger.warn(
            `billing.webhook.canceled_is_terminal provider=${provider} sub=${sub.providerSubscriptionId} event=${event.providerEventId}`,
          );
          await tx
            .update(subscriptionEvents)
            .set({ processedAt: new Date() })
            .where(eq(subscriptionEvents.id, eventRowId));
          return { kind: 'ignored' } as const;
        }

        // D120 scheduled downgrade. Paddle updates the subscription item
        // immediately even with `do_not_bill`; until the provider advances
        // the period beyond our stored effective date, that target price is
        // only a billing schedule — it must not revoke current access.
        const incomingPeriodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
        const matchesScheduledTarget =
          current?.scheduledChangeState != null &&
          current?.scheduledProviderPriceId === sub.providerPriceId;
        const scheduledChangeApplied =
          matchesScheduledTarget &&
          current?.scheduledChangeState !== 'restoring_current' &&
          current?.scheduledChangeAt !== null &&
          incomingPeriodEnd !== null &&
          incomingPeriodEnd.getTime() > current.scheduledChangeAt.getTime();
        const restoreConfirmed =
          current?.scheduledChangeState === 'restoring_current' &&
          current.providerPriceId === sub.providerPriceId &&
          current.scheduledChangeRequestedAt !== null &&
          selfMs !== null &&
          selfMs >= current.scheduledChangeRequestedAt.getTime();
        // If an ambiguous restore never reached Paddle, the target item
        // eventually renews. That post-boundary provider snapshot is
        // authoritative: do not keep granting the old tier after the
        // customer has actually renewed on the lower plan.
        const restoreFailedAtRenewal =
          current?.scheduledChangeState === 'restoring_current' &&
          matchesScheduledTarget &&
          current.scheduledChangeAt !== null &&
          incomingPeriodEnd !== null &&
          incomingPeriodEnd.getTime() > current.scheduledChangeAt.getTime() &&
          current.scheduledChangeRequestedAt !== null &&
          selfMs !== null &&
          selfMs >= current.scheduledChangeRequestedAt.getTime();
        const maskRestoreInFlight =
          current?.scheduledChangeState === 'restoring_current' &&
          !restoreConfirmed &&
          !restoreFailedAtRenewal;
        const maskScheduledDowngrade =
          ((matchesScheduledTarget && !scheduledChangeApplied && !restoreFailedAtRenewal) ||
            maskRestoreInFlight) &&
          sub.status !== 'canceled';
        const effectiveTier = maskScheduledDowngrade && current ? current.tier : entry.tierId;
        appliedTier = effectiveTier;
        const effectiveCycle =
          maskScheduledDowngrade && current ? current.billingCycle : entry.cycle;
        const effectiveProviderPriceId =
          maskScheduledDowngrade && current ? current.providerPriceId : sub.providerPriceId;
        const clearScheduledChange =
          scheduledChangeApplied ||
          restoreConfirmed ||
          restoreFailedAtRenewal ||
          sub.status === 'canceled';
        const nextScheduledChangeState = clearScheduledChange
          ? null
          : matchesScheduledTarget && current?.scheduledChangeState === 'pending_provider'
            ? 'scheduled'
            : current?.scheduledChangeState;
        // Paddle nulls `current_billing_period` while paused, but its
        // no-charge resume option depends on the retained period. Keep the
        // last known end locally so the UI can explain the continuity.
        const effectivePeriodEnd =
          incomingPeriodEnd ??
          (sub.status === 'paused' ? (current?.currentPeriodEnd ?? null) : null);

        // Provenance + entitlement deadline (0051; founder rules
        // 2026-07-20 + 2026-07-28). A LOCAL verdict — refund or
        // chargeback — must survive every later provider payload: the
        // old code's KNOWN GAP was exactly a renewal event silently
        // re-granting a charged-back subscription. Provider-derived
        // states compute fresh each event:
        //   past_due → deadline = period end + 14d (the dunning window;
        //     a terminal provider state never reaches here — Razorpay
        //     `halted` maps to canceled at the adapter);
        //   anything else → no deadline.
        const localVerdict =
          current?.cancelSource === 'refund' || current?.cancelSource === 'chargeback';
        const nextEntitlementEndsAt = localVerdict
          ? (current?.entitlementEndsAt ?? null)
          : sub.status === 'past_due'
            ? new Date((effectivePeriodEnd ?? new Date()).getTime() + DUNNING_WINDOW_MS)
            : null;
        const nextCancelSource = localVerdict
          ? (current?.cancelSource ?? null)
          : sub.status === 'canceled'
            ? ('provider' as const)
            : null;

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
            tier: effectiveTier,
            status: sub.status,
            providerPriceId: effectiveProviderPriceId,
            billingCycle: effectiveCycle,
            currentPeriodEnd: effectivePeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            cancelSource: nextCancelSource,
            entitlementEndsAt: nextEntitlementEndsAt,
            pauseUntil: sub.pauseUntil ? new Date(sub.pauseUntil) : null,
            foundingMember: founding,
          })
          .onConflictDoUpdate({
            target: [subscriptions.provider, subscriptions.providerSubscriptionId],
            set: {
              tier: effectiveTier,
              status: sub.status,
              providerPriceId: effectiveProviderPriceId,
              billingCycle: effectiveCycle,
              currentPeriodEnd: effectivePeriodEnd,
              // The flag mirrors the provider (a locally-sticky flag has
              // no clearing path); the LOCAL verdict lives in
              // `cancel_source`/`entitlement_ends_at` below, which a
              // provider payload can no longer clobber — closing the
              // 2026-07-20 KNOWN GAP this comment used to describe.
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              cancelSource: nextCancelSource,
              entitlementEndsAt: nextEntitlementEndsAt,
              pauseUntil: sub.pauseUntil ? new Date(sub.pauseUntil) : null,
              foundingMember: founding,
              scheduledTier: clearScheduledChange ? null : current?.scheduledTier,
              scheduledBillingCycle: clearScheduledChange ? null : current?.scheduledBillingCycle,
              scheduledProviderPriceId: clearScheduledChange
                ? null
                : current?.scheduledProviderPriceId,
              scheduledChangeAt: clearScheduledChange ? null : current?.scheduledChangeAt,
              scheduledChangeState: nextScheduledChangeState,
              scheduledChangeRequestedAt: clearScheduledChange
                ? null
                : current?.scheduledChangeRequestedAt,
              updatedAt: new Date(),
            },
          });

        await this.recomputeWorkspaceTier(tx, workspaceId);

        // A granting webhook is the cross-device "payment landed" signal
        // — the pending-checkout row it supersedes comes down with it
        // (0051; the FE lock derives from GET /billing/subscription).
        if ((GRANTING_STATUSES as readonly string[]).includes(sub.status)) {
          await tx.delete(pendingCheckouts).where(eq(pendingCheckouts.workspaceId, workspaceId));
        }

        await tx
          .update(subscriptionEvents)
          .set({ processedAt: new Date() })
          .where(eq(subscriptionEvents.id, eventRowId));
        return null;
      });
    } catch (err) {
      // The 0051 partial unique index refused a SECOND live
      // subscription for this workspace. The charge exists at the
      // provider and our DB will not record it — the one failure mode
      // the B7 analysis called worse than no index, made LOUD instead
      // of silent: ERROR on every delivery attempt, event left
      // UNPROCESSED so the provider's retry schedule keeps it alive.
      // Self-heals if the conflicting subscription is cancelled
      // (provider-side or via support); the retry then applies clean.
      if (isUniqueViolation(err, 'subscriptions_one_live_per_workspace')) {
        this.logger.error(
          `billing.webhook.live_conflict provider=${provider} sub=${sub.providerSubscriptionId} workspace_has_live_subscription event=${event.providerEventId} — charge exists at provider, refusing to record a second live subscription; resolve the conflicting row`,
        );
        return { kind: 'unresolved', reason: 'live_conflict' };
      }
      throw err;
    }
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
      `billing_event kind=${kind} tier=${appliedTier} provider=${provider} status=${sub.status} workspace=${workspaceId}`,
    );
    this.logger.log(
      `billing.subscription_changed workspace=${workspaceId} tier=${appliedTier} status=${sub.status} provider=${provider} founding=${entry.founding}`,
    );
    return { kind: 'processed', effect: `subscription:${sub.status}` };
  }

  private async applyScheduledCancellation(
    provider: BillingProviderId,
    event: Extract<NormalizedBillingEvent, { kind: 'cancellation_scheduled' }>,
    eventRowId: string,
  ): Promise<WebhookProcessOutcome> {
    // Founder rules (2026-07-20, implemented 0051): a CHARGEBACK
    // revokes entitlement immediately and sticks; a voluntary REFUND
    // holds to period end, then drops. Both are LOCAL verdicts —
    // `cancel_source` marks them so the next subscription.* payload
    // cannot re-grant what the provenance says is ending.
    const outcome = await this.db.transaction(async (tx) => {
      // Same lock as the subscription upsert — this is the OTHER writer
      // of `subscriptions` state. Without it a cancellation can
      // interleave with an in-flight upsert whose staleness check
      // already ran, and the upsert's `cancel_at_period_end` lands last.
      await this.lockSubscription(tx, provider, event.providerSubscriptionId);

      const isChargeback = event.reason === 'chargeback';
      const [row] = await tx
        .update(subscriptions)
        .set({
          cancelAtPeriodEnd: true,
          // `provider_scheduled` (an ordinary provider-side scheduled
          // cancel) is provenance 'provider'; refund/chargeback map
          // verbatim — they are the local verdicts.
          cancelSource: event.reason === 'provider_scheduled' ? 'provider' : event.reason,
          // Chargeback: the deadline is NOW — recompute below drops the
          // tier in the same transaction. Refund: entitlement holds to
          // the period the user paid for (falling back to now when no
          // period end is known — never grant on a missing fact).
          // sql now() (not a JS Date): the recompute in this SAME
          // transaction compares `entitlement_ends_at > now()`, and
          // Postgres now() is transaction-start time — a JS clock read
          // mid-transaction lands AFTER it, so a JS deadline would
          // still grant inside this tx and only drop on the next
          // recompute (CI caught exactly that race; local PGlite hid
          // it). tx-now == tx-now compares NOT-greater → excluded,
          // deterministically.
          entitlementEndsAt: isChargeback
            ? sql`now()`
            : sql`COALESCE(${subscriptions.currentPeriodEnd}, now())`,
          updatedAt: new Date(),
        })
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

      // ALWAYS recompute, chargeback or refund.
      //
      // This was gated on `isChargeback`, on the reasoning that a refund's
      // deadline is `COALESCE(current_period_end, now())` and therefore in
      // the future, making the recompute a no-op. That holds mid-period and
      // fails in the two cases where the deadline is NOT in the future:
      //
      //   - the paid period has already ended, so the row must stop granting
      //     the moment the refund lands;
      //   - `current_period_end` is NULL, so the deadline collapses to
      //     `now()`, which is not `> now()` either.
      //
      // In both, the row stopped granting while `workspaces.tier` kept the
      // paid tier — free Pro until the next webhook or the 6-hourly sweep.
      // Found by sandbox smoke 2026-07-29: pre-refund tier=pro, one refund
      // with period end 18 days past, row grants=no, tier still pro.
      //
      // Recomputing unconditionally is cheap (one select, one update) and
      // idempotent: mid-period it writes the same tier back, which is the
      // behaviour the "tier holds until period end" test pins.
      await this.recomputeWorkspaceTier(tx, row.workspaceId);

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
  // NOTE: the worker's billing reconciliation sweep
  // (apps/api/src/worker.ts, sweepBillingReconciliation) mirrors this
  // logic in SQL — same statuses, same deadline predicate, same
  // max-rank rule. Change one, change both.
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
          // 0051: a deadline in the past stops granting regardless of
          // status — expired dunning, refund past period end, and a
          // chargeback (deadline = the moment it landed) all fall out
          // here. NULL = no deadline (healthy active row).
          sql`(${subscriptions.entitlementEndsAt} IS NULL OR ${subscriptions.entitlementEndsAt} > now())`,
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
