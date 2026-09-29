import { and, eq, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  automationRules,
  mailboxAccounts,
  ruleMatchIsPendingSuggestion,
  ruleMatchIsQueuedAction,
  ruleMatchLog,
  users,
  workspaces,
} from '../src';
import { freshTestDb } from '../src/testing';

/**
 * The two evidence tests in `autopilot-suggestions.ts` differ on purpose,
 * and a sender row that no longer exists is where they part:
 *
 *   - a pending SUGGESTION about a sender that is gone is not offered —
 *     there is nothing current to show or approve;
 *   - an approved ACTION on a sender that is gone is still queued — the
 *     sweep must load it to retry it (index still building) or retire it
 *     (index rebuilt without it), and a claimed one may already have
 *     moved mail.
 *
 * Folding either test into the other flips one of the two assertions.
 */
describe('Autopilot match predicates — a sender with no row', () => {
  it('drops the pending suggestion but keeps the approved action queued', async () => {
    const db = await freshTestDb();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Predicates' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'owner@example.com' })
      .returning({ id: users.id });
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'owner@gmail.com',
      })
      .returning({ id: mailboxAccounts.id });
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mailbox!.id,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
        enabled: true,
      })
      .returning({ id: automationRules.id });
    // No `senders` row exists for either key.
    const match = (senderKey: string, resolution: 'pending' | 'approved') => ({
      ruleId: rule!.id,
      mailboxAccountId: mailbox!.id,
      senderKey,
      modeAtMatch: 'observe' as const,
      confidence: '0.80',
      reason: 'test match',
      intentApplied: false,
      resolution,
    });
    await db
      .insert(ruleMatchLog)
      .values([
        match('gone-suggestion'.padEnd(64, '0'), 'pending'),
        match('gone-action'.padEnd(64, '0'), 'approved'),
      ]);

    const keys = async (predicate: SQL) =>
      (
        await db
          .select({ senderKey: ruleMatchLog.senderKey })
          .from(ruleMatchLog)
          .where(and(eq(ruleMatchLog.mailboxAccountId, mailbox!.id), predicate))
      ).map((r) => r.senderKey);

    expect(await keys(ruleMatchIsPendingSuggestion())).toEqual([]);
    expect(await keys(ruleMatchIsQueuedAction())).toEqual(['gone-action'.padEnd(64, '0')]);
  });
});
