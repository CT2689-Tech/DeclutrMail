import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { and, eq, sql } from 'drizzle-orm';
import type { JobsOptions } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { actionJobs, activityLog, senderPolicies, senders } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { ActionsUnsubscribeExecutedPayloadSchema, TOPICS } from '@declutrmail/events';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { OutboxPublisher } from './outbox-publisher.js';
import { TransientError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/**
 * UnsubExecutionWorker (D9 Wave 2) — executes RFC 8058 one-click
 * unsubscribes for senders whose recorded intent
 * (`sender_policies.policy_type='unsubscribe'`) targets a
 * `unsubscribe_method='one_click'` sender.
 *
 * The request is exactly what RFC 8058 §3.2 prescribes:
 *
 *   POST <https unsubscribe_url>
 *   Content-Type: application/x-www-form-urlencoded
 *   List-Unsubscribe=One-Click
 *
 * No auth headers, no cookies, no redirects followed. The outcome is
 * recorded HONESTLY (D226 — no fake success):
 *
 *   - 2xx        → 'done'      (the list processor accepted)
 *   - 3xx        → 'ambiguous' (redirects are never followed — SSRF
 *                  posture — so the result is unknown; it may have
 *                  worked)
 *   - 4xx / 5xx  → 'failed'    (the list processor said no; retrying
 *                  an identical POST only spams them — terminal on
 *                  the FIRST response)
 *   - network    → ONE retry (UNSUB_MAX_ATTEMPTS=2), then 'failed'
 *
 * D58: a delivered network unsubscribe is ONE-WAY. No undo token is
 * ever issued for the unsub itself (a paired archive keeps its own).
 *
 * SSRF hardening (the URL comes from a third-party email header):
 *   - https scheme required (plain http only behind
 *     `allowInsecureTargets`, which the composition root refuses to
 *     enable when NODE_ENV=production).
 *   - Hostname resolved up front; the attempt is refused if ANY
 *     resolved address is private / link-local / loopback (RFC 1918,
 *     127/8, 169.254/16 — incl. the GCP metadata server —, 0/8, ::1,
 *     fc00::/7, fe80::/10, v4-mapped forms). `allowInsecureTargets`
 *     exempts LOOPBACK only (so local smoke can hit a 127.0.0.1
 *     fake), never the broader private ranges.
 *   - Redirects are never followed (cross-origin or otherwise) — the
 *     http port uses `redirect: 'manual'` and a 3xx is terminal
 *     'ambiguous'.
 *   - Known DNS-rebinding caveat: the pre-flight resolve and fetch's
 *     own resolve are two lookups. Accepted for this surface — the
 *     response body is never read, no credentials are attached, and
 *     the request shape is a fixed 26-byte form POST.
 *
 * Privacy (D7, D228): the worker reads only ids + the stored
 * `unsubscribe_url` (an allowlisted-header derivative, ADR-0004). The
 * outbox event carries ids + outcome + HTTP status — never the URL.
 */

/** Queue + job name for the unsubscribe execution pipeline. */
export const UNSUB_EXECUTION_QUEUE = 'unsub-execution';
export const UNSUB_EXECUTION_JOB = 'unsub-execution';

/**
 * Attempt budget: the first attempt + at most ONE retry, and the retry
 * is for NETWORK errors only (timeout / connection refused / DNS). Any
 * HTTP response from the target — 2xx/3xx/4xx/5xx — is terminal on
 * attempt 1. Deliberately tighter than `perMailboxPolicy.maxAttempts`
 * (5): re-POSTing an unsubscribe a list processor already answered is
 * spam, not resilience. Enforced in-band (the worker checks
 * `ctx.attempt` against THIS constant), with `attempts: 2` on the
 * BullMQ job options so the queue never schedules a third attempt.
 */
export const UNSUB_MAX_ATTEMPTS = 2;

/** Wall-clock cap for the one-click POST. */
export const UNSUB_REQUEST_TIMEOUT_MS = 10_000;

/** One unsubscribe-execution job. */
export interface UnsubExecutionJobData {
  /** The execution's `action_jobs.id` (verb='unsubscribe'). */
  actionId: string;
  mailboxAccountId: string;
  idempotencyKey: string;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface UnsubExecutionResult {
  outcome: 'done' | 'failed' | 'ambiguous';
  httpStatus: number | null;
  alreadyDone: boolean;
}

/** Response shape the worker classifies. Status only — the body is never read. */
export interface UnsubHttpResponse {
  status: number;
}

/**
 * The outbound HTTP seam — injectable so tests run against a fake and
 * no development environment ever makes a real opt-out call. The
 * implementation MUST NOT follow redirects, attach credentials, or
 * read the response body.
 */
export interface UnsubHttpPort {
  postOneClick(url: string, opts: { timeoutMs: number }): Promise<UnsubHttpResponse>;
}

/**
 * Production adapter — native fetch, `redirect: 'manual'` (a 3xx comes
 * back as-is and classifies 'ambiguous'), abort at `timeoutMs`. fetch
 * in Node attaches no cookies and we set no auth header; the response
 * body is never consumed.
 */
export const FETCH_UNSUB_HTTP_PORT: UnsubHttpPort = {
  async postOneClick(url, opts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    // Release the connection without reading the payload (D7 posture:
    // we never ingest third-party response content).
    await res.body?.cancel();
    return { status: res.status };
  },
};

/** Resolver seam — `node:dns` lookup in production; injectable for tests. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const DNS_RESOLVE_HOST: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

type WorkerDb = PostgresJsDatabase<typeof schema>;

export interface UnsubExecutionDeps {
  db: WorkerDb;
  http: UnsubHttpPort;
  outbox: OutboxPublisher;
  /**
   * Local-smoke escape hatch (`UNSUB_ALLOW_INSECURE_TARGETS=true`):
   * permits the `http:` scheme and LOOPBACK addresses so a localhost
   * fake target can be exercised. The composition root hard-refuses to
   * boot with this flag in production (mirrors the DEV_AUTH_ENABLED
   * refusal in apps/api/src/main.ts); the worker additionally never
   * honors it when NODE_ENV=production (defense in depth).
   */
  allowInsecureTargets?: boolean;
  /** DNS seam for the SSRF pre-flight. Defaults to `node:dns` lookup. */
  resolveHost?: ResolveHost;
}

/** BullMQ options — `jobId` = idempotency key; attempts = the unsub budget. */
export function unsubExecutionJobOptions(idempotencyKey: string): JobsOptions {
  return {
    jobId: idempotencyKey,
    attempts: UNSUB_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: false,
  };
}

/** Terminal outcome + the classification detail that lands in `error_code`. */
interface OutcomeRecord {
  outcome: 'done' | 'failed' | 'ambiguous';
  httpStatus: number | null;
  /**
   * `action_jobs.error_code` value. NULL for 'done'. The FE poll reads
   * this to distinguish ambiguous from failed (status 'failed' both).
   */
  errorCode: string | null;
}

export class UnsubExecutionWorker extends BaseDeclutrWorker<
  UnsubExecutionJobData,
  UnsubExecutionResult
> {
  readonly workerName = 'UnsubExecutionWorker';
  readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: UnsubExecutionDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: UnsubExecutionJobData): string {
    return payload.idempotencyKey;
  }

  async processJob(
    payload: UnsubExecutionJobData,
    ctx: WorkerContext,
  ): Promise<UnsubExecutionResult> {
    const { db } = this.deps;

    const [job] = await db
      .select()
      .from(actionJobs)
      .where(eq(actionJobs.id, payload.actionId))
      .limit(1);
    if (!job) {
      // Row is written before enqueue; absence is malformed — no retry.
      throw new ValidationError(`action_jobs row ${payload.actionId} not found`);
    }
    if (job.status === 'done' || job.status === 'failed') {
      // Idempotent replay — the terminal tx already committed. NEVER
      // re-POST: the list processor was already asked once.
      return {
        outcome: job.status === 'done' ? 'done' : 'failed',
        httpStatus: null,
        alreadyDone: true,
      };
    }
    if (job.verb !== 'unsubscribe' || job.selector.type !== 'sender') {
      throw new ValidationError(
        `action ${job.id} is verb=${job.verb} selector=${job.selector.type}; ` +
          'UnsubExecutionWorker executes sender-scoped unsubscribe actions only',
      );
    }
    const senderKey = job.selector.senderKey;
    const mailboxAccountId = job.mailboxAccountId;

    await db
      .update(actionJobs)
      .set({ status: 'executing', updatedAt: sql`now()` })
      .where(eq(actionJobs.id, job.id));

    // The never-execute-on-method≠one_click invariant (ADR-0006 scope
    // boundary). The method is re-read at EXECUTION time — an intent
    // recorded seconds before a sync demoted the sender to mailto/none
    // must not fire a POST at a stale URL.
    const [sender] = await db
      .select({
        unsubscribeMethod: senders.unsubscribeMethod,
        unsubscribeUrl: senders.unsubscribeUrl,
      })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), eq(senders.senderKey, senderKey)))
      .limit(1);
    if (!sender || sender.unsubscribeMethod !== 'one_click' || !sender.unsubscribeUrl) {
      return this.recordOutcome(job.id, mailboxAccountId, senderKey, {
        outcome: 'failed',
        httpStatus: null,
        errorCode: 'UNSUB_NOT_ONE_CLICK',
      });
    }

    // SSRF pre-flight — scheme + resolved-address checks.
    const targetCheck = await this.validateTarget(sender.unsubscribeUrl);
    if (!targetCheck.ok) {
      return this.recordOutcome(job.id, mailboxAccountId, senderKey, {
        outcome: 'failed',
        httpStatus: null,
        errorCode: targetCheck.errorCode,
      });
    }

    let response: UnsubHttpResponse;
    try {
      response = await this.deps.http.postOneClick(sender.unsubscribeUrl, {
        timeoutMs: UNSUB_REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      // Network-level failure (timeout / refused / reset / DNS). ONE
      // retry total: rethrow as retryable while the budget allows;
      // record the honest terminal outcome once it's spent.
      if (ctx.attempt < UNSUB_MAX_ATTEMPTS) {
        throw new TransientError(
          `one-click POST failed (attempt ${ctx.attempt}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return this.recordOutcome(job.id, mailboxAccountId, senderKey, {
        outcome: 'failed',
        httpStatus: null,
        errorCode: 'UNSUB_NETWORK_ERROR',
      });
    }

    const record: OutcomeRecord =
      response.status >= 200 && response.status < 300
        ? { outcome: 'done', httpStatus: response.status, errorCode: null }
        : response.status >= 300 && response.status < 400
          ? {
              outcome: 'ambiguous',
              httpStatus: response.status,
              errorCode: 'UNSUB_AMBIGUOUS_REDIRECT',
            }
          : {
              outcome: 'failed',
              httpStatus: response.status,
              errorCode: 'UNSUB_TARGET_REJECTED',
            };
    return this.recordOutcome(job.id, mailboxAccountId, senderKey, record);
  }

  /**
   * Terminal failure that bypassed the in-band outcome path (malformed
   * job, unexpected throw). Mirror the label worker: flip the action
   * row to failed so the FE poll terminates; best-effort flip the
   * policy status off 'pending' so a chip never sticks at "confirming".
   */
  protected override async onTerminalFailure(
    payload: UnsubExecutionJobData,
    error: Error,
  ): Promise<void> {
    try {
      const [job] = await this.deps.db
        .select()
        .from(actionJobs)
        .where(eq(actionJobs.id, payload.actionId))
        .limit(1);
      await this.deps.db
        .update(actionJobs)
        .set({ status: 'failed', errorCode: error.name, updatedAt: sql`now()` })
        .where(eq(actionJobs.id, payload.actionId));
      if (job && job.selector.type === 'sender') {
        await this.deps.db
          .update(senderPolicies)
          .set({ unsubStatus: 'failed', updatedAt: sql`now()` })
          .where(
            and(
              eq(senderPolicies.mailboxAccountId, payload.mailboxAccountId),
              eq(senderPolicies.senderKey, job.selector.senderKey),
              eq(senderPolicies.unsubStatus, 'pending'),
            ),
          );
      }
    } catch (recordErr) {
      // Recording the failure must never mask the original error.
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'unsub_execution.failed_status_write_failed',
          actionId: payload.actionId,
          message: recordErr instanceof Error ? recordErr.message : String(recordErr),
        }),
      );
    }
  }

  /**
   * The terminal transaction — every durable effect of one attempt:
   *   1. `action_jobs` → done/failed (+ error_code; affected_count is
   *      1 SENDER on success — unsub affects the sender, not messages).
   *   2. `sender_policies.unsub_status` → the outcome (the senders
   *      list/detail chips read this).
   *   3. `activity_log` outcome row — append-only audit of the ATTEMPT
   *      (D9: record attempt, not assumed success). 0-affected (no
   *      mail moved) and NO undo token (D58 — one-way).
   *   4. `actions.unsubscribe_executed` outbox event (observability).
   */
  private async recordOutcome(
    actionId: string,
    mailboxAccountId: string,
    senderKey: string,
    record: OutcomeRecord,
  ): Promise<UnsubExecutionResult> {
    const executedAt = new Date();
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(actionJobs)
        .set({
          status: record.outcome === 'done' ? 'done' : 'failed',
          errorCode: record.errorCode,
          affectedCount: record.outcome === 'done' ? 1 : 0,
          updatedAt: sql`now()`,
        })
        .where(eq(actionJobs.id, actionId));

      await tx
        .update(senderPolicies)
        .set({ unsubStatus: record.outcome, updatedAt: sql`now()` })
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        );

      await tx.insert(activityLog).values({
        mailboxAccountId,
        senderKey,
        source: 'manual',
        action: 'unsubscribe',
        // 0 — an unsubscribe moves no messages; the sender-level effect
        // lives on action_jobs.affected_count + the policy status.
        affectedCount: 0,
        // D58: no undo token, ever — the POST cannot be recalled.
        undoToken: null,
      });

      await this.deps.outbox.publish(tx, {
        topic: TOPICS.ACTIONS_UNSUBSCRIBE_EXECUTED,
        aggregateId: actionId,
        payload: {
          mailboxAccountId,
          senderKey,
          actionId,
          outcome: record.outcome,
          httpStatus: record.httpStatus,
          executedAt: executedAt.toISOString(),
        },
        schema: ActionsUnsubscribeExecutedPayloadSchema,
      });
    });

    return { outcome: record.outcome, httpStatus: record.httpStatus, alreadyDone: false };
  }

  /**
   * SSRF pre-flight. Returns `ok` or the classification to record.
   * `allowInsecureTargets` (local smoke only — see `UnsubExecutionDeps`)
   * relaxes exactly two rules: the `http:` scheme and LOOPBACK
   * addresses. Private / link-local ranges stay blocked even then.
   */
  private async validateTarget(
    rawUrl: string,
  ): Promise<{ ok: true } | { ok: false; errorCode: string }> {
    const allowInsecure =
      this.deps.allowInsecureTargets === true && process.env.NODE_ENV !== 'production';

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, errorCode: 'UNSUB_INVALID_URL' };
    }
    if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
      return { ok: false, errorCode: 'UNSUB_INSECURE_SCHEME' };
    }

    // `URL.hostname` brackets IPv6 literals — strip for isIP/lookup.
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (isIP(hostname)) {
      addresses = [hostname];
    } else {
      try {
        addresses = await (this.deps.resolveHost ?? DNS_RESOLVE_HOST)(hostname);
      } catch {
        return { ok: false, errorCode: 'UNSUB_DNS_FAILURE' };
      }
      if (addresses.length === 0) {
        return { ok: false, errorCode: 'UNSUB_DNS_FAILURE' };
      }
    }
    for (const address of addresses) {
      const cls = classifyAddress(address);
      if (cls === 'public') continue;
      if (cls === 'loopback' && allowInsecure) continue;
      return { ok: false, errorCode: 'UNSUB_PRIVATE_TARGET' };
    }
    return { ok: true };
  }
}

/**
 * Classify one resolved IP. 'loopback' is split out because the
 * insecure-targets flag exempts loopback ONLY (a 127.0.0.1 smoke fake)
 * while RFC 1918 / link-local / ULA stay blocked unconditionally.
 */
export function classifyAddress(address: string): 'public' | 'loopback' | 'private' {
  // Normalize IPv4-mapped IPv6 (`::ffff:10.0.0.1`) to the v4 form so
  // the v4 range checks below apply.
  const normalized = address.toLowerCase().startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;

  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map((o) => Number.parseInt(o, 10));
    const [a, b] = octets as [number, number, number, number];
    if (a === 127) return 'loopback';
    if (a === 0) return 'private'; // 0.0.0.0/8 — "this network"
    if (a === 10) return 'private'; // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return 'private'; // RFC 1918
    if (a === 192 && b === 168) return 'private'; // RFC 1918
    if (a === 169 && b === 254) return 'private'; // link-local (incl. GCP metadata)
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
    return 'public';
  }

  // IPv6.
  const lower = normalized.toLowerCase();
  if (lower === '::1') return 'loopback';
  if (lower === '::') return 'private'; // unspecified
  const firstGroup = lower.split(':', 1)[0] ?? '';
  // fc00::/7 — unique local.
  if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) return 'private';
  // fe80::/10 — link-local (fe80–febf).
  if (/^fe[89ab]/.test(firstGroup)) return 'private';
  return 'public';
}
