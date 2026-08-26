import { and, eq, getTableName, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  activityLog,
  mailMessages,
  readStateNotSweeperMarked,
  screenerQuarantine,
  senderPolicies,
  senders,
  triageDecisions,
} from '@declutrmail/db';
import type { schema, TriageVerdict } from '@declutrmail/db';
import { TOPICS, TriageScoreRunCompletedPayloadSchema } from '@declutrmail/events';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { OutboxPublisher } from './outbox-publisher.js';
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
import { sqlTextArray } from './sql-text-array.js';
import {
  CASCADE_RULE_PHRASE,
  isGovernmentDomain,
  runCascade,
  type SenderSignals,
} from '@declutrmail/shared/triage-engine';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/** Bound Drizzle client over the full schema (matches `WorkerDb` in InitialSync). */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Senders scored per chunk.
 *
 * The chunk is the unit of BOTH batching and failure isolation, so the
 * size trades two things off. Larger chunks amortise the six grouped
 * reads over more senders; smaller chunks lose less work when one throws
 * and keep the `ANY(...)` parameter lists inside sane planning limits.
 * 200 puts an 8,000-sender mailbox at 40 chunks — 240 reads where the
 * per-sender form issued ~48,000.
 */
export const SCORE_CHUNK_SIZE = 200;

/**
 * Everything `loadSignals` reads, prefetched for a chunk of senders.
 *
 * A Map per source rather than one merged record per sender: a sender
 * with no policy row, no manual archives, or no prior decision is the
 * common case, and a missing key is the natural way to say so. Merging
 * would force a null-filled shape and invite `?? 0` defaults that hide
 * whether a zero was measured or absent.
 */
interface SignalBatch {
  senders: Map<
    string,
    {
      senderKey: string;
      displayName: string;
      domain: string;
      email: string;
      gmailCategory: SenderSignals['gmailCategory'];
      firstSeenAt: Date;
      lastSeenAt: Date;
    }
  >;
  policies: Map<
    string,
    { isProtected: boolean; protectionReason: SenderSignals['protectionReason'] | null }
  >;
  wroteTo: Map<string, number>;
  messageAggregates: Map<
    string,
    {
      totalMessages: number;
      hasOneClickUnsub: boolean | null;
      hasAnyUnsub: boolean | null;
      starredCount: number;
      volume90: number;
      reads90: number;
      recent30: number;
      prior30to90: number;
    }
  >;
  manualArchives: Map<string, number>;
  existingDecisions: Map<
    string,
    {
      verdict: TriageVerdict;
      generatedBy: string;
      reasoning: string | null;
      expiresAt: Date;
    }
  >;
}

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
export type ScoreTrigger =
  | 'sync_complete'
  | 'signal_change'
  | 'manual_rescore'
  /**
   * A user opened a sender whose read had aged past its TTL, so the
   * page asked for a fresh one (founder decision 2026-08-19). Distinct
   * from `manual_rescore` — nobody pressed a re-score button — and
   * conflating them would make the trigger telemetry claim an intent
   * the user never had.
   */
  | 'stale_refresh'
  | 'cron_sweep';

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
  /**
   * NEW `screener_quarantine` rows this run created (D72/D75) — the
   * Phase-B "too new to judge" senders routed to the Screener queue.
   * Counts true inserts only; an already-queued or already-decided
   * sender is never re-flagged (`ON CONFLICT DO NOTHING`).
   */
  screenerFlagged: number;
  /**
   * Senders whose scoring threw, and chunks whose prefetch threw.
   *
   * Both are zero on a healthy run. They exist because the sweep no
   * longer fails whole when one sender does — which is the fix, but it
   * also means a partially-failing sweep now returns SUCCESS. Without
   * these two counts on the ops line, "scored 7,900 of 8,000" would be
   * indistinguishable from "scored all 8,000", and a chunk failing every
   * night would never surface.
   */
  sendersFailed: number;
  chunksFailed: number;
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
  /**
   * Outbox publisher (D13/D204) for the `triage.score_run_completed`
   * event, published after the run's decisions are written (U14 —
   * drives the Autopilot apply sweep via the outbox consumer router).
   * Published with the root db handle — the run's upserts are
   * individually committed (no enclosing tx), so the event marks "the
   * sweep finished", not an atomic batch. Optional ONLY because the
   * composition root (`apps/api/src/worker.ts`) is integration-owned
   * this wave; when absent a structured
   * `score.run_completed_publish_skipped` warning surfaces the gap.
   */
  outbox?: OutboxPublisher;
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
/**
 * The first identifier-shaped token in a user-facing sentence that does
 * NOT come from the sender's own name, or `null`.
 *
 * The first version of this check matched a known list of cascade rule
 * ids. Measuring the live data showed that is too narrow: shown one id
 * in its prompt, the model coined siblings that exist nowhere in the
 * codebase — `protect_engagement_based` is in 100+ stored explanations
 * and in zero lines of source. A list can only ever catch the leaks we
 * already know about.
 *
 * A bare snake_case regex is too wide in the other direction: senders
 * are named `ife_insurance_india` and `nse_alerts`, and rejecting an
 * explanation for quoting the user's own data would be the worse bug.
 *
 * So the rule is neither list nor pattern alone: an identifier-shaped
 * token is fine if it appears in the sender's identity, and ours if it
 * doesn't. On the founder's 8,531 rows that separates 439 leaks from 10
 * legitimate quotes of a sender's own name.
 */
