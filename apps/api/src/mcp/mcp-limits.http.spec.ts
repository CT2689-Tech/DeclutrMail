import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { accountDeletionRequests, actionJobs, actionPreviews } from '@declutrmail/db';

import { InMemoryTokenBucketStore } from '../common/rate-limit/in-memory-token-bucket.store.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import {
  authorizeUrl,
  Browser,
  client,
  connect,
  createOAuthTestApp,
  pkce,
  reachConsent,
  registerClient,
  type OAuthTestApp,
} from '../oauth/oauth-test-harness.js';
import { McpRateLimitGuard } from './mcp-rate-limit.guard.js';
import { MCP_TOOL_NAMES, MCP_TOOLS } from './mcp-tool-contract.js';
import {
  connectedClient,
  mailboxIdOf,
  McpTestClient,
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

    // The start prompt offers only what this connection can do, and says so.
    const start = await readOnly.promptText('start');
    for (const name of MCP_TOOL_NAMES) {
      const offered = start.includes(MCP_TOOLS[name].ask);
      expect(offered, name).toBe(MCP_TOOLS[name].scope === 'read');
    }
    expect(start).toContain('This connection can only read.');
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

    // The bucket refills one a second while this runs, so the refusal is
    // looked for rather than expected on exactly the 61st call.
    let refused: Awaited<ReturnType<typeof looping.call>> | undefined;
    let accepted = 0;
    for (let call = 0; call < 80 && !refused; call += 1) {
      const answer = await looping.call('preview_cleanup', args);
      if (answer.isError) refused = answer;
      else accepted += 1;
    }
    expect(accepted).toBeGreaterThanOrEqual(60);
    expect(refused?.error.code).toBe('RATE_LIMITED');
    expect(refused?.error.retry_after_seconds).toBeGreaterThan(0);
    const rows = await harness.db
      .select({ id: actionPreviews.id })
      .from(actionPreviews)
      .where(eq(actionPreviews.userId, ada.userId));
    // A refused call stores nothing.
    expect(rows).toHaveLength(accepted);

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

  it('lets 3,000 requests a minute through from one address and refuses the next with Retry-After', async () => {
    // The bucket refills 50 a second; the clock stands still so the count is exact.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const guard = new McpRateLimitGuard(new InMemoryTokenBucketStore());
      for (let call = 0; call < 3000; call += 1) {
        expect(await guard.canActivate(context('203.0.113.7').ctx)).toBe(true);
      }
      const refused = context('203.0.113.7');
      await expect(guard.canActivate(refused.ctx)).rejects.toMatchObject({ status: 429 });
      expect(Number(refused.set['Retry-After'])).toBeGreaterThan(0);
      // Another address is not held back by the first.
      expect(await guard.canActivate(context('203.0.113.8').ctx)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it('makes that account’s previews unusable at once, and leaves another account’s alone', async () => {
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

    // The assistant is told before it sends the person to the page...
    const tool = await mcp.call('apply_cleanup', { preview_id: mine.data.preview_id });
    expect(tool.error.code).toBe('MAILBOX_RECONNECT_REQUIRED');
    // ...and the page refuses the press.
    const page = sessionBrowser(harness, ada);
    const pressed = await page.post(`/api/action-previews/${mine.data.preview_id}/confirm`);
    expect(pressed.status).toBe(409);
    expect(pressed.json.error.code).toBe('NO_ACTIVE_MAILBOX');
    expect(await harness.db.select().from(actionJobs)).toEqual([]);
    const [row] = await harness.db
      .select({ state: actionPreviews.state })
      .from(actionPreviews)
      .where(eq(actionPreviews.id, mine.data.preview_id));
    expect(row!.state).toBe('pending');

    // The other account's request is untouched and still confirmable.
    const stillGood = await page.post(`/api/action-previews/${other.data.preview_id}/confirm`);
    expect(stillGood.status).toBe(200);
  });
});

describe('MCP connector — beta (MCP_ENABLED=beta)', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  it('lets the listed account in, and turns anyone else away at every door', async () => {
    const ada = await harness.person('ada@example.com');
    const grace = await harness.person('grace@example.com');
    const adaMailbox = await mailboxIdOf(harness, 'ada@example.com');
    const graceMailbox = await mailboxIdOf(harness, 'grace@example.com');
    await setSyncState(harness, adaMailbox, 'ready');
    await setSyncState(harness, graceMailbox, 'ready');
    const adaShop = await seedSender(harness, adaMailbox, { email: 'news@shop.example' });
    const graceShop = await seedSender(harness, graceMailbox, { email: 'news@shop.example' });
    // Grace connected while it was open to everyone, and asked for something.
    const graceConnection = await connect(harness, grace);
    const graceApp = new McpTestClient(harness.base, graceConnection.tokens.access_token);
    const graceAsked = await graceApp.call('preview_cleanup', {
      verb: 'archive',
      sender_ids: [graceShop.id],
    });

    vi.stubEnv('MCP_ENABLED', 'beta');
    vi.stubEnv('MCP_BETA_USER_IDS', ` ${ada.userId.toUpperCase()} , not-a-user`);

    // The listed account: connect, refresh, use the tools, the page, Settings.
    const adaConnection = await connect(harness, ada);
    const adaApp = new McpTestClient(harness.base, adaConnection.tokens.access_token);
    const adaRefresh = await client(harness.base).form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: adaConnection.tokens.refresh_token,
      client_id: adaConnection.clientId,
    });
    expect(adaRefresh.status).toBe(200);
    const adaAsked = await adaApp.call('preview_cleanup', {
      verb: 'archive',
      sender_ids: [adaShop.id],
    });
    expect(adaAsked.isError).toBe(false);
    const adaPage = sessionBrowser(harness, ada);
    expect((await adaPage.get(`/api/action-previews/${adaAsked.data.preview_id}`)).status).toBe(
      200,
    );
    expect((await adaPage.get('/api/oauth/grants')).status).toBe(200);

    // Anyone else: the token stops working, and the page and Settings 404.
    const refused = await graceApp.call('get_usage');
    expect(refused.http.status).toBe(401);
    expect(refused.http.headers.get('www-authenticate')).toContain('invalid_token');
    // ...and a refresh does not mint a new one, so the app starts over.
    const graceRefresh = await client(harness.base).form('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: graceConnection.tokens.refresh_token,
      client_id: graceConnection.clientId,
    });
    expect(graceRefresh.status).toBe(400);
    expect(graceRefresh.json.error).toBe('invalid_grant');
    const gracePage = sessionBrowser(harness, grace);
    expect((await gracePage.get(`/api/action-previews/${graceAsked.data.preview_id}`)).status).toBe(
      404,
    );
    expect(
      (await gracePage.post(`/api/action-previews/${graceAsked.data.preview_id}/confirm`)).status,
    ).toBe(404);
    expect((await gracePage.get('/api/oauth/grants')).status).toBe(404);

    // ...and connecting again is refused at Approve, with a reason.
    const browser = new Browser(harness.base, grace);
    const { path } = await reachConsent(
      browser,
      authorizeUrl(await registerClient(harness.base), pkce().challenge),
    );
    const approve = await browser.post(`${path}/approve`);
    expect(approve.status).toBe(403);
    expect(approve.json.error.code).toBe('CONNECT_NOT_AVAILABLE');

    // An empty list lets nobody in.
    vi.stubEnv('MCP_BETA_USER_IDS', '');
    expect((await adaApp.call('get_usage')).http.status).toBe(401);
    expect((await adaPage.get('/api/oauth/grants')).status).toBe(404);

    vi.stubEnv('MCP_ENABLED', 'true');
    expect((await adaApp.call('get_usage')).isError).toBe(false);
  });
});
