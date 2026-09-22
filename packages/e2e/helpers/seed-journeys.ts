import type postgres from 'postgres';

import { BILLING_SEED, applyBillingSeed } from './seed-billing';

/** Reset only fixed fixture rows. No worker, OAuth tokens, or Gmail writes. */
export async function applyJourneySeed(sql: postgres.Sql): Promise<void> {
  await applyBillingSeed(sql);
  const s = BILLING_SEED;
  await sql`UPDATE workspaces SET tier = 'pro' WHERE id = ${s.workspaceId}`;
  await sql`DELETE FROM activity_log WHERE mailbox_account_id = ${s.mailboxId} AND action = 'keep'`;
  await sql`DELETE FROM sender_policies WHERE mailbox_account_id = ${s.mailboxId} AND sender_key IN (${s.archiveSenderKey}, ${s.screenerSenderKey})`;
  await sql`
    INSERT INTO sender_policies (mailbox_account_id, sender_key, is_protected, protection_reason, protection_set_at)
    VALUES (${s.mailboxId}, ${s.screenerSenderKey}, true, 'starred', now())
  `;
  await sql`UPDATE users SET timezone = 'UTC' WHERE id = ${s.userId}`;
  await sql`
    INSERT INTO triage_decisions (mailbox_account_id, sender_key, verdict, confidence, reasoning, generated_by, expires_at)
    VALUES (${s.mailboxId}, ${s.archiveSenderKey}, 'archive', 0.90,
      'Synthetic newsletter ready for review.', 'template', now() + interval '7 days')
    ON CONFLICT (mailbox_account_id, sender_key) DO UPDATE SET
      verdict = 'archive', expires_at = now() + interval '7 days', produced_at = now()
  `;
  const payload = JSON.stringify({
    narrative: 'A synthetic newsletter is ready to review.',
    reply: [],
    fyi: [],
    noise: [
      {
        senderKey: s.archiveSenderKey,
        senderName: s.archiveSenderName,
        messageCount: 1,
        messageIds: ['e2e-bill-m2'],
      },
    ],
  });
  await sql`
    INSERT INTO brief_runs (workspace_id, mailbox_account_id, run_date_local, generated_by, brief_payload)
    VALUES (${s.workspaceId}, ${s.mailboxId}, (now() AT TIME ZONE 'UTC')::date, 'template', ${payload}::jsonb)
    ON CONFLICT (mailbox_account_id, run_date_local) DO UPDATE SET brief_payload = EXCLUDED.brief_payload
  `;
}
