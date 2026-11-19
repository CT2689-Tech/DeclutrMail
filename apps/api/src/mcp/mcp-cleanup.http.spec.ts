import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  actionJobs,
  actionOrigins,
  actionPreviews,
  activityLog,
  mailboxAccounts,
  oauthGrants,
  senderPolicies,
  undoJournal,
  workspaces,
  productEvents,
} from '@declutrmail/db';
import { actionPreviewFacts } from '@declutrmail/shared/actions';
import { METER } from '@declutrmail/shared/entitlements';
import {
  LabelActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  type BatchModifyOptions,
  type GmailMutationClient,
  type LabelActionJobData,
  type WorkerContext,
} from '@declutrmail/workers';

import { ActionsService } from '../actions/actions.service.js';
import { ActivityReadService } from '../activity/activity.read-service.js';
import {
  Browser,
  createOAuthTestApp,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';
import { ActionPreviewsService } from './action-previews.service.js';
import {
  client,
  connectedClient,
  mailboxIdOf,
  protectSender,
  seedSender,
  sessionBrowser,
  setSyncState,
  type McpTestClient,
} from './mcp-test-kit.js';

/**
 * The connector's write path over real HTTP (ADR-0048 rule 1, spec §3,
 * §8, §9): a model can ask for a cleanup and cannot confirm one.
 *
 * "No mail changed" is measured where mail could change: an
 * `action_jobs` row, or a job handed to a queue. Nothing consumes the
 * harness's queues, so both staying empty means Gmail was never asked.
 */

const FREE_LIMIT = METER.free.limit;

class FakeGmail implements GmailMutationClient {
  calls: string[][] = [];
  async modifyLabels(): Promise<void> {}
  async batchModify(
    ids: string[],
    _change?: unknown,
    opts: BatchModifyOptions = {},
  ): Promise<void> {
    await opts.beforeFirstRequest?.();
    this.calls.push([...ids]);
  }
  async ensureLabelId(name: string): Promise<string> {
    return `Label_${name}`;
  }
}

const CTX: WorkerContext = {
  jobId: 'job-1',
  workerName: 'LabelActionWorker',
  attempt: 1,
  maxAttempts: 5,
  startedAt: new Date(),
  policy: 'perMailboxPolicy',
};

interface Scene {
  person: TestPerson;
  email: string;
  mailboxId: string;
  mcp: McpTestClient;
  page: Browser;
}

describe('MCP connector — previews, confirmation and apply', () => {
  let harness: OAuthTestApp;
  let people = 0;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  /** A fresh person with one synced Gmail account and one connected app. */
  async function scene(): Promise<Scene> {
    people += 1;
    const email = `person${people}@example.com`;
    const person = await harness.person(email);
    const mailboxId = await mailboxIdOf(harness, email);
    await setSyncState(harness, mailboxId, 'ready');
    return {
      person,
      email,
      mailboxId,
      mcp: await connectedClient(harness, person),
      page: sessionBrowser(harness, person),
    };
  }

  async function jobs(mailboxId: string): Promise<Array<typeof actionJobs.$inferSelect>> {
    return harness.db.select().from(actionJobs).where(eq(actionJobs.mailboxAccountId, mailboxId));
  }

  async function previewRow(id: string): Promise<typeof actionPreviews.$inferSelect | undefined> {
    const [row] = await harness.db.select().from(actionPreviews).where(eq(actionPreviews.id, id));
    return row;
  }

  const confirmPath = (id: string): string => `/api/action-previews/${id}/confirm`;

  /** Run the label jobs the API queued, the way the worker process would. */
  async function runLabelJobs(since: number): Promise<FakeGmail> {
    const gmail = new FakeGmail();
    const worker = new LabelActionWorker({
      db: harness.db as never,
      gmailMutation: { getClient: async () => gmail },
      outbox: new OutboxPublisher(),
      lock: PASSTHROUGH_MAILBOX_LOCK,
    });
    for (const job of harness.queued.label.slice(since) as LabelActionJobData[]) {
      await worker.processJob(job, CTX);
    }
    return gmail;
  }

  describe('preview_cleanup', () => {
    it('stores a pending preview, returns the link to confirm it, and changes nothing', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 4 });
      const before = harness.queued.label.length;

      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });

      expect(answer.isError).toBe(false);
      expect(answer.data).toMatchObject({
        mailbox: s.email,
        status: 'needs_confirmation',
        verb: 'archive',
        sender_count: 1,
        email_count: 4,
        destination: 'Moves out of your inbox, stays in Gmail.',
        undo: 'Undo from Activity for 30 days.',
        skipped: [],
      });
      expect(answer.data.confirm_url).toBe(
        `http://localhost:3000/confirm/${answer.data.preview_id}`,
      );
      const row = await previewRow(answer.data.preview_id);
      expect(row).toMatchObject({ state: 'pending', verb: 'archive', senderIds: [shop.id] });
      // 15 minutes, give or take the test's own runtime.
      const ttl = row!.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(14 * 60_000);
      expect(ttl).toBeLessThanOrEqual(15 * 60_000);
      expect(await jobs(s.mailboxId)).toHaveLength(0);
      expect(harness.queued.label.length).toBe(before);
    });

    it('counts only the window when older_than_days is given', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, {
        email: 'news@shop.example',
        mail: 5,
        newestDaysAgo: 28,
      });
      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id],
        older_than_days: 30,
      });
      // Emails are 28–32 days old; three are older than 30.
      expect(answer.data.email_count).toBe(3);
      // Delete is the one verb a reader expects to stop the sender; it does not.
      expect(answer.data.destination).toBe(
        'Email in Inbox moves to Gmail Trash. Future email is unchanged.',
      );
      expect(answer.data.undo).toContain('Gmail Trash keeps it for up to 30 days');
    });

    it('leaves a Protected sender out and says so', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const bank = await seedSender(harness, s.mailboxId, { email: 'alerts@bank.example' });
      await protectSender(harness, s.mailboxId, bank.id);

      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id, bank.id],
      });
      expect(answer.data.sender_count).toBe(1);
      expect(answer.data.skipped).toEqual([
        { sender_id: bank.id, reason: 'protected', compose_url: null, email_moved: false },
      ]);
      expect((await previewRow(answer.data.preview_id))!.senderIds).toEqual([shop.id]);
    });

    it('refuses when every sender is Protected or unknown, and stores nothing', async () => {
      const s = await scene();
      const bank = await seedSender(harness, s.mailboxId, { email: 'alerts@bank.example' });
      await protectSender(harness, s.mailboxId, bank.id);
      const unknown = '00000000-0000-4000-8000-000000000000';

      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [bank.id],
      });
      expect(answer.error.code).toBe('NO_ACTIONABLE_SENDERS');
      expect(answer.error.skipped).toEqual([{ sender_id: bank.id, reason: 'protected' }]);
      const other = await s.mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [unknown] });
      expect(other.error.skipped).toEqual([{ sender_id: unknown, reason: 'not_found' }]);
      expect(
        await harness.db
          .select()
          .from(actionPreviews)
          .where(eq(actionPreviews.userId, s.person.userId)),
      ).toEqual([]);
    });

    it('cannot see another person’s sender', async () => {
      const mine = await scene();
      const theirs = await scene();
      const shop = await seedSender(harness, theirs.mailboxId, { email: 'news@shop.example' });
      const answer = await mine.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      expect(answer.error.code).toBe('NO_ACTIONABLE_SENDERS');
      expect(answer.error.skipped).toEqual([{ sender_id: shop.id, reason: 'not_found' }]);
    });

    it.each([
      ['Later with no wake_at', { verb: 'later' }, /wake_at/],
      [
        'Later with a wake_at inside the confirmation window',
        { verb: 'later', wake_at: new Date(Date.now() + 5 * 60_000).toISOString() },
        /wake_at/,
      ],
      [
        'wake_at on another verb',
        { verb: 'archive', wake_at: '2099-01-01T00:00:00Z' },
        /Later only/,
      ],
      ['a window on Unsubscribe', { verb: 'unsubscribe', older_than_days: 30 }, /older_than_days/],
      ['a window on Keep', { verb: 'keep', older_than_days: 30 }, /older_than_days/],
    ])('refuses %s', async (_label, args, message) => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const answer = await s.mcp.call('preview_cleanup', { ...args, sender_ids: [shop.id] });
      expect(answer.error.code).toBe('INVALID_REQUEST');
      expect(answer.error.message).toMatch(message);
    });

    it.each([
      ['an unknown verb', { verb: 'unprotect' }],
      ['a window that is not offered', { verb: 'archive', older_than_days: 7 }],
      ['a reach argument', { verb: 'delete', reach: 'all_mail' }],
      ['an override argument', { verb: 'delete', override: true }],
      ['no senders', { verb: 'archive', sender_ids: [] }],
    ])('rejects %s at the schema', async (_label, args) => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const answer = await s.mcp.call('preview_cleanup', { sender_ids: [shop.id], ...args });
      expect(answer.isError).toBe(true);
      expect(answer.text).toMatch(/Input validation error/);
      expect(
        await harness.db
          .select()
          .from(actionPreviews)
          .where(eq(actionPreviews.userId, s.person.userId)),
      ).toEqual([]);
    });
  });

  describe('apply_cleanup cannot confirm', () => {
    it('answers needs_confirmation for a pending preview, every time, and changes nothing', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id],
      });
      const before = harness.queued.label.length;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const answer = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
        expect(answer.isError).toBe(false);
        expect(answer.data).toMatchObject({
          status: 'needs_confirmation',
          confirm_url: preview.data.confirm_url,
          action_id: null,
          batch_id: null,
          applied_senders: null,
        });
      }
      expect((await previewRow(preview.data.preview_id))!.state).toBe('pending');
      expect(await jobs(s.mailboxId)).toHaveLength(0);
      expect(harness.queued.label.length).toBe(before);
    });

    it('the app’s own token cannot use the confirm route', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id],
      });
      const path = confirmPath(preview.data.preview_id);

      // A bearer token is not a session.
      const bearer = await client(harness.base).bearer(path, s.mcp.accessToken, {});
      expect(bearer.status).toBe(401);
      // A session without the CSRF token is not a confirmation either.
      const noCsrf = await new Browser(harness.base).request(path, {
        method: 'POST',
        headers: { cookie: s.person.cookie },
      });
      expect(noCsrf.status).toBe(403);
      // Signed out.
      expect((await new Browser(harness.base).post(path)).status).toBe(401);

      expect((await previewRow(preview.data.preview_id))!.state).toBe('pending');
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });

    it('answers PREVIEW_NOT_FOUND for another person, another app, another mailbox and a made-up id', async () => {
      const mine = await scene();
      const shop = await seedSender(harness, mine.mailboxId, { email: 'news@shop.example' });
      const preview = await mine.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;

      const stranger = await scene();
      expect((await stranger.mcp.call('apply_cleanup', { preview_id: id })).error.code).toBe(
        'PREVIEW_NOT_FOUND',
      );
      // The same person through a second connected app.
      const otherApp = await connectedClient(harness, mine.person);
      expect((await otherApp.call('apply_cleanup', { preview_id: id })).error.code).toBe(
        'PREVIEW_NOT_FOUND',
      );
      expect(
        (
          await mine.mcp.call('apply_cleanup', {
            preview_id: '00000000-0000-4000-8000-000000000000',
          })
        ).error.code,
      ).toBe('PREVIEW_NOT_FOUND');
      // Stranger's page.
      const page = await stranger.page.get(`/api/action-previews/${id}`);
      expect(page.status).toBe(404);
      expect(page.json.error.code).toBe('PREVIEW_NOT_FOUND');
      expect((await stranger.page.post(confirmPath(id))).status).toBe(404);
      expect((await previewRow(id))!.state).toBe('pending');
    });

    it('answers PREVIEW_NOT_FOUND when the named mailbox is not the preview’s', async () => {
      people += 1;
      const email = `two${people}@example.com`;
      const person = await harness.person(email, [email, `work.${email}`]);
      const mailboxId = await mailboxIdOf(harness, email);
      const mcp = await connectedClient(harness, person);
      const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example' });
      const preview = await mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });

      const wrong = await mcp.call('apply_cleanup', {
        preview_id: preview.data.preview_id,
        mailbox: `work.${email}`,
      });
      expect(wrong.error.code).toBe('PREVIEW_NOT_FOUND');
      const right = await mcp.call('apply_cleanup', {
        preview_id: preview.data.preview_id,
        mailbox: email,
      });
      expect(right.data.status).toBe('needs_confirmation');
    });

    it('answers PREVIEW_EXPIRED once the 15 minutes are up, on the tool and on the page', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      await harness.db.execute(sql`
        UPDATE action_previews
        SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
        WHERE id = ${id}::uuid
      `);

      expect((await s.mcp.call('apply_cleanup', { preview_id: id })).error.code).toBe(
        'PREVIEW_EXPIRED',
      );
      expect((await s.page.get(`/api/action-previews/${id}`)).json.data.state).toBe('expired');
      const confirm = await s.page.post(confirmPath(id));
      expect(confirm.status).toBe(410);
      expect(confirm.json.error.code).toBe('PREVIEW_EXPIRED');
      expect((await previewRow(id))!.state).toBe('pending');
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });
  });

  describe('expiry is decided by the database, at the moment of confirming', () => {
    it('never confirms or applies a preview the database says has expired, even when this server’s clock disagrees', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      await harness.db.execute(sql`
        UPDATE action_previews
        SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 second'
        WHERE id = ${id}::uuid
      `);
      // A server whose clock runs behind: every read says "not expired".
      const previews = harness.app.get(ActionPreviewsService);
      const findOwned = previews.findOwned.bind(previews);
      const spy = vi.spyOn(previews, 'findOwned').mockImplementation(async (previewId, userId) => {
        const detail = await findOwned(previewId, userId);
        return detail ? { ...detail, expired: false } : detail;
      });
      try {
        await expect(previews.confirm(id, s.person.userId)).rejects.toMatchObject({
          code: 'PREVIEW_EXPIRED',
        });
      } finally {
        spy.mockRestore();
      }
      expect((await previewRow(id))!.state).toBe('pending');
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });
  });

  describe('a confirmation whose start was never recorded', () => {
    it('does not say "nothing happened" once it expires: it says where to look', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      // The person pressed; the answer about the enqueue never came back.
      await harness.db.execute(sql`
        UPDATE action_previews
        SET state = 'confirmed',
            created_at = now() - interval '20 minutes',
            confirmed_at = now() - interval '10 minutes',
            expires_at = now() - interval '5 minutes'
        WHERE id = ${id}::uuid
      `);

      const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(tool.error.code).toBe('PREVIEW_EXPIRED');
      expect(tool.error.message).toContain('was confirmed');
      expect(tool.error.message).toContain('list_recent_actions');
      const view = await s.page.get(`/api/action-previews/${id}`);
      expect(view.json.data).toMatchObject({ state: 'expired' });
      expect(view.json.data.confirmedAt).toEqual(expect.any(String));
      // And nothing is started this late, by the tool or by the page.
      expect((await s.page.post(confirmPath(id))).status).toBe(410);
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });
  });

  describe('the person confirms on the page', () => {
    it('shows what was asked, then applies it once however often it is pressed or retried', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, {
        email: 'news@shop.example',
        name: 'The Shop',
        mail: 4,
      });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      const before = harness.queued.label.length;

      const view = await s.page.get(`/api/action-previews/${id}`);
      expect(view.status).toBe(200);
      expect(view.json.data).toMatchObject({
        id,
        verb: 'archive',
        state: 'pending',
        appName: 'Test Assistant',
        mailboxEmail: s.email,
        senderCount: 1,
        emailCount: 4,
        senderNames: ['The Shop'],
        confirmedAt: null,
        outcome: null,
      });

      const [first, second] = await Promise.all([
        s.page.post(confirmPath(id)),
        s.page.post(confirmPath(id)),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const third = await s.page.post(confirmPath(id));
      expect(third.json.data).toMatchObject({
        state: 'applied',
        outcome: { appliedSenders: 1, requestedEmails: 4, skipped: [] },
      });

      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      const again = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        confirm_url: null,
        batch_id: null,
        action_status: 'queued',
        applied_senders: 1,
        requested_emails: 4,
      });
      expect(again.data.action_id).toBe(applied.data.action_id);

      const rows = await jobs(s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: applied.data.action_id, verb: 'archive' });
      expect(rows[0]!.idempotencyKey).toContain(id);
      expect(harness.queued.label.length).toBe(before + 1);
    });

    it('lists every sender in the request, A–Z, not the first few the app chose', async () => {
      const s = await scene();
      const names = ['Zeta', 'alpha', 'Mid', 'Beta', 'omega', 'Delta', 'Gamma'];
      const ids: string[] = [];
      for (const name of names) {
        const sender = await seedSender(harness, s.mailboxId, {
          email: `${name.toLowerCase()}@list.example`,
          name,
          mail: 1,
        });
        ids.push(sender.id);
      }
      const preview = await s.mcp.call('preview_cleanup', { verb: 'archive', sender_ids: ids });
      const view = await s.page.get(`/api/action-previews/${preview.data.preview_id}`);
      expect(view.json.data.senderCount).toBe(7);
      expect(view.json.data.senderNames).toEqual([
        'alpha',
        'Beta',
        'Delta',
        'Gamma',
        'Mid',
        'omega',
        'Zeta',
      ]);
    });

    it('skips a sender that became Protected after the preview, and names it', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const bank = await seedSender(harness, s.mailboxId, { email: 'alerts@bank.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id, bank.id],
      });
      expect(preview.data.sender_count).toBe(2);
      await protectSender(harness, s.mailboxId, bank.id);

      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data.outcome).toMatchObject({
        appliedSenders: 1,
        skipped: [expect.objectContaining({ senderId: bank.id, reason: 'protected' })],
      });
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data.skipped).toEqual([
        { sender_id: bank.id, reason: 'protected', compose_url: null, email_moved: false },
      ]);
      const rows = await jobs(s.mailboxId);
      expect(rows.map((row) => row.selector)).toEqual([
        expect.objectContaining({ senderId: shop.id }),
      ]);
    });

    it('applies nothing when the only sender became Protected', async () => {
      const s = await scene();
      const bank = await seedSender(harness, s.mailboxId, { email: 'alerts@bank.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [bank.id],
      });
      await protectSender(harness, s.mailboxId, bank.id);

      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data).toMatchObject({
        state: 'applied',
        outcome: { appliedSenders: 0, skipped: [expect.objectContaining({ reason: 'protected' })] },
      });
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });

    it('never deletes past the inbox', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [shop.id],
      });
      await s.page.post(confirmPath(preview.data.preview_id));
      const [row] = await jobs(s.mailboxId);
      expect(row!.verb).toBe('delete');
      expect(row!.reach).toBe('inbox_only');
    });

    it('refuses at the plan’s monthly limit, and after an upgrade only a new press starts it', async () => {
      const s = await scene();
      // The limit counts emails: two are left, and this sender has three.
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 3 });
      const used = FREE_LIMIT - 2;
      await harness.db.insert(actionJobs).values({
        mailboxAccountId: s.mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
        requestedCount: used,
        affectedCount: used,
        quotaUnits: used,
        status: 'done',
        idempotencyKey: `archive-fill-${s.mailboxId}`,
      });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      const before = harness.queued.label.length;

      const confirmed = await s.page.post(confirmPath(id));
      expect(confirmed.status).toBe(402);
      expect(confirmed.json.error.code).toBe('FREE_CAP_REACHED');
      // The press is spent: the request waits for a new one, and the
      // assistant is told why the last one started nothing.
      expect(await previewRow(id)).toMatchObject({
        state: 'pending',
        confirmedAt: null,
        refusedCode: 'QUOTA_EXHAUSTED',
      });
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.isError).toBe(false);
      expect(applied.data).toMatchObject({
        status: 'needs_confirmation',
        confirm_url: `http://localhost:3000/confirm/${id}`,
        refused: { code: 'QUOTA_EXHAUSTED', upgrade_url: 'http://localhost:3000/billing' },
      });

      // After an upgrade the app still cannot start it on its own...
      await harness.db
        .update(workspaces)
        .set({ tier: 'plus' })
        .where(eq(workspaces.id, s.person.workspaceId));
      const afterUpgrade = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(afterUpgrade.data.status).toBe('needs_confirmation');
      expect(await jobs(s.mailboxId)).toHaveLength(1);
      expect(harness.queued.label.length).toBe(before);

      // ...only the person pressing again does, and the refusal is cleared.
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const done = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(done.data).toMatchObject({ status: 'applied', refused: null });
      expect(harness.queued.label.length).toBe(before + 1);
    });

    it('a failed start that wrote nothing spends the press: only a new press starts it', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', { verb: 'keep', sender_ids: [shop.id] });
      const id = preview.data.preview_id;
      // Keep writes no job, so stand in a database failure for the outage.
      await harness.db.execute(sql`ALTER TABLE activity_log RENAME TO activity_log_away`);
      try {
        const failed = await s.page.post(confirmPath(id));
        expect(failed.status).toBe(500);
      } finally {
        await harness.db.execute(sql`ALTER TABLE activity_log_away RENAME TO activity_log`);
      }
      // Spec §8: back to pending, as a refusal leaves it.
      expect(await previewRow(id)).toMatchObject({ state: 'pending', confirmedAt: null });
      // The app cannot start it on its own once the database is back.
      const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(tool.data).toMatchObject({
        status: 'needs_confirmation',
        confirm_url: `http://localhost:3000/confirm/${id}`,
      });
      expect(await previewRow(id)).toMatchObject({ state: 'pending' });
      // The person's new press does.
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const done = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(done.data).toMatchObject({ status: 'applied', applied_senders: 1 });
    });

    it('says so when the queue refused the job: applied, with an action that failed', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      harness.queueDown(true);
      try {
        const failed = await s.page.post(confirmPath(id));
        expect(failed.status).toBe(503);
        expect((await previewRow(id))!.state).toBe('confirmed');
      } finally {
        harness.queueDown(false);
      }
      // The app cannot continue it: it is told the person must press.
      const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(tool.data).toMatchObject({
        status: 'needs_confirmation',
        confirm_url: `http://localhost:3000/confirm/${id}`,
      });
      const labelBefore = harness.queued.label.length;
      // The refused job is the one behind this preview's key: the person's
      // next press finds it and reports what it is, without running it
      // again (D233), and it is not counted as a request that started.
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const after = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(after.data).toMatchObject({ status: 'applied', action_status: 'failed' });
      const page = await s.page.get(`/api/action-previews/${id}`);
      expect(page.json.data.outcome.actionStatus).toBe('failed');
      expect(await jobs(s.mailboxId)).toHaveLength(1);
      expect(harness.queued.label.length).toBe(labelBefore);
      const started = await harness.db
        .select({ props: productEvents.props })
        .from(productEvents)
        .where(eq(productEvents.event, 'connector_request_started'));
      expect(started.filter((event) => event.props.preview_id === id)).toEqual([]);
    });

    it('stops honouring a preview once its app is disconnected', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      await harness.db
        .update(oauthGrants)
        .set({ revokedAt: new Date() })
        .where(eq(oauthGrants.userId, s.person.userId));

      const confirm = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirm.status).toBe(404);
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });

    it('stops honouring a preview once its Gmail account is disconnected', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      await harness.db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.id, s.mailboxId));

      const confirm = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirm.status).toBe(409);
      expect(confirm.json.error.code).toBe('NO_ACTIVE_MAILBOX');
      const tool = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(tool.error.code).toBe('MAILBOX_RECONNECT_REQUIRED');
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });
  });

  describe('each verb goes where the web app sends it', () => {
    it('Keep records a decision per sender and starts no job', async () => {
      const s = await scene();
      const a = await seedSender(harness, s.mailboxId, { email: 'a@shop.example' });
      const b = await seedSender(harness, s.mailboxId, { email: 'b@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'keep',
        sender_ids: [a.id, b.id],
      });
      expect(preview.data).toMatchObject({ sender_count: 2, email_count: 0 });

      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data.outcome).toMatchObject({ appliedSenders: 2, skipped: [] });
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({ status: 'applied', action_id: null, batch_id: null });
      expect(await jobs(s.mailboxId)).toHaveLength(0);
      const decisions = await harness.db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.mailboxAccountId, s.mailboxId), eq(activityLog.action, 'keep')));
      expect(decisions).toHaveLength(2);
    });

    it('Later carries the wake time into the job', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const wakeAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'later',
        sender_ids: [shop.id],
        wake_at: wakeAt,
      });
      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data).toMatchObject({ state: 'applied', wakeAt });
      const [row] = await jobs(s.mailboxId);
      expect(row!.verb).toBe('later');
      expect(row!.wakeAt?.toISOString()).toBe(wakeAt);
    });

    it('Unsubscribe sends a one-click request through the unsubscribe queue', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, {
        email: 'news@shop.example',
        unsubscribe: 'one_click',
      });
      const before = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [shop.id],
      });
      expect(preview.data.undo).toBe('A delivered unsubscribe request cannot be undone.');
      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data.outcome).toMatchObject({ appliedSenders: 1, skipped: [] });
      expect(harness.queued.unsubscribe.length).toBe(before + 1);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data.action_id).toEqual(expect.any(String));
    });

    it('Unsubscribe never sends a mailto: it returns a Gmail compose link for the person', async () => {
      const s = await scene();
      const list = await seedSender(harness, s.mailboxId, {
        email: 'list@club.example',
        unsubscribe: 'mailto',
      });
      const before = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [list.id],
      });
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });

      expect(applied.data).toMatchObject({
        status: 'applied',
        applied_senders: 0,
        action_id: null,
      });
      expect(applied.data.skipped).toEqual([
        {
          sender_id: list.id,
          reason: 'mailto',
          compose_url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(s.email)}&view=cm&fs=1&to=leave%40club.example&su=unsubscribe`,
          email_moved: false,
        },
      ]);
      expect(harness.queued.unsubscribe.length).toBe(before);
      // The stored result holds the reason, never the address.
      const row = await previewRow(preview.data.preview_id);
      expect(JSON.stringify(row!.result)).not.toContain('club.example');
    });

    it('Unsubscribe names a sender with no unsubscribe method at preview time', async () => {
      const s = await scene();
      const plain = await seedSender(harness, s.mailboxId, {
        email: 'plain@corp.example',
        unsubscribe: 'none',
      });
      const unchecked = await seedSender(harness, s.mailboxId, {
        email: 'new@corp.example',
        unsubscribe: null,
      });
      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [plain.id],
      });
      expect(answer.error.skipped).toEqual([{ sender_id: plain.id, reason: 'no_channel' }]);
      const other = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [unchecked.id],
      });
      expect(other.error.skipped).toEqual([{ sender_id: unchecked.id, reason: 'unknown' }]);
    });

    it('refuses to unsubscribe a single sender that became Protected', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const before = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [shop.id],
      });
      await protectSender(harness, s.mailboxId, shop.id);
      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.json.data.outcome).toMatchObject({
        appliedSenders: 0,
        skipped: [expect.objectContaining({ senderId: shop.id, reason: 'protected' })],
      });
      expect(harness.queued.unsubscribe.length).toBe(before);
      expect(await jobs(s.mailboxId)).toHaveLength(0);
    });

    it('several senders go through one batch', async () => {
      const s = await scene();
      const a = await seedSender(harness, s.mailboxId, { email: 'a@shop.example', mail: 2 });
      const b = await seedSender(harness, s.mailboxId, { email: 'b@shop.example', mail: 3 });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [a.id, b.id],
      });
      expect(preview.data).toMatchObject({ sender_count: 2, email_count: 5 });
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        action_id: null,
        applied_senders: 2,
        requested_emails: 5,
      });
      expect(applied.data.batch_id).toEqual(expect.any(String));
      const status = await s.mcp.call('get_action_status', { batch_id: applied.data.batch_id });
      expect(status.data).toMatchObject({ status: 'queued', requested_emails: 5 });
    });
  });

  describe('Unsubscribe with its existing email, in one confirmation', () => {
    /** Verbs of the jobs recorded as started by a connected app, in this mailbox. */
    async function originVerbs(mailboxId: string): Promise<string[]> {
      const rows = await harness.db
        .select({ verb: actionJobs.verb })
        .from(actionOrigins)
        .innerJoin(actionJobs, eq(actionJobs.id, actionOrigins.actionJobId))
        .where(eq(actionJobs.mailboxAccountId, mailboxId));
      return [...new Set(rows.map((row) => row.verb))].sort();
    }

    it('previews both, then one press archives their email and sends the unsubscribes', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 3 });
      const club = await seedSender(harness, s.mailboxId, {
        email: 'list@club.example',
        mail: 2,
        unsubscribe: 'mailto',
      });
      const labelBefore = harness.queued.label.length;
      const unsubBefore = harness.queued.unsubscribe.length;

      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id, club.id],
      });
      const id = preview.data.preview_id;
      const facts = actionPreviewFacts('unsubscribe', 'archive');
      expect(preview.data).toMatchObject({
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_count: 2,
        email_count: 5,
        destination: facts.destination,
        undo: facts.undo,
      });
      // Nothing moves, and nothing is sent, before the press.
      expect(harness.queued.label.length).toBe(labelBefore);
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore);
      const page = await s.page.get(`/api/action-previews/${id}`);
      expect(page.json.data).toMatchObject({
        verb: 'unsubscribe',
        alsoVerb: 'archive',
        emailCount: 5,
      });

      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        // Both were acted on: one unsubscribed and archived, one archived.
        applied_senders: 2,
        requested_emails: 5,
        refused: null,
      });
      expect(applied.data.batch_id).toEqual(expect.any(String));
      // The email-only sender was not unsubscribed — that is the person's
      // to send — but its email was archived, and the result says so.
      expect(applied.data.skipped).toEqual([
        {
          sender_id: club.id,
          reason: 'mailto',
          compose_url: expect.stringContaining('to=leave%40club.example'),
          email_moved: true,
        },
      ]);
      const receipt = await s.page.get(`/api/action-previews/${id}`);
      expect(receipt.json.data.outcome.skipped).toEqual([
        expect.objectContaining({ senderId: club.id, reason: 'mailto', emailMoved: true }),
      ]);
      expect(harness.queued.label.length).toBeGreaterThan(labelBefore);
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore + 1);
      // Activity can say which app started both halves.
      expect(await originVerbs(s.mailboxId)).toEqual(['archive', 'unsubscribe']);
    });

    it('with no email left to move, still unsubscribes and names the app in Activity', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 0 });
      const unsubBefore = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id],
      });
      expect(preview.data.email_count).toBe(0);
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        applied_senders: 1,
        requested_emails: 0,
      });
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore + 1);
      // No Archive started, so nothing links the unsubscribe to it: it is
      // recorded as the app's on its own.
      expect(await originVerbs(s.mailboxId)).toEqual(['unsubscribe']);
    });

    it('one sender with Delete: deletes from the inbox only, and unsubscribes', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      const unsubBefore = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'delete',
        sender_ids: [shop.id],
      });
      expect(preview.data.destination).toBe(
        actionPreviewFacts('unsubscribe', 'delete').destination,
      );
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        applied_senders: 1,
        requested_emails: 2,
      });
      const deletes = (await jobs(s.mailboxId)).filter((job) => job.verb === 'delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.reach).toBe('inbox_only');
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore + 1);
    });

    it('counts only the older email when older_than_days is given, and needs existing_email for it', async () => {
      const s = await scene();
      const old = await seedSender(harness, s.mailboxId, {
        email: 'old@shop.example',
        mail: 3,
        newestDaysAgo: 100,
      });
      const recent = await seedSender(harness, s.mailboxId, { email: 'new@shop.example', mail: 2 });
      const alone = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        older_than_days: 90,
        sender_ids: [old.id],
      });
      expect(alone.error.code).toBe('INVALID_REQUEST');
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        older_than_days: 90,
        sender_ids: [old.id, recent.id],
      });
      expect(preview.data.email_count).toBe(3);
    });

    it('is offered for Unsubscribe only', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const answer = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        existing_email: 'delete',
        sender_ids: [shop.id],
      });
      expect(answer.error.code).toBe('INVALID_REQUEST');
      expect(await jobs(s.mailboxId)).toEqual([]);
    });

    it('a plan limit refuses it before any email moves or any unsubscribe is sent', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 3 });
      const used = FREE_LIMIT - 2;
      await harness.db.insert(actionJobs).values({
        mailboxAccountId: s.mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
        requestedCount: used,
        affectedCount: used,
        quotaUnits: used,
        status: 'done',
        idempotencyKey: `archive-fill-${s.mailboxId}`,
      });
      const unsubBefore = harness.queued.unsubscribe.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id],
      });
      const pressed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(pressed.status).toBe(402);
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore);
      expect(await jobs(s.mailboxId)).toHaveLength(1);
      expect(await previewRow(preview.data.preview_id)).toMatchObject({
        state: 'pending',
        refusedCode: 'QUOTA_EXHAUSTED',
      });
    });

    it('with sending switched off, refuses before moving any email', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id],
      });
      const labelBefore = harness.queued.label.length;
      vi.stubEnv('UNSUB_SEND_ENABLED', 'false');
      try {
        const pressed = await s.page.post(confirmPath(preview.data.preview_id));
        expect(pressed.status).toBe(409);
        expect(pressed.json.error.code).toBe('UNSUB_SEND_DISABLED');
      } finally {
        vi.stubEnv('UNSUB_SEND_ENABLED', 'true');
      }
      expect(harness.queued.label.length).toBe(labelBefore);
      expect(await jobs(s.mailboxId)).toEqual([]);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data.refused).toMatchObject({ code: 'UNSUBSCRIBE_UNAVAILABLE' });
    });

    it('a fault after the move started keeps the press: the person’s next press finishes it once', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 3 });
      // Five emails left this month; the request moves three.
      const used = FREE_LIMIT - 5;
      await harness.db.insert(actionJobs).values({
        mailboxAccountId: s.mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
        requestedCount: used,
        affectedCount: used,
        quotaUnits: used,
        status: 'done',
        idempotencyKey: `archive-fill-${s.mailboxId}`,
      });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      // The database refuses one write after the move and the unsubscribe
      // were enqueued.
      const service = harness.app.get(ActionPreviewsService);
      const blip = vi
        .spyOn(service as unknown as { recordOrigin: () => Promise<void> }, 'recordOrigin')
        .mockRejectedValueOnce(new Error('connection reset'));
      try {
        expect((await s.page.post(confirmPath(id))).status).toBe(500);
      } finally {
        blip.mockRestore();
      }
      // Not a refusal, and jobs were written: the press stands.
      expect(await previewRow(id)).toMatchObject({ state: 'confirmed', refusedCode: null });
      // The app cannot finish it on its own.
      const waiting = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(waiting.data.status).toBe('needs_confirmation');

      // The person's press replays the same keys: the limit is not counted
      // twice, and it ends applied, with one move and one unsubscribe.
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.data).toMatchObject({ status: 'applied', requested_emails: 3, refused: null });
      const mine = (await jobs(s.mailboxId)).filter((job) =>
        (job.idempotencyKey ?? '').includes(id),
      );
      expect(mine.filter((job) => job.verb === 'archive')).toHaveLength(1);
      // The retry hands the queue the same job again under the same job id,
      // which the real queue ignores; what matters is that it is one action.
      const unsubscribes = harness.queued.unsubscribe.filter((job) =>
        JSON.stringify(job).includes(id),
      ) as Array<{ actionId: string }>;
      expect(new Set(unsubscribes.map((job) => job.actionId)).size).toBe(1);
      expect(
        mine.filter((job) => (job.idempotencyKey ?? '').startsWith('unsubexec-')),
      ).toHaveLength(1);
    });

    it('a sender busy with another action is skipped, and nothing is unsubscribed', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id],
      });
      await harness.db.insert(actionJobs).values({
        mailboxAccountId: s.mailboxId,
        verb: 'archive',
        direction: 'forward',
        selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
        requestedCount: 2,
        affectedCount: 0,
        status: 'queued',
        idempotencyKey: `busy-${s.mailboxId}`,
      });
      const unsubBefore = harness.queued.unsubscribe.length;
      expect((await s.page.post(confirmPath(preview.data.preview_id))).status).toBe(200);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        applied_senders: 0,
        requested_emails: 0,
      });
      expect(applied.data.skipped).toEqual([
        { sender_id: shop.id, reason: 'in_progress', compose_url: null, email_moved: false },
      ]);
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore);
    });

    it('skips a sender that became Protected after the preview, and leaves its email alone', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      const bank = await seedSender(harness, s.mailboxId, {
        email: 'alerts@bank.example',
        mail: 4,
      });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id, bank.id],
      });
      expect(preview.data.email_count).toBe(6);
      await protectSender(harness, s.mailboxId, bank.id);
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.data).toMatchObject({ applied_senders: 1, requested_emails: 2 });
      expect(applied.data.skipped).toEqual([
        { sender_id: bank.id, reason: 'protected', compose_url: null, email_moved: false },
      ]);
    });
  });

  describe('what a confirmation stores', () => {
    it('keeps counts, sender ids and reason codes — nothing else — for every verb', async () => {
      const s = await scene();
      const oneClick = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const mailto = await seedSender(harness, s.mailboxId, {
        email: 'list@club.example',
        unsubscribe: 'mailto',
      });
      const wakeAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const requests: Array<Record<string, unknown>> = [
        { verb: 'keep', sender_ids: [oneClick.id, mailto.id] },
        { verb: 'unsubscribe', sender_ids: [oneClick.id, mailto.id] },
        { verb: 'unsubscribe', sender_ids: [mailto.id] },
        { verb: 'later', sender_ids: [mailto.id], wake_at: wakeAt },
        { verb: 'archive', sender_ids: [oneClick.id] },
        // Busy with the archive above: skipped, with a reason.
        { verb: 'delete', sender_ids: [oneClick.id] },
      ];
      for (const request of requests) {
        const preview = await s.mcp.call('preview_cleanup', request);
        expect(preview.isError, JSON.stringify(request)).toBe(false);
        const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
        expect(confirmed.status, JSON.stringify(request)).toBe(200);
        const row = await previewRow(preview.data.preview_id);
        expect(Object.keys(row!.result!).sort(), String(request.verb)).toEqual([
          'appliedSenders',
          'handle',
          'requestedEmails',
          'skipped',
        ]);
        for (const skip of row!.result!.skipped) {
          expect(Object.keys(skip).sort()).toEqual(['reason', 'senderId']);
        }
        // No name, address, subject or link — only ids and codes.
        expect(JSON.stringify(row!.result)).not.toMatch(/example|mailto:|https?:|Subject/);
      }
    });
  });

  describe('after the action runs', () => {
    it('reports progress, lists the action as undoable, undoes it, and records which app started it', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, {
        email: 'news@shop.example',
        name: 'The Shop',
        mail: 3,
      });
      const since = harness.queued.label.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      const actionId = applied.data.action_id as string;

      expect((await s.mcp.call('get_action_status', { action_id: actionId })).data).toMatchObject({
        status: 'queued',
        requested_emails: 3,
        changed_emails: 0,
        undo_token: null,
      });
      const origins = await harness.db
        .select()
        .from(actionOrigins)
        .where(eq(actionOrigins.actionJobId, actionId));
      expect(origins).toHaveLength(1);
      expect(origins[0]!.grantId).toEqual(expect.any(String));
      expect(origins[0]!.clientId).toEqual(expect.any(String));

      const gmail = await runLabelJobs(since);
      expect(gmail.calls.flat()).toHaveLength(3);

      const done = await s.mcp.call('get_action_status', { action_id: actionId });
      expect(done.data).toMatchObject({ status: 'done', changed_emails: 3, undone: false });
      const undoToken = done.data.undo_token as string;
      expect(undoToken).toEqual(expect.any(String));

      const recent = await s.mcp.call('list_recent_actions');
      expect(recent.data.actions).toEqual([
        expect.objectContaining({
          undo_token: undoToken,
          verb: 'archive',
          sender_count: 1,
          email_count: 3,
          senders: ['The Shop'],
        }),
      ]);

      // Activity names the app the change was prepared in — and only on
      // the rows that app started.
      await new SendersPolicyService(harness.db).setPolicy({
        mailboxAccountId: s.mailboxId,
        senderId: shop.id,
        patch: { policyType: 'keep' },
      });
      const activity = await new ActivityReadService(harness.db).listActivity({
        mailboxAccountId: s.mailboxId,
        window: 'all',
        source: null,
        nowMs: Date.now(),
        cursor: null,
        limit: 20,
      });
      const archived = activity.rows.filter((row) => row.action === 'archive');
      expect(archived).toHaveLength(1);
      expect(archived[0]!.connectedApp).toEqual({ name: 'Test Assistant' });
      const others = activity.rows.filter((row) => row.action !== 'archive');
      expect(others.length).toBeGreaterThan(0);
      for (const row of others) expect(row.connectedApp).toBeUndefined();

      const undone = await s.mcp.call('undo', { undo_token: undoToken });
      expect(undone.data).toMatchObject({
        undo_token: undoToken,
        verb: 'archive',
        status: 'queued',
      });
      expect(undone.data.action_ids).toHaveLength(1);
      // Asking again does not start a second reverse job.
      const again = await s.mcp.call('undo', { undo_token: undoToken });
      expect(again.isError).toBe(false);
      const reverse = (await jobs(s.mailboxId)).filter((row) => row.direction === 'reverse');
      expect(reverse).toHaveLength(1);
      // Activity says which app put it back.
      const afterUndo = await new ActivityReadService(harness.db).listActivity({
        mailboxAccountId: s.mailboxId,
        window: 'all',
        source: null,
        nowMs: Date.now(),
        cursor: null,
        limit: 20,
      });
      const undoneRow = afterUndo.rows.find((row) => row.action === 'archive');
      expect(undoneRow?.undoneByApp).toEqual({ name: 'Test Assistant' });
    });

    it('cannot list or undo a change the person made in DeclutrMail itself', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      // The person archives the sender in the web app.
      const since = harness.queued.label.length;
      const action = await harness.app.get(ActionsService).enqueueComposite({
        mailboxAccountId: s.mailboxId,
        selector: { type: 'sender', senderId: shop.id },
        primary: { type: 'archive', olderThanDays: null, wakeAt: null, reach: 'inbox_only' },
        idempotencyKey: `web-${s.mailboxId}`,
        override: false,
      });
      await runLabelJobs(since);
      const [forward] = await harness.db
        .select({ undoToken: actionJobs.undoToken })
        .from(actionJobs)
        .where(eq(actionJobs.id, action.actionId));
      const token = forward!.undoToken!;
      expect(token).toEqual(expect.any(String));

      const recent = await s.mcp.call('list_recent_actions');
      expect(recent.data.actions).toEqual([]);
      const undone = await s.mcp.call('undo', { undo_token: token });
      expect(undone.error).toMatchObject({ code: 'UNDO_NOT_FOUND' });
      expect(undone.error.message).toContain('in DeclutrMail');
      expect((await jobs(s.mailboxId)).filter((row) => row.direction === 'reverse')).toEqual([]);
    });

    it('answers UNDO_EXPIRED after the window and UNDO_NOT_FOUND for an unknown token', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const since = harness.queued.label.length;
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      await s.page.post(confirmPath(preview.data.preview_id));
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      await runLabelJobs(since);
      const status = await s.mcp.call('get_action_status', { action_id: applied.data.action_id });
      const undoToken = status.data.undo_token as string;
      await harness.db
        .update(undoJournal)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(undoJournal.token, undoToken));

      expect((await s.mcp.call('undo', { undo_token: undoToken })).error.code).toBe('UNDO_EXPIRED');
      expect(
        (await s.mcp.call('undo', { undo_token: '00000000-0000-4000-8000-000000000000' })).error
          .code,
      ).toBe('UNDO_NOT_FOUND');
      expect((await jobs(s.mailboxId)).filter((row) => row.direction === 'reverse')).toEqual([]);
    });

    it('cannot read another person’s action', async () => {
      const mine = await scene();
      const shop = await seedSender(harness, mine.mailboxId, { email: 'news@shop.example' });
      const preview = await mine.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      await mine.page.post(confirmPath(preview.data.preview_id));
      const applied = await mine.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });

      const stranger = await scene();
      const answer = await stranger.mcp.call('get_action_status', {
        action_id: applied.data.action_id,
      });
      expect(answer.error.code).toBe('ACTION_NOT_FOUND');
    });
  });

  describe('protect_sender', () => {
    it('protects, is idempotent, and has no way to unprotect', async () => {
      const s = await scene();
      const bank = await seedSender(harness, s.mailboxId, { email: 'alerts@bank.example' });

      const first = await s.mcp.call('protect_sender', { sender_id: bank.id });
      expect(first.data).toMatchObject({ sender_id: bank.id, protected: true, changed: true });
      // No confirmation in DeclutrMail: Activity names the app, not the person.
      const activity = await new ActivityReadService(harness.db).listActivity({
        mailboxAccountId: s.mailboxId,
        window: 'all',
        source: null,
        nowMs: Date.now(),
        cursor: null,
        limit: 20,
      });
      const protectedRow = activity.rows.find((row) => row.action === 'marked_protected');
      expect(protectedRow?.actingApp).toEqual({ name: 'Test Assistant' });
      expect(protectedRow?.connectedApp).toBeUndefined();
      const second = await s.mcp.call('protect_sender', { sender_id: bank.id });
      expect(second.data).toMatchObject({ protected: true, changed: false });

      // The only argument besides the sender is the mailbox.
      const forged = await s.mcp.call('protect_sender', { sender_id: bank.id, protected: false });
      expect(forged.isError).toBe(true);
      const [policy] = await harness.db
        .select()
        .from(senderPolicies)
        .where(eq(senderPolicies.senderKey, bank.senderKey));
      expect(policy!.isProtected).toBe(true);
      // And the sender is now out of reach of a cleanup.
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [bank.id],
      });
      expect(preview.error.code).toBe('NO_ACTIONABLE_SENDERS');
    });
  });

  describe('mailbox states', () => {
    it('answers MAILBOX_NOT_FOUND for an address outside the workspace', async () => {
      const mine = await scene();
      const theirs = await scene();
      const answer = await mine.mcp.call('list_senders', { mailbox: theirs.email });
      expect(answer.error.code).toBe('MAILBOX_NOT_FOUND');
    });

    it('answers NO_ACTIVE_MAILBOX with a Settings link when nothing is connected', async () => {
      const s = await scene();
      await harness.db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.id, s.mailboxId));
      const answer = await s.mcp.call('list_senders');
      expect(answer.error).toMatchObject({
        code: 'NO_ACTIVE_MAILBOX',
        settings_url: 'http://localhost:3000/settings',
      });
      // list_mailboxes still works, so the assistant can say what happened.
      const list = await s.mcp.call('list_mailboxes');
      expect(list.data.mailboxes).toEqual([
        expect.objectContaining({ address: s.email, status: 'disconnected', active: false }),
      ]);
    });

    it('answers MAILBOX_RECONNECT_REQUIRED for a cleanup, and still reads, when Gmail must be reconnected', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      await setSyncState(harness, s.mailboxId, 'needs_reconnect');

      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      expect(preview.error).toMatchObject({
        code: 'MAILBOX_RECONNECT_REQUIRED',
        settings_url: 'http://localhost:3000/settings',
      });
      const read = await s.mcp.call('list_senders');
      expect(read.data).toMatchObject({ sync_state: 'needs_reconnect', partial: true });
    });

    it('labels counts as partial while the first scan is still running', async () => {
      const s = await scene();
      await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      await setSyncState(harness, s.mailboxId, 'syncing');
      const answer = await s.mcp.call('list_senders');
      expect(answer.data).toMatchObject({ sync_state: 'syncing', partial: true, as_of: null });
    });
  });

  describe('review fixes, 2026-11-19', () => {
    it('a reconnect ends the previews made before it (spec §7)', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      // Disconnect, then connect the same Gmail again: the same row comes
      // back active, with a new connection time.
      await harness.db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.id, s.mailboxId));
      await harness.db.execute(sql`
        UPDATE mailbox_accounts SET status = 'active', connected_at = now() + interval '1 second'
        WHERE id = ${s.mailboxId}::uuid
      `);
      expect((await s.page.post(confirmPath(id))).status).toBe(404);
      const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(tool.error.code).toBe('PREVIEW_NOT_FOUND');
      expect(await jobs(s.mailboxId)).toEqual([]);
    });

    it('Unsubscribe for a sender whose unsubscribe is already on its way is a skip, not a failure', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      // Another one-click send to this sender is still queued.
      await harness.db.insert(actionJobs).values({
        mailboxAccountId: s.mailboxId,
        verb: 'unsubscribe',
        direction: 'forward',
        selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
        requestedCount: 0,
        affectedCount: 0,
        status: 'queued',
        idempotencyKey: `unsubexec-elsewhere-${s.mailboxId}`,
      });
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.data).toMatchObject({ status: 'applied', applied_senders: 0 });
      expect(applied.data.skipped).toEqual([
        { sender_id: shop.id, reason: 'in_progress', compose_url: null, email_moved: false },
      ]);
    });

    it('Unsubscribe + Archive says email moved only for senders whose email the move covered', async () => {
      const s = await scene();
      // Mailto: not unsubscribed by DeclutrMail. Nothing older than a year.
      const shop = await seedSender(harness, s.mailboxId, {
        email: 'news@shop.example',
        mail: 2,
        unsubscribe: 'mailto',
      });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        older_than_days: 365,
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      const labelBefore = harness.queued.label.length;
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(harness.queued.label.length).toBe(labelBefore);
      expect(applied.data).toMatchObject({ status: 'applied', applied_senders: 0 });
      expect(applied.data.skipped).toEqual([
        expect.objectContaining({ sender_id: shop.id, reason: 'mailto', email_moved: false }),
      ]);
    });

    it('a retry of Unsubscribe + Archive whose move failed sends no unsubscribe and reports the failure', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example', mail: 2 });
      const bank = await seedSender(harness, s.mailboxId, { email: 'news@bank.example', mail: 3 });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'unsubscribe',
        existing_email: 'archive',
        sender_ids: [shop.id, bank.id],
      });
      const id = preview.data.preview_id;
      harness.queueDown(true);
      try {
        expect((await s.page.post(confirmPath(id))).status).toBe(503);
      } finally {
        harness.queueDown(false);
      }
      const unsubBefore = harness.queued.unsubscribe.length;
      expect((await s.page.post(confirmPath(id))).status).toBe(200);
      expect(harness.queued.unsubscribe.length).toBe(unsubBefore);
      const mine = (await jobs(s.mailboxId)).filter((job) =>
        (job.idempotencyKey ?? '').includes(id),
      );
      expect(mine.filter((job) => job.verb === 'unsubscribe')).toEqual([]);
      const applied = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(applied.data).toMatchObject({
        status: 'applied',
        action_status: 'failed',
        applied_senders: 0,
      });
    });

    it('a press refused while another was starting answers with the refusal, not "expired"', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const id = preview.data.preview_id;
      // The other press was refused and put the row back.
      await harness.db
        .update(actionPreviews)
        .set({ refusedCode: 'QUOTA_EXHAUSTED' })
        .where(eq(actionPreviews.id, id));
      // This press read the row while the other one still held it confirmed.
      const previews = harness.app.get(ActionPreviewsService);
      const findOwned = previews.findOwned.bind(previews);
      const spy = vi
        .spyOn(previews, 'findOwned')
        .mockImplementationOnce(async (previewId, userId) => {
          const detail = await findOwned(previewId, userId);
          return detail
            ? { ...detail, preview: { ...detail.preview, state: 'confirmed', refusedCode: null } }
            : detail;
        });
      try {
        const answer = await previews.confirm(id, s.person.userId);
        expect(answer.preview).toMatchObject({ state: 'pending', refusedCode: 'QUOTA_EXHAUSTED' });
      } finally {
        spy.mockRestore();
      }
      expect(await jobs(s.mailboxId)).toEqual([]);
    });

    it('a Keep that fails reports only after every write has settled', async () => {
      const s = await scene();
      const senderIds: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        senderIds.push(
          (await seedSender(harness, s.mailboxId, { email: `n${index}@keep.example`, mail: 1 })).id,
        );
      }
      const preview = await s.mcp.call('preview_cleanup', { verb: 'keep', sender_ids: senderIds });
      const id = preview.data.preview_id;
      const actions = harness.app.get(ActionsService);
      let settled = 0;
      const spy = vi.spyOn(actions, 'recordKeepIntent').mockImplementation(async (input) => {
        if (input.senderId === senderIds[0]) throw new Error('connection reset');
        await new Promise((resolve) => setTimeout(resolve, 40));
        settled += 1;
        return undefined as never;
      });
      try {
        expect((await s.page.post(confirmPath(id))).status).toBe(500);
        // Every other write had finished before the failure was answered.
        expect(settled).toBe(11);
      } finally {
        spy.mockRestore();
      }
    });

    it('the expiry is set by the database clock, in the same statement as the row', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      // Counting takes a while before the row is written; an expiry taken
      // from this server's clock before that would start the 15 minutes
      // early. (The test database shares this process's clock, so a
      // skewed clock cannot tell the two apart; the gap can.)
      const actions = harness.app.get(ActionsService);
      const original = actions.previewComposite.bind(actions);
      const slow = vi.spyOn(actions, 'previewComposite').mockImplementation(async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return original(input);
      });
      let id: string;
      try {
        id = (await s.mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] })).data
          .preview_id;
      } finally {
        slow.mockRestore();
      }
      const row = (await previewRow(id))!;
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(15 * 60 * 1000);
    });
  });
});
