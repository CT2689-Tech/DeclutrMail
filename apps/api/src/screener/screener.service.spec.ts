import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import {
  mailboxAccounts,
  schema,
  screenerQuarantine,
  senders,
  users,
  workspaces,
} from '@declutrmail/db';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionsService } from '../actions/actions.service.js';
import { AppException } from '../common/app-exception.js';
import type { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { ScreenerService } from './screener.service.js';

/**
 * ScreenerService.decide integration tests (D72, D77, D226).
 *
 * The load-bearing pieces:
 *   1. Every verb routes through the EXISTING action pipeline (the
 *      mocked ActionsService) — this service never mutates Gmail.
 *   2. The pending quarantine row resolves AFTER a successful
 *      delegation; a delegation failure leaves it pending.
 *   3. Replays report `resolved: false` (the UPDATE's decided_at IS
 *      NULL predicate) without double-acting.
 *   4. D77 — the capability assert 402s Free/Plus workspaces.
 */

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SENDER_A = 'a'.repeat(64);

async function freshDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) await pg.query(trimmed);
    }
  }
  return drizzle(pg, { schema });
}

async function seedMailbox(
  db: Db,
  tag: string,
): Promise<{ workspaceId: string; mailboxId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `WS-${tag}` })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: `${tag}@declutrmail.ai` })
    .returning({ id: users.id });
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: ws!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: `${tag}@x`,
    })
    .returning({ id: mailboxAccounts.id });
  return { workspaceId: ws!.id, mailboxId: mailbox!.id };
}

function makeActionsMock() {
  return {
    recordKeepIntent: vi.fn(async () => ({
      senderId: 'x',
      recordedAt: new Date().toISOString(),
      activityLogId: 'keep-log-id',
    })),
    recordUnsubscribeIntent: vi.fn(async () => ({
      senderId: 'x',
      recordedAt: new Date().toISOString(),
      activityLogId: 'unsub-log-id',
      method: 'mailto' as const,
      executionActionId: null,
      mailtoUrl: 'mailto:leave@list.example',
    })),
    enqueueComposite: vi.fn(async () => ({
      actionId: 'action-1',
      compositeId: 'action-1',
      secondaryId: null,
      status: 'queued' as const,
      primaryCount: 3,
      secondaryCount: null,
    })),
  };
}

