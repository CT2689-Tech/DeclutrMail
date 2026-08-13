// apps/api/src/billing/razorpay.adapter.ts — Razorpay Subscriptions
// adapter behind the D117 `BillingProvider` seam.
//
// Razorpay handles India users (native UPI + Indian cards + INR
// settlement, D117). Unlike Paddle's overlay, the subscription is
// created SERVER-SIDE here (`POST /v1/subscriptions`) so the
// `notes.workspace_id` attribution is set by us, never trusted from
// the client. The FE opens Razorpay Checkout with the returned
// `subscriptionId` + `keyId` (or falls back to `short_url`).
//
// SIGNATURE (D180): `X-Razorpay-Signature` is hex
// HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) — no timestamp scheme
// exists on Razorpay webhooks, so there is no skew check (dedup is the
// replay defense: `x-razorpay-event-id` is unique per event and is the
// `subscription_events` dedup key).
//
// API auth: HTTP Basic `RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET` against
// `https://api.razorpay.com`. Test-mode vs live is keyed by the key id
// itself (`rzp_test_…` / `rzp_live_…`) — no separate base URL.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { CheckoutSession, SubscriptionStatus } from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import type {
  BillingProvider,
  CreateCheckoutInput,
  FetchSubscriptionResult,
  NormalizedBillingEvent,
  NormalizedSubscription,
  PlanChangePreviewResult,
  PlanChangeResult,
  ProviderCancellationFacts,
  SignatureVerifyResult,
  SubscriptionSearchQuery,
  SubscriptionSearchResult,
} from './billing-provider.interface.js';

const API_BASE = 'https://api.razorpay.com';
const API_TIMEOUT_MS = 10_000;

/**
 * `total_count` is mandatory on Razorpay subscription create (number
 * of billing cycles before the subscription completes). Razorpay caps
 * it at 100 cycles — use the max practical horizon per cycle length;
 * renewal beyond it is a provider-side `subscription.completed`
 * (mapped to `canceled` → tier drops, user re-subscribes).
 */
const TOTAL_COUNT = { monthly: 100, annual: 50 } as const;

/**
 * Page size asked of a Razorpay `collection` listing. `count` defaults
 * to 10 and the endpoints that document a maximum cap it at 100 — but
 * several "fetch all" endpoints (invoices by subscription) do not
 * document `count` at all. So the walk advances by what a page ACTUALLY
 * returned and stops on an empty one, never by the size it asked for: an
 * endpoint that ignored `count` would return 10 rows, look shorter than
 * the page, and be read as exhausted.
 */
const LIST_PAGE = 100;

/**
 * Bound on one listing walk. Hitting it means the list was NOT read, and
 * the caller is told exactly that — a partial scan is the "which page
 * was the chargeback on?" bug in a subtler form, and `settled` gates
 * whether a refunded customer may buy again (D253).
 */
const LIST_MAX_PAGES = 50;

/**
 * Dispute phases where the merchant's money is actually at stake.
 * `fraud` (the bank suspects a fraudulent transaction) and `retrieval`
 * (the customer asked their issuer for transaction details) deduct
 * nothing — they are Razorpay's shape of Paddle's `chargeback_warning`,
 * which this system has never treated as plan-ending either. Counting
 * them would revoke a paying customer over a question their bank asked.
 * https://razorpay.com/docs/api/disputes/entity/
 */
const CHARGEBACK_PHASES = new Set(['chargeback', 'pre_arbitration', 'arbitration']);

/** Razorpay subscription entity fields this adapter reads. */
interface RazorpaySubscription {
  id: string;
  plan_id?: string;
  status?: string;
  customer_id?: string | null;
  current_end?: number | null;
  pause_initiated_by?: string | null;
  end_at?: number | null;
  notes?: { workspace_id?: string } | Array<unknown> | null;
  short_url?: string;
  /** Unix seconds; read by the D249 reconciliation GET. */
  created_at?: number | null;
}

/**
 * Entity → NormalizedSubscription, shared by the webhook mapping and
 * the D249 reconciliation read. Null when the status is one we do not
 * map (created/authenticated/unknown) — no charge yet, no usable truth.
 */
