import type postgres from 'postgres';

/**
 * Gmail-free billing seed (D183 groundwork for a CI-viable e2e lane).
 *
 * Creates — idempotently — a fully synthetic workspace that the
 * billing-upgrade spec (and, later, a Gmail-free CI job) can drive
 * WITHOUT any Gmail account, OAuth grant, or sync. Adapted from
 * `scripts/cloud-seed.sql` (PR #239), but pointed at its own fixed ids
 * and a synthetic user so the founder's real workspace rows are never
 * touched.
 *
 * The fixture bakes in the exact baseline the money-path spec needs:
 *
 *   - workspace on the FREE tier, user onboarded, one "connected"
 *     mailbox with sync readiness `ready` (no tokens — nothing on this
 *     path ever calls Gmail),
 *   - two senders with INBOX messages (one is the archive target whose
 *     enqueue must 402, one sits pending in the Screener queue),
 *   - a cleanup-quota ledger of EXACTLY 5 used units (five `done`
 *     forward archive `action_jobs` rows — the D19 lifetime cap), so
 *     the very next cleanup enqueue 402s `FREE_CAP_REACHED`.
 *
 * BASELINE vs VOLATILE. The baseline rows persist between runs by
 * design (a fixture, like cloud-seed.sql). Everything the spec's flow
 * mutates — `workspaces.tier`, `subscriptions`, `billing_customers`,
 * `subscription_events` — is VOLATILE and reset both here (so a
 * crashed run self-heals on the next seed) and in the spec's teardown.
 *
 * Applied by `global-setup.ts` before the dev-login: the D206 login
 * never creates users, so the synthetic user must exist first — and a
 * Gmail-free environment can then log in AS the synthetic user
 * (`E2E_LOGIN_EMAIL`) without the founder account existing at all.
 */

export const BILLING_SEED = {
  /**
   * Dev-login email for the synthetic user. MUST start with the api's
   * `DEV_AUTH_EMAIL_PREFIX` (the checked-in dev value is `chintan`, so
   * the default matches it while staying unmistakably synthetic).
   * Override via `E2E_BILLING_LOGIN_EMAIL` when your prefix differs.
   */
  email: process.env.E2E_BILLING_LOGIN_EMAIL ?? 'chintan.e2e.billing@synthetic.test',
  workspaceId: 'e2eb1111-0000-4000-8000-000000000001',
  userId: 'e2eb1111-0000-4000-8000-000000000002',
  mailboxId: 'e2eb1111-0000-4000-8000-000000000003',
  /** Archive target — 2 INBOX messages; the capped enqueue's sender. */
  archiveSenderId: 'e2eb1111-0000-4000-8000-00000000000a',
  archiveSenderKey: 'e2eb'.repeat(16),
  archiveSenderName: 'Fresh Finds Weekly',
  /** Pending Screener-queue sender — proves the Pro gate opens. */
  screenerSenderId: 'e2eb1111-0000-4000-8000-00000000000b',
  screenerSenderKey: 'b2ee'.repeat(16),
  screenerSenderName: 'Meadow Lane Dispatch',
  /** Idempotency-key prefix of the 5 seeded quota-ledger rows. */
  quotaKeyPrefix: 'e2e-billing-quota-',
} as const;

/** Reset every VOLATILE effect of the money-path flow to baseline. */
export async function resetBillingVolatileState(sql: postgres.Sql): Promise<void> {
  const s = BILLING_SEED;
  await sql`DELETE FROM subscriptions WHERE workspace_id = ${s.workspaceId}`;
  await sql`DELETE FROM billing_customers WHERE workspace_id = ${s.workspaceId}`;
  // Webhook event rows attribute via the D7-safe projected payload —
  // the spec's payloads always carry the synthetic workspace id.
  await sql`DELETE FROM subscription_events WHERE payload->>'workspace_id' = ${s.workspaceId}`;
  await sql`
    UPDATE workspaces SET tier = 'free', founding_member = false, updated_at = now()
    WHERE id = ${s.workspaceId}
  `;
}

/**
 * Apply the seed. Idempotent: inserts use `ON CONFLICT DO NOTHING` on
 * their natural keys; state a previous (possibly crashed) run could
 * have drifted is healed with explicit UPDATEs back to baseline.
 */
