import {
  actionJobs,
  automationRules,
  mailboxAccounts,
  senders,
  users,
  workspaces,
  type LabelActionSelector,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { LABEL_SENDER_PROTECTED_ERROR_CODE } from '@declutrmail/shared/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityReadService, type ListActivityParams } from './activity.read-service.js';

type Db = Awaited<ReturnType<typeof freshTestDb>>;
const KEY = 'a'.repeat(64);
const NOW = Date.now();
let sequence = 0;

async function seedMailbox(db: Db, name: string) {
  const [workspace] = await db.insert(workspaces).values({ name }).returning();
  const [user] = await db
    .insert(users)
    .values({ workspaceId: workspace!.id, email: `${name}@example.test` })
    .returning();
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: name,
    })
    .returning();
  const [sender] = await db
    .insert(senders)
    .values({
      mailboxAccountId: mailbox!.id,
      senderKey: KEY,
      email: 'news@example.test',
      displayName: 'News',
      domain: 'example.test',
      gmailCategory: 'promotions',
      firstSeenAt: new Date(NOW - 86_400_000),
      lastSeenAt: new Date(NOW),
    })
    .returning();
  const [rule] = await db
    .insert(automationRules)
    .values({
      mailboxAccountId: mailbox!.id,
      name: `${name} saved rule`,
      isPreset: false,
      presetKey: null,
      enabled: true,
      mode: 'observe',
      conditions: { kind: 'sender_list', senderKeys: [KEY], olderThanDays: 30 },
      actionKind: 'archive',
      actionPayload: { reach: 'inbox_only' },
      retiredAt: new Date(NOW - 1000),
    })
    .returning();
  return { id: mailbox!.id, senderId: sender!.id, ruleId: rule!.id, ruleName: rule!.name };
}

type Mailbox = Awaited<ReturnType<typeof seedMailbox>>;
async function job(
  db: Db,
  mailbox: Mailbox,
  args: {
    source: 'manual' | 'autopilot';
    status?: 'queued' | 'failed' | 'done';
    at?: number;
    ruleId?: string;
    errorCode?: string;
    rootActionId?: string;
    noProvenance?: boolean;
    key?: string;
  },
) {
  sequence++;
  const selector: LabelActionSelector = args.noProvenance
    ? { type: 'messages' }
    : {
        type: 'sender',
        senderId: mailbox.senderId,
        senderKey: KEY,
        ...(args.source === 'autopilot'
          ? {
              autopilot: {
                ruleId: args.ruleId ?? mailbox.ruleId,
                ruleVersion: 1,
                previewId: `review-${sequence}`,
              },
            }
          : {}),
      };
  const at = new Date(args.at ?? NOW - 60_000);
  const [row] = await db
    .insert(actionJobs)
    .values({
      mailboxAccountId: mailbox.id,
      verb: 'archive',
      direction: 'forward',
      selector,
      resolvedMessageIds: [`message-${sequence}`],
      requestedCount: 1,
      status: args.status ?? 'queued',
      errorCode: args.errorCode ?? (args.status === 'failed' ? 'AUTOPILOT_RULE_CHANGED' : null),
      idempotencyKey:
        args.key ?? `${args.source === 'autopilot' ? 'sender-rule' : 'manual'}-${sequence}`,
      createdAt: at,
      updatedAt: at,
      ...(args.rootActionId
        ? {
            rootActionId: args.rootActionId,
            retryOfActionId: args.rootActionId,
            recoveryAttempt: 1,
            selectionFrozenAt: at,
          }
        : {}),
    })
    .returning();
  return row!;
}