function toNormalizedSubscription(entity: RazorpaySubscription): NormalizedSubscription | null {
  if (!entity.id || !entity.plan_id) {
    throw new Error('Razorpay subscription payload missing id or plan_id');
  }
  const status = mapStatus(entity.status ?? '');
  if (status === null) return null;
  return {
    providerSubscriptionId: entity.id,
    providerCustomerId: entity.customer_id ?? null,
    providerPriceId: entity.plan_id,
    status,
    currentPeriodEnd: unixToIso(entity.current_end),
    // Razorpay's cancel_at_cycle_end keeps status `active` and sets
    // `end_at` to the cycle boundary; treat a future end_at on an
    // active sub as a scheduled cancellation.
    cancelAtPeriodEnd:
      status === 'active' && entity.end_at != null && entity.current_end != null
        ? entity.end_at <= entity.current_end
        : false,
    pauseUntil: null,
    workspaceId: readWorkspaceId(entity.notes),
    providerCreatedAt: unixToIso(entity.created_at),
  };
}

/**
 * Invoice entity fields this adapter reads. A subscription invoice is
 * the only documented link between a subscription and the PAYMENT a
 * refund or dispute is keyed to, and it is read in BOTH directions:
 * `subscription_id` → `payment_id` by `providerCancellationFacts`, and
 * `invoice_id` → `subscription_id` by the webhook mapping.
 * `amount_paid` is what that payment actually collected, so it is the
 * comparand for "was the whole charge returned?".
 */
interface RazorpayInvoice {
  payment_id?: string | null;
  amount_paid?: number | null;
  subscription_id?: string | null;
}

/** Refund entity fields read by the facts read and the webhook mapping. */
interface RazorpayRefund {
  amount?: number | null;
  /** `pending` | `processed` | `failed`. */
  status?: string | null;
}

/** Dispute entity fields read by the facts read and the webhook mapping. */
interface RazorpayDispute {
  payment_id?: string | null;
  /** `open` | `under_review` | `won` | `lost` | `closed`. */
  status?: string | null;
  /** `fraud` | `retrieval` | `chargeback` | `pre_arbitration` | `arbitration`. */
  phase?: string | null;
}

/** Payment entity fields the webhook mapping reads. */
interface RazorpayPayment {
  id?: string;
  /** Captured amount, in the currency's lowest unit. */
  amount?: number | null;
  /** Set only when an invoice created the payment — a subscription charge. */
  invoice_id?: string | null;
}

/** Razorpay webhook envelope. */
interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscription };
    payment?: { entity?: RazorpayPayment };
    refund?: { entity?: RazorpayRefund & { id?: string; payment_id?: string } };
    dispute?: { entity?: RazorpayDispute & { id?: string } };
  };
}

/**
 * What a refund or dispute payload means for entitlement, before the
 * subscription it belongs to is known. Deliberately the SAME two verdict
 * kinds Paddle's `adjustment.created` produces — this adapter reaches
 * them the long way round, it does not invent new ones.
 */
type AdjustmentVerdict =
  | { kind: 'cancellation_scheduled'; reason: 'refund' | 'chargeback' }
  | { kind: 'cancellation_revoked'; reason: 'refund_rejected' | 'chargeback_reverse' };

/**
 * Refund payload → verdict, or null for "neither settled nor refuted".
 *
 * Same three rules `providerCancellationFacts` applies to the refund
 * LIST, in the same order, because they must not be able to disagree:
 * one is the webhook that writes the verdict and the other is the
 * reconciliation read that later confirms or lifts it.
 *
 *   1. A part-refund is an apology, not an exit — it is neither, and
 *      that includes a part-refund that FAILED (a failure to return
 *      part of the money contradicts nothing).
 *   2. The gate is the refund entity's `status`, never the event name:
 *      Razorpay's own `refund.created` sample carries
 *      `status: processed` for instant refunds, so keying on the event
 *      would settle too early for normal-speed refunds and too late for
 *      instant ones.
 *   3. `pending` is in neither field. A pending refund can still fail
 *      (Razorpay refuses payments older than six months), and settling
 *      on it would end the plan of someone whose money never came back.
 */
