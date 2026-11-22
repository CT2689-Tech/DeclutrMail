import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { actionJobs, actionPreviews } from '@declutrmail/db';

import { createOAuthTestApp, type OAuthTestApp } from '../oauth/oauth-test-harness.js';
import {
  connectedClient,
  mailboxIdOf,
  seedSender,
  setSyncState,
  type McpTestClient,
} from './mcp-test-kit.js';

/**
 * In-chat confirmation (spec §3, ADR-0048 rule 1) over real HTTP, as a
 * 2026-07-28 client speaks it. The person's Accept on the prompt this
 * server sent confirms a preview; nothing else a client sends does.
 *
 * "No mail changed" is measured where mail could change: an
 * `action_jobs` row or a queued job.
 */
describe('MCP connector — confirm in the chat', () => {
  let harness: OAuthTestApp;
  let people = 0;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  async function scene(): Promise<{
    mcp: McpTestClient;
    email: string;
    mailboxId: string;
    previewId: string;
  }> {
    people += 1;
    const email = `chat${people}@example.com`;
    const person = await harness.person(email);
    const mailboxId = await mailboxIdOf(harness, email);
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: `news${people}@shop.example` });
    const mcp = await connectedClient(harness, person);
    const preview = await mcp.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    expect(preview.isError).toBe(false);
    return { mcp, email, mailboxId, previewId: preview.data.preview_id };
  }

  const state = async (id: string) =>
    (await harness.db.select().from(actionPreviews).where(eq(actionPreviews.id, id)))[0]!.state;
  const jobs = (mailboxId: string) =>
    harness.db.select().from(actionJobs).where(eq(actionJobs.mailboxAccountId, mailboxId));
  const accept = { [`confirm`]: { action: 'accept', content: {} } };

  it('asks with the preview’s own copy, and changes nothing until the person answers', async () => {
    const s = await scene();
    const before = harness.queued.label.length;
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    expect(asked.result?.resultType).toBe('input_required');
    const prompt = asked.result!.inputRequests.confirm;
    expect(prompt.method).toBe('elicitation/create');
    expect(prompt.params.mode).toBe('form');
    // The count, where it goes, how to undo — and which account.
    expect(prompt.params.message).toContain('Archive 3 emails from 1 sender');
    expect(prompt.params.message).toContain(s.email);
    expect(prompt.params.message).toContain('Moves out of your inbox');
    expect(prompt.params.message).toContain('Undo from Activity');
    expect(asked.result!.requestState).toEqual(expect.any(String));
    expect(await state(s.previewId)).toBe('pending');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
    expect(harness.queued.label.length).toBe(before);
  });

  it('Accept on that prompt applies the preview once', async () => {
    const s = await scene();
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    const round = { inputResponses: accept, requestState: asked.result!.requestState };
    const applied = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId }, round);
    expect(applied.result?.structuredContent).toMatchObject({
      status: 'applied',
      confirm_url: null,
      applied_senders: 1,
      requested_emails: 3,
    });
    expect(await state(s.previewId)).toBe('applied');
    // The same answer sent again is the same action, never a second one.
    const again = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId }, round);
    expect(again.result?.structuredContent.action_id).toBe(
      applied.result!.structuredContent.action_id,
    );
    expect(await jobs(s.mailboxId)).toHaveLength(1);
  });

  it('Decline leaves it waiting, with the confirm link, and does not ask again that round', async () => {
    const s = await scene();
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    for (const action of ['decline', 'cancel']) {
      const answered = await s.mcp.callModern(
        'apply_cleanup',
        { preview_id: s.previewId },
        {
          inputResponses: { confirm: { action } },
          requestState: asked.result!.requestState,
        },
      );
      expect(answered.result?.resultType).not.toBe('input_required');
      expect(answered.result?.structuredContent).toMatchObject({
        status: 'needs_confirmation',
        confirm_url: expect.stringContaining(`/confirm/${s.previewId}`),
      });
    }
    expect(await state(s.previewId)).toBe('pending');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
  });

  it('an Accept the server never asked for confirms nothing: it is asked for properly', async () => {
    const s = await scene();
    const forged = await s.mcp.callModern(
      'apply_cleanup',
      { preview_id: s.previewId },
      { inputResponses: accept },
    );
    expect(forged.result?.resultType).toBe('input_required');
    expect(await state(s.previewId)).toBe('pending');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
  });

  it('an Accept for one preview does not confirm another', async () => {
    const s = await scene();
    const shop = await seedSender(harness, s.mailboxId, { email: 'other@shop.example' });
    const other = await s.mcp.call('preview_cleanup', { verb: 'delete', sender_ids: [shop.id] });
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    const moved = await s.mcp.callModern(
      'apply_cleanup',
      { preview_id: other.data.preview_id },
      { inputResponses: accept, requestState: asked.result!.requestState },
    );
    expect(moved.result?.resultType).toBe('input_required');
    expect(await state(other.data.preview_id)).toBe('pending');
    expect(await state(s.previewId)).toBe('pending');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
  });

  it('refuses state that is altered, or that another person’s app was given', async () => {
    const s = await scene();
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    const minted = asked.result!.requestState as string;
    const tampered = await s.mcp.callModern(
      'apply_cleanup',
      { preview_id: s.previewId },
      { inputResponses: accept, requestState: `${minted.slice(0, -2)}xx` },
    );
    expect(tampered.error?.code).toBe(-32602);

    // The same signed state, replayed by a different person's app.
    const stranger = await scene();
    const replayed = await stranger.mcp.callModern(
      'apply_cleanup',
      { preview_id: s.previewId },
      { inputResponses: accept, requestState: minted },
    );
    expect(replayed.error?.code).toBe(-32602);
    expect(await state(s.previewId)).toBe('pending');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
  });

  it('a replayed Accept never re-drives a refused press or a failed start', async () => {
    const s = await scene();
    const asked = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId });
    const round = { inputResponses: accept, requestState: asked.result!.requestState };

    // A press the quota refused is spent: back to pending, refusal recorded.
    await harness.db
      .update(actionPreviews)
      .set({ refusedCode: 'QUOTA_EXHAUSTED' })
      .where(eq(actionPreviews.id, s.previewId));
    const afterRefusal = await s.mcp.callModern(
      'apply_cleanup',
      { preview_id: s.previewId },
      round,
    );
    expect(afterRefusal.result?.structuredContent.status).toBe('needs_confirmation');
    expect(await state(s.previewId)).toBe('pending');

    // A start that failed: confirmed, its claim's lease long gone.
    await harness.db
      .update(actionPreviews)
      .set({
        refusedCode: null,
        state: 'confirmed',
        confirmedAt: new Date(Date.now() - 60 * 60_000),
        claimedAt: new Date(Date.now() - 60 * 60_000),
      })
      .where(eq(actionPreviews.id, s.previewId));
    const afterFault = await s.mcp.callModern('apply_cleanup', { preview_id: s.previewId }, round);
    expect(afterFault.result?.structuredContent.status).toBe('needs_confirmation');
    expect(await state(s.previewId)).toBe('confirmed');
    expect(await jobs(s.mailboxId)).toHaveLength(0);
  });

  it('a client that cannot show a form gets the confirm link, as before', async () => {
    const s = await scene();
    for (const capabilities of [{}, { elicitation: { url: {} } }]) {
      const answer = await s.mcp.callModern(
        'apply_cleanup',
        { preview_id: s.previewId },
        { capabilities },
      );
      expect(answer.result?.structuredContent).toMatchObject({
        status: 'needs_confirmation',
        confirm_url: expect.stringContaining(`/confirm/${s.previewId}`),
      });
    }
    // A 2025-era client declares nothing per request: the link, too.
    expect((await s.mcp.call('apply_cleanup', { preview_id: s.previewId })).data.status).toBe(
      'needs_confirmation',
    );
    expect(await state(s.previewId)).toBe('pending');
  });
});
