import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { accountDeletionRequests, actionJobs, actionPreviews, activityLog } from '@declutrmail/db';

import {
  createOAuthTestApp,
  type Browser,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import { ActionPreviewsService } from './action-previews.service.js';
import {
  connectedClient,
  mailboxIdOf,
  seedSender,
  sessionBrowser,
  setSyncState,
  type McpTestClient,
} from './mcp-test-kit.js';

/**
 * One confirmation starts one action, however the page and the assistant
 * arrive (ADR-0048 rule 1; found by the independent review of the apply
 * path, 2026-11-18).
 *
 * Jobs were always safe: the enqueue carries `mcp-preview:<id>`. Keep and
 * an email unsubscribe are not jobs — they record a decision with no key —
 * so two requests starting the same confirmed preview each recorded one
 * (189 Keep rows for 60 senders in the review's probe). The claim on the
 * preview row is what makes it one.
 *
 * PGlite answers in-process, so each test names the one delay it adds to
 * let two requests overlap the way they do over a network.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Scene {
  person: TestPerson;
  mailboxId: string;
  mcp: McpTestClient;
  page: Browser;
}

describe('MCP connector — one confirmation, one action', () => {
  let harness: OAuthTestApp;
  let people = 0;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  async function scene(): Promise<Scene> {
    people += 1;
    const email = `racer${people}@example.com`;
    const person = await harness.person(email);
    const mailboxId = await mailboxIdOf(harness, email);
    await setSyncState(harness, mailboxId, 'ready');
    return {
      person,
      mailboxId,
      mcp: await connectedClient(harness, person),
      page: sessionBrowser(harness, person),
    };
  }

  const confirmPath = (id: string): string => `/api/action-previews/${id}/confirm`;
  const activityOf = (mailboxId: string) =>
    harness.db.select().from(activityLog).where(eq(activityLog.mailboxAccountId, mailboxId));
  const jobsOf = (mailboxId: string) =>
    harness.db.select().from(actionJobs).where(eq(actionJobs.mailboxAccountId, mailboxId));
  const previewRow = async (id: string) =>
    (await harness.db.select().from(actionPreviews).where(eq(actionPreviews.id, id)))[0]!;

  it('Keep for 60 senders is recorded once each when the assistant polls during the click', async () => {
    const s = await scene();
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      ids.push(
        (await seedSender(harness, s.mailboxId, { email: `n${i}@keep.example`, mail: 0 })).id,
      );
    }
    const preview = await s.mcp.call('preview_cleanup', { verb: 'keep', sender_ids: ids });
    const id = preview.data.preview_id;

    // The one delay: opening a transaction takes 5 ms, as a round trip
    // to Postgres would, so the click is still running when a poll lands.
    const db = harness.db as unknown as { transaction: (...a: unknown[]) => Promise<unknown> };
    const transaction = db.transaction.bind(db);
    db.transaction = async (...args: unknown[]) => {
      await sleep(5);
      return transaction(...args);
    };
    try {
      const click = s.page.post(confirmPath(id));
      const polls: Array<Promise<unknown>> = [];
      for (let i = 0; i < 3; i += 1) {
        await sleep(15);
        polls.push(s.mcp.call('apply_cleanup', { preview_id: id }));
      }
      await Promise.all([click, ...polls]);
    } finally {
      db.transaction = transaction;
    }

    const keeps = (await activityOf(s.mailboxId)).filter((row) => row.action === 'keep');
    expect(keeps).toHaveLength(60);
    expect((await previewRow(id)).state).toBe('applied');
  }, 120_000);

  it('six confirms and six applies at once record one Keep per sender', async () => {
    const s = await scene();
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      ids.push((await seedSender(harness, s.mailboxId, { email: `${name}@keep.example` })).id);
    }
    const preview = await s.mcp.call('preview_cleanup', { verb: 'keep', sender_ids: ids });
    const id = preview.data.preview_id;
    const previews = harness.app.get(ActionPreviewsService);
    const row = await previewRow(id);
    const owner = { userId: row.userId, workspaceId: row.workspaceId, grantId: row.grantId };

    const calls: Array<Promise<unknown>> = [];
    for (let i = 0; i < 6; i += 1) {
      calls.push(previews.confirm(id, s.person.userId));
      calls.push(previews.apply(id, owner, null));
    }
    await Promise.allSettled(calls);

    const keeps = (await activityOf(s.mailboxId)).filter((entry) => entry.action === 'keep');
    expect(keeps).toHaveLength(3);
  }, 60_000);

  it('an email unsubscribe is recorded once when the assistant arrives during a slow queue add', async () => {
    const s = await scene();
    const a = await seedSender(harness, s.mailboxId, { email: 'a@shop.example' });
    const b = await seedSender(harness, s.mailboxId, { email: 'b@shop.example' });
    const list = await seedSender(harness, s.mailboxId, {
      email: 'm@list.example',
      unsubscribe: 'mailto',
    });
    const preview = await s.mcp.call('preview_cleanup', {
      verb: 'unsubscribe',
      sender_ids: [a.id, b.id, list.id],
    });
    const id = preview.data.preview_id;

    // The one delay: a queue add takes 150 ms, as a slow Redis would.
    const queue = (
      harness.actions as unknown as { unsubQueue: { add: (...a: unknown[]) => Promise<void> } }
    ).unsubQueue;
    const add = queue.add;
    queue.add = async (...args: unknown[]) => {
      await sleep(150);
      return add(...args);
    };
    try {
      const click = s.page.post(confirmPath(id));
      await sleep(60);
      const poll = s.mcp.call('apply_cleanup', { preview_id: id });
      await Promise.all([click, poll]);
    } finally {
      queue.add = add;
    }

    const manual = (await activityOf(s.mailboxId)).filter(
      (row) => row.senderKey === list.senderKey && row.action === 'unsubscribe_action_required',
    );
    expect(manual).toHaveLength(1);
    const executions = (await jobsOf(s.mailboxId)).filter((row) =>
      row.idempotencyKey.startsWith('unsubexec-'),
    );
    expect(executions).toHaveLength(2);
  }, 60_000);

  it('tells the assistant "in progress" while another request holds the claim, and starts nothing itself', async () => {
    const s = await scene();
    const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
    const preview = await s.mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    const id = preview.data.preview_id;
    // Confirmed, and another request took the claim a moment ago.
    await harness.db.execute(sql`
      UPDATE action_previews
      SET state = 'confirmed', confirmed_at = now(), claimed_at = now()
      WHERE id = ${id}::uuid
    `);

    const answer = await s.mcp.call('apply_cleanup', { preview_id: id });
    expect(answer.data).toMatchObject({
      status: 'in_progress',
      confirm_url: null,
      action_id: null,
    });
    expect(await jobsOf(s.mailboxId)).toEqual([]);

    // A request that died holding the claim does not strand the preview:
    // the lease lapses and the next call starts the action.
    await harness.db.execute(sql`
      UPDATE action_previews SET claimed_at = now() - interval '3 minutes' WHERE id = ${id}::uuid
    `);
    const later = await s.mcp.call('apply_cleanup', { preview_id: id });
    expect(later.data.status).toBe('applied');
    expect(await jobsOf(s.mailboxId)).toHaveLength(1);
  }, 60_000);

  it('gives the claim back when starting fails, so a retry does not wait out the lease', async () => {
    const s = await scene();
    const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
    const preview = await s.mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    const id = preview.data.preview_id;
    harness.queueDown(true);
    try {
      expect((await s.page.post(confirmPath(id))).status).toBe(503);
    } finally {
      harness.queueDown(false);
    }
    const row = await previewRow(id);
    expect(row).toMatchObject({ state: 'confirmed', claimedAt: null });
  });

  it('does not start a confirmed preview the database says has expired, even when this server’s clock runs behind', async () => {
    const s = await scene();
    const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
    const preview = await s.mcp.call('preview_cleanup', { verb: 'delete', sender_ids: [shop.id] });
    const id = preview.data.preview_id;
    await harness.db.execute(sql`
      UPDATE action_previews
      SET state = 'confirmed',
          created_at = now() - interval '20 minutes',
          confirmed_at = now() - interval '10 minutes',
          expires_at = now() - interval '1 second'
      WHERE id = ${id}::uuid
    `);
    const previews = harness.app.get(ActionPreviewsService);
    const findOwned = previews.findOwned.bind(previews);
    const spy = vi.spyOn(previews, 'findOwned').mockImplementation(async (previewId, userId) => {
      const detail = await findOwned(previewId, userId);
      return detail ? { ...detail, expired: false } : detail;
    });
    try {
      const answer = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(answer.data?.status).not.toBe('applied');
    } finally {
      spy.mockRestore();
    }
    expect(await jobsOf(s.mailboxId)).toEqual([]);
    expect((await previewRow(id)).state).toBe('confirmed');
  }, 60_000);

  it('refuses the confirm page for an account being deleted, even if its grant was never revoked', async () => {
    const s = await scene();
    const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
    const preview = await s.mcp.call('preview_cleanup', { verb: 'delete', sender_ids: [shop.id] });
    const id = preview.data.preview_id;
    await harness.db.insert(accountDeletionRequests).values({
      userId: s.person.userId,
      effectiveAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      basis: 'flat-grace',
      status: 'pending',
    });

    const pressed = await s.page.post(confirmPath(id));
    expect(pressed.status).toBe(404);
    expect((await s.page.get(`/api/action-previews/${id}`)).status).toBe(404);
    expect(await jobsOf(s.mailboxId)).toEqual([]);
    expect((await previewRow(id)).state).toBe('pending');
  });
});
