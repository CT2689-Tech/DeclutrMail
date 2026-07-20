// apps/api/src/billing/paddle.adapter.ts — Paddle Billing (API v2)
// adapter behind the D117 `BillingProvider` seam.
//
// Paddle is merchant-of-record for non-India users (D117). Checkout is
// Paddle.js OVERLAY-style: there is no server-created session — the FE
// initializes Paddle.js with the publishable client-side token and
// opens the overlay with the price id + customData. The webhook is the
// only authoritative state channel.
//
// SIGNATURE (D180, built to the D229 bar): `Paddle-Signature` header
// carries `ts=<unix-seconds>;h1=<hex hmac>` (multiple `h1` blocks
// during secret rotation). The signed payload is `${ts}:${rawBody}`,
// HMAC-SHA256 with the webhook destination's secret key. We reject:
//   - malformed header (missing ts/h1, non-numeric ts)
//   - |now - ts| > 5s (PADDLE_WEBHOOK_MAX_SKEW_SEC overridable —
//     Paddle's SDK default is 5 seconds)
//   - HMAC mismatch (timing-safe compare against every h1)
//
// API calls use `Authorization: Bearer PADDLE_API_KEY` against
// `https://api.paddle.com` (PADDLE_ENV=production) or
// `https://sandbox-api.paddle.com` (default — fail-safe toward
// sandbox so a missing env can never hit the live ledger).

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

/** Default tolerated clock skew between Paddle's `ts` and now (seconds). */
const DEFAULT_MAX_SKEW_SEC = 5;

const API_TIMEOUT_MS = 10_000;

/**
 * `custom_data` travels to Paddle THROUGH THE BROWSER
 * (`Paddle.Checkout.open`), so its contents are attacker-controlled: a
 * forged `workspace_id` would attribute a paid subscription — and mint
 * a `billing_customers` mapping — onto someone else's workspace. The
 * server therefore signs the id and the webhook refuses any value
 * whose signature does not verify, which reduces the client to a
 * courier of an opaque blob it cannot forge.
 *
 * Keyed on PADDLE_WEBHOOK_SECRET: server-only, already required for
 * this flow, and never exposed to the browser (the FE receives only
 * PADDLE_CLIENT_TOKEN).
 */
function attributionSignature(workspaceId: string, secret: string): string {
  return createHmac('sha256', secret).update(`paddle:workspace:${workspaceId}`).digest('hex');
}

/**
 * Verify a `custom_data` attribution blob. Returns the workspace id
 * only when the signature matches; unsigned or mis-signed values are
 * discarded (the event then falls back to the subscription /
 * billing_customers links, or is left unresolved for retry).
 */
export function verifiedWorkspaceId(
  customData: { workspace_id?: string; sig?: string } | null | undefined,
  secret: string | undefined,
): string | null {
  const workspaceId = customData?.workspace_id;
  const sig = customData?.sig;
  if (!workspaceId || !sig || !secret) return null;
  const expected = attributionSignature(workspaceId, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return workspaceId;
}

/** Paddle subscription entity fields this adapter reads (API v2). */
interface PaddleSubscription {
  id: string;
  status: string;
  customer_id?: string | null;
  items?: Array<{ price?: { id?: string } }>;
  current_billing_period?: { ends_at?: string | null } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  paused_at?: string | null;
  custom_data?: { workspace_id?: string; sig?: string } | null;
}

/**
 * Paddle transaction entity fields this adapter reads. `custom_data`
 * here is the checkout's own payload (Paddle copies it onto the
 * transaction), which is why a completed transaction can seed
 * attribution even when the subscription entity carries none.
 */
interface PaddleTransaction {
  subscription_id?: string | null;
  customer_id?: string | null;
  custom_data?: { workspace_id?: string; sig?: string } | null;
}

/** Paddle webhook envelope (API v2 notifications). */
interface PaddleWebhookBody {
  event_id?: string;
  event_type?: string;
  data?: Record<string, unknown>;
}

/**
 * Paddle → local status. `trialing` maps to `active` defensively: D121
 * locked no-trial so we never create trials, but a manually-created
 * sandbox trial must not crash the stream (the pg_enum has no
 * `trialing`). `inactive` (terminal, post-dunning) maps to `canceled`.
 */
function mapStatus(paddleStatus: string): SubscriptionStatus {
  switch (paddleStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'canceled':
    case 'inactive':
      return 'canceled';
    default:
      return 'canceled';
  }
}

function toNormalizedSubscription(
  sub: PaddleSubscription,
  webhookSecret: string | undefined,
): NormalizedSubscription {
  const priceId = sub.items?.[0]?.price?.id;
  if (!sub.id || !priceId) {
    throw new Error('Paddle subscription payload missing id or items[0].price.id');
  }
  const scheduledCancel = sub.scheduled_change?.action === 'cancel';
  const status = mapStatus(sub.status);
  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer_id ?? null,
    providerPriceId: priceId,
    status,
    currentPeriodEnd: sub.current_billing_period?.ends_at ?? null,
    cancelAtPeriodEnd: scheduledCancel,
    // D118 — paused subscriptions resume via scheduled_change; Paddle
    // does not carry an explicit pause-until, so the resume timestamp
    // is the closest equivalent when present.
    pauseUntil:
      status === 'paused' && sub.scheduled_change?.action === 'resume'
        ? (sub.scheduled_change.effective_at ?? null)
        : null,
    // Signed attribution only — an unsigned/forged blob resolves to
    // null and the event falls back to the server-owned links.
    workspaceId: verifiedWorkspaceId(sub.custom_data, webhookSecret),
  };
}

