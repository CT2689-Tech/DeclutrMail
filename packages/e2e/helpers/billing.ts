import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { request } from '@playwright/test';

import { E2E_ENV } from './env';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Billing money-path helpers (D183 / D117 / D180) — TEST-ONLY builders
 * for Paddle-sandbox-format webhook payloads and their signatures.
 *
 * The signature scheme mirrors `apps/api/src/billing/paddle.adapter.ts`
 * `verifyWebhookSignature` EXACTLY: header `ts=<unix-s>;h1=<hex>`, where
 * `h1 = HMAC-SHA256(secret, "<ts>:" + rawBody)` and |now − ts| ≤ 5s.
 * The helpers only CONSTRUCT valid signatures with the secret the api
 * under test was booted with — verification code is never touched or
 * weakened. Byte-exactness: the payload is stringified ONCE; the same
 * string is signed and sent verbatim (`data: string` posts raw bytes).
 */

/** Storage state for the synthetic billing user (separate session). */
export const BILLING_STORAGE_STATE_PATH = path.join(HERE, '..', '.auth', 'billing-state.json');

/**
 * An EMPTY session — a defined value that overrides the inherited
 * `test.use({ storageState })` option (inside @playwright/test workers
 * even the global `request.newContext()` inherits it, and would ENOENT
 * on the not-yet-written state file).
 */
const EMPTY_STATE = { cookies: [], origins: [] };

/**
 * Guarantee the billing storage-state file exists (as an empty session)
 * so no context creation can ENOENT before the dev-login writes the
 * real one. Call FIRST in the spec's beforeAll.
 */
export function ensureBillingStorageState(): void {
  mkdirSync(path.dirname(BILLING_STORAGE_STATE_PATH), { recursive: true });
  if (!existsSync(BILLING_STORAGE_STATE_PATH)) {
    writeFileSync(BILLING_STORAGE_STATE_PATH, JSON.stringify(EMPTY_STATE));
  }
}

/** Env knobs for the billing spec (see the spec header's run recipe). */
export const BILLING_E2E_ENV = {
  /** Secret the api's PADDLE_WEBHOOK_SECRET was booted with. */
  webhookSecret: process.env.E2E_PADDLE_WEBHOOK_SECRET ?? '',
  /**
   * Paddle price id the api's BILLING_CATALOG_JSON maps to
   * `pro_monthly` — the webhook resolves the tier through the catalog,
   * so the two MUST match or the event is (correctly) ignored.
   */
  proMonthlyPriceId: process.env.E2E_PADDLE_PRICE_ID ?? 'pri_e2e_pro_monthly',
} as const;

/** `Paddle-Signature` header for `rawBody`, valid at `nowMs`. */
export function paddleSignatureHeader(rawBody: string, secret: string, nowMs = Date.now()): string {
  const ts = Math.floor(nowMs / 1000);
  const h1 = createHmac('sha256', secret).update(`${ts}:`).update(rawBody, 'utf8').digest('hex');
  return `ts=${ts};h1=${h1}`;
}

/** Per-run unique provider ids so dedup only fires when WE replay. */
export function paddleRunIds(): { eventId: string; subscriptionId: string; customerId: string } {
  const nonce = randomUUID().replaceAll('-', '').slice(0, 20);
  return {
    eventId: `evt_e2e_${nonce}`,
    subscriptionId: `sub_e2e_${nonce}`,
    customerId: `ctm_e2e_${nonce}`,
  };
}

/**
 * Paddle Billing (API v2) `subscription.activated` notification body —
 * the sandbox wire shape reduced to the fields the adapter's
 * `mapWebhookEvent` / `toNormalizedSubscription` read, plus the raw
 * audit scalars `projectWebhookPayload` picks (`occurred_at`,
 * `data.status`, period start). Attribution rides `custom_data.workspace_id`
 * (D117 overlay checkout custom data), validated server-side against
 * `workspaces`.
 */
export function paddleSubscriptionActivated(args: {
  eventId: string;
  subscriptionId: string;
  customerId: string;
  priceId: string;
  workspaceId: string;
  /** ISO timestamp the current period ends (drives /billing renewal). */
  periodEndsAt: string;
}): Record<string, unknown> {
  return {
    event_id: args.eventId,
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: args.subscriptionId,
      status: 'active',
      customer_id: args.customerId,
      items: [{ price: { id: args.priceId } }],
      current_billing_period: {
        starts_at: new Date().toISOString(),
        ends_at: args.periodEndsAt,
      },
      scheduled_change: null,
      canceled_at: null,
      paused_at: null,
      custom_data: { workspace_id: args.workspaceId },
    },
  };
}

/**
 * POST a payload to `/api/webhooks/billing/paddle`, signed with
 * `secret`. Signs at send time so the ±5s skew window always holds.
 * Never throws on HTTP error statuses — 401/503 are outcomes the spec
 * asserts (the tampered-signature leg EXPECTS 401).
 */
export async function postPaddleWebhook(input: {
  payload: Record<string, unknown>;
  secret: string;
}): Promise<{ status: number; body: unknown }> {
  const rawBody = JSON.stringify(input.payload);
  // Explicit empty session: the webhook is UNAUTHENTICATED by design —
  // the signature is the auth — and this also overrides the inherited
  // storageState option (see EMPTY_STATE).
  const ctx = await request.newContext({ baseURL: E2E_ENV.apiUrl, storageState: EMPTY_STATE });
  try {
    const res = await ctx.post('/api/webhooks/billing/paddle', {
      headers: {
        'Content-Type': 'application/json',
        'Paddle-Signature': paddleSignatureHeader(rawBody, input.secret),
      },
      data: rawBody,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null; // non-JSON error body — the status carries the assert
    }
    return { status: res.status(), body };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Dev-login as the synthetic billing user and persist its session as a
 * SEPARATE storage state (the suite-wide state from global-setup
 * belongs to `E2E_LOGIN_EMAIL`). Returns null on success, or a skip
 * reason when the stack can't authenticate this user — mirroring the
 * `requireLiveStack()` honesty contract.
 */
export async function loginBillingUser(email: string): Promise<string | null> {
  ensureBillingStorageState();
  // Fresh empty session — the login must never ride existing cookies.
  const ctx = await request.newContext({ baseURL: E2E_ENV.apiUrl, storageState: EMPTY_STATE });
  try {
    let status: number;
    try {
      const res = await ctx.get(`/api/auth/dev/login?email=${encodeURIComponent(email)}`, {
        maxRedirects: 0,
      });
      status = res.status();
    } catch (err) {
      return `api not reachable at ${E2E_ENV.apiUrl}: ${String(err)}`;
    }
    if (status === 404) {
      return (
        `dev login 404 for ${email} — is DEV_AUTH_ENABLED=true and does ` +
        `DEV_AUTH_EMAIL_PREFIX prefix-match this email (override via E2E_BILLING_LOGIN_EMAIL)?`
      );
    }
    if (status !== 302) {
      return `dev login failed (HTTP ${status}) for ${email}`;
    }
    const state = await ctx.storageState();
    if (!state.cookies.some((c) => c.name === 'dm_access')) {
      return 'dev login returned 302 but set no dm_access cookie — check the api logs';
    }
    await ctx.storageState({ path: BILLING_STORAGE_STATE_PATH });
    return null;
  } finally {
    await ctx.dispose();
  }
}
