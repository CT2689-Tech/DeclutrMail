import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { actionJobs, productEvents } from '@declutrmail/db';
import {
  CONNECTOR_CLIENTS,
  sanitizeProductEvent,
} from '@declutrmail/shared/analytics/sanitize-product-event';
import { ACTION_PREVIEW_VERBS } from '@declutrmail/shared/contracts';
import { METER } from '@declutrmail/shared/entitlements';

import { createOAuthTestApp, type OAuthTestApp } from '../oauth/oauth-test-harness.js';
import { REFUSALS } from './action-previews.service.js';
import {
  connectedClient,
  mailboxIdOf,
  protectSender,
  seedSender,
  sessionBrowser,
  setSyncState,
} from './mcp-test-kit.js';
import { errorClassOf } from './mcp-client-profile.js';
import { MCP_TOOL_NAMES } from './mcp-tool-contract.js';
import type { McpToolErrorCode } from './mcp-tool-errors.js';

/** Every tool error code. A Record, so a new code fails to compile until listed here. */
const TOOL_ERROR_CODES: Record<McpToolErrorCode, true> = {
  INVALID_REQUEST: true,
  RATE_LIMITED: true,
  NO_ACTIVE_MAILBOX: true,
  MAILBOX_NOT_FOUND: true,
  MAILBOX_RECONNECT_REQUIRED: true,
  SENDER_NOT_FOUND: true,
  NO_ACTIONABLE_SENDERS: true,
  PREVIEW_NOT_FOUND: true,
  PREVIEW_EXPIRED: true,
  QUOTA_EXHAUSTED: true,
  UPGRADE_REQUIRED: true,
  QUEUE_UNAVAILABLE: true,
  UNSUBSCRIBE_UNAVAILABLE: true,
  ACTION_NOT_FOUND: true,
  UNDO_NOT_FOUND: true,
  UNDO_EXPIRED: true,
  UNDO_UNSUPPORTED: true,
  INTERNAL_ERROR: true,
};

/**
 * The connector's product funnel (product_events): connect, use, prepare,
 * open the confirm page, start or be refused, disconnect. Read from the
 * table, so the real writer, sanitizer and CHECK are all in the path.
 */

const UNKNOWN_SENDER = '0198d95f-a409-7000-8000-00000000abcd';

