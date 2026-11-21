import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

import { mailMessages, mailboxAccounts, providerSyncState, senders } from '@declutrmail/db';

import {
  Browser,
  client,
  connect,
  type HttpResult,
  type OAuthTestApp,
  type TestPerson,
} from '../oauth/oauth-test-harness.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';

/**
 * Test kit for the connector's tools: a scripted MCP client over real
 * HTTP, and seeding for the Gmail-derived rows the tools read.
 *
 * Not a `.spec.ts` on purpose — shared by the tool specs — and never
 * imported by production code.
 */

/** A raw JSON-RPC answer from `callModern`. */
export interface RpcAnswer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test kit; every use is an assertion
  result: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test kit; every use is an assertion
  error: any;
}

export interface ToolAnswer {
  /** The HTTP exchange, for status and headers. */
  http: HttpResult;
  isError: boolean;
  /** `structuredContent` of a success. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test kit; every use is an assertion
  data: any;
  /** `{ code, message, … }` of a tool error. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test kit; every use is an assertion
  error: any;
  /** The text block exactly as the assistant receives it. */
  text: string;
}

/** A JSON-RPC body from either response framing the SDK uses. */
export function rpcBody(http: HttpResult): Record<string, unknown> | undefined {
  if (http.json !== undefined) return http.json as Record<string, unknown>;
  const data = http.text
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length);
  return data ? (JSON.parse(data) as Record<string, unknown>) : undefined;
}

export class McpTestClient {
  private nextId = 1;

  constructor(
    private readonly base: string,
    readonly accessToken: string,
  ) {}

  rpc(method: string, params: unknown = {}): Promise<HttpResult> {
    return new Browser(this.base).request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
  }

  /**
   * One `tools/call` as a 2026-07-28 client sends it: the capabilities on
   * the request itself, and — on a retry — the person's answers and the
   * server's `requestState`. Returns the raw JSON-RPC result or error.
   */
  async callModern(
    name: string,
    args: Record<string, unknown>,
    round: {
      capabilities?: Record<string, unknown>;
      inputResponses?: Record<string, unknown>;
      requestState?: string;
    } = {},
  ): Promise<RpcAnswer> {
    const http = await new Browser(this.base).request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
            [CLIENT_CAPABILITIES_META_KEY]: round.capabilities ?? { elicitation: { form: {} } },
          },
          ...(round.inputResponses ? { inputResponses: round.inputResponses } : {}),
          ...(round.requestState ? { requestState: round.requestState } : {}),
        },
      }),
    });
    const body = rpcBody(http);
    return { status: http.status, result: body?.result, error: body?.error };
  }

  /** The text of a prompt's first message. */
  async promptText(name: string): Promise<string> {
    const http = await this.rpc('prompts/get', { name });
    const result = rpcBody(http)?.result as
      { messages: Array<{ content: { type: string; text: string } }> } | undefined;
    if (!result) throw new Error(`prompts/get failed: ${http.status} ${http.text}`);
    return result.messages[0]!.content.text;
  }

  async listTools(): Promise<Array<Record<string, unknown>>> {
    const http = await this.rpc('tools/list');
    const result = rpcBody(http)?.result as { tools: Array<Record<string, unknown>> } | undefined;
    if (!result) throw new Error(`tools/list failed: ${http.status} ${http.text}`);
    return result.tools;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
    const http = await this.rpc('tools/call', { name, arguments: args });
    const body = rpcBody(http);
    const result = body?.result as
      | {
          isError?: boolean;
          structuredContent?: unknown;
          content?: Array<{ type: string; text: string }>;
        }
      | undefined;
    if (!result) {
      return { http, isError: true, data: undefined, error: body?.error, text: http.text };
    }
    const text = result.content?.[0]?.text ?? '';
    if (result.isError) {
      let error: unknown;
      try {
        error = (JSON.parse(text) as { error?: unknown }).error;
      } catch {
        error = undefined;
      }
      return { http, isError: true, data: undefined, error, text };
    }
    return { http, isError: false, data: result.structuredContent, error: undefined, text };
  }
}

