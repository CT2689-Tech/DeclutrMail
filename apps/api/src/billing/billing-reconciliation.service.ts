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
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
}

/**
 * Counters for the verdict pass, which is no longer part of the drift
 * sweep. It moved to `BillingVerdictWorker` on a ~10 minute cadence
 * because `settled` gates whether a refunded customer can buy again, and
 * six hours is not an acceptable latency on a revenue path (D253). The
 * three `verdicts*` fields that used to live on `DriftSweepResult` are
 * these; they now reach observability through that worker's
 * `worker.succeeded` line rather than `billing.reconcile.swept`.
 */
export interface VerdictPassResult {
  /** Local refund/chargeback verdicts newly pushed to the provider. */
  enforced: number;
  /** Verdict rows the provider would not confirm a cancel for this run. */
  unenforced: number;
  /** Verdicts the provider CONTRADICTED — refund rejected or chargeback
   *  reversed — lifted so the customer stops paying for nothing. */
  refuted: number;
  /** Refunds the provider CONFIRMED — the plan slot was freed so the
   *  customer can purchase again (D253). Chargebacks never count here. */
  settled: number;
}

/** A candidate must postdate the claim, minus this skew allowance. */
const CLAIM_MATCH_SKEW_MS = 15 * 60 * 1000;

/** Drift sweep row cap per run (6-hourly) — the sequential loop is the
 *  rate limiter at current scale; the cap bounds a pathological run. */
const DRIFT_SWEEP_MAX_ROWS = 500;

/** Consecutive provider errors before the sweep stops asking that
 *  provider this run — a down provider should not be hammered 500×. */
const DRIFT_SWEEP_TRIP_AFTER = 3;

/**
 * Row cap for the two passes the verdict WORKER runs, well under
 * `DRIFT_SWEEP_MAX_ROWS` because those two share a 60-second budget the
 * untimed 6-hourly sweep did not have: `cronPolicy` carries
 * `timeoutMs: 60_000`, the verdict pass makes TWO sequential provider
 * calls per row and the watch pass one, so 500 rows could not finish.
 *
 * A cap here is NOT the harmless partial pass it would be in a sweep
 * that eventually revisits everything. These passes are selected with
 * `RANDOM_ROW_ORDER` for a reason — see it. Read that before changing
 * either the cap or the ordering; they are one mechanism.
 */
export const VERDICT_PASS_MAX_ROWS = 100;

/**
 * Selection order for the two CAPPED verdict passes, and the reason they
 * are not ordered by `updated_at` like every other sweep in this file.
 *
 * A row the provider has not settled yet writes NOTHING — that is the
 * whole point of the restraint. So its `updated_at` never moves, and
 * `ORDER BY updated_at ASC LIMIT n` returns the *same* n rows on every
 * run, forever. Not "until the backlog drains": there is no drain, the
 * leading rows are precisely the ones that cannot progress. Row n+1 is
 * never examined again.
 *
 * That is silent, permanent, and sits on a revenue path — a refunded
 * customer behind the cap could never buy again, which is the exact bug
 * D253 exists to remove, re-created by its own mitigation. (Codex
 * stop-review, 2026-08-13. An earlier revision of this file named the
 * starvation mechanism in a comment and capped anyway.)
 *
 * Random selection makes coverage eventual regardless of how many rows
 * carry verdicts, at the cost of oldest-first fairness — which is the
 * property causing the starvation, so losing it is the fix rather than
 * a concession. At a ten-minute cadence a row still gets many looks a
 * day. Hitting the cap is logged, never silent.
 */
const RANDOM_ROW_ORDER = sql`random()`;

/** How long to keep watching a refund-canceled row whose
 *  `current_period_end` is unknown (D253). A provider can only charge
 *  again at renewal, so with no recorded renewal date this stands in for
 *  the longest ordinary cycle we would otherwise be blind across. */
const REFUND_WATCH_FALLBACK_DAYS = 45;

/** Grace past the renewal date. The alert is "the provider still intends
 *  to bill", so the window has to outlast the moment it would. */
