import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  automationRules,
  mailMessages,
  mailboxAccounts,
  ruleMatchLog,
  schema,
  senderPolicies,
  senders,
  senderTimeseries,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { describe, expect, it } from 'vitest';

import { AutopilotApplyWorker } from './autopilot-apply.worker.js';
import { seedAutopilotPresets } from './autopilot-preset-seeder.js';
import { deriveSenderKey } from './sender-key.js';
import type { WorkerContext } from './worker-context.js';

/**
 * AutopilotApplyWorker integration tests (D99, D101, D102, D104, D105, D124).
 *
 * Runs the worker against an in-process PGlite database with every
 * migration applied. Covers:
 *
 *   - Preset matching end-to-end against real triage_decisions +
 *     senders + sender_timeseries + mail_messages.
 *   - Protect-filter — senders with `sender_policies.is_protected=true`
 *     are excluded BEFORE matching runs.
 *   - Observe vs Active mode resolution + intent_applied wiring.
 *   - Paused rules + disabled rules do not fire.
 *   - last_run_at / last_run_actions / last_run_senders updated per rule.
 *   - Idempotency-key shape (`${mailbox}:${triggeredAtMs}`).
 *   - Custom rules (is_preset=false) are skipped at runtime per D197.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const NOW = new Date('2026-05-25T08:00:00Z');

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
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
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

interface SeedSenderInput {
  email: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  /** Optional triage decision row. */
  decision?: { verdict: 'keep' | 'archive' | 'unsubscribe' | 'later'; confidence: number };
  /** Optional sender_policies.is_protected = true. */
  isProtected?: boolean;
  /** Optional 90-day timeseries — single month for simplicity. */
  timeseries?: { volume: number; readCount: number };
  /** Optional total messages — drives mailMessages count. */
  totalMessages?: number;
}

async function seedSender(
  db: Awaited<ReturnType<typeof freshDb>>,
  mailboxAccountId: string,
  input: SeedSenderInput,
): Promise<string> {
  const senderKey = await deriveSenderKey(input.email);
  await db.insert(senders).values({
    mailboxAccountId,
    senderKey,
    displayName: input.email,
    email: input.email,
    domain: input.email.split('@')[1] ?? '',
    gmailCategory: 'promotions',
    firstSeenAt: input.firstSeenAt ?? new Date('2024-01-01T00:00:00Z'),
    lastSeenAt: input.lastSeenAt ?? NOW,
  });
  if (input.decision) {
    await db.insert(triageDecisions).values({
      mailboxAccountId,
      senderKey,
      verdict: input.decision.verdict,
      confidence: input.decision.confidence.toFixed(2),
      reasoning: 'test',
      generatedBy: 'template',
      producedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
  }
  if (input.isProtected) {
    await db.insert(senderPolicies).values({
      mailboxAccountId,
      senderKey,
      policyType: 'keep',
      isProtected: true,
      protectionReason: 'user_defined',
      protectionSetAt: NOW,
    });
  }
  if (input.timeseries) {
    await db.insert(senderTimeseries).values({
      mailboxAccountId,
      senderKey,
      yearMonth: '2026-05-01',
      volume: input.timeseries.volume,
      readCount: input.timeseries.readCount,
      replyCount: 0,
    });
  }
  if ((input.totalMessages ?? 0) > 0) {
    for (let i = 0; i < (input.totalMessages ?? 0); i += 1) {
      await db.insert(mailMessages).values({
        mailboxAccountId,
        providerMessageId: `${senderKey.slice(0, 8)}-${i}`,
        providerThreadId: `t-${senderKey.slice(0, 8)}-${i}`,
        senderKey,
        subject: '',
        snippet: '',
        internalDate: NOW,
        labelIds: ['INBOX'],
        isUnread: true,
      });
    }
  }
  return senderKey;
}

const FAKE_CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'AutopilotApplyWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

async function enablePreset(
  db: Awaited<ReturnType<typeof freshDb>>,
  mailboxAccountId: string,
  presetKey: string,
  patch: Partial<{ enabled: boolean; mode: 'observe' | 'active' | 'paused' }> = { enabled: true },
): Promise<string> {
  await db
    .update(automationRules)
    .set({ enabled: patch.enabled ?? true, ...(patch.mode ? { mode: patch.mode } : {}) })
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxAccountId),
        eq(automationRules.presetKey, presetKey),
      ),
    );
  const [row] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.mailboxAccountId, mailboxAccountId),
        eq(automationRules.presetKey, presetKey),
      ),
    );
  return row!.id;
}