describe('MCP connector — product funnel', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
  }, 60_000);
  afterAll(async () => {
    await harness.close();
  });

  async function eventsOf(userId: string) {
    return harness.db
      .select({ event: productEvents.event, props: productEvents.props })
      .from(productEvents)
      .where(eq(productEvents.userId, userId))
      .orderBy(productEvents.occurredAt);
  }

  /** The writer is fire-and-forget: wait until `name` has landed `count` times. */
  async function landed(userId: string, name: string, count = 1) {
    await vi.waitFor(
      async () => {
        const rows = (await eventsOf(userId)).filter((row) => row.event === name);
        expect(rows).toHaveLength(count);
      },
      { timeout: 3_000, interval: 25 },
    );
    return (await eventsOf(userId)).filter((row) => row.event === name);
  }

  it('records each step, and no address, sender, subject or app name', async () => {
    const ada = await harness.person('ada@example.com');
    const mailboxId = await mailboxIdOf(harness, 'ada@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example', mail: 3 });

    const app = await connectedClient(harness, ada);
    expect((await landed(ada.userId, 'connector_app_connected'))[0]!.props).toEqual({
      client: 'other',
    });

    await app.call('get_usage');
    await app.call('get_sender', { sender_id: UNKNOWN_SENDER });
    const calls = await landed(ada.userId, 'connector_tool_called', 2);
    expect(calls.map((row) => row.props)).toEqual([
      { client: 'other', tool: 'get_usage', outcome: 'ok' },
      { client: 'other', tool: 'get_sender', outcome: 'error', error_class: 'SenderNotFound' },
    ]);

    const asked = await app.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    const previewId = asked.data.preview_id as string;
    expect((await landed(ada.userId, 'connector_request_prepared'))[0]!.props).toEqual({
      client: 'other',
      verb: 'archive',
      preview_id: previewId,
      requested_bucket: '1',
      emails: 0,
    });

    const page = sessionBrowser(harness, ada);
    expect((await page.get(`/api/action-previews/${previewId}`)).status).toBe(200);
    expect((await landed(ada.userId, 'connector_confirm_viewed'))[0]!.props).toEqual({
      verb: 'archive',
      preview_id: previewId,
    });
    expect((await page.post(`/api/action-previews/${previewId}/confirm`)).status).toBe(200);
    expect((await landed(ada.userId, 'connector_request_started'))[0]!.props).toEqual({
      verb: 'archive',
      preview_id: previewId,
    });
    // The receipt is not a view of a request waiting for a press.
    expect((await page.get(`/api/action-previews/${previewId}`)).status).toBe(200);

    const grants = await page.get('/api/oauth/grants');
    const grantId = grants.json.data.apps[0].id as string;
    expect((await page.request(`/api/oauth/grants/${grantId}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await landed(ada.userId, 'connector_app_disconnected'))[0]!.props).toEqual({});

    const all = await eventsOf(ada.userId);
    expect(all.filter((row) => row.event === 'connector_confirm_viewed')).toHaveLength(1);
    expect(all.some((row) => row.event === 'connector_request_refused')).toBe(false);
    const stored = JSON.stringify(all);
    for (const leak of ['@', 'shop', 'news', 'example', grantId]) {
      expect(stored).not.toContain(leak);
    }
  });

  it('records why a confirmed request did not start', async () => {
    const grace = await harness.person('grace@example.com');
    const mailboxId = await mailboxIdOf(harness, 'grace@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example', mail: 3 });
    const used = METER.free.limit - 2;
    await harness.db.insert(actionJobs).values({
      mailboxAccountId: mailboxId,
      verb: 'archive',
      direction: 'forward',
      selector: { type: 'sender', senderId: shop.id, senderKey: shop.senderKey },
      requestedCount: used,
      affectedCount: used,
      quotaUnits: used,
      status: 'done',
      idempotencyKey: `archive-fill-${mailboxId}`,
    });
    const app = await connectedClient(harness, grace);
    const asked = await app.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    const previewId = asked.data.preview_id as string;

    const page = sessionBrowser(harness, grace);
    expect((await page.post(`/api/action-previews/${previewId}/confirm`)).status).toBe(402);
    expect((await landed(grace.userId, 'connector_request_refused'))[0]!.props).toEqual({
      verb: 'archive',
      preview_id: previewId,
      reason: 'QUOTA_EXHAUSTED',
    });
    expect(
      (await eventsOf(grace.userId)).some((r) => r.event === 'connector_request_started'),
    ).toBe(false);
  });

  it('a request that acted on no sender is not counted as started', async () => {
    const lin = await harness.person('lin@example.com');
    const mailboxId = await mailboxIdOf(harness, 'lin@example.com');
    await setSyncState(harness, mailboxId, 'ready');
    const shop = await seedSender(harness, mailboxId, { email: 'news@shop.example', mail: 3 });
    const app = await connectedClient(harness, lin);
    const asked = await app.call('preview_cleanup', { verb: 'archive', sender_ids: [shop.id] });
    const previewId = asked.data.preview_id as string;
    // Protected after the request was prepared: the start skips it.
    await protectSender(harness, mailboxId, shop.id);

    const page = sessionBrowser(harness, lin);
    const pressed = await page.post(`/api/action-previews/${previewId}/confirm`);
    expect(pressed.status).toBe(200);
    expect(pressed.json.data.state).toBe('applied');
    expect(pressed.json.data.outcome.appliedSenders).toBe(0);
    // Wait for a later event, so a started row written before it would be here.
    await page.request(
      `/api/oauth/grants/${(await page.get('/api/oauth/grants')).json.data.apps[0].id}`,
      {
        method: 'DELETE',
      },
    );
    await landed(lin.userId, 'connector_app_disconnected');
    expect((await eventsOf(lin.userId)).some((r) => r.event === 'connector_request_started')).toBe(
      false,
    );
  });

  it('logs which protocol the client speaks and whether it can confirm in chat', async () => {
    const ivo = await harness.person('ivo.profile@example.com');
    await setSyncState(harness, await mailboxIdOf(harness, 'ivo.profile@example.com'), 'ready');
    const app = await connectedClient(harness, ivo);
    const log = vi.spyOn(console, 'log');
    try {
      await app.call('get_usage');
      const profiles = log.mock.calls
        .map(([line]) =>
          typeof line === 'string' && line.startsWith('{') ? JSON.parse(line) : null,
        )
        .filter((entry) => entry?.kind === 'mcp.client_profile');
      // The test client speaks 2025-06-18 by header, with no per-request
      // envelope: its capabilities are unknown here, never a guessed "no".
      expect(profiles).toEqual([
        {
          level: 'info',
          kind: 'mcp.client_profile',
          client: 'other',
          tool: 'get_usage',
          protocol: '2025-06-18',
          elicitation: 'unknown',
        },
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('every value the connector sends is one the sanitizer and the table accept', async () => {
    const accepted = async (props: Record<string, string>, name = 'connector_tool_called') => {
      expect(sanitizeProductEvent(name as never, props)).not.toBeNull();
      await harness.db.insert(productEvents).values({ event: name as never, props });
    };
    for (const tool of MCP_TOOL_NAMES) await accepted({ tool, outcome: 'ok' });
    for (const client of CONNECTOR_CLIENTS) await accepted({ client });
    for (const verb of ACTION_PREVIEW_VERBS) await accepted({ verb }, 'connector_request_started');
    for (const reason of REFUSALS) await accepted({ reason }, 'connector_request_refused');
    for (const code of Object.keys(TOOL_ERROR_CODES)) {
      await accepted({ tool: 'apply_cleanup', outcome: 'error', error_class: errorClassOf(code) });
    }

    // And the closed lists are closed, in both places.
    const outside = { tool: 'send_email', outcome: 'ok' };
    expect(sanitizeProductEvent('connector_tool_called', outside)).toBeNull();
    await expect(
      harness.db.insert(productEvents).values({ event: 'connector_tool_called', props: outside }),
    ).rejects.toThrow();
  });
});
