import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createOAuthTestApp,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import {
  connectedClient,
  mailboxIdOf,
  seedSender,
  setSyncState,
  type McpTestClient,
  type SeededSender,
} from './mcp-test-kit.js';
import { MCP_TOOL_NAMES } from './mcp-tool-contract.js';

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

  it('get_usage reports the plan and its monthly limit', async () => {
    const answer = await mcp.call('get_usage');
    expect(answer.isError).toBe(false);
    expect(answer.data).toMatchObject({ plan: 'free', used: 0 });
    expect(answer.data.limit).toBeGreaterThan(0);
  });
});
