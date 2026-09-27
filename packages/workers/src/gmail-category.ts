import { mailMessages, senders, triageDecisions } from '@declutrmail/db';
import type { GmailCategory } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';
import { sqlTextArray } from './sql-text-array.js';

/**
 * Which Gmail tab a sender's mail is filed under — read from Gmail's own
 * CATEGORY_* labels, never inferred (D222).
 *
 * A message with no CATEGORY_* label says nothing about its tab. The sync
 * workers used to record it as `primary` ("no label → the Primary tab"),
 * and nothing checked that: on one production mailbox 30,443 of 38,259
 * inbound messages carried no category label (2026-09-25 trace), and
 * 1,552 senders were kept at 95% "because Gmail puts them in your Primary
 * inbox" on that default alone. On the dev database the unlabelled mail
 * is mostly Google Talk chat logs, pre-2014 mail and Trash. An absent
 * label is an absence of evidence, so it counts toward nothing.
 *
 * Every writer of `senders.gmail_category` goes through this module: the
 * initial-sync rebuild and the incremental insert via the two pure
 * functions, the sender-index sweep (at every worker boot, then every 24
 * hours) via {@link reconcileSenderCategories},
 * whose SQL is generated from the same label table so the two forms
 * cannot disagree about which label wins.
 */
export type LabelledGmailCategory = Exclude<GmailCategory, 'unknown'>;

/**
 * Gmail label → tab, in precedence order. Gmail files a message under one
 * tab, so a message carrying two CATEGORY_* labels has not been observed;
 * the fixed order only makes the TS and SQL forms agree if it ever is.
 */
const CATEGORY_LABELS: ReadonlyArray<readonly [label: string, category: LabelledGmailCategory]> = [
  ['CATEGORY_PERSONAL', 'primary'],
  ['CATEGORY_PROMOTIONS', 'promotions'],
  ['CATEGORY_SOCIAL', 'social'],
  ['CATEGORY_UPDATES', 'updates'],
  ['CATEGORY_FORUMS', 'forums'],
];

/** The tab Gmail filed this message under, or `null` when it carries no CATEGORY_* label. */
export function messageGmailCategory(labelIds: readonly string[]): LabelledGmailCategory | null {
  for (const [label, category] of CATEGORY_LABELS) {
    if (labelIds.includes(label)) return category;
  }
  return null;
}

/**
 * A sender's category: the tab more than half of its LABELLED inbound
 * mail carries. `unknown` when none of its mail is labelled, or when no
 * tab holds a majority.
 *
 * A majority, not a plurality, because readers state it as a fact —
 * "Kept because Gmail puts them in your Primary inbox", "Protected
 * because Gmail marked … this Primary-inbox sender important". Two
 * Primary messages beside two Promotions ones back neither sentence.
 */
export function senderGmailCategory(
  counts: ReadonlyMap<LabelledGmailCategory, number>,
): GmailCategory {
  let labelled = 0;
  for (const n of counts.values()) labelled += n;
  for (const [category, n] of counts) {
    if (n * 2 > labelled) return category;
  }
  return 'unknown';
}

/**
 * Recompute `gmail_category` for every sender in a mailbox from the
 * labels on the mail we hold, and return the senders whose category
 * changed.
 *
 * The sync workers set the category when a sender is first written and
 * again only on a full rebuild, so nothing else revisits it: a sender
 * whose first message carried no label stays `unknown` after Gmail files
 * its later mail, and a sender re-filed by Gmail keeps its old tab. This
 * is also how rows written under the old "no label → primary" default
 * are corrected — through the code path that keeps them correct, not a
 * one-off migration.
 *
 * The changed senders' triage decisions are marked expired in the same
 * transaction. Their stored explanation was written for the old category
 * ("…your Primary inbox"), and the score worker reuses an unexpired
 * explanation whenever the verdict is unchanged — a sender that moves
 * from the Primary Keep to another Keep rule would otherwise keep the
 * Primary sentence. Expired AS OF `produced_at` (the input was wrong from
 * the start), which reads as stale on any clock — `now()` here would race
 * the score worker's own clock. Expiry also makes the page's stale-read
 * refresh ask for a new read if the caller's re-score never runs.
 *
 * Callers must run this BEFORE `applyAutomaticProtection`: the importance
 * rule reads `gmail_category = 'primary'`.
 */
