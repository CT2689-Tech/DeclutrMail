import { mailMessages, senderPolicies, senders } from '@declutrmail/db';
import { sql } from 'drizzle-orm';

import type { OutboxTx } from './outbox-publisher.js';

/**
 * Strong, explainable signals that may automatically protect a sender.
 *
 * The ordering is intentional: when more than one signal is present we
 * retain the clearest evidence for the user-facing explanation.
 *
 * - replied: at least three outbound replies to this sender
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
    WITH eligible AS (
      SELECT
        s.${sql.identifier('mailbox_account_id')} AS mailbox_account_id,
        s.${sql.identifier('sender_key')} AS sender_key,
        CASE
          WHEN s.${sql.identifier('replied_count')} >= 3
            THEN 'replied'::protection_reason
          WHEN EXISTS (
            SELECT 1
            FROM ${mailMessages} AS starred_message
            WHERE starred_message.${sql.identifier('mailbox_account_id')} = s.${sql.identifier('mailbox_account_id')}
              AND starred_message.${sql.identifier('sender_key')} = s.${sql.identifier('sender_key')}
              AND starred_message.${sql.identifier('is_outbound')} = false
              AND 'STARRED' = ANY(starred_message.${sql.identifier('label_ids')})
              AND starred_message.${sql.identifier('internal_date')} >= now() - interval '1 year'
          ) THEN 'starred'::protection_reason
          WHEN s.${sql.identifier('gmail_category')} = 'primary' AND (
            SELECT COUNT(*)
            FROM ${mailMessages} AS important_message
            WHERE important_message.${sql.identifier('mailbox_account_id')} = s.${sql.identifier('mailbox_account_id')}
              AND important_message.${sql.identifier('sender_key')} = s.${sql.identifier('sender_key')}
              AND important_message.${sql.identifier('is_outbound')} = false
              AND 'IMPORTANT' = ANY(important_message.${sql.identifier('label_ids')})
              AND important_message.${sql.identifier('internal_date')} >= now() - interval '1 year'
          ) >= 3 THEN 'gmail_important'::protection_reason
          ELSE NULL
        END AS protection_reason
      FROM ${senders} AS s
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
