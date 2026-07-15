import { and, eq, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { cronRuns, mailMessages, mailboxAccounts, senderPolicies } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';
import { getActionDescriptor } from '@declutrmail/shared/actions';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { GmailMutationAccess } from './gmail-mutation-client.js';
import type { MailboxActionLock } from './label-action.worker.js';
import { createLimiter } from './reasoning.js';
import type { SnoozeLabelMapStore } from './snooze-wake.queue.js';
import type { WorkerContext } from './worker-context.js';
import { isNonRetryable, ValidationError } from './worker-errors.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * SnoozeWakeWorker (D78–D80) — restores a snoozed/Later'd sender's mail
 * to the inbox.
 *
 * Two job shapes ride one queue:
 *
 *   - `sweep` — the 15-minute cron tick (D225 `cronPolicy`). Scans the
 *     `sender_policies_snooze_wake_idx` partial index for due timers
 *     (`snoozed_until <= now()`) on ACTIVE mailboxes and wakes each due
 *     sender (due timers on disconnected mailboxes lie dormant until
 *     reconnect — see `sweep`). Also
 *     refreshes the per-mailbox Later-label-id mapping in Redis (see
 *     snooze-wake.queue.ts) for any mailbox whose key is missing, so
 *     the API's Snoozed LIST read stays answerable without a Gmail
 *     client in the HTTP process.
 *   - `wake` — a targeted wake-now for one sender, produced by
 *     `POST /api/snoozed/:senderId/wake`.
 *
 * The wake itself (`wakeSender`):
 *
 *   1. Resolves the canonical Later label NAME to its per-mailbox Gmail
 *      ID (`ensureLabelId` — find-or-create, same boundary the
 *      label-action pipeline uses) and publishes the mapping.
 *   2. Resolves the durable restore set from the LOCAL label mirror —
 *      every `mail_messages` row for the sender currently carrying the
 *      Later label id. This is ground truth maintained by the
 *      label-action worker's terminal tx + Gmail sync, so an undone
 *      Later (label removed) is naturally excluded.
 *   3. `messages.batchModify` — re-add `INBOX`, remove the Later id.
 *      Both directions are Gmail no-ops on a message already in the
 *      target state, so a BullMQ retry of an applied batch is safe.
 *   4. One transaction: local mirror update (same idempotent
 *      array-expression algorithm as the label-action worker) + clear
 *      `snoozed_until/at/reason` (D79 — "the sender_policies row
 *      clears").
 *
 * NO undo journal entry and NO activity_log row are written: a wake is
 * a RESTORE, and restores are not activity-logged anywhere in this
 * codebase (the undo/reverse path of the label-action worker writes no
 * activity row either). The `activity_action` pg_enum has no honest
 * value for "restored to inbox" — writing `keep`/`later` would corrupt
 * the triage-decided and verb-count reads built on that column. A
 * dedicated `woken` enum value + activity rows is flagged as a
 * follow-up for the next schema window (see PR body).
 *
 * Failure isolation: the sweep wraps each due sender in try/catch — a
 * failed wake is counted, logged, persisted as a safe recovery state,
 * and the row STAYS DUE (`snoozed_until` untouched), so the next sweep
 * retries it naturally. The targeted wake path relies on BullMQ retries
 * and persists the recovery state only after terminal failure.
 *
 * Idempotency: BullMQ jobId (see snooze-wake.queue.ts) dedups enqueues;
 * the sweep additionally claims a `cron_runs` row
 * (`INSERT … ON CONFLICT DO NOTHING`) per D225 so two worker replicas
 * cannot run the same scheduled minute; and `wakeSender` itself is a
 * no-op when the sender has no Later-labelled mail and no timer.
 *
 * PRIVACY (D7, D228): label ids + message ids + timestamps only. No
 * body, snippet, or header crosses this worker.
 */

/** The canonical Later label NAME, read from the Action Registry
 * (ADR-0015) — the same source the label-action pipeline mutates with,
 * so the wake removes exactly the label the Later verb added. */
export function laterLabelName(): string {
  const { execution } = getActionDescriptor('later');
  if (execution.kind !== 'label-modify') {
    throw new Error("Action Registry drift: 'later' is no longer a label-modify verb");
  }
  const name = execution.buildLabelChange({}).forward.addLabelIds?.[0];
  if (!name) {
    throw new Error("Action Registry drift: 'later' forward change adds no label");
  }
  return name;
}

export type SnoozeWakeJobData =
  | { kind: 'sweep'; scheduledAtMinute: string }
  | {
      kind: 'wake';
      mailboxAccountId: string;
      senderKey: string;
      scheduledAtMinute: string;
      /** Every targeted job pins one timer so a later reschedule always wins. */
      expectedSnoozedUntil: string;
      expectedSnoozedAt: string | null;
      /** Distinguishes a deliberate retry while deduping the same request. */
      attemptDiscriminator: string;
    };

/** Metric-only result — logged on `worker.succeeded`. */
export interface SnoozeWakeResult {
  kind: 'sweep' | 'wake';
  /** Due timers seen this pass (sweep) or 1 (targeted wake). */
  dueProcessed: number;
  /** Senders whose wake completed (Gmail + mirror + timer clear). */
  woken: number;
  /** Messages restored to INBOX across all wakes this pass. */
  restoredMessages: number;
  /** Due senders whose wake threw (left due; retried next sweep). */
  failed: number;
  /** Mailboxes whose Later-label-id mapping was (re)published. */
  mappingsRefreshed: number;
  /** True when another replica already claimed this cron minute. */
  skippedDuplicateRun: boolean;
  durationMs: number;
}

export interface SnoozeWakeDeps {
  db: WorkerDb;
  gmailMutation: GmailMutationAccess;
  /** Later-label-id mapping publisher (Redis in production). */
  labelMap: SnoozeLabelMapStore;
  /** Same per-mailbox lock used by label actions and schedule writes. */
  lock: MailboxActionLock;
  /** Override clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Bounded-concurrency cap for the per-mailbox fan-out (mapping
   * refresh + due-wake groups). Defaults to 4 — sweeps touch Gmail, so
   * the cap stays small; tests inject 1 for deterministic ordering.
   */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 4;

interface SnoozeTimerVersion {
  snoozedUntil: Date;
  snoozedAt: Date | null;
}

export class SnoozeWakeWorker extends BaseDeclutrWorker<SnoozeWakeJobData, SnoozeWakeResult> {
  override readonly workerName = 'SnoozeWakeWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: SnoozeWakeDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: SnoozeWakeJobData): string {
    return payload.kind === 'sweep'
      ? `${this.workerName}:sweep:${payload.scheduledAtMinute}`
      : `${this.workerName}:wake:${payload.mailboxAccountId}:${payload.senderKey}:${payload.expectedSnoozedUntil}:${payload.expectedSnoozedAt ?? 'none'}:${payload.attemptDiscriminator}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    payload: SnoozeWakeJobData,
    ctx: WorkerContext,
  ): Promise<SnoozeWakeResult> {
    return payload.kind === 'sweep' ? this.runSweep(payload) : this.runTargetedWake(payload, ctx);
  }

  // ── Targeted wake (wake-now) ────────────────────────────────────────

  private async runTargetedWake(
    payload: Extract<SnoozeWakeJobData, { kind: 'wake' }>,
    ctx: WorkerContext,
  ): Promise<SnoozeWakeResult> {
    const startedAt = Date.now();
    return this.deps.lock.run(payload.mailboxAccountId, async () => {
      const version = timerVersionFromJob(payload);

      try {
        const restored = await this.wakeSender(
          payload.mailboxAccountId,
          payload.senderKey,
          version,
        );
        const woken = restored === null ? 0 : 1;
        return {
          kind: 'wake',
          dueProcessed: 1,
          woken,
          restoredMessages: restored ?? 0,
          failed: 0,
          mappingsRefreshed: woken,
          skippedDuplicateRun: false,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (isNonRetryable(error) || ctx.attempt >= ctx.maxAttempts) {
          await this.recordWakeFailure(payload.mailboxAccountId, payload.senderKey, version, error);
        }
        throw error;
      }
    });
  }

  // ── Cron sweep ──────────────────────────────────────────────────────

  private async runSweep(
    payload: Extract<SnoozeWakeJobData, { kind: 'sweep' }>,
  ): Promise<SnoozeWakeResult> {
    const startedAt = Date.now();
    const now = (this.deps.now ?? (() => new Date()))();

    const runKey = `${this.workerName}:${payload.scheduledAtMinute}`;
    const claimed = await this.deps.db
      .insert(cronRuns)
      .values({ workerName: this.workerName, runKey })
      .onConflictDoNothing({ target: cronRuns.runKey })
      .returning({ id: cronRuns.id });
    if (claimed.length === 0) {
      // Another replica claimed this minute — exit without scanning.
      return {
        kind: 'sweep',
        dueProcessed: 0,
        woken: 0,
        restoredMessages: 0,
        failed: 0,
        mappingsRefreshed: 0,
        skippedDuplicateRun: true,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const result = await this.sweep(now);
      await this.finishCronRun(runKey, 'succeeded');
      return { ...result, durationMs: Date.now() - startedAt };
    } catch (err) {
      await this.finishCronRun(runKey, 'failed');
      throw err;
    }
  }

  private async finishCronRun(runKey: string, status: 'succeeded' | 'failed'): Promise<void> {
    await this.deps.db
      .update(cronRuns)
      .set({ status, finishedAt: sql`now()` })
      .where(eq(cronRuns.runKey, runKey));
  }

  private async sweep(now: Date): Promise<Omit<SnoozeWakeResult, 'durationMs'>> {
    // Due timers — hits the partial wake-scan index (schema D79).
    // Active mailboxes only: disconnect preserves sender_policies rows
    // (incl. live timers) but nullifies the OAuth token, so a wake on a
    // disconnected mailbox can only throw. Due timers there lie DORMANT
    // — rows untouched — and become eligible again the moment the
    // mailbox status flips back to 'active' on reconnect.
    const due = await this.deps.db
      .select({
        mailboxAccountId: senderPolicies.mailboxAccountId,
        senderKey: senderPolicies.senderKey,
        snoozedUntil: senderPolicies.snoozedUntil,
        snoozedAt: senderPolicies.snoozedAt,
      })
      .from(senderPolicies)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, senderPolicies.mailboxAccountId))
      .where(
        and(
          eq(mailboxAccounts.status, 'active'),
          isNotNull(senderPolicies.snoozedUntil),
          lte(senderPolicies.snoozedUntil, now),
          // A deterministic failure needs explicit user/support action;
          // do not burn Gmail quota retrying it every 15 minutes forever.
          or(
            isNull(senderPolicies.snoozeWakeFailureKind),
            ne(senderPolicies.snoozeWakeFailureKind, 'needs_attention'),
          ),
        ),
      );

    const byMailbox = new Map<string, Array<{ senderKey: string; version: SnoozeTimerVersion }>>();
    for (const row of due) {
      const timers = byMailbox.get(row.mailboxAccountId) ?? [];
      timers.push({
        senderKey: row.senderKey,
        version: { snoozedUntil: row.snoozedUntil!, snoozedAt: row.snoozedAt },
      });
      byMailbox.set(row.mailboxAccountId, timers);
    }

    let woken = 0;
    let restoredMessages = 0;
    let failed = 0;

    const concurrency = this.deps.concurrency ?? DEFAULT_CONCURRENCY;
    const limiter = createLimiter(concurrency);

    // Wake due senders, grouped per mailbox so one Gmail client (and
    // its label-id cache) serves all of a mailbox's wakes this pass.
    // Counter mutation happens only in awaited limiter bodies — the
    // limiter serializes increments with the surrounding await.
    await Promise.all(
      Array.from(byMailbox.entries()).map(([mailboxAccountId, timers]) =>
        limiter(async () => {
          await this.deps.lock.run(mailboxAccountId, async () => {
            for (const { senderKey, version } of timers) {
              try {
                const restored = await this.wakeSender(mailboxAccountId, senderKey, version);
                // A reschedule/new Later action made the captured sweep
                // version stale before this mailbox acquired the lock.
                if (restored === null) continue;
                restoredMessages += restored;
                woken += 1;
              } catch (err) {
                // The timer stays due — retryable failures are eligible
                // next sweep; deterministic ones are excluded above.
                failed += 1;
                await this.recordWakeFailure(mailboxAccountId, senderKey, version, err);
                console.error(
                  JSON.stringify({
                    level: 'error',
                    kind: 'snooze.wake_failed',
                    worker: this.workerName,
                    mailboxAccountId,
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              }
            }
          });
        }),
      ),
    );

    // Refresh the Later-label-id mapping for active mailboxes missing
    // it (the completed wakes above already published theirs).
    // Disconnected mailboxes are skipped — no Gmail client exists for
    // them, and their lists have no live reader. Per-mailbox try/catch
    // so one failing mailbox cannot stop the others.
    let mappingsRefreshed = woken;
    const mailboxes = await this.deps.db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.status, 'active'));
    await Promise.all(
      mailboxes
        .filter((mb) => !byMailbox.has(mb.id))
        .map((mb) =>
          limiter(async () => {
            try {
              const existing = await this.deps.labelMap.get(mb.id);
              if (existing !== null) return;
              const client = await this.deps.gmailMutation.getClient(mb.id);
              const labelId = await client.ensureLabelId(laterLabelName());
              await this.deps.labelMap.set(mb.id, labelId);
              mappingsRefreshed += 1;
            } catch (err) {
              console.error(
                JSON.stringify({
                  level: 'error',
                  kind: 'snooze.mapping_refresh_failed',
                  worker: this.workerName,
                  mailboxAccountId: mb.id,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
          }),
        ),
    );

    return {
      kind: 'sweep',
      dueProcessed: due.length,
      woken,
      restoredMessages,
      failed,
      mappingsRefreshed,
      skippedDuplicateRun: false,
    };
  }

  // ── The wake itself ─────────────────────────────────────────────────

  /**
   * Restore one sender's Later-labelled mail to INBOX and clear the
   * snooze timer. Returns the number of messages restored. Idempotent:
   * zero labelled messages → no Gmail call; an already-clear timer →
   * 0-row UPDATE.
   */
  private async wakeSender(
    mailboxAccountId: string,
    senderKey: string,
    version: SnoozeTimerVersion,
  ): Promise<number | null> {
    const [claimed] = await this.deps.db
      .update(senderPolicies)
      .set({
        snoozeWakeLastAttemptAt: (this.deps.now ?? (() => new Date()))(),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
          timerVersionWhere(version),
        ),
      )
      .returning({ id: senderPolicies.id });
    if (!claimed) return null;

    const client = await this.deps.gmailMutation.getClient(mailboxAccountId);
    const labelId = await client.ensureLabelId(laterLabelName());

    // Publish the mapping for the API's Snoozed LIST read. Best-effort
    // — a mapping-store outage must not block the restore itself.
    try {
      await this.deps.labelMap.set(mailboxAccountId, labelId);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'snooze.mapping_publish_failed',
          worker: this.workerName,
          mailboxAccountId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Durable restore set from the local mirror — the same store the
    // label-action worker updates in its terminal tx, so an undone
    // Later is excluded and new sync-mirrored labels are included.
    const rows = await this.deps.db
      .select({ providerMessageId: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.senderKey, senderKey),
          sql`${labelId} = ANY(${mailMessages.labelIds})`,
        ),
      );
    const ids = rows.map((r) => r.providerMessageId);

    if (ids.length > 0) {
      // Re-add INBOX + drop the Later id. Both directions are no-ops on
      // already-restored messages, so retries are safe.
      await client.batchModify(ids, { addLabelIds: ['INBOX'], removeLabelIds: [labelId] });
    }

    await this.deps.db.transaction(async (tx) => {
      if (ids.length > 0) {
        await tx
          .update(mailMessages)
          .set({
            labelIds: buildWakeMirrorExpr(labelId),
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(mailMessages.mailboxAccountId, mailboxAccountId),
              eq(mailMessages.senderKey, senderKey),
              sql`${labelId} = ANY(${mailMessages.labelIds})`,
            ),
          );
      }

      // D79 — "the sender_policies row clears": timer + reason null.
      // Standing verdict / Protect state is NOT touched.
      await tx
        .update(senderPolicies)
        .set({
          snoozedUntil: null,
          snoozedAt: null,
          snoozedReason: null,
          snoozeWakeLastAttemptAt: null,
          snoozeWakeLastFailedAt: null,
          snoozeWakeFailureCount: 0,
          snoozeWakeFailureKind: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
            timerVersionWhere(version),
            or(
              isNotNull(senderPolicies.snoozedUntil),
              isNotNull(senderPolicies.snoozedAt),
              isNotNull(senderPolicies.snoozedReason),
              isNotNull(senderPolicies.snoozeWakeLastAttemptAt),
              isNotNull(senderPolicies.snoozeWakeLastFailedAt),
            ),
          ),
        );
    });

    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'snooze.woken',
        worker: this.workerName,
        mailboxAccountId,
        restoredCount: ids.length,
      }),
    );

    return ids.length;
  }

  /** Persist a safe recovery signal; never store provider text or message data. */
  private async recordWakeFailure(
    mailboxAccountId: string,
    senderKey: string,
    version: SnoozeTimerVersion,
    error: unknown,
  ): Promise<void> {
    const failedAt = (this.deps.now ?? (() => new Date()))();
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const failureKind =
      errorName === 'InvalidGrantError'
        ? 'reauthorize'
        : errorName === 'PermanentError' || errorName === 'ValidationError'
          ? 'needs_attention'
          : 'temporary';

    await this.deps.db
      .update(senderPolicies)
      .set({
        snoozeWakeLastAttemptAt: failedAt,
        snoozeWakeLastFailedAt: failedAt,
        snoozeWakeFailureCount: sql`${senderPolicies.snoozeWakeFailureCount} + 1`,
        snoozeWakeFailureKind: failureKind,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
          // A concurrent success/reschedule/new Later action wins;
          // never stamp an issue onto a replacement timer.
          timerVersionWhere(version),
        ),
      );
  }
}

/** Optimistic timer version: both schedule and schedule-write timestamp. */
function timerVersionWhere(version: SnoozeTimerVersion): SQL {
  return and(
    eq(senderPolicies.snoozedUntil, version.snoozedUntil),
    version.snoozedAt === null
      ? isNull(senderPolicies.snoozedAt)
      : eq(senderPolicies.snoozedAt, version.snoozedAt),
  )!;
}

function timerVersionFromJob(
  payload: Extract<SnoozeWakeJobData, { kind: 'wake' }>,
): SnoozeTimerVersion {
  const snoozedUntil = new Date(payload.expectedSnoozedUntil);
  const snoozedAt = payload.expectedSnoozedAt ? new Date(payload.expectedSnoozedAt) : null;
  if (Number.isNaN(snoozedUntil.getTime()) || (snoozedAt && Number.isNaN(snoozedAt.getTime()))) {
    throw new ValidationError('Targeted wake carries an invalid timer version.');
  }
  return { snoozedUntil, snoozedAt };
}

/**
 * Local-mirror UPDATE expression for a wake: remove the Later label id,
 * append `INBOX` when absent. Same algorithm as the label-action
 * worker's `buildLabelMirrorExpr` (packages/workers/src/
 * label-action.worker.ts — module-private there, mirrored here):
 * `array_remove` is idempotent when the label is absent; the
 * `CASE WHEN` guard makes the append idempotent when INBOX is already
 * present. Both label values bind as scalar parameters — never
 * interpolated as SQL text.
 */
function buildWakeMirrorExpr(laterLabelId: string): SQL {
  const removed: SQL = sql`array_remove(${mailMessages.labelIds}, ${laterLabelId})`;
  return sql`(CASE WHEN ${'INBOX'} = ANY(${removed}) THEN ${removed} ELSE array_append(${removed}, ${'INBOX'}) END)`;
}
