import { mailMessages, senderPolicies, senders } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';

/**
 * Strong, explainable signals that may automatically protect a sender.
 *
 * The ordering is intentional: when more than one signal is present we
 * retain the clearest evidence for the user-facing explanation.
 *
 * - replied: TWO-WAY correspondence — at least three outbound messages
 *   ADDRESSED to this sender (their address in To/Cc) AND at least one
 *   message received FROM them. Both halves are load-bearing (F010): a
 *   bounce notifier has inbound but nothing addressed to it, and a
 *   sender you were merely CC'd alongside has neither. The enum value
 *   stays `replied` — it is an internal identifier, like the `screen`
 *   verdict, and never user-facing; the user-facing clause lives in
 *   `@declutrmail/shared/copy/protection` and says what we can prove.
 * - starred: at least one inbound message starred in the past year
 * - gmail_important: at least three inbound messages carrying Gmail's
 *   IMPORTANT label in the past year, AND the sender lives in Gmail's
 *   Primary category. Gmail hands out IMPORTANT liberally to promotions
 *   and updates (founder mailbox 2026-07-15: 176 of 187 importance-only
 *   protections were non-primary), so importance alone is not a strong
 *   signal — importance in Primary is. The category is Gmail-assigned
 *   (CATEGORY_* labels), never predicted by us (D222).
 *
 * Read/open rate is deliberately excluded. A manual Unprotect leaves a
 * non-null reason as a memory pin, so a later sync never silently reverses
 * the user's override.
 */
export async function applyAutomaticProtection(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<void> {
  // Reconcile before escalating: an importance-only protection whose
  // sender is not (or no longer) Primary has lost its signal, so the
  // sweep withdraws it. This targets only sweep-authored rows
  // (reason = 'gmail_important'); manual protections carry
  // reason = 'user_defined' and manual-unprotect memory pins keep
  // is_protected = false, so user agency is never overridden. It also
  // makes the rule self-healing against deploy races — a stale worker
  // re-protecting under the old rule is undone by the next sweep.
  // Reason/set_at go NULL so the row can re-qualify under any current
  // signal below.
  await tx.execute(sql`
    UPDATE ${senderPolicies} AS sp
    SET
      ${sql.identifier('is_protected')} = false,
      ${sql.identifier('protection_reason')} = NULL,
      ${sql.identifier('protection_set_at')} = NULL,
      ${sql.identifier('updated_at')} = now()
    FROM ${senders} AS s
    WHERE sp.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
      AND sp.${sql.identifier('is_protected')} = true
      AND sp.${sql.identifier('protection_reason')} = 'gmail_important'
      AND s.${sql.identifier('mailbox_account_id')} = sp.${sql.identifier('mailbox_account_id')}
      AND s.${sql.identifier('sender_key')} = sp.${sql.identifier('sender_key')}
      AND s.${sql.identifier('gmail_category')} <> 'primary'
  `);
  await tx.execute(sql`
    WITH sender_signals AS (
      -- ONE GROUPED PASS PER MAILBOX, replacing three correlated
      -- subqueries per sender.
      --
      -- Each rule below used to be asked once per sender. Measured on
      -- production 2026-08-20 (7,955 senders, 185,583 messages):
      -- 81,789 shared buffers and 7,051ms, of which the starred EXISTS
      -- alone was 69,832 buffers across 7,955 executions that returned
      -- rows=0 EVERY TIME -- the whole mailbox holds 160 starred
      -- messages. Grouped: 13,246 buffers, 1,058ms. -84% / -85%.
      --
      -- The planner cannot do this transformation itself. A scalar
      -- aggregate subquery is opaque to it, unlike the EXISTS forms
      -- elsewhere in this repo that it rewrites into semi-joins.
      SELECT
        ${sql.identifier('sender_key')} AS sender_key,
        bool_or(
          'STARRED' = ANY(${sql.identifier('label_ids')})
          AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS has_recent_star,
        COUNT(*) FILTER (
          WHERE 'IMPORTANT' = ANY(${sql.identifier('label_ids')})
            AND ${sql.identifier('internal_date')} >= now() - interval '1 year'
        ) AS recent_important_count
      FROM ${mailMessages}
      WHERE ${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
        AND ${sql.identifier('is_outbound')} = false
      GROUP BY ${sql.identifier('sender_key')}
    ),
    eligible AS (
      SELECT
        s.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
        s.${sql.identifier('sender_key')} AS sender_key,
        CASE
          -- ORDER IS THE RULE, not an implementation detail: the first
          -- match wins, so a replied-to sender is reported as 'replied'
          -- even if it also has a star. The reason is shown to the user
          -- (D245 requires the exact reason), so reordering these
          -- changes what the product says, not just what it computes.
          --
          -- "has any inbound mail" is now membership in sender_signals,
          -- which is filtered to is_outbound = false -- so a sender with
          -- no inbound row is simply absent from the group.
          WHEN s.${sql.identifier('wrote_to_count')} >= 3
            AND sig.sender_key IS NOT NULL THEN 'replied'::protection_reason
          WHEN COALESCE(sig.has_recent_star, false) THEN 'starred'::protection_reason
          WHEN s.${sql.identifier('gmail_category')} = 'primary'
            AND COALESCE(sig.recent_important_count, 0) >= 3
            THEN 'gmail_important'::protection_reason
          ELSE NULL
        END AS protection_reason
      FROM ${senders} AS s
      LEFT JOIN sender_signals AS sig ON sig.sender_key = s.${sql.identifier('sender_key')}
      WHERE s.${sql.identifier('mailbox_account_id')} = ${mailboxAccountId}
    )
    INSERT INTO ${senderPolicies} (
      ${sql.identifier('mailbox_account_id')},
      ${sql.identifier('sender_key')},
      ${sql.identifier('policy_type')},
      ${sql.identifier('is_protected')},
      ${sql.identifier('protection_reason')},
      ${sql.identifier('protection_set_at')}
    )
    SELECT
      eligible.mailbox_account_id,
      eligible.sender_key,
      'keep'::sender_policy_type,
      true,
      eligible.protection_reason,
      now()
    FROM eligible
    WHERE eligible.protection_reason IS NOT NULL
    ON CONFLICT (${sql.identifier('mailbox_account_id')}, ${sql.identifier('sender_key')}) DO UPDATE
    SET
      ${sql.identifier('is_protected')} = true,
      ${sql.identifier('protection_reason')} = COALESCE(
        sender_policies.${sql.identifier('protection_reason')},
        EXCLUDED.${sql.identifier('protection_reason')}
      ),
      ${sql.identifier('protection_set_at')} = COALESCE(
        sender_policies.${sql.identifier('protection_set_at')},
        now()
      ),
      ${sql.identifier('updated_at')} = now()
    WHERE sender_policies.${sql.identifier('is_protected')} = false
      AND sender_policies.${sql.identifier('protection_reason')} IS NULL
  `);
}
