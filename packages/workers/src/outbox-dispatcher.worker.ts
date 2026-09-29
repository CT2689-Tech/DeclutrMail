import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { outboxEvents } from '@declutrmail/db';
import type { OutboxEvent, schema } from '@declutrmail/db';

import type { BackgroundFailureContext } from './worker-observer.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * The dispatcher's notify channel — must match the trigger in
 * `0008_outbox_events.sql`. Co-located here so a future channel rename
 * cannot drift between migration and consumer.
 */
export const OUTBOX_NOTIFY_CHANNEL = 'outbox_inserted';

/**
 * Cap stored in `last_error` to keep failed rows bounded. Postgres has
 * no row-size cap that matters here, but exceptions can carry stack
 * traces in the MBs; truncating at insert keeps the table cheap to scan
 * for ops queries.
 */
const LAST_ERROR_MAX_LEN = 1_000;

/**
 * The publisher's outbox event shape, before insert. Topic + aggregate_id
 * + payload are the typed event contract per D204; the dispatcher does
 * not interpret them.
 */
export interface OutboxPublishInput<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  topic: string;
  aggregateId: string;
  payload: TPayload;
}

/**
 * The dispatched event handed to a consumer. The `payload` shape is the
 * publisher's contract; the dispatcher passes through.
 */
export type DispatchedEvent = Pick<
  OutboxEvent,
  'id' | 'topic' | 'aggregateId' | 'payload' | 'attempts' | 'createdAt'
>;

/**
 * Consumer port (D13). The dispatcher hands one claimed event to the
 * consumer; the consumer enqueues to BullMQ, fans out via HTTP, etc.
 *
 * Contract:
 *   - Throw on failure — the dispatcher catches and records the error.
 *     The row stays `pending` (unless `attempts` exceeds `maxAttempts`)
 *     for the next tick to retry. Every failure logs
 *     `outbox.dispatch.consumer_failed`; the attempt that flips the row
 *     to `failed` logs `outbox.dispatch.event_failed` and goes to the
 *     observer (Sentry).
 *   - The consumer MUST be idempotent on `event.id`: at-least-once,
 *     SEQUENTIAL delivery is the dispatcher's guarantee — the same
 *     event's consumer is never invoked again while a previous call for
 *     it is still running (see the orphan guard below) — so
 *     "idempotent on `event.id`" only ever has to mean "safe against a
 *     LATER, non-overlapping redelivery" (e.g. BullMQ `jobId: event.id`,
 *     or an upsert keyed on the event), never "safe if invoked
 *     concurrently with itself." An earlier draft of this contract
 *     reasoned that any consumer with a stable BullMQ jobId was
 *     automatically safe to abandon on timeout — that was wrong for a
 *     multi-step read-modify-write like `enqueueEmailSend`'s
 *     reap-and-replace path (get job → check state → remove → add),
 *     which is NOT safe if two copies of it interleave. The orphan
 *     guard is what actually closes that gap; jobId dedup alone does
 *     not (architecture-guardian review, 2026-09-28).
 *   - Throws here do NOT crash the worker — the dispatcher isolates one
 *     row's failure from the rest of the batch.
 *   - The call is raced against `consumerTimeoutMs`
 *     (`runConsumerWithOrphanGuard`): a consumer that hangs (e.g. a
 *     BullMQ publish during a Redis outage — CLAUDE.md §2.6) is
 *     abandoned after the deadline rather than held forever. The
 *     abandoned call keeps running in the background with no way to
 *     cancel it; the dispatcher tracks it and will not invoke ANY
 *     event sharing this one's (topic, aggregateId) again until that
 *     abandoned call actually finishes — see `orphanGuardKey`.
 */
export type OutboxConsumer = (event: DispatchedEvent) => Promise<void>;

/** A consumer throw whose attempt bookkeeping this tick committed. */
interface ConsumerFailure {
  event: DispatchedEvent;
  error: unknown;
  attempts: number;
  /** This attempt flipped the row to `failed`. */
  failed: boolean;
  /** This attempt was a `consumerTimeoutMs` timeout, not the consumer itself throwing. */
  timedOut: boolean;
}

/**
 * Optional background-failure capture port (D159). Implemented in the
 * composition root by wiring to `@sentry/node`'s `captureException`. The
 * dispatcher remains framework-agnostic: it knows how to call the port
 * and what context to pass; it does NOT depend on Sentry directly.
 *
 * Defaults to a no-op so tests and bare-bones bootstraps run without
 * needing Sentry configured. The context type is
 * `BackgroundFailureContext` itself, not a copy — the production adapter
 * reads only its `kind` and `tags`, and TypeScript checks interface
 * methods bivariantly, so a context shape that merely LOOKED like this
 * one but admitted extra fields would still satisfy it while the adapter
 * silently dropped them. `outbox.dispatch.event_failed` and
 * `tick_failed` did, twice, before this referenced the real type instead
 * of restating its shape (2026-09-28).
 */
export interface OutboxObserver {
  captureBackgroundFailure(error: unknown, context: BackgroundFailureContext): void;
}

