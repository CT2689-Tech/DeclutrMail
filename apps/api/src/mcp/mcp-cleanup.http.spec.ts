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
} from '@declutrmail/db';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  LabelActionWorker,
  OutboxPublisher,
  PASSTHROUGH_MAILBOX_LOCK,
  type BatchModifyOptions,
  type GmailMutationClient,
  type LabelActionJobData,
  type WorkerContext,
} from '@declutrmail/workers';

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

const FREE_LIMIT = TIER_MANIFEST.free.cleanupActionsPerMonth!;

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
      expect(answer.data.destination).toBe('Email in Inbox moves to Gmail Trash.');
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
        { sender_id: bank.id, reason: 'protected', compose_url: null },
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
        { sender_id: bank.id, reason: 'protected', compose_url: null },
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

    it('refuses at the plan’s monthly limit and applies nothing', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      for (let i = 0; i < FREE_LIMIT; i += 1) {
        await harness.db.insert(actionJobs).values({
          mailboxAccountId: s.mailboxId,
          verb: 'archive',
          direction: 'forward',
          selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
          requestedCount: 1,
          affectedCount: 1,
          status: 'done',
          idempotencyKey: `archive-fill-${s.mailboxId}-${i}`,
        });
      }
      const preview = await s.mcp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [shop.id],
      });
      const before = harness.queued.label.length;

      const confirmed = await s.page.post(confirmPath(preview.data.preview_id));
      expect(confirmed.status).toBe(402);
      expect(confirmed.json.error.code).toBe('FREE_CAP_REACHED');
      // The person did confirm; the tool reports why it did not start.
      const applied = await s.mcp.call('apply_cleanup', { preview_id: preview.data.preview_id });
      expect(applied.error).toMatchObject({
        code: 'QUOTA_EXHAUSTED',
        limit: FREE_LIMIT,
        remaining: 0,
        upgrade_url: 'http://localhost:3000/billing',
      });
      expect(applied.error.resets_at).toEqual(expect.any(String));
      expect(await jobs(s.mailboxId)).toHaveLength(FREE_LIMIT);
      expect(harness.queued.label.length).toBe(before);
    });

    it('survives a queue outage: the confirmation stands and a retry starts the action', async () => {
      const s = await scene();
      const shop = await seedSender(harness, s.mailboxId, { email: 'news@shop.example' });
      const preview = await s.mcp.call('preview_cleanup', { verb: 'keep', sender_ids: [shop.id] });
      const id = preview.data.preview_id;
      // Keep writes no job, so stand in a database failure for the outage.
      await harness.db.execute(sql`ALTER TABLE activity_log RENAME TO activity_log_away`);
      try {
        const failed = await s.page.post(confirmPath(id));
        expect(failed.status).toBe(500);
        expect((await previewRow(id))!.state).toBe('confirmed');
        const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
        expect(tool.error.code).toBe('INTERNAL_ERROR');
        expect(tool.text).not.toMatch(/activity_log/);
      } finally {
        await harness.db.execute(sql`ALTER TABLE activity_log_away RENAME TO activity_log`);
      }
      const retried = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(retried.data).toMatchObject({ status: 'applied', applied_senders: 1 });
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
      // The refused job is the one behind this preview's key: a retry
      // finds it, and reports what it is rather than a clean "applied".
      const tool = await s.mcp.call('apply_cleanup', { preview_id: id });
      expect(tool.data).toMatchObject({ status: 'applied', action_status: 'failed' });
      const page = await s.page.get(`/api/action-previews/${id}`);
      expect(page.json.data.outcome.actionStatus).toBe('failed');
      expect(await jobs(s.mailboxId)).toHaveLength(1);
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
});
