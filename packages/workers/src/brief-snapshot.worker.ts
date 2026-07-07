import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  type BriefItem,
  type BriefPayload,
  type BriefSenderGroup,
  briefRuns,
  mailMessages,
  mailboxAccounts,
  type schema,
  senderPolicies,
  senders,
  triageDecisions,
} from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import {
  BRIEF_FYI_MAX,
  BRIEF_REPLY_MAX,
  briefPayloadSchema,
  EMPTY_BRIEF_PAYLOAD,
  renderTemplateNarrative,
  resolveBriefLlmTimeoutMs,
  type BriefLlmPort,
  type BriefNarrativeInput,
  type BriefNarrativeItem,
  type BriefNarrativeNoiseGroup,
} from './brief-narrative.js';
import { createLimiter, runWithTimeout } from './reasoning.js';
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

/** Cron job payload — same shape as `UndoExpiry` + `FollowupCheck`. */
export interface BriefSnapshotJobData {
  /** ISO-8601 minute boundary, e.g. `2026-05-25T08:00`. D225 cron key. */
  scheduledAtMinute: string;
}

/** Per-pass metrics — logged on `worker.succeeded`. */
export interface BriefSnapshotResult {
  /** Mailboxes inspected this pass. */
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
const REPLY_MAX = BRIEF_REPLY_MAX;
/** D63 — FYI section cap. */
const FYI_MAX = BRIEF_FYI_MAX;

/**
 * BriefSnapshotWorker (D61, D62, D63, D67, D69, D70).
 *
 * Hourly cron (`cronPolicy` per D203/D225) that materializes the
 * static 8am Brief snapshot for every mailbox whose local 8am hour
 * has just passed. Idempotency key
 * `BriefSnapshotWorker:${scheduledAtMinute}` plus the D69 UNIQUE on
 * `(mailbox_account_id, run_date_local)` make the worker fully
 * re-runnable: re-runs within the same local-date for the same mailbox
 * are no-ops once a NON-EMPTY brief is frozen (`ON CONFLICT DO
 * NOTHING`); an EMPTY brief stays replaceable so a zero-count race
 * against lagging sync can self-heal on a later tick.
 *
 * What the worker DOES:
 *   - Iterates every mailbox in `mailbox_accounts`.
 *   - For each mailbox, checks whether today's Brief already exists
 *     (D69 frozen-once invariant) and skips if so.
 *   - Queries yesterday's INBOUND `mail_messages` metadata.
 *   - Groups by sender, joins `senders` + `sender_policies` for VIP
 *     state + `triage_decisions` for engine verdict.
 *   - Categorizes into D63 sections:
 *       reply  — non-VIPs whose engine verdict is 'keep' or who have
 *                no decision yet AND VIPs (auto-elevated per D67).
 *                Capped at 6 (D63). VIPs win cap ties.
 *       fyi    — engine verdict 'later'. Capped at 4 (D63).
 *       noise  — engine verdict 'archive' or 'unsubscribe'. Uncapped.
 *   - Renders the deterministic D62 template narrative (Haiku adapter
 *     deferred to a follow-up PR; today every brief is `generated_by =
 *     'template'`).
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
 *   - Haiku LLM narrative (D62) — needs the Anthropic adapter the
 *     ReasoningLlmPort foreshadowed but doesn't yet implement. Falls
 *     back to the deterministic template per D62 until then.
 *   - User-timezone routing (D64 "8am in user's local timezone") —
 *     `users.timezone` doesn't exist yet. V2 assumes UTC; the 1-hour
 *     cron cadence + D69 UNIQUE means the worst case is an early UTC
 *     Brief that re-tries (and no-ops) once the user's true 8am
 *     arrives.
 *   - D61 email digest delivery — separate worker that watches for
 *     `email_sent_at IS NULL` rows from users opted in.
 *   - VIP `is_vip` is read directly from `sender_policies`; the
 *     D67 auto-elevation rule is applied in code here.
 *
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
      .select({ id: mailboxAccounts.id, workspaceId: mailboxAccounts.workspaceId })
      .from(mailboxAccounts);

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
          try {
            const generated = await this.snapshotForMailbox(mb.id, mb.workspaceId, now);
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
  ): Promise<{ isEmpty: boolean } | null> {
    // D64 V2 simplification — every mailbox treated as UTC. Yesterday
    // is the UTC date that ended at 00:00 UTC today; today is the
    // current UTC date. When `users.timezone` lands the worker swaps
    // these for tz-aware boundaries.
    const todayLocal = utcDateString(now);
    const yesterdayStart = new Date(now);
    yesterdayStart.setUTCHours(0, 0, 0, 0);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    const todayStart = new Date(yesterdayStart);
    todayStart.setUTCDate(todayStart.getUTCDate() + 1);

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

    if (existing) {
      // Heal path — replace the frozen EMPTY run with the first
      // non-empty rebuild. Guarded on the row still being empty so a
      // concurrent tick that healed it first wins and this one no-ops.
      const updated = await this.deps.db
        .update(briefRuns)
        .set({ generatedBy, briefPayload: payload, generatedAt: now })
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
          briefPayload: payload,
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
    };
    const bySender = new Map<string, SenderBucket>();
    for (const m of messages) {
      const prev = bySender.get(m.senderKey);
      if (prev) {
        prev.messageIds.push(m.providerMessageId);
      } else {
        bySender.set(m.senderKey, {
          senderKey: m.senderKey,
          messageIds: [m.providerMessageId],
          representativeSubject: m.subject,
          representativeSnippet: m.snippet,
        });
      }
    }

    const senderKeys = [...bySender.keys()];

    // Look up sender identity + VIP state + engine verdict in 3 small
    // parallel queries. Per-feature filter on (mailbox, sender_key in [...]).
    const [identityRows, policyRows, decisionRows] = await Promise.all([
      this.deps.db
        .select({
          senderKey: senders.senderKey,
          displayName: senders.displayName,
          email: senders.email,
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
          senderKey: senderPolicies.senderKey,
          isVip: senderPolicies.isVip,
        })
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            inArray(senderPolicies.senderKey, senderKeys),
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
    const vipBy = new Map(policyRows.map((r) => [r.senderKey, Boolean(r.isVip)]));
    const verdictBy = new Map(decisionRows.map((r) => [r.senderKey, r.verdict]));

    // D63 + D67 categorization. Snippets are tracked in a parallel
    // map keyed on senderKey so the BriefItem (which is persisted)
    // stays snippet-free — snippets travel only through the LLM port
    // input downstream.
    const replyCandidates: BriefItem[] = [];
    const fyiCandidates: BriefItem[] = [];
    const noise: BriefSenderGroup[] = [];
    const snippetBySenderKey = new Map<string, string>();

    for (const bucket of bySender.values()) {
      const identity = identityBy.get(bucket.senderKey);
      // Defensive default — the senders row should exist after sync,
      // but if it's missing (e.g. orphaned sender_key), fall back to
      // a placeholder so we never crash a Brief on stale data.
      const senderName = identity?.displayName ?? '(unknown sender)';
      const senderEmail = identity?.email ?? '';
      const isVip = vipBy.get(bucket.senderKey) ?? false;
      const verdict = verdictBy.get(bucket.senderKey) ?? null;
      snippetBySenderKey.set(bucket.senderKey, bucket.representativeSnippet);

      const item: BriefItem = {
        senderKey: bucket.senderKey,
        senderName,
        senderEmail,
        subject: bucket.representativeSubject,
        isVip,
        messageIds: [...bucket.messageIds],
      };

      // D67 — VIPs always elevate to Reply, regardless of verdict.
      if (isVip) {
        replyCandidates.push(item);
        continue;
      }

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
          fyiCandidates.push(item);
          break;
        case 'keep':
        case null:
        default:
          // No verdict OR keep verdict → reply candidate. Conservative
          // (keep the user in the loop) per D63's "items genuinely
          // needing human response".
          replyCandidates.push(item);
          break;
      }
    }

    // D63 — cap reply at 6, fyi at 4. VIPs are appended FIRST so a
    // mixed list naturally favors VIPs in the cap (D67's elevation
    // rule means VIPs already won bucket selection; this preserves
    // them in the cap).
    const reply = sortVipFirst(replyCandidates).slice(0, REPLY_MAX);
    const fyi = sortVipFirst(fyiCandidates).slice(0, FYI_MAX);

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
      payload: { reply, fyi, noise, narrative },
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
          // LLM returned an empty/whitespace-only string — treat as
          // failure and fall through. Empty narrative would be a worse
          // UX than the template summary.
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
    isVip: item.isVip,
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
 * D67 — preserve the VIP elevation invariant inside a capped section.
 * Stable-sorts so VIPs sit before non-VIPs without disturbing the
 * intra-bucket arrival order.
 */
function sortVipFirst<T extends { isVip: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.isVip === b.isVip) return 0;
    return a.isVip ? -1 : 1;
  });
}

/** Render `YYYY-MM-DD` from a Date treating it as UTC. */
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
