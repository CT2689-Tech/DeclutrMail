import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  type BriefPayload as PersistedBriefPayload,
  briefRuns,
  mailMessages,
  mailboxAccounts,
  type schema,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { type StoredUnsubscribeMethod, unsubscribeCapabilityOf } from '@declutrmail/shared/actions';
import { parseBriefPrefs } from '@declutrmail/shared/contracts';
import { hasCapability, TIER_IDS } from '@declutrmail/shared/entitlements';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import {
  BRIEF_FYI_MAX,
  BRIEF_REPLY_MAX,
  briefPayloadSchema,
  EMPTY_BRIEF_PAYLOAD,
  renderTemplateNarrative,
  resolveBriefLlmTimeoutMs,
  type BriefLlmPort,
  type BriefItem,
  type BriefNarrativeInput,
  type BriefNarrativeItem,
  type BriefNarrativeNoiseGroup,
  type BriefPayload,
  type BriefSenderGroup,
} from './brief-narrative.js';
import { createLimiter, runWithTimeout } from './reasoning.js';
import { resolveBriefLocalWindow, type BriefLocalWindow } from './brief-timezone.js';
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Default bounded-concurrency cap for the per-mailbox snapshot. The
 * cron iterates every mailbox in the system every hour; serial
 * `await` per mailbox would take O(N × per-mailbox-ms) → at 10K
 * mailboxes this is many minutes. Fan-out at 8-wide keeps the cron
 * tight while staying well under any reasonable Postgres connection
 * pool ceiling (default pool: 10).
 *
 * Override via env `BRIEF_SNAPSHOT_CONCURRENCY` (clamped to [1, 32]).
 */
const DEFAULT_BRIEF_SNAPSHOT_CONCURRENCY = 8;
const MAX_BRIEF_SNAPSHOT_CONCURRENCY = 32;

function resolveConcurrency(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_BRIEF_SNAPSHOT_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BRIEF_SNAPSHOT_CONCURRENCY;
  return Math.min(n, MAX_BRIEF_SNAPSHOT_CONCURRENCY);
}

/**
 * Tiers whose workspaces may receive a Brief — DERIVED from the pricing
 * manifest, never a literal list, so re-tiering `brief` moves this with
 * it (a hardcoded `['pro']` is how the gate silently rots).
 *
 * WHY THE PRODUCER GATES AT ALL. `@RequiresCapability('brief')` guards
 * the READ endpoint, but this cron has no principal and ran for every
 * connected mailbox regardless of tier. Composing a Brief sends the
 * sender, subject line and Gmail preview snippet to Anthropic
 * (`composeNarrative` below), so an ungated producer widened the
 * third-party data boundary for Free and Plus workspaces that cannot
 * open the feature at all — contradicting `BRIEF_AI_DISCLOSURE`, which
 * says "a Pro Brief". Filtering here is the only place that stops it:
 * a request guard never runs for a cron.
 */
const BRIEF_TIERS = TIER_IDS.filter((tier) => hasCapability(tier, 'brief'));

/** Cron job payload — same shape as `UndoExpiry` + `FollowupCheck`. */
export interface BriefSnapshotJobData {
  /** ISO-8601 minute boundary, e.g. `2026-05-25T08:00`. D225 cron key. */
  scheduledAtMinute: string;
}

/** Per-pass metrics — logged on `worker.succeeded`. */
export interface BriefSnapshotResult {
  /** Mailboxes inspected this pass — entitled tiers only (`BRIEF_TIERS`). */
  mailboxesProcessed: number;
  /**
   * Subset of `mailboxesProcessed` whose per-mailbox snapshot threw
   * mid-loop and was caught. The error is logged with the mailbox id;
   * the next mailbox still runs so one bad mailbox cannot stop every
   * other user from getting their morning Brief.
   */
  mailboxesFailed: number;
  /** New Brief rows written (excludes mailboxes whose Brief was already present). */
  briefsGenerated: number;
  /** Subset of `briefsGenerated` that landed an empty-section brief (D70). */
  emptyBriefs: number;
  /** Wall-clock ms. */
  durationMs: number;
}

