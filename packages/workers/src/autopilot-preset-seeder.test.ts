import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  AUTOPILOT_PRESET_KEYS,
  automationRules,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';

import { seedAutopilotPresets } from './autopilot-preset-seeder.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

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

describe('seedAutopilotPresets', () => {
  it('inserts all 5 D101 preset rows on first call', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const result = await seedAutopilotPresets(db as never, mbId);
    expect(result.insertedKeys.sort()).toEqual([...AUTOPILOT_PRESET_KEYS].sort());

    const rows = await db
      .select({
        presetKey: automationRules.presetKey,
        enabled: automationRules.enabled,
        mode: automationRules.mode,
        scope: automationRules.scope,
        actionKind: automationRules.actionKind,
        confidenceThreshold: automationRules.confidenceThreshold,
        isPreset: automationRules.isPreset,
      })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.enabled).toBe(false);
      expect(row.mode).toBe('observe');
      expect(row.scope).toBe('account');
      expect(row.isPreset).toBe(true);
    }
  });

  it('is idempotent — second call inserts zero new rows', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    const first = await seedAutopilotPresets(db as never, mbId);
    expect(first.insertedKeys).toHaveLength(5);
    const second = await seedAutopilotPresets(db as never, mbId);
    expect(second.insertedKeys).toHaveLength(0);

    const total = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));
    expect(total).toHaveLength(5);
  });

  it('sets confidence_threshold ONLY on the two threshold-bearing presets', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);

    const rows = await db
      .select({
        presetKey: automationRules.presetKey,
        confidenceThreshold: automationRules.confidenceThreshold,
      })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));

    const byKey = new Map(rows.map((r) => [r.presetKey, r.confidenceThreshold]));
    expect(byKey.get('auto_archive_low_engagement')).toBe('0.85');
    expect(byKey.get('auto_unsubscribe_noisy')).toBe('0.90');
    expect(byKey.get('auto_screen_new_senders')).toBeNull();
    expect(byKey.get('newsletter_graveyard')).toBeNull();
    expect(byKey.get('long_dormant_unsubscribe')).toBeNull();
  });

  it('records D101 #2 action_payload {and_archive_future: true}', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);

    const [row] = await db
      .select({ actionPayload: automationRules.actionPayload })
      .from(automationRules)
      .where(eq(automationRules.presetKey, 'auto_unsubscribe_noisy'));
    expect(row?.actionPayload).toEqual({ and_archive_future: true });
  });

  it('two mailboxes each get their own set of presets', async () => {
    const db = await freshDb();
    const mb1 = await seedMailbox(db);
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    const [user2] = await db
      .insert(users)
      .values({ workspaceId: ws!.id, email: 'b@b.com' })
      .returning({ id: users.id });
    const [mb2Row] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: ws!.id,
        userId: user2!.id,
        provider: 'gmail',
        providerAccountId: 'b@b.com',
      })
      .returning({ id: mailboxAccounts.id });
    const mb2 = mb2Row!.id;

    await seedAutopilotPresets(db as never, mb1);
    await seedAutopilotPresets(db as never, mb2);

    const totalCount = await db.select({ id: automationRules.id }).from(automationRules);
    expect(totalCount).toHaveLength(10);
  });

  it('seeds picked presets enabled when onboarding picks predate the seed (D110)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);

    // Step 4 ran before the post-sync seeder: the picks endpoint
    // persisted to users.preferences and found zero rules to flip.
    await db
      .update(users)
      .set({
        preferences: {
          onboardingPresetPicks: ['auto_archive_low_engagement', 'newsletter_graveyard'],
        },
      })
      .where(eq(users.email, 'a@b.com'));

    await seedAutopilotPresets(db as never, mbId);

    const rows = await db
      .select({
        presetKey: automationRules.presetKey,
        enabled: automationRules.enabled,
        mode: automationRules.mode,
      })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));
    const byKey = new Map(rows.map((r) => [r.presetKey, r]));
    expect(byKey.get('auto_archive_low_engagement')?.enabled).toBe(true);
    expect(byKey.get('newsletter_graveyard')?.enabled).toBe(true);
    expect(byKey.get('auto_unsubscribe_noisy')?.enabled).toBe(false);
    expect(byKey.get('auto_screen_new_senders')?.enabled).toBe(false);
    expect(byKey.get('long_dormant_unsubscribe')?.enabled).toBe(false);
    // D10 observe-first is unchanged by the picks.
    for (const row of rows) {
      expect(row.mode).toBe('observe');
    }
  });

  it('ignores junk preference values when reading picks', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db
      .update(users)
      .set({ preferences: { onboardingPresetPicks: ['not_a_preset', 42, null] } })
      .where(eq(users.email, 'a@b.com'));

    await seedAutopilotPresets(db as never, mbId);

    const rows = await db
      .select({ enabled: automationRules.enabled })
      .from(automationRules)
      .where(eq(automationRules.mailboxAccountId, mbId));
    expect(rows.every((r) => r.enabled === false)).toBe(true);
  });
});