function classifyRefund(
  refund: RazorpayRefund | undefined,
  payment: RazorpayPayment | undefined,
): AdjustmentVerdict | null {
  const captured = payment?.amount;
  if (typeof refund?.amount !== 'number' || typeof captured !== 'number' || captured <= 0) {
    return null;
  }
  if (refund.amount < captured) return null;
  if (refund.status === 'processed') return { kind: 'cancellation_scheduled', reason: 'refund' };
  if (refund.status === 'failed')
    return { kind: 'cancellation_revoked', reason: 'refund_rejected' };
  return null;
}

/**
 * Dispute payload → verdict, or null. Mirrors the dispute arm of
 * `providerCancellationFacts` exactly:
 *
 *   - outside `CHARGEBACK_PHASES` (`fraud`/`retrieval`) nothing is at
 *     stake — that is a chargeback WARNING, and revoking a paying
 *     customer over a question their bank asked is not a thing this
 *     system does;
 *   - `won` is a positive contradiction, the only thing that lifts a
 *     chargeback verdict;
 *   - `closed` is neither: Razorpay documents it as reached by
 *     providing transaction details OR by refunding, two opposite
 *     outcomes, and the refund case announces itself on the refund
 *     rail anyway;
 *   - everything else (`open`/`under_review`/`lost`, and anything
 *     unrecognized) is a live claim against the payment, which ends the
 *     plan.
 */
function classifyDispute(dispute: RazorpayDispute | undefined): AdjustmentVerdict | null {
  if (!CHARGEBACK_PHASES.has(dispute?.phase ?? '')) return null;
  if (dispute?.status === 'won') {
    return { kind: 'cancellation_revoked', reason: 'chargeback_reverse' };
  }
  if (dispute?.status === 'closed') return null;
  return { kind: 'cancellation_scheduled', reason: 'chargeback' };
}

/**
 * Razorpay → local status.
 *
 *   - `created` / `authenticated` — checkout in flight; the first
 *     charge hasn't happened. No entitlement yet → handled upstream
 *     as `ignored` (we only persist from `active`-reachable states).
 *   - `active` → active. `pending` → past_due (dunning). `halted` →
 *     CANCELED: Razorpay never auto-cancels a halted subscription, so
 *     mapping it to past_due granted the tier forever (decision 2,
 *     2026-07-28). Halted is terminal — entitlement drops immediately.
 *   - `cancelled` / `expired` → canceled. `completed` (ran its full
 *     total_count) → canceled. `paused` → paused.
 */
function mapStatus(rzpStatus: string): SubscriptionStatus | null {
  switch (rzpStatus) {
    case 'created':
    case 'authenticated':
      return null;
    case 'active':
      return 'active';
    case 'pending':
      // Genuine retry state — dunning; the 14-day deadline bounds it.
      return 'past_due';
    case 'halted':
      // TERMINAL. Razorpay never auto-cancels a halted subscription;
      // mapping it to past_due granted the tier forever (decision 2).
      return 'canceled';
    case 'paused':
      return 'paused';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'canceled';
    default:
      // Unrecognized status → null (treated as `ignored`, no state
      // write). Mapping an unknown status to `canceled` manufactured a
      // TERMINAL state from a non-terminal input, and the
      // terminal-canceled floor then locked the subscription out of
      // ever reactivating. Leaving state untouched self-heals when a
      // recognized event arrives.
      return null;
  }
}

function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function readWorkspaceId(notes: RazorpaySubscription['notes']): string | null {
  // Razorpay serializes empty notes as `[]` — guard the array shape.
  if (!notes || Array.isArray(notes)) return null;
  return typeof notes.workspace_id === 'string' ? notes.workspace_id : null;
}

