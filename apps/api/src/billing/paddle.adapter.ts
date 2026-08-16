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
  FetchSubscriptionResult,
  NormalizedBillingEvent,
  NormalizedSubscription,
  PlanChangePreviewResult,
  PlanChangeResult,
  PlanChangeTiming,
  PaymentMethodSessionInput,
  PaymentMethodSessionResult,
  ProviderCancellationFacts,
  ProviderInvoice,
  ProviderInvoicePage,
  SignatureVerifyResult,
  SubscriptionSearchQuery,
  SubscriptionSearchResult,
} from './billing-provider.interface.js';

/** Default tolerated clock skew between Paddle's `ts` and now (seconds). */
const DEFAULT_MAX_SKEW_SEC = 5;

const API_TIMEOUT_MS = 10_000;

/**
 * How many billing documents one invoice read returns — Paddle's
 * per-page maximum.
 *
 * Deliberately a single page, not a paginated walk: this is a
 * customer-facing list on a page that must load fast, and a monthly
 * subscription accrues 12 rows a year, so 200 covers any real account.
 * The cap is nonetheless REPORTED rather than assumed away — when the
 * provider says there is more, `truncated` carries that to the UI
 * instead of a short list quietly reading as complete (no-silent-caps).
 */
const INVOICE_PAGE_SIZE = 200;

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
  /** Read by the D249 reconciliation GETs (claim-age matching). */
  created_at?: string | null;
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
  // D119 billing-document fields. `billed_at` is null on a transaction
  // that has not been billed yet (draft/ready), hence the `created_at`
  // fallback; `details.totals.grand_total` is the tax-INCLUSIVE total
  // in the currency's lowest unit, which is the number a customer
  // recognizes from their statement.
  id?: string;
  status?: string;
  billed_at?: string | null;
  created_at?: string | null;
  currency_code?: string | null;
  details?: { totals?: { grand_total?: string | null } | null } | null;
}

/**
 * Paddle transaction statuses → the normalized invoice status.
 *
 * `draft` is deliberately absent: a draft transaction is not a billing
 * document and never reaches the customer's list (it is filtered before
 * mapping). Anything Paddle adds later maps to `unknown` rather than
 * being rounded into `paid` — see `ProviderInvoice.status`.
 */
const PADDLE_INVOICE_STATUS: Readonly<Record<string, ProviderInvoice['status']>> = {
  paid: 'paid',
  completed: 'paid',
  billed: 'due',
  ready: 'due',
  past_due: 'due',
  canceled: 'canceled',
};

/**
 * Statuses for which Paddle can produce an invoice PDF. A transaction
 * that was never billed has no document to mint, so advertising one
 * would hand the FE a button whose only outcome is a 404.
 */
const PADDLE_DOCUMENT_STATUSES = new Set(['billed', 'paid', 'completed', 'past_due']);

/**
 * Adjustment statuses that mean UNDONE. Paddle's four are `approved`,
 * `pending_approval`, `rejected` and `reversed`; these two are the ones
 * that void an adjustment, and the distinction from `pending_approval`
 * is the whole point — undone is a decision, pending is its absence.
 */
const UNDONE_STATUSES = new Set(['rejected', 'reversed']);

/** The adjustment fields that decide whether a plan ends (API v2). */
interface PaddleAdjustment {
  action?: string;
  status?: string;
  subscription_id?: string | null;
  items?: Array<{ type?: string }>;
}

/**
 * Does this refund/chargeback END the subscription, or is it a
 * part-refund that leaves it running?
 *
 * A PARTIAL refund is not an exit. Paddle fires the same event for "here
 * is $2 back for the trouble" as for "here is your money back", and
 * treating both as an exit ended the plan of a customer who was being
 * apologised to.
 *
 * Keyed on the ITEM types, not the adjustment's own `type`: Paddle
 * defaults `type` to `partial`, and a dashboard full-amount refund can
 * arrive as `partial` with every item marked `full`. Any item explicitly
 * marked `partial` is the one shape that can only mean a part-refund.
 * Everything else — including a payload we cannot read — revokes,
 * because failing to revoke a real refund is the worse error of the two.
 * Chargebacks are never filtered: Paddle raises them itself.
 *
 * ONE function because two callers ask this question — the webhook
 * mapping and `providerCancellationFacts`. Mirrored, they would drift,
 * and the drift would read as "the refund ended their plan but we never
 * stopped billing them".
 */
