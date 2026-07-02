import { readFileSync } from 'node:fs';

import { request, type APIRequestContext } from '@playwright/test';

import { E2E_ENV } from './env';

/** D202 envelope shape — every api response unwraps from `data`. */
interface Envelope<T> {
  data: T;
}

/**
 * Authenticated api client for spec setup/teardown — rides the SAME
 * session the browser uses (the storageState written by global-setup).
 * Mutating calls attach the `X-CSRF-Token` double-submit header read
 * from the persisted `dm_csrf` cookie (mirrors `apps/web/src/lib/api/client.ts`).
 *
 * Specs that authenticate as a DIFFERENT user (billing-upgrade's
 * synthetic workspace) pass their own storage-state path; the default
 * stays the suite-wide state global-setup writes.
 */
export class ApiClient {
  private ctx: APIRequestContext | null = null;

  constructor(private readonly storageStatePath: string = E2E_ENV.storageStatePath) {}

  private csrfToken(): string {
    const state = JSON.parse(readFileSync(this.storageStatePath, 'utf8')) as {
      cookies: { name: string; value: string }[];
    };
    const csrf = state.cookies.find((c) => c.name === 'dm_csrf');
    if (!csrf) throw new Error('No dm_csrf cookie in storage state — re-run global setup.');
    return csrf.value;
  }

  private async context(): Promise<APIRequestContext> {
    if (!this.ctx) {
      this.ctx = await request.newContext({
        baseURL: E2E_ENV.apiUrl,
        storageState: this.storageStatePath,
      });
    }
    return this.ctx;
  }

  /**
   * Generous request timeout: heavyweight reads (triage queue impact
   * scoring over thousands of senders) can crawl on a loaded dev
   * machine — the UI specs already tolerate slow responses, so the
   * setup/teardown client must too.
   */
  private static readonly TIMEOUT_MS = 60_000;

  async get<T>(path: string): Promise<T> {
    const ctx = await this.context();
    const res = await ctx.get(path, { timeout: ApiClient.TIMEOUT_MS });
    if (!res.ok()) {
      throw new Error(`GET ${path} → HTTP ${res.status()}: ${await res.text()}`);
    }
    const body = (await res.json()) as Envelope<T>;
    return body.data;
  }

  /**
   * Raw GET — status + parsed body, NEVER throwing on an HTTP error
   * status. For asserting DESIGNED 4xx/5xx states (the 402 entitlement
   * gates, 503 BILLING_DISABLED) where `get()`'s throw-on-!ok is wrong.
   */
  async getRaw(path: string): Promise<{ status: number; body: unknown }> {
    const ctx = await this.context();
    const res = await ctx.get(path, { timeout: ApiClient.TIMEOUT_MS });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null; // non-JSON body — the status alone carries the assert
    }
    return { status: res.status(), body };
  }

  async post<T>(path: string, json?: unknown): Promise<T> {
    const ctx = await this.context();
    const res = await ctx.post(path, {
      headers: { 'X-CSRF-Token': this.csrfToken() },
      timeout: ApiClient.TIMEOUT_MS,
      ...(json === undefined ? {} : { data: json }),
    });
    if (!res.ok()) {
      throw new Error(`POST ${path} → HTTP ${res.status()}: ${await res.text()}`);
    }
    const body = (await res.json()) as Envelope<T>;
    return body.data;
  }

  async dispose(): Promise<void> {
    if (this.ctx) {
      await this.ctx.dispose();
      this.ctx = null;
    }
  }
}

/** Shape of `GET /api/auth/me` the specs care about. */
export interface Me {
  activeMailboxId: string | null;
}

/** One triage queue row (subset of the wire shape the specs use). */
export interface TriageQueueRow {
  id: string;
  senderId: string;
  senderName: string;
  senderDomain: string;
  protectionReason: string | null;
}

/** Composite preview counts (subset) — `GET /api/actions/preview`. */
export interface CompositePreview {
  counts: { all: number };
  protected: boolean;
}

/**
 * Probe the live stack: api reachable + session valid + an active
 * mailbox selected. Returns the active mailbox id, or `null` with a
 * reason when any leg is missing — callers `test.skip()` on null so
 * the suite stays honest in environments without the live mailbox
 * (e.g. a future CI without Gmail).
 */
export async function requireLiveStack(
  api: ApiClient,
): Promise<{ mailboxId: string } | { mailboxId: null; reason: string }> {
  let me: Me;
  try {
    me = await api.get<Me>('/api/auth/me');
  } catch (err) {
    return {
      mailboxId: null,
      reason: `api not reachable / session invalid at ${E2E_ENV.apiUrl}: ${String(err)}`,
    };
  }
  if (!me.activeMailboxId) {
    return { mailboxId: null, reason: 'no active mailbox on the dev-login user' };
  }
  return { mailboxId: me.activeMailboxId };
}
