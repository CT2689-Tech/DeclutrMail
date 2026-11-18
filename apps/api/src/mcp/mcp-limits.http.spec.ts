import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { accountDeletionRequests, actionJobs, actionPreviews } from '@declutrmail/db';

import { InMemoryTokenBucketStore } from '../common/rate-limit/in-memory-token-bucket.store.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { createOAuthTestApp, type OAuthTestApp } from '../oauth/oauth-test-harness.js';
import { McpRateLimitGuard } from './mcp-rate-limit.guard.js';
import {
  connectedClient,
  mailboxIdOf,
  seedSender,
  sessionBrowser,
  setSyncState,
} from './mcp-test-kit.js';

/**
 * Scopes, rate ceilings and the mailbox lifecycle around the connector
 * (docs/spec/mcp-connector.md §4, §6, §7).
 */
describe('MCP connector — scopes', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  it('an app given only "read" can read, and is refused every cleanup tool with a scope challenge', async () => {
    const ada = await harness.person('ada@example.com');
    const mailboxId = await mailboxIdOf(harness, 'ada@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example' });
    const readOnly = await connectedClient(harness, ada, { scope: 'read' });

    expect((await readOnly.call('list_senders')).isError).toBe(false);
    for (const [tool, args] of [
      ['preview_cleanup', { verb: 'delete', sender_ids: [shop.id] }],
      ['apply_cleanup', { preview_id: '00000000-0000-4000-8000-000000000000' }],
      ['undo', { undo_token: '00000000-0000-4000-8000-000000000000' }],
      ['protect_sender', { sender_id: shop.id }],
    ] as const) {
      const answer = await readOnly.call(tool, args);
      expect(answer.http.status, tool).toBe(403);
      const challenge = answer.http.headers.get('www-authenticate') ?? '';
      expect(challenge, tool).toContain('insufficient_scope');
      expect(challenge, tool).toContain('scope="cleanup"');
    }
    expect(
      await harness.db.select().from(actionPreviews).where(eq(actionPreviews.userId, ada.userId)),
    ).toEqual([]);
  });
});

describe('MCP connector — account deletion in flight', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  it('refuses every token of an account being deleted, even if its grant was never revoked', async () => {
    const ada = await harness.person('ada@example.com');
    const mcp = await connectedClient(harness, ada);
    expect((await mcp.call('get_usage')).isError).toBe(false);

    // The deletion flow revokes grants itself; this is the second line,
    // so write the request directly and leave the grant alone.
    await harness.db.insert(accountDeletionRequests).values({
      userId: ada.userId,
      effectiveAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      basis: 'flat-grace',
      status: 'pending',
    });

    const answer = await mcp.call('get_usage');
    expect(answer.http.status).toBe(401);
    expect(answer.http.headers.get('www-authenticate')).toContain('invalid_token');
  });
});

describe('MCP connector — rate ceilings', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp({ rateLimit: true });
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  it('stops one app at 60 previews a minute, and counts each app on its own', async () => {
    const ada = await harness.person('ada@example.com');
    const mailboxId = await mailboxIdOf(harness, 'ada@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example' });
    const looping = await connectedClient(harness, ada);
    const args = { verb: 'keep', sender_ids: [shop.id] };

    for (let call = 0; call < 60; call += 1) {
      expect((await looping.call('preview_cleanup', args)).isError, `call ${call}`).toBe(false);
    }
    const refused = await looping.call('preview_cleanup', args);
    expect(refused.error.code).toBe('RATE_LIMITED');
    expect(refused.error.retry_after_seconds).toBeGreaterThan(0);
    const rows = await harness.db
      .select({ id: actionPreviews.id })
      .from(actionPreviews)
      .where(eq(actionPreviews.userId, ada.userId));
    expect(rows).toHaveLength(60);

    // A second app of the same person has its own ceiling.
    const other = await connectedClient(harness, ada);
    expect((await other.call('preview_cleanup', args)).isError).toBe(false);
  }, 60_000);

  it('draws reads from the per-user read budget and says when it is spent', async () => {
    const grace = await harness.person('grace@example.com');
    const mcp = await connectedClient(harness, grace);
    // 120 a minute, the web app's own read budget. The bucket refills
    // while the loop runs, so the exact count of refusals is not pinned.
    let limited = 0;
    for (let call = 0; call < 200; call += 1) {
      const answer = await mcp.call('get_usage');
      if (!answer.isError) continue;
      expect(call, 'the first 120 calls are inside the budget').toBeGreaterThanOrEqual(120);
      expect(answer.error.code).toBe('RATE_LIMITED');
      limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  }, 60_000);
});

