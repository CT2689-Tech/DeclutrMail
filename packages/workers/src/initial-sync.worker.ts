import { mailMessages, providerSyncState, senders, senderTimeseries } from '@declutrmail/db';
import type { NewMailMessage, NewSender, NewSenderTimeseries, schema } from '@declutrmail/db';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { parseListUnsubscribe, parseRecipients } from './header-parsing.js';
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

/** How many `messages.get` calls run in parallel (the `RateLimiter` governs rate). */
const FETCH_CONCURRENCY = 20;
/** Rows per upsert batch. */
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
 *
 * On a RESUMED run `gmailApiCalls` is much smaller than `messagesSynced`
 * — already-fetched messages are skipped — which is itself the resume
 * signal.
 */
export interface InitialSyncResult {
  /** Total messages in the mailbox now mirrored into `mail_messages`. */
  messagesSynced: number;
  sendersIndexed: number;
  /** Gmail API calls THIS run — `messages.list` pages + `messages.get`. */
  gmailApiCalls: number;
  /** Wall-clock ms for the whole backfill (stage 1 start → ready). */
  durationMs: number;
  /** Per-stage wall-clock ms, keyed by D224 stage name. */
  stageTimings: Record<string, number>;
}

/** Three values of the `gmail_unsubscribe_method` enum (D9, RFC 8058). */
type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/** Per-sender aggregate folded from the persisted `mail_messages` rows. */
interface SenderAggregate {
  firstSeen: Date;
  lastSeen: Date;
  categoryCounts: Map<GmailCategory, number>;
  /** year-month (`YYYY-MM-01`) → monthly volume + read count. */
  months: Map<string, { volume: number; readCount: number }>;
  /** Best `List-Unsubscribe` URL across the sender's messages (D9). */
  unsubscribeUrl: string | null;
  /** True iff any of the sender's messages support RFC 8058 one-click. */
  unsubscribeOneClick: boolean;
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
 * `mailboxAccountId`.
 *
 * RESUMABLE (D5). A full mailbox is 50k–250k messages; at Gmail's quota
 * ceiling (3,000 messages/min) a sync runs many minutes and WILL be
 * interrupted (quota, deploy, crash). `mail_messages` IS the checkpoint:
 * on (re)start the worker fetches only message ids not already stored,
 * so a retry never re-fetches — never re-burns quota — and resumes from
 * where it stopped. `building_sender_index` therefore aggregates from
 * the persisted `mail_messages` rows (D224's "GROUP BY mail_messages"),
 * NOT from an in-fetch in-memory pass — the in-memory pass could not see
 * messages fetched by a prior attempt.
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

    // Stage 1 — fetching_metadata (resumable).
    await this.upsertSyncState(mailboxAccountId, 'fetching_metadata', 5, 'syncing');
    const client = await this.deps.gmailAccess.getClient(mailboxAccountId);

    // Snapshot the user-level historyId BEFORE the fetch (D5 — PR-D
    // incremental sync starts from here). Snapshotting BEFORE the fetch
    // means any change during the fetch is replayed by the first
    // incremental run — upserts are idempotent so re-processing is safe.
    const profile = await client.getProfile();
    const snapshotHistoryId = profile.historyId;

    const { messagesSynced, gmailApiCalls: fetchCalls } = await this.fetchAndStoreMetadata(
      mailboxAccountId,
      client,
    );
    const gmailApiCalls = fetchCalls + 1; // +1 for getProfile.
    lap('fetching_metadata');

    // Stage 2 — building_sender_index (aggregates from mail_messages).
    await this.upsertSyncState(mailboxAccountId, 'building_sender_index', 80, 'syncing');
    const sendersIndexed = await this.buildSenderIndex(mailboxAccountId);
    lap('building_sender_index');

    // Stage 3 — computing_recommendations. The recommendation engine
    // lands in a later PR; the worker transitions through this D224
    // stage as a structural placeholder (the stage value is accurate —
    // the pipeline is at this ordinal — there is simply no work yet).
    await this.upsertSyncState(mailboxAccountId, 'computing_recommendations', 90, 'syncing');
    lap('computing_recommendations');

    // Stage 4 — finalizing.
    await this.upsertSyncState(mailboxAccountId, 'finalizing', 97, 'syncing');
    lap('finalizing');

    // Stage 5 — ready. Persist the historyId snapshot so PR-D's
    // incremental sync can `history.list?startHistoryId=...` from here.
    await this.markReady(mailboxAccountId, snapshotHistoryId);

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
   * onboarding gate shows a real error instead of a stuck spinner. The
   * fetched-so-far rows stay in `mail_messages` — a later retry resumes
   * from them.
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
   * Stage 1 — list every message id, reconcile deletions, fetch
   * metadata for ids not already stored (`format=metadata`), and upsert
   * `mail_messages` + `senders` identity.
   *
   * Two correctness properties:
   *
   *   1. RESUME — skipping already-stored ids means a retry never
   *      re-fetches (no re-burning of quota).
   *   2. RECONCILE (Codex review 2026-05-22) — Gmail's id set is
   *      authoritative; any stored id NOT in it has been deleted or
   *      moved to SPAM/TRASH and gets removed from `mail_messages`. Sender
   *      aggregates would otherwise drift permanently from the mailbox.
   */
  private async fetchAndStoreMetadata(
    mailboxAccountId: string,
    client: GmailMetadataClient,
  ): Promise<{ messagesSynced: number; gmailApiCalls: number }> {
    let gmailApiCalls = 0;

    // List every id so `total` is known → real progress_pct.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.listMessageIds(pageToken);
      gmailApiCalls += 1;
      ids.push(...page.ids);
      pageToken = page.nextPageToken;
    } while (pageToken);
    ids.reverse(); // oldest → newest (fork #5); Gmail lists newest-first.
    const total = ids.length;
    const gmailIdSet = new Set(ids);

    // Load stored state for both reconciliation and the resume cursor.
    const [storedRows, senderIdentityRows] = await Promise.all([
      this.deps.db
        .select({
          providerMessageId: mailMessages.providerMessageId,
          senderKey: mailMessages.senderKey,
          isOutbound: mailMessages.isOutbound,
        })
        .from(mailMessages)
        .where(eq(mailMessages.mailboxAccountId, mailboxAccountId)),
      this.deps.db
        .select({ senderKey: senders.senderKey })
        .from(senders)
        .where(eq(senders.mailboxAccountId, mailboxAccountId)),
    ]);
    const withIdentity = new Set(senderIdentityRows.map((r) => r.senderKey));

    // Reconcile deletions FIRST. A stored id not in Gmail's current list
    // was deleted or moved to SPAM/TRASH and must be dropped.
    const toDelete = storedRows
      .filter((m) => !gmailIdSet.has(m.providerMessageId))
      .map((m) => m.providerMessageId);
    if (toDelete.length > 0) {
      await this.deleteMessages(mailboxAccountId, toDelete);
    }

    // Resume cursor: stored ids STILL in Gmail's list, gated by either
    // outbound (intentionally identity-less) or having a senders row
    // (the orphan-heal guard).
    const skipSet = new Set(
      storedRows
        .filter(
          (m) =>
            gmailIdSet.has(m.providerMessageId) &&
            (m.isOutbound || withIdentity.has(m.senderKey)),
        )
        .map((m) => m.providerMessageId),
    );
    const toFetch = ids.filter((id) => !skipSet.has(id));
    let processed = skipSet.size; // already-done count drives progress.

    let pendingMessages: NewMailMessage[] = [];
    let pendingSenders = new Map<string, NewSender>();

    const flush = async (): Promise<void> => {
      if (pendingMessages.length === 0) {
        return;
      }
      await this.flushBatch([...pendingSenders.values()], pendingMessages);
      pendingMessages = [];
      pendingSenders = new Map();
    };

    for (let i = 0; i < toFetch.length; i += FETCH_CONCURRENCY) {
      const chunk = toFetch.slice(i, i + FETCH_CONCURRENCY);
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
        pendingMessages.push(row.message);
        // Outbound messages still land in `mail_messages` (for future
        // reply attribution) but their `From` is the user themself —
        // never index them as a sender (D9 area; ADR-0004).
        if (!row.facts.isOutbound && !pendingSenders.has(row.senderKey)) {
          pendingSenders.set(row.senderKey, this.toIdentityRow(mailboxAccountId, row));
        }
        processed += 1;
      }

      if (pendingMessages.length >= UPSERT_BATCH) {
        await flush();
        await this.updateProgress(mailboxAccountId, processed, total);
      }
    }
    await flush();

