import { request as httpRequest } from 'node:http';
import type { ErrorCode } from '@declutrmail/shared/contracts';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { JobsOptions } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { actionJobs, activityLog, mailMessages, senderPolicies, senders } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { ActionsUnsubscribeExecutedPayloadSchema, TOPICS } from '@declutrmail/events';
import {
  UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
  UNSUB_MANUAL_REQUIRED_ERROR_CODE,
} from '@declutrmail/shared/contracts';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { OutboxPublisher } from './outbox-publisher.js';
// SSRF primitives moved to `ssrf-guard.ts` when DomainIconWorker
// (ADR-0034) became the second consumer of the same guard. Re-exported
// below so this module's public surface is unchanged.
import {
  buildPinnedLookup,
  classifyAddress,
  DNS_RESOLVE_HOST,
  type PinnedLookup,
  type ResolveHost,
} from './ssrf-guard.js';
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
 *   User-Agent: DeclutrMail/1.0 (+https://declutrmail.com)
 *   List-Unsubscribe=One-Click
 *
 * No auth headers, no cookies, no redirects followed. The `unsubscribe_url`
 * is whatever the sync workers folded onto the sender row; they keep the
 * NEWEST one-click URL precisely because these carry per-send tokens that
 * expire (a stale token reads here as a plain `UNSUB_TARGET_REJECTED`).
 * The outcome is recorded HONESTLY (D226 — no fake success):
 *
 *   - 2xx        → 'endpoint_accepted' (request accepted; future-mail
 *                                     suppression is not proven)
 *   - 3xx        → 'unconfirmed' (redirects are never followed — SSRF
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
 *   - Redirects are never followed (cross-origin or otherwise) —
 *     `node:http(s).request` does not auto-follow, so a 3xx comes back
 *     as-is and classifies terminal 'unconfirmed'.
 *   - DNS-rebinding TOCTOU closed: the pre-flight's validated address is
 *     PINNED into the connection via a custom `lookup` (the port dials
 *     the pre-validated IP, never re-resolving). No second resolution
 *     occurs, so a hostile authoritative server cannot return a public
 *     IP to the pre-flight and a private/metadata IP to the socket. TLS
 *     SNI / `servername` stays the hostname, so certificate validation
 *     is unchanged (the cert is validated against the hostname, never
 *     the IP).
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
  /** Activity attribution. Optional for queued jobs created before 0037. */
  source?: 'manual' | 'autopilot';
  /** Rule attribution for Autopilot outcomes; null/absent for manual. */
  ruleId?: string | null;
}

/** Metric-only result (logged on `worker.succeeded`). */
export interface UnsubExecutionResult {
  outcome: 'endpoint_accepted' | 'failed' | 'unconfirmed' | 'action_required';
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
 *
 * Seam contract: implementations MUST dial the pinned address
 * (`opts.pinnedAddress` / `opts.family`, the address the pre-flight
 * already validated), NOT re-resolve the hostname — re-resolution
 * reopens the DNS-rebinding TOCTOU. TLS SNI / `servername` stays the
 * hostname from `url` so certificate validation is unchanged.
 */
export interface UnsubHttpPort {
  postOneClick(
    url: string,
    opts: { timeoutMs: number; pinnedAddress: string; family: 4 | 6 },
  ): Promise<UnsubHttpResponse>;
}

/** RFC 8058 §3.2 one-click body — exactly 26 bytes. */
const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';

/**
 * Identify the sender of the POST. `node:http(s)` sets no `User-Agent`
 * at all, and a UA-less POST is a stock bot signature — the WAFs in
 * front of large retailers' opt-out endpoints answer it 403, which the
 * worker can only classify as `UNSUB_TARGET_REJECTED`. Naming ourselves
 * (with a URL their abuse desk can look up) is also simply the honest
 * thing to send: this is a real request on behalf of a real recipient.
 */
export const UNSUB_USER_AGENT = 'DeclutrMail/1.0 (+https://declutrmail.com)';

/**
 * Production adapter — `node:https.request` (or `node:http.request` only
 * on the insecure local-smoke path), pinned to the pre-validated address
 * via a custom `lookup` (see `buildPinnedLookup`). `node:http(s)` does
 * NOT auto-follow redirects, so a 3xx comes back as-is and classifies
 * 'unconfirmed'. No cookie jar, no auth header; the response body is never
 * consumed — the socket is destroyed once the status line is read.
 * `servername` stays the hostname so TLS SNI + certificate validation
 * remain correct (the cert is validated against the hostname, not the
 * pinned IP).
 */
export const FETCH_UNSUB_HTTP_PORT: UnsubHttpPort = {
  postOneClick(url, opts) {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;
    // `URL.hostname` brackets IPv6 literals — strip for SNI/servername.
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    return new Promise<UnsubHttpResponse>((resolve, reject) => {
      const req = requestFn(
        {
          protocol: parsed.protocol,
          // Keep the REAL hostname so the implicit Host header + (for
          // https) SNI/servername are the hostname, never the IP.
          hostname,
          port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(ONE_CLICK_BODY),
            'User-Agent': UNSUB_USER_AGENT,
          },
          // The pin: dial ONLY the pre-validated address. No second
          // resolution occurs. Cast at this boundary — `PinnedLookup`'s
          // optional-callback form is structurally looser than Node's
          // overloaded `LookupFunction`, but at runtime Node always calls
          // the `(hostname, options, cb)` form.
          lookup: buildPinnedLookup(opts.pinnedAddress, opts.family) as never,
          // TLS cert is validated against the hostname (servername), not
          // the dialed IP. Defaulting `servername` from `hostname` is
          // Node's behavior; set it explicitly to be unambiguous.
          ...(isHttps ? { servername: hostname } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // Release the connection without reading the payload (D7
          // posture: we never ingest third-party response content).
          res.resume();
          res.destroy();
          resolve({ status });
        },
      );
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error(`one-click POST timed out after ${opts.timeoutMs}ms`));
      });
      req.on('error', reject);
      req.end(ONE_CLICK_BODY);
    });
  },
};