describe('AutopilotApplyWorker', () => {
  it('preset #1 (auto_archive_low_engagement) in Observe mode writes pending match rows', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    const ruleId = await enablePreset(db, mbId, 'auto_archive_low_engagement', {
      enabled: true,
      mode: 'observe',
    });

    // Two senders both flagged Archive by the engine; one above threshold, one below.
    const above = await seedSender(db, mbId, {
      email: 'above@example.com',
      decision: { verdict: 'archive', confidence: 0.92 },
      totalMessages: 10,
    });
    const below = await seedSender(db, mbId, {
      email: 'below@example.com',
      decision: { verdict: 'archive', confidence: 0.82 },
      totalMessages: 10,
    });
    // A third sender NOT in archive verdict — should be ignored.
    await seedSender(db, mbId, {
      email: 'noisy@example.com',
      decision: { verdict: 'unsubscribe', confidence: 0.99 },
      totalMessages: 10,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );

    expect(result.rulesEvaluated).toBe(1);
    expect(result.matchesWritten).toBe(1);
    expect(result.observeMatches).toBe(1);
    expect(result.activeMatches).toBe(0);

    const matches = await db
      .select({
        senderKey: ruleMatchLog.senderKey,
        modeAtMatch: ruleMatchLog.modeAtMatch,
        resolution: ruleMatchLog.resolution,
        intentApplied: ruleMatchLog.intentApplied,
        confidence: ruleMatchLog.confidence,
        reason: ruleMatchLog.reason,
      })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.ruleId, ruleId));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.senderKey).toBe(above);
    expect(matches[0]!.modeAtMatch).toBe('observe');
    expect(matches[0]!.resolution).toBe('pending');
    expect(matches[0]!.intentApplied).toBe(false);
    expect(matches[0]!.confidence).toBe('0.92');
    expect(matches[0]!.reason).toContain('above threshold 0.85');

    // Reference `below` so the test failure carries the suppressed sender id.
    expect(matches.find((m) => m.senderKey === below)).toBeUndefined();
  });

  it('Active mode writes (mode_at_match=active, resolution=approved, intent_applied=false)', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    const ruleId = await enablePreset(db, mbId, 'auto_unsubscribe_noisy', {
      enabled: true,
      mode: 'active',
    });

    await seedSender(db, mbId, {
      email: 'noisy@example.com',
      decision: { verdict: 'unsubscribe', confidence: 0.95 },
      totalMessages: 10,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.activeMatches).toBe(1);
    expect(result.observeMatches).toBe(0);

    const [match] = await db
      .select({
        modeAtMatch: ruleMatchLog.modeAtMatch,
        resolution: ruleMatchLog.resolution,
        intentApplied: ruleMatchLog.intentApplied,
        intentToken: ruleMatchLog.intentToken,
      })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.ruleId, ruleId));
    expect(match!.modeAtMatch).toBe('active');
    expect(match!.resolution).toBe('approved');
    expect(match!.intentApplied).toBe(false);
    expect(match!.intentToken).toBeNull();
  });

  it('protected senders are filtered out BEFORE matching', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    await enablePreset(db, mbId, 'auto_archive_low_engagement', {
      enabled: true,
      mode: 'observe',
    });

    // Sender that would match the preset, except it is protected.
    await seedSender(db, mbId, {
      email: 'protected@example.com',
      decision: { verdict: 'archive', confidence: 0.95 },
      isProtected: true,
      totalMessages: 10,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.matchesWritten).toBe(0);
    expect(result.sendersConsidered).toBe(0); // protected sender excluded
  });

  it('paused and disabled rules do not fire', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    // Disable everything; flip one to paused.
    await db
      .update(automationRules)
      .set({ enabled: true, mode: 'paused' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, mbId),
          eq(automationRules.presetKey, 'auto_archive_low_engagement'),
        ),
      );
    // Other presets remain enabled=false default — also should not fire.

    await seedSender(db, mbId, {
      email: 'archive@example.com',
      decision: { verdict: 'archive', confidence: 0.99 },
      totalMessages: 10,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.rulesEvaluated).toBe(0);
    expect(result.matchesWritten).toBe(0);
  });

  it('preset #4 (newsletter_graveyard) matches via signals — read<5% + last_seen>90d', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    const ruleId = await enablePreset(db, mbId, 'newsletter_graveyard', {
      enabled: true,
      mode: 'observe',
    });

    // Dormant: 30 msgs volume, 1 read = 3.3% rate; last seen 120 days ago.
    const dormant = await seedSender(db, mbId, {
      email: 'dormant@news.test',
      lastSeenAt: new Date(NOW.getTime() - 120 * 24 * 60 * 60 * 1000),
      timeseries: { volume: 30, readCount: 1 },
      totalMessages: 30,
    });
    // Active: read rate 60% — does NOT match.
    await seedSender(db, mbId, {
      email: 'active@news.test',
      lastSeenAt: new Date(NOW.getTime() - 120 * 24 * 60 * 60 * 1000),
      timeseries: { volume: 30, readCount: 18 },
      totalMessages: 30,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.matchesWritten).toBe(1);

    const [match] = await db
      .select({ senderKey: ruleMatchLog.senderKey, reason: ruleMatchLog.reason })
      .from(ruleMatchLog)
      .where(eq(ruleMatchLog.ruleId, ruleId));
    expect(match!.senderKey).toBe(dormant);
    expect(match!.reason).toMatch(/Read rate \d+%, last seen \d+d ago/);
  });

  it('updates rule.last_run_at + last_run_actions + last_run_senders', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    const ruleId = await enablePreset(db, mbId, 'auto_archive_low_engagement', {
      enabled: true,
      mode: 'observe',
    });

    await seedSender(db, mbId, {
      email: 's1@example.com',
      decision: { verdict: 'archive', confidence: 0.95 },
      totalMessages: 1,
    });
    await seedSender(db, mbId, {
      email: 's2@example.com',
      decision: { verdict: 'archive', confidence: 0.92 },
      totalMessages: 1,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    await worker.processJob({ mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() }, FAKE_CTX);

    const [row] = await db
      .select({
        lastRunAt: automationRules.lastRunAt,
        lastRunActions: automationRules.lastRunActions,
        lastRunSenders: automationRules.lastRunSenders,
      })
      .from(automationRules)
      .where(eq(automationRules.id, ruleId));
    expect(row!.lastRunAt).toBeInstanceOf(Date);
    expect(row!.lastRunAt!.getTime()).toBe(NOW.getTime());
    expect(row!.lastRunActions).toBe(2);
    expect(row!.lastRunSenders).toBe(2);
  });

  it('idempotency key is ${mailbox}:${triggeredAtMs}', () => {
    const worker = new AutopilotApplyWorker({ db: {} as never });
    type WithProtectedKey = AutopilotApplyWorker & {
      getIdempotencyKey?: (payload: { mailboxAccountId: string; triggeredAtMs: number }) => string;
    };
    const key = (worker as WithProtectedKey).getIdempotencyKey?.({
      mailboxAccountId: 'mbx-1',
      triggeredAtMs: 1_700_000_000_000,
    });
    expect(key).toBe('mbx-1:1700000000000');
  });

  it('skips custom rules (is_preset=false) at runtime per D197', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await db.insert(automationRules).values({
      mailboxAccountId: mbId,
      isPreset: false,
      presetKey: null,
      name: 'Custom rule',
      enabled: true,
      mode: 'observe',
      scope: 'account',
      conditions: {},
      actionKind: 'archive',
      actionPayload: {},
    });

    await seedSender(db, mbId, {
      email: 'archive@example.com',
      decision: { verdict: 'archive', confidence: 0.99 },
      totalMessages: 10,
    });

    const worker = new AutopilotApplyWorker({ db: db as never, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    // The custom rule passes the loadEnabledRules filter (is_preset=true
    // in the WHERE), so rulesEvaluated is 0.
    expect(result.rulesEvaluated).toBe(0);
    expect(result.matchesWritten).toBe(0);
  });

  // ─── Resilience patches (review feedback) ───────────────────────────
  //
  // Defense-in-depth NaN guards for `numeric(3,2)` → string columns
  // (`automation_rules.confidence_threshold`, `triage_decisions.confidence`)
  // are present in the worker but not exercised from the DB path — the
  // column's CHECK rejects non-numeric writes at the SQL layer, so a
  // malformed value would only arrive via a future schema loosening or
  // a hypothetical Drizzle deserialization bug. The guards keep the
  // worker from silently mis-evaluating in those cases; they're
  // intentionally untested via PGlite because the column type prevents
  // the bad value from ever reaching the worker through normal writes.

  it('catches per-rule failures, increments rulesFailed, and continues the loop', async () => {
    const db = await freshDb();
    const mbId = await seedMailbox(db);
    await seedAutopilotPresets(db as never, mbId);
    // Enable two rules — the test injects a DB stub that throws on the
    // first INSERT (the first matching rule) but succeeds on the second.
    await db
      .update(automationRules)
      .set({ enabled: true, mode: 'observe' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, mbId),
          eq(automationRules.presetKey, 'auto_archive_low_engagement'),
        ),
      );
    await db
      .update(automationRules)
      .set({ enabled: true, mode: 'observe' })
      .where(
        and(
          eq(automationRules.mailboxAccountId, mbId),
          eq(automationRules.presetKey, 'auto_unsubscribe_noisy'),
        ),
      );
    // One sender that matches preset #1, one that matches preset #2.
    await seedSender(db, mbId, {
      email: 'archive-target@example.com',
      decision: { verdict: 'archive', confidence: 0.95 },
      totalMessages: 5,
    });
    await seedSender(db, mbId, {
      email: 'unsub-target@example.com',
      decision: { verdict: 'unsubscribe', confidence: 0.95 },
      totalMessages: 5,
    });

    // Patch the db so the first ruleMatchLog insert throws; let the
    // rest pass through. Use a proxy that intercepts only `.insert()`
    // when targeting ruleMatchLog.
    let injected = false;
    const dbWithFault = new Proxy(db as never as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          return (table: unknown) => {
            if (table === ruleMatchLog && !injected) {
              injected = true;
              return {
                values: () => Promise.reject(new Error('synthetic insert failure')),
              };
            }
            const origInsert = Reflect.get(target, prop, receiver) as (t: unknown) => unknown;
            return origInsert.call(target, table);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;

    const worker = new AutopilotApplyWorker({ db: dbWithFault, now: () => NOW });
    const result = await worker.processJob(
      { mailboxAccountId: mbId, triggeredAtMs: NOW.getTime() },
      FAKE_CTX,
    );
    expect(result.rulesEvaluated).toBe(2);
    expect(result.rulesFailed).toBe(1);
    // The surviving rule wrote its match (1 match), not the failing one.
    expect(result.matchesWritten).toBe(1);
  });
});
