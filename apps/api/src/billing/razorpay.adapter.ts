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

/** Razorpay webhook envelope. */
interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscription };
    payment?: { entity?: { id?: string } };
  };
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
   * Always `unknown` — deliberately, and it costs nothing today: this
   * adapter maps no refund or chargeback event, so no Razorpay row ever
   * carries a `cancel_source` verdict for the outbound cancel to act on.
   * Answering `unknown` rather than `none` keeps that honest: the day
   * Razorpay refunds ARE mapped, the gate fails closed (no outbound
   * cancel) instead of silently claiming the provider confirmed nothing.
   */
  async settledCancellationCause(
    providerSubscriptionId: string,
  ): Promise<'refund' | 'chargeback' | 'none' | 'refuted' | 'unknown'> {
    this.logger.warn(`razorpay.settled_cause.unsupported sub=${providerSubscriptionId}`);
    return 'unknown';
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
   * Razorpay does NOT put the event id in the body — the caller passes
   * the `x-razorpay-event-id` header value through `payload` enrichment
   * (see the webhook controller, which injects it as `__eventId`).
   */
  mapWebhookEvent(payload: unknown): NormalizedBillingEvent {
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
      default:
        return { kind: 'ignored', providerEventId: eventId, eventType };
    }
  }
}