describe('McpRateLimitGuard — per address, before the token is looked up', () => {
  const context = (ip: string, headers: Record<string, string> = {}) => {
    const set: Record<string, string> = {};
    return {
      set,
      ctx: {
        switchToHttp: () => ({
          getRequest: () => ({ ip }),
          getResponse: () => ({
            setHeader: (name: string, value: string) => {
              set[name] = value;
            },
          }),
        }),
      } as never,
      headers,
    };
  };

  it('lets 600 requests a minute through from one address and refuses the next with Retry-After', async () => {
    const guard = new McpRateLimitGuard(new InMemoryTokenBucketStore());
    for (let call = 0; call < 600; call += 1) {
      expect(await guard.canActivate(context('203.0.113.7').ctx)).toBe(true);
    }
    const refused = context('203.0.113.7');
    await expect(guard.canActivate(refused.ctx)).rejects.toMatchObject({ status: 429 });
    expect(Number(refused.set['Retry-After'])).toBeGreaterThan(0);
    // Another address is not held back by the first.
    expect(await guard.canActivate(context('203.0.113.8').ctx)).toBe(true);
  });

  it('fails open when the store errors, as the HTTP limiter does', async () => {
    const guard = new McpRateLimitGuard({
      consume: async () => {
        throw new Error('redis down');
      },
    });
    expect(await guard.canActivate(context('203.0.113.7').ctx)).toBe(true);
  });

  it('is a no-op when no store is configured', async () => {
    expect(await new McpRateLimitGuard(null).canActivate(context('203.0.113.7').ctx)).toBe(true);
  });
});

describe('MCP connector — Gmail account disconnected', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  it('deletes that account’s previews, and only that account’s', async () => {
    const ada = await harness.person('ada@example.com', ['ada@example.com', 'work@example.com']);
    const personal = await mailboxIdOf(harness, 'ada@example.com');
    const work = await mailboxIdOf(harness, 'work@example.com');
    const shop = await seedSender(harness, personal, { email: 'news@shop.example' });
    const vendor = await seedSender(harness, work, { email: 'bills@vendor.example' });
    const mcp = await connectedClient(harness, ada);
    const mine = await mcp.call('preview_cleanup', {
      verb: 'archive',
      sender_ids: [shop.id],
      mailbox: 'ada@example.com',
    });
    const other = await mcp.call('preview_cleanup', {
      verb: 'archive',
      sender_ids: [vendor.id],
      mailbox: 'work@example.com',
    });

    await harness.app.get(MailboxAccountsService).disconnect({
      workspaceId: ada.workspaceId,
      userId: ada.userId,
      mailboxAccountId: personal,
    });

    const left = await harness.db.select({ id: actionPreviews.id }).from(actionPreviews);
    expect(left.map((row) => row.id)).toEqual([other.data.preview_id]);
    // The page and the tool agree it is gone.
    const page = sessionBrowser(harness, ada);
    expect((await page.post(`/api/action-previews/${mine.data.preview_id}/confirm`)).status).toBe(
      404,
    );
    expect((await mcp.call('apply_cleanup', { preview_id: mine.data.preview_id })).error.code).toBe(
      'PREVIEW_NOT_FOUND',
    );
    expect(await harness.db.select().from(actionJobs)).toEqual([]);
  });
});
