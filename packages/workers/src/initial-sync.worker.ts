import { mailMessages, providerSyncState, senders, senderTimeseries } from '@declutrmail/db';
import type { NewMailMessage, NewSender, NewSenderTimeseries, schema } from '@declutrmail/db';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { GmailAccess, GmailMessageMetadata, GmailMetadataClient } from './ports.js';
import { deriveSenderKey, emailDomain, normalizeEmail, parseFromHeader } from './sender-key.js';
import { ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';
import type { InitialSyncJobData } from './queue.js';

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/** The five `senders.gmail_category` enum values (D222 — Gmail's own labels). */
type GmailCategory = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

/** Gmail `CATEGORY_*` label → `senders.gmail_category` enum (D222). */
const CATEGORY_LABEL_MAP: Record<string, GmailCategory> = {
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
};

/** Tie-break order when a sender's category counts are equal. */
const CATEGORY_ORDER: readonly GmailCategory[] = [
  'primary',
  'promotions',
  'social',
  'updates',
  'forums',
];

/** How many `messages.get` calls run in parallel — the per-job throttle (D5). */
const FETCH_CONCURRENCY = 20;
/** Rows per `mail_messages` upsert batch. */
const UPSERT_BATCH = 500;

/** Dependencies the worker needs — injected by the composition root. */
export interface InitialSyncDeps {
  db: WorkerDb;
  gmailAccess: GmailAccess;
}

/**
 * What one backfill produced — counts + timing.
 *
 * Sync duration is DeclutrMail's load-bearing trust signal (onboarding
 * gate, D6). These metric-only fields are logged on `worker.succeeded`
 * today and are shaped to map 1:1 onto a future `sync_runs` history
 * table (D-candidate — see FOUNDER-FOLLOWUPS.md) so persisting them
 * later is just a write, not a re-measurement.
 */
export interface InitialSyncResult {
  messagesSynced: number;
  sendersIndexed: number;
  /** Total Gmail API calls — `messages.list` pages + `messages.get`. */
  gmailApiCalls: number;
  /** Wall-clock ms for the whole backfill (stage 1 start → ready). */
  durationMs: number;
  /** Per-stage wall-clock ms, keyed by D224 stage name. */
  stageTimings: Record<string, number>;
}

/** Per-sender rollup accumulated during the single metadata-fetch pass. */
interface SenderAccumulator {
  senderKey: string;
  email: string;
  displayName: string;
  domain: string;
  firstSeen: Date;
  lastSeen: Date;
  categoryCounts: Map<GmailCategory, number>;
  /** year-month (`YYYY-MM-01`) → monthly volume + read count. */
  months: Map<string, { volume: number; readCount: number }>;
}

/**
 * InitialSyncWorker (D157, D224) — the full-mailbox metadata backfill.
 *
 * On a mailbox connect this worker walks every message in the mailbox,
 * mirrors the D7 metadata allowlist into `mail_messages`, then
 * materializes `senders` + `sender_timeseries`. It advances
 * `provider_sync_state` through the D224 stage order so the onboarding
 * gate can render real progress.
 *
 * Privacy (D7): the only Gmail call is `messages.get?format=metadata`
 * (via `GmailMetadataClient`). Bodies, attachments, and MIME are never
 * fetched — the "Full bodies fetched: 0" guarantee.
 *
 * Worker policy: `perMailboxPolicy` (D203/D225). Idempotency key:
 * `mailboxAccountId` (BullMQ `jobId` dedups concurrent enqueues; message
 * rows dedup via the `(mailbox_account_id, provider_message_id)` unique
 * index + upsert, so a retry cannot double-insert).
 *
 * Sender aggregation note: D224's `building_sender_index` is realized as
 * a single in-memory pass during `fetching_metadata` rather than a SQL
 * `GROUP BY mail_messages`. `mail_messages` stores only `sender_key`, not
 * the sender's email / display name (D7 split — identity lives in
 * `senders`), so that identity must be carried from the fetch pass
 * regardless; aggregating in the same pass avoids re-scanning every row.
 */
export class InitialSyncWorker extends BaseDeclutrWorker<InitialSyncJobData, InitialSyncResult> {
  override readonly workerName = 'InitialSyncWorker';
  override readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: InitialSyncDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: InitialSyncJobData): string {
    return payload.mailboxAccountId;
  }

  override async processJob(
    payload: InitialSyncJobData,
    _ctx: WorkerContext,
  ): Promise<InitialSyncResult> {
    const mailboxAccountId = payload?.mailboxAccountId;
    if (!mailboxAccountId) {
      throw new ValidationError('initial-sync job is missing mailboxAccountId');
    }

    // Time each D224 stage. `lap(stage)` records ms since the last lap.
    const startedAt = Date.now();
    const stageTimings: Record<string, number> = {};
    let lastMark = startedAt;
    const lap = (stage: string): void => {
      const now = Date.now();
      stageTimings[stage] = now - lastMark;
      lastMark = now;
    };

    // Stage 1 — fetching_metadata.
    await this.upsertSyncState(mailboxAccountId, 'fetching_metadata', 5, 'syncing');
    const client = await this.deps.gmailAccess.getClient(mailboxAccountId);
    const { messagesSynced, accumulators, gmailApiCalls } = await this.fetchAndStoreMetadata(
      mailboxAccountId,
      client,
    );
    lap('fetching_metadata');

    // Stage 2 — building_sender_index.
    await this.upsertSyncState(mailboxAccountId, 'building_sender_index', 80, 'syncing');
    const sendersIndexed = await this.buildSenderIndex(mailboxAccountId, accumulators);
    lap('building_sender_index');

    // Stage 3 — computing_recommendations. The recommendation engine
    // lands in a later PR; PR-C transitions through this D224 stage as a
    // structural placeholder (the stage value is accurate — the pipeline
    // is at this ordinal — there is simply no work here yet).
    await this.upsertSyncState(mailboxAccountId, 'computing_recommendations', 90, 'syncing');
    lap('computing_recommendations');

    // Stage 4 — finalizing.
    await this.upsertSyncState(mailboxAccountId, 'finalizing', 97, 'syncing');
    lap('finalizing');

    // Stage 5 — ready.
    await this.markReady(mailboxAccountId);

    return {
      messagesSynced,
      sendersIndexed,
      gmailApiCalls,
      durationMs: Date.now() - startedAt,
      stageTimings,
    };
  }

  /**
   * On terminal failure, record it on `provider_sync_state` so the
   * onboarding gate shows a real error instead of a stuck spinner.
   */
  protected override async onTerminalFailure(
    payload: InitialSyncJobData,
    error: Error,
  ): Promise<void> {
    const mailboxAccountId = payload?.mailboxAccountId;
    if (!mailboxAccountId) {
      return;
    }
    await this.deps.db
      .insert(providerSyncState)
      .values({
        mailboxAccountId,
        currentStage: 'failed',
        readinessStatus: 'failed',
        errorCode: error.name,
      })
      .onConflictDoUpdate({
        target: providerSyncState.mailboxAccountId,
        set: {
          currentStage: 'failed',
          readinessStatus: 'failed',
          errorCode: error.name,
          updatedAt: sql`now()`,
        },
      });
  }

  /**
   * Stage 1 — page every message id, fetch each one's metadata
   * (`format=metadata`), upsert into `mail_messages`, and accumulate the
   * per-sender rollup.
   */
  private async fetchAndStoreMetadata(
    mailboxAccountId: string,
    client: GmailMetadataClient,
  ): Promise<{
    messagesSynced: number;
    accumulators: Map<string, SenderAccumulator>;
    gmailApiCalls: number;
  }> {
    // `gmailApiCalls` counts every Gmail HTTP call — list pages + gets —
    // so timing can be read against API cost (D5 quota awareness).
    let gmailApiCalls = 0;

    // Collect every id first so total is known → real progress_pct.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.listMessageIds(pageToken);
      gmailApiCalls += 1;
      ids.push(...page.ids);
      pageToken = page.nextPageToken;
    } while (pageToken);

    // Oldest → newest (fork #5). Gmail lists newest-first.
    ids.reverse();
    const total = ids.length;

    const accumulators = new Map<string, SenderAccumulator>();
    let pending: NewMailMessage[] = [];
    let messagesSynced = 0;

    for (let i = 0; i < total; i += FETCH_CONCURRENCY) {
      const chunk = ids.slice(i, i + FETCH_CONCURRENCY);
      const metas = await Promise.all(chunk.map((id) => client.getMessageMetadata(id)));
      gmailApiCalls += chunk.length;

      for (const meta of metas) {
        if (!meta) {
          continue; // message was deleted between list and get.
        }
        const row = this.toMessageRow(mailboxAccountId, meta);
        if (!row) {
          continue; // unparseable sender — cannot be keyed; skip.
        }
        pending.push(row.message);
        this.accumulate(accumulators, row);
        messagesSynced += 1;
      }

      if (pending.length >= UPSERT_BATCH) {
        await this.flushMessages(pending);
        pending = [];
        await this.updateProgress(mailboxAccountId, messagesSynced, total);
      }
    }
    if (pending.length > 0) {
      await this.flushMessages(pending);
    }

    return { messagesSynced, accumulators, gmailApiCalls };
  }

  /**
   * Build a `mail_messages` row + the derived sender facts from one
   * message's metadata. Returns `null` when the `From` header carries no
   * usable address.
   */
  private toMessageRow(
    mailboxAccountId: string,
    meta: GmailMessageMetadata,
  ): { message: NewMailMessage; senderKey: string; sender: ParsedFacts } | null {
    const parsed = parseFromHeader(meta.from);
    if (!parsed) {
      return null;
    }
    const email = normalizeEmail(parsed.email);
    const senderKey = deriveSenderKey(email);
    const internalDate = new Date(Number(meta.internalDate));
    const isUnread = meta.labelIds.includes('UNREAD');
    const category = this.toGmailCategory(meta.labelIds);

    const message: NewMailMessage = {
      mailboxAccountId,
      providerMessageId: meta.id,
      providerThreadId: meta.threadId,
      senderKey,
      subject: meta.subject ?? '',
      snippet: meta.snippet.slice(0, 300),
      internalDate,
      labelIds: meta.labelIds,
      isUnread,
    };

    return {
      message,
      senderKey,
      sender: {
        email,
        displayName: parsed.displayName,
        domain: emailDomain(email),
        internalDate,
        isUnread,
        category,
      },
    };
  }

  /** Fold one message's facts into the per-sender accumulator. */
  private accumulate(
    accumulators: Map<string, SenderAccumulator>,
    row: { senderKey: string; sender: ParsedFacts },
  ): void {
    const { senderKey, sender } = row;
    let acc = accumulators.get(senderKey);
    if (!acc) {
      acc = {
        senderKey,
        email: sender.email,
        displayName: sender.displayName,
        domain: sender.domain,
        firstSeen: sender.internalDate,
        lastSeen: sender.internalDate,
        categoryCounts: new Map(),
        months: new Map(),
      };
      accumulators.set(senderKey, acc);
    }

    if (sender.internalDate < acc.firstSeen) {
      acc.firstSeen = sender.internalDate;
    }
    if (sender.internalDate > acc.lastSeen) {
      acc.lastSeen = sender.internalDate;
    }
    // Prefer the first non-empty display name we see for this sender.
    if (!acc.displayName && sender.displayName) {
      acc.displayName = sender.displayName;
    }
    acc.categoryCounts.set(sender.category, (acc.categoryCounts.get(sender.category) ?? 0) + 1);

    const ym = monthKey(sender.internalDate);
    const month = acc.months.get(ym) ?? { volume: 0, readCount: 0 };
    month.volume += 1;
    if (!sender.isUnread) {
      month.readCount += 1;
    }
    acc.months.set(ym, month);
  }

  /**
   * Stage 2 — flush the accumulators into `senders` + `sender_timeseries`.
   * Returns the distinct-sender count.
   */
  private async buildSenderIndex(
    mailboxAccountId: string,
    accumulators: Map<string, SenderAccumulator>,
  ): Promise<number> {
    const senderRows: NewSender[] = [];
    const timeseriesRows: NewSenderTimeseries[] = [];

    for (const acc of accumulators.values()) {
      senderRows.push({
        mailboxAccountId,
        senderKey: acc.senderKey,
        displayName: acc.displayName,
        email: acc.email,
        domain: acc.domain,
        gmailCategory: dominantCategory(acc.categoryCounts),
        firstSeenAt: acc.firstSeen,
        lastSeenAt: acc.lastSeen,
      });
      for (const [yearMonth, month] of acc.months) {
        timeseriesRows.push({
          mailboxAccountId,
          senderKey: acc.senderKey,
          yearMonth,
          volume: month.volume,
          readCount: month.readCount,
        });
      }
    }

    for (let i = 0; i < senderRows.length; i += UPSERT_BATCH) {
      await this.deps.db
        .insert(senders)
        .values(senderRows.slice(i, i + UPSERT_BATCH))
        .onConflictDoUpdate({
          target: [senders.mailboxAccountId, senders.senderKey],
          set: {
            displayName: sql`excluded.display_name`,
            email: sql`excluded.email`,
            domain: sql`excluded.domain`,
            gmailCategory: sql`excluded.gmail_category`,
            firstSeenAt: sql`excluded.first_seen_at`,
            lastSeenAt: sql`excluded.last_seen_at`,
            updatedAt: sql`now()`,
          },
        });
    }

    for (let i = 0; i < timeseriesRows.length; i += UPSERT_BATCH) {
      await this.deps.db
        .insert(senderTimeseries)
        .values(timeseriesRows.slice(i, i + UPSERT_BATCH))
        .onConflictDoUpdate({
          target: [
            senderTimeseries.mailboxAccountId,
            senderTimeseries.senderKey,
            senderTimeseries.yearMonth,
          ],
          set: {
            volume: sql`excluded.volume`,
            readCount: sql`excluded.read_count`,
          },
        });
    }

    return senderRows.length;
  }

  /** Batch-upsert `mail_messages`, deduped by the provider-message unique index. */
  private async flushMessages(rows: NewMailMessage[]): Promise<void> {
    await this.deps.db
      .insert(mailMessages)
      .values(rows)
      .onConflictDoUpdate({
        target: [mailMessages.mailboxAccountId, mailMessages.providerMessageId],
        set: {
          senderKey: sql`excluded.sender_key`,
          subject: sql`excluded.subject`,
          snippet: sql`excluded.snippet`,
          internalDate: sql`excluded.internal_date`,
          labelIds: sql`excluded.label_ids`,
          isUnread: sql`excluded.is_unread`,
          updatedAt: sql`now()`,
        },
      });
  }

  /** Map a message's Gmail labels to its category (D222 — never predicted). */
  private toGmailCategory(labelIds: string[]): GmailCategory {
    for (const label of labelIds) {
      const mapped = CATEGORY_LABEL_MAP[label];
      if (mapped) {
        return mapped;
      }
    }
    // No CATEGORY_* label → the message sits in Gmail's Primary tab.
    return 'primary';
  }

  /** Advance `progress_pct` across the fetching_metadata stage (5 → 75). */
  private async updateProgress(
    mailboxAccountId: string,
    processed: number,
    total: number,
  ): Promise<void> {
    const pct = total === 0 ? 75 : 5 + Math.round((70 * processed) / total);
    await this.deps.db
      .update(providerSyncState)
      .set({ progressPct: Math.min(pct, 75), updatedAt: sql`now()` })
      .where(sql`${providerSyncState.mailboxAccountId} = ${mailboxAccountId}`);
  }

  /** Upsert the sync-state row to a stage + progress (idempotent). */
  private async upsertSyncState(
    mailboxAccountId: string,
    stage:
      | 'fetching_metadata'
      | 'building_sender_index'
      | 'computing_recommendations'
      | 'finalizing',
    progressPct: number,
    readinessStatus: 'syncing',
  ): Promise<void> {
    await this.deps.db
      .insert(providerSyncState)
      .values({ mailboxAccountId, currentStage: stage, progressPct, readinessStatus })
      .onConflictDoUpdate({
        target: providerSyncState.mailboxAccountId,
        set: {
          currentStage: stage,
          progressPct,
          readinessStatus,
          errorCode: null,
          updatedAt: sql`now()`,
        },
      });
  }

  /** Final transition — stage `ready`, 100%, sync timestamp set. */
  private async markReady(mailboxAccountId: string): Promise<void> {
    await this.deps.db
      .insert(providerSyncState)
      .values({
        mailboxAccountId,
        currentStage: 'ready',
        readinessStatus: 'ready',
        progressPct: 100,
      })
      .onConflictDoUpdate({
        target: providerSyncState.mailboxAccountId,
        set: {
          currentStage: 'ready',
          readinessStatus: 'ready',
          progressPct: 100,
          errorCode: null,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Facts derived from one message, folded into the sender accumulator. */
interface ParsedFacts {
  email: string;
  displayName: string;
  domain: string;
  internalDate: Date;
  isUnread: boolean;
  category: GmailCategory;
}

/** First day of the message's calendar month, `YYYY-MM-01` (UTC). */
function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** The most frequent category for a sender; ties break by `CATEGORY_ORDER`. */
function dominantCategory(counts: Map<GmailCategory, number>): GmailCategory {
  let best: GmailCategory = 'primary';
  let bestCount = -1;
  for (const category of CATEGORY_ORDER) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}