function endsSubscription(adjustment: PaddleAdjustment): boolean {
  if (adjustment.action === 'chargeback') return true;
  if (adjustment.action !== 'refund') return false;
  return !(adjustment.items ?? []).some((i) => i?.type === 'partial');
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
function mapStatus(paddleStatus: string): SubscriptionStatus | null {
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
      // Unrecognized status → null (the event becomes `ignored`, no
      // state write). Mapping an unknown status to `canceled`
      // manufactured a TERMINAL state from a non-terminal input, and
      // the terminal-canceled floor then locked the subscription out of
      // reactivating. Leaving state untouched self-heals on the next
      // recognized event.
      return null;
  }
}

/** null when the provider status is unrecognized (caller ignores it). */
function toNormalizedSubscription(
  sub: PaddleSubscription,
  webhookSecret: string | undefined,
): NormalizedSubscription | null {
  const priceId = sub.items?.[0]?.price?.id;
  if (!sub.id || !priceId) {
    throw new Error('Paddle subscription payload missing id or items[0].price.id');
  }
  const scheduledCancel = sub.scheduled_change?.action === 'cancel';
  const status = mapStatus(sub.status);
  if (status === null) return null;
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
            'Paddle-Version': '1',
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

  /**
   * PATCH /subscriptions/{id} with `scheduled_change: null` — Paddle's
   * documented way to revoke a pending cancel (or pause/resume) without
   * touching price, period or status.
   *
   * Not the `/resume` endpoint: that one is for PAUSED subscriptions
   * and 400s on an active-but-cancelling row. A cancelling subscription
   * is still `active` — the cancel lives entirely in `scheduled_change`
   * — so clearing that field is the whole operation.
   */
  async clearScheduledCancellation(providerSubscriptionId: string): Promise<void> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({ scheduled_change: null }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.clear_scheduled_cancellation.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `paddle.clear_scheduled_cancellation.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
  }

  /**
   * POST /subscriptions/{id}/pause — immediate, with an explicit
   * `resume_at` so the pause self-terminates (D118's 30 days). Paddle
   * treats an absent `resume_at` as indefinite, which would strand a
   * user who never comes back to click Resume.
   */
  async pauseSubscription(providerSubscriptionId: string, resumeAt: string): Promise<void> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/pause`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({ effective_from: 'immediately', resume_at: resumeAt }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.pause.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(`paddle.pause.failed sub=${providerSubscriptionId} status=${res.status}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
  }

  /**
   * PATCH /subscriptions/{id} — swap the single line item to the new
   * price. Upgrades use `prorated_immediately`; scheduled downgrades use
   * `do_not_bill` and pin the existing renewal date. The webhook
   * projector masks that provider-side item swap until period end.
   */
  async changePlan(
    providerSubscriptionId: string,
    providerPriceId: string,
    timing: PlanChangeTiming,
  ): Promise<PlanChangeResult> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({
            items: [{ price_id: providerPriceId, quantity: 1 }],
            proration_billing_mode:
              timing.kind === 'immediate_prorated' ? 'prorated_immediately' : 'do_not_bill',
            ...(timing.kind === 'next_period_no_proration'
              ? { next_billed_at: timing.effectiveAt }
              : {}),
          }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.change_plan.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `paddle.change_plan.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({
        code: 'BILLING_PROVIDER_ERROR',
        ...(res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
          ? { details: { providerOutcome: 'definitive' } }
          : {}),
      });
    }
    // A successful PATCH returns the updated subscription. This lets
    // the service reconcile a restore even if its webhook is delayed
    // or lost. Malformed success bodies remain explicitly unconfirmed.
    try {
      const body = (await res.json()) as {
        data?: {
          updated_at?: unknown;
          items?: Array<{ price?: { id?: unknown } }>;
        };
      };
      const returnedPriceId = body.data?.items?.[0]?.price?.id;
      const updatedAt = body.data?.updated_at;
      return {
        providerPriceId: typeof returnedPriceId === 'string' ? returnedPriceId : null,
        providerUpdatedAt: typeof updatedAt === 'string' ? updatedAt : null,
      };
    } catch {
      return { providerPriceId: null, providerUpdatedAt: null };
    }
  }

  /**
   * PATCH /subscriptions/{id}/preview — the same payload as changePlan
   * against Paddle's read-only preview endpoint. `update_summary.result`
   * is the provider's own "what happens now" line (charge vs credit, in
   * the currency's lowest unit); `next_billed_at` is the post-change
   * renewal. Nothing is applied. Malformed summaries return null fields
   * — the caller must fall back to generic copy, never invent a number.
   */
  async previewPlanChange(
    providerSubscriptionId: string,
    providerPriceId: string,
    timing: PlanChangeTiming,
  ): Promise<PlanChangePreviewResult> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/preview`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({
            items: [{ price_id: providerPriceId, quantity: 1 }],
            proration_billing_mode:
              timing.kind === 'immediate_prorated' ? 'prorated_immediately' : 'do_not_bill',
            ...(timing.kind === 'next_period_no_proration'
              ? { next_billed_at: timing.effectiveAt }
              : {}),
          }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.preview_plan_change.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `paddle.preview_plan_change.failed sub=${providerSubscriptionId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    try {
      const body = (await res.json()) as {
        data?: {
          next_billed_at?: unknown;
          update_summary?: {
            result?: { action?: unknown; amount?: unknown; currency_code?: unknown };
          };
        };
      };
      const r = body.data?.update_summary?.result;
      const nextBilledAt = body.data?.next_billed_at;
      return {
        result:
          r &&
          (r.action === 'charge' || r.action === 'credit') &&
          typeof r.amount === 'string' &&
          typeof r.currency_code === 'string'
            ? { action: r.action, amount: r.amount, currencyCode: r.currency_code }
            : null,
        nextBilledAt: typeof nextBilledAt === 'string' ? nextBilledAt : null,
      };
    } catch {
      return { result: null, nextBilledAt: null };
    }
  }

  /** POST /subscriptions/{id}/resume — immediately (D118 pause exit). */
  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/subscriptions/${encodeURIComponent(providerSubscriptionId)}/resume`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({
            effective_from: 'immediately',
            on_resume: 'continue_existing_billing_period',
          }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.resume.network_error sub=${providerSubscriptionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      let providerCode: string | null = null;
      try {
        const body = (await res.clone().json()) as { error?: { code?: unknown } };
        providerCode = typeof body.error?.code === 'string' ? body.error.code : null;
      } catch {
        // Non-JSON provider error; the generic mapping below remains truthful.
      }
      if (providerCode === 'subscription_continuing_existing_billing_period_not_allowed') {
        throw new AppException({ code: 'RESUME_PERIOD_ENDED' });
      }
      this.logger.error(`paddle.resume.failed sub=${providerSubscriptionId} status=${res.status}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
  }

  /**
   * Authenticated GET for this adapter's read-only calls — the D249
   * reconciliation reads and the D119 billing-artifact reads
   * (transactions, invoice documents, portal sessions). Returns the
   * parsed body, `null` on 404 (a read miss is data, not an error),
   * and throws `BILLING_PROVIDER_ERROR` on network failure or any
   * other non-2xx.
   *
   * What the throw MEANS is the caller's to decide, and the two
   * families decide differently: the reconciler maps it to
   * `provider_unavailable` and writes nothing, while the invoice list
   * reports the rail as unavailable rather than serving a silently
   * short list. Neither may treat it as "no rows".
   */
  private async authedGet(path: string, label: string): Promise<unknown | null> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Paddle-Version': '1' },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `paddle.api_read.network_error ${label} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.error(`paddle.api_read.failed ${label} status=${res.status}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    return res.json();
  }

  /** D249 — GET /subscriptions/{id}. See FetchSubscriptionResult. */
  async fetchSubscription(providerSubscriptionId: string): Promise<FetchSubscriptionResult> {
    const body = await this.authedGet(
      `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      `sub=${providerSubscriptionId}`,
    );
    if (body === null) return { kind: 'not_found' };
    const sub = (body as { data?: PaddleSubscription }).data;
    if (!sub?.id) {
      this.logger.error(`paddle.api_read.malformed sub=${providerSubscriptionId}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const normalized = toNormalizedSubscription(sub, this.env.PADDLE_WEBHOOK_SECRET);
    // Exists in a status we do not map — REAL provider activity, never
    // to be reported as "not found" (the 3DS/pre-grant window).
    if (normalized === null) return { kind: 'found_unmapped', providerStatus: sub.status };
    return {
      kind: 'found',
      subscription: { ...normalized, providerCreatedAt: sub.created_at ?? null },
    };
  }

  /**
   * Paddle's own answer to "is there a settled reason this subscription
   * must not renew?" — the gate on the one outbound cancel we send
   * (`BillingReconciliationService.enforceLocalVerdicts`).
   *
   * Our `cancel_source` marker is written from `adjustment.created`,
   * which on a LIVE account fires while the refund is still
   * `pending_approval`. Cancelling on that would end a subscription
   * Paddle may go on to reject the refund for. Sandbox auto-approves, so
   * no amount of testing here would have shown it.
   *
   * `refuted` is the same read pointed the other way, and it is what
   * makes the correction possible WITHOUT depending on a webhook
   * subscription: when Paddle's records positively contradict our marker
   * — the refund was rejected, the chargeback reversed — the verdict is
   * void and the caller lifts it. Without that, a live refund Paddle
   * rejects leaves a PAYING customer on Free with every self-serve exit
   * blocked (Codex stop-review, 2026-07-31).
   */
  async providerCancellationFacts(
    providerSubscriptionId: string,
  ): Promise<ProviderCancellationFacts | null> {
    // Paddle caps a list page, so page one alone answered a different
    // question than the one asked: a subscription with more adjustments
    // than fit could report a settled refund while a LIVE chargeback sat
    // on page two — and D253 makes that answer the gate on whether a
    // refunded customer may buy again. Walk `meta.pagination` to the end.
    // The cap bounds a pathological listing; hitting it reports UNREAD,
    // because a partial scan is this same bug in a subtler form.
    const MAX_PAGES = 10;
    const rows: PaddleAdjustment[] = [];
    let path = `/adjustments?subscription_id=${encodeURIComponent(providerSubscriptionId)}&per_page=50`;

    for (let page = 0; ; page += 1) {
      if (page === MAX_PAGES) {
        this.logger.warn(
          `paddle.cancellation_facts.page_cap sub=${providerSubscriptionId} pages=${MAX_PAGES} rows=${rows.length} — adjustments listing exceeds the page cap; reported UNREAD, raise MAX_PAGES`,
        );
        return null;
      }
      let body: unknown | null;
      try {
        body = await this.authedGet(path, `adjustments sub=${providerSubscriptionId}`);
      } catch {
        // Already logged by authedGet. A read we could not make is
        // never grounds for an outbound write.
        return null;
      }
      if (body === null) return null;
      const pageRows = (body as { data?: PaddleAdjustment[] }).data;
      if (!Array.isArray(pageRows)) return null;
      rows.push(...pageRows);

      const pagination = (body as { meta?: { pagination?: { has_more?: boolean; next?: string } } })
        .meta?.pagination;
      // `next` is populated on the LAST page too, so `has_more` is the
      // only honest terminator — walking while `next` exists would run
      // every healthy read to the cap and report it unread.
      if (pagination?.has_more !== true) break;
      if (typeof pagination.next !== 'string' || !URL.canParse(pagination.next)) {
        this.logger.warn(
          `paddle.cancellation_facts.next_unreadable sub=${providerSubscriptionId} pages=${page + 1} — has_more with no usable next URL; reported UNREAD`,
        );
        return null;
      }
      // Paddle's cursor, our host: keep only path + query so a
      // provider-supplied origin can never redirect an API-key read.
      const next = new URL(pagination.next);
      path = `${next.pathname}${next.search}`;
    }

    // A chargeback IS the settled event — the funds are already gone and
    // Paddle raised it, not us, so there is nothing left to approve. Only
    // the adjustment's OWN status can undo one: a won dispute marks it
    // `reversed`.
    //
    // An earlier revision instead scanned for any `chargeback_reverse`
    // row and suppressed every chargeback when it found one — so a
    // subscription that won dispute A and then genuinely lost dispute B
    // reported `none` forever, and Paddle kept billing a customer whose
    // entitlement we had ended (Codex stop-review, 2026-07-31). Reading
    // each adjustment's own status needs no cross-referencing and cannot
    // mis-pair two disputes.
    const settledChargeback = rows.some(
      (a) => a.action === 'chargeback' && !UNDONE_STATUSES.has(a.status ?? ''),
    );
    // Refunds need Paddle's approval, and only a full one is an exit.
    const settledRefund = rows.some(
      (a) => a.action === 'refund' && a.status === 'approved' && endsSubscription(a),
    );

    // "Paddle SAYS NO" is not the same as "not yet", and the two verdicts
    // are independent — a contradiction of one says nothing about the
    // other. Both `rejected` and `reversed` undo an adjustment, and
    // `UNDONE_STATUSES` is shared across both actions because each can
    // only ever reach one of them. A refund still `pending_approval` is
    // in neither set.
    //
    // Which status belongs to which action, per Paddle's docs: a refund
    // goes `pending_approval` → `approved` | `rejected`, both terminal.
    // `reversed` is set only when a `chargeback_reversal` or
    // `credit_reversal` adjustment is created for that adjustment, so it
    // reaches chargebacks and credits and never refunds.
    //
    // An earlier version of this comment justified the shared set by
    // claiming an "approved-then-reversed refund" had counted as neither
    // settled nor refuted. That state cannot occur, and the false
    // explanation was not harmless — it was later read as evidence that a
    // settled refund is revocable, which sent a design building a support
    // path for an impossible case (D253, 2026-08-13). The SET is correct
    // as a superset; only the reasoning was wrong.
    return {
      settled: settledChargeback ? 'chargeback' : settledRefund ? 'refund' : null,
      refuted: {
        refund: rows.some(
          (a) =>
            a.action === 'refund' && UNDONE_STATUSES.has(a.status ?? '') && endsSubscription(a),
        ),
        chargeback: rows.some(
          (a) => a.action === 'chargeback' && UNDONE_STATUSES.has(a.status ?? ''),
        ),
      },
    };
  }

  /**
   * D249 — customers by exact OWNER email, then their subscriptions.
   * Two GETs. Known limit: the overlay lets the payer type ANY email,
   * so an alias-typed checkout creates a customer this search cannot
   * see — the signed custom_data / claim paths are what grant those;
   * this search is the claimless backstop, not the primary.
   */
  async searchSubscriptions(query: SubscriptionSearchQuery): Promise<SubscriptionSearchResult> {
    const customersBody = await this.authedGet(
      `/customers?email=${encodeURIComponent(query.email)}`,
      `email_search`,
    );
    const customers = (customersBody as { data?: Array<{ id?: string }> } | null)?.data ?? [];
    const ids = customers
      .map((c) => c.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) return { subscriptions: [], inProgress: 0 };
    const subsBody = await this.authedGet(
      `/subscriptions?customer_id=${encodeURIComponent(ids.join(','))}&per_page=50`,
      `subs_by_customer`,
    );
    const subs = (subsBody as { data?: PaddleSubscription[] } | null)?.data ?? [];
    const result: SubscriptionSearchResult = { subscriptions: [], inProgress: 0 };
    for (const sub of subs) {
      if (!sub?.id) continue;
      const mapped = toNormalizedSubscription(sub, this.env.PADDLE_WEBHOOK_SECRET);
      if (mapped !== null) {
        result.subscriptions.push({ ...mapped, providerCreatedAt: sub.created_at ?? null });
      } else {
        // Unmapped status on the customer's own subscription — real
        // pre-grant activity, reported so it never reads "no payment".
        result.inProgress += 1;
      }
    }
    return result;
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
      case 'subscription.past_due': {
        const subscription = toNormalizedSubscription(
          body.data as unknown as PaddleSubscription,
          this.env.PADDLE_WEBHOOK_SECRET,
        );
        if (subscription === null) {
          // Unrecognized status — do not drive a state change.
          return { kind: 'ignored', providerEventId: eventId, eventType };
        }
        return { kind: 'subscription', providerEventId: eventId, eventType, subscription };
      }
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
        // Refund / chargeback → entitlement ends (documented in
        // billing.module.ts). Adjustments without a subscription link
        // (one-off transactions — we sell none) are ignored.
        const data = body.data as PaddleAdjustment | undefined;
        const action = data?.action;
        // The dispute was WON: Paddle clawed the money back from the bank
        // and the verdict that revoked this customer is void. Without
        // this they stay locked out forever while still paying — the
        // harshest thing this system can do to someone (founder decision,
        // 2026-07-31). Only chargebacks reverse; a refund is a decision
        // we made and does not un-happen.
        if (action === 'chargeback_reverse' && data?.subscription_id) {
          return {
            kind: 'cancellation_revoked',
            providerEventId: eventId,
            eventType,
            providerSubscriptionId: data.subscription_id,
            reason: 'chargeback_reverse',
          };
        }
        if ((action === 'refund' || action === 'chargeback') && data?.subscription_id) {
          if (!endsSubscription(data)) {
            this.logger.warn(
              `billing.paddle.partial_refund_ignored sub=${data.subscription_id} event=${eventId} — entitlement left intact; cancel in the Paddle dashboard if this refund was meant to end the plan`,
            );
            return { kind: 'ignored', providerEventId: eventId, eventType };
          }
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

  /**
   * D119 / ADR-0035 — Paddle owns the payment instrument, so the update
   * happens on Paddle's own hosted surface, not ours.
   *
   * `POST /customers/{id}/portal-sessions` mints a customer-scoped,
   * short-lived session. `subscription_ids` asks Paddle for the
   * per-subscription deep links, so the customer lands on the card form
   * for THIS subscription instead of a portal overview they then have
   * to navigate. The deep link is preferred; the general overview is
   * the fallback when Paddle returns a session without one.
   *
   * Never cached, never persisted (ADR-0035 §4) — the URL authenticates
   * the bearer, so a stored copy is a credential.
   */
  async paymentMethodSession(
    input: PaymentMethodSessionInput,
  ): Promise<PaymentMethodSessionResult> {
    const apiKey = this.env.PADDLE_API_KEY;
    if (!apiKey) {
      throw new AppException({ code: 'BILLING_NOT_PROVISIONED' });
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/customers/${encodeURIComponent(input.providerCustomerId)}/portal-sessions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Paddle-Version': '1',
          },
          body: JSON.stringify({ subscription_ids: [input.providerSubscriptionId] }),
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `paddle.portal_session.network_error customer=${input.providerCustomerId} err=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    if (!res.ok) {
      this.logger.error(
        `paddle.portal_session.failed customer=${input.providerCustomerId} status=${res.status}`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const body = (await res.json()) as {
      data?: {
        urls?: {
          general?: { overview?: string | null } | null;
          subscriptions?: Array<{
            id?: string;
            update_subscription_payment_method?: string | null;
          }> | null;
        } | null;
      };
    };
    const urls = body.data?.urls;
    const deepLink = urls?.subscriptions?.find(
      (s) => s.id === input.providerSubscriptionId,
    )?.update_subscription_payment_method;
    const url = deepLink ?? urls?.general?.overview ?? null;
    if (!url) {
      // A 200 with no usable URL is a malformed answer, not a missing
      // capability: Paddle DOES support this. Reporting `unsupported`
      // here would tell the customer to email support about a rail that
      // works, so it throws and the FE renders the error state.
      this.logger.error(
        `paddle.portal_session.malformed customer=${input.providerCustomerId} — 200 with no portal URL`,
      );
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    return { kind: 'url', url };
  }

  /**
   * D119 / ADR-0035 — the subscription's billed transactions, newest
   * first. Proxied on read; nothing is persisted.
   *
   * Drafts are filtered out rather than mapped: a draft transaction is
   * an internal artifact, not a billing document, and listing one would
   * show the customer a charge that has not happened.
   */
  async listInvoices(providerSubscriptionId: string): Promise<ProviderInvoicePage> {
    const body = await this.authedGet(
      `/transactions?subscription_id=${encodeURIComponent(providerSubscriptionId)}&per_page=${INVOICE_PAGE_SIZE}&order_by=billed_at[DESC]`,
      `transactions sub=${providerSubscriptionId}`,
    );
    // 404 on the collection means the subscription is unknown to
    // Paddle — no rows, which is data, not a failure.
    if (body === null) return { invoices: [], truncated: false, omitted: 0 };
    const rows = (body as { data?: PaddleTransaction[] }).data;
    if (!Array.isArray(rows)) {
      this.logger.error(`paddle.transactions.malformed sub=${providerSubscriptionId}`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    const invoices: ProviderInvoice[] = [];
    let omitted = 0;
    for (const row of rows) {
      const status = row.status ?? '';
      if (!row.id || status === 'draft') continue;
      const issuedAt = row.billed_at ?? row.created_at ?? null;
      const amount = row.details?.totals?.grand_total ?? null;
      const currencyCode = row.currency_code ?? null;
      // Every displayed row must carry a real date, amount and
      // currency. A row missing any of them cannot be rendered without
      // inventing one, so it is dropped and logged rather than shown
      // with a blank or a zero (never-fabricate).
      if (!issuedAt || !amount || !currencyCode) {
        this.logger.warn(
          `paddle.transactions.row_incomplete sub=${providerSubscriptionId} txn=${row.id} — dropped from the invoice list`,
        );
        omitted += 1;
        continue;
      }
      invoices.push({
        id: row.id,
        issuedAt,
        amount,
        currencyCode,
        status: PADDLE_INVOICE_STATUS[status] ?? 'unknown',
        // Paddle's invoice is a signed PDF minted per click, not a
        // stable page — so there is no hosted URL to hand out here.
        hostedUrl: null,
        documentAvailable: PADDLE_DOCUMENT_STATUSES.has(status),
      });
    }
    // Paddle signals another page by returning a `next` link. Absent
    // meta is read as "no more" rather than as truncation: claiming a
    // hidden remainder we cannot see would be its own fabrication.
    const hasMore = Boolean(
      (body as { meta?: { pagination?: { has_more?: boolean } | null } }).meta?.pagination
        ?.has_more,
    );
    return { invoices, truncated: hasMore, omitted };
  }

  /**
   * D119 / ADR-0035 — `GET /transactions/{id}/invoice` returns a SIGNED,
   * short-lived link to Paddle's own PDF. Minted per click and handed
   * straight to the browser; never stored, never cached.
   *
   * Null on 404: the transaction exists but has no document (the
   * not-yet-billed case the `documentAvailable` flag already filters,
   * kept here because the flag is advisory and the click can race a
   * status change).
   */
  async invoiceDocumentUrl(invoiceId: string): Promise<string | null> {
    const body = await this.authedGet(
      `/transactions/${encodeURIComponent(invoiceId)}/invoice`,
      `invoice txn=${invoiceId}`,
    );
    if (body === null) return null;
    const url = (body as { data?: { url?: string | null } }).data?.url ?? null;
    if (!url) {
      this.logger.error(`paddle.invoice_document.malformed txn=${invoiceId} — 200 with no url`);
      throw new AppException({ code: 'BILLING_PROVIDER_ERROR' });
    }
    return url;
  }
}
