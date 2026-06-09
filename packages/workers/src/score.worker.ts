import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  activityLog,
  mailMessages,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
} from '@declutrmail/db';
import type { schema, TriageVerdict } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import {
  createLimiter,
  renderTemplate,
  resolveExplainTimeoutMs,
  resolveReasoningConcurrency,
  resolveReasoningRatePerMin,
  runWithTimeout,
  type ConcurrencyLimiter,
  type ReasoningLlmPort,
} from './reasoning.js';
import { RateLimiter } from './rate-limiter.js';
import { runCascade, type SenderSignals } from './score-cascade.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/** Bound Drizzle client over the full schema (matches `WorkerDb` in InitialSync). */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Re-score TTL (D25). The worker writes `expires_at = produced_at + TTL`;
 * the weekly safety-net cron re-computes any row past `expires_at`.
 * Seven days matches D25's stated "weekly safety-net rebuild" cadence.
 */
const RESCORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Trigger source for one score job — drives the `idempotencyKey` so a
 * Pub/Sub redelivery cannot double-write within the same trigger event.
 *
 * `produced_at` (the trigger event's ms-since-epoch) is what makes the
 * key per-trigger rather than per-mailbox-per-sender — different events
 * for the same sender get distinct keys and re-run.
 */
export type ScoreTrigger = 'sync_complete' | 'signal_change' | 'manual_rescore' | 'cron_sweep';

/**
 * One score job. Either runs for a single `senderKey` (signal-change
 * event, manual rescore) or for every active sender in the mailbox
 * (sync-complete sweep).
 *
 * `producedAtMs` is the trigger event's clock — passed in so the worker
 * is testable without `Date.now()` and so the idempotency key is stable
 * across worker retries (the BullMQ job carries it).
 */
export interface ScoreJobData {
  mailboxAccountId: string;
  /** If set, score just this sender. If unset, score every active sender. */
  senderKey?: string;
  trigger: ScoreTrigger;
  producedAtMs: number;
}

/** What one score-job run produced — metric-only, logged on success. */
export interface ScoreJobResult {
  /** Number of senders scored this run. */
  decisionsWritten: number;
  /** Number of those that hit the LLM successfully vs the template fallback. */
  llmExplanations: number;
  templateExplanations: number;
  /**
   * Number of LLM calls that hit the per-call timeout (subset of
   * `templateExplanations`). Surfaced so the success log carries enough
   * signal to graph "how often is Haiku stalling?" without re-querying.
   */
  llmTimeouts: number;
}

/** Window for "monthly volume" — D21 reads the last full calendar month. */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface ScoreWorkerDeps {
  db: WorkerDb;
  /**
   * D24 Haiku port. `undefined` means "no LLM available; always use the
   * template." A wired implementation MUST return `null` on failure (no
   * throws); see `ReasoningLlmPort` contract.
   */
  llm?: ReasoningLlmPort;
  /** Override clock for tests; defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Per-call timeout for `llm.explain()`. Defaults to
   * `DEFAULT_EXPLAIN_TIMEOUT_MS`. On timeout the call is treated as if
   * the port returned `null`, the worker falls back to the template,
   * and a `reasoning.timeout` line is logged. Tests override this to
   * drive deterministic timing.
   */
  explainTimeoutMs?: number;
  /**
   * Max concurrent in-flight `llm.explain()` calls during the
   * all-senders sweep. Defaults to `DEFAULT_REASONING_CONCURRENCY` (4),
   * capped at `MAX_REASONING_CONCURRENCY` (16). The cap defends Haiku's
   * rate limit and keeps the worker's peak memory bounded.
   */
  reasoningConcurrency?: number;
  /**
   * Sustained `llm.explain()` calls per minute. Complements
   * `reasoningConcurrency`: that caps IN-FLIGHT calls, this caps the
   * SUSTAINED RATE. Tier 1 Anthropic = 50 RPM org cap (verified
   * 2026-06-09 — a 6627-sender sweep produced ~25% `template` rows
   * because the burst saturated the org quota in seconds). Default
   * `Infinity` (no pacing) so unit tests run at full speed; the prod
   * composition root reads `REASONING_RATE_PER_MIN` and passes 40 to
   * stay under Tier 1 with safety margin. See `createRateLimiter` in
   * `reasoning.ts` for the leaky-bucket pacing model.
   */
  reasoningRatePerMin?: number;
}

/**
 * ScoreWorker (D20 / D21 / D24 / D25) — the deterministic decision
 * engine's worker shell.
 *
 * Listens for `sync.complete` and `sender.signal_changed` events (D25
 * triggers) and writes the engine's verdict + reasoning into
 * `triage_decisions`. Worker policy: `perMailboxPolicy` (D203/D225) —
 * one in-flight job per mailbox.
 *
 * Idempotency key (D203):
 *
 *     ${mailbox_id}:${sender_key ?? '*'}:${produced_at_ms}
 *
 * `produced_at_ms` is the TRIGGER event's clock (passed in the payload),
 * not the worker's `Date.now()` — so a BullMQ retry of the same job
 * computes the same key. A duplicate trigger (Pub/Sub redelivery) carries
 * the same `producedAtMs` because the trigger event is the source.
 *
 * Privacy (D7 / D228): the worker reads `senders`, `sender_timeseries`,
 * `sender_policies`, and aggregates over `mail_messages` METADATA fields
 * (sender_key, label_ids, is_unread, internal_date). NEVER reads
 * subjects, snippets, or any body field. The LLM call (when wired) sees
 * only sender identity + cascade facts via the bounded
 * `ReasoningInput` — see `reasoning.ts`.
 *
 * D222: the worker computes a verdict from rules + score + protection.
 * It does NOT predict an email category. Gmail's own CATEGORY_* labels
 * feed `unsubscribe_score` (per D21), but those are Gmail's
 * classification, not ours.
 *
 * D204: this worker WRITES. The HTTP-facing `TriageService` in
 * `apps/api` is read-only — it produces score-trigger events that this
 * worker consumes, and never mutates `triage_decisions` itself.
 */
export class ScoreWorker extends BaseDeclutrWorker<ScoreJobData, ScoreJobResult> {
  override readonly workerName = 'ScoreWorker';
  override readonly policy = 'perMailboxPolicy' as const;

  /** Bounded fan-out for the all-senders sweep; built once at construction. */
  private readonly limiter: ConcurrencyLimiter;
  /**
   * Sustained-rate limiter for `llm.explain()` calls. Sequenced before
   * the concurrency limiter wraps the work — pacing decides WHEN a call
   * may go out, concurrency decides HOW MANY may be in-flight at once.
   * `null` means "no pacing" (the test-default and the env-unset path).
   */
  private readonly rateLimiter: RateLimiter | null;
  /** Per-call timeout for `llm.explain()`. */
  private readonly explainTimeoutMs: number;

  constructor(private readonly deps: ScoreWorkerDeps) {
    super();
    this.limiter = createLimiter(
      deps.reasoningConcurrency ??
        resolveReasoningConcurrency(process.env['REASONING_CONCURRENCY']),
    );
    const ratePerMin =
      deps.reasoningRatePerMin ?? resolveReasoningRatePerMin(process.env['REASONING_RATE_PER_MIN']);
    // `Infinity` is the sentinel for "no pacing" — the test-default so
    // unit tests don't crawl through 1.5s spacing. Prod opts in via
    // `REASONING_RATE_PER_MIN` env (see runbook + composition root).
    this.rateLimiter = Number.isFinite(ratePerMin) ? new RateLimiter(ratePerMin, 60_000) : null;
    this.explainTimeoutMs =
      deps.explainTimeoutMs ?? resolveExplainTimeoutMs(process.env['REASONING_TIMEOUT_MS']);
  }

  /** Test-only: peek at the limiter's in-flight count (for cap assertions). */
  getActiveExplainCount(): number {
    return this.limiter.activeCount;
  }

  protected override getIdempotencyKey(payload: ScoreJobData): string {
    // `${mailbox_id}:${sender_key}:${produced_at}` per the task spec.
    // `'*'` for the all-senders sync_complete sweep so its key is stable.
    return `${payload.mailboxAccountId}:${payload.senderKey ?? '*'}:${payload.producedAtMs}`;
  }

  override async processJob(payload: ScoreJobData, _ctx: WorkerContext): Promise<ScoreJobResult> {
    if (!payload?.mailboxAccountId) {
      throw new ValidationError('score job is missing mailboxAccountId');
    }
    if (!payload.producedAtMs || !Number.isFinite(payload.producedAtMs)) {
      throw new ValidationError('score job is missing producedAtMs');
    }

    const producedAt = new Date(payload.producedAtMs);
    const expiresAt = new Date(payload.producedAtMs + RESCORE_TTL_MS);

    // Which senders to score: one (signal-change) or all (sync-complete sweep).
    const senderKeys = payload.senderKey
      ? [payload.senderKey]
      : await this.listMailboxSenderKeys(payload.mailboxAccountId);

    // Bounded fan-out. Each task runs `scoreOne` under the shared
    // limiter; the limiter caps concurrent in-flight `llm.explain()`
    // calls. Sequential DB writes were the original bottleneck; even
    // with concurrency = 4 the wall-clock for a 1000-sender sweep drops
    // by ~4x when the LLM is the long pole.
    const results = await Promise.all(
      senderKeys.map((senderKey) =>
        this.limiter(() =>
          this.scoreOne(payload.mailboxAccountId, senderKey, producedAt, expiresAt),
        ),
      ),
    );

    let llmExplanations = 0;
    let templateExplanations = 0;
    let llmTimeouts = 0;
    for (const written of results) {
      if (!written) continue;
      if (written.generatedBy === 'llm_haiku') llmExplanations += 1;
      else templateExplanations += 1;
      if (written.timedOut) llmTimeouts += 1;
    }

    return {
      decisionsWritten: llmExplanations + templateExplanations,
      llmExplanations,
      templateExplanations,
      llmTimeouts,
    };
  }

  /**
   * Score one sender — load signals, run cascade, generate reasoning,
   * upsert `triage_decisions`. Returns `null` when no `senders` row
   * exists yet (the sync stage hasn't materialized it).
   */
  private async scoreOne(
    mailboxAccountId: string,
    senderKey: string,
    producedAt: Date,
    expiresAt: Date,
  ): Promise<{
    verdict: TriageVerdict;
    generatedBy: 'llm_haiku' | 'template';
    timedOut: boolean;
  } | null> {
    const signals = await this.loadSignals(mailboxAccountId, senderKey);
    if (!signals) return null;
    const result = runCascade(signals.signals);

    // Reasoning (D24) — LLM if wired + successful, template fallback.
    // Per-call timeout: one stall must not block the sweep. On timeout
    // we log `reasoning.timeout` and fall back to the template, exactly
    // as if the port had returned `null`. The port's "no throws"
    // contract is preserved from the consumer side.
    let reasoning: string | null = null;
    let timedOut = false;
    if (this.deps.llm) {
      const port = this.deps.llm;
      // Pace BEFORE the timeout race starts. If pacing were inside the
      // raced task, the wall-clock budget would include rate-limiter
      // wait time and a short timeout (e.g. 5_000ms) could surface as a
      // `reasoning.timeout` even though the port itself never started.
      // Pacing OUTSIDE the race makes the timeout measure only the
      // port's own latency, which is what the budget is meant to bound.
      if (this.rateLimiter) {
        await this.rateLimiter.acquire(1);
      }
      const raced = await runWithTimeout(
        () =>
          port.explain({
            displayName: signals.displayName,
            domain: signals.domain,
            verdict: result.verdict,
            confidence: result.confidence,
            ruleLabel: result.ruleId,
            facts: result.facts,
            gmailCategory: signals.signals.gmailCategory,
          }),
        this.explainTimeoutMs,
      );
      if (raced.kind === 'ok') {
        reasoning = raced.value;
      } else {
        timedOut = true;
        // Structured log; matches the rest of the worker logging shape
        // (JSON line on stdout, picked up by the same collector). Keep
        // mailbox + sender keys here so the timeout can be correlated
        // with a slow tenant without re-querying.
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'reasoning.timeout',
            worker: this.workerName,
            mailboxAccountId,
            senderKey,
            timeoutMs: this.explainTimeoutMs,
          }),
        );
      }
    }
    const generatedBy: 'llm_haiku' | 'template' = reasoning ? 'llm_haiku' : 'template';
    const finalReasoning = reasoning ?? renderTemplate(signals.displayName, result);

    // Monotonic upsert (D25 — concurrency-safe re-score).
    //
    // BullMQ jobId dedup only fires for IDENTICAL jobIds; the producer
    // includes `producedAtMs` in the jobId so two rapid score-trigger
    // events for the same (mailbox, sender) produce DIFFERENT jobIds
    // and can run concurrently if the consumer has spare slots. With
    // last-writer-wins semantics an older job that finishes AFTER a
    // newer one would overwrite the newer row — leaving stale
    // decisions in `triage_decisions`.
    //
    // The `where` clause on `ON CONFLICT DO UPDATE` enforces
    // monotonicity at the DB layer: the UPDATE only fires when the
    // existing row's `produced_at` is STRICTLY older than the inserting
    // row's. An out-of-order older finisher's UPDATE becomes a no-op.
    // Equal `produced_at` (idempotent retry) is also a no-op — the row
    // is already authoritative for that producer event. This guarantee
    // is independent of BullMQ consumer concurrency: even with
    // unlimited parallelism the row's `produced_at` only advances.
    await this.deps.db
      .insert(triageDecisions)
      .values({
        mailboxAccountId,
        senderKey,
        verdict: result.verdict,
        // numeric(3,2) — `.toFixed(2)` keeps the string scale stable.
        confidence: result.confidence.toFixed(2),
        reasoning: finalReasoning,
        generatedBy,
        producedAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [triageDecisions.mailboxAccountId, triageDecisions.senderKey],
        set: {
          verdict: result.verdict,
          confidence: result.confidence.toFixed(2),
          reasoning: finalReasoning,
          generatedBy,
          producedAt,
          expiresAt,
          updatedAt: sql`now()`,
        },
        // `lt()` binds the Date through the column's timestamptz type.
        // A raw `sql\`… < ${producedAt}\`` template passes a bare JS
        // Date param, which the postgres-js driver rejects at runtime
        // ("Failed query … Wed May 27 2026 … PDT") — PGlite tolerates
        // it, so the unit tests passed while the real worker 500'd
        // (Codex smoke 2026-05-27). See [[drizzle-raw-sql-param-pitfalls]].
        where: lt(triageDecisions.producedAt, producedAt),
      });

    return { verdict: result.verdict, generatedBy, timedOut };
  }

  /** Senders to score on the all-senders sync_complete sweep. */
  private async listMailboxSenderKeys(mailboxAccountId: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(eq(senders.mailboxAccountId, mailboxAccountId));
    return rows.map((r) => r.senderKey);
  }

  /**
   * Materialize the `SenderSignals` the cascade needs from `senders`,
   * `sender_policies`, `sender_timeseries`, and `mail_messages` metadata.
   * Returns `null` when no `senders` row exists yet.
   *
   * METADATA ONLY. The `mail_messages` query reads `is_unread`,
   * `label_ids`, `internal_date` — none of which are body fields.
   */
  private async loadSignals(
    mailboxAccountId: string,
    senderKey: string,
  ): Promise<{ signals: SenderSignals; displayName: string; domain: string } | null> {
    const [sender] = await this.deps.db
      .select({
        displayName: senders.displayName,
        domain: senders.domain,
        gmailCategory: senders.gmailCategory,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
      })
      .from(senders)
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), eq(senders.senderKey, senderKey)))
      .limit(1);
    if (!sender) return null;

    const [policy] = await this.deps.db
      .select({
        isProtected: senderPolicies.isProtected,
        isVip: senderPolicies.isVip,
        protectionReason: senderPolicies.protectionReason,
      })
      .from(senderPolicies)
      .where(
        and(
          eq(senderPolicies.mailboxAccountId, mailboxAccountId),
          eq(senderPolicies.senderKey, senderKey),
        ),
      )
      .limit(1);

    // 90-day timeseries aggregate — total volume + read count.
    const now = (this.deps.now ?? (() => new Date()))();
    const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);
    const yearMonth90 = ninetyDaysAgo.toISOString().slice(0, 10);

    const tsRows = await this.deps.db
      .select({
        volume: senderTimeseries.volume,
        readCount: senderTimeseries.readCount,
        replyCount: senderTimeseries.replyCount,
      })
      .from(senderTimeseries)
      .where(
        and(
          eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
          eq(senderTimeseries.senderKey, senderKey),
          gte(senderTimeseries.yearMonth, yearMonth90),
        ),
      );

    const volume90 = tsRows.reduce((sum, r) => sum + r.volume, 0);
    const reads90 = tsRows.reduce((sum, r) => sum + r.readCount, 0);
    const replies90 = tsRows.reduce((sum, r) => sum + r.replyCount, 0);
    // Average over 3 months. Math.max(1, …) prevents divide-by-zero
    // for senders with no recent activity.
    const monthlyVolume = volume90 / 3;
    const readRate90d = volume90 > 0 ? reads90 / volume90 : 0;

    // `mail_messages` metadata aggregates — total + per-flag counts.
    // Bodies are NEVER touched; only sender_key, label_ids, is_unread,
    // internal_date are read.
    const [msgAgg] = await this.deps.db
      .select({
        totalMessages: sql<number>`count(*)::int`,
        hasUnsub: sql<boolean>`bool_or(${mailMessages.unsubscribeUrl} is not null or ${mailMessages.unsubscribeMailtoUrl} is not null)`,
        starredCount: sql<number>`coalesce(sum(case when 'STARRED' = any(${mailMessages.labelIds}) and ${mailMessages.internalDate} >= ${sql.raw(`'${new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()}'::timestamptz`)} then 1 else 0 end), 0)::int`,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.senderKey, senderKey),
        ),
      );

    const totalMessages = msgAgg?.totalMessages ?? 0;
    const hasUnsubscribeHeader = Boolean(msgAgg?.hasUnsub ?? false);
    const starredInLastYear = (msgAgg?.starredCount ?? 0) > 0;

    // User-manual archive count — D21 §archive_score uses it as one of the
    // "user pattern" weights. Read from `activity_log` where source='manual'
    // AND action='archive' for THIS sender.
    const [archiveAgg] = await this.deps.db
      .select({
        n: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.mailboxAccountId, mailboxAccountId),
          eq(activityLog.senderKey, senderKey),
          eq(activityLog.source, 'manual'),
          eq(activityLog.action, 'archive'),
        ),
      );
    const userManuallyArchivedCount = archiveAgg?.n ?? 0;

    // Age signals.
    const dayMs = 24 * 60 * 60 * 1000;
    const firstSeenDaysAgo = Math.floor((now.getTime() - sender.firstSeenAt.getTime()) / dayMs);
    const lastSeenDaysAgo = Math.floor((now.getTime() - sender.lastSeenAt.getTime()) / dayMs);
    const firstSeenMonthsAgo = Math.floor(firstSeenDaysAgo / 30);

    // Spike ratio = current month's volume / 90-day baseline. For a
    // steady sender the ratio sits near 1.0; spikes pop above 3 (D21
    // §unsubscribe_score). 90d baseline is the per-month average across
    // the loaded rows; current-month volume is the latest row's. If we
    // have one row or fewer, no baseline → ratio = 1 (no spike).
    const currentMonthVolume = tsRows.at(-1)?.volume ?? 0;
    const baselineMonthly =
      tsRows.length > 1 ? (volume90 - currentMonthVolume) / (tsRows.length - 1) : 0;
    const spikeRatio = baselineMonthly > 0 ? currentMonthVolume / baselineMonthly : 1;

    return {
      displayName: sender.displayName,
      domain: sender.domain,
      signals: {
        isProtected: Boolean(policy?.isProtected),
        ...(policy?.protectionReason ? { protectionReason: policy.protectionReason } : {}),
        isVip: Boolean(policy?.isVip),
        hasReplied: replies90 > 0,
        gmailCategory: sender.gmailCategory,
        starredInLastYear,
        readRate90d,
        firstSeenMonthsAgo,
        firstSeenDaysAgo,
        lastSeenDaysAgo,
        totalMessages,
        monthlyVolume,
        spikeRatio,
        hasUnsubscribeHeader,
        userManuallyArchivedCount,
      },
    };
  }
}

/** Queue name + job name for the score worker (matches initial-sync pattern). */
export const SCORE_QUEUE = 'score';
export const SCORE_JOB = 'score';