export interface BriefSnapshotDeps {
  db: WorkerDb;
  /** Override clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Bounded-concurrency cap for the per-mailbox snapshot. Defaults to
   * `process.env.BRIEF_SNAPSHOT_CONCURRENCY` (8 if unset; clamped to
   * [1, 32]). Tests inject `1` for deterministic ordering. The cap
   * keeps the worker from blowing the Postgres connection pool —
   * each in-flight mailbox holds at most one connection at a time.
   */
  concurrency?: number;
  /**
   * D62 — Haiku LLM port. `undefined` (or null from the composition
   * root's `buildBriefLlmAdapter(env)`) means "no LLM available; always
   * use the template." A wired implementation MUST return `null` on
   * any failure (network, refusal, max_tokens, malformed response); see
   * `BriefLlmPort` contract in `brief-narrative.ts`.
   */
  llm?: BriefLlmPort;
  /**
   * Per-call timeout for `llm.generateNarrative()`. Defaults to
   * `DEFAULT_BRIEF_LLM_TIMEOUT_MS` (10s) — one Brief call per mailbox
   * per day, so a generous wall-clock is fine. Tests inject smaller
   * values for deterministic timing.
   */
  llmTimeoutMs?: number;
}

/** D63 — Reply section cap (re-export local alias for clarity). */
/**
 * True when the sender publishes a working unsubscribe channel of any
 * kind — one-click or mailto.
 *
 * Delegates to `unsubscribeCapabilityOf`, the sanctioned D248 reader,
 * rather than testing the column directly. That module exists because
 * NULL and `'none'` are different facts — NULL means the sender index
 * has not looked yet, `'none'` means it looked and found nothing — and
 * every surface that collapses them asserts we checked when we did not.
 * Both resolve to `unknown` here, so an unindexed sender keeps the
 * conservative Reply default and re-buckets once the index lands.
 *
 * Not `isExecutableUnsubscribe`: that is one-click only, because it
 * answers "can DeclutrMail send this for the user". The question here
 * is different — "is this a list the user could leave", which a mailto
 * sender also is.
 */
function hasUnsubscribeChannel(method: StoredUnsubscribeMethod | undefined): boolean {
  const capability = unsubscribeCapabilityOf(method);
  return capability === 'one_click' || capability === 'mailto';
}

const REPLY_MAX = BRIEF_REPLY_MAX;
/** D63 — FYI section cap. */
const FYI_MAX = BRIEF_FYI_MAX;

/**
 * BriefSnapshotWorker (D61, D62, D63, D67, D69, D70).
 *
 * Hourly cron (`cronPolicy` per D203/D225) that materializes the
 * static daily Brief snapshot for every mailbox whose configured local
 * delivery hour (D64, 8am by default) has just passed. Idempotency key
 * `BriefSnapshotWorker:${scheduledAtMinute}` plus the D69 UNIQUE on
 * `(mailbox_account_id, run_date_local)` make the worker fully
 * re-runnable: re-runs within the same local-date for the same mailbox
 * are no-ops once a NON-EMPTY brief is frozen (`ON CONFLICT DO
 * NOTHING`); an EMPTY brief stays replaceable so a zero-count race
 * against lagging sync can self-heal on a later tick.
 *
 * What the worker DOES:
 *   - Iterates every mailbox in `mailbox_accounts` (joined to the
 *     owning user's preferences + timezone for the D64 gate).
 *   - D64 schedule: EVERY local day, at `preferences.briefPrefs.hour`
 *     (8am default). The weekday-only schedule is retired — D66's
 *     Mon–Fri default meant Saturday's Brief never ran, so Friday's
 *     mail, the heaviest weekday, was the one day nothing ever
 *     summarized (founder decision 2026-08-25).
 *   - For each mailbox, checks whether today's Brief already exists
 *     (D69 frozen-once invariant) and skips if so.
 *   - Queries yesterday's INBOUND `mail_messages` metadata.
 *   - Groups by sender, joins sender identity/engagement facts
 *     state + `triage_decisions` for engine verdict.
 *   - Categorizes into D63 sections:
 *       reply  — non-VIPs whose engine verdict is 'keep' or who have
 *                no decision yet AND VIPs (auto-elevated per D67).
 *                Capped at 6 (D63). VIPs win cap ties.
 *       fyi    — engine verdict 'later'. Capped at 4 (D63).
 *       noise  — engine verdict 'archive' or 'unsubscribe'. Uncapped.
 *   - Uses the D62 Haiku adapter when configured and falls back to the
 *     deterministic template on absence, timeout, or provider failure.
 *   - Empty-day handling per D70: if yesterday had zero inbound
 *     messages, writes an empty-section brief with the D70 calm copy.
 *     The empty run is NOT frozen — later ticks rebuild it and replace
 *     it the first time a non-empty payload lands (zero-count-race
 *     heal, 2026-07-07).
 *   - Upserts into `brief_runs` ON CONFLICT (mailbox, date) DO NOTHING;
 *     the heal path UPDATEs the existing row guarded on it still being
 *     empty.
 *
 * What the worker does NOT do (deferred):
 *   - Sub-hour delivery slots. The cron ticks hourly, so an hour is the
 *     finest slot generation can honour; D64's "any 30-min slot" would
 *     need a 30-minute cron (FOUNDER-FOLLOWUPS 2026-08-25).
 *   - Email delivery of the Brief. D61's digest half was never built:
 *     no template, no trigger, no preference key exists for it.
 * Privacy (D7, D228): every read is metadata. The worker touches
 * `mail_messages.{provider_message_id, provider_thread_id, sender_key,
 * subject, internal_date, is_outbound}` — every column is allowlisted.
 * Narrative composition reads `senders.{display_name, email}` only.
 * Bodies, snippets, attachments, non-allowlisted headers — none
 * touched. The Haiku adapter, when wired, will pass the D62 allowed
 * fields (sender + subject + Gmail snippet) — all allowlisted.
 */
