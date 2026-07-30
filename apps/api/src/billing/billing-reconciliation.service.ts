// apps/api/src/billing/billing-reconciliation.service.ts — D249
// provider-truth reconciliation.
//
// WHY. Webhooks are the primary channel but their delivery is finite:
// Paddle gives an event 3 attempts, then it is gone. Before D249 the
// only recovery from a missed grant was asking the CUSTOMER whether
// they believed they had been charged ("I checked — no charge") — a
// question the system can answer itself with one provider GET. The
// 2026-07-29 sandbox run hit exactly this: a real, active subscription
// existed at Paddle while the UI's only affordance was that button.
//
// SHAPE. This service never projects state itself. It fetches provider
// truth, normalizes it, and feeds the SAME `BillingWebhookService.
// process()` every webhook takes — dedup, staleness ordering,
// attribution, live-conflict refusal, tier recompute all apply
// unchanged. Reconciliation is a second SOURCE, never a second WRITER.
//
// ORDERING. Synthesized events carry `occurred_at` = the wall-clock at
// REQUEST START. The staleness guard orders by provider event time, so
// a real webhook stamped after our fetch began wins over the snapshot,
// and anything stamped before it is already reflected in the fetched
// state. Stamping at request start (not response) keeps the freshness
// claim conservative under provider read latency.
//
// IDEMPOTENCY. The synthesized `providerEventId` is
// `recon:<provider>:<subId>:<hash(material state)>` — unchanged truth
// reconciles to the same id and dedups in the existing ledger; changed
// truth mints a new id. No new dedup machinery. Known accepted gap: a
// state that oscillates back to a byte-identical snapshot between runs
// hashes identically and dedups — webhooks remain the channel that
// carries those transitions.
//
// FAILURE POSTURE. Strictly additive. Provider unreachable → outcome
// `provider_unavailable`, nothing written. Provider 404 / unmapped
// status → no candidate, nothing written. A read can only ever RESOLVE
// a stuck state, never create one.

import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { pendingCheckouts, subscriptions, users } from '@declutrmail/db';
import type { BillingProviderId } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type {
  BillingProvider,
  NormalizedBillingEvent,
  NormalizedSubscription,
} from './billing-provider.interface.js';
import { BillingCatalog } from './billing-catalog.js';
import { BillingWebhookService, GRANTING_STATUSES } from './billing-webhook.service.js';
import { PaddleAdapter } from './paddle.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';

/** Outcome of an on-demand pending-checkout reconciliation. */
export type PendingReconcileOutcome =
  | 'granted' // provider truth found and projected — the tier flipped
  | 'already_recorded' // truth unchanged since last look (ledger dedup)
  | 'none_found' // provider answered and holds NO matching subscription
  | 'no_pending' // nothing to reconcile — no open claim
  | 'unresolved' // projected but refused (live_conflict / unknown_price)
  | 'provider_unavailable'; // could not ask — nothing asserted, nothing written

export interface DriftSweepResult {
  subscriptionsChecked: number;
  subscriptionsDrifted: number;
  subscriptionsUnchanged: number;
  /** Provider answered 404 / unmapped status — logged, never written. */
  subscriptionsUnreadable: number;
  providerErrors: number;
}

/** A candidate must postdate the claim, minus this skew allowance. */
const CLAIM_MATCH_SKEW_MS = 15 * 60 * 1000;

/** Drift sweep row cap per run (6-hourly) — the sequential loop is the
 *  rate limiter at current scale; the cap bounds a pathological run. */
const DRIFT_SWEEP_MAX_ROWS = 500;

/** Consecutive provider errors before the sweep stops asking that
 *  provider this run — a down provider should not be hammered 500×. */
const DRIFT_SWEEP_TRIP_AFTER = 3;

/** Deterministic digest of the material subscription state. */
function stateHash(sub: NormalizedSubscription): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        sub.status,
        sub.providerPriceId,
        sub.currentPeriodEnd,
        sub.cancelAtPeriodEnd,
        sub.pauseUntil,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
}

@Injectable()
export class BillingReconciliationService {
  private readonly logger = new Logger(BillingReconciliationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalog: BillingCatalog,
    private readonly webhookService: BillingWebhookService,
    private readonly paddle: PaddleAdapter,
    private readonly razorpay: RazorpayAdapter,
  ) {}

  private adapterFor(provider: BillingProviderId): BillingProvider {
    return provider === 'paddle' ? this.paddle : this.razorpay;
  }

