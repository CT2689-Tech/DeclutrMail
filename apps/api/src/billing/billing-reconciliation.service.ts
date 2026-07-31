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
import { and, asc, eq, inArray } from 'drizzle-orm';
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
  | 'payment_in_progress' // provider holds a PRE-GRANT subscription (3DS window) — never "no payment"
  | 'no_pending' // no open claim AND no hint to search by
  | 'unresolved' // projected but refused (live_conflict / unknown_price)
  | 'provider_unavailable'; // could not ask — nothing asserted, nothing written

/**
 * The FE's local pending record, passed as a search hint. Load-bearing
 * for the stale-lock case (Codex 2026-07-30): a local lock outlives the
 * server claim by design (the claim TTLs at 30 min and is swept), so
 * without the hint a stale lock reconciled to `no_pending` WITHOUT ever
 * asking the provider — the exact lost-webhook state this service
 * exists to resolve. Hint fields only filter a search over the
 * workspace's own subscriptions; a match still projects through the
 * fully-guarded webhook path.
 */
export interface ReconcileHint {
  tier?: 'plus' | 'pro' | undefined;
  cycle?: 'monthly' | 'annual' | undefined;
  startedAt?: string | undefined;
}

export interface DriftSweepResult {
  subscriptionsChecked: number;
  subscriptionsDrifted: number;
  subscriptionsUnchanged: number;
  /** Provider answered 404 / unmapped status — logged, never written. */
  subscriptionsUnreadable: number;
  providerErrors: number;
  /** Local refund/chargeback verdicts newly pushed to the provider. */
  verdictsEnforced: number;
  /** Verdict rows the provider would not confirm a cancel for this run. */
  verdictsUnenforced: number;
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
   * The one acceptance rule for a reconciliation candidate: catalog
   * entry matches the awaited tier (and cycle when known), the status
   * grants, and creation postdates the wait's floor. Used both to
   * accept the ref fast-path and to decide whether the search fallback
   * must still run — one predicate, so the two can never disagree.
   */
  private filterMatches(
    candidates: Array<{ provider: BillingProviderId; sub: NormalizedSubscription }>,
    target: { tier: string; cycle: 'monthly' | 'annual' | null },
    floorMs: number | null,
  ): Array<{ provider: BillingProviderId; sub: NormalizedSubscription }> {
    return candidates.filter(({ provider, sub }) => {
      const entry = this.catalog.resolveByPriceId(provider, sub.providerPriceId);
      if (!entry || entry.tierId !== target.tier) return false;
      if (target.cycle !== null && entry.cycle !== target.cycle) return false;
      if (!(GRANTING_STATUSES as readonly string[]).includes(sub.status)) return false;
      if (floorMs !== null && sub.providerCreatedAt) {
        const createdMs = Date.parse(sub.providerCreatedAt);
        if (!Number.isNaN(createdMs) && createdMs < floorMs) return false;
      }
      return true;
    });
  }

