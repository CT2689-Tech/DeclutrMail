import { and, eq, gte, inArray, lt } from 'drizzle-orm';
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
import type { WorkerContext } from './worker-context.js';

type WorkerDb = PostgresJsDatabase<typeof schema>;

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
}

/** D63 — Reply section cap. */
const REPLY_MAX = 6;
/** D63 — FYI section cap. */
const FYI_MAX = 4;

/**
 * BriefSnapshotWorker (D61, D62, D63, D67, D69, D70).
 *
 * Hourly cron (`cronPolicy` per D203/D225) that materializes the
 * static 8am Brief snapshot for every mailbox whose local 8am hour
 * has just passed. Idempotency key
 * `BriefSnapshotWorker:${scheduledAtMinute}` plus the D69 UNIQUE on
 * `(mailbox_account_id, run_date_local)` make the worker fully
 * re-runnable: re-runs within the same local-date for the same mailbox
 * are no-ops because the upsert uses `ON CONFLICT DO NOTHING`.
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
 *   - Upserts into `brief_runs` ON CONFLICT (mailbox, date) DO NOTHING.
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
export class BriefSnapshotWorker extends BaseDeclutrWorker<
  BriefSnapshotJobData,
  BriefSnapshotResult
> {
  override readonly workerName = 'BriefSnapshotWorker';
  override readonly policy = 'cronPolicy' as const;

  constructor(private readonly deps: BriefSnapshotDeps) {
    super();
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

    // Per-mailbox try/catch — one mailbox's failure (transient DB
    // error, schema drift, etc.) must NOT stop every other user from
    // getting their Brief. The next mailbox still runs; D69's UNIQUE
    // on `(mailbox, run_date_local)` means the failed mailbox just
    // retries on the next hourly cron tick.
    for (const mb of mailboxes) {
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
    }

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

    // D69 frozen-once — skip if today's Brief already exists. The
    // upsert below would do the same via ON CONFLICT, but the early
    // skip avoids the per-mailbox aggregation work entirely.
    const [existing] = await this.deps.db
      .select({ id: briefRuns.id })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.mailboxAccountId, mailboxAccountId),
          eq(briefRuns.runDateLocal, todayLocal),
        ),
      )
      .limit(1);
    if (existing) return null;

    const payload = await this.buildPayload(mailboxAccountId, yesterdayStart, todayStart);

    const inserted = await this.deps.db
      .insert(briefRuns)
      .values({
        workspaceId,
        mailboxAccountId,
        runDateLocal: todayLocal,
        generatedBy: 'template',
        briefPayload: payload,
        generatedAt: now,
      })
      .onConflictDoNothing({
        target: [briefRuns.mailboxAccountId, briefRuns.runDateLocal],
      })
      .returning({ id: briefRuns.id });
    if (inserted.length === 0) return null;

    const isEmpty =
      payload.reply.length === 0 && payload.fyi.length === 0 && payload.noise.length === 0;
    return { isEmpty };
  }

  /**
   * Aggregate yesterday's inbound mail metadata into the D63 sections.
   * Pure SQL + in-process categorization — no LLM, no clock dependency
   * past `yesterdayStart` / `todayStart`.
   */
  private async buildPayload(
    mailboxAccountId: string,
    yesterdayStart: Date,
    todayStart: Date,
  ): Promise<BriefPayload> {
    // Fetch yesterday's inbound message metadata. One row per message.
    const messages = await this.deps.db
      .select({
        senderKey: mailMessages.senderKey,
        providerMessageId: mailMessages.providerMessageId,
        subject: mailMessages.subject,
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
      return EMPTY_PAYLOAD;
    }

    // Bucket messages by sender.
    type SenderBucket = {
      senderKey: string;
      messageIds: string[];
      representativeSubject: string;
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

    // D63 + D67 categorization.
    const replyCandidates: BriefItem[] = [];
    const fyiCandidates: BriefItem[] = [];
    const noise: BriefSenderGroup[] = [];

    for (const bucket of bySender.values()) {
      const identity = identityBy.get(bucket.senderKey);
      // Defensive default — the senders row should exist after sync,
      // but if it's missing (e.g. orphaned sender_key), fall back to
      // a placeholder so we never crash a Brief on stale data.
      const senderName = identity?.displayName ?? '(unknown sender)';
      const senderEmail = identity?.email ?? '';
      const isVip = vipBy.get(bucket.senderKey) ?? false;
      const verdict = verdictBy.get(bucket.senderKey) ?? null;

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

    const narrative = renderTemplateNarrative({
      replyCount: reply.length,
      fyiCount: fyi.length,
      noiseCount: noise.reduce((sum, g) => sum + g.messageCount, 0),
    });

    return { reply, fyi, noise, narrative };
  }
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

/**
 * Deterministic D62 template fallback. The Haiku narrative replaces
 * this once the Anthropic adapter lands. Empty-day copy is the D70
 * "calm message" verbatim.
 */
function renderTemplateNarrative(counts: {
  replyCount: number;
  fyiCount: number;
  noiseCount: number;
}): string {
  if (counts.replyCount === 0 && counts.fyiCount === 0 && counts.noiseCount === 0) {
    return `Your inbox was quiet yesterday.\n\nEnjoy the morning — we'll be back tomorrow.`;
  }
  const parts: string[] = [];
  if (counts.replyCount > 0) {
    parts.push(
      `${counts.replyCount} ${counts.replyCount === 1 ? 'email needs a reply' : 'emails need replies'}`,
    );
  }
  if (counts.fyiCount > 0) {
    parts.push(`${counts.fyiCount} FYI${counts.fyiCount === 1 ? '' : 's'}`);
  }
  if (counts.noiseCount > 0) {
    parts.push(
      `${counts.noiseCount} ${counts.noiseCount === 1 ? 'message' : 'messages'} you can archive`,
    );
  }
  return `${parts.join(', ')}.`;
}

const EMPTY_PAYLOAD: BriefPayload = {
  reply: [],
  fyi: [],
  noise: [],
  narrative: `Your inbox was quiet yesterday.\n\nEnjoy the morning — we'll be back tomorrow.`,
};

/** Render `YYYY-MM-DD` from a Date treating it as UTC. */
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
