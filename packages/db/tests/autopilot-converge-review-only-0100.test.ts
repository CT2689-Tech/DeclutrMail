import { readFileSync } from 'node:fs';
import { eq, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  automationRules,
  mailboxAccounts,
  ruleMatchIsHeldAction,
  ruleMatchLog,
  users,
  workspaces,
} from '../src';
import { freshTestDb } from '../src/testing';

const forward = readFileSync(
  new URL('../migrations/0100_autopilot_converge_review_only_active.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../migrations/0100_autopilot_converge_review_only_active.rollback', import.meta.url),
  'utf8',
);

type Db = Awaited<ReturnType<typeof freshTestDb>>;

/** Run a migration file the way the runner does: one statement per breakpoint. */
async function run(db: Db, file: string) {
  for (const statement of file.split('--> statement-breakpoint'))
    if (statement.replace(/--.*$/gm, '').trim()) await db.execute(statement);
}

async function seedMailbox(db: Db) {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Converge', tier: 'plus' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'owner@example.test' })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'owner@example.test',
    })
    .returning({ id: mailboxAccounts.id });
  return mailbox!.id;
}

async function rule(
  db: Db,
  mailboxAccountId: string,
  values: {
    presetKey: string | null;
    actionKind: 'archive' | 'later' | 'unsubscribe' | 'delete';
    mode: 'observe' | 'active' | 'paused';
  },
) {
  const [row] = await db
    .insert(automationRules)
    .values({
      mailboxAccountId,
      isPreset: values.presetKey !== null,
      presetKey: values.presetKey,
      name: values.presetKey ?? 'Custom',
      enabled: true,
      mode: values.mode,
      actionKind: values.actionKind,
      modeChangedAt: new Date('2026-08-01T00:00:00Z'),
      observePromptDismissedAt: new Date('2026-08-08T00:00:00Z'),
    })
    .returning({ id: automationRules.id });
  return row!.id;
}

describe('0100 — converge stored-Active review-only rules', () => {
  it('moves only rows that would otherwise start acting with no fresh consent', async () => {
    const db = await freshTestDb();
    const mb = await seedMailbox(db);
    const lowEngagement = await rule(db, mb, {
      presetKey: 'auto_archive_low_engagement',
      actionKind: 'archive',
      mode: 'active',
    });
    const newSender = await rule(db, mb, {
      presetKey: 'auto_screen_new_senders',
      actionKind: 'later',
      mode: 'active',
    });
    const deleteRule = await rule(db, mb, {
      presetKey: 'newsletter_graveyard',
      actionKind: 'delete',
      mode: 'active',
    });
    // Untouched: an Unsubscribe preset that already ran Active and a paused
    // Delete rule. A custom rule could never be set Active before this
    // change; one that is (a manual edit) is converged too.
    const unsubscribe = await rule(db, mb, {
      presetKey: 'auto_unsubscribe_noisy',
      actionKind: 'unsubscribe',
      mode: 'active',
    });
    const paused = await rule(db, mb, {
      presetKey: 'long_dormant_unsubscribe',
      actionKind: 'delete',
      mode: 'paused',
    });
    const custom = await rule(db, mb, { presetKey: null, actionKind: 'archive', mode: 'active' });

    await run(db, forward);

    const rows = new Map((await db.select().from(automationRules)).map((r) => [r.id, r] as const));
    for (const id of [lowEngagement, newSender, deleteRule, custom]) {
      expect(rows.get(id)).toMatchObject({
        mode: 'observe',
        version: 2,
        observePromptDismissedAt: null,
      });
      expect(rows.get(id)!.modeChangedAt.getTime()).toBeGreaterThan(
        new Date('2026-08-01T00:00:00Z').getTime(),
      );
    }
    expect(rows.get(unsubscribe)).toMatchObject({ mode: 'active', version: 1 });
    expect(rows.get(paused)).toMatchObject({ mode: 'paused', version: 1 });

    // Re-running converges nothing further; the rollback restores nothing.
    await run(db, forward);
    await run(db, rollback);
    expect((await db.select().from(automationRules)).every((r) => r.version <= 2)).toBe(true);
    expect(
      (await db.select().from(automationRules).where(eq(automationRules.id, lowEngagement)))[0],
    ).toMatchObject({ mode: 'observe' });
  });
});

describe('Quiet held count — unattended matches the sweep will retire', () => {
  it('excludes an Active match whose rule left Active, is review-only or dropped the sender', async () => {
    const db = await freshTestDb();
    const mb = await seedMailbox(db);
    const stillActive = await rule(db, mb, {
      presetKey: 'auto_archive_low_engagement',
      actionKind: 'archive',
      mode: 'active',
    });
    const backToObserve = await rule(db, mb, {
      presetKey: 'auto_unsubscribe_noisy',
      actionKind: 'unsubscribe',
      mode: 'observe',
    });
    const reviewOnly = await rule(db, mb, {
      presetKey: 'auto_screen_new_senders',
      actionKind: 'later',
      mode: 'active',
    });
    const match = (ruleId: string, senderKey: string, modeAtMatch: 'observe' | 'active') => ({
      ruleId,
      mailboxAccountId: mb,
      senderKey: senderKey.padEnd(64, '0'),
      modeAtMatch,
      confidence: '0.90',
      reason: 'test',
      intentApplied: false,
      resolution: 'approved' as const,
    });
    const named = 'e'.padEnd(64, '0');
    const [custom] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mb,
        isPreset: false,
        presetKey: null,
        name: 'Custom',
        enabled: true,
        mode: 'active',
        conditions: { kind: 'sender_list', senderKeys: [named], olderThanDays: null },
        actionKind: 'archive',
        actionPayload: { reach: 'inbox_only' },
      })
      .returning({ id: automationRules.id });
    await db.insert(ruleMatchLog).values([
      match(stillActive, 'a', 'active'),
      match(backToObserve, 'b', 'active'),
      match(backToObserve, 'c', 'observe'),
      match(reviewOnly, 'd', 'active'),
      // Still on the custom rule's list, and since removed from it.
      match(custom!.id, 'e', 'active'),
      match(custom!.id, 'f', 'active'),
    ]);

    const held = async (predicate: SQL) =>
      (await db.select({ senderKey: ruleMatchLog.senderKey }).from(ruleMatchLog).where(predicate))
        .map((r) => r.senderKey[0])
        .sort();
    expect(await held(ruleMatchIsHeldAction())).toEqual(['a', 'c', 'e']);
  });
});