  /**
   * Every catalog id the wait could resolve to on one provider — both
   * cycles when the hint carries none, plus the founding variant for
   * pro. Razorpay's search lists per plan_id, so this set IS its
   * search key; Paddle ignores it (email lookup) and the shared
   * candidate filter re-checks tier/cycle either way.
   */
  private candidatePriceIds(
    provider: BillingProviderId,
    tier: string,
    cycle: 'monthly' | 'annual' | null,
  ): string[] {
    if (tier !== 'plus' && tier !== 'pro') return [];
    const cycles = cycle ? [cycle] : (['monthly', 'annual'] as const);
    const ids: string[] = [];
    for (const c of cycles) {
      const standard = this.catalog.resolvePriceId(provider, tier, c, false);
      if (standard) ids.push(standard);
      if (tier === 'pro') {
        const founding = this.catalog.resolvePriceId(provider, tier, c, true);
        if (founding) ids.push(founding);
      }
    }
    return ids;
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
  async reconcilePendingCheckout(
    workspaceId: string,
    hint?: ReconcileHint,
  ): Promise<PendingReconcileOutcome> {
    const [claim] = await this.db
      .select()
      .from(pendingCheckouts)
      .where(eq(pendingCheckouts.workspaceId, workspaceId))
      .limit(1);

    // What the search must match, and since when. The server claim is
    // authoritative when present; a stale local lock (claim already
    // TTL'd and swept) still reconciles via the FE hint instead of
    // answering `no_pending` without asking the provider.
    const target = claim
      ? { tier: claim.tier, cycle: claim.billingCycle, floorMs: claim.createdAt.getTime() }
      : hint?.tier
        ? {
            tier: hint.tier,
            cycle: hint.cycle ?? null,
            floorMs: hint.startedAt ? Date.parse(hint.startedAt) : Number.NaN,
          }
        : null;
    if (!target) return 'no_pending';
    // Candidate floor: the wait's start minus skew; null = no floor.
    const searchFloorMs = Number.isNaN(target.floorMs)
      ? null
      : target.floorMs - CLAIM_MATCH_SKEW_MS;

    // Timestamp BEFORE any provider read — see ORDERING in the header.
    const observedAt = new Date().toISOString();
    // With a claim, only its provider is asked. Hint-only reconciles
    // ask both (the hint does not know the provider).
    const providers: BillingProviderId[] = claim ? [claim.provider] : ['paddle', 'razorpay'];

    const candidates: Array<{ provider: BillingProviderId; sub: NormalizedSubscription }> = [];
    // Pre-grant artifacts seen anywhere along the way (the 3DS window)
    // — a non-zero count must surface as payment_in_progress, never as
    // "no payment found".
    let inProgress = 0;
    try {
      // The claim's provider_ref is a FAST PATH, never the only
      // witness (Codex round 4): a 404 on a rotten ref, or a reclaimed
      // claim pointing at attempt #2 while attempt #1 carried the
      // money, must not conclude none_found from the ref alone. The
      // search below always runs when the ref produced no candidate.
      if (claim?.providerRef) {
        const result = await this.adapterFor(claim.provider).fetchSubscription(claim.providerRef);
        if (result.kind === 'found_unmapped') {
          // The checkout's own artifact EXISTS pre-grant (Razorpay
          // created/authenticated — the 3DS window). "No payment
          // found" here invited the double charge; keep it locked.
          this.logger.log(
            `billing.reconcile.pending_in_progress workspace=${workspaceId} provider=${claim.provider} provider_status=${result.providerStatus}`,
          );
          return 'payment_in_progress';
        }
        if (result.kind === 'found') {
          candidates.push({ provider: claim.provider, sub: result.subscription });
        }
      }
      // Fall back to the search unless the ref produced a candidate
      // that actually SURVIVES the filter — a found-but-canceled ref
      // (a reclaimed claim's attempt #2) must not suppress the search
      // that would find attempt #1's money.
      if (this.filterMatches(candidates, target, searchFloorMs).length === 0) {
        const [owner] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.workspaceId, workspaceId))
          .orderBy(asc(users.createdAt))
          .limit(1);
        if (!owner) return 'none_found';
        const createdAfter =
          searchFloorMs !== null ? new Date(searchFloorMs).toISOString() : undefined;
        for (const provider of providers) {
          // Every catalog id the wait could resolve to on THIS provider
          // (both cycles when the hint has none; founding variant for
          // pro) — Razorpay's search lists per plan_id, so the id set
          // IS its search key.
          const priceIds = this.candidatePriceIds(provider, target.tier, target.cycle);
          const found = await this.adapterFor(provider).searchSubscriptions({
            workspaceId,
            email: owner.email,
            providerPriceIds: priceIds,
            createdAfter,
          });
          inProgress += found.inProgress;
          for (const sub of found.subscriptions) candidates.push({ provider, sub });
        }
      }
    } catch (err) {
      this.logger.warn(
        `billing.reconcile.pending_provider_unavailable workspace=${workspaceId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return 'provider_unavailable';
    }

    const matches = this.filterMatches(candidates, target, searchFloorMs);

    if (matches.length === 0) {
      if (inProgress > 0) {
        // Nothing granting YET, but the provider holds matching
        // pre-grant activity — the release must stay locked.
        this.logger.log(
          `billing.reconcile.pending_in_progress workspace=${workspaceId} via=${claim ? 'claim' : 'hint'} in_progress=${inProgress}`,
        );
        return 'payment_in_progress';
      }
      this.logger.log(
        `billing.reconcile.pending_none_found workspace=${workspaceId} via=${claim ? 'claim' : 'hint'} candidates=${candidates.length}`,
      );
      return 'none_found';
    }
    if (matches.length > 1) {
      // Project only the newest — the extras are real provider state
      // and belong to support, not to an automatic guess.
      this.logger.warn(
        `billing.reconcile.pending_multiple_matches workspace=${workspaceId} count=${matches.length}`,
      );
      matches.sort(
        (a, b) =>
          Date.parse(b.sub.providerCreatedAt ?? '0') - Date.parse(a.sub.providerCreatedAt ?? '0'),
      );
    }
    const match = matches[0]!;

    const outcome = await this.project(
      match.provider,
      // Server-derived attribution: the claim (or the authed
      // workspace's own email search) IS the workspace link.
      { ...match.sub, workspaceId },
      observedAt,
    );
    this.logger.log(
      `billing.reconcile.pending_resolved workspace=${workspaceId} provider=${match.provider} sub=${match.sub.providerSubscriptionId} outcome=${outcome}`,
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
      verdictsEnforced: 0,
      verdictsUnenforced: 0,
    };
    const consecutiveErrors: Record<BillingProviderId, number> = { paddle: 0, razorpay: 0 };

    for (const row of rows) {
      if (consecutiveErrors[row.provider] >= DRIFT_SWEEP_TRIP_AFTER) continue;
      const checked = await this.reconcileSubscriptionRow(row);
      if (checked === 'provider_error') {
        result.providerErrors += 1;
        consecutiveErrors[row.provider] += 1;
        continue;
      }
      consecutiveErrors[row.provider] = 0;
      result.subscriptionsChecked += 1;
      if (checked === 'unreadable') {
        result.subscriptionsUnreadable += 1;
      } else if (checked === 'granted') {
        result.subscriptionsDrifted += 1;
      } else {
        result.subscriptionsUnchanged += 1;
      }
    }

    const enforced = await this.enforceLocalVerdicts();
    result.verdictsEnforced = enforced.enforced;
    result.verdictsUnenforced = enforced.unenforced;
    return result;
  }

  /**
   * The ONE place local truth is pushed OUTWARD, and the exception that
   * proves this service's rule (fetch → project, never the reverse).
   *
   * A refund or chargeback is a verdict only WE hold. Paddle records the
   * adjustment against a transaction; the subscription beside it stays
   * perfectly healthy and renews on schedule. So the row ends up split:
   * `entitlement_ends_at` stops granting the tier on our side while the
   * provider keeps charging on theirs — the customer pays for a second
   * period and gets Free. The divergence points AT the customer, which
   * is why it outranks the projector's purity (matrix H1/H2 follow-up,
   * 2026-07-31).
   *
   * The projector cannot do this itself: `BillingWebhookService` holds
   * no adapters by construction, and an outbound provider call inside a
   * webhook transaction would be retried by the provider's own delivery
   * schedule. Here it is a plain idempotent convergence loop instead —
   * once the provider reports the scheduled cancel, the condition below
   * stops matching and nothing is sent again.
   *
   * `cancelSubscription` is `next_billing_period` on both providers: it
   * stops the RENEWAL, it does not seize access. The entitlement
   * deadline (period end for a refund, now for a chargeback) remains the
   * only thing that ends the plan, so this never shortens what someone
   * paid for.
   *
   * Latency is up to one sweep (6h) plus worker boot. That is inside
   * every renewal window we can bill on, and it buys the retry
   * durability an inline call would not have.
   */
  private async enforceLocalVerdicts(): Promise<{ enforced: number; unenforced: number }> {
    const rows = await this.db
      .select({
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        cancelSource: subscriptions.cancelSource,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.cancelSource, ['refund', 'chargeback']),
          inArray(subscriptions.status, ['active', 'past_due', 'paused']),
        ),
      )
      .orderBy(asc(subscriptions.updatedAt))
      .limit(DRIFT_SWEEP_MAX_ROWS);

    let enforced = 0;
    let unenforced = 0;
    const consecutiveErrors: Record<BillingProviderId, number> = { paddle: 0, razorpay: 0 };

    for (const row of rows) {
      if (consecutiveErrors[row.provider] >= DRIFT_SWEEP_TRIP_AFTER) {
        unenforced += 1;
        continue;
      }
      try {
        const fetched = await this.adapterFor(row.provider).fetchSubscription(
          row.providerSubscriptionId,
        );
        consecutiveErrors[row.provider] = 0;
        if (fetched.kind !== 'found') {
          // Cannot read it, so cannot claim it renews. Same posture as
          // the drift pass: a read miss is never grounds for a write.
          unenforced += 1;
          continue;
        }
        const provider = fetched.subscription;
        if (provider.status === 'canceled' || provider.cancelAtPeriodEnd) {
          continue; // already converged — the common steady state
        }
        await this.adapterFor(row.provider).cancelSubscription(row.providerSubscriptionId);
        enforced += 1;
        this.logger.warn(
          `billing.reconcile.verdict_enforced provider=${row.provider} sub=${row.providerSubscriptionId} reason=${row.cancelSource} — provider was still set to renew a ${row.cancelSource === 'chargeback' ? 'charged-back' : 'refunded'} subscription; scheduled cancel at period end`,
        );
      } catch (err) {
        consecutiveErrors[row.provider] += 1;
        unenforced += 1;
        this.logger.error(
          `billing.reconcile.verdict_enforce_failed provider=${row.provider} sub=${row.providerSubscriptionId} reason=${row.cancelSource} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { enforced, unenforced };
  }

  /**
   * Per-workspace, on-demand provider-truth check — the recovery path
   * for a stuck PLAN CHANGE (D249 follow-on). An immediate upgrade
   * writes no scheduled-change marker (the provider call IS the
   * change), so a lost webhook leaves the row indistinguishable from a
   * healthy pre-change one and the pending-checkout ladder has nothing
   * to key on. The truthful move is to ask the provider about every
   * live row this workspace holds and project what comes back through
   * the ONE projector. BillingService also invokes this right after a
   * successful upgrade so the tier flip never waits on webhook
   * delivery.
   *
   * Outcome mapping (checkout-reconcile vocabulary, worst-signal-wins
   * below `granted`): any projection written → `granted`; else any
   * provider error → `provider_unavailable` (something could not be
   * asked, nothing asserted); else any unreadable row → `unresolved`
   * (exists but unmappable — support territory); no live rows at all →
   * `no_pending`.
   *
   * When every row answered and nothing new was projected, "unchanged"
   * holds two OPPOSITE truths for a caller waiting on a specific
   * change: the awaited state may already be recorded (an earlier
   * projection/webhook wrote it — confirmation), or the provider may
   * still hold the OLD plan (the change never happened — the caller
   * must not be told "confirmed"; Codex 2026-07-30). The `hint` — what
   * the caller was waiting FOR — splits them: recorded granting state
   * matches the target → `already_recorded`; it does not →
   * `none_found` (provider answered; the awaited change exists
   * nowhere, so a release/retry is legitimate). Without a hint the
   * neutral `already_recorded` stands.
   */
  async reconcileWorkspaceSubscriptions(
    workspaceId: string,
    hint?: ReconcileHint,
  ): Promise<PendingReconcileOutcome> {
    const rows = await this.db
      .select({
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.workspaceId, workspaceId),
          inArray(subscriptions.status, ['active', 'past_due', 'paused']),
        ),
      );
    if (rows.length === 0) return 'no_pending';
    let projected = false;
    let providerError = false;
    let unreadable = false;
    for (const row of rows) {
      const checked = await this.reconcileSubscriptionRow(row);
      if (checked === 'granted') projected = true;
      else if (checked === 'provider_error') providerError = true;
      else if (checked === 'unreadable') unreadable = true;
    }
    if (hint?.tier && hint.cycle) {
      // The hint gates EVERY outcome, not just the unchanged branch: a
      // never-reconciled row projects its first snapshot even when the
      // provider still holds the OLD plan, and that bookkeeping write
      // is not the awaited change (Codex 2026-07-30, second round —
      // "granted" here falsely confirmed an unapplied change on the
      // very first check). Post-loop recorded truth is the only thing
      // allowed to answer; same GRANTING_STATUSES partition as the
      // projector so this cannot drift from what grants.
      const grantingRows = await this.db
        .select({ tier: subscriptions.tier, billingCycle: subscriptions.billingCycle })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.workspaceId, workspaceId),
            inArray(subscriptions.status, [...GRANTING_STATUSES]),
          ),
        );
      const matched = grantingRows.some(
        (r) => r.tier === hint.tier && r.billingCycle === hint.cycle,
      );
      if (matched) return projected ? 'granted' : 'already_recorded';
      // Not recorded — but an unasked/unreadable row could still hold
      // it, so absence may only be asserted when every row answered.
      if (providerError) return 'provider_unavailable';
      if (unreadable) return 'unresolved';
      this.logger.log(
        `billing.reconcile.change_absent workspace=${workspaceId} awaited=${hint.tier}/${hint.cycle}`,
      );
      return 'none_found';
    }
    if (projected) return 'granted';
    if (providerError) return 'provider_unavailable';
    if (unreadable) return 'unresolved';
    return 'already_recorded';
  }

  /**
   * One provider-truth check for one live row — shared by the global
   * drift sweep and the per-workspace reconcile so their semantics
   * cannot drift. Never writes on a read miss.
   */
  private async reconcileSubscriptionRow(row: {
    provider: BillingProviderId;
    providerSubscriptionId: string;
  }): Promise<'granted' | 'unchanged' | 'unreadable' | 'provider_error'> {
    const observedAt = new Date().toISOString();
    let fetched: Awaited<ReturnType<BillingProvider['fetchSubscription']>>;
    try {
      fetched = await this.adapterFor(row.provider).fetchSubscription(row.providerSubscriptionId);
    } catch (err) {
      this.logger.warn(
        `billing.reconcile.drift_provider_error provider=${row.provider} sub=${row.providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return 'provider_error';
    }
    if (fetched.kind !== 'found') {
      // A read miss or an unmappable status is never a state write —
      // cancelling a live row on the strength of one GET is the
      // failure mode this branch refuses.
      this.logger.warn(
        `billing.reconcile.provider_missing provider=${row.provider} sub=${row.providerSubscriptionId} read=${fetched.kind}${fetched.kind === 'found_unmapped' ? ` provider_status=${fetched.providerStatus}` : ''}`,
      );
      return 'unreadable';
    }
    // Attribution resolves via the existing subscriptions row (ladder
    // step 1 in resolveWorkspace) — no override needed or wanted.
    const outcome = await this.project(row.provider, fetched.subscription, observedAt);
    if (outcome === 'granted') {
      this.logger.warn(
        `billing.reconcile.drift_applied provider=${row.provider} sub=${row.providerSubscriptionId} status=${fetched.subscription.status}`,
      );
      return 'granted';
    }
    return 'unchanged';
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
