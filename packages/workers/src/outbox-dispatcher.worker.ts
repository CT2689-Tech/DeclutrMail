import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { outboxEvents } from '@declutrmail/db';
import type { OutboxEvent, schema } from '@declutrmail/db';

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
 *     for the next tick to retry.
 *   - The consumer MUST be idempotent on `event.id`: at-least-once
 *     delivery is the dispatcher's guarantee, and consumer-side dedup
 *     (e.g. BullMQ `jobId: event.id`) is the at-most-once correction.
 *   - Throws here do NOT crash the worker — the dispatcher isolates one
 *     row's failure from the rest of the batch.
 */
export type OutboxConsumer = (event: DispatchedEvent) => Promise<void>;

/**
 * Optional background-failure capture port (D159). Implemented in the
 * composition root by wiring to `@sentry/node`'s `captureException`. The
 * dispatcher remains framework-agnostic: it knows how to call the port
 * and what context to pass; it does NOT depend on Sentry directly.
 *
 * Defaults to a no-op so tests and bare-bones bootstraps run without
 * needing Sentry configured. The shape mirrors what later worker tooling
 * (e.g. a future `SentryWorkerObserver` per PR #49) will expose.
 */
export interface OutboxObserver {
  captureBackgroundFailure(
    error: unknown,
    context: { kind: string; worker: string; [key: string]: unknown },
  ): void;
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
   * persistently-broken event from spinning forever.
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
}

const DEFAULT_CLAIM_BATCH = 32;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_PENDING_TICKS = 16;
const NOOP_OBSERVER: OutboxObserver = {
  captureBackgroundFailure: () => undefined,
};

/**
 * One dispatcher tick's result counters — returned for the test harness
 * and the structured log.
 */
export interface DispatcherTickResult {
  /** Rows claimed by the SKIP LOCKED query this tick. */
  claimed: number;
  /** Rows whose consumer returned successfully and were marked dispatched. */
  dispatched: number;
  /** Rows whose consumer threw; left pending unless `failed` below. */
  consumerFailed: number;
  /** Rows that exceeded `maxAttempts` and were flipped to `failed`. */
  flippedToFailed: number;
}

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
 * Polling safety net: every `pollIntervalMs` (default 5s) the
 * dispatcher runs a tick whether or not a notification fired. Covers
 * the windows where NOTIFY can be lost — worker restart between the
 * publisher's commit and the listener's connection ready, Postgres
 * failover, or a network partition that drops the wire-protocol async
 * frame.
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
 */
export class OutboxDispatcherWorker {
  readonly workerName = 'OutboxDispatcherWorker';
  readonly policy = 'cronPolicy' as const;

  private readonly claimBatchSize: number;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly maxPendingTicks: number;
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

  constructor(private readonly deps: OutboxDispatcherDeps) {
    this.claimBatchSize = deps.claimBatchSize ?? DEFAULT_CLAIM_BATCH;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPendingTicks = deps.maxPendingTicks ?? DEFAULT_MAX_PENDING_TICKS;
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
      return { claimed: 0, dispatched: 0, consumerFailed: 0, flippedToFailed: 0 };
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
        return { claimed: 0, dispatched: 0, consumerFailed: 0, flippedToFailed: 0 };
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
   * BullMQ) and then the dispatcher's commit fails. The consumer ran
   * — its idempotency guarantee (consumer-side dedup on `event.id`)
   * is the only protection, which is why the `OutboxConsumer` port
   * contract requires idempotency. See the port docstring.
   */
  private async runOneTick(): Promise<DispatcherTickResult> {
    const result: DispatcherTickResult = {
      claimed: 0,
      dispatched: 0,
      consumerFailed: 0,
      flippedToFailed: 0,
    };

    try {
      await this.deps.db.transaction(async (tx) => {
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
          // Per-row savepoint isolates one consumer failure from the
          // rest of the batch — a thrown consumer rolls back ONLY its
          // own UPDATE attempt and the outer tx continues to the next
          // row. Without this, one bad row would force a tx rollback
          // and we'd re-claim the whole batch next tick (livelock).
          try {
            await tx.transaction(async (sp) => {
              await this.deps.consumer(event);
              await sp
                .update(outboxEvents)
                .set({ status: 'dispatched', dispatchedAt: new Date() })
                .where(eq(outboxEvents.id, event.id));
            });
            result.dispatched += 1;
          } catch (err) {
            result.consumerFailed += 1;
            const nextAttempts = event.attempts + 1;
            const lastError = truncateError(err);
            const shouldFail = nextAttempts >= this.maxAttempts;
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
            await tx
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
              );
            if (shouldFail) {
              result.flippedToFailed += 1;
            }
          }
        }
      });
    } catch (err) {
      // Tx-level failure (db down, deadlock, etc.) — log and continue;
      // the next tick re-attempts. Never throw out of a tick: callers
      // (`setInterval`, LISTEN handler) don't have a catch path.
      this.logTickError(err);
    }

    if (result.claimed > 0) {
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

  private logTickError(err: unknown): void {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'outbox.dispatch.tick_failed',
        worker: this.workerName,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    // Hand to the observer (Sentry in prod, no-op by default). Tick
    // failures are background failures by definition — there's no
    // HTTP request to surface the error on. Without this, a tx-level
    // problem (db down, deadlock storm) would only show up in stdout
    // logs and miss the alerting path.
    this.observer.captureBackgroundFailure(err, {
      kind: 'outbox.dispatch.tick_failed',
      worker: this.workerName,
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