const REFUND_WATCH_GRACE_DAYS = 7;

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
   * A capped pass that fills its cap has NOT seen everything, and must
   * say so. Random selection (see `RANDOM_ROW_ORDER`) makes coverage
   * eventual rather than guaranteed within one run, so the honest
   * reading of a full page is "there is more than I can hold" — and a
   * pass that quietly returns clean counters over a truncated set reads
   * as "nothing wrong" when it verified only part of the population.
   *
   * Reaching this at all means verdict volume outgrew a cadence sized
   * for a handful of refunds, which is an operational signal in itself.
   */
  private warnIfCapped(rowCount: number, pass: 'verdict' | 'refund_watch'): void {
    if (rowCount < VERDICT_PASS_MAX_ROWS) return;
    this.logger.warn(
      `billing.reconcile.pass_capped pass=${pass} rows=${rowCount} cap=${VERDICT_PASS_MAX_ROWS} — more rows carry verdicts than one pass examines; selection is random so coverage is eventual, but latency on any single row is no longer bounded by the cadence`,
    );
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
      // Same starvation as the verdict passes, one cap up. A row whose
      // provider truth is UNCHANGED reconciles to the same state hash,
      // dedups in the ledger, and writes nothing — so its `updated_at`
      // never moves either, and the healthy majority is exactly the
      // population that cannot progress. Past 500 live subscriptions,
      // `updated_at ASC` would pin the sweep to the same 500 forever and
      // every customer behind them would lose the missed-webhook
      // recovery this sweep exists to provide, silently.
      //
      // Pre-existing rather than introduced here, and only reachable at
      // a scale this business has not hit. Fixed alongside its sibling
      // because it is the identical defect on the adjacent line, and
      // leaving it would mean shipping a known permanent-starvation bug
      // beside the commit that fixes one (CLAUDE.md — fix the class).
      .orderBy(RANDOM_ROW_ORDER)
      .limit(DRIFT_SWEEP_MAX_ROWS);
    if (rows.length >= DRIFT_SWEEP_MAX_ROWS) {
      this.logger.warn(
        `billing.reconcile.pass_capped pass=drift rows=${rows.length} cap=${DRIFT_SWEEP_MAX_ROWS} — more live subscriptions than one sweep examines; selection is random so coverage is eventual, but no single row is guaranteed a look this run`,
      );
    }

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

    // Verdict enforcement deliberately does NOT run here any more. It
    // owns its own ~10 minute job (`BillingVerdictWorker`), and calling
    // it from both schedules would let two passes issue provider
    // mutations for the same row concurrently (D253).
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
   * TWO facts are required before anything is sent, and the local marker
   * is only the first. The second is the provider's own
   * `providerCancellationFacts`, because `adjustment.created` fires on a
   * live account while the refund is still `pending_approval` — see the
   * gate below.
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
  async enforceLocalVerdicts(): Promise<VerdictPassResult> {
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
      .orderBy(RANDOM_ROW_ORDER)
      .limit(VERDICT_PASS_MAX_ROWS);
    this.warnIfCapped(rows.length, 'verdict');

    let enforced = 0;
    let unenforced = 0;
    let refuted = 0;
    let settled = 0;
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
        // NOT reset here. A healthy subscriptions endpoint says nothing
        // about the adjustments endpoint, and this loop calls both — so
        // resetting on the first would let a persistently failing second
        // one keep the streak at zero forever. The reset moves to the
        // point where the whole row has been read successfully.
        if (fetched.kind !== 'found') {
          // Cannot read it, so cannot claim it renews. Same posture as
          // the drift pass: a read miss is never grounds for a write.
          unenforced += 1;
          continue;
        }
        const provider = fetched.subscription;
        if (provider.status === 'canceled') {
          continue; // provider is terminal — nothing left to enforce or refute
        }
        // `cancelAtPeriodEnd` deliberately does NOT short-circuit here. It
        // used to, as "already converged — the common steady state", and
        // that skipped the facts read entirely for any row the provider
        // had already scheduled to cancel. Two ordinary timelines land
        // there, and both end badly:
        //
        //   1. The customer cancels in-app, then asks for their money
        //      back. Paddle has held `scheduled_change: cancel` since
        //      their own cancel, so the refund verdict is never settled
        //      and the plan slot is never released.
        //   2. That same refund is REJECTED by Paddle. The refutation
        //      below is never reached either, so `entitlement_ends_at`
        //      stays pinned at the moment the refund was requested and
        //      the customer keeps paying for a plan we no longer grant.
        //
        // (2) is the live bug: cancel-then-rejected-refund is not exotic,
        // and it silently bills someone for nothing. Our OWN enforcement
        // is what sets `cancelAtPeriodEnd` in the first place (below), so
        // the old condition also made every enforced row permanently
        // unreadable afterwards. The flag now suppresses only the
        // redundant outbound cancel, never discovery.
        // Our own marker is NOT proof. `adjustment.created` fires while a
        // live-account refund is still `pending_approval`, and Paddle may
        // yet reject it — cancelling on that would end the subscription of
        // someone who is still paying. Ending entitlement locally on an
        // unsettled refund costs a row we can fix; this step cannot be
        // taken back from the customer's side, so it asks the provider
        // (Codex stop-review, 2026-07-31). `none` and `unknown` both mean
        // "do not act": a pending refund and a failed read are different
        // reasons for the same restraint, logged apart so a provider
        // outage is never read as a rejected refund.
        const facts = await this.adapterFor(row.provider).providerCancellationFacts(
          row.providerSubscriptionId,
        );
        if (facts === null) {
          // A null here is a READ FAILURE, not "nothing settled" — the
          // adapter returns it on a 404, a malformed body, or a throw it
          // swallowed. Because it does not throw, the catch below never
          // sees it, and the successful `fetchSubscription` above has
          // just reset this provider's counter to zero. So the breaker
          // could never trip on a failing adjustments endpoint while the
          // subscriptions endpoint stayed healthy.
          //
          // That was survivable while the `cancelAtPeriodEnd`
          // short-circuit meant most rows never reached this read at all.
          // It no longer does (see above), so every verdict row now asks
          // every pass, and an unreachable adjustments endpoint would be
          // hammered at DRIFT_SWEEP_MAX_ROWS per pass with nothing to
          // stop it.
          consecutiveErrors[row.provider] += 1;
          unenforced += 1;
          this.logger.log(
            `billing.reconcile.verdict_unreadable provider=${row.provider} sub=${row.providerSubscriptionId} local=${row.cancelSource} — could not ask; no action`,
          );
          continue;
        }
        // Both reads landed — the provider is genuinely reachable, so the
        // consecutive-failure streak is broken.
        consecutiveErrors[row.provider] = 0;

        // SETTLED FIRST. A live chargeback beside an old reversed one
        // still ends the plan, so a settled cause outranks any
        // refutation — checking refutation first would skip the cancel.
        if (facts.settled !== null) {
          // Only send the cancel if the provider is not already scheduled
          // to stop. Re-sending is not harmful, but it is a wasted
          // provider mutation on every pass for a row that has already
          // converged — and this loop now revisits those rows by design.
          if (!provider.cancelAtPeriodEnd) {
            await this.adapterFor(row.provider).cancelSubscription(row.providerSubscriptionId);
            enforced += 1;
            this.logger.warn(
              `billing.reconcile.verdict_enforced provider=${row.provider} sub=${row.providerSubscriptionId} local=${row.cancelSource} provider_says=${facts.settled} — provider was still set to renew a ${facts.settled === 'chargeback' ? 'charged-back' : 'refunded'} subscription; scheduled cancel at period end`,
            );
          }
          // `verdictsEnforced` keeps meaning "we sent a cancel" — the
          // counter is now spread into this worker's `worker.succeeded`
          // line rather than `billing.reconcile.swept`, but its meaning
          // is unchanged. A row the provider had already scheduled is
          // neither enforced nor unenforced: nothing was wrong and
          // nothing needed doing.

          // D253. The provider has CONFIRMED the refund — free the plan
          // slot so this customer can buy again.
          //
          // The branch is on `facts.settled`, the PROVIDER's answer, and
          // never on `row.cancelSource`, our own marker. The two are
          // deliberately allowed to differ (a chargeback can settle on a
          // row we marked `refund`), and the code above handles every
          // non-null cause together — so keying on our marker, or on a
          // generic "something settled", would silently unlock
          // chargebacks. Chargebacks must NOT unlock early: under a
          // merchant of record, re-arming the same payment method
          // same-day is how a seller account gets flagged (founder
          // decision, 2026-08-13). They still release normally when the
          // period ends and the real `subscription.canceled` arrives.
          //
          // No provider check guards this, and that is now load-bearing
          // rather than merely tidy. An earlier revision justified the
          // absence by saying Razorpay could never reach here — its
          // facts read returned null and its mapper minted no verdict.
          // Both clauses died in this same branch: Razorpay now reads
          // refunds and disputes, and its mapper resolves a subscription
          // id through the invoice, so Razorpay rows DO reach here and
          // settle. That is the point. A hardcoded
          // `provider !== 'razorpay'` would have become a permanent
          // lockout for every Indian customer at exactly that moment —
          // the bug this feature removes, re-created by its own
          // mitigation.
          //
          // BOTH sides must agree no dispute is involved, and they are
          // asking different questions. `facts.settled === 'refund'` is
          // the provider's answer to "did money actually go back, and is
          // there no live chargeback?" — it is the only thing that can
          // confirm a settlement, which is why the branch is not on our
          // marker alone. `row.cancelSource === 'refund'` is OUR answer
          // to "was a dispute ever raised on this subscription?", and
          // the provider read cannot answer it: a chargeback that was
          // later reversed leaves `facts.settled` reading `refund` while
          // our row still records that a dispute happened. Unlocking
          // there would re-arm the same payment method on a customer who
          // has disputed us before, which is precisely the founder's
          // stated reason for the asymmetry.
          //
          // Requiring both is strictly SAFER than either alone, and the
          // conjunction must be tested HERE rather than left to the
          // projector's WHERE clause. It was there first, and the
          // counter below then incremented — and the log line claimed
          // the slot was released — on rows the projector had silently
          // refused. An observability line that reports work it did not
          // do is the same assert-what-you-don't-know defect this
          // codebase keeps paying for, just aimed at us instead of the
          // customer.
          if (facts.settled === 'refund' && row.cancelSource === 'refund') {
            await this.projectRefundSettlement(row, new Date().toISOString());
            settled += 1;
          }
          continue;
        }

        // Paddle contradicts OUR verdict specifically. Left standing, the
        // row is the cruellest state this system can produce: the
        // customer is billed normally, holds Free, and every self-serve
        // exit is shut (plan change and pause refuse on the pinned flag,
        // un-cancel answers CANCELLATION_NOT_REVOCABLE, checkout answers
        // SUBSCRIPTION_EXISTS). Doing it here rather than from
        // `adjustment.updated` is deliberate: this read is authoritative
        // and needs no provider-side event subscription to work.
        //
        // The MATCH is load-bearing. An earlier revision took a bare
        // "something was refuted" and inferred the verdict from our own
        // `cancel_source`, so a reversed chargeback lifted a refund
        // verdict Paddle had never rejected (Codex stop-review,
        // 2026-07-31).
        const verdict = row.cancelSource === 'chargeback' ? 'chargeback' : 'refund';
        if (facts.refuted[verdict]) {
          await this.liftRefutedVerdict(row, new Date().toISOString());
          refuted += 1;
          continue;
        }

        unenforced += 1;
        this.logger.log(
          `billing.reconcile.verdict_unsettled provider=${row.provider} sub=${row.providerSubscriptionId} local=${row.cancelSource} refuted_refund=${facts.refuted.refund} refuted_chargeback=${facts.refuted.chargeback} — nothing settled and our verdict is not contradicted; no action`,
        );
      } catch (err) {
        consecutiveErrors[row.provider] += 1;
        unenforced += 1;
        this.logger.error(
          `billing.reconcile.verdict_enforce_failed provider=${row.provider} sub=${row.providerSubscriptionId} reason=${row.cancelSource} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { enforced, unenforced, refuted, settled };
  }

  /**
   * Undo a verdict the provider contradicts, and give the plan back.
   *
   * Mirrors `BillingWebhookService.applyRevokedCancellation` — same
   * columns, same reason — but reached from a poll rather than an event,
   * so a rejected refund is corrected even where `adjustment.updated` is
   * not subscribed. `cancel_at_period_end` is left alone for the same
   * reason it is there: the sweep may already have scheduled a cancel at
   * the provider, and claiming a renewal over that would be a fresh lie.
   * With `cancel_source` cleared the D118 "Keep my subscription" button
   * renders and works, which is the customer's way back.
   */
  private async liftRefutedVerdict(
    row: {
      provider: BillingProviderId;
      providerSubscriptionId: string;
      cancelSource: string | null;
    },
    observedAtIso: string,
  ): Promise<void> {
    // Through the ONE projector, like every other write this service
    // causes — dedup, the advisory lock, staleness ordering and the tier
    // recompute all apply unchanged. Writing the columns here instead
    // would make this a second writer of `subscriptions`, which is the
    // precise thing this file's header promises it is not.
    const reason = row.cancelSource === 'chargeback' ? 'chargeback_reverse' : 'refund_rejected';
    const outcome = await this.webhookService.process(
      row.provider,
      {
        kind: 'cancellation_revoked',
        // Deterministic and verdict-scoped: re-observing the SAME
        // refutation dedups (the lift already happened), while a later
        // verdict of the other kind mints its own id.
        providerEventId: `recon-refuted:${row.provider}:${row.providerSubscriptionId}:${row.cancelSource}`,
        eventType: 'reconciliation.cancellation_revoked',
        providerSubscriptionId: row.providerSubscriptionId,
        reason,
      },
      { occurred_at: observedAtIso },
    );
    this.logger.warn(
      `billing.reconcile.verdict_refuted provider=${row.provider} sub=${row.providerSubscriptionId} local=${row.cancelSource} outcome=${outcome.kind} — the provider rejected the refund or reversed the chargeback; entitlement restored`,
    );
  }

  /**
   * Free the plan slot after the provider confirms a refund (D253).
   *
   * Through the ONE projector, exactly like `liftRefutedVerdict` and for
   * the same reason: this file's header promises it is "a second SOURCE,
   * never a second WRITER", and `webhookService.process()` is what
   * supplies the advisory lock, the dedup gate and the tier recompute.
   *
   * The event id is deterministic and scoped to the subscription, so
   * re-observing the same settled refund on a later pass dedups instead
   * of re-flipping. It carries no adjustment id: the provider fact is
   * "a full refund has settled against this subscription", which is
   * true once regardless of how many adjustment rows compose it.
   */
  private async projectRefundSettlement(
    row: { provider: BillingProviderId; providerSubscriptionId: string },
    observedAtIso: string,
  ): Promise<void> {
    const outcome = await this.webhookService.process(
      row.provider,
      {
        kind: 'refund_settled',
        providerEventId: `recon-refund-settled:${row.provider}:${row.providerSubscriptionId}`,
        eventType: 'reconciliation.refund_settled',
        providerSubscriptionId: row.providerSubscriptionId,
      },
      { occurred_at: observedAtIso },
    );
    this.logger.warn(
      `billing.reconcile.refund_settled provider=${row.provider} sub=${row.providerSubscriptionId} outcome=${outcome.kind} — provider confirmed the refund; plan slot released`,
    );
  }

  /**
   * Keep watching a row we locally canceled on a settled refund, until
   * the PROVIDER agrees it is terminal (D253).
   *
   * This is the part of the settlement design that cannot be dropped for
   * scope. Flipping the row to `canceled` makes every other pass lose
   * interest in it — drift, workspace reconcile and the verdict pass all
   * select on `status IN ('active','past_due','paused')` — and the
   * terminal-canceled floor in the projector discards any later
   * `active`/`past_due` payload for it. A payment webhook changes no
   * entitlement.
   *
   * So if the provider's scheduled cancel is cleared, never sticks, or
   * the subscription recovers from dunning, the provider keeps charging
   * the customer while we hold them on Free, and nothing anywhere
   * notices. That is charged-without-entitlement — strictly worse than
   * the lockout this feature exists to remove, and invisible where the
   * lockout at least had a confused customer to report it.
   *
   * The watch is therefore an ALERT, never a write. We deliberately do
   * not auto-resurrect the row: doing so would re-enter the live slot
   * that a repurchase may already occupy, which is the collision the
   * whole design is built to make unrepresentable. A human resolves it.
   *
   * Bounded by the row's own renewal date rather than an attempt
   * counter, which is what the exposure actually is — a provider can
   * only charge again at `current_period_end`, so watching past it plus
   * a grace window buys nothing. Rows with no recorded period end fall
   * back to a fixed window from the refund. Both make the pass
   * self-terminating with no schema change.
   */
  async watchSettledRefunds(): Promise<{
    watched: number;
    rebilling: number;
    unreadable: number;
  }> {
    const rows = await this.db
      .select({
        provider: subscriptions.provider,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        workspaceId: subscriptions.workspaceId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'canceled'),
          eq(subscriptions.cancelSource, 'refund'),
          // `interval '1 day' * n::int` rather than a string-built
          // `interval 'n days'` — the multiplication takes a bound
          // parameter, so the window constants stay TypeScript values
          // instead of being interpolated into SQL text.
          sql`now() <= COALESCE(
                ${subscriptions.currentPeriodEnd},
                ${subscriptions.entitlementEndsAt} + interval '1 day' * ${REFUND_WATCH_FALLBACK_DAYS}::int
              ) + interval '1 day' * ${REFUND_WATCH_GRACE_DAYS}::int`,
        ),
      )
      .orderBy(RANDOM_ROW_ORDER)
      .limit(VERDICT_PASS_MAX_ROWS);
    this.warnIfCapped(rows.length, 'refund_watch');

    let watched = 0;
    let rebilling = 0;
    let unreadable = 0;
    const consecutiveErrors: Record<BillingProviderId, number> = { paddle: 0, razorpay: 0 };

    for (const row of rows) {
      if (consecutiveErrors[row.provider] >= DRIFT_SWEEP_TRIP_AFTER) {
        unreadable += 1;
        continue;
      }
      try {
        const fetched = await this.adapterFor(row.provider).fetchSubscription(
          row.providerSubscriptionId,
        );
        if (fetched.kind !== 'found') {
          // `not_found` is the GOOD outcome here — the subscription is
          // gone at the provider, which is exactly what we want to be
          // true. Only `found_unmapped` is genuinely unreadable, and it
          // is not an alert: an unmappable status is not evidence of
          // billing.
          consecutiveErrors[row.provider] = 0;
          watched += 1;
          if (fetched.kind === 'found_unmapped') {
            unreadable += 1;
            this.logger.log(
              `billing.reconcile.refund_watch_unmapped provider=${row.provider} sub=${row.providerSubscriptionId} provider_status=${fetched.providerStatus}`,
            );
          }
          continue;
        }
        consecutiveErrors[row.provider] = 0;
        watched += 1;
        const provider = fetched.subscription;
        if (provider.status === 'canceled') continue; // converged; nothing to say

        // Still live at the provider. Either it is scheduled to stop and
        // simply has not yet — normal, and quiet — or the schedule is
        // missing, which means the provider intends to bill a customer
        // we have already refunded and cut off.
        if (!provider.cancelAtPeriodEnd) {
          rebilling += 1;
          this.logger.error(
            `billing.reconcile.refund_watch_rebilling workspace=${row.workspaceId} provider=${row.provider} sub=${row.providerSubscriptionId} provider_status=${provider.status} — refunded and locally canceled, but the provider is still set to RENEW; the customer will be charged for a plan they do not hold`,
          );
        }
      } catch (err) {
        consecutiveErrors[row.provider] += 1;
        unreadable += 1;
        this.logger.error(
          `billing.reconcile.refund_watch_failed provider=${row.provider} sub=${row.providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { watched, rebilling, unreadable };
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