export function foreignIdentifierToken(reasoning: string, senderIdentity: string): string | null {
  const own = senderIdentity.toLowerCase();
  for (const match of reasoning.matchAll(/[A-Za-z]+_[A-Za-z_]+/g)) {
    if (!own.includes(match[0].toLowerCase())) return match[0];
  }
  return null;
}

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

    // CHUNKED, and each chunk isolated.
    //
    // This was one `Promise.all` over every sender in the mailbox. Two
    // problems, both of which only appear at the size this actually
    // runs at. `Promise.all` rejects on the FIRST rejection, so a single
    // sender throwing discarded the other ~8,000 senders' completed work
    // and the retry started again from zero — and `perMailboxPolicy` has
    // `timeoutMs: null`, so there was no wall-clock bound to stop it.
    // And every sender issued its own six reads.
    //
    // Now: prefetch a chunk's reads in six queries, score the chunk
    // under the same LLM concurrency limiter, and keep the completed
    // chunks when one fails. `allSettled` inside a chunk means one bad
    // sender costs its own row, not its neighbours'.
    let llmExplanations = 0;
    let templateExplanations = 0;
    let llmTimeouts = 0;
    let screenerFlagged = 0;
    let sendersFailed = 0;
    let chunksFailed = 0;

    for (let i = 0; i < senderKeys.length; i += SCORE_CHUNK_SIZE) {
      const chunk = senderKeys.slice(i, i + SCORE_CHUNK_SIZE);
      let batch: SignalBatch;
      try {
        batch = await this.loadSignalBatch(payload.mailboxAccountId, chunk);
      } catch (err) {
        // A failed PREFETCH loses the chunk, not the sweep. Logged with
        // its size so a chunk silently skipped is never mistaken for a
        // chunk with nothing in it.
        chunksFailed += 1;
        sendersFailed += chunk.length;
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'score.chunk_prefetch_failed',
            worker: this.workerName,
            mailboxAccountId: payload.mailboxAccountId,
            chunkSize: chunk.length,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        continue;
      }

      const settled = await Promise.allSettled(
        chunk.map((senderKey) =>
          this.limiter(() =>
            this.scoreOne(payload.mailboxAccountId, senderKey, producedAt, expiresAt, batch),
          ),
        ),
      );

      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          sendersFailed += 1;
          continue;
        }
        const written = outcome.value;
        if (!written) continue;
        if (written.generatedBy === 'llm_haiku') llmExplanations += 1;
        else templateExplanations += 1;
        if (written.timedOut) llmTimeouts += 1;
        if (written.screenerFlagged) screenerFlagged += 1;
      }
    }

    // A sweep where EVERY sender failed is a failure, not a quiet
    // success with zero decisions — that shape is indistinguishable from
    // an empty mailbox on the ops line, and it is how a broken sweep
    // stays broken.
    if (senderKeys.length > 0 && sendersFailed === senderKeys.length) {
      throw new Error(`score sweep failed for all ${senderKeys.length} senders in the mailbox`);
    }

    const decisionsWritten = llmExplanations + templateExplanations;

    // U14 — `triage.score_run_completed` drives the Autopilot apply
    // sweep (the consumer router enqueues `autopilot-apply` off it).
    // Published AFTER the upserts complete; the root db handle is the
    // documented OutboxPublisher path when there is no enclosing tx
    // (the run's writes commit individually). A BullMQ retry of this
    // job re-publishes with the same `producedAtMs` — the apply job's
    // `${mailbox}:${producedAtMs}` jobId dedups downstream.
    if (this.deps.outbox) {
      await this.deps.outbox.publish(this.deps.db, {
        topic: TOPICS.TRIAGE_SCORE_RUN_COMPLETED,
        aggregateId: payload.mailboxAccountId,
        payload: {
          mailboxAccountId: payload.mailboxAccountId,
          trigger: payload.trigger,
          producedAtMs: payload.producedAtMs,
          decisionsWritten,
        },
        schema: TriageScoreRunCompletedPayloadSchema,
      });
    } else {
      // Registration gap (integration PR wires the publisher). The
      // score run itself succeeded; the missing event means no
      // autopilot sweep follows — surface it.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'score.run_completed_publish_skipped',
          worker: this.workerName,
          mailboxAccountId: payload.mailboxAccountId,
          reason: 'ScoreWorkerDeps.outbox not wired',
        }),
      );
    }

    return {
      decisionsWritten,
      llmExplanations,
      templateExplanations,
      llmTimeouts,
      screenerFlagged,
      sendersFailed,
      chunksFailed,
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
    batch: SignalBatch,
  ): Promise<{
    verdict: TriageVerdict;
    generatedBy: 'llm_haiku' | 'template';
    timedOut: boolean;
    screenerFlagged: boolean;
  } | null> {
    const signals = this.loadSignals(mailboxAccountId, senderKey, batch);
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
      // Reuse before re-billing (2026-07-10): a re-score sweep calls
      // explain() for EVERY sender, including ones whose verdict did
      // not move — re-buying prose we already own. When the existing
      // decision row is unexpired, LLM-generated, and reaches the SAME
      // verdict, its reasoning is still the right explanation: reuse
      // it and skip the call. Any verdict change (or template row, or
      // expiry) still gets a fresh call — reasoning must never explain
      // a verdict it wasn't written for.
      const existing = batch.existingDecisions.get(senderKey);
      const reusable =
        existing &&
        existing.generatedBy === 'llm_haiku' &&
        existing.verdict === result.verdict &&
        existing.reasoning &&
        existing.expiresAt > (this.deps.now ?? (() => new Date()))();
      if (reusable) {
        // Falls through to the monotonic upsert below so produced_at /
        // expires_at still advance — only the LLM call is skipped.
        reasoning = existing.reasoning;
      } else {
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
              // The PHRASE, never the id. Handing the model
              // `high_read_rate` is how "the high_read_rate engine rule"
              // ended up in user-facing copy.
              ruleLabel: CASCADE_RULE_PHRASE[result.ruleId],
              facts: result.facts,
              gmailCategory: signals.signals.gmailCategory,
            }),
          this.explainTimeoutMs,
        );
        const identity = `${signals.displayName} ${signals.domain} ${signals.email}`;
        const leaked =
          raced.kind === 'ok' && raced.value ? foreignIdentifierToken(raced.value, identity) : null;
        if (raced.kind === 'ok' && leaked === null) {
          reasoning = raced.value;
        } else if (raced.kind === 'ok') {
          // The prompt no longer contains an id, but the model can still
          // reach one via few-shot drift or a future prompt edit. A
          // sentence naming internal vocabulary is not shippable copy —
          // fall back to the template rather than explain the user's
          // mail to them in our jargon.
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'reasoning.rejected_internal_vocabulary',
              worker: this.workerName,
              mailboxAccountId,
              senderKey,
              token: leaked,
            }),
          );
        } else {
          // Either way the sender falls back to its template explanation —
          // an explanation is an enhancement, never a reason to fail the
          // sweep. A provider ERROR is logged as itself rather than as a
          // timeout: counting it in `llmTimeouts` would blame latency for
          // an outage and send the next reader chasing the wrong thing.
          timedOut = raced.kind === 'timeout';
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: raced.kind === 'timeout' ? 'reasoning.timeout' : 'reasoning.failed',
              worker: this.workerName,
              mailboxAccountId,
              senderKey,
              ...(raced.kind === 'timeout'
                ? { timeoutMs: this.explainTimeoutMs }
                : { error: raced.error.name }),
            }),
          );
        }
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

    // D72/D75 — the engine's Phase-B rule ("too new to judge") routes
    // truly unknown senders to the Screener queue. SOFT quarantine
    // only: a `screener_quarantine` row is the entire effect — no
    // Gmail call, no label, no move (D72 hard rule). `ON CONFLICT DO
    // NOTHING` on (mailbox, sender) keeps this idempotent across
    // re-scores AND preserves a decided row: once the user has
    // screened the sender (decided_at set), a later Phase-B re-score
    // never re-queues it. Phase-C `score_inconclusive` rows stay in
    // Triage — D75 names Phase B only.
    let screenerFlagged = false;
    if (result.ruleId === 'insufficient_signal' && isWorthScreening(signals.signals)) {
      const inserted = await this.deps.db
        .insert(screenerQuarantine)
        .values({ mailboxAccountId, senderKey })
        .onConflictDoNothing({
          target: [screenerQuarantine.mailboxAccountId, screenerQuarantine.senderKey],
        })
        .returning({ id: screenerQuarantine.id });
      screenerFlagged = inserted.length > 0;
    } else {
      // Graduation (Phase B → confident Phase-C verdict): the sender now
      // carries a real triage verdict, so resolve any STILL-PENDING
      // quarantine row. Without this the same sender appears in BOTH the
      // Screener queue and Triage. Only `decided_at IS NULL` rows are
      // touched — a user-decided row stays decided.
      await this.deps.db
        .update(screenerQuarantine)
        .set({ decidedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(screenerQuarantine.mailboxAccountId, mailboxAccountId),
            eq(screenerQuarantine.senderKey, senderKey),
            isNull(screenerQuarantine.decidedAt),
          ),
        );
    }

    return { verdict: result.verdict, generatedBy, timedOut, screenerFlagged };
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
   * Every per-sender read the cascade needs, for a whole CHUNK of
   * senders, in six queries instead of six per sender.
   *
   * ## The problem this replaces
   *
   * `loadSignals` used to issue six round trips per sender: the sender
   * row, its policy, a wrote-to count, a `mail_messages` aggregate, a
   * manual-archive count, and the existing decision. On a mailbox with
   * ~8,000 senders a full sweep was therefore ~48,000 round trips —
   * and the database is in `us-west-2` while the worker runs in
   * `us-central1`, where a single round trip measures 94 ms against
   * 1.4 ms of server-side execution. The sweep spent its life waiting
   * on geography.
   *
   * The wrote-to count was worse than a round trip. It scans all of the
   * mailbox's outbound mail, unnests `recipient_emails`, and applies
   * `dm_normalize_email()` to BOTH sides — so no index can serve it and
   * every sender paid a full scan. Grouping it means the scan happens
   * once per chunk and every sender in that chunk reads its own row out
   * of the result.
   *
   * ## Why grouped, not joined
   *
   * One six-way join would return a row per sender per matching message
   * and re-aggregate work the individual queries do once. Six grouped
   * queries keep each aggregate on its own index and cost six round
   * trips regardless of chunk size, which is the term that actually
   * dominated.
   *
   * METADATA ONLY throughout (D7/D228). `mail_messages` is read for
   * `sender_key`, `label_ids`, `is_unread`, `is_outbound`,
   * `internal_date` and the List-Unsubscribe capability columns — no
   * body field is touched by any query here.
   */
  private async loadSignalBatch(
    mailboxAccountId: string,
    senderKeys: string[],
  ): Promise<SignalBatch> {
    const empty: SignalBatch = {
      senders: new Map(),
      policies: new Map(),
      wroteTo: new Map(),
      messageAggregates: new Map(),
      manualArchives: new Map(),
      existingDecisions: new Map(),
    };
    if (senderKeys.length === 0) return empty;

    const now = (this.deps.now ?? (() => new Date()))();
    const day = 24 * 60 * 60 * 1000;
    const at = (ms: number) => sql`${new Date(now.getTime() - ms).toISOString()}::timestamptz`;
    const since90 = at(NINETY_DAYS_MS);
    const since30 = at(30 * day);
    const since365 = at(365 * day);
    // EVERY window is bound from the worker's injected clock, not from
    // Postgres `now()`, so a run is deterministic and a replayed job
    // measures the same windows it did the first time.
    const inWindow = sql`${mailMessages.isOutbound} = false AND ${mailMessages.internalDate} >= ${since90}`;
    const keys = senderKeys;

    const [senderRows, policyRows, wroteToRows, aggRows, archiveRows, decisionRows] =
      await Promise.all([
        this.deps.db
          .select({
            senderKey: senders.senderKey,
            displayName: senders.displayName,
            domain: senders.domain,
            // Identity for the explanation check — the local part is
            // where a sender's own underscores live, and the model is
            // allowed to quote them. Also the wrote-to join key.
            email: senders.email,
            gmailCategory: senders.gmailCategory,
            firstSeenAt: senders.firstSeenAt,
            lastSeenAt: senders.lastSeenAt,
          })
          .from(senders)
          .where(
            and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.senderKey, keys)),
          ),

        this.deps.db
          .select({
            senderKey: senderPolicies.senderKey,
            isProtected: senderPolicies.isProtected,
            protectionReason: senderPolicies.protectionReason,
          })
          .from(senderPolicies)
          .where(
            and(
              eq(senderPolicies.mailboxAccountId, mailboxAccountId),
              inArray(senderPolicies.senderKey, keys),
            ),
          ),

        // Outbound mail ADDRESSED to these senders in the same window,
        // read from `mail_messages` rather than a per-month counter
        // (mig 0063). The counter this replaced lived on
        // `sender_timeseries`, whose rows exist only for months the
        // sender sent INBOUND mail — so a month in which the user wrote
        // to someone who sent them nothing had no row, and 21% of
        // credited messages on the mailbox this was measured against
        // were invisible to exactly this window. Under-reporting here
        // costs a Keep, which is the destructive direction.
        //
        // Raw SQL: the `LATERAL unnest(recipient_emails)` has no Drizzle
        // query-builder form, and hand-rolling one would drift from the
        // identical predicate in mig 0063 and both sync workers.
        //
        // Grouped on the SENDER side: the normalized recipient address
        // is joined back to `senders.email` so one scan serves the whole
        // chunk. `COUNT(DISTINCT m.id)` is preserved exactly — a message
        // addressed to the same sender twice still counts once.
        this.deps.db.execute(sql`
        SELECT s.${sql.identifier('sender_key')} AS sender_key,
               COUNT(DISTINCT m.${sql.identifier('id')})::int AS n
        FROM ${senders} AS s
        JOIN ${mailMessages} AS m
          ON m.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
         AND m.${sql.identifier('is_outbound')} = true
         AND m.${sql.identifier('internal_date')} >= ${at(NINETY_DAYS_MS)}
        CROSS JOIN LATERAL unnest(m.${sql.identifier('recipient_emails')}) AS r(addr)
        WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
          AND s.${sql.identifier('sender_key')} = ANY(${sqlTextArray(keys)})
          AND dm_normalize_email(r.addr) = dm_normalize_email(s.${sql.identifier('email')})
        GROUP BY s.${sql.identifier('sender_key')}
      `),

        this.deps.db
          .select({
            senderKey: mailMessages.senderKey,
            // INBOUND only. Counting the user's own sent mail toward the
            // sender's message count decides `insufficient_signal` (< 3)
            // — a sender the user wrote to repeatedly looked established
            // on the strength of the user's own messages.
            totalMessages: sql<number>`count(*) filter (where ${mailMessages.isOutbound} = false)::int`,
            hasOneClickUnsub: sql<boolean>`bool_or(${mailMessages.unsubscribeOneClick})`,
            hasAnyUnsub: sql<boolean>`bool_or(${mailMessages.unsubscribeUrl} is not null or ${mailMessages.unsubscribeMailtoUrl} is not null)`,
            // `is_outbound = false`: starring your OWN sent message is
            // not the sender earning a Keep.
            starredCount: sql<number>`coalesce(sum(case when 'STARRED' = any(${mailMessages.labelIds}) and ${mailMessages.isOutbound} = false and ${mailMessages.internalDate} >= ${since365} then 1 else 0 end), 0)::int`,
            volume90: sql<number>`count(*) filter (where ${inWindow})::int`,
            // Decontaminated numerator (mig 0064, F012): a message a
            // third-party sweeper marked read is not evidence the USER
            // read it. Excluded from the numerator only — the message
            // did arrive, so removing it from the denominator would
            // shrink the sender instead of correcting the rate.
            reads90: sql<number>`count(*) filter (where ${inWindow} AND ${mailMessages.isUnread} = false AND ${readStateNotSweeperMarked(mailboxAccountId, getTableName(mailMessages))})::int`,
            // Spike inputs — a per-day rate over the last 30 days
            // against the 30-90 day period before it. Replaces a
            // calendar-month ratio that reported a crash for every
            // sender on the 2nd of the month.
            recent30: sql<number>`count(*) filter (where ${mailMessages.isOutbound} = false AND ${mailMessages.internalDate} >= ${since30})::int`,
            prior30to90: sql<number>`count(*) filter (where ${mailMessages.isOutbound} = false AND ${mailMessages.internalDate} < ${since30} AND ${mailMessages.internalDate} >= ${since90})::int`,
          })
          .from(mailMessages)
          .where(
            and(
              eq(mailMessages.mailboxAccountId, mailboxAccountId),
              inArray(mailMessages.senderKey, keys),
            ),
          )
          .groupBy(mailMessages.senderKey),

        this.deps.db
          .select({ senderKey: activityLog.senderKey, n: sql<number>`count(*)::int` })
          .from(activityLog)
          .where(
            and(
              eq(activityLog.mailboxAccountId, mailboxAccountId),
              inArray(activityLog.senderKey, keys),
              eq(activityLog.source, 'manual'),
              eq(activityLog.action, 'archive'),
            ),
          )
          .groupBy(activityLog.senderKey),

        this.deps.db
          .select({
            senderKey: triageDecisions.senderKey,
            verdict: triageDecisions.verdict,
            generatedBy: triageDecisions.generatedBy,
            reasoning: triageDecisions.reasoning,
            expiresAt: triageDecisions.expiresAt,
          })
          .from(triageDecisions)
          .where(
            and(
              eq(triageDecisions.mailboxAccountId, mailboxAccountId),
              inArray(triageDecisions.senderKey, keys),
            ),
          ),
      ]);

    const batch: SignalBatch = {
      senders: new Map(senderRows.map((r) => [r.senderKey, r])),
      policies: new Map(policyRows.map((r) => [r.senderKey, r])),
      wroteTo: new Map(),
      messageAggregates: new Map(aggRows.map((r) => [r.senderKey, r])),
      // `activity_log.sender_key` is nullable — an action can be
      // recorded against a message with no resolved sender. The
      // `inArray` above already excludes those rows; this narrows the
      // type without pretending the column is non-null.
      manualArchives: new Map(
        archiveRows.flatMap((r) => (r.senderKey === null ? [] : [[r.senderKey, r.n] as const])),
      ),
      existingDecisions: new Map(decisionRows.map((r) => [r.senderKey, r])),
    };
    for (const row of allRows<{ sender_key: string; n: number }>(wroteToRows)) {
      batch.wroteTo.set(row.sender_key, Number(row.n));
    }
    return batch;
  }

  /**
   * Materialize the `SenderSignals` the cascade needs from `senders`,
   * `sender_policies`, `sender_timeseries`, and `mail_messages` metadata.
   * Returns `null` when no `senders` row exists yet.
   *
   * METADATA ONLY. The `mail_messages` query reads `is_unread`,
   * `label_ids`, `internal_date` — none of which are body fields.
   */
  private loadSignals(
    mailboxAccountId: string,
    senderKey: string,
    batch: SignalBatch,
  ): {
    signals: SenderSignals;
    displayName: string;
    domain: string;
    email: string;
  } | null {
    const sender = batch.senders.get(senderKey);
    if (!sender) return null;

    const policy = batch.policies.get(senderKey);

    const now = (this.deps.now ?? (() => new Date()))();

    // Outbound mail ADDRESSED to this sender in the same window, read
    // from `mail_messages` rather than a per-month counter (mig 0063).
    //
    // The counter this replaces lived on `sender_timeseries`, whose rows
    // exist only for months the sender sent INBOUND mail — so a month in
    // which the user wrote to someone who sent them nothing had no row,
    // and 21% of credited messages on the mailbox this was measured
    // against were invisible to exactly this window. Under-reporting here
    // costs a Keep (rule 2 below), which is the destructive direction.
    //
    // Prefetched once per CHUNK rather than once per sender — see
    // `loadSignalBatch`. This is the query that made the sweep
    // quadratic: a full scan of the mailbox's outbound mail with
    // `dm_normalize_email()` applied to both sides, so no index can
    // serve it, repeated for every one of ~8,000 senders.
    const wroteTo90 = batch.wroteTo.get(senderKey) ?? 0;

    const msgAgg = batch.messageAggregates.get(senderKey);
    const totalMessages = msgAgg?.totalMessages ?? 0;
    const volume90 = msgAgg?.volume90 ?? 0;
    const reads90 = msgAgg?.reads90 ?? 0;
    // Per-month cadence over the SAME 90 days the rate is measured on.
    const monthlyVolume = volume90 / 3;
    // `null`, not 0 — no mail in the window means the rate is
    // unmeasurable. See `SenderSignals.readRate90d`.
    const readRate90d = volume90 > 0 ? reads90 / volume90 : null;
    // Channel precedence mirrors `senders.unsubscribe_method` (D9):
    // one_click > mailto > none. Derived from the message rows directly
    // so scoring never depends on `building_sender_index` backfill state.
    const unsubscribeChannel: SenderSignals['unsubscribeChannel'] = msgAgg?.hasOneClickUnsub
      ? 'one_click'
      : msgAgg?.hasAnyUnsub
        ? 'mailto'
        : 'none';
    const starredInLastYear = (msgAgg?.starredCount ?? 0) > 0;

    // User-manual archive count — D21 §archive_score uses it as one of
    // the "user pattern" weights. Prefetched per chunk.
    const userManuallyArchivedCount = batch.manualArchives.get(senderKey) ?? 0;

    // Age signals.
    const dayMs = 24 * 60 * 60 * 1000;
    const firstSeenDaysAgo = Math.floor((now.getTime() - sender.firstSeenAt.getTime()) / dayMs);
    const lastSeenDaysAgo = Math.floor((now.getTime() - sender.lastSeenAt.getTime()) / dayMs);
    const firstSeenMonthsAgo = Math.floor(firstSeenDaysAgo / 30);

    // Spike ratio — the last 30 days' per-day rate against the 30-90 day
    // period before it. For a steady sender it sits near 1.0; spikes pop
    // above 3 (D21 §unsubscribe_score).
    //
    // Rates, not totals: the two windows are 30 and 60 days long, so
    // comparing raw counts would report every steady sender as halving.
    //
    // This replaced a CALENDAR-month ratio — the current month's bucket
    // over the average of the prior buckets. The current month is
    // partial by definition, so on the 2nd of a month every sender in
    // the mailbox looked like it had collapsed, and on the 31st every
    // sender looked steady. The rolling form has no such edge.
    //
    // No baseline mail → ratio 1 (no spike), never a division by zero
    // and never a fabricated spike for a sender that simply arrived.
    const recentPerDay = (msgAgg?.recent30 ?? 0) / 30;
    const baselinePerDay = (msgAgg?.prior30to90 ?? 0) / 60;
    const spikeRatio = baselinePerDay > 0 ? recentPerDay / baselinePerDay : 1;

    return {
      displayName: sender.displayName,
      domain: sender.domain,
      email: sender.email,
      signals: {
        isProtected: Boolean(policy?.isProtected),
        ...(policy?.protectionReason ? { protectionReason: policy.protectionReason } : {}),
        hasWrittenTo: wroteTo90 > 0,
        gmailCategory: sender.gmailCategory,
        starredInLastYear,
        readRate90d,
        firstSeenMonthsAgo,
        firstSeenDaysAgo,
        lastSeenDaysAgo,
        totalMessages,
        monthlyVolume,
        spikeRatio,
        unsubscribeChannel,
        // Deterministic .gov/.mil public-suffix fact, computed at scoring
        // time from the sender's domain — never persisted (D222).
        isGovDomain: isGovernmentDomain(sender.domain),
        userManuallyArchivedCount,
      },
    };
  }
}