describe('Activity attribution for approved sender rules', () => {
  let db: Db, mailbox: Mailbox, other: Mailbox, service: ActivityReadService;
  beforeEach(async () => {
    db = await freshTestDb();
    mailbox = await seedMailbox(db, 'owner');
    other = await seedMailbox(db, 'other');
    service = new ActivityReadService(db as never);
  });
  function params(source: ListActivityParams['source'], limit = 25): ListActivityParams {
    return { mailboxAccountId: mailbox.id, window: 'all', source, cursor: null, limit, nowMs: NOW };
  }

  it('attributes queued and failed custom actions to their owned rule under All and Autopilot', async () => {
    const queued = await job(db, mailbox, { source: 'autopilot' });
    const failed = await job(db, mailbox, { source: 'autopilot', status: 'failed' });
    const manual = await job(db, mailbox, { source: 'manual' });
    await job(db, other, { source: 'autopilot' });
    for (const source of [null, 'autopilot'] as const) {
      const { rows } = await service.listActivity(params(source));
      for (const id of [queued.id, failed.id])
        expect(rows.find((row) => row.id === id)).toMatchObject({
          source: 'autopilot',
          rule: { id: mailbox.ruleId, name: mailbox.ruleName },
        });
      expect(rows.some((row) => row.rule?.name === other.ruleName)).toBe(false);
    }
    const manualRows = (await service.listActivity(params('manual'))).rows;
    expect(manualRows.map((row) => row.id)).toEqual([manual.id]);
    expect(manualRows[0]).toMatchObject({ source: 'manual', rule: null });
    expect((await service.listActivity(params('triage'))).rows).toEqual([]);
  });

  it('applies source predicates before page limits for execution and Protected projections', async () => {
    const custom = await job(db, mailbox, { source: 'autopilot', at: NOW - 120_000 });
    const protectedCustom = await job(db, mailbox, {
      source: 'autopilot',
      status: 'done',
      errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
      at: NOW - 110_000,
    });
    for (let n = 0; n < 5; n++) {
      await job(db, mailbox, { source: 'manual', at: NOW - n * 1000 });
      await job(db, mailbox, {
        source: 'manual',
        status: 'done',
        errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
        at: NOW - n * 1000,
      });
    }
    const auto = (await service.listActivity(params('autopilot', 1))).rows;
    expect(auto.map((row) => row.id).sort()).toEqual([custom.id, protectedCustom.id].sort());
    expect(auto.find((row) => row.id === protectedCustom.id)).toMatchObject({
      source: 'autopilot',
      reviewOutcome: 'protected',
      rule: { id: mailbox.ruleId, name: mailbox.ruleName },
    });
    const manual = (await service.listActivity(params('manual', 1))).rows;
    expect(manual.every((row) => row.source === 'manual' && row.rule === null)).toBe(true);
  });

  it('uses root provenance for a recovery and never leaks another mailbox rule identity', async () => {
    const root = await job(db, mailbox, {
      source: 'autopilot',
      status: 'failed',
      at: NOW - 120_000,
    });
    const retry = await job(db, mailbox, {
      source: 'manual',
      rootActionId: root.id,
      noProvenance: true,
      at: NOW - 60_000,
    });
    const forgedRule = await job(db, mailbox, { source: 'autopilot', ruleId: other.ruleId });
    const auto = (await service.listActivity(params('autopilot'))).rows;
    expect(auto.map((row) => row.id)).not.toContain(root.id);
    expect(auto.find((row) => row.id === retry.id)).toMatchObject({
      source: 'autopilot',
      rule: { id: mailbox.ruleId, name: mailbox.ruleName },
      executionState: { isRecovery: true },
    });
    expect(auto.find((row) => row.id === forgedRule.id)).toMatchObject({
      source: 'autopilot',
      rule: null,
    });
    expect((await service.listActivity(params('manual'))).rows).toEqual([]);
    const exported = [];
    for await (const row of service.iterateActivity(params('autopilot'), 1)) exported.push(row);
    expect(exported.find((row) => row.id === retry.id)).toMatchObject({
      source: 'autopilot',
      rule: { id: mailbox.ruleId, name: mailbox.ruleName },
      executionState: { isRecovery: true },
    });
  });

  it('preserves attribution and source filtering through bounded export iteration', async () => {
    const failed = await job(db, mailbox, { source: 'autopilot', status: 'failed' });
    const protectedRow = await job(db, mailbox, {
      source: 'autopilot',
      status: 'done',
      errorCode: LABEL_SENDER_PROTECTED_ERROR_CODE,
    });
    const manual = await job(db, mailbox, { source: 'manual' });
    const claim = await job(db, mailbox, {
      source: 'manual',
      status: 'failed',
      key: 'autopilot-preset-claim',
    });
    const auto = [];
    for await (const row of service.iterateActivity(params('autopilot'), 1)) auto.push(row);
    expect(auto.map((row) => row.id).sort()).toEqual([failed.id, protectedRow.id].sort());
    expect(auto.every((row) => row.source === 'autopilot' && row.rule?.id === mailbox.ruleId)).toBe(
      true,
    );
    const manualRows = [];
    for await (const row of service.iterateActivity(params('manual'), 1)) manualRows.push(row);
    expect(manualRows.map((row) => row.id)).toEqual([manual.id]);
    const all = (await service.listActivity(params(null))).rows;
    expect(all.map((row) => row.id)).not.toContain(claim.id);
    expect(await service.getWeeklyReview(mailbox.id, NOW + 1000)).toMatchObject({
      failed: 1,
      protected: 1,
    });
  });
});
