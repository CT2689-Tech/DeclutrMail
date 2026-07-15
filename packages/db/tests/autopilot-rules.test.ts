import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  automationRules,
  mailboxAccounts,
  ruleMatchLog,
  schema,
  undoJournal,
  users,
  workspaces,
} from '../src';

/**
 * Autopilot rules × match-log integration test (D99, D100, D101, D102,
 * D104, D105, D124, D196, D197, D234).
 *
 * Verifies the schema-level invariants the migration encodes:
 *
 *   1. CHECK `automation_rules_preset_key_consistent` — `is_preset` and
 *      `preset_key IS NOT NULL` must agree. Inserting either of the two
 *      illegal combinations raises a constraint error.
 *
 *   2. Partial UNIQUE `automation_rules_mailbox_preset_uniq` —
 *      duplicate preset rows for the same mailbox are rejected; custom
 *      rules (preset_key=NULL) bypass the constraint and can co-exist.
 *
 *   3. `rule_match_log.intent_token` is a real FK to `undo_journal` —
 *      inserting an unknown token raises a constraint error, and
 *      hard-deleting the journal row nulls the column (audit preserved
 *      per the same `ON DELETE SET NULL` pattern as activity_log.undo_token).
 *
 *   4. `ON DELETE CASCADE` from mailbox_accounts → automation_rules →
 *      rule_match_log — deleting a mailbox cascades through both
 *      tables, leaving no orphan rows.
 *
 *   5. Default values on `automation_rules` match D10/D101/D246 defaults
 *      (enabled=false, mode='observe', no dismissed pattern suggestion).
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(db: Awaited<ReturnType<typeof freshDb>>): Promise<string> {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [mb] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: 'a@b.com',
    })
    .returning({ id: mailboxAccounts.id });
  return mb!.id;
}

describe('autopilot rules × match-log integration', () => {
  it('CHECK rejects is_preset=true with NULL preset_key', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(automationRules).values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: null,
        name: 'Bogus preset',
        actionKind: 'archive',
      }),
    ).rejects.toThrow();
  });

  it('CHECK rejects is_preset=false with non-null preset_key', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await expect(
      db.insert(automationRules).values({
        mailboxAccountId: mbId,
        isPreset: false,
        presetKey: 'auto_archive_low_engagement',
        name: 'Bogus custom',
        actionKind: 'archive',
      }),
    ).rejects.toThrow();
  });

  it('partial UNIQUE blocks duplicate presets but allows multiple customs', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    await db.insert(automationRules).values({
      mailboxAccountId: mbId,
      isPreset: true,
      presetKey: 'auto_archive_low_engagement',
      name: 'Auto-archive (1)',
      actionKind: 'archive',
    });
    await expect(
      db.insert(automationRules).values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive (dup)',
        actionKind: 'archive',
      }),
    ).rejects.toThrow();

    // Two custom rules (preset_key=NULL) for the same mailbox are fine.
    await db.insert(automationRules).values([
      {
        mailboxAccountId: mbId,
        isPreset: false,
        presetKey: null,
        name: 'Custom #1',
        actionKind: 'archive',
      },
      {
        mailboxAccountId: mbId,
        isPreset: false,
        presetKey: null,
        name: 'Custom #2',
        actionKind: 'unsubscribe',
      },
    ]);
    const customs = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.isPreset, false));
    expect(customs).toHaveLength(2);
  });

  it('stores only the closed D246 match-dismissal reasons', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });

    await db.insert(ruleMatchLog).values([
      {
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'a'.repeat(64),
        modeAtMatch: 'observe',
        confidence: '0.90',
        reason: 'dismissed by user',
        resolution: 'dismissed',
        dismissReason: 'user',
      },
      {
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'b'.repeat(64),
        modeAtMatch: 'active',
        confidence: '0.90',
        reason: 'sender became Protected',
        resolution: 'dismissed',
        dismissReason: 'protected',
      },
    ]);
    const rows = await db
      .select({ dismissReason: ruleMatchLog.dismissReason })
      .from(ruleMatchLog)
      .orderBy(ruleMatchLog.senderKey);
    expect(rows.map((row) => row.dismissReason)).toEqual(['user', 'protected']);

    await expect(
      db.insert(ruleMatchLog).values({
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'c'.repeat(64),
        modeAtMatch: 'observe',
        confidence: '0.90',
        reason: 'invalid reason',
        resolution: 'dismissed',
        dismissReason: 'other' as never,
      }),
    ).rejects.toThrow();
  });

  it('defaults match D10/D101/D246 (disabled Observe, no dismissed pattern)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({
        enabled: automationRules.enabled,
        mode: automationRules.mode,
        scope: automationRules.scope,
        patternSuggestionDismissedAt: automationRules.patternSuggestionDismissedAt,
      });
    expect(rule!.enabled).toBe(false);
    expect(rule!.mode).toBe('observe');
    expect(rule!.scope).toBe('account');
    expect(rule!.patternSuggestionDismissedAt).toBeNull();
  });

  it('persists a D246 pattern-suggestion dismissal timestamp per rule', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const dismissedAt = new Date('2026-07-15T12:34:56.000Z');

    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
        patternSuggestionDismissedAt: dismissedAt,
      })
      .returning({
        patternSuggestionDismissedAt: automationRules.patternSuggestionDismissedAt,
      });

    expect(rule!.patternSuggestionDismissedAt).toEqual(dismissedAt);
  });

  it('rejects rule_match_log.intent_token referencing an unknown journal row', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });

    await expect(
      db.insert(ruleMatchLog).values({
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'a'.repeat(64),
        modeAtMatch: 'active',
        confidence: '0.93',
        reason: 'bogus',
        intentApplied: true,
        intentToken: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow();
  });

  it('hard-deleting the undo journal row nulls rule_match_log.intent_token (audit preserved)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });
    const [j] = await db
      .insert(undoJournal)
      .values({
        mailboxAccountId: mbId,
        actionKind: 'apply-rule',
        payload: {
          kind: 'apply-rule',
          ruleId: rule!.id,
          messageIds: ['m1'],
          priorLabels: ['INBOX'],
        },
      })
      .returning({ token: undoJournal.token });
    const [match] = await db
      .insert(ruleMatchLog)
      .values({
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'a'.repeat(64),
        modeAtMatch: 'active',
        confidence: '0.93',
        reason: 'engine verdict=archive @0.93 above threshold 0.85',
        intentApplied: true,
        intentToken: j!.token,
        resolution: 'approved',
      })
      .returning({ id: ruleMatchLog.id });

    // Undo expiry sweep hard-deletes the journal row.
    await db.delete(undoJournal).where(eq(undoJournal.token, j!.token));

    const [after] = await db
      .select({ intentToken: ruleMatchLog.intentToken, resolution: ruleMatchLog.resolution })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.id, match!.id));
    expect(after).toBeDefined();
    expect(after!.intentToken).toBeNull();
    expect(after!.resolution).toBe('approved');
  });

  it('cascades through mailbox → automation_rules → rule_match_log', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });

    await db.insert(ruleMatchLog).values([
      {
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'a'.repeat(64),
        modeAtMatch: 'observe',
        confidence: '0.87',
        reason: 'engine verdict=archive @0.87 above threshold 0.85',
      },
      {
        ruleId: rule!.id,
        mailboxAccountId: mbId,
        senderKey: 'b'.repeat(64),
        modeAtMatch: 'observe',
        confidence: '0.91',
        reason: 'engine verdict=archive @0.91 above threshold 0.85',
      },
    ]);

    await db.delete(mailboxAccounts).where(eq(mailboxAccounts.id, mbId));

    const remainingRules = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));
    const remainingMatches = await db
      .select({ id: ruleMatchLog.id })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.mailboxAccountId, mbId));
    expect(remainingRules).toHaveLength(0);
    expect(remainingMatches).toHaveLength(0);
  });

  it('partial UNIQUE on (rule_id, sender_key) WHERE resolution=pending dedups re-runs', async () => {
    // Per Codex review of PR #64/#65 (finding #3): the apply worker
    // can re-run against the same sender and the prior implementation
    // would create N duplicate pending suggestions. The partial unique
    // index pairs with `onConflictDoNothing()` in the worker so re-runs
    // are idempotent for unresolved matches.
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    const [rule] = await db
      .insert(automationRules)
      .values({
        mailboxAccountId: mbId,
        isPreset: true,
        presetKey: 'auto_archive_low_engagement',
        name: 'Auto-archive low-engagement',
        actionKind: 'archive',
      })
      .returning({ id: automationRules.id });

    const senderKey = 'd'.repeat(64);
    const row = {
      ruleId: rule!.id,
      mailboxAccountId: mbId,
      senderKey,
      modeAtMatch: 'observe' as const,
      confidence: '0.90' as const,
      reason: 'first match',
    };

    // First pending insert succeeds.
    await db.insert(ruleMatchLog).values(row);
    // Second pending insert for the same (rule, sender) violates the
    // partial unique idx. Worker paths must use onConflictDoNothing.
    await expect(db.insert(ruleMatchLog).values({ ...row, reason: 'rerun' })).rejects.toThrow();

    // Resolving the first match (approved or dismissed) releases the
    // partial-unique slot — a future re-match becomes a legitimate new
    // pending suggestion the user can act on again.
    await db
      .update(ruleMatchLog)
      .set({ resolution: 'dismissed', resolvedAt: new Date(), dismissReason: 'user' })
      .where(eq(ruleMatchLog.ruleId, rule!.id));
    await db.insert(ruleMatchLog).values({ ...row, reason: 'after-dismiss rerun' });

    const allMatches = await db
      .select({ id: ruleMatchLog.id, resolution: ruleMatchLog.resolution })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.ruleId, rule!.id));
    expect(allMatches).toHaveLength(2);
    const resolutions = allMatches.map((m) => m.resolution).sort();
    expect(resolutions).toEqual(['dismissed', 'pending']);
  });
});