/** Configuration knobs for the dispatcher. */
export interface OutboxDispatcherDeps {
  db: WorkerDb;
  /** Routes one claimed event to its downstream handler. */
  consumer: OutboxConsumer;
  /**
   * The number of `pending` rows the dispatcher claims per tick. Bounded
   * to keep one slow consumer from blocking unrelated topics; tune via
   * worker CPU/throughput, not via event throughput.
   */
  claimBatchSize?: number;
  /**
   * Max delivery attempts before the row flips to `failed`. The
   * consumer's own worker policy (D203) controls in-job retries; this
   * is the dispatcher-level "stop retrying" gate that prevents a
   * persistently-broken event from spinning forever. A `consumerTimeoutMs`
   * timeout is deliberately EXEMPT from this budget (see `runOneTick`'s
   * catch block) — an infrastructure outage is not evidence the event
   * itself is broken — but that exemption has its OWN separate ceiling,
   * `timeoutStuckCeilingMs`, so a timeout that never stops recurring for
   * one event still eventually fails instead of retrying forever.
   */
  maxAttempts?: number;
  /**
   * Polling interval as a safety net when NOTIFY is missed (worker
   * restart, network blip, Postgres failover). Defaults to 5 seconds —
   * NOTIFY is the hot path; the poll just guarantees liveness.
   */
  pollIntervalMs?: number;
  /**
   * Async LISTEN port. The composition root opens a dedicated
   * connection (postgres-js + a `LISTEN outbox_inserted`), and calls
   * the registered handler when a notification arrives. Kept as a port
   * so the test harness can drive notifications without a real
   * connection.
   */
  listen?: (handler: () => void) => Promise<() => Promise<void>>;
  /**
   * Background-failure observer (D159). Default no-op so tests don't
   * need to stub Sentry. Production wires this to `@sentry/node`'s
   * `captureException` in the composition root.
   */
  observer?: OutboxObserver;
  /**
   * Maximum number of pending NOTIFY-triggered ticks before the
   * dispatcher starts dropping wake-ups (back-pressure). One tick is
   * always allowed to run; ticks past this cap are dropped + logged
   * `outbox.dispatch.tick_dropped_backpressure`. Defaults to 16, which
   * comfortably absorbs NOTIFY bursts from large transactions without
   * letting the wake-up queue grow unbounded.
   */
  maxPendingTicks?: number;
  /**
   * Hard PER-CALL ceiling on one `consumer(event)` invocation, ms
   * (CLAUDE.md §2.6). The call runs inside this tick's open claim
   * transaction, and several consumers registered today make BullMQ
   * calls on a Redis connection configured to buffer commands across an
   * outage rather than reject them (`queue.ts`'s `createRedisConnection`)
   * — so without a bound, a Redis outage hangs the awaited call forever,
   * which means the claim transaction never commits and every later
   * tick coalesces onto (or is dropped waiting behind) this one stuck
   * tick.
   *
   * This bounds ONE row's call, not the whole tick: a batch where every
   * row hits the same outage can still hold the transaction for up to
   * `claimBatchSize * consumerTimeoutMs` (32 * 30s = 16 minutes at the
   * defaults) — bounded, not eliminated. See `runConsumerWithOrphanGuard`
   * for what happens to the abandoned call and the class docstring's
   * "Orphan guard" section for why that is safe.
   *
   * Defaults to 30 seconds, matching this codebase's existing short-job
   * `timeoutMs` convention (`WORKER_POLICIES.webhookPolicy`/
   * `adminPolicy`) — generous for the handful of DB reads/writes and
   * BullMQ calls any current consumer makes. Must be a finite, positive
   * number — `setTimeout` itself clamps `Infinity`/`NaN`/out-of-range
   * values to ~1ms, which is the opposite of what a caller passing
   * `Infinity` to mean "no timeout" would expect, so an invalid value
   * falls back to the default instead of silently timing out every call.
   */
  consumerTimeoutMs?: number;
  /**
   * Age ceiling on a row's OWN unbroken streak of `consumerTimeoutMs`
   * timeouts (tracked from the first timeout of the streak; a success
   * or a non-timeout failure resets it). A timeout is exempt from
   * `maxAttempts` (see `runOneTick`'s catch block) — correctly, since
   * an infrastructure outage is not evidence the event itself is broken
   * — but with no ceiling that exemption has no end state: a
   * PERMANENTLY stuck row retries forever with no Sentry signal, and
   * looks identical to a healthy skip in the logs (the exact "guard
   * that cannot fail" shape CLAUDE.md warns about). Once a row's streak
   * has lasted this long, its NEXT timeout is treated like an ordinary
   * exhausted failure — flipped to `failed` and reported to the
   * observer (Sentry) — same as a non-timeout failure hitting
   * `maxAttempts`.
   *
   * Defaults to 30 minutes: comfortably longer than the outage windows
   * this fix was written for (single-digit minutes, per this dep's own
   * worked example above), short enough that a truly stuck event still
   * eventually reaches a terminal state instead of silence forever.
   * Same finite-positive normalization as `consumerTimeoutMs`.
   */
  timeoutStuckCeilingMs?: number;
}

const DEFAULT_CLAIM_BATCH = 32;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MAX_PENDING_TICKS = 16;
const DEFAULT_CONSUMER_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_STUCK_CEILING_MS = 30 * 60_000;
/** Fixed — there is only ever one dispatcher class; shared by the class field and free functions below that need it but have no `this`. */
const WORKER_NAME = 'OutboxDispatcherWorker';
const NOOP_OBSERVER: OutboxObserver = {
  captureBackgroundFailure: () => undefined,
};

/**
 * `setTimeout` clamps a non-finite or non-positive delay to ~1ms rather
 * than rejecting it — confirmed against Node's actual behavior during
 * review (Infinity, NaN, and values >= 2^31 all fire almost
 * immediately). A caller passing `Infinity` to mean "disable the
 * timeout" would get the opposite: every consumer call would time out
 * instantly. Fall back to the given default instead. Shared by
 * `consumerTimeoutMs` and `timeoutStuckCeilingMs` — both are "a
 * duration, or trust the default" knobs with the same failure mode.
 */
function normalizePositiveMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Branded timeout marker for a call the dispatcher (or a consumer
 * cooperating with it) recognizes as an infrastructure timeout rather
 * than a genuine consumer bug — checked by CLASS IDENTITY
 * (`isOutboxTimeoutError`), never by `.name`. A `.name` string is
 * mutable and this codebase's own Gmail/BIMI/billing HTTP clients
 * already throw a native `TimeoutError`-named `DOMException` from
 * `AbortSignal.timeout()` (`gmail-client.service.ts`, `bimi-resolver.ts`,
 * `paddle.adapter.ts`, `razorpay.adapter.ts`) — a string match would
 * give a stuck, genuinely-broken call to one of THOSE clients the same
 * `maxAttempts` exemption and orphan-guard treatment this dispatcher
 * reserves for its own bound, forever, since nothing would ever
 * distinguish them (architecture-guardian review, 2026-09-29).
 *
 * Exported so a consumer that wants the SAME treatment for its own
 * inner bound (`rescore-senders.ts`'s `withPublishTimeout`) can throw
 * this exact class instead of an unbranded `Error` — that consumer's
 * rejection then reaches `runOneTick`'s catch block indistinguishable
 * from the dispatcher's own timeout, which is the intended contract.
 * Added to `SENTRY_SERVER_EXCEPTION_TYPES`
 * (`packages/shared/src/observability/sentry-scrubber.ts`) so a row
 * that eventually reaches `timeoutStuckCeilingMs` and reports to Sentry
 * keeps a legible exception type on the wire instead of being scrubbed
 * to an empty shell.
 */
export class OutboxConsumerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxConsumerTimeoutError';
  }
}

/** True if `err` is (or was passed through as) a timeout this dispatcher recognizes as its own. */
function isOutboxTimeoutError(err: unknown): boolean {
  return err instanceof OutboxConsumerTimeoutError;
}