describe('ScreenerService.decide (D72, D226)', () => {
  let db: Db;
  let mailboxId: string;
  let senderId: string;
  let actions: ReturnType<typeof makeActionsMock>;
  let svc: ScreenerService;

  beforeEach(async () => {
    db = await freshDb();
    ({ mailboxId } = await seedMailbox(db, 'one'));
    const [sender] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: SENDER_A,
        email: 'alpha@new.example',
        domain: 'new.example',
        gmailCategory: 'updates',
        firstSeenAt: new Date('2026-06-09'),
        lastSeenAt: new Date('2026-06-10'),
      })
      .returning({ id: senders.id });
    senderId = sender!.id;
    await db
      .insert(screenerQuarantine)
      .values({ mailboxAccountId: mailboxId, senderKey: SENDER_A });
    actions = makeActionsMock();
    svc = new ScreenerService(
      db as never,
      actions as unknown as ActionsService,
      // Capability assert is covered separately; decide() itself does
      // not gate (the controller calls assertScreenerCapability first).
      { workspaceForMailbox: vi.fn() } as unknown as EntitlementsService,
    );
  });

  async function pendingCount(): Promise<number> {
    const rows = await db
      .select({ id: screenerQuarantine.id })
      .from(screenerQuarantine)
      .where(
        and(
          eq(screenerQuarantine.mailboxAccountId, mailboxId),
          isNull(screenerQuarantine.decidedAt),
        ),
      );
    return rows.length;
  }

  it('keep → recordKeepIntent, no Gmail pipeline, row resolved (D72 soft)', async () => {
    const res = await svc.decide({
      mailboxAccountId: mailboxId,
      senderId,
      verb: 'keep',
      olderThanDays: null,
      idempotencyKey: 'key-keep-1',
    });
    expect(actions.recordKeepIntent).toHaveBeenCalledWith({
      mailboxAccountId: mailboxId,
      senderId,
    });
    expect(actions.enqueueComposite).not.toHaveBeenCalled();
    expect(res.resolved).toBe(true);
    expect(res.execution).toEqual({ kind: 'policy', activityLogId: 'keep-log-id' });
    expect(await pendingCount()).toBe(0);
  });

  it('archive → enqueueComposite with the sender selector + the threaded idempotency key', async () => {
    const res = await svc.decide({
      mailboxAccountId: mailboxId,
      senderId,
      verb: 'archive',
      olderThanDays: null,
      idempotencyKey: 'key-arch-1',
    });
    expect(actions.enqueueComposite).toHaveBeenCalledWith({
      mailboxAccountId: mailboxId,
      selector: { type: 'sender', senderId },
      primary: { type: 'archive', olderThanDays: null },
      idempotencyKey: 'key-arch-1',
      override: false,
    });
    expect(res.execution).toEqual({
      kind: 'enqueued',
      actionId: 'action-1',
      status: 'queued',
      requestedCount: 3,
    });
    expect(res.resolved).toBe(true);
  });

  it('delete and later also route through the composite pipeline', async () => {
    for (const verb of ['later', 'delete'] as const) {
      await svc.decide({
        mailboxAccountId: mailboxId,
        senderId,
        verb,
        olderThanDays: 180,
        idempotencyKey: `key-${verb}-1`,
      });
    }
    const verbs = actions.enqueueComposite.mock.calls.map(
      (c) =>
        (c as unknown as [{ primary: { type: string; olderThanDays: number | null } }])[0].primary,
    );
    expect(verbs).toEqual([
      { type: 'later', olderThanDays: 180 },
      { type: 'delete', olderThanDays: 180 },
    ]);
  });

  it('unsubscribe → recordUnsubscribeIntent and surfaces the mailto manual path (D230)', async () => {
    const res = await svc.decide({
      mailboxAccountId: mailboxId,
      senderId,
      verb: 'unsubscribe',
      olderThanDays: null,
      idempotencyKey: 'key-unsub-1',
    });
    expect(actions.recordUnsubscribeIntent).toHaveBeenCalledWith({
      mailboxAccountId: mailboxId,
      senderId,
      idempotencyKey: 'key-unsub-1',
    });
    expect(res.execution).toMatchObject({
      kind: 'unsubscribe',
      method: 'mailto',
      mailtoUrl: 'mailto:leave@list.example',
    });
  });

  it('a replay resolves nothing the second time (resolved: false) without throwing', async () => {
    const first = await svc.decide({
      mailboxAccountId: mailboxId,
      senderId,
      verb: 'keep',
      olderThanDays: null,
      idempotencyKey: 'key-replay',
    });
    const second = await svc.decide({
      mailboxAccountId: mailboxId,
      senderId,
      verb: 'keep',
      olderThanDays: null,
      idempotencyKey: 'key-replay',
    });
    expect(first.resolved).toBe(true);
    expect(second.resolved).toBe(false);
  });

  it('a delegation failure leaves the row pending (no premature resolution)', async () => {
    actions.enqueueComposite.mockRejectedValueOnce(new Error('PROTECTED_SENDER'));
    await expect(
      svc.decide({
        mailboxAccountId: mailboxId,
        senderId,
        verb: 'archive',
        olderThanDays: null,
        idempotencyKey: 'key-fail-1',
      }),
    ).rejects.toThrow('PROTECTED_SENDER');
    expect(await pendingCount()).toBe(1);
  });

  it('404s a sender that is not in the active mailbox (ownership)', async () => {
    const other = await seedMailbox(db, 'two');
    await expect(
      svc.decide({
        mailboxAccountId: other.mailboxId,
        senderId,
        verb: 'keep',
        olderThanDays: null,
        idempotencyKey: 'key-foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(actions.recordKeepIntent).not.toHaveBeenCalled();
  });
});

describe('ScreenerService.assertScreenerCapability (D77)', () => {
  function makeSvc(tier: string | null) {
    const entitlements = {
      workspaceForMailbox: vi.fn(async () =>
        tier === null ? null : { workspaceId: 'ws-1', tier },
      ),
    } as unknown as EntitlementsService;
    return new ScreenerService({} as never, {} as never, entitlements);
  }

  it('passes pro / team / enterprise (pro-equivalent capability set)', async () => {
    for (const tier of ['pro', 'team', 'enterprise']) {
      await expect(makeSvc(tier).assertScreenerCapability('mb-1')).resolves.toBeUndefined();
    }
  });

  it('402s free and plus with PRO_FEATURE_REQUIRED', async () => {
    for (const tier of ['free', 'plus']) {
      const err = await makeSvc(tier)
        .assertScreenerCapability('mb-1')
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('PRO_FEATURE_REQUIRED');
      expect((err as AppException).getStatus()).toBe(402);
    }
  });

  it('passes silently for an orphaned mailbox (upstream guards own that)', async () => {
    await expect(makeSvc(null).assertScreenerCapability('mb-1')).resolves.toBeUndefined();
  });
});