/**
 * Is a sender the engine cannot yet judge worth putting in front of the
 * user at all? (D256.)
 *
 * Phase B routes every "too new to judge" sender to the Screener. The
 * quarantine lifts at three messages — so a sender that sends exactly
 * one, ever, can never leave. On the founder's mailbox 2,490 of 3,304
 * pending senders had sent exactly one message and 784 had sent two:
 * receipts, confirmations, password resets. 28 would ever graduate. The
 * Screener's headline number only went up, and its only exit was a
 * human clicking through thousands of one-off senders at one decision
 * per click.
 *
 * So the queue asks a narrower question than "is this sender unjudged":
 * has it repeated at least once? Two messages is the cheapest available
 * evidence that a sender is a stream rather than a receipt, and the
 * quarantine's own graduation rule already needs three.
 *
 * NO Primary carve-out. The obvious second clause — "or Gmail files it
 * in Primary, where real correspondence lands" — is unreachable: Primary
 * is Phase A rule 3, which returns Keep at 0.95 before Phase B is
 * consulted at all. A first message from a person never reaches the
 * Screener because it is never unjudged. Writing that clause and
 * watching its test fail is how this comment exists.
 *
 * A sender that does not clear the bar is NOT hidden: it keeps its
 * engine verdict, stays in Senders, and remains eligible for Triage. It
 * simply is not queued for a standing decision it will never need.
 * Nothing is done to its mail either way — quarantine has always been a
 * DB flag and nothing else (D72).
 */
export function isWorthScreening(signals: SenderSignals): boolean {
  return signals.totalMessages >= 2;
}

/** Queue name + job name for the score worker (matches initial-sync pattern). */
export const SCORE_QUEUE = 'score';
export const SCORE_JOB = 'score';

/**
 * First row of a Drizzle `execute` result, whatever the driver returns.
 *
 * postgres.js hands back an array-like; PGlite (the test driver) hands
 * back `{ rows }`. Defensive rather than cast, for the same reason
 * `sender-timeseries-reconcile.ts` guards its row count: a shape
 * mismatch here would turn into a confident `0` on `wroteTo90`, which
 * silently withdraws cascade rule 2's Keep — the destructive direction.
 */
/**
 * All rows from a Drizzle `execute`.
 *
 * postgres.js returns an array-like; PGlite (the test driver) returns
 * `{ rows }`. Both appear in this package. `firstRow` below handles the
 * same split for single-row reads — reading only one shape would make
 * the grouped wrote-to counts silently empty under the other driver,
 * and an empty wrote-to map costs a Keep on every sender the user has
 * written to.
 */
function allRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}