/**
 * `String(err)` can itself throw — e.g. a null-prototype rejection
 * value, or an object whose `toString` throws — and this runs inside a
 * bare `.then()` handler with nothing awaiting the promise it returns.
 * An escaping throw there is an unhandled rejection, which (Node's
 * default settings; no global handler is installed anywhere in this
 * codebase) crashes the WHOLE worker process — every BullMQ worker in
 * it, not just this dispatcher — not just this one abandoned call.
 * Never let building an error message be the thing that crashes the
 * process (silent-failure-hunter + architecture-guardian review,
 * 2026-09-28 — both independently reproduced this with a null-prototype
 * rejection value).
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unstringifiable rejection value';
  }
}

/**
 * Race `consumerPromise` against a hard `ms` deadline and reject if the
 * deadline wins.
 *
 * This is deliberately NOT `BaseDeclutrWorker`'s private `withTimeout`
 * (`base-declutr-worker.ts`), which signals an `AbortController` and
 * then still awaits the original promise to completion — right for a
 * BullMQ job attempt, which must not be released while ITS OWN
 * transaction/lock is held elsewhere (see `mailbox-action-lock.ts`'s
 * account of the incident a bare-race version of that helper caused:
 * a detached retry ran a non-idempotent purge twice). Here the
 * situation is the opposite: OUR OWN open claim transaction is the
 * thing being held hostage by the awaited call, so giving up on it is
 * the fix, not the risk.
 *
 * The abandoned call keeps running with no way to cancel it (there is
 * no cancellable BullMQ/ioredis API). A late settle cannot change this
 * call's own outcome, but silently discarding it would hide a real
 * signal, so it is logged instead
 * (`outbox.dispatch.consumer_settled_after_timeout`). Whether abandoning
 * the call is SAFE — i.e. whether a later retry running concurrently
 * with it can cause a duplicate side effect — is NOT this function's
 * concern; see `runConsumerWithOrphanGuard` and the class docstring's
 * "Orphan guard" section, which is what actually makes that safe.
 */
function withConsumerTimeout(
  consumerPromise: Promise<void>,
  ms: number,
  event: DispatchedEvent,
  observer: OutboxObserver,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new OutboxConsumerTimeoutError(
          `Outbox consumer for topic "${event.topic}" (event ${event.id}) exceeded ${ms}ms`,
        ),
      );
    }, ms);
    // Promise.resolve(...) normalizes a non-Promise/broken-thenable
    // `consumerPromise` instead of throwing on `.then` access.
    // `OutboxConsumer`'s type already guarantees a real Promise; this is
    // cheap insurance against a runtime-only violation crashing the
    // process instead of just rejecting this one call.
    Promise.resolve(consumerPromise).then(
      () => {
        if (settled) {
          logConsumerSettledAfterTimeout(event, 'resolved', observer);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        if (settled) {
          logConsumerSettledAfterTimeout(event, 'rejected', observer, err);
          return;
        }
        // Compute the safe message BEFORE flipping `settled` / clearing
        // the timer. The previous ordering did this after — so if the
        // conversion threw, `settled` was already true and the timer
        // already cleared, `reject` was never reached, and this
        // promise was stuck pending forever: the exact failure this
        // helper exists to prevent, reintroduced through a different
        // door (silent-failure-hunter + architecture-guardian review,
        // 2026-09-28).
        const message = safeErrorMessage(err);
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(message, { cause: err }));
      },
    );
  });
}

/**
 * Observability for a consumer call that finally settles after the
 * dispatcher already timed it out. Only `errorName` is logged, never
 * the raw message — the same convention `reportConsumerFailure` below
 * follows, because a Drizzle query error's message can carry bound
 * query parameters (#807). A 'rejected' outcome also reports to the
 * observer (Sentry): it means the abandoned call's real problem was NOT
 * a mere timeout, the dispatcher has already moved on, and nothing else
 * will ever report this specific failure — a warn-only console line is
 * easy to miss for a signal this is the only record of.
 */
function logConsumerSettledAfterTimeout(
  event: DispatchedEvent,
  outcome: 'resolved' | 'rejected',
  observer: OutboxObserver,
  err?: unknown,
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      kind: 'outbox.dispatch.consumer_settled_after_timeout',
      outcome,
      topic: event.topic,
      eventId: event.id,
      ...(outcome === 'rejected'
        ? { errorName: err instanceof Error ? err.name : typeof err }
        : {}),
    }),
  );
  if (outcome === 'rejected') {
    observer.captureBackgroundFailure(err, {
      kind: 'outbox.dispatch.consumer_settled_after_timeout',
      tags: { worker: WORKER_NAME, topic: event.topic, event_id: event.id },
    });
  }
}

/**
 * The orphan guard's tracking key — the event's (topic, aggregateId),
 * NOT `event.id`.
 *
 * `event.id` identifies one outbox ROW; it is not the unit that is
 * actually unsafe to run concurrently with itself. A downstream
 * dedup key like `syncFailedEmailJobId` (mailbox + UTC day) or
 * `syncReminderEmailJobId` (mailbox alone) is shared by MULTIPLE
 * distinct outbox events for the same topic — e.g. two separate
 * `mailbox.sync_ready` events for the same mailbox (a sync retry after
 * a crash re-publishes with `firstReady: true` again). Keying the
 * orphan guard on `event.id` let two DIFFERENT events with the SAME
 * downstream key interleave through `enqueueEmailSend`'s non-atomic
 * reap-and-replace (`get job → check state → remove → add`) the moment
 * the first one orphaned — reproducing the exact duplicate-send race
 * this file's own orphan guard exists to prevent (architecture-guardian
 * review, 2026-09-29).
 *
 * `(topic, aggregateId)` is the coarsest key that is STILL SAFE for
 * every topic the router (`outbox-consumer-router.ts`) currently
 * handles, checked one by one:
 *   - `mailbox.sync_ready` / `mailbox.sync_failed` /
 *     `mailbox.reconnect_required`: `aggregateId` IS the
 *     `mailboxAccountId` at publish (`initial-sync.worker.ts`,
 *     `mailbox-reconnect.ts`) — exactly the granularity (or coarser
 *     than) every downstream email dedup key for these topics
 *     (`syncCompleteEmailJobId` embeds the event id itself;
 *     `syncReminderEmailJobId`/`syncFailedEmailJobId`/the
 *     `gmail-reconnect` key are all `mailboxAccountId`-rooted).
 *   - `mailbox.non_mail_purged`: `rescoreSenders` only ever calls
 *     atomic, jobId-deduped BullMQ operations (`addBulk`, a debounced
 *     `sweepAfter` add) — no reap-and-replace — so no cross-event
 *     interleaving is possible regardless of key granularity; keying by
 *     aggregateId (mailboxAccountId) is simply consistent, not required
 *     for safety here.
 *   - `autopilot.rule_activated` / `triage.score_run_completed`: same
 *     shape — `enqueueAutopilotApply`/the delta trigger are plain
 *     deduped `.add()` calls, safe regardless.
 *   - `actions.unsubscribe_intent_recorded` / `actions.unsubscribe_executed`
 *     / `triage.verdict_applied` / `action.label_applied`: `aggregateId`
 *     is the publishing row's OWN id (`activity_log.id` / `actionId` /
 *     `job.id`) — already as fine-grained as `event.id` — and every
 *     downstream write is a single atomic Postgres upsert/UPDATE
 *     (`sender_policies` `onConflictDoUpdate`, `screener_quarantine`
 *     UPDATE guarded by `decided_at IS NULL`), never a JS-level
 *     read-modify-write, so no interleaving is possible either way.
 *
 * A cross-TOPIC collision on the same aggregateId (e.g. a
 * `mailbox.sync_ready` orphan blocking an unrelated `mailbox.sync_failed`
 * event for the same mailbox) is included in the key on purpose — it
 * costs a harmless extra wait, never a duplicate side effect, and
 * keeping the dispatcher ignorant of each consumer's actual downstream
 * key (private to the router/feature) is what keeps this a dispatcher-
 * level guard rather than one that has to be re-derived by hand for
 * every new topic.
 */