/** Connect an app for `person` and return a client holding its access token. */
export async function connectedClient(
  harness: OAuthTestApp,
  person: TestPerson,
  options: { scope?: string } = {},
): Promise<McpTestClient> {
  const { tokens } = await connect(harness, person, options);
  return new McpTestClient(harness.base, tokens.access_token);
}

export async function mailboxIdOf(harness: OAuthTestApp, address: string): Promise<string> {
  const [row] = await harness.db
    .select({ id: mailboxAccounts.id })
    .from(mailboxAccounts)
    .where(eq(mailboxAccounts.providerAccountId, address))
    .limit(1);
  if (!row) throw new Error(`no mailbox ${address}`);
  return row.id;
}

export interface SeededSender {
  id: string;
  senderKey: string;
  email: string;
}

/** One sender with `mail` inbox emails, newest first, one day apart. */
export async function seedSender(
  harness: OAuthTestApp,
  mailboxAccountId: string,
  options: {
    email: string;
    name?: string;
    mail?: number;
    /** Age in days of the newest email. */
    newestDaysAgo?: number;
    subject?: (index: number) => string;
    snippet?: string;
    unsubscribe?: 'one_click' | 'mailto' | 'none' | null;
    gmailTab?: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  },
): Promise<SeededSender> {
  const mail = options.mail ?? 3;
  const newest = options.newestDaysAgo ?? 1;
  const senderKey = createHash('sha256')
    .update(`${mailboxAccountId}:${options.email}`)
    .digest('hex');
  const method = options.unsubscribe === undefined ? 'one_click' : options.unsubscribe;
  const day = 24 * 60 * 60 * 1000;
  const [sender] = await harness.db
    .insert(senders)
    .values({
      mailboxAccountId,
      senderKey,
      displayName: options.name ?? '',
      email: options.email,
      domain: options.email.split('@')[1]!,
      gmailCategory: options.gmailTab ?? 'promotions',
      firstSeenAt: new Date(Date.now() - (newest + mail) * day),
      lastSeenAt: new Date(Date.now() - newest * day),
      totalReceived: mail,
      unsubscribeMethod: method,
      unsubscribeUrl:
        method === 'one_click'
          ? `https://${options.email.split('@')[1]}/unsubscribe?u=1`
          : method === 'mailto'
            ? `mailto:leave@${options.email.split('@')[1]}?subject=unsubscribe`
            : null,
    })
    .returning({ id: senders.id });
  for (let index = 0; index < mail; index += 1) {
    await harness.db.insert(mailMessages).values({
      mailboxAccountId,
      providerMessageId: `${senderKey.slice(0, 12)}-${index}`,
      providerThreadId: `t-${senderKey.slice(0, 12)}-${index}`,
      senderKey,
      subject: options.subject?.(index) ?? `Subject ${index}`,
      snippet: options.snippet ?? 'SNIPPET-MUST-NOT-LEAVE',
      internalDate: new Date(Date.now() - (newest + index) * day),
      isUnread: index % 2 === 0,
      labelIds: ['INBOX'],
    });
  }
  return { id: sender!.id, senderKey, email: options.email };
}

/** Protect a sender the way Settings does. */
export async function protectSender(
  harness: OAuthTestApp,
  mailboxAccountId: string,
  senderId: string,
): Promise<void> {
  await new SendersPolicyService(harness.db).setPolicy({
    mailboxAccountId,
    senderId,
    patch: { isProtected: true },
  });
}

/** Give a mailbox a sync state; without one it reads as not yet scanned. */
export async function setSyncState(
  harness: OAuthTestApp,
  mailboxAccountId: string,
  readiness: 'queued' | 'syncing' | 'ready' | 'failed' | 'needs_reconnect',
): Promise<void> {
  await harness.db
    .delete(providerSyncState)
    .where(and(eq(providerSyncState.mailboxAccountId, mailboxAccountId)));
  await harness.db.insert(providerSyncState).values({
    mailboxAccountId,
    readinessStatus: readiness,
    lastSyncedAt: readiness === 'ready' ? new Date() : null,
  });
}

/** The session browser for `person`, for the confirm-page routes. */
export function sessionBrowser(harness: OAuthTestApp, person: TestPerson): Browser {
  return new Browser(harness.base, person);
}

export { client };