/**
 * Envelope `code` for the enqueue-boundary refusal (D202).
 *
 * Same string as the worker's `error_code` on purpose: one condition, one
 * name, wherever the user or an operator meets it.
 *
 * Typed as `ErrorCode`, which is the registry's own key union — so removing
 * this from `ERROR_CODES` breaks the build. That matters because the failure
 * is otherwise SILENT: `AllExceptionsFilter` drops any unregistered code and
 * flattens the envelope to the bare status, so the client's branch for it
 * becomes unreachable while every test on both sides stays green. This
 * shipped exactly that way and only a browser smoke found it.
 */
export const UNSUB_SEND_DISABLED_CODE: ErrorCode = 'UNSUB_SEND_DISABLED';

/** `action_jobs.error_code` when the defence-in-depth refusal fires. */
export const UNSUB_SEND_BLOCKED_ERROR_CODE = 'UNSUB_SEND_DISABLED';

/**
 * Whether this process may perform a real one-click unsubscribe POST.
 *
 * `UNSUB_SEND_ENABLED === 'true'`, read explicitly, and nothing else. Unset,
 * empty, `1`, `TRUE`, `yes` — all refuse. **Silence means do not send**, in
 * every environment including production.
 *
 * The polarity is the whole design, and the obvious alternative is wrong.
 * Refusing only when a flag is SET makes silence mean SEND, so an unset var, a
 * typo, or a var that never reached the worker service all send. This is the
 * inverse of `DEV_AUTH_ENABLED`, which gates a dev capability and is asserted
 * OFF in production; this gates a real-world side effect on a third party and
 * is asserted ON in production, at boot, by the composition root.
 *
 * Takes `env` so a caller can decide without mutating the process.
 */
export function unsubSendsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNSUB_SEND_ENABLED === 'true';
}

