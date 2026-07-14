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
 *   IMPORTANT label in the past year
 *
 * Read/open rate is deliberately excluded. A manual Unprotect leaves a
 * non-null reason as a memory pin, so a later sync never silently reverses
 * the user's override.
 */
export async function applyAutomaticProtection(
  tx: OutboxTx,
  mailboxAccountId: string,
): Promise<void> {
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
          WHEN (
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