    return { messagesSynced: total, gmailApiCalls };
  }

  /**
   * Stage 2 — aggregate `mail_messages` per sender and write
   * `senders` rollups + `sender_timeseries`. Reads the persisted rows
   * (not an in-memory pass), so a resumed sync aggregates the full
   * mailbox, including messages fetched by an earlier attempt.
   */
  private async buildSenderIndex(mailboxAccountId: string): Promise<number> {
    // Sender identity (email/name/domain) was written during fetch.
    const identityRows = await this.deps.db
      .select({
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        domain: senders.domain,
      })
      .from(senders)
      .where(eq(senders.mailboxAccountId, mailboxAccountId));
    const identity = new Map(identityRows.map((r) => [r.senderKey, r]));

    // Fold every INBOUND stored message into a per-sender aggregate.
    // Outbound messages are excluded — their `From` is the user, never
    // a third-party sender (ADR-0004).
    const messageRows = await this.deps.db
      .select({
        senderKey: mailMessages.senderKey,
        internalDate: mailMessages.internalDate,
        labelIds: mailMessages.labelIds,
        isUnread: mailMessages.isUnread,
        unsubscribeUrl: mailMessages.unsubscribeUrl,
        unsubscribeOneClick: mailMessages.unsubscribeOneClick,
      })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxAccountId, mailboxAccountId),
          eq(mailMessages.isOutbound, false),
        ),
      );

    const aggregates = new Map<string, SenderAggregate>();
    for (const row of messageRows) {
      this.foldMessage(aggregates, row);
    }

    // Build the rebuild payload purely in-memory FIRST — no DB writes
    // yet (Codex adversarial review 2026-05-22 — atomicity). Computing
    // before opening the transaction keeps the transaction window
    // small and lets us throw cleanly on a partial state.
    const survivingKeys = [...aggregates.keys()];
    const senderRows: NewSender[] = [];
    const timeseriesRows: NewSenderTimeseries[] = [];
    let orphans = 0;
    for (const [senderKey, agg] of aggregates) {
      const who = identity.get(senderKey);
      if (!who) {
        // A stored message whose sender identity is missing. The resume
        // cursor in `fetchAndStoreMetadata` re-fetches such messages,
        // so a complete run leaves zero orphans — count + surface,
        // never silently drop (CLAUDE.md §10).
        orphans += 1;
        continue;
      }
      senderRows.push({
        mailboxAccountId,
        senderKey,
        displayName: who.displayName,
        email: who.email,
        domain: who.domain,
        gmailCategory: dominantCategory(agg.categoryCounts),
        firstSeenAt: agg.firstSeen,
        lastSeenAt: agg.lastSeen,
        unsubscribeMethod: deriveUnsubscribeMethod(agg),
        unsubscribeUrl: agg.unsubscribeUrl,
      });
      for (const [yearMonth, month] of agg.months) {
        timeseriesRows.push({
          mailboxAccountId,
          senderKey,
          yearMonth,
          volume: month.volume,
          readCount: month.readCount,
        });
      }
    }

    // Atomic delete + upsert (Codex review 2026-05-22). PG rolls the
    // delete back if any upsert throws — a mid-stage failure leaves
    // the last known-good `senders` / `sender_timeseries` intact rather
    // than committing a partial teardown.
    await this.deps.db.transaction(async (tx) => {
      // Reconcile: drop derived rows for sender_keys with no remaining
      // inbound messages.
      if (survivingKeys.length === 0) {
        await tx.delete(senders).where(eq(senders.mailboxAccountId, mailboxAccountId));
        await tx
          .delete(senderTimeseries)
          .where(eq(senderTimeseries.mailboxAccountId, mailboxAccountId));
      } else {
        await tx
          .delete(senders)
          .where(
            and(
              eq(senders.mailboxAccountId, mailboxAccountId),
              notInArray(senders.senderKey, survivingKeys),
            ),
          );
        await tx
          .delete(senderTimeseries)
          .where(
            and(
              eq(senderTimeseries.mailboxAccountId, mailboxAccountId),
              notInArray(senderTimeseries.senderKey, survivingKeys),
            ),
          );
      }

      // Rebuild: upsert the fresh aggregates.
      for (let i = 0; i < senderRows.length; i += UPSERT_BATCH) {
        await tx
          .insert(senders)
          .values(senderRows.slice(i, i + UPSERT_BATCH))
          .onConflictDoUpdate({
            target: [senders.mailboxAccountId, senders.senderKey],
            set: {
              gmailCategory: sql`excluded.gmail_category`,
              firstSeenAt: sql`excluded.first_seen_at`,
              lastSeenAt: sql`excluded.last_seen_at`,
              unsubscribeMethod: sql`excluded.unsubscribe_method`,
              unsubscribeUrl: sql`excluded.unsubscribe_url`,
              updatedAt: sql`now()`,
            },
          });
      }

      for (let i = 0; i < timeseriesRows.length; i += UPSERT_BATCH) {
        await tx
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
    });

    if (orphans > 0) {
      // Should be 0 after a complete run — surfaced, never swallowed.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'sync.orphan_senders',
          mailboxAccountId,
          count: orphans,
        }),
      );
    }

    return senderRows.length;
  }

  /**
   * Drop `mail_messages` rows for ids no longer in Gmail's listing.
   * Batched to bound the `IN (...)` list size (Codex review 2026-05-22 —
   * reconciliation prevents permanent sender-aggregate drift).
   */
  private async deleteMessages(
    mailboxAccountId: string,
    providerMessageIds: string[],
  ): Promise<void> {
    for (let i = 0; i < providerMessageIds.length; i += UPSERT_BATCH) {
      const batch = providerMessageIds.slice(i, i + UPSERT_BATCH);
      await this.deps.db
        .delete(mailMessages)
        .where(
          and(
            eq(mailMessages.mailboxAccountId, mailboxAccountId),
            inArray(mailMessages.providerMessageId, batch),
          ),
        );
    }
  }

  /**
   * Build a `mail_messages` row + the parsed sender facts from one
   * message's metadata. Returns `null` when the `From` header carries no
   * usable address.
   */
  private toMessageRow(
    mailboxAccountId: string,
    meta: GmailMessageMetadata,
  ): { message: NewMailMessage; senderKey: string; facts: ParsedFacts } | null {
    const parsed = parseFromHeader(meta.from);
    if (!parsed) {
      return null;
    }
    const email = normalizeEmail(parsed.email);
    const senderKey = deriveSenderKey(email);
    const internalDate = new Date(Number(meta.internalDate));
    const isOutbound = meta.labelIds.includes('SENT');
    // Recipients are stored for OUTBOUND only — they power the future
    // reply-attribution engine. Inbound `recipient_emails` would just be
    // the connected mailbox itself, of no product value.
    const recipientEmails = isOutbound
      ? [...parseRecipients(meta.to), ...parseRecipients(meta.cc)]
      : null;
    const { url: unsubscribeUrl, oneClick: unsubscribeOneClick } = parseListUnsubscribe(
      meta.listUnsubscribe,
      meta.listUnsubscribePost,
    );

    const message: NewMailMessage = {
      mailboxAccountId,
      providerMessageId: meta.id,
      providerThreadId: meta.threadId,
      senderKey,
      subject: meta.subject ?? '',
      snippet: meta.snippet.slice(0, 300),
      internalDate,
      labelIds: meta.labelIds,
      isUnread: meta.labelIds.includes('UNREAD'),
      isOutbound,
      recipientEmails: recipientEmails && recipientEmails.length > 0 ? recipientEmails : null,
      unsubscribeUrl,
      unsubscribeOneClick,
    };

    return {
      message,
      senderKey,
      facts: {
        email,
        displayName: parsed.displayName,
        domain: emailDomain(email),
        internalDate,
        category: this.toGmailCategory(meta.labelIds),
        isOutbound,
      },
    };
  }

  /**
   * A `senders` identity row written during fetch. `gmail_category` /
   * `first_seen_at` / `last_seen_at` are seeded from this one message and
   * later corrected by `building_sender_index`; they exist now only to
   * satisfy the NOT NULL columns so the identity row can be stored.
   */
  private toIdentityRow(
    mailboxAccountId: string,
    row: { senderKey: string; facts: ParsedFacts },
  ): NewSender {
    return {
      mailboxAccountId,
      senderKey: row.senderKey,
      displayName: row.facts.displayName,
      email: row.facts.email,
      domain: row.facts.domain,
      gmailCategory: row.facts.category,
      firstSeenAt: row.facts.internalDate,
      lastSeenAt: row.facts.internalDate,
    };
  }

  /** Fold one stored message into its sender's aggregate. */
  private foldMessage(
    aggregates: Map<string, SenderAggregate>,
    row: {
      senderKey: string;
      internalDate: Date;
      labelIds: string[];
      isUnread: boolean;
      unsubscribeUrl: string | null;
      unsubscribeOneClick: boolean;
    },
  ): void {
    let agg = aggregates.get(row.senderKey);
    if (!agg) {
      agg = {
        firstSeen: row.internalDate,
        lastSeen: row.internalDate,
        categoryCounts: new Map(),
        months: new Map(),
        unsubscribeUrl: null,
        unsubscribeOneClick: false,
      };
      aggregates.set(row.senderKey, agg);
    }
    if (row.internalDate < agg.firstSeen) {
      agg.firstSeen = row.internalDate;
    }
    if (row.internalDate > agg.lastSeen) {
      agg.lastSeen = row.internalDate;
    }
    const category = this.toGmailCategory(row.labelIds);
    agg.categoryCounts.set(category, (agg.categoryCounts.get(category) ?? 0) + 1);

    const ym = monthKey(row.internalDate);
    const month = agg.months.get(ym) ?? { volume: 0, readCount: 0 };
    month.volume += 1;
    if (!row.isUnread) {
      month.readCount += 1;
    }
    agg.months.set(ym, month);

    // Unsubscribe: one-click wins; any URL beats null. Once we've seen
    // a one-click URL, keep it — don't downgrade to a later mailto.
    if (row.unsubscribeOneClick && !agg.unsubscribeOneClick) {
      agg.unsubscribeOneClick = true;
      agg.unsubscribeUrl = row.unsubscribeUrl;
    } else if (!agg.unsubscribeOneClick && row.unsubscribeUrl && !agg.unsubscribeUrl) {
      agg.unsubscribeUrl = row.unsubscribeUrl;
    }
  }

  /**
   * Upsert one batch — `senders` identity then `mail_messages` — in a
   * single transaction. Atomic so a crash never leaves a stored message
   * whose sender identity is missing (which would break stage 2).
   */
  private async flushBatch(senderRows: NewSender[], messageRows: NewMailMessage[]): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      if (senderRows.length > 0) {
        await tx
          .insert(senders)
          .values(senderRows)
          .onConflictDoUpdate({
            target: [senders.mailboxAccountId, senders.senderKey],
            set: {
              displayName: sql`excluded.display_name`,
              email: sql`excluded.email`,
              domain: sql`excluded.domain`,
              updatedAt: sql`now()`,
            },
          });
      }
      await tx
        .insert(mailMessages)
        .values(messageRows)
        .onConflictDoUpdate({
          target: [mailMessages.mailboxAccountId, mailMessages.providerMessageId],
          set: {
            senderKey: sql`excluded.sender_key`,
            subject: sql`excluded.subject`,
            snippet: sql`excluded.snippet`,
            internalDate: sql`excluded.internal_date`,
            labelIds: sql`excluded.label_ids`,
            isUnread: sql`excluded.is_unread`,
            isOutbound: sql`excluded.is_outbound`,
            recipientEmails: sql`excluded.recipient_emails`,
            unsubscribeUrl: sql`excluded.unsubscribe_url`,
            unsubscribeOneClick: sql`excluded.unsubscribe_one_click`,
            updatedAt: sql`now()`,
          },
        });
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
      .where(eq(providerSyncState.mailboxAccountId, mailboxAccountId));
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

  /**
   * Final transition — stage `ready`, 100%, sync timestamp set, AND the
   * historyId snapshot captured at sync-start persisted to
   * `last_history_id` so PR-D's incremental sync starts from there.
   */
  private async markReady(mailboxAccountId: string, historyId: string): Promise<void> {
    const lastHistoryId = BigInt(historyId);
    await this.deps.db
      .insert(providerSyncState)
      .values({
        mailboxAccountId,
        currentStage: 'ready',
        readinessStatus: 'ready',
        progressPct: 100,
        lastHistoryId,
      })
      .onConflictDoUpdate({
        target: providerSyncState.mailboxAccountId,
        set: {
          currentStage: 'ready',
          readinessStatus: 'ready',
          progressPct: 100,
          errorCode: null,
          lastHistoryId,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Map an aggregate's unsubscribe state to the `gmail_unsubscribe_method` enum. */
function deriveUnsubscribeMethod(agg: SenderAggregate): UnsubscribeMethod {
  if (agg.unsubscribeOneClick) {
    return 'one_click';
  }
  if (agg.unsubscribeUrl) {
    return 'mailto';
  }
  return 'none';
}

/** Facts parsed from one message's `From` header + labels. */
interface ParsedFacts {
  email: string;
  displayName: string;
  domain: string;
  internalDate: Date;
  category: GmailCategory;
  /** True iff `labelIds` includes `SENT` — the user is the From. */
  isOutbound: boolean;
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