/** Host only, for logs. Never the path or query — the token lives there. */
function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

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
  outcome: 'endpoint_accepted' | 'failed' | 'unconfirmed' | 'action_required';
  httpStatus: number | null;
  /**
   * `action_jobs.error_code` value. NULL for endpoint acceptance. The
   * FE poll reads this to distinguish unconfirmed from failed (generic
   * action-job status is `failed` for both).
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
        outcome:
          job.status === 'done'
            ? 'endpoint_accepted'
            : job.errorCode === UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE
              ? 'unconfirmed'
              : 'failed',
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
    if (!sender || sender.unsubscribeMethod !== 'one_click') {
      return this.recordOutcome(
        job.id,
        mailboxAccountId,
        senderKey,
        { outcome: 'failed', httpStatus: null, errorCode: 'UNSUB_NOT_ONE_CLICK' },
        payload.source ?? 'manual',
        payload.ruleId ?? null,
      );
    }

    // D252 — resolve BOTH channels from `mail_messages` at execution
    // time. The sender row holds one URL folded at sync time; RFC 8058
    // URLs are minted per send and expire, so the freshest message is
    // the only trustworthy source. The sender row stays the fallback
    // for a mailbox whose messages have aged out of the index.
    const channels = await this.resolveChannels(db, mailboxAccountId, senderKey);
    const oneClickUrl = channels.oneClickUrl ?? sender.unsubscribeUrl;
    if (!oneClickUrl) {
      return this.recordOutcome(
        job.id,
        mailboxAccountId,
        senderKey,
        { outcome: 'failed', httpStatus: null, errorCode: 'UNSUB_NOT_ONE_CLICK' },
        payload.source ?? 'manual',
        payload.ruleId ?? null,
      );
    }

    // KILL SWITCH — no real unsubscribe leaves a non-production process.
    //
    // This POST is irreversible and leaves the founder's own address on a
    // third party's list processor. There was no way to stop it: no dry-run,
    // and stopping the worker only DEFERS the send until one returns. So no
    // QA pass could press `U` on any surface it is reachable from — Triage,
    // Senders, Sender detail, Brief and Screener — and the entire surface
    // below the unsubscribe preview went untested for that reason alone.
    //
    // Sits after channel resolution so QA still sees the honest
    // `UNSUB_NOT_ONE_CLICK` answer for a sender that has no one-click
    // channel, and before the pre-flight so nothing touches the network.
    //
    // The outcome is `failed`, not a faked acceptance: the send did not
    // happen, and a recorded success for a message never sent is the exact
    // fake-completion this repo forbids.
    if (!unsubSendsEnabled()) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'unsub.send_disabled',
          actionId: job.id,
          // HOST + channel only. Never the one-click URL: it carries a
          // per-send token, and D7 keeps tokenised recipient identifiers out
          // of logs. Named `unsubscribeHost` rather than `senderDomain`
          // because that is what it is — the list processor's host, which is
          // routinely a different domain from the sender's.
          unsubscribeHost: safeHost(oneClickUrl),
          channel: 'one_click',
          message: 'Refused a one-click unsubscribe: UNSUB_SEND_ENABLED is not "true".',
        }),
      );
      return this.recordSendDisabled(job.id);
    }

    // SSRF pre-flight — scheme + resolved-address checks.
    const targetCheck = await this.validateTarget(oneClickUrl);
    if (!targetCheck.ok) {
      return this.recordOutcome(
        job.id,
        mailboxAccountId,
        senderKey,
        { outcome: 'failed', httpStatus: null, errorCode: targetCheck.errorCode },
        payload.source ?? 'manual',
        payload.ruleId ?? null,
      );
    }

    let response: UnsubHttpResponse;
    try {
      response = await this.deps.http.postOneClick(oneClickUrl, {
        timeoutMs: UNSUB_REQUEST_TIMEOUT_MS,
        // Pin the socket to the address the pre-flight already validated
        // — no second resolution (DNS-rebinding TOCTOU closed).
        pinnedAddress: targetCheck.pinnedAddress,
        family: targetCheck.family,
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
      return this.recordOutcome(
        job.id,
        mailboxAccountId,
        senderKey,
        { outcome: 'failed', httpStatus: null, errorCode: 'UNSUB_NETWORK_ERROR' },
        payload.source ?? 'manual',
        payload.ruleId ?? null,
      );
    }

    const record: OutcomeRecord =
      response.status >= 200 && response.status < 300
        ? { outcome: 'endpoint_accepted', httpStatus: response.status, errorCode: null }
        : response.status >= 300 && response.status < 400
          ? {
              outcome: 'unconfirmed',
              httpStatus: response.status,
              errorCode: UNSUB_AMBIGUOUS_REDIRECT_ERROR_CODE,
            }
          : // D252 — the endpoint refused us. That is terminal for the
            // AUTOMATED path, not necessarily for the user: 71% of
            // one-click senders also advertise a `mailto:` channel we
            // were discarding at sync time. Route those to the D230
            // manual compose hand-off instead of a dead end. `failed`
            // now means what it says — nothing left to try.
            channels.mailtoUrl
            ? {
                outcome: 'action_required',
                httpStatus: response.status,
                errorCode: UNSUB_MANUAL_REQUIRED_ERROR_CODE,
              }
            : {
                outcome: 'failed',
                httpStatus: response.status,
                errorCode: 'UNSUB_TARGET_REJECTED',
              };
    return this.recordOutcome(
      job.id,
      mailboxAccountId,
      senderKey,
      record,
      payload.source ?? 'manual',
      payload.ruleId ?? null,
    );
  }

  /**
   * Terminal failure that bypassed the in-band outcome path (malformed
   * job, unexpected throw). Mirror the label worker: flip the action
   * row to failed so the FE poll terminates; best-effort flip the
   * policy status off requested/legacy-pending so a chip never sticks.
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
      await this.deps.db.transaction(async (tx) => {
        const [failedJob] = await tx
          .update(actionJobs)
          .set({ status: 'failed', errorCode: error.name, updatedAt: sql`now()` })
          .where(
            and(
              eq(actionJobs.id, payload.actionId),
              sql`${actionJobs.status} NOT IN ('done', 'failed')`,
            ),
          )
          .returning({ id: actionJobs.id });
        if (job && job.selector.type === 'sender') {
          await tx
            .update(senderPolicies)
            .set({ unsubStatus: 'failed', updatedAt: sql`now()` })
            .where(
              and(
                eq(senderPolicies.mailboxAccountId, payload.mailboxAccountId),
                eq(senderPolicies.senderKey, job.selector.senderKey),
                sql`${senderPolicies.unsubStatus} IN ('pending', 'requested')`,
              ),
            );
          if (failedJob) {
            await tx.insert(activityLog).values({
              mailboxAccountId: payload.mailboxAccountId,
              senderKey: job.selector.senderKey,
              source: payload.source ?? 'manual',
              action: 'unsubscribe_failed',
              affectedCount: 0,
              // Same correlation as the in-band path above — a crash
              // outcome must be as traceable as a clean one.
              actionJobId: payload.actionId,
              undoToken: null,
              ruleId: payload.ruleId ?? null,
            });
          }
        }
      });
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
   *   3. `activity_log` canonical terminal row (D56/D245), distinct
   *      from the `unsubscribe` intent: endpoint accepted, failed, or
   *      unconfirmed. This avoids both double-counting the decision and
   *      presenting a failed POST as success. All are 0-affected and
   *      have no undo token.
   *   4. `actions.unsubscribe_executed` outbox event (observability) —
   *      still fires for EVERY outcome, so failure is fully observable.
   */
  /**
   * Newest URL per unsubscribe channel, read at EXECUTION time (D252).
   *
   * Deliberately NOT label-scoped. A sender's newest one-click message
   * can legitimately sit in Archive or Trash, and scoping to INBOX
   * would POST an older token than the one we actually hold — a false
   * staleness that manufactures the very failure this fixes.
   *
   * Two ordered lookups rather than one grouped scan: each rides
   * `mail_messages_account_sender_date_idx` and stops at the first row.
   * `id DESC` breaks `internal_date` ties deterministically — `id` is a
   * random v4 UUID, so date-only ordering picks arbitrarily and two
   * runs could POST different tokens.
   */
  private async resolveChannels(
    db: WorkerDb,
    mailboxAccountId: string,
    senderKey: string,
  ): Promise<{ oneClickUrl: string | null; mailtoUrl: string | null }> {
    const forSender = and(
      eq(mailMessages.mailboxAccountId, mailboxAccountId),
      eq(mailMessages.senderKey, senderKey),
    );
    const newestFirst = [desc(mailMessages.internalDate), desc(mailMessages.id)] as const;

    const [oneClick] = await db
      .select({ url: mailMessages.unsubscribeUrl })
      .from(mailMessages)
      .where(
        and(
          forSender,
          eq(mailMessages.unsubscribeOneClick, true),
          isNotNull(mailMessages.unsubscribeUrl),
        ),
      )
      .orderBy(...newestFirst)
      .limit(1);

    const [mailto] = await db
      .select({ url: mailMessages.unsubscribeMailtoUrl })
      .from(mailMessages)
      .where(and(forSender, isNotNull(mailMessages.unsubscribeMailtoUrl)))
      .orderBy(...newestFirst)
      .limit(1);

    return { oneClickUrl: oneClick?.url ?? null, mailtoUrl: mailto?.url ?? null };
  }

  /**
   * Terminal write for a job the kill switch refused. Deliberately NOT
   * `recordOutcome`.
   *
   * `recordOutcome` writes the honest record of an ATTEMPT: it projects
   * `sender_policies.unsub_status`, appends an `activity_log` row, and
   * publishes an outbox event. Every one of those would be a lie here —
   * nothing was attempted. The senders list would show a failed unsubscribe
   * chip, /activity would show an unsubscribe that never happened, and the
   * outbox would tell downstream consumers the same.
   *
   * So only `action_jobs` moves, and only to a terminal state. Never `done`:
   * the FE polls `done` before telling the user their unsubscribe went
   * through, and that would say they left a list they are still on. Never a
   * retryable throw either — three attempts then a dead letter, and a dead
   * letter is indistinguishable from delivered-but-unconfirmed.
   *
   * This path is defence-in-depth only. The refusal that matters happens at
   * the enqueue boundary, where no row is written at all; this catches a job
   * already queued when the flag changed.
   */
  private async recordSendDisabled(actionId: string): Promise<UnsubExecutionResult> {
    await this.deps.db
      .update(actionJobs)
      .set({
        status: 'failed',
        errorCode: UNSUB_SEND_BLOCKED_ERROR_CODE,
        affectedCount: 0,
        updatedAt: sql`now()`,
      })
      .where(eq(actionJobs.id, actionId));
    return { outcome: 'failed', httpStatus: null, alreadyDone: false };
  }

  private async recordOutcome(
    actionId: string,
    mailboxAccountId: string,
    senderKey: string,
    record: OutcomeRecord,
    source: 'manual' | 'autopilot',
    ruleId: string | null,
  ): Promise<UnsubExecutionResult> {
    const executedAt = new Date();
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(actionJobs)
        .set({
          // `action_job_status` has no "needs the user" value, so both
          // `unconfirmed` and `action_required` ride on `failed` and are
          // separated by `error_code` (D252). The automated attempt did
          // end without succeeding; what differs is whether anything is
          // left to try, which `sender_policies.unsub_status` carries.
          status: record.outcome === 'endpoint_accepted' ? 'done' : 'failed',
          errorCode: record.errorCode,
          affectedCount: record.outcome === 'endpoint_accepted' ? 1 : 0,
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

      // D56/D245 — append a canonical outcome for every terminal
      // classification. The original `unsubscribe` row remains the
      // single decision row used by K/A/U/L/D stats.
      await tx.insert(activityLog).values({
        mailboxAccountId,
        senderKey,
        source,
        action:
          record.outcome === 'endpoint_accepted'
            ? 'unsubscribe_endpoint_accepted'
            : record.outcome === 'unconfirmed'
              ? 'unsubscribe_unconfirmed'
              : record.outcome === 'action_required'
                ? 'unsubscribe_action_required'
                : 'unsubscribe_failed',
        affectedCount: 0,
        // Ties this outcome back to the execution — and through it to
        // the intent row, which carries the same id. Without it the two
        // rows are only correlatable by (sender, rough timestamp),
        // which silently merges two separate attempts minutes apart.
        actionJobId: actionId,
        undoToken: null,
        ruleId,
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
   * SSRF pre-flight. Returns `ok` + the address to PIN the connection to
   * (the first resolved address — all passed `classifyAddress`), or the
   * classification to record. The caller hands `pinnedAddress`/`family`
   * to the port so the socket dials exactly this validated address and
   * never re-resolves (DNS-rebinding TOCTOU closed).
   * `allowInsecureTargets` (local smoke only — see `UnsubExecutionDeps`)
   * relaxes exactly two rules: the `http:` scheme and LOOPBACK
   * addresses. Private / link-local ranges stay blocked even then.
   */
  private async validateTarget(
    rawUrl: string,
  ): Promise<
    { ok: true; pinnedAddress: string; family: 4 | 6 } | { ok: false; errorCode: string }
  > {
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
    // Pin the FIRST validated address — every address passed
    // classifyAddress, so the first is safe and the dialed IP is
    // deterministic. `family` derives from isIP() (4 or 6).
    const pinnedAddress = addresses[0]!;
    const family = isIP(pinnedAddress) === 6 ? 6 : 4;
    return { ok: true, pinnedAddress, family };
  }
}

// Re-exported for back-compat: these lived here until DomainIconWorker
// (ADR-0034) needed the same guard. Definitions are in `ssrf-guard.ts`.
export { buildPinnedLookup, classifyAddress, type PinnedLookup, type ResolveHost };