  /**
   * On-demand: reconcile a workspace's open pending checkout against
   * provider truth. Resolution ladder, strictest first:
   *
   *   1. `provider_ref` on the claim → fetchSubscription (Razorpay —
   *      the server minted the subscription, so the id is exact).
   *   2. searchSubscriptionsByEmail(owner email), filtered to the
   *      claim: catalog (tier, cycle) match + granting status +
   *      created-at ≥ claim − 15 min. Newest wins; extras are logged,
   *      never projected.
   *
   * A match is projected with the claim's workspace id as attribution —
   * server-derived, which is what makes a checkout whose signed
   * custom_data no longer verifies recoverable.
   */
  async reconcilePendingCheckout(workspaceId: string): Promise<PendingReconcileOutcome> {
    const [claim] = await this.db
      .select()
      .from(pendingCheckouts)
      .where(eq(pendingCheckouts.workspaceId, workspaceId))
      .limit(1);
    if (!claim) return 'no_pending';

    // Timestamp BEFORE any provider read — see ORDERING in the header.
    const observedAt = new Date().toISOString();
    const adapter = this.adapterFor(claim.provider);

    let candidates: NormalizedSubscription[];
    try {
      if (claim.providerRef) {
        const sub = await adapter.fetchSubscription(claim.providerRef);
        candidates = sub ? [sub] : [];
      } else {
        const [owner] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.workspaceId, workspaceId))
          .orderBy(asc(users.createdAt))
          .limit(1);
        if (!owner) return 'none_found';
        candidates = await adapter.searchSubscriptionsByEmail(owner.email);
      }
    } catch (err) {
      this.logger.warn(
        `billing.reconcile.pending_provider_unavailable workspace=${workspaceId} provider=${claim.provider} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return 'provider_unavailable';
    }

    const claimFloorMs = claim.createdAt.getTime() - CLAIM_MATCH_SKEW_MS;
    const matches = candidates.filter((sub) => {
      const entry = this.catalog.resolveByPriceId(claim.provider, sub.providerPriceId);
      if (!entry || entry.tierId !== claim.tier || entry.cycle !== claim.billingCycle) return false;
      if (!(GRANTING_STATUSES as readonly string[]).includes(sub.status)) return false;
      if (sub.providerCreatedAt) {
        const createdMs = Date.parse(sub.providerCreatedAt);
        if (!Number.isNaN(createdMs) && createdMs < claimFloorMs) return false;
      }
      return true;
    });

    if (matches.length === 0) {
      this.logger.log(
        `billing.reconcile.pending_none_found workspace=${workspaceId} provider=${claim.provider} candidates=${candidates.length}`,
      );
      return 'none_found';
    }
    if (matches.length > 1) {
      // Project only the newest — the extras are real provider state
      // and belong to support, not to an automatic guess.
      this.logger.warn(
        `billing.reconcile.pending_multiple_matches workspace=${workspaceId} provider=${claim.provider} count=${matches.length}`,
      );
      matches.sort(
        (a, b) => Date.parse(b.providerCreatedAt ?? '0') - Date.parse(a.providerCreatedAt ?? '0'),
      );
    }
    const match = matches[0]!;

    const outcome = await this.project(
      claim.provider,
      // Server-derived attribution: the claim IS the workspace link.
      { ...match, workspaceId },
      observedAt,
    );
    this.logger.log(
      `billing.reconcile.pending_resolved workspace=${workspaceId} provider=${claim.provider} sub=${match.providerSubscriptionId} outcome=${outcome}`,
    );
    return outcome;
  }

  /**
   * Drift sweep: verify provider truth for live subscription rows.
   * Runs inside the existing 6-hourly billing sweep. This is the
   * recovery path for a dropped webhook — the provider's retry budget
   * is finite, and before D249 a lost cancel/renewal stayed lost.
   */
  async reconcileLiveSubscriptions(): Promise<DriftSweepResult> {
    const rows = await this.db
      .select({
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'past_due', 'paused']))
      .orderBy(asc(subscriptions.updatedAt))
      .limit(DRIFT_SWEEP_MAX_ROWS);

    const result: DriftSweepResult = {
      subscriptionsChecked: 0,
      subscriptionsDrifted: 0,
      subscriptionsUnchanged: 0,
      subscriptionsUnreadable: 0,
      providerErrors: 0,
    };
    const consecutiveErrors: Record<BillingProviderId, number> = { paddle: 0, razorpay: 0 };

    for (const row of rows) {
      if (consecutiveErrors[row.provider] >= DRIFT_SWEEP_TRIP_AFTER) continue;
      const observedAt = new Date().toISOString();
      let sub: NormalizedSubscription | null;
      try {
        sub = await this.adapterFor(row.provider).fetchSubscription(row.providerSubscriptionId);
        consecutiveErrors[row.provider] = 0;
      } catch (err) {
        result.providerErrors += 1;
        consecutiveErrors[row.provider] += 1;
        this.logger.warn(
          `billing.reconcile.drift_provider_error provider=${row.provider} sub=${row.providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      result.subscriptionsChecked += 1;
      if (sub === null) {
        // A read miss is never a state write — a 404 here would have to
        // cancel a live subscription on the strength of one GET.
        result.subscriptionsUnreadable += 1;
        this.logger.warn(
          `billing.reconcile.provider_missing provider=${row.provider} sub=${row.providerSubscriptionId}`,
        );
        continue;
      }
      // Attribution resolves via the existing subscriptions row (ladder
      // step 1 in resolveWorkspace) — no override needed or wanted.
      const outcome = await this.project(row.provider, sub, observedAt);
      if (outcome === 'granted') {
        result.subscriptionsDrifted += 1;
        this.logger.warn(
          `billing.reconcile.drift_applied provider=${row.provider} sub=${row.providerSubscriptionId} status=${sub.status}`,
        );
      } else {
        result.subscriptionsUnchanged += 1;
      }
    }
    return result;
  }

  /** Synthesize the recon event and run it through the ONE projector. */
  private async project(
    provider: BillingProviderId,
    sub: NormalizedSubscription,
    observedAtIso: string,
  ): Promise<PendingReconcileOutcome> {
    const event: NormalizedBillingEvent = {
      kind: 'subscription',
      providerEventId: `recon:${provider}:${sub.providerSubscriptionId}:${stateHash(sub)}`,
      eventType: 'reconciliation.subscription',
      subscription: sub,
    };
    const outcome = await this.webhookService.process(provider, event, {
      // Read by projectWebhookPayload's audit pick — the staleness
      // guard orders on this exact field.
      occurred_at: observedAtIso,
    });
    switch (outcome.kind) {
      case 'processed':
        return 'granted';
      case 'duplicate':
        return 'already_recorded';
      case 'unresolved':
        return 'unresolved';
      case 'ignored':
        // Unreachable for kind:'subscription'; name it rather than lie.
        return 'unresolved';
    }
  }
}