export async function applyBillingSeed(sql: postgres.Sql): Promise<void> {
  const s = BILLING_SEED;

  await sql`
    INSERT INTO workspaces (id, name, tier)
    VALUES (${s.workspaceId}, 'E2E Billing (synthetic)', 'free')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO users (id, workspace_id, email, onboarded_at)
    VALUES (${s.userId}, ${s.workspaceId}, ${s.email}, now())
    ON CONFLICT (id) DO NOTHING
  `;
  // Heal: onboarding gate + active-mailbox preference are load-bearing
  // for the (app) shell — re-assert them every run (volatile per §8).
  await sql`
    UPDATE users SET
      onboarded_at = COALESCE(onboarded_at, now()),
      preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb),
                              '{activeMailboxId}', ${'"' + s.mailboxId + '"'}::jsonb)
    WHERE id = ${s.userId}
  `;

  await sql`
    INSERT INTO mailbox_accounts (id, workspace_id, user_id, provider, provider_account_id, status)
    VALUES (${s.mailboxId}, ${s.workspaceId}, ${s.userId}, 'gmail', ${s.email}, 'active')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`UPDATE mailbox_accounts SET status = 'active' WHERE id = ${s.mailboxId}`;

  await sql`
    INSERT INTO provider_sync_state (mailbox_account_id, readiness_status, current_stage)
    VALUES (${s.mailboxId}, 'ready', 'ready')
    ON CONFLICT (mailbox_account_id) DO NOTHING
  `;
  await sql`
    UPDATE provider_sync_state SET readiness_status = 'ready', current_stage = 'ready'
    WHERE mailbox_account_id = ${s.mailboxId}
  `;

  await sql`
    INSERT INTO senders (id, mailbox_account_id, sender_key, display_name, email, domain,
                         gmail_category, total_received, first_seen_at, last_seen_at)
    VALUES
      (${s.archiveSenderId}, ${s.mailboxId}, ${s.archiveSenderKey}, ${s.archiveSenderName},
       'deals@freshfinds.example', 'freshfinds.example', 'promotions', 42,
       now() - interval '120 days', now()),
      (${s.screenerSenderId}, ${s.mailboxId}, ${s.screenerSenderKey}, ${s.screenerSenderName},
       'hello@meadowlane.example', 'meadowlane.example', 'updates', 7,
       now() - interval '3 days', now())
    ON CONFLICT (mailbox_account_id, sender_key) DO NOTHING
  `;

  await sql`
    INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id,
                               sender_key, subject, snippet, internal_date, is_unread, label_ids)
    VALUES
      (${s.mailboxId}, 'e2e-bill-m1', 'e2e-bill-t1', ${s.archiveSenderKey},
       'Weekend deal drop', 'preview text', now() - interval '2 days', true,
       ARRAY['INBOX','CATEGORY_PROMOTIONS']),
      (${s.mailboxId}, 'e2e-bill-m2', 'e2e-bill-t2', ${s.archiveSenderKey},
       'Fresh finds inside', 'preview text', now() - interval '1 day', true,
       ARRAY['INBOX','CATEGORY_PROMOTIONS']),
      (${s.mailboxId}, 'e2e-bill-m3', 'e2e-bill-t3', ${s.screenerSenderKey},
       'Welcome to the dispatch', 'preview text', now() - interval '1 day', true,
       ARRAY['INBOX'])
    ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING
  `;
  // Heal: the archive-target preview count must stay ≥1 — restore INBOX
  // if a regression ever let the capped archive actually execute.
  await sql`
    UPDATE mail_messages SET label_ids = array_append(label_ids, 'INBOX')
    WHERE mailbox_account_id = ${s.mailboxId}
      AND provider_message_id LIKE 'e2e-bill-m%'
      AND NOT ('INBOX' = ANY(label_ids))
  `;

  // Screener queue: exactly one PENDING row (D72 soft quarantine —
  // DB-only flag, Gmail untouched; nothing here has Gmail anyway).
  await sql`
    INSERT INTO screener_quarantine (mailbox_account_id, sender_key)
    VALUES (${s.mailboxId}, ${s.screenerSenderKey})
    ON CONFLICT (mailbox_account_id, sender_key) DO NOTHING
  `;
  await sql`
    UPDATE screener_quarantine SET decided_at = NULL
    WHERE mailbox_account_id = ${s.mailboxId} AND sender_key = ${s.screenerSenderKey}
  `;

  // Cleanup-quota ledger — 5 used lifetime units (D19 cap = 5): five
  // terminally-done forward archive rows, each its own (group, sender)
  // unit per EntitlementsService.cleanupUnitsUsed. The next fresh
  // cleanup enqueue must 402 FREE_CAP_REACHED.
  for (let i = 1; i <= 5; i += 1) {
    const selector = JSON.stringify({
      type: 'sender',
      senderId: `e2eb1111-0000-4000-8000-0000000000c${i}`,
      senderKey: `e2e-billing-quota-sender-${i}`,
    });
    await sql`
      INSERT INTO action_jobs (mailbox_account_id, verb, direction, selector,
                               requested_count, affected_count, status, idempotency_key)
      VALUES (${s.mailboxId}, 'archive', 'forward', ${selector}::jsonb,
              1, 1, 'done', ${s.quotaKeyPrefix + String(i)})
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
  }
  // Trim strays so the ledger is EXACTLY 5 (nothing else ever enqueues
  // on this mailbox — the paywall rejects before insert).
  await sql`
    DELETE FROM action_jobs
    WHERE mailbox_account_id = ${s.mailboxId}
      AND idempotency_key NOT LIKE ${s.quotaKeyPrefix + '%'}
  `;

  await resetBillingVolatileState(sql);
}