export class RazorpayAdapter implements BillingProvider {
  readonly id = 'razorpay' as const;
  private readonly logger = new Logger(RazorpayAdapter.name);

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private authHeader(): string {
    const keyId = this.env.RAZORPAY_KEY_ID;
    const keySecret = this.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const auth = this.authHeader();
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/subscriptions`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: input.providerPriceId,
          total_count: TOTAL_COUNT[input.cycle],
          quantity: 1,
          customer_notify: 1,
          // Server-side attribution — the webhook resolves the
          // workspace from these notes on first contact (D117).
          notes: { workspace_id: input.workspaceId },
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `razorpay.checkout.network_error workspace=${input.workspaceId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `razorpay.checkout.failed workspace=${input.workspaceId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const sub = (await res.json()) as RazorpaySubscription;
    if (!sub.id || !sub.short_url) {
      this.logger.error(`razorpay.checkout.malformed_response workspace=${input.workspaceId}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    return {
      provider: 'razorpay',
      kind: 'hosted',
      subscriptionId: sub.id,
      shortUrl: sub.short_url,
      // keyId is publishable (Razorpay Checkout.js requires it client-side).
      keyId: this.env.RAZORPAY_KEY_ID as string,
    };
  }

  /** POST /v1/subscriptions/{id}/cancel — at cycle end (D118). */
  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    const auth = this.authHeader();
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
        {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cancel_at_cycle_end: 1 }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `razorpay.cancel.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `razorpay.cancel.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
  }

  /**
   * Self-serve plan changes are PADDLE-ONLY at launch (D117/D120).
   * Razorpay plan updates change the billing frequency + remaining
   * count semantics of the subscription, no Razorpay catalog id is
   * provisioned in any environment (the go-live runbook provisions
   * Paddle), and none of it has been exercised against the real API —
   * shipping a guessed PATCH here would be a guaranteed-failing (or
   * worse, mis-billing) path. Fail closed with the designed code; the
   * FE routes Razorpay subscribers to support instead.
   */
  async changePlan(providerSubscriptionId: string): Promise<PlanChangeResult> {
    this.logger.warn(`razorpay.change_plan.unsupported sub=${providerSubscriptionId}`);
    throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
  }

  /** Same posture as changePlan — no preview for an unsupported path. */
  async previewPlanChange(providerSubscriptionId: string): Promise<PlanChangePreviewResult> {
    this.logger.warn(`razorpay.preview_plan_change.unsupported sub=${providerSubscriptionId}`);
    throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
  }