function orphanGuardKey(event: DispatchedEvent): string {
  return JSON.stringify([event.topic, event.aggregateId]);
}

/**
 * One dispatcher tick's result counters — returned for the test harness
 * and the structured log.
 */
export interface DispatcherTickResult {
  /** Rows claimed by the SKIP LOCKED query this tick. */
  claimed: number;
  /** Rows whose consumer call threw or timed out; left pending unless `failed` below. */
  consumerFailed: number;
  /**
   * Of `consumerFailed`, how many were specifically a `consumerTimeoutMs`
   * timeout rather than the consumer itself throwing. These still bump
   * `attempts` and set `last_error`, but never count toward
   * `flippedToFailed` — see `runOneTick`'s catch block.
   */
  consumerTimedOut: number;
  /** Rows whose consumer returned successfully and were marked dispatched. */
  dispatched: number;
  /**
   * Rows flipped to `failed` this tick: either a non-timeout failure
   * that exceeded `maxAttempts`, or a timeout whose own unbroken streak
   * exceeded `timeoutStuckCeilingMs` (see `runOneTick`'s catch block) —
   * a timeout alone never counts toward this on its own.
   */
  flippedToFailed: number;
  /**
   * Distinct (topic, aggregateId) concurrency units currently
   * orphan-guarded — a snapshot of `orphanedEvents.size` at the end of
   * this tick, NOT a per-tick count of skipped rows: the claim query
   * excludes an orphaned key's rows entirely (see `runOneTick`'s claim
   * SQL), so they are never even fetched to be counted one by one. A
   * sustained nonzero value across many ticks is the signal that
   * distinguishes "quiet" from "an outage is ongoing," which a bare
   * `outbox.tick` line with zero claims cannot — see
   * `runConsumerWithOrphanGuard`.
   */
  skippedOrphaned: number;
}

const EMPTY_TICK_RESULT: DispatcherTickResult = {
  claimed: 0,
  consumerFailed: 0,
  consumerTimedOut: 0,
  dispatched: 0,
  flippedToFailed: 0,
  skippedOrphaned: 0,
};

/**
 * OutboxDispatcherWorker (D13).
 *
 * Reads `outbox_events` rows where `status='pending'` in FIFO order
 * with `FOR UPDATE SKIP LOCKED`, hands each one to the consumer, and
 * flips `status` to `dispatched` on success (or `failed` after
 * `maxAttempts` consumer throws). One row's failure is isolated from
 * the rest of the batch — each row runs in its own subtransaction
 * (savepoint).
 *
 * Wake-up path: the migration registers an AFTER INSERT trigger that
 * fires `pg_notify('outbox_inserted', NEW.id::text)`. The composition
 * root opens a LISTEN connection and calls `wake()` on every
 * notification → typical end-to-end latency ~10ms (network + scheduler
 * jitter dominate).
 *
 * Polling safety net: every `pollIntervalMs` (default 60s) the
 * dispatcher runs a tick whether or not a notification fired. Covers
 * the windows where NOTIFY can be lost — worker restart between the
 * publisher's commit and the listener's connection ready, Postgres
 * failover, or a network partition that drops the wire-protocol async
 * frame.
 *
 * The interval was 5s until 2026-08-23. Measured on prod over 76 days,
 * that fallback ran 1,208,817 times to deliver 1,242 events, and each
 * tick is three statements (BEGIN + claim + COMMIT):
 *
 *   claim query        1,208,817 calls   11.19% of ALL statements
 *   + its BEGIN/COMMIT ~2,400,000 calls
 *   ------------------------------------------------------------
 *   ~3.6M of 10.8M total statements — 33% of the entire database's
 *   traffic, for a path that is BY DESIGN almost always a no-op.
 *
 * 60s costs nothing on the normal path: NOTIFY still wakes the
 * dispatcher in ~10ms, and that is how every event in practice gets
 * delivered. It costs up to 60s of extra latency ONLY in the cases the
 * fallback exists for — a lost notification — which the listener's own
 * reconnect already covers for the common one (worker restart).
 *
 * Do not treat this as a latency knob. If outbox delivery ever looks
 * slow, the NOTIFY path is broken (check `outbox_listen_session_mode`
 * at boot — over a transaction pooler LISTEN silently lands on the
 * wrong backend) and lowering this number would only mask it.
 *
 * Why not BullMQ for the wake-up? BullMQ adds a hop (publish into
 * Redis, worker reads from Redis) and a failure surface (Redis must
 * be up). The transactional outbox row IS the durable intent;
 * LISTEN/NOTIFY is the cheap wake signal that lives inside the same
 * Postgres connection family as the data. Two infrastructure
 * dependencies → one.
 *
 * Why not LISTEN-only (no poll)? See "Polling safety net" above —
 * NOTIFY is best-effort under restart/failover.
 *
 * Policy: `cronPolicy` per D157/D225 table — the dispatcher process
 * itself is long-running; per-tick logging follows the same shape as
 * `BaseDeclutrWorker` lifecycle events without inheriting it (a tick
 * is not a BullMQ job — it's a Postgres claim batch). Idempotency
 * key for the cron-polled tick is `(worker_name, tick_started_at_ms)`
 * — meaningful only for the structured log, not for dedup (the
 * dispatcher is a continuous process, not a BullMQ-scheduled job).
 *
 * Orphan guard (2026-09-28, CLAUDE.md §2.6). Every consumer call is
 * bounded by `consumerTimeoutMs` (`runConsumerWithOrphanGuard`) so a
 * hung network call (a BullMQ publish during a Redis outage — see
 * `queue.ts`'s `createRedisConnection`) cannot hold a tick's claim
 * transaction open forever. A timed-out call is abandoned but keeps
 * running in the background with no way to cancel it; the dispatcher
 * tracks it (`orphanedEvents`, keyed by `orphanGuardKey` — the event's
 * (topic, aggregateId), NOT its id; see that function's docstring for
 * why) and refuses to re-invoke ANY event sharing that concurrency
 * unit on a later tick until the original call actually finishes —
 * restoring, via an in-memory guard, the "never runs concurrently with
 * itself" property the `FOR UPDATE` row lock used to provide for the
 * whole consumer call before this bound existed (without it, a retry —
 * of the SAME event, or, before the 2026-09-29 key fix, of a DIFFERENT
 * event sharing the same downstream dedup key — could run a
 * concurrency unit's consumer concurrently with its own abandoned
 * attempt — safe for a simple jobId-keyed `.add()`, but demonstrably
 * NOT safe for a multi-step read-modify-write like `enqueueEmailSend`'s
 * reap-and-replace path, which has a real interleaving that sends a
 * duplicate email — architecture-guardian review, 2026-09-28 and
 * 2026-09-29).
 *
 * This guard is PROCESS-LOCAL: it prevents self-overlap within one
 * dispatcher instance, not across multiple concurrently-running
 * dispatcher replicas — a cross-process version would need a DB-backed
 * lease, not an in-memory Map; not implemented here. The design
 * therefore DEPENDS on there being exactly one live dispatcher process
 * at a time — enforced today by `--max-instances=1` on the worker
 * Cloud Run service (`.github/workflows/deploy-cloud-run.yml`). Before
 * this fix that assumption didn't matter here (a consumer call held
 * its `FOR UPDATE` lock for its whole duration, so Postgres itself kept
 * two dispatcher instances from double-processing a row); now that a
 * call can be abandoned and the row released before it settles, a
 * deploy's brief two-instance overlap window is the one time two
 * processes could each think they alone own a given orphan.
 *
 * A timeout also never counts toward `maxAttempts` on its own (see
 * `runOneTick`'s catch block) — an infrastructure outage must not
 * permanently fail an event the way a genuinely broken one should —
 * but that exemption is itself capped by `timeoutStuckCeilingMs`, past
 * which a persistently-timing-out event is allowed to fail for real.
 */