/**
 * All three D63 sections empty. Unknown / malformed shapes count as
 * NON-empty so the heal path can never clobber a payload it doesn't
 * understand.
 */
function isEmptyBriefPayload(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false;
  const b = p as { reply?: unknown; fyi?: unknown; noise?: unknown };
  return (
    Array.isArray(b.reply) &&
    b.reply.length === 0 &&
    Array.isArray(b.fyi) &&
    b.fyi.length === 0 &&
    Array.isArray(b.noise) &&
    b.noise.length === 0
  );
}

/**
 * SQL twin of `isEmptyBriefPayload` — the heal UPDATE's where-guard, so
 * a concurrent tick that already healed the row makes this one a no-op
 * instead of a double-write.
 */
function briefRunIsEmptySql() {
  return sql`jsonb_array_length(${briefRuns.briefPayload}->'reply') = 0
    and jsonb_array_length(${briefRuns.briefPayload}->'fyi') = 0
    and jsonb_array_length(${briefRuns.briefPayload}->'noise') = 0`;
}

export class BriefSnapshotWorker extends BaseDeclutrWorker<
  BriefSnapshotJobData,
  BriefSnapshotResult
> {
  override readonly workerName = 'BriefSnapshotWorker';
  override readonly policy = 'cronPolicy' as const;

  /** Per-call timeout for `llm.generateNarrative()` — D62 wall-clock guard. */
  private readonly llmTimeoutMs: number;

  constructor(private readonly deps: BriefSnapshotDeps) {
    super();
    this.llmTimeoutMs =
      deps.llmTimeoutMs ?? resolveBriefLlmTimeoutMs(process.env['BRIEF_LLM_TIMEOUT_MS']);
  }

  protected override getIdempotencyKey(payload: BriefSnapshotJobData): string {
    return `${this.workerName}:${payload.scheduledAtMinute}`;
  }

  override async processJob(
    _payload: BriefSnapshotJobData,
    _ctx: WorkerContext,
  ): Promise<BriefSnapshotResult> {
    const startedAt = Date.now();
    const now = (this.deps.now ?? (() => new Date()))();

    const mailboxes = await this.deps.db
      .select({
        id: mailboxAccounts.id,
        workspaceId: mailboxAccounts.workspaceId,
        // D64 — the owning user's preference bag; `parseBriefPrefs`
        // extracts the delivery hour with a safe default (8am local).
        preferences: users.preferences,
        timezone: users.timezone,
      })
      .from(mailboxAccounts)
      .innerJoin(users, eq(users.id, mailboxAccounts.userId))
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .where(inArray(workspaces.tier, BRIEF_TIERS));

    let briefsGenerated = 0;
    let emptyBriefs = 0;
    let mailboxesFailed = 0;

    // Bounded-concurrency fan-out — serial `await` per mailbox would
    // take O(N × ms) → many minutes at 10K mailboxes. The limiter
    // caps in-flight mailboxes so the Postgres pool isn't overwhelmed.
    // The per-mailbox try/catch still applies so one mailbox's failure
    // (transient DB error, schema drift, etc.) is caught + counted,
    // not propagated. D69's UNIQUE on `(mailbox, run_date_local)`
    // means a failed mailbox just retries on the next hourly tick.
    //
    // Counters are mutated only from the awaited per-mailbox body —
    // the limiter serializes the increment with the surrounding await
    // so no race exists despite the parallelism.
    const concurrency =
      this.deps.concurrency ?? resolveConcurrency(process.env.BRIEF_SNAPSHOT_CONCURRENCY);
    const limiter = createLimiter(concurrency);
    await Promise.all(
      mailboxes.map((mb) =>
        limiter(async () => {
          // D64 — the gate is the user's configured local hour (8am by
          // default). The hourly cron is catch-up-safe: before that hour
          // it writes nothing; any later tick can materialize the same
          // local day's row. Lowering the hour mid-day therefore
          // self-heals on the next tick, and raising it past the current
          // hour cannot un-write a Brief already frozen for today.
          const localWindow = resolveBriefLocalWindow(
            now,
            mb.timezone,
            parseBriefPrefs(mb.preferences).hour,
          );
          if (!localWindow.ready) return;
          try {
            const generated = await this.snapshotForMailbox(
              mb.id,
              mb.workspaceId,
              now,
              localWindow,
            );
            if (generated) {
              briefsGenerated += 1;
              if (generated.isEmpty) emptyBriefs += 1;
            }
          } catch (err) {
            mailboxesFailed += 1;
            console.error(
              JSON.stringify({
                level: 'error',
                kind: 'brief.mailbox_failed',
                worker: this.workerName,
                mailboxAccountId: mb.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
            // Counted, then the job returns SUCCESS — so BullMQ records a
            // clean run and the D203/D225 retry and dead-letter policy never
            // engages. Correct for isolation, blind for visibility: at one
            // failing mailbox in a hundred this is invisible, and at a
            // hundred in a hundred it is ALSO invisible, because the exit
            // code is identical. `console.error` does not close that gap —
            // Sentry runs with `integrations: []`, so nothing forwards it
            // (audit 2026-08-21).
            this.observer.captureBackgroundFailure(
              err instanceof Error ? err : new Error(String(err)),
              {
                kind: 'brief.mailbox_failed',
                tags: { worker: this.workerName, mailbox_account_id: mb.id },
              },
            );
          }
        }),
      ),
    );

    return {
      mailboxesProcessed: mailboxes.length,
      mailboxesFailed,
      briefsGenerated,
      emptyBriefs,
      durationMs: Date.now() - startedAt,
    };
  }

  private async snapshotForMailbox(
    mailboxAccountId: string,
    workspaceId: string,
    now: Date,
    localWindow: BriefLocalWindow,
  ): Promise<{ isEmpty: boolean } | null> {
    const { runDateLocal: todayLocal, previousDayStart: yesterdayStart, todayStart } = localWindow;

    // D69 frozen-once — but ONLY once the frozen brief is NON-empty.
    // An empty brief can be the zero-count race, not a quiet day: the
    // hourly tick can land minutes after 00:00 UTC while incremental
    // sync is still backfilling yesterday's rows, count zero, and
    // freeze a false "quiet yesterday" for the whole day (2026-07-07
    // founder smoke: Jul 6 had 125 inbound rows, brief said quiet).
    // So an EMPTY run stays replaceable — later ticks rebuild (cheap:
    // a zero-row day short-circuits to template without the LLM) and
    // overwrite it the first time a non-empty payload lands.
    const [existing] = await this.deps.db
      .select({ id: briefRuns.id, briefPayload: briefRuns.briefPayload })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          eq(briefRuns.runDateLocal, todayLocal),
        ),
      )
      .limit(1);
    if (existing && !isEmptyBriefPayload(existing.briefPayload)) return null;

    const { payload, generatedBy } = await this.buildPayload(
      mailboxAccountId,
      yesterdayStart,
      todayStart,
    );

    // Existing empty run + still-empty rebuild — nothing new to say;
    // keep the frozen empty row untouched (no churn, no log spam).
    if (existing && isEmptyBriefPayload(payload)) return null;

    // D63 defense-in-depth — Zod validates the EXACT three-section
    // shape (reply/fyi/noise + narrative + caps) right before insert.
    // If a future refactor mis-shapes the payload, we fail loudly here
    // instead of corrupting `brief_runs.brief_payload` and surfacing it
    // to the FE as broken data. Worker's per-mailbox try/catch upstream
    // counts the failure and continues to the next mailbox.
    briefPayloadSchema.parse(payload);
    // The DB package still carries the removed prelaunch marker in its
    // JSONB TypeScript declaration. Runtime validation above is the source
    // of truth until that separately-owned schema type is cleaned up.
    const persistedPayload = payload as unknown as PersistedBriefPayload;

    if (existing) {
      // Heal path — replace the frozen EMPTY run with the first
      // non-empty rebuild. Guarded on the row still being empty so a
      // concurrent tick that healed it first wins and this one no-ops.
      const updated = await this.deps.db
        .update(briefRuns)
        .set({ generatedBy, briefPayload: persistedPayload, generatedAt: now })
        .where(and(eq(briefRuns.id, existing.id), briefRunIsEmptySql()))
        .returning({ id: briefRuns.id });
      if (updated.length === 0) return null;
    } else {
      const inserted = await this.deps.db
        .insert(briefRuns)
        .values({
          workspaceId,
          mailboxAccountId,
          runDateLocal: todayLocal,
          generatedBy,
          briefPayload: persistedPayload,
          generatedAt: now,
        })
        .onConflictDoNothing({
          target: [briefRuns.mailboxAccountId, briefRuns.runDateLocal],
        })
        .returning({ id: briefRuns.id });
      if (inserted.length === 0) return null;
    }

    const isEmpty = isEmptyBriefPayload(payload);

    // Structured log — picked up by the same collector as every other
    // worker JSON line. The `kind: 'brief.generated'` selector + the
    // `generatedBy` tag is what PostHog ingest filters on for the
    // `brief.generator` counter (template vs llm_haiku). Includes
    // `isEmpty` so the D70 empty-day rate is observable without an
    // extra DB query.
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'brief.generated',
        worker: this.workerName,
        mailboxAccountId,
        runDateLocal: todayLocal,
        generatedBy,
        isEmpty,
        replyCount: payload.reply.length,
        fyiCount: payload.fyi.length,
        noiseGroupCount: payload.noise.length,
        // Pre-cap totals alongside the post-cap counts. `replyCount` is
        // structurally capped at 6, so on its own it can never answer
        // "how often does the D63 cap actually bite" — the question that
        // decides whether 6 and 4 are the right constants. Without these
        // the answer needs a JSONB scan of brief_runs.
        replyTotal: payload.replyTotal,
        fyiTotal: payload.fyiTotal,
      }),
    );

    return { isEmpty };
  }

  /**
   * Aggregate yesterday's inbound mail metadata into the D63 sections
   * + compose the D62 narrative (Haiku LLM if wired, deterministic
   * template otherwise).
   *
   * Returns BOTH the payload AND the `generatedBy` provenance so the
   * caller can stamp `brief_runs.generated_by` correctly (template vs
   * llm_haiku, per D62).
   *
   * Privacy (D7, D228): the `snippet` column we read here is on the
   * mail_messages allowlist; it leaves this function only via the
   * bounded `BriefNarrativeInput` to the LLM port — it is NEVER
   * persisted into `brief_payload` (the `BriefItem` type has no
   * snippet field).
   */
  private async buildPayload(
    mailboxAccountId: string,
    yesterdayStart: Date,
    todayStart: Date,
  ): Promise<{ payload: BriefPayload; generatedBy: 'llm_haiku' | 'template' }> {
    // Fetch yesterday's inbound message metadata. One row per message.
    // `snippet` is D7-allowlisted; the column type (varchar(300)) is
    // the privacy boundary — a buggy sync worker can't smuggle a body
    // in here.
    const messages = await this.deps.db
      .select({
        senderKey: mailMessages.senderKey,
        providerMessageId: mailMessages.providerMessageId,
        subject: mailMessages.subject,
        snippet: mailMessages.snippet,
        labelIds: mailMessages.labelIds,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.isOutbound, false),
          gte(mailMessages.internalDate, yesterdayStart),
          lt(mailMessages.internalDate, todayStart),
        ),
      )
      .orderBy(mailMessages.internalDate);

    if (messages.length === 0) {
      // D70 short-circuit — no LLM call on an empty day, no point
      // spending a Haiku request to say "you got 0 emails". The empty
      // payload is provenance `'template'` (deterministic, no LLM
      // touched it).
      return { payload: EMPTY_BRIEF_PAYLOAD, generatedBy: 'template' };
    }

    // Bucket messages by sender.
    type SenderBucket = {
      senderKey: string;
      messageIds: string[];
      representativeSubject: string;
      /** First snippet seen for this sender — used by the LLM prompt
       *  only; NEVER persisted into `brief_payload`. */
      representativeSnippet: string;
      hasImportant: boolean;
      hasStarred: boolean;
    };
    const bySender = new Map<string, SenderBucket>();
    for (const m of messages) {
      const prev = bySender.get(m.senderKey);
      if (prev) {
        prev.messageIds.push(m.providerMessageId);
        prev.hasImportant ||= m.labelIds.includes('IMPORTANT');
        prev.hasStarred ||= m.labelIds.includes('STARRED');
      } else {
        bySender.set(m.senderKey, {
          senderKey: m.senderKey,
          messageIds: [m.providerMessageId],
          representativeSubject: m.subject,
          representativeSnippet: m.snippet,
          hasImportant: m.labelIds.includes('IMPORTANT'),
          hasStarred: m.labelIds.includes('STARRED'),
        });
      }
    }

    const senderKeys = [...bySender.keys()];

    // Look up sender identity/engagement and engine verdict in 2 small
    // parallel queries. Per-feature filter on (mailbox, sender_key in [...]).
    const [identityRows, decisionRows] = await Promise.all([
      this.deps.db
        .select({
          senderKey: senders.senderKey,
          displayName: senders.displayName,
          email: senders.email,
          gmailCategory: senders.gmailCategory,
          wroteToCount: senders.wroteToCount,
          unsubscribeMethod: senders.unsubscribeMethod,
        })
        .from(senders)
        .where(
          and(
            eq(senders.mailboxAccountId, mailboxAccountId),
            inArray(senders.senderKey, senderKeys),
          ),
        ),
      this.deps.db
        .select({
          senderKey: triageDecisions.senderKey,
          verdict: triageDecisions.verdict,
        })
        .from(triageDecisions)
        .where(
          and(
            eq(triageDecisions.mailboxAccountId, mailboxAccountId),
            inArray(triageDecisions.senderKey, senderKeys),
          ),
        ),
    ]);

    const identityBy = new Map(identityRows.map((r) => [r.senderKey, r]));
    const verdictBy = new Map(decisionRows.map((r) => [r.senderKey, r.verdict]));
    const priorityBySenderKey = new Map<string, number>();

    // D63 + D67 categorization. Snippets are tracked in a parallel
    // map keyed on senderKey so the BriefItem (which is persisted)
    // stays snippet-free — snippets travel only through the LLM port
    // input downstream.
    const replyCandidates: BriefItem[] = [];
    const fyiCandidates: BriefItem[] = [];
    /**
     * FYI items the ENGINE chose (`later`), as opposed to the ones the
     * unsubscribe heuristic routed here. D63 caps FYI at 4, and before
     * the heuristic existed every candidate was an engine decision, so
     * the cap only ever chose between peers. Now an unscreened
     * promotion with a starred message outranks an engine `later` on
     * observed priority alone and pushes it off the Brief. An engine
     * verdict is a decision about the sender; the heuristic is a guess
     * about the sender. The decision wins.
     */
    const engineFyiKeys = new Set<string>();
    const noise: BriefSenderGroup[] = [];
    const snippetBySenderKey = new Map<string, string>();

    for (const bucket of bySender.values()) {
      const identity = identityBy.get(bucket.senderKey);
      // Defensive default — the senders row should exist after sync,
      // but if it's missing (e.g. orphaned sender_key), fall back to
      // a placeholder so we never crash a Brief on stale data.
      const senderName = identity?.displayName ?? '(unknown sender)';
      const senderEmail = identity?.email ?? '';
      const verdict = verdictBy.get(bucket.senderKey) ?? null;
      snippetBySenderKey.set(bucket.senderKey, bucket.representativeSnippet);
      priorityBySenderKey.set(
        bucket.senderKey,
        (bucket.hasImportant ? 8 : 0) +
          (bucket.hasStarred ? 4 : 0) +
          ((identity?.wroteToCount ?? 0) > 0 ? 2 : 0) +
          (identity?.gmailCategory === 'primary' ? 1 : 0),
      );

      const item: BriefItem = {
        senderKey: bucket.senderKey,
        senderName,
        senderEmail,
        subject: bucket.representativeSubject,
        messageIds: [...bucket.messageIds],
      };

      switch (verdict) {
        case 'archive':
        case 'unsubscribe':
          noise.push({
            senderKey: bucket.senderKey,
            senderName,
            messageCount: bucket.messageIds.length,
            messageIds: [...bucket.messageIds],
          });
          break;
        case 'later':
          engineFyiKeys.add(bucket.senderKey);
          fyiCandidates.push(item);
          break;
        case 'keep':
          // An explicit engine decision to keep. Always a reply
          // candidate — the engine has judged this sender and said so.
          replyCandidates.push(item);
          break;
        case null:
        default:
          // Unscreened: the engine has produced no verdict for this
          // sender yet. D63 defines Reply as "items genuinely needing
          // human response", and a sender that publishes a working
          // unsubscribe channel is a list you can leave, not a
          // correspondent waiting on you — so it does not belong there.
          //
          // It goes to FYI rather than Noise on purpose: Noise is the
          // D65 bulk-archive target, and offering to archive mail the
          // engine has never judged is a stronger claim than we have
          // earned. FYI says "this arrived, it is not waiting on you",
          // which is exactly what is known.
          //
          // Everything else stays a reply candidate, which keeps the
          // conservative default for the senders we cannot characterize.
          if (hasUnsubscribeChannel(identity?.unsubscribeMethod)) {
            fyiCandidates.push(item);
          } else {
            replyCandidates.push(item);
          }
          break;
      }
    }

    // D63 — cap reply at 6, fyi at 4. Within each engine-selected
    // section, observed engagement and Gmail importance decide which
    // items survive the cap. Manual safety state never changes Brief
    // categorization or priority.
    const reply = sortObservedPriority(replyCandidates, priorityBySenderKey).slice(0, REPLY_MAX);
    // Engine `later` verdicts take the FYI slots first; the unsubscribe
    // heuristic fills what is left. Within each group observed priority
    // still decides, so this only changes who survives the cap — never
    // the order among peers.
    const fyi = sortEngineFirst(
      sortObservedPriority(fyiCandidates, priorityBySenderKey),
      engineFyiKeys,
    ).slice(0, FYI_MAX);

    // D62 — narrative composition. The LLM path is preferred when wired
    // and successful; on any failure (null return, timeout, throw) the
    // worker falls back to the deterministic template. Provenance is
    // captured separately so `brief_runs.generated_by` records the path
    // that actually produced the stored copy.
    const { narrative, generatedBy } = await this.composeNarrative({
      mailboxAccountId,
      reply,
      fyi,
      noise,
      snippetBySenderKey,
    });

    return {
      payload: {
        reply,
        fyi,
        noise,
        narrative,
        // Pre-cap counts, so the screen can say "6 of 8" instead of
        // "6 of 6" — the cap restating itself as a fact about the day.
        // Captured here because the slice above is where the dropped
        // items stop existing; nothing downstream can recover them.
        replyTotal: replyCandidates.length,
        fyiTotal: fyiCandidates.length,
      },
      generatedBy,
    };
  }

  /**
   * D62 — pick the narrative source for one mailbox's Brief.
   *
   * Order of preference:
   *   1. `deps.llm.generateNarrative()` with a wall-clock timeout. Any
   *      failure mode (`null` return, timeout, unexpected throw) falls
   *      through to the template. The Anthropic adapter's contract is
   *      "no throws" — the `runWithTimeout` + outer try/catch are
   *      defense-in-depth for a future port impl that doesn't honor it.
   *   2. `renderTemplateNarrative()` — offline-safe, body-free,
   *      deterministic. The template path is feature-complete on its
   *      own (the worker shipped this path first; the LLM is layered
   *      on top).
   */
  private async composeNarrative(input: {
    mailboxAccountId: string;
    reply: readonly BriefItem[];
    fyi: readonly BriefItem[];
    noise: readonly BriefSenderGroup[];
    snippetBySenderKey: ReadonlyMap<string, string>;
  }): Promise<{ narrative: string; generatedBy: 'llm_haiku' | 'template' }> {
    if (this.deps.llm) {
      const port = this.deps.llm;
      const narrativeInput = buildNarrativeInput(input);
      try {
        const raced = await runWithTimeout(
          () => port.generateNarrative(narrativeInput),
          this.llmTimeoutMs,
        );
        if (raced.kind === 'ok' && raced.value !== null) {
          const trimmed = raced.value.trim();
          if (trimmed.length > 0) {
            return { narrative: trimmed, generatedBy: 'llm_haiku' };
          }
          // LLM returned an empty/whitespace-only string. Still a
          // failure, but the fall-through is no longer a recovery: the
          // template returns '' on any day with mail, so this branch now
          // produces exactly the empty narrative it used to avoid.
          //
          // That makes the signal load-bearing. Without it a mailbox
          // whose adapter returns empty every run is byte-identical to
          // one where no LLM was ever wired — same empty narrative, same
          // `generated_by: 'template'`, same screen. Its siblings below
          // each emit; this one used to be the only silent failure mode.
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'brief.llm_empty',
              worker: this.workerName,
              mailboxAccountId: input.mailboxAccountId,
            }),
          );
        }
        if (raced.kind === 'timeout') {
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'brief.llm_timeout',
              worker: this.workerName,
              mailboxAccountId: input.mailboxAccountId,
              timeoutMs: this.llmTimeoutMs,
            }),
          );
        }
        // `runWithTimeout` now REPORTS a rejection instead of rethrowing it,
        // so a failing port no longer reaches the catch below. Without this
        // branch the fallback would be silent and `brief.llm_error` — the
        // signal that says the port breached its "no throws" contract —
        // would simply stop being emitted.
        if (raced.kind === 'failed') {
          console.warn(
            JSON.stringify({
              level: 'warn',
              kind: 'brief.llm_error',
              worker: this.workerName,
              mailboxAccountId: input.mailboxAccountId,
              error: raced.error.name,
            }),
          );
        }
      } catch (err) {
        // Defense-in-depth — the port's contract is "no throws", but if a
        // future impl regresses we still fall back to the template + log
        // the breach so observability flags it.
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'brief.llm_error',
            worker: this.workerName,
            mailboxAccountId: input.mailboxAccountId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    return {
      narrative: renderTemplateNarrative({
        reply: input.reply,
        fyi: input.fyi,
        noise: input.noise,
      }),
      generatedBy: 'template',
    };
  }
}