  /** POST /v1/subscriptions/{id}/resume — immediately (D118 pause exit). */
  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    this.logger.warn(`razorpay.resume.no_charge_unverified sub=${providerSubscriptionId}`);
    throw new AppException({ code: 'RESUME_UNSUPPORTED' });
  }

  /**
   * Razorpay cancellation is immediate-or-at-cycle-end and carries no
   * revocable `scheduled_change` object, so there is nothing to clear —
   * unlike Paddle, where the pending cancel is a field. Fails closed to
   * support rather than guessing a reactivation path (same posture as
   * `resumeSubscription`).
   */
  async clearScheduledCancellation(providerSubscriptionId: string): Promise<void> {
    this.logger.warn(
      `razorpay.clear_scheduled_cancellation.unsupported sub=${providerSubscriptionId}`,
    );
    throw new AppException({ code: 'RESUME_UNSUPPORTED' });
  }

  /** D118 pause — unsupported here for the same reason as resume. */
  async pauseSubscription(providerSubscriptionId: string): Promise<void> {
    this.logger.warn(`razorpay.pause.unsupported sub=${providerSubscriptionId}`);
    throw new AppException({ code: 'PAUSE_UNSUPPORTED' });
  }

  /**
   * Authenticated GET of a Razorpay `collection`, walked to exhaustion.
   *
   * Returns `null` when the list could not be read IN FULL — network
   * failure, non-2xx, unreadable body, or a listing longer than the page
   * bound. A partial read is not a shorter answer, it is NO answer: the
   * page we did not fetch is exactly where a live chargeback would hide.
   */
  private async listCollection<T>(path: string, label: string): Promise<T[] | null> {
    const auth = this.authHeader();
    const items: T[] = [];
    let skip = 0;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${API_BASE}${path}${sep}count=${LIST_PAGE}&skip=${skip}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
      } catch (err) {
        this.logger.error(
          `razorpay.cancellation_facts.network_error ${label} err=${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
      if (!res.ok) {
        this.logger.error(`razorpay.cancellation_facts.failed ${label} status=${res.status}`);
        return null;
      }
      let batch: unknown;
      try {
        batch = ((await res.json()) as { items?: unknown }).items;
      } catch {
        batch = undefined;
      }
      if (!Array.isArray(batch)) {
        this.logger.error(`razorpay.cancellation_facts.malformed ${label}`);
        return null;
      }
      if (batch.length === 0) return items;
      items.push(...(batch as T[]));
      skip += batch.length;
    }
    this.logger.error(
      `razorpay.cancellation_facts.page_cap ${label} pages=${LIST_MAX_PAGES} rows=${items.length} — listing exceeds the page bound; reported UNREAD, raise LIST_MAX_PAGES`,
    );
    return null;
  }

  /**
   * Razorpay's own answer to "is there a settled, plan-ending refund or
   * chargeback for this subscription?" — the same gate Paddle answers
   * from `/adjustments`, reached the long way round because Razorpay
   * keys refunds and disputes to a PAYMENT, not a subscription.
   *
   * Three reads, in the only order the API allows:
   *   1. `/v1/invoices?subscription_id=…` — the subscription's payments.
   *   2. `/v1/payments/{id}/refunds` — per payment.
   *   3. `/v1/disputes` — the ACCOUNT's list, filtered to those payments.
   *      Razorpay documents no payment filter on it, so this is a bounded
   *      scan; a scan that hits the bound answers `null` rather than
   *      "no chargeback".
   *
   * `null` means the provider could not be asked — never "nothing is
   * settled". A read we could not make is never grounds for an outbound
   * write, and after D253 it is also never grounds for freeing a plan
   * slot.
   */
  async providerCancellationFacts(
    providerSubscriptionId: string,
  ): Promise<ProviderCancellationFacts | null> {
    try {
      const invoices = await this.listCollection<RazorpayInvoice>(
        `/v1/invoices?subscription_id=${encodeURIComponent(providerSubscriptionId)}`,
        `invoices sub=${providerSubscriptionId}`,
      );
      if (invoices === null) return null;

      // Payment id → what that payment actually collected. Only a FULL
      // refund is an exit (Paddle's `endsSubscription` rule), so the
      // comparand has to travel with the payment: Razorpay marks no
      // refund "partial", it just reports a smaller `amount`.
      const collected = new Map<string, number>();
      for (const invoice of invoices) {
        const paymentId = invoice.payment_id;
        const paid = invoice.amount_paid;
        if (typeof paymentId !== 'string' || !paymentId) continue;
        if (typeof paid !== 'number' || paid <= 0) continue;
        collected.set(paymentId, Math.max(collected.get(paymentId) ?? 0, paid));
      }
      // Nothing was ever collected, so nothing is refundable and nothing
      // is disputable. Answering here also spares the account-wide
      // dispute scan below on a subscription that cannot have one.
      if (collected.size === 0) {
        return { settled: null, refuted: { refund: false, chargeback: false } };
      }

      let settledRefund = false;
      let refutedRefund = false;
      for (const [paymentId, paid] of collected) {
        const refunds = await this.listCollection<RazorpayRefund>(
          `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
          `refunds payment=${paymentId}`,
        );
        if (refunds === null) return null;
        for (const refund of refunds) {
          // A part-refund is an apology, not an exit — same rule Paddle
          // enforces through the item types.
          if (typeof refund.amount !== 'number' || refund.amount < paid) continue;
          // `processed` is Razorpay's terminal success and the ONLY
          // settlement moment. `refund.created` fires while the refund is
          // still `pending` — Razorpay's shape of Paddle's
          // `pending_approval` — and a pending refund can still `fail`
          // (Razorpay refuses payments older than six months). Settling
          // on it would end the plan of someone whose money never came
          // back. `pending` is therefore in NEITHER field.
          if (refund.status === 'processed') settledRefund = true;
          else if (refund.status === 'failed') refutedRefund = true;
        }
      }

      const disputes = await this.listCollection<RazorpayDispute>(
        '/v1/disputes',
        `disputes sub=${providerSubscriptionId}`,
      );
      if (disputes === null) return null;
      let settledChargeback = false;
      let refutedChargeback = false;
      for (const dispute of disputes) {
        if (typeof dispute.payment_id !== 'string' || !collected.has(dispute.payment_id)) continue;
        if (!CHARGEBACK_PHASES.has(dispute.phase ?? '')) continue;
        if (dispute.status === 'won') {
          // The bank accepted our documents — a positive contradiction,
          // exactly like Paddle's `reversed` chargeback.
          refutedChargeback = true;
        } else if (dispute.status !== 'closed') {
          // `open` / `under_review` / `lost` and anything unrecognized:
          // a live claim against this payment ends the plan, mirroring
          // Paddle's "not undone ⇒ settled". `closed` is the one status
          // that is neither — Razorpay documents it as a fraud case
          // resolved "after you provided either the transaction details
          // or made a refund", and those two outcomes contradict each
          // other. The refund case announces itself through the refund
          // list above; guessing between them here would either revoke a
          // customer nobody charged back or lift a verdict Razorpay
          // never contradicted.
          settledChargeback = true;
        }
      }

      return {
        settled: settledChargeback ? 'chargeback' : settledRefund ? 'refund' : null,
        refuted: { refund: refutedRefund, chargeback: refutedChargeback },
      };
    } catch (err) {
      // Missing API keys land here too (`authHeader`), and a thrown read
      // is still an unmade one.
      this.logger.error(
        `razorpay.cancellation_facts.unreadable sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** D249 — GET /v1/subscriptions/{id}. See FetchSubscriptionResult. */
  async fetchSubscription(providerSubscriptionId: string): Promise<FetchSubscriptionResult> {
    const auth = this.authHeader();
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `razorpay.reconcile_read.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) {
      this.logger.error(
        `razorpay.reconcile_read.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const entity = (await res.json()) as RazorpaySubscription;
    if (!entity?.id) {
      this.logger.error(`razorpay.reconcile_read.malformed sub=${providerSubscriptionId}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const normalized = toNormalizedSubscription(entity);
    // created/authenticated (the 3DS window) or unknown — the
    // subscription EXISTS; reporting "not found" here is what invited
    // a double charge (Codex 2026-07-30).
    if (normalized === null) {
      return { kind: 'found_unmapped', providerStatus: entity.status ?? 'unknown' };
    }
    return { kind: 'found', subscription: normalized };
  }

  /**
   * D249 — Razorpay's list API has no customer filter and the payer's
   * email is theirs, not ours, so the search keys on what the server
   * itself wrote: list subscriptions per catalog plan_id, keep the
   * ones whose `notes.workspace_id` (set by createCheckout) names this
   * workspace. The first cut returned [] here on the assumption that
   * `provider_ref` always covers Razorpay — a stale lock outliving the
   * claim row broke exactly that (Codex 2026-07-30), leaving a
   * still-payable subscription findable by nobody.
   */
  async searchSubscriptions(query: SubscriptionSearchQuery): Promise<SubscriptionSearchResult> {
    const result: SubscriptionSearchResult = { subscriptions: [], inProgress: 0 };
    if (query.providerPriceIds.length === 0) return result;
    const auth = this.authHeader();
    const fromSec = query.createdAfter ? Math.floor(Date.parse(query.createdAfter) / 1000) : null;
    for (const planId of query.providerPriceIds) {
      // Paginate: a single count=100 page silently hid any match past
      // page one — a plan-wide false "no payment" (Codex round 4). The
      // page cap bounds a pathological plan; hitting it is logged, so
      // truncation can never read as "covered everything".
      const PAGE = 100;
      const MAX_PAGES = 5;
      let page = 0;
      for (;;) {
        const params = new URLSearchParams({
          plan_id: planId,
          count: String(PAGE),
          skip: String(page * PAGE),
        });
        if (fromSec !== null && Number.isFinite(fromSec)) params.set('from', String(fromSec));
        let res: Response;
        try {
          res = await fetch(`${API_BASE}/v1/subscriptions?${params.toString()}`, {
            headers: { Authorization: auth },
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
          });
        } catch (err) {
          this.logger.error(
            `razorpay.reconcile_search.network_error plan=${planId} err=${err instanceof Error ? err.message : String(err)}`,
          );
          throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
        }
        if (!res.ok) {
          this.logger.error(`razorpay.reconcile_search.failed plan=${planId} status=${res.status}`);
          throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
        }
        const body = (await res.json()) as { items?: RazorpaySubscription[] };
        const items = body.items ?? [];
        for (const entity of items) {
          if (!entity?.id) continue;
          // Only artifacts the server attributed to THIS workspace at
          // creation — a plan-wide listing must never leak across
          // workspaces into a projection candidate.
          if (readWorkspaceId(entity.notes) !== query.workspaceId) continue;
          const normalized = toNormalizedSubscription(entity);
          if (normalized !== null) {
            result.subscriptions.push(normalized);
          } else {
            // created/authenticated — the 3DS window. Real activity.
            result.inProgress += 1;
          }
        }
        if (items.length < PAGE) break;
        page += 1;
        if (page >= MAX_PAGES) {
          this.logger.warn(
            `razorpay.reconcile_search.truncated plan=${planId} pages=${MAX_PAGES} — listing larger than the page cap; narrow with createdAfter or raise MAX_PAGES`,
          );
          break;
        }
      }
    }
    return result;
  }

  verifyWebhookSignature(args: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    secret: string;
  }): SignatureVerifyResult {
    const header = args.signatureHeader;
    if (!header || typeof header !== 'string' || !/^[0-9a-f]+$/i.test(header)) {
      return { ok: false, reason: 'malformed_header' };
    }
    const expected = createHmac('sha256', args.secret).update(args.rawBody).digest();
    const candidate = Buffer.from(header, 'hex');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
    return { ok: false, reason: 'signature_mismatch' };
  }

  /**
   * `GET /v1/invoices/{id}` → the subscription that invoice belongs to.
   * The ONE documented path from a refund or dispute payload to a
   * subscription id (payload → `payment.invoice_id` → here).
   *
   * Two different answers, deliberately not collapsed:
   *   - `null` — the invoice was read and names no subscription. A FACT.
   *     Retrying re-reads the same fact forever, so the caller stops.
   *   - THROWS `BILLING_PROVIDER_ERROR` — the invoice could not be read
   *     (network, timeout, non-2xx incl. 404, unparsable body). NOT an
   *     answer. The caller must not conclude anything from it, and the
   *     webhook must come back.
   *
   * A 404 counts as unread rather than as "no such invoice": the id came
   * from a signature-verified Razorpay payload, so a 404 means we asked
   * wrong (half-configured test/live key pair is the realistic one), not
   * that the invoice does not exist. That is fixable inside the retry
   * window; concluding "unlinked" would burn the refund permanently.
   */
  private async fetchInvoiceSubscriptionId(invoiceId: string): Promise<string | null> {
    const auth = this.authHeader();
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/invoices/${encodeURIComponent(invoiceId)}`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `razorpay.invoice_read.network_error invoice=${invoiceId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(`razorpay.invoice_read.failed invoice=${invoiceId} status=${res.status}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    let entity: RazorpayInvoice;
    try {
      entity = (await res.json()) as RazorpayInvoice;
    } catch {
      this.logger.error(`razorpay.invoice_read.malformed invoice=${invoiceId}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const subscriptionId = entity?.subscription_id;
    return typeof subscriptionId === 'string' && subscriptionId !== '' ? subscriptionId : null;
  }

  /**
   * Refund / dispute payload → the cancellation verdict it carries, on
   * the subscription it actually belongs to.
   *
   * The verdict is decided FIRST and the provider is asked second, so a
   * pending refund or a `fraud`-phase dispute — the majority of this
   * traffic — costs no outbound call at all.
   *
   * Both `ignored` returns below are facts, not failures: this payment
   * was not created by an invoice, or that invoice belongs to no
   * subscription. Either way there is nothing to cancel and no retry can
   * change it. An unread invoice is the opposite case and throws.
   */
  private async mapAdjustmentEvent(
    eventId: string,
    eventType: string,
    body: RazorpayWebhookBody,
  ): Promise<NormalizedBillingEvent> {
    const payment = body.payload?.payment?.entity;
    const paymentId = body.payload?.refund?.entity?.payment_id ?? payment?.id ?? null;
    const verdict = eventType.startsWith('refund.')
      ? classifyRefund(body.payload?.refund?.entity, payment)
      : classifyDispute(body.payload?.dispute?.entity);

    if (verdict === null) {
      this.logger.log(
        `billing.razorpay.adjustment_not_actionable event=${eventType} id=${eventId} payment=${paymentId} — entitlement unchanged; this payload is neither a settled full refund/chargeback nor a contradiction of one`,
      );
      return { kind: 'ignored', providerEventId: eventId, eventType };
    }

    const invoiceId = payment?.invoice_id;
    if (typeof invoiceId !== 'string' || invoiceId === '') {
      this.logger.error(
        `billing.razorpay.adjustment_no_invoice event=${eventType} id=${eventId} payment=${paymentId} — entitlement UNCHANGED; no invoice created this payment, so it belongs to no subscription`,
      );
      return { kind: 'ignored', providerEventId: eventId, eventType };
    }

    const providerSubscriptionId = await this.fetchInvoiceSubscriptionId(invoiceId);
    if (providerSubscriptionId === null) {
      this.logger.error(
        `billing.razorpay.adjustment_unlinked event=${eventType} id=${eventId} payment=${paymentId} invoice=${invoiceId} — entitlement UNCHANGED; the invoice names no subscription. Act in the Razorpay dashboard if this was meant to end a plan.`,
      );
      return { kind: 'ignored', providerEventId: eventId, eventType };
    }

    return { ...verdict, providerEventId: eventId, eventType, providerSubscriptionId };
  }

  /**
   * Razorpay does NOT put the event id in the body — the caller passes
   * the `x-razorpay-event-id` header value through `payload` enrichment
   * (see the webhook controller, which injects it as `__eventId`).
   *
   * ASYNC, unlike Paddle's: the refund and dispute arms resolve the
   * subscription id through `GET /v1/invoices/{id}` (see the seam's
   * contract in billing-provider.interface.ts). Everything the caller
   * must guarantee before this runs — signature verified, event id
   * present — is unchanged; the outbound call rides on top of it.
   */
  async mapWebhookEvent(payload: unknown): Promise<NormalizedBillingEvent> {
    const body = payload as RazorpayWebhookBody & { __eventId?: string };
    const eventId = body?.__eventId;
    const eventType = body?.event;
    if (!eventId || typeof eventId !== 'string' || !eventType || typeof eventType !== 'string') {
      throw new Error('Razorpay webhook missing event id or event name');
    }

    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.updated':
      case 'subscription.pending':
      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.paused':
      case 'subscription.resumed': {
        const entity = body.payload?.subscription?.entity;
        if (!entity?.id || !entity.plan_id) {
          throw new Error('Razorpay subscription payload missing id or plan_id');
        }
        const subscription = toNormalizedSubscription(entity);
        if (subscription === null) {
          // created/authenticated — no charge yet, no entitlement.
          return { kind: 'ignored', providerEventId: eventId, eventType };
        }
        return { kind: 'subscription', providerEventId: eventId, eventType, subscription };
      }
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed':
      case 'payment.dispute.created':
      case 'payment.dispute.won':
      case 'payment.dispute.lost':
      case 'payment.dispute.closed':
        // The refund/chargeback rail — Razorpay's answer to Paddle's
        // `adjustment.created`, and the only reason this mapper is async.
        // These payloads are keyed to a PAYMENT: the refund and dispute
        // entities carry `payment_id`, the payment entity carries
        // `order_id` and `invoice_id`, and NONE of the three has a
        // subscription field (razorpay.com/docs/api/payments/entity,
        // razorpay.com/docs/api/disputes/entity,
        // razorpay.com/docs/webhooks/refunds). The subscription id is
        // resolved through the invoice, never guessed — putting an
        // invoice id in a field that MEANS subscription id would
        // mis-attribute a cancellation to whatever row happened to
        // match, ending an unrelated customer's plan.
        return this.mapAdjustmentEvent(eventId, eventType, body);
      default:
        return { kind: 'ignored', providerEventId: eventId, eventType };
    }
  }
}
