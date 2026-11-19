import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { METER } from '@declutrmail/shared/entitlements';

import {
  createOAuthTestApp,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import {
  connectedClient,
  mailboxIdOf,
  rpcBody,
  seedSender,
  setSyncState,
  type McpTestClient,
  type SeededSender,
} from './mcp-test-kit.js';
import { MCP_TOOL_NAMES, MCP_TOOLS } from './mcp-tool-contract.js';
import type { McpPrincipal } from './mcp-token.guard.js';
import { McpToolsService } from './mcp-tools.service.js';

/** The principal a tool handler would be given for this person. */
function principalOf(person: TestPerson): McpPrincipal {
  return {
    userId: person.userId,
    workspaceId: person.workspaceId,
    grantId: '00000000-0000-4000-8000-000000000000',
    clientId: 'test',
    client: 'local',
    scopes: ['read', 'cleanup'],
  };
}

/**
 * The connector's read-only tools over real HTTP: the OAuth flow, the
 * bearer guard, the MCP SDK transport and the real services on PGlite.
 */
describe('MCP tools — transport and the read-only tools', () => {
  let harness: OAuthTestApp;
  let ada: TestPerson;
  let mcp: McpTestClient;
  let mailboxId: string;
  let shop: SeededSender;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
    ada = await harness.person('ada@example.com', ['ada@example.com', 'ada.work@example.com']);
    mailboxId = await mailboxIdOf(harness, 'ada@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    shop = await seedSender(harness, mailboxId, {
      email: 'news@shop.example',
      name: 'The Shop',
      mail: 7,
      subject: (i) => `Sale number ${i}`,
    });
    await seedSender(harness, mailboxId, {
      email: 'hello@social.example',
      mail: 2,
      gmailTab: 'social',
    });
    mcp = await connectedClient(harness, ada);
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  it('lists exactly the ten tools, each with a title and annotations', async () => {
    const tools = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
    expect(tools).toHaveLength(10);
    for (const tool of tools) {
      expect(tool.title, String(tool.name)).toBeTruthy();
      expect(tool.annotations, String(tool.name)).toBeTruthy();
      expect(tool.outputSchema, String(tool.name)).toBeTruthy();
    }
  });

  it('list_mailboxes names both Gmail accounts and marks the active one', async () => {
    const answer = await mcp.call('list_mailboxes');
    expect(answer.isError).toBe(false);
    expect(answer.data.mailboxes).toEqual([
      expect.objectContaining({ address: 'ada@example.com', active: true, sync_state: 'ready' }),
      expect.objectContaining({ address: 'ada.work@example.com', active: false }),
    ]);
  });

  it('list_senders returns sender rows sorted by total, and never a snippet', async () => {
    const answer = await mcp.call('list_senders');
    expect(answer.isError).toBe(false);
    expect(answer.data.mailbox).toBe('ada@example.com');
    expect(answer.data.partial).toBe(false);
    expect(answer.data.senders.map((s: { address: string }) => s.address)).toEqual([
      'news@shop.example',
      'hello@social.example',
    ]);
    expect(answer.data.senders[0]).toMatchObject({
      id: shop.id,
      name: 'The Shop',
      domain: 'shop.example',
      total_received: 7,
      protected: false,
      unsubscribe_method: 'one_click',
    });
    expect(answer.text).not.toContain('SNIPPET');
  });

  it('get_sender returns counts by age and five recent subjects with dates', async () => {
    const answer = await mcp.call('get_sender', { sender_id: shop.id });
    expect(answer.isError).toBe(false);
    expect(answer.data.inbox_email.all).toBe(7);
    expect(answer.data.recent).toHaveLength(5);
    expect(answer.data.recent[0]).toEqual({ subject: 'Sale number 0', date: expect.any(String) });
    expect(answer.text).not.toContain('SNIPPET');
  });

  it('strips a field the contract does not declare before the result leaves', async () => {
    // ADR-0048 rule 3. The SDK validates a result against the output
    // schema but returns it unparsed, extra keys included — so the
    // server parses it itself. Simulate a handler that returns too much.
    const tools = harness.app.get(McpToolsService);
    const real = await tools.run('get_sender', principalOf(ada), { sender_id: shop.id });
    const spy = vi.spyOn(tools, 'run').mockResolvedValueOnce({
      ...real,
      sender: { ...real.sender, snippet: 'SNIPPET-MUST-NOT-LEAVE' },
      gmail_message_ids: ['18c2f0aa11'],
    } as never);
    try {
      const answer = await mcp.call('get_sender', { sender_id: shop.id });
      expect(answer.isError).toBe(false);
      expect(answer.data.sender.address).toBe('news@shop.example');
      expect(answer.text).not.toContain('SNIPPET');
      expect(answer.text).not.toContain('gmail_message_ids');
      expect(JSON.stringify(answer.data)).not.toContain('18c2f0aa11');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers a fixed sentence, not the validation detail, when a handler returns the wrong shape', async () => {
    const tools = harness.app.get(McpToolsService);
    const spy = vi.spyOn(tools, 'run').mockResolvedValueOnce({ plan: 42 } as never);
    try {
      const answer = await mcp.call('get_usage');
      expect(answer.error.code).toBe('INTERNAL_ERROR');
      expect(answer.text).not.toMatch(/expected|invalid|zod/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses get_action_status without exactly one id', async () => {
    const neither = await mcp.call('get_action_status', {});
    expect(neither.error.code).toBe('INVALID_REQUEST');
    const both = await mcp.call('get_action_status', {
      action_id: '00000000-0000-4000-8000-000000000001',
      batch_id: '00000000-0000-4000-8000-000000000002',
    });
    expect(both.error.code).toBe('INVALID_REQUEST');
  });

  it('pages list_senders with the cursor it returned, and refuses one it did not', async () => {
    const first = await mcp.call('list_senders', { limit: 1 });
    expect(first.data.senders).toHaveLength(1);
    expect(first.data.next_cursor).toEqual(expect.any(String));
    const second = await mcp.call('list_senders', { limit: 1, cursor: first.data.next_cursor });
    expect(second.data.senders.map((s: { address: string }) => s.address)).toEqual([
      'hello@social.example',
    ]);
    expect(second.data.next_cursor).toBeNull();
    const bogus = await mcp.call('list_senders', { cursor: 'not-a-cursor' });
    expect(bogus.error.code).toBe('INVALID_REQUEST');
  });

  it.each([
    ['the search', { q: 'shop\u0000' }],
    ['the mailbox', { mailbox: 'ada\u0000@example.test' }],
  ])('refuses a null character in %s before it reaches the database', async (_label, args) => {
    const answer = await mcp.call('list_senders', args);
    expect(answer.isError).toBe(true);
    expect(answer.text).toMatch(/Input validation error/);
  });

  it.each([
    ['whose id is not a sender id', { key: '3', id: 'x' }],
    ['with a null character', { key: '3\u0000', id: '00000000-0000-4000-8000-000000000001' }],
  ])('refuses a cursor %s as a bad request, not a server error', async (_label, cursor) => {
    const answer = await mcp.call('list_senders', {
      cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
    });
    expect(answer.error.code).toBe('INVALID_REQUEST');
  });

  it('filters list_senders by Gmail tab, search and Protected', async () => {
    const social = await mcp.call('list_senders', { gmail_tab: 'social' });
    expect(social.data.senders.map((s: { address: string }) => s.address)).toEqual([
      'hello@social.example',
    ]);
    const found = await mcp.call('list_senders', { q: 'shop' });
    expect(found.data.senders.map((s: { address: string }) => s.address)).toEqual([
      'news@shop.example',
    ]);
    const none = await mcp.call('list_senders', { protected_only: true });
    expect(none.data.senders).toEqual([]);
  });

  it('refuses to open a long-lived stream, for a 2026 client too', async () => {
    // The SDK would serve `subscriptions/listen` as a stream that never
    // closes (up to 1,024 of them per instance). Nothing here publishes
    // changes, so each one is refused before it opens.
    const modern = '2026-07-28';
    const meta = {
      'io.modelcontextprotocol/protocolVersion': modern,
      'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    const send = (method: string, params: Record<string, unknown>) =>
      fetch(`${harness.base}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mcp.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': modern,
          'mcp-method': method,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } }),
      });

    // The same client CAN list tools, so the refusal below is not a
    // malformed request being turned away.
    const tools = await send('tools/list', {});
    expect(tools.status).toBe(200);
    const listed = (await tools.json()) as { result: { tools: unknown[] } };
    expect(listed.result.tools).toHaveLength(10);

    const listen = await send('subscriptions/listen', {
      notifications: { toolsListChanged: true },
    });
    expect(listen.headers.get('content-type')).toContain('application/json');
    const body = (await listen.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Subscription limit reached');
  });

  it('offers one prompt, start, that lists everything this connection can ask for', async () => {
    const listed = rpcBody(await mcp.rpc('prompts/list'))?.result as {
      prompts: Array<{ name: string; title: string }>;
    };
    expect(listed.prompts).toEqual([
      expect.objectContaining({ name: 'start', title: 'What DeclutrMail can do' }),
    ]);
    const text = await mcp.promptText('start');
    for (const name of MCP_TOOL_NAMES) expect(text, name).toContain(MCP_TOOLS[name].ask);
    expect(text).not.toContain('can only read');
  });

  it('get_usage reports the plan and its monthly limit', async () => {
    const answer = await mcp.call('get_usage');
    expect(answer.isError).toBe(false);
    expect(answer.data).toMatchObject({
      plan: 'free',
      unit: 'emails',
      limit: METER.free.limit,
      used: 0,
      remaining: METER.free.limit,
    });
    expect(answer.data.resets_at).toEqual(expect.any(String));
  });
});