export class OutboxDispatcherWorker {
  readonly workerName = WORKER_NAME;
  readonly policy = 'cronPolicy' as const;

  private readonly claimBatchSize: number;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly maxPendingTicks: number;
  private readonly consumerTimeoutMs: number;
  private readonly timeoutStuckCeilingMs: number;
  private readonly listen?: OutboxDispatcherDeps['listen'];
  private readonly observer: OutboxObserver;

  /** Set after `start()` until `stop()`. Both the timer + LISTEN unsub. */
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private unsubscribeListen: (() => Promise<void>) | null = null;
  /** Coalesces concurrent wake-ups: only one tick runs at a time. */
  private inFlight: Promise<DispatcherTickResult> | null = null;
  /**
   * Counter of wake-ups received while a tick is in-flight. Bounded by
   * `maxPendingTicks` — anything over the cap is dropped + logged as
   * `outbox.dispatch.tick_dropped_backpressure`. Without this, a burst
   * of NOTIFY frames could pin a queue of `tick()` Promises that all
   * resolve to the same in-flight Promise and never themselves run any
   * additional work — the cap makes the bound explicit + observable.
   */
  private pendingTickCalls = 0;
  /** Set true on `stop()`; in-flight ticks drain, no new ones scheduled. */
  private shuttingDown = false;
  /**
   * `orphanGuardKey(event)` (topic + aggregateId — the real unsafe-
   * concurrency unit, NOT `event.id`; see the class docstring's "Orphan
   * guard" section) → the still-running consumer call a previous tick
   * gave up waiting on. While a key is present, no tick will invoke
   * ANY event sharing that (topic, aggregateId) again, even a
   * different event id — see `runConsumerWithOrphanGuard`. Removed
   * automatically once the abandoned call settles (resolve or reject).
   */
  private readonly orphanedEvents = new Map<
    string,
    { topic: string; aggregateId: string; promise: Promise<void> }
  >();
  /**
   * event.id → wall-clock start of that ROW's own unbroken streak of
   * `consumerTimeoutMs` timeouts. Keyed by event id (not the orphan-
   * guard key above): two different events sharing a concurrency unit
   * are different pieces of work, and one's retry history must not
   * blame or clear the other's. Cleared on a success or a non-timeout
   * failure for that event; read by `runOneTick`'s catch block against
   * `timeoutStuckCeilingMs`.
   */
  private readonly timeoutStuckSince = new Map<string, number>();

  constructor(private readonly deps: OutboxDispatcherDeps) {
    this.claimBatchSize = deps.claimBatchSize ?? DEFAULT_CLAIM_BATCH;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPendingTicks = deps.maxPendingTicks ?? DEFAULT_MAX_PENDING_TICKS;
    this.consumerTimeoutMs = normalizePositiveMs(
      deps.consumerTimeoutMs,
      DEFAULT_CONSUMER_TIMEOUT_MS,
    );
    this.timeoutStuckCeilingMs = normalizePositiveMs(
      deps.timeoutStuckCeilingMs,
      DEFAULT_TIMEOUT_STUCK_CEILING_MS,
    );
    this.listen = deps.listen;
    this.observer = deps.observer ?? NOOP_OBSERVER;
  }

  /**
   * Start the dispatcher: open the LISTEN subscription (if configured),
   * fire an immediate tick to drain backlog, then schedule the polling
   * timer. Returns when initial drain completes.
   *
   * Safe to call once per dispatcher instance. Re-entrant calls reject.
   */
  async start(): Promise<void> {
    if (this.pollHandle || this.unsubscribeListen) {
      throw new Error('OutboxDispatcherWorker already started');
    }
    this.shuttingDown = false;

    if (this.listen) {
      // The LISTEN handler does NOT await the tick — wake-ups are
      // fire-and-forget; concurrent wakes coalesce via `inFlight`.
      // Errors are caught + logged: a failed tick must not crash the
      // notification subscription (silent-failure-hunter).
      this.unsubscribeListen = await this.listen(() => {
        void this.tick().catch((err) => this.logTickError(err));
      });
    }

    // Drain any backlog before returning so a boot-time enqueue does
    // not wait `pollIntervalMs` for its first delivery.
    await this.tick().catch((err) => this.logTickError(err));

    this.pollHandle = setInterval(() => {
      void this.tick().catch((err) => this.logTickError(err));
    }, this.pollIntervalMs);
    // Don't keep the process alive solely on the poll timer; the
    // LISTEN connection (or whatever spawned us) is the foreground.
    this.pollHandle.unref();
  }

