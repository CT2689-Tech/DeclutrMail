import postgres from 'postgres';

import { assertIsolatedEnvironment } from './isolation';

/** Fixture access is restricted to an explicitly isolated local database. */
export function dbConnect(): postgres.Sql {
  assertIsolatedEnvironment(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set — provide the isolated E2E database explicitly.');
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** sender_policies snapshot used by sender-policy.spec for exact restore. */
export interface SenderPolicyRow {
  id: string;
  policy_type: string;
  is_protected: boolean;
  protection_reason: string | null;
  protection_set_at: Date | null;
  unsub_status: string | null;
}

export async function getSenderPolicy(
  sql: postgres.Sql,
  mailboxId: string,
  senderKey: string,
): Promise<SenderPolicyRow | null> {
  const rows = await sql<SenderPolicyRow[]>`
    SELECT id, policy_type, is_protected, protection_reason,
           protection_set_at, unsub_status
    FROM sender_policies
    WHERE mailbox_account_id = ${mailboxId} AND sender_key = ${senderKey}
  `;
  return rows[0] ?? null;
}

/** Resolve a sender's stable `sender_key` from its row id. */
export async function senderKeyById(
  sql: postgres.Sql,
  mailboxId: string,
  senderId: string,
): Promise<string> {
  const rows = await sql<{ sender_key: string }[]>`
    SELECT sender_key FROM senders
    WHERE id = ${senderId} AND mailbox_account_id = ${mailboxId}
  `;
  const row = rows[0];
  if (!row) throw new Error(`sender ${senderId} not found in mailbox ${mailboxId}`);
  return row.sender_key;
}
