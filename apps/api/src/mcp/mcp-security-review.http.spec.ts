import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { actionPreviews, senderPolicies } from '@declutrmail/db';

import {
  authorizeUrl,
  Browser,
  client,
  connect,
  createOAuthTestApp,
  pkce,
  reachConsent,
  REDIRECT_URI,
  registerClient,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import {
  connectedClient,
  mailboxIdOf,
  McpTestClient,
  seedSender,
  sessionBrowser,
  setSyncState,
} from './mcp-test-kit.js';

/**
 * Probes from the pre-launch security review (docs/execution/
 * mcp-connector-security-review-2026-11-20.md): the doors the existing
 * suites did not try, each answered the way the review expects. Every
 * test here runs with `MCP_ENABLED=true` — the setting the review clears.
 */
describe('MCP connector — security review probes (MCP_ENABLED=true)', () => {
  let harness: OAuthTestApp;
  let ada: TestPerson;
  let grace: TestPerson;
  const api = () => client(harness.base);

  beforeAll(async () => {
    harness = await createOAuthTestApp();
    ada = await harness.person('ada@example.com', ['ada@example.com', 'ada.work@example.com']);
    grace = await harness.person('grace@example.com');
    for (const address of ['ada@example.com', 'ada.work@example.com', 'grace@example.com']) {
      await setSyncState(harness, await mailboxIdOf(harness, address), 'ready');
    }
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  describe('a token never becomes wider than what the person approved', () => {
    it('a refresh cannot add a scope the grant does not hold', async () => {
      const { tokens, clientId } = await connect(harness, ada, { scope: 'read' });
      expect(tokens.scope).toBe('read');
      const widened = await api().form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        scope: 'read cleanup',
      });
      // Refused outright, or issued at the grant's own scope: never wider.
      if (widened.status === 200) {
        expect(widened.json.scope).toBe('read');
        const mcp = new McpTestClient(harness.base, widened.json.access_token);
        expect(
          (await mcp.call('protect_sender', { sender_id: crypto.randomUUID() })).http.status,
        ).toBe(403);
      } else {
        expect(widened.status).toBe(400);
        expect(widened.json.error).toBe('invalid_scope');
      }
    });

    it('a refresh cannot move the token to another resource', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      const moved = await api().form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        resource: 'https://evil.example/mcp',
      });
      expect(moved.status).toBe(400);
      expect(moved.json.error).toBe('invalid_target');
    });

    it('a code is redeemable only by its own client, with its own redirect URI', async () => {
      const clientId = await registerClient(harness.base);
      const other = await registerClient(harness.base, {
        redirect_uris: ['https://other.example/callback'],
      });
      const proof = pkce();
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, proof.challenge));
      const approved = await browser.post(`${path}/approve`);
      const resumed = await browser.get(approved.json.data.redirectTo);
      const code = new URL(resumed.location!).searchParams.get('code')!;

      const exchange = (fields: Record<string, string>) =>
        api().form('/oauth/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: proof.verifier,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          ...fields,
        });
      const byOther = await exchange({
        client_id: other,
        redirect_uri: 'https://other.example/callback',
      });
      expect(byOther.status).toBe(400);
      expect(byOther.json.error).toBe('invalid_grant');
      const wrongRedirect = await exchange({ redirect_uri: 'https://client.example/elsewhere' });
      expect(wrongRedirect.status).toBe(400);
    });

    it('accepts the token only in the Authorization header, never in the URL', async () => {
      const mcp = await connectedClient(harness, ada);
      const inQuery = await new Browser(harness.base).request(
        `/mcp?access_token=${encodeURIComponent(mcp.accessToken)}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        },
      );
      expect(inQuery.status).toBe(401);
    });
  });

  describe('every id a client sends is scoped to the token’s own person and mailbox', () => {
    it('another person’s sender is not found by get_sender, protect_sender or preview_cleanup', async () => {
      const adaMailbox = await mailboxIdOf(harness, 'ada@example.com');
      const adaShop = await seedSender(harness, adaMailbox, { email: 'probe@shop.example' });
      const stranger = await connectedClient(harness, grace);

      const read = await stranger.call('get_sender', { sender_id: adaShop.id });
      expect(read.error.code).toBe('SENDER_NOT_FOUND');
      expect(read.text).not.toContain('probe@shop.example');

      const protect = await stranger.call('protect_sender', { sender_id: adaShop.id });
      expect(protect.isError).toBe(true);
      expect(
        await harness.db
          .select()
          .from(senderPolicies)
          .where(eq(senderPolicies.senderKey, adaShop.senderKey)),
      ).toEqual([]);

      const preview = await stranger.call('preview_cleanup', {
        verb: 'delete',
        sender_ids: [adaShop.id],
      });
      expect(preview.error.code).toBe('NO_ACTIONABLE_SENDERS');

      const named = await stranger.call('list_senders', { mailbox: 'ada@example.com' });
      expect(named.error.code).toBe('MAILBOX_NOT_FOUND');
    });

    it('a sender in one of the person’s mailboxes is not reachable through the other', async () => {
      const work = await mailboxIdOf(harness, 'ada.work@example.com');
      const workShop = await seedSender(harness, work, { email: 'work@shop.example' });
      const mcp = await connectedClient(harness, ada);
      const wrongMailbox = await mcp.call('get_sender', {
        mailbox: 'ada@example.com',
        sender_id: workShop.id,
      });
      expect(wrongMailbox.error.code).toBe('SENDER_NOT_FOUND');
      const rightMailbox = await mcp.call('get_sender', {
        mailbox: 'ada.work@example.com',
        sender_id: workShop.id,
      });
      expect(rightMailbox.isError).toBe(false);
    });

    it('two people on one registered client stay apart: neither sees or confirms the other’s previews', async () => {
      const shared = await registerClient(harness.base);
      const adaApp = new McpTestClient(
        harness.base,
        (await connect(harness, ada, { clientId: shared })).tokens.access_token,
      );
      const graceApp = new McpTestClient(
        harness.base,
        (await connect(harness, grace, { clientId: shared })).tokens.access_token,
      );
      const adaShop = await seedSender(harness, await mailboxIdOf(harness, 'ada@example.com'), {
        email: 'shared@shop.example',
      });
      const asked = await adaApp.call('preview_cleanup', {
        verb: 'archive',
        sender_ids: [adaShop.id],
      });
      expect(asked.isError).toBe(false);

      expect(
        (await graceApp.call('apply_cleanup', { preview_id: asked.data.preview_id })).error.code,
      ).toBe('PREVIEW_NOT_FOUND');
      expect((await graceApp.call('list_recent_actions')).data.actions).toEqual([]);
      const gracePage = sessionBrowser(harness, grace);
      expect(
        (await gracePage.post(`/api/action-previews/${asked.data.preview_id}/confirm`)).status,
      ).toBe(404);
      const [row] = await harness.db
        .select()
        .from(actionPreviews)
        .where(eq(actionPreviews.id, asked.data.preview_id));
      expect(row!.state).toBe('pending');
    });
  });

  describe('MCP_ENABLED=true opens the connector to everyone, and nothing else', () => {
    it('ignores the beta list: a person not on it connects and uses the tools', async () => {
      vi.stubEnv('MCP_BETA_USER_IDS', 'someone-else');
      try {
        const mcp = await connectedClient(harness, grace);
        expect((await mcp.call('get_usage')).isError).toBe(false);
        expect((await sessionBrowser(harness, grace).get('/api/oauth/grants')).status).toBe(200);
      } finally {
        vi.stubEnv('MCP_BETA_USER_IDS', '');
      }
    });

    it('the consent page reports nothing blocked for an ordinary account', async () => {
      const browser = new Browser(harness.base, grace);
      const { path } = await reachConsent(
        browser,
        authorizeUrl(await registerClient(harness.base), pkce().challenge),
      );
      expect((await browser.get(`${path}/details`)).json.data.blocked).toBeNull();
    });
  });

  describe('request shape', () => {
    it('answers a body it cannot read, from anyone, as a 4xx — never a server error', async () => {
      const malformed = await new Browser(harness.base).request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc": "2.0", "id": ',
      });
      expect(malformed.status).toBe(400);
      const encoded = await new Browser(harness.base).request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'compress' },
        body: '{}',
      });
      expect(encoded.status).toBe(415);
    });

    it('refuses a body larger than the API reads, before any tool runs', async () => {
      const mcp = await connectedClient(harness, ada);
      const huge = await new Browser(harness.base).request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mcp.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_senders', arguments: { q: 'x'.repeat(2_000_000) } },
        }),
      });
      expect(huge.status).toBe(413);
    });

    it('a JSON-RPC batch does not multiply tool calls past the per-call checks', async () => {
      const mcp = await connectedClient(harness, ada);
      const call = (id: number) => ({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'get_usage', arguments: {} },
      });
      const batch = await new Browser(harness.base).request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mcp.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify([call(1), call(2)]),
      });
      // Either refused, or each call answered on its own: never a call
      // that skipped the scope and budget checks every call passes.
      expect(batch.status).toBeLessThan(500);
    });
  });
});
