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
  NormalizedBillingEvent,
  NormalizedSubscription,
  SignatureVerifyResult,
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
 *   - `active` → active. `pending` / `halted` → past_due (dunning).
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
    case 'halted':
      return 'past_due';
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
  async changePlan(providerSubscriptionId: string): Promise<void> {
    this.logger.warn(`razorpay.change_plan.unsupported sub=${providerSubscriptionId}`);
    throw new AppException({ code: 'PLAN_CHANGE_UNSUPPORTED' });
  }

  /** POST /v1/subscriptions/{id}/resume — immediately (D118 pause exit). */
  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    const auth = this.authHeader();
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}/resume`,
        {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume_at: 'now' }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `razorpay.resume.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `razorpay.resume.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
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
        const status = mapStatus(entity.status ?? '');
        if (status === null) {
          // created/authenticated — no charge yet, no entitlement.
          return { kind: 'ignored', providerEventId: eventId, eventType };
        }
        const subscription: NormalizedSubscription = {
          providerSubscriptionId: entity.id,
          providerCustomerId: entity.customer_id ?? null,
          providerPriceId: entity.plan_id,
          status,
          currentPeriodEnd: unixToIso(entity.current_end),
          // Razorpay's cancel_at_cycle_end keeps status `active` and
          // sets `end_at` to the cycle boundary; treat a future end_at
          // on an active sub as a scheduled cancellation.
          cancelAtPeriodEnd:
            status === 'active' && entity.end_at != null && entity.current_end != null
              ? entity.end_at <= entity.current_end
              : false,
          pauseUntil: null,
          workspaceId: readWorkspaceId(entity.notes),
        };
        return { kind: 'subscription', providerEventId: eventId, eventType, subscription };
      }
      default:
        return { kind: 'ignored', providerEventId: eventId, eventType };
    }
  }
}