  /**
   * Stop the dispatcher gracefully: cancel the poll timer, wait for
   * any in-flight tick to drain, then close the LISTEN subscription.
   *
   * Idempotent — extra calls after the first are no-ops.
   *
   * Does NOT wait for orphaned consumer calls tracked in
   * `orphanedEvents` — those are, by definition, calls this process has
   * already given up waiting on, and a sustained outage could make
   * waiting for them here take as long as the outage itself. They
   * continue running detached until they settle or the process exits;
   * see the class docstring's "Orphan guard" section.
   */
  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.inFlight) {
      // Awaiting the same Promise the tick stored — never rejects
      // (tick catches internally). Documented for future drift.
      try {
        await this.inFlight;
      } catch {
        // tick() never rejects; defense-in-depth for future refactors.
      }
    }
    if (this.unsubscribeListen) {
      const unsub = this.unsubscribeListen;
      this.unsubscribeListen = null;
      await unsub();
    }
  }

  /**
   * Run one tick: claim up to `claimBatchSize` pending rows, dispatch
   * each, return the counters. Exposed (not private) for the test
   * harness — production code wakes ticks via `start()` + LISTEN/poll.
   *
   * Coalesces with any in-flight tick: a second concurrent call returns
   * the same in-flight Promise rather than starting a parallel claim.
   * That prevents a flurry of NOTIFYs from running N ticks of the same
   * SKIP LOCKED claim against each other for the same rows.
   */
  async tick(): Promise<DispatcherTickResult> {
    if (this.shuttingDown) {
      return { ...EMPTY_TICK_RESULT };
    }
    if (this.inFlight) {
      // Back-pressure: a NOTIFY flurry can queue dozens of wake-ups
      // against the same in-flight tick. Beyond `maxPendingTicks` we
      // drop the wake — the in-flight tick will drain everything it
      // can see, and the polling timer covers any genuinely-missed
      // row. Dropping is preferable to letting a long Promise list
      // pile up in memory.
      if (this.pendingTickCalls >= this.maxPendingTicks) {
        console.log(
          JSON.stringify({
            level: 'info',
            kind: 'outbox.dispatch.tick_dropped_backpressure',
            worker: this.workerName,
            pendingTickCalls: this.pendingTickCalls,
            maxPendingTicks: this.maxPendingTicks,
          }),
        );
        return { ...EMPTY_TICK_RESULT };
      }
      this.pendingTickCalls += 1;
      try {
        return await this.inFlight;
      } finally {
        this.pendingTickCalls -= 1;
      }
    }
    const promise = this.runOneTick().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = promise;
    return promise;
  }

  /**
   * Invoke the consumer for `event`, bounded by `consumerTimeoutMs`. On
   * timeout, tracks the still-running call as an orphan
   * (`orphanedEvents`, keyed by `orphanGuardKey(event)`) so no LATER
   * tick invokes the SAME (topic, aggregateId) concurrency unit's
   * consumer again until the original call actually finishes — see the
   * class docstring's "Orphan guard" section for why that matters.
   */
  private runConsumerWithOrphanGuard(event: DispatchedEvent): Promise<void> {
    const consumerPromise = this.deps.consumer(event);
    return withConsumerTimeout(consumerPromise, this.consumerTimeoutMs, event, this.observer).catch(
      (err: unknown) => {
        if (isOutboxTimeoutError(err)) {
          this.trackOrphan(event, consumerPromise);
        }
        throw err;
      },
    );
  }

  /** Track `consumerPromise` as an in-flight orphan for `event`'s concurrency unit until it settles. */
  private trackOrphan(event: DispatchedEvent, consumerPromise: Promise<void>): void {
    const key = orphanGuardKey(event);
    this.orphanedEvents.set(key, {
      topic: event.topic,
      aggregateId: event.aggregateId,
      promise: consumerPromise,
    });
    const clear = (): void => {
      // Only clear if this is still the entry we set — defensive: a
      // given concurrency unit is never invoked again while orphaned,
      // so in practice there is only ever one entry per key at a time.
      if (this.orphanedEvents.get(key)?.promise === consumerPromise) {
        this.orphanedEvents.delete(key);
      }
    };
    consumerPromise.then(clear, clear);
  }

  /**
   * The actual claim + dispatch loop. Wrapped in `tick()` for
   * coalescing.
   *
   * Important: the SKIP LOCKED SELECT and the per-row UPDATEs run in
   * ONE transaction. The row locks acquired by `FOR UPDATE` persist
   * until commit, so a concurrent dispatcher's SKIP LOCKED scan
   * passes over them and grabs different rows. On commit, the
   * `dispatched`/`failed` flip is visible atomically — the row leaves
   * the partial index in one go.
   *
   * Per-row dispatch failures are isolated via savepoints (Drizzle
   * `tx.transaction()` nests as a SAVEPOINT in Postgres) — one bad
   * consumer cannot poison the rest of the batch.
   *
   * Lock-expiry / crash recovery window (D203, `cronPolicy`).
   * --------------------------------------------------------
   * `FOR UPDATE SKIP LOCKED` holds row-level locks ONLY for the
   * duration of the claim transaction. If the Postgres backend dies
   * (worker OOM-killed, server crash, network partition that drops the
   * connection) AFTER the claim SELECT but BEFORE the surrounding
   * commit, the locks are released by Postgres connection cleanup and
   * the row reverts to `status='pending'` with its pre-claim `attempts`
   * value. The next dispatcher tick will re-claim it.
   *
   * The audit guard on the failure-UPDATE WHERE clause
   * (`attempts = currentAttempts`) defends against the related race
   * where two ticks claim the same row in different processes after a
   * crash: only the tick whose view of `attempts` still matches the
   * row's actual value wins the update. The losing tick's bookkeeping
   * write is a no-op (0 rows affected), so we don't double-bump
   * `attempts` past `maxAttempts` and prematurely flip to `failed`.
   *
   * What's NOT defended: a consumer that succeeds (e.g. enqueues to
   * BullMQ) and then the dispatcher's commit fails, OR an abandoned
   * (timed-out) call that succeeds after a LATER retry has already
   * re-run it — the orphan guard (below) guarantees that re-run only
   * ever happens SEQUENTIALLY, after the original call settled, never
   * concurrently with it, which is what makes every consumer's existing
   * idempotent-on-redelivery design (already required by the
   * `OutboxConsumer` port) sufficient protection for both cases. See the
   * port docstring.
   *
   * A narrower, related fact: this savepoint's rollback-on-throw only
   * ever undoes the bookkeeping UPDATE below (`sp.update(...)`), NOT
   * anything the consumer itself wrote to the database. The consumer
   * closure is built once at the composition root
   * (`buildOutboxConsumer(db, ...)` in `apps/api/src/worker.ts`) against
   * the plain root `db`, never against `tx`/`sp` — the `OutboxConsumer`
   * type only ever receives the `DispatchedEvent`, no db handle — so any
   * `db.insert`/`db.update` a consumer does runs on its own connection
   * and commits independently of whether this transaction later commits
   * or a later step in the SAME consumer call throws. The transaction's
   * actual job is narrower than "isolates one consumer's effects" — it
   * isolates only the dispatcher's OWN status/attempts bookkeeping.
   *
   * `this.deps.consumer(event)` below runs through
   * `runConsumerWithOrphanGuard`, which bounds it with
   * `consumerTimeoutMs` (a hung network call can no longer hold this
   * transaction open indefinitely) and tracks a timed-out call as an
   * orphan so no later tick re-invokes the SAME event concurrently with
   * it. This bounds — it does not remove — the network call from inside
   * the transaction: a full batch hitting the same outage can still
   * hold it for up to `claimBatchSize * consumerTimeoutMs`. Moving the
   * call fully outside the transaction would need a different
   * claim/commit protocol (this dispatcher relies on holding the `FOR
   * UPDATE` lock across the consumer call so a crash reverts the row to
   * `pending` for free — see the lock-expiry section above; committing
   * the claim first would need a lease/visibility-timeout scheme
   * instead) — a larger, separate change this PR does not attempt.
   */
  private async runOneTick(): Promise<DispatcherTickResult> {
    const result: DispatcherTickResult = { ...EMPTY_TICK_RESULT };
    // Consumer failures this tick recorded, reported only once the claim
    // transaction has committed them — never a log or Sentry call inside
    // it, and nothing reported for bookkeeping that rolled back.
    const failures: ConsumerFailure[] = [];

    try {
      await this.deps.db.transaction(async (tx) => {
        // Exclude every currently-orphaned (topic, aggregateId) unit
        // from the claim itself, rather than claiming it and skipping
        // it in the loop below. Orphaned rows never age out of
        // `ORDER BY created_at`'s FIFO order — they keep their original
        // `created_at` and `attempts` untouched — so once the number of
        // distinct orphaned keys reaches `claimBatchSize`, a
        // claim-then-skip design re-claims the SAME stuck rows on
        // every tick forever, and any genuinely-processable row behind
        // them in FIFO order is never claimed at all: a livelock during
        // a real outage (architecture-guardian review, 2026-09-29).
        // Excluding them here lets SKIP LOCKED's own query plan move
        // past them to the next claimable rows within the same LIMIT.
        const orphanExclusion =
          this.orphanedEvents.size === 0
            ? sql``
            : sql`AND NOT (${sql.join(
                [...this.orphanedEvents.values()].map(
                  (orphan) =>
                    sql`(topic = ${orphan.topic} AND aggregate_id = ${orphan.aggregateId})`,
                ),
                sql` OR `,
              )})`;
        // Claim a batch with FOR UPDATE SKIP LOCKED — Postgres locks
        // these rows for the duration of THIS transaction; a parallel
        // dispatcher's claim transaction sees them locked and skips
        // past them to the next un-locked row.
        const claimed = await tx.execute<{
          id: string;
          topic: string;
          aggregate_id: string;
          payload: unknown;
          attempts: number;
          created_at: Date;
        }>(sql`
          SELECT id, topic, aggregate_id, payload, attempts, created_at
          FROM outbox_events
          WHERE status = 'pending'
          ${orphanExclusion}
          ORDER BY created_at
          LIMIT ${this.claimBatchSize}
          FOR UPDATE SKIP LOCKED
        `);

        // Driver-shape adapter (postgres-js vs PGlite): postgres-js'
        // `execute` returns an iterable RowList; PGlite returns
        // `{ rows: Row[] }`. Normalize so the dispatcher reads the
        // same way against either driver.
        const rows: Array<{
          id: string;
          topic: string;
          aggregate_id: string;
          payload: unknown;
          attempts: number;
          created_at: Date;
        }> = Array.isArray(claimed)
          ? (claimed as unknown as Array<{
              id: string;
              topic: string;
              aggregate_id: string;
              payload: unknown;
              attempts: number;
              created_at: Date;
            }>)
          : ((claimed as unknown as { rows: typeof rows }).rows ?? []);

        result.claimed = rows.length;
        if (rows.length === 0) {
          return;
        }

        for (const row of rows) {
          const event: DispatchedEvent = {
            id: row.id,
            topic: row.topic,
            aggregateId: row.aggregate_id,
            payload: row.payload as OutboxEvent['payload'],
            attempts: row.attempts,
            createdAt: row.created_at,
          };
          // The SQL claim above already excludes a key orphaned BEFORE
          // this tick started. This check catches the one window that
          // can't be excluded at claim time: a row LATER in this SAME
          // claimed batch sharing a (topic, aggregateId) with an
          // EARLIER row in the batch that just timed out and orphaned,
          // mid-tick (rows are processed one at a time, sequentially —
          // see the loop below). Re-invoking it now would run that
          // concurrency unit's consumer concurrently with the still-
          // running orphaned call, which is not safe for every consumer
          // today (see the class docstring's "Orphan guard" section).
          // Leave the row completely untouched — still `pending`,
          // `attempts` unchanged — until the orphan settles.
          if (this.orphanedEvents.has(orphanGuardKey(event))) {
            continue;
          }
          // Per-row savepoint isolates one consumer failure from the
          // rest of the batch — a thrown consumer rolls back ONLY its
          // own UPDATE attempt and the outer tx continues to the next
          // row. Without this, one bad row would force a tx rollback
          // and we'd re-claim the whole batch next tick (livelock).
          try {
            await tx.transaction(async (sp) => {
              await this.runConsumerWithOrphanGuard(event);
              await sp
                .update(outboxEvents)
                .set({ status: 'dispatched', dispatchedAt: new Date() })
                .where(eq(outboxEvents.id, event.id));
            });
            result.dispatched += 1;
            // This event's timeout streak (if it had one) is over.
            this.timeoutStuckSince.delete(event.id);
          } catch (err) {
            result.consumerFailed += 1;
            const isTimeout = isOutboxTimeoutError(err);
            if (isTimeout) {
              result.consumerTimedOut += 1;
            }
            const nextAttempts = event.attempts + 1;
            const lastError = truncateError(err);
            // A timeout is an infrastructure failure (Redis/DB slow or
            // down), not evidence the EVENT is broken — `maxAttempts`
            // exists to stop a persistently-broken event from spinning
            // forever (see the dep's docstring), and failing to reach
            // a downstream dependency is not that. Excluding timeouts
            // also matters in practice because the orphaned event is
            // now skip-guarded above: `attempts` cannot even be bumped
            // again until the orphan settles, so a sustained outage
            // cannot burn through `maxAttempts` and permanently fail
            // an event that a few more minutes would have delivered
            // (silent-failure-hunter + architecture-guardian review,
            // 2026-09-28 — the previous version of this fix could flip
            // a row to `failed` after roughly 2.5-7.5 minutes of Redis
            // being down, sometimes AFTER the abandoned call had
            // already succeeded).
            //
            // That exemption has no end state on its own — a row whose
            // OWN streak of timeouts never breaks would otherwise retry
            // forever with no Sentry signal (2026-09-29 review). Track
            // the streak's start per event id (not the orphan-guard
            // key: a different event sharing this one's concurrency
            // unit has its own, independent streak) and, once it has
            // run longer than `timeoutStuckCeilingMs`, let this timeout
            // fail like any other exhausted event instead of exempting
            // it again.
            let timeoutStreakExceededCeiling = false;
            if (isTimeout) {
              const streakStartedAt = this.timeoutStuckSince.get(event.id) ?? Date.now();
              if (!this.timeoutStuckSince.has(event.id)) {
                this.timeoutStuckSince.set(event.id, streakStartedAt);
              }
              timeoutStreakExceededCeiling =
                Date.now() - streakStartedAt >= this.timeoutStuckCeilingMs;
            } else {
              // A genuine (non-timeout) failure ends any prior timeout
              // streak this event had — it is no longer "stuck on
              // infrastructure," it is failing for a different reason,
              // and `nextAttempts >= maxAttempts` below already governs
              // it.
              this.timeoutStuckSince.delete(event.id);
            }
            const shouldFail =
              timeoutStreakExceededCeiling || (!isTimeout && nextAttempts >= this.maxAttempts);
            if (shouldFail) {
              this.timeoutStuckSince.delete(event.id);
            }
            // The savepoint that ran the consumer + UPDATE rolled
            // back; the bookkeeping UPDATE runs in the outer tx so it
            // commits even on consumer failure. Without this, a
            // thrown consumer would leave `attempts` un-bumped and
            // the row would retry forever with no audit trail.
            //
            // Audit guard: `attempts = event.attempts` on the WHERE
            // clause. If a parallel tick (post-crash, see
            // lock-expiry doc above) already bumped the row, our
            // update affects 0 rows and our bookkeeping is a no-op
            // instead of clobbering theirs. There is no lock-token
            // column on `outbox_events`; the attempts counter doubles
            // as the optimistic-concurrency token, which is enough
            // because attempts only ever increases.
            const bumped = await tx
              .update(outboxEvents)
              .set({
                attempts: nextAttempts,
                lastError,
                ...(shouldFail ? { status: 'failed' as const } : {}),
              })
              .where(
                and(
                  eq(outboxEvents.id, event.id),
                  eq(outboxEvents.status, 'pending'),
                  eq(outboxEvents.attempts, event.attempts),
                ),
              )
              .returning({ id: outboxEvents.id });
            if (shouldFail) {
              result.flippedToFailed += 1;
            }
            // A parallel tick that bumped the row first owns this attempt,
            // and reports it.
            if (bumped.length > 0) {
              failures.push({
                event,
                error: err,
                attempts: nextAttempts,
                failed: shouldFail,
                timedOut: isTimeout,
              });
            }
          }
        }
      });
      for (const failure of failures) this.reportConsumerFailure(failure);
    } catch (err) {
      // Tx-level failure (db down, deadlock, etc.) — log and continue;
      // the next tick re-attempts. Never throw out of a tick: callers
      // (`setInterval`, LISTEN handler) don't have a catch path.
      this.logTickError(err);
    }

    // A gauge, not a per-tick count: how many distinct concurrency
    // units are orphan-guarded RIGHT NOW, including any this very tick
    // just created. See `DispatcherTickResult.skippedOrphaned`.
    result.skippedOrphaned = this.orphanedEvents.size;

    // Also log when nothing was claimed but an orphan is outstanding —
    // otherwise a sustained outage (every claimable row excluded by the
    // orphan guard, `claimed` pinned at 0 every tick) goes completely
    // silent in the logs at exactly the moment it most needs to be
    // visible.
    if (result.claimed > 0 || result.skippedOrphaned > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'outbox.tick',
          worker: this.workerName,
          ...result,
        }),
      );
    }
    return result;
  }

  /**
   * One consumer throw, after its bookkeeping committed. Every attempt
   * logs at warn; the attempt that flips the row to `failed` logs at
   * error and goes to the observer, because that row is never claimed
   * again — its work is lost unless someone replays it. The error's name
   * only: a query error's message can carry its parameters.
   *
   * `timedOut` lets a `failed` line be told apart from a `maxAttempts`
   * exhaustion: when true, this is a `timeoutStuckCeilingMs` failure —
   * the event kept timing out past the ceiling, not a consumer that
   * kept throwing a real error.
   */
  private reportConsumerFailure({
    event,
    error,
    attempts,
    failed,
    timedOut,
  }: ConsumerFailure): void {
    const fields = {
      worker: this.workerName,
      topic: event.topic,
      eventId: event.id,
      attempts,
      errorName: error instanceof Error ? error.name : typeof error,
      timedOut,
    };
    if (!failed) {
      console.warn(
        JSON.stringify({ level: 'warn', kind: 'outbox.dispatch.consumer_failed', ...fields }),
      );
      return;
    }
    console.error(
      JSON.stringify({ level: 'error', kind: 'outbox.dispatch.event_failed', ...fields }),
    );
    // `tags`, not top-level: see `OutboxObserver`'s docstring. `event_id`
    // matches the Sentry tag naming convention (`SENTRY_SERVER_TAG_ALLOWLIST`).
    this.observer.captureBackgroundFailure(error, {
      kind: 'outbox.dispatch.event_failed',
      tags: { worker: this.workerName, topic: event.topic, event_id: event.id },
    });
  }

  private logTickError(err: unknown): void {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'outbox.dispatch.tick_failed',
        worker: this.workerName,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    // Same bug this file's `reportConsumerFailure` had until 2026-09-28:
    // `worker` belongs under `tags`, not as a sibling of `kind` — the
    // production adapter reads only those two keys.
    // Hand to the observer (Sentry in prod, no-op by default). Tick
    // failures are background failures by definition — there's no
    // HTTP request to surface the error on. Without this, a tx-level
    // problem (db down, deadlock storm) would only show up in stdout
    // logs and miss the alerting path.
    this.observer.captureBackgroundFailure(err, {
      kind: 'outbox.dispatch.tick_failed',
      tags: { worker: this.workerName },
    });
  }
}

/** Truncate an error message for storage in `outbox_events.last_error`. */
function truncateError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (raw.length <= LAST_ERROR_MAX_LEN) {
    return raw;
  }
  return `${raw.slice(0, LAST_ERROR_MAX_LEN - 3)}...`;
}