export async function reconcileSenderCategories(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<string[]> {
  const perMessage = sql.join(
    CATEGORY_LABELS.map(
      ([label, category]) =>
        sql`WHEN ${label} = ANY(m.${sql.identifier('label_ids')}) THEN ${category}`,
    ),
    sql` `,
  );
  // One hash aggregate over the mailbox's inbound mail; the default
  // `work_mem` spills it to disk on a 100k-message mailbox (see
  // `reconcileSenderTimeseries`). LOCAL: dies with the transaction.
  await tx.execute(sql`SELECT set_config('work_mem', '32MB', true)`);
  const changed = await tx.execute(sql`
    WITH labelled AS (
      SELECT
        m.${sql.identifier('sender_key')} AS sender_key,
        CASE ${perMessage} END AS category
      FROM ${mailMessages} AS m
      WHERE m.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND m.${sql.identifier('is_outbound')} = false
    ),
    tallies AS (
      SELECT
        sender_key,
        category,
        COUNT(*) AS n,
        SUM(COUNT(*)) OVER (PARTITION BY sender_key) AS labelled_total
      FROM labelled
      WHERE category IS NOT NULL
      GROUP BY sender_key, category
    ),
    majority AS (
      -- At most one row per sender: only one tab can hold MORE than half.
      SELECT sender_key, category FROM tallies WHERE n * 2 > labelled_total
    ),
    target AS (
      SELECT
        s.${sql.identifier('sender_key')} AS sender_key,
        COALESCE(mj.category, 'unknown')::gmail_category AS category
      FROM ${senders} AS s
      LEFT JOIN majority AS mj ON mj.sender_key = s.${sql.identifier('sender_key')}
      WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
    )
    UPDATE ${senders} AS s
    SET ${sql.identifier('gmail_category')} = target.category,
        ${sql.identifier('updated_at')} = now()
    FROM target
    WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND s.${sql.identifier('sender_key')} = target.sender_key
      AND s.${sql.identifier('gmail_category')} <> target.category
    RETURNING s.${sql.identifier('sender_key')} AS sender_key
  `);
  const senderKeys = rowsOf<{ sender_key: string }>(changed).map((r) => r.sender_key);
  await markDecisionsStale(tx, mailboxAccountId, senderKeys);
  return senderKeys;
}

/**
 * Expire these senders' decisions AS OF `produced_at` — the "awaiting
 * re-score" mark (`sendersAwaitingRescore`) — because an input their
 * verdict and explanation were computed from has changed. Every writer
 * that changes a sender's Gmail tab calls this in the same transaction:
 * the sweep's recount and the initial-sync rebuild. Without it the score
 * worker's same-verdict reuse keeps "…your Primary inbox" on a sender
 * that is no longer Primary.
 */
export async function markDecisionsStale(
  tx: OutboxTx,
  mailboxAccountId: string,
  senderKeys: readonly string[],
): Promise<void> {
  if (senderKeys.length === 0) return;
  await tx.execute(sql`
    UPDATE ${triageDecisions}
    SET ${sql.identifier('expires_at')} = ${sql.identifier('produced_at')},
        ${sql.identifier('updated_at')} = now()
    WHERE ${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND ${sql.identifier('sender_key')} = ANY(${sqlTextArray(senderKeys)})
      AND ${sql.identifier('expires_at')} > ${sql.identifier('produced_at')}
  `);
}

/**
 * Mark stale every Primary Keep the current rule no longer backs.
 *
 * Cascade rule 3 keeps a sender (verdict `keep` at exactly 0.95 — no
 * other rule produces that pair) only while its tab is Primary AND it
 * offers no unsubscribe channel (founder decision 2026-09-26). The tab
 * half is covered by `reconcileSenderCategories`; this covers the other
 * half, which changes without any tab moving — every Keep written before
 * the decision, and a Primary sender that later starts sending a
 * List-Unsubscribe header. "Channel" is read exactly as the score worker
 * reads it (`hasAnyUnsub`): any stored message with an unsubscribe URL
 * or mailto. Marked the same way, so `sendersAwaitingRescore` picks them
 * up and Autopilot ignores them until the new verdict lands.
 */
export async function expireUnbackedPrimaryKeeps(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<number> {
  const marked = await tx.execute(sql`
    UPDATE ${triageDecisions} AS td
    SET ${sql.identifier('expires_at')} = td.${sql.identifier('produced_at')},
        ${sql.identifier('updated_at')} = now()
    FROM ${senders} AS s
    WHERE td.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND s.${sql.identifier('mailbox_account_id')} = td.${sql.identifier('mailbox_account_id')}
      AND s.${sql.identifier('sender_key')} = td.${sql.identifier('sender_key')}
      AND td.${sql.identifier('verdict')} = 'keep'
      AND td.${sql.identifier('confidence')} = 0.95
      AND td.${sql.identifier('expires_at')} > td.${sql.identifier('produced_at')}
      AND (
        s.${sql.identifier('gmail_category')} <> 'primary'
        OR EXISTS (
          SELECT 1 FROM ${mailMessages} AS m
          WHERE m.${sql.identifier('mailbox_account_id')} = td.${sql.identifier('mailbox_account_id')}
            AND m.${sql.identifier('sender_key')} = td.${sql.identifier('sender_key')}
            AND (
              m.${sql.identifier('unsubscribe_url')} IS NOT NULL
              OR m.${sql.identifier('unsubscribe_mailto_url')} IS NOT NULL
            )
        )
      )
    RETURNING td.${sql.identifier('sender_key')}
  `);
  return rowsOf<{ sender_key: string }>(marked).length;
}

/**
 * Senders the recount marked stale that no score job has re-scored yet.
 *
 * `reconcileSenderCategories` expires a changed sender's decision AS OF
 * its `produced_at`; the score worker always writes `produced_at + TTL`
 * (7 days), so `expires_at = produced_at` means exactly "expired by a
 * recount, not yet rewritten". Reading the set back on every sweep —
 * rather than only the senders THIS recount changed — is what makes the
 * re-score request durable: a failed enqueue, a killed process between
 * commit and enqueue, or a sender whose scoring threw is asked for again
 * on the next sweep instead of keeping the old verdict until someone
 * opens it. Joined to `senders` so a pruned sender is not re-requested
 * forever. Largest senders first: when a sweep asks for only part of the
 * set (`MAX_RESCORE_SET`), the part is the mail the user sees most.
 */
export async function sendersAwaitingRescore(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT td.${sql.identifier('sender_key')} AS sender_key
    FROM ${triageDecisions} AS td
    JOIN ${senders} AS s
      ON s.${sql.identifier('mailbox_account_id')} = td.${sql.identifier('mailbox_account_id')}
     AND s.${sql.identifier('sender_key')} = td.${sql.identifier('sender_key')}
    WHERE td.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND td.${sql.identifier('expires_at')} = td.${sql.identifier('produced_at')}
    ORDER BY s.${sql.identifier('total_received')} DESC, td.${sql.identifier('sender_key')}
  `);
  return rowsOf<{ sender_key: string }>(rows).map((r) => r.sender_key);
}

/**
 * Rows from a Drizzle `execute`: postgres.js returns an array-like,
 * PGlite (the test driver) `{ rows }`. An unrecognised shape THROWS —
 * reading it as "no rows" would report that no category changed (or no
 * protection was released) on a run that changed hundreds, and skip
 * their re-score. Shared by the recount and `applyAutomaticProtection`.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as T[];
  throw new Error('unrecognised driver result shape (expected an array or { rows })');
}