export class PaddleAdapter implements BillingProvider {
  readonly id = 'paddle' as const;
  private readonly logger = new Logger(PaddleAdapter.name);

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private get baseUrl(): string {
    return this.env.PADDLE_ENV === 'production'
      ? 'https://api.paddle.com'
      : 'https://sandbox-api.paddle.com';
  }

  /**
   * Overlay checkout — pure payload assembly, no Paddle API call. The
   * customer record is created provider-side at checkout completion
   * and lands in `billing_customers` via the subscription webhook.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const clientToken = this.env.PADDLE_CLIENT_TOKEN;
    // The webhook secret also keys the attribution signature. Without
    // it we could only emit an UNSIGNED blob, which the webhook would
    // then refuse — fail closed here instead of taking money for a
    // checkout that can never be attributed.
    const webhookSecret = this.env.PADDLE_WEBHOOK_SECRET;
    if (!clientToken || !webhookSecret) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    return {
      provider: 'paddle',
      kind: 'overlay',
      priceId: input.providerPriceId,
      clientToken,
      environment: this.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox',
      // Key must match the webhook reader (`custom_data.workspace_id`).
      customData: {
        workspace_id: input.workspaceId,
        sig: attributionSignature(input.workspaceId, webhookSecret),
      },
    };
  }

  /** POST /subscriptions/{id}/cancel — at next billing period (D118). */
  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ effective_from: 'next_billing_period' }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.cancel.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      // Body is Paddle's error envelope — log status only; never log
      // the API key (it is not in the response, but keep the line lean).
      this.logger.error(`paddle.cancel.failed sub=${providerSubscriptionId} status=${res.status}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
  }

  verifyWebhookSignature(args: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    secret: string;
    nowMs?: number;
  }): SignatureVerifyResult {
    const header = args.signatureHeader;
    if (!header || typeof header !== 'string') {
      return { ok: false, reason: 'malformed_header' };
    }
    // `ts=1671552777;h1=abc...` — h1 may repeat during secret rotation.
    let ts: string | null = null;
    const h1s: string[] = [];
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 'ts') ts = value;
      else if (key === 'h1') h1s.push(value);
    }
    if (!ts || !/^\d+$/.test(ts) || h1s.length === 0) {
      return { ok: false, reason: 'malformed_header' };
    }

    const maxSkewSec = Number(this.env.PADDLE_WEBHOOK_MAX_SKEW_SEC) || DEFAULT_MAX_SKEW_SEC;
    const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000);
    if (Math.abs(nowSec - Number(ts)) > maxSkewSec) {
      return { ok: false, reason: 'timestamp_skew' };
    }

    const expected = createHmac('sha256', args.secret)
      .update(`${ts}:`)
      .update(args.rawBody)
      .digest();
    for (const h1 of h1s) {
      if (!/^[0-9a-f]+$/i.test(h1)) continue;
      const candidate = Buffer.from(h1, 'hex');
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
        return { ok: true };
      }
    }
    return { ok: false, reason: 'signature_mismatch' };
  }

  mapWebhookEvent(payload: unknown): NormalizedBillingEvent {
    const body = payload as PaddleWebhookBody;
    const eventId = body?.event_id;
    const eventType = body?.event_type;
    if (!eventId || typeof eventId !== 'string' || !eventType || typeof eventType !== 'string') {
      throw new Error('Paddle webhook missing event_id or event_type');
    }

    switch (eventType) {
      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.updated':
      case 'subscription.canceled':
      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.past_due':
        return {
          kind: 'subscription',
          providerEventId: eventId,
          eventType,
          subscription: toNormalizedSubscription(
            body.data as unknown as PaddleSubscription,
            this.env.PADDLE_WEBHOOK_SECRET,
          ),
        };
      case 'transaction.completed': {
        const data = body.data as PaddleTransaction | undefined;
        return {
          kind: 'payment',
          providerEventId: eventId,
          eventType,
          outcome: 'succeeded',
          providerSubscriptionId: data?.subscription_id ?? null,
          providerCustomerId: data?.customer_id ?? null,
          workspaceId: verifiedWorkspaceId(data?.custom_data, this.env.PADDLE_WEBHOOK_SECRET),
        };
      }
      case 'transaction.payment_failed': {
        const data = body.data as PaddleTransaction | undefined;
        return {
          kind: 'payment',
          providerEventId: eventId,
          eventType,
          outcome: 'failed',
          providerSubscriptionId: data?.subscription_id ?? null,
          providerCustomerId: data?.customer_id ?? null,
          workspaceId: verifiedWorkspaceId(data?.custom_data, this.env.PADDLE_WEBHOOK_SECRET),
        };
      }
      case 'adjustment.created': {
        // Refund / chargeback → downgrade at period end (documented in
        // billing.module.ts). Adjustments without a subscription link
        // (one-off transactions — we sell none) are ignored.
        const data = body.data as { action?: string; subscription_id?: string | null } | undefined;
        const action = data?.action;
        if ((action === 'refund' || action === 'chargeback') && data?.subscription_id) {
          return {
            kind: 'cancellation_scheduled',
            providerEventId: eventId,
            eventType,
            providerSubscriptionId: data.subscription_id,
            reason: action,
          };
        }
        return { kind: 'ignored', providerEventId: eventId, eventType };
      }
      default:
        return { kind: 'ignored', providerEventId: eventId, eventType };
    }
  }
}
