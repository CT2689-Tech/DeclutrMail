import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  automationRules,
  mailboxAccounts,
  mailMessages,
  schema,
  senders,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it, vi } from 'vitest';

import { createAutopilotExecutionChain } from './autopilot-execution-chain.js';
import { seedAutopilotPresets } from './autopilot-preset-seeder.js';
import { PASSTHROUGH_MAILBOX_LOCK } from './label-action.worker.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { deriveSenderKey } from './sender-key.js';
import type { GmailMutationAccess } from './gmail-mutation-client.js';
import type { WorkerContext } from './worker-context.js';

/**
 * createAutopilotExecutionChain (U14) — the registration fn worker.ts
 * calls. Verifies the apply→action chaining glue: an apply pass that
 * writes Active-mode matches enqueues exactly one action sweep with the
 * canonical `-`-separated jobId (BullMQ rejects ids containing `:`),
 * and an Observe-mode pass enqueues nothing.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-06-10T08:00:00Z');

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

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'AutopilotApplyWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

const UNUSED_GMAIL: GmailMutationAccess = {
  getClient: () => {
    throw new Error('apply pass must not touch Gmail');
  },
};

async function seedMatchableMailbox(
  db: Awaited<ReturnType<typeof freshDb>>,
  mode: 'observe' | 'active',
): Promise<string> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'WS', tier: 'pro' })
    .returning({ id: workspaces.id });
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
  const mailboxId = mb!.id;
  await seedAutopilotPresets(db as never, mailboxId);
  await db
    .update(automationRules)
    .set({ enabled: true, mode })
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxId),
        eq(automationRules.presetKey, 'auto_archive_low_engagement'),
      ),
    );

  const senderKey = await deriveSenderKey('deals@shop.test');
  await db.insert(senders).values({
    mailboxAccountId: mailboxId,
    senderKey,
    displayName: 'Shop',
    email: 'deals@shop.test',
    domain: 'shop.test',
    gmailCategory: 'promotions',
    firstSeenAt: new Date('2024-01-01T00:00:00Z'),
    lastSeenAt: NOW,
  });
  await db.insert(triageDecisions).values({
    mailboxAccountId: mailboxId,
    senderKey,
    verdict: 'archive',
    confidence: '0.92',
    reasoning: 'test',
    generatedBy: 'template',
    producedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
  // One INBOX message keeps the sender ACTIONABLE — active-mode
  // matching skips senders with nothing to act on (the D100 cadence
  // guard), so a matchable fixture must have inbox presence.
  await db.insert(mailMessages).values({
    mailboxAccountId: mailboxId,
    providerMessageId: 'm-chain-1',
    providerThreadId: 't-chain-1',
    senderKey,
    subject: '',
    snippet: '',
    internalDate: NOW,
    labelIds: ['INBOX'],
    isUnread: true,
  });
  return mailboxId;
}

function buildChain(db: Awaited<ReturnType<typeof freshDb>>) {
  const add = vi.fn().mockResolvedValue(undefined);
  const chain = createAutopilotExecutionChain({
    db: db as never,
    gmailMutation: UNUSED_GMAIL,
    outbox: new OutboxPublisher(),
    lock: PASSTHROUGH_MAILBOX_LOCK,
    actionQueue: { add } as never,
    enqueueUnsubExecution: () => Promise.resolve(),
    now: () => NOW,
  });
  return { chain, add };
}

describe('createAutopilotExecutionChain', () => {
  it('an Active-mode apply pass enqueues one action sweep with the canonical jobId', async () => {
    const db = await freshDb();
    const mailboxId = await seedMatchableMailbox(db, 'active');
    const { chain, add } = buildChain(db);

    const result = await chain.applyWorker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.activeMatches).toBeGreaterThan(0);

    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, jobData, opts] = add.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
      { jobId: string },
    ];
    expect(jobName).toBe('autopilot-action');
    expect(jobData.mailboxAccountId).toBe(mailboxId);
    expect(opts.jobId).toBe(`${mailboxId}-${jobData.triggeredAtMs}`);
    // BullMQ reserves ':' as its Redis key separator and REJECTS custom
    // ids containing it (caught live in the U14 smoke).
    expect(opts.jobId).not.toContain(':');
  });

  it('an Observe-mode apply pass enqueues nothing', async () => {
    const db = await freshDb();
    const mailboxId = await seedMatchableMailbox(db, 'observe');
    const { chain, add } = buildChain(db);

    const result = await chain.applyWorker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.observeMatches).toBeGreaterThan(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('a quiet-deferred action sweep re-schedules a DELAYED sweep for the quiet end (U18)', async () => {
    const db = await freshDb();
    const mailboxId = await seedMatchableMailbox(db, 'active');
    // NOW = 08:00Z = 13:30 IST → window 13:00–14:00 IST covers it; the
    // quiet end is 30 minutes out.
    await db
      .update(mailboxAccounts)
      .set({
        quietState: {
          quiet_hours: {
            enabled: true,
            start_local: '13:00',
            end_local: '14:00',
            timezone: 'Asia/Kolkata',
            updated_at: NOW.toISOString(),
          },
        },
      })
      .where(eq(mailboxAccounts.id, mailboxId));
    const { chain, add } = buildChain(db);

    const result = await chain.actionWorker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );

    expect(result.deferredQuiet).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, jobData, opts] = add.mock.calls[0] as [
      string,
      { mailboxAccountId: string; triggeredAtMs: number },
      { jobId: string; delay?: number },
    ];
    expect(jobName).toBe('autopilot-action');
    expect(jobData.mailboxAccountId).toBe(mailboxId);
    expect(opts.delay).toBe(30 * 60_000);
    // jobId keyed on the RESUME instant — distinct from the deferred
    // sweep's id, '-'-separated (BullMQ rejects ':' in custom ids).
    expect(jobData.triggeredAtMs).toBe(NOW.getTime() + 30 * 60_000);
    expect(opts.jobId).toBe(`${mailboxId}-${jobData.triggeredAtMs}`);
    expect(opts.jobId).not.toContain(':');
  });

  it('an indefinite manual quiet (no until_at) defers WITHOUT re-scheduling', async () => {
    const db = await freshDb();
    const mailboxId = await seedMatchableMailbox(db, 'active');
    await db
      .update(mailboxAccounts)
      .set({ quietState: { enabled: true, source: 'manual' } })
      .where(eq(mailboxAccounts.id, mailboxId));
    const { chain, add } = buildChain(db);

    const result = await chain.actionWorker.processJob(
      { mailboxAccountId: mailboxId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );

    expect(result.deferredQuiet).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });
});