/**
 * Build the bounded `BriefNarrativeInput` from the final sections + the
 * per-sender snippet map. Pure function — no clock, no I/O — so the
 * LLM-port adapter sees exactly the same shape on test runs as in prod.
 *
 * Snippets are looked up by senderKey; absent snippets fall back to
 * empty string (the prompt builder handles "(no preview)" rendering).
 */
function buildNarrativeInput(input: {
  reply: readonly BriefItem[];
  fyi: readonly BriefItem[];
  noise: readonly BriefSenderGroup[];
  snippetBySenderKey: ReadonlyMap<string, string>;
}): BriefNarrativeInput {
  const toNarrativeItem = (item: BriefItem): BriefNarrativeItem => ({
    senderName: item.senderName,
    senderEmail: item.senderEmail,
    subject: item.subject,
    snippet: input.snippetBySenderKey.get(item.senderKey) ?? '',
  });
  const toNoiseGroup = (group: BriefSenderGroup): BriefNarrativeNoiseGroup => ({
    senderName: group.senderName,
    messageCount: group.messageCount,
  });
  return {
    reply: input.reply.map(toNarrativeItem),
    fyi: input.fyi.map(toNarrativeItem),
    noise: input.noise.map(toNoiseGroup),
  };
}

/**
 * Stable-sort a capped section by observed importance. Equal-scored
 * items retain arrival order because modern JS sort is stable.
 */
/**
 * Stable partition: engine-chosen items first, heuristic ones after,
 * each keeping the order it arrived in.
 *
 * `Array#sort` is stable in every runtime this ships on (ES2019), so
 * feeding it an already-priority-sorted list preserves that order
 * inside each group — which is why this runs AFTER the priority sort
 * rather than folding into it.
 */
function sortEngineFirst<T extends { senderKey: string }>(
  items: T[],
  engineKeys: ReadonlySet<string>,
): T[] {
  return [...items].sort(
    (a, b) => Number(engineKeys.has(b.senderKey)) - Number(engineKeys.has(a.senderKey)),
  );
}

function sortObservedPriority<T extends { senderKey: string }>(
  items: T[],
  priorityBySenderKey: ReadonlyMap<string, number>,
): T[] {
  return [...items].sort(
    (a, b) =>
      (priorityBySenderKey.get(b.senderKey) ?? 0) - (priorityBySenderKey.get(a.senderKey) ?? 0),
  );
}
