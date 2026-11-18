import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PGlite } from '@electric-sql/pglite';
import cookieParser from 'cookie-parser';
import { drizzle } from 'drizzle-orm/pglite';
import type { Redis } from 'ioredis';
import { vi } from 'vitest';

import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';

import { ActionsService } from '../actions/actions.service.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CsrfService } from '../auth/csrf.service.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { JwtService } from '../auth/jwt.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { InMemoryTokenBucketStore } from '../common/rate-limit/in-memory-token-bucket.store.js';
import {
  RateLimitInterceptor,
  TOKEN_BUCKET_STORE,
} from '../common/rate-limit/rate-limit.interceptor.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { ActionPreviewsController } from '../mcp/action-previews.controller.js';
import { ActionPreviewsService } from '../mcp/action-previews.service.js';
import { McpController } from '../mcp/mcp.controller.js';
import { McpEnabledGuard } from '../mcp/mcp-enabled.guard.js';
import { McpRateLimitGuard } from '../mcp/mcp-rate-limit.guard.js';
import { McpServerService } from '../mcp/mcp-server.service.js';
import { McpTokenGuard } from '../mcp/mcp-token.guard.js';
import { McpToolsService } from '../mcp/mcp-tools.service.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';
import { SendersReadService } from '../senders/senders.read-service.js';
import { SyncService } from '../sync/sync.service.js';
import { UndoService } from '../undo/undo.service.js';
import { OAuthConsentController } from './oauth-consent.controller.js';
import { OAuthConsentService } from './oauth-consent.service.js';
import { OAuthGrantsController } from './oauth-grants.controller.js';
import { MCP_ROOT_ROUTES, OAuthProtocolController } from './oauth-protocol.controller.js';
import { OAuthProviderService } from './oauth-provider.service.js';

/**
 * Test harness for the OAuth authorization server: the real controllers,
 * guards, `oidc-provider` and storage adapter over real HTTP, on a fully
 * migrated private PGlite. Nothing about the protocol is mocked — only
 * the optional Redis session cache and the security-event recorder.
 *
 * Bootstrapped the way `main.ts` does it where it matters to this code:
 * `rawBody: true`, the same global-prefix exclusions, cookie parsing and
 * the global exception filter.
 */

export const WEB_URL = 'http://localhost:3000';

export interface TestPerson {
  userId: string;
  workspaceId: string;
  email: string;
  /** `Cookie` header value for a signed-in browser (session + CSRF). */
  cookie: string;
  csrf: string;
}

export interface OAuthTestApp {
  app: INestApplication;
  pg: PGlite;
  db: DrizzleDb;
  base: string;
  resource: string;
  securityEvents: { record: ReturnType<typeof vi.fn> };
  /** The real action service the tools call, over the same database. */
  actions: ActionsService;
  /**
   * Every job the API handed to a queue. Nothing consumes them: a job
   * here is the only way mail could change, so an empty list is "no
   * mail was touched".
   */
  queued: { label: unknown[]; unsubscribe: unknown[] };
  /** Make the next queue adds fail, as a Redis outage would. */
  queueDown(down: boolean): void;
  person(email: string, mailboxes?: string[]): Promise<TestPerson>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function createOAuthTestApp(
  options: { rateLimit?: boolean } = {},
): Promise<OAuthTestApp> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
  vi.stubEnv('JWT_REFRESH_SECRET', 'synthetic-refresh-secret-for-local-test-only');
  vi.stubEnv('API_URL', base);
  vi.stubEnv('WEB_URL', WEB_URL);
  vi.stubEnv('MCP_ENABLED', 'true');
  // The unsubscribe pipeline refuses to queue a send unless this is on.
  vi.stubEnv('UNSUB_SEND_ENABLED', 'true');

  const pg = await freshTestPglite();
  const db = drizzle(pg, { schema }) as unknown as DrizzleDb;
  const jwt = new JwtService();
  const cache = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  const sessions = new SessionsService(db, cache as unknown as Redis, jwt);
  const csrf = new CsrfService();
  const mailboxes = new MailboxAccountsService(
    ...([db, {}, { stopMailbox: async () => undefined }, {}] as unknown as ConstructorParameters<
      typeof MailboxAccountsService
    >),
  );
  const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };

  // The connector's tools over the REAL services, the way `McpModule`
  // wires them. Only the queues are fakes: they record what was added.
  const queued = { label: [] as unknown[], unsubscribe: [] as unknown[] };
  let queueIsDown = false;
  const fakeQueue = (sink: unknown[]) => ({
    add: async (_name: string, data: unknown) => {
      if (queueIsDown) throw new Error('queue is down');
      sink.push(data);
    },
    getJob: async () => null,
  });
  const entitlements = new EntitlementsService(db);
  const actions = new ActionsService(
    ...([
      db,
      fakeQueue(queued.label),
      undefined,
      fakeQueue(queued.unsubscribe),
      entitlements,
    ] as unknown as ConstructorParameters<typeof ActionsService>),
  );
  const sync = new SyncService(
    ...([{}, {}, db] as unknown as ConstructorParameters<typeof SyncService>),
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [
      OAuthProtocolController,
      OAuthConsentController,
      OAuthGrantsController,
      McpController,
      ActionPreviewsController,
    ],
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: JwtService, useValue: jwt },
      { provide: SessionsService, useValue: sessions },
      { provide: CsrfService, useValue: csrf },
      { provide: MailboxAccountsService, useValue: mailboxes },
      { provide: SecurityEventsService, useValue: securityEvents },
      { provide: ActionsService, useValue: actions },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: SyncService, useValue: sync },
      { provide: SendersReadService, useValue: new SendersReadService(db) },
      { provide: SendersPolicyService, useValue: new SendersPolicyService(db) },
      { provide: UndoService, useValue: new UndoService(db) },
      {
        provide: TOKEN_BUCKET_STORE,
        useValue: options.rateLimit ? new InMemoryTokenBucketStore() : null,
      },
      ActionPreviewsService,
      McpToolsService,
      McpServerService,
      McpRateLimitGuard,
      OAuthProviderService,
      OAuthConsentService,
      CsrfGuard,
      JwtGuard,
      McpEnabledGuard,
      McpTokenGuard,
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api', { exclude: [...MCP_ROOT_ROUTES] });
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Off by default: a whole spec file comes from one address, and its
  // registrations would otherwise share (and exhaust) one real bucket.
  if (options.rateLimit) {
    app.useGlobalInterceptors(
      new RateLimitInterceptor(new Reflector(), new InMemoryTokenBucketStore()),
    );
  }
  await app.listen(port, '127.0.0.1');

  return {
    app,
    pg,
    db,
    base,
    resource: `${base}/mcp`,
    securityEvents,
    actions,
    queued,
    queueDown(down) {
      queueIsDown = down;
    },
    async person(email, mailboxEmails = [email]) {
      const [workspace] = await db.insert(workspaces).values({ name: email }).returning();
      const [user] = await db
        .insert(users)
        .values({ workspaceId: workspace!.id, email })
        .returning();
      for (const address of mailboxEmails) {
        await db.insert(mailboxAccounts).values({
          workspaceId: workspace!.id,
          userId: user!.id,
          provider: 'gmail',
          providerAccountId: address,
        });
      }
      const issued = await sessions.issue({
        userId: user!.id,
        workspaceId: workspace!.id,
        ipAddress: null,
        userAgent: null,
      });
      const token = csrf.issue();
      return {
        userId: user!.id,
        workspaceId: workspace!.id,
        email,
        cookie: `dm_access=${issued.tokens.accessToken}; dm_csrf=${token}`,
        csrf: token,
      };
    },
    async close() {
      await app.close();
      await pg.close();
      vi.unstubAllEnvs();
    },
  };
}

export interface HttpResult {
  status: number;
  headers: Headers;
  location: string | null;
  text: string;
  /** The parsed body, loose on purpose: specs assert on it field by field. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test harness; every use is an assertion
  json: any;
}

/**
 * One browser: a cookie jar that honours `Path`, never follows a
 * redirect on its own, and can carry a DeclutrMail session.
 */
export class Browser {
  private readonly jar = new Map<string, { value: string; path: string }>();

  constructor(
    private readonly base: string,
    private readonly person?: TestPerson,
  ) {}

  /** The jar's cookies a browser would send to `url` (no session cookies). */
  cookiesFor(url: string): string {
    const path = new URL(url, this.base).pathname;
    return [...this.jar]
      .filter(([, cookie]) => path.startsWith(cookie.path))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join('; ');
  }

  private cookieHeader(url: string): string {
    const scoped = this.cookiesFor(url);
    return [...(this.person ? [this.person.cookie] : []), ...(scoped ? [scoped] : [])].join('; ');
  }

  async request(url: string, init: RequestInit = {}): Promise<HttpResult> {
    const target = new URL(url, this.base).href;
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader(target);
    if (cookie) headers.set('cookie', cookie);
    if (this.person && init.method && init.method !== 'GET') {
      headers.set('x-csrf-token', this.person.csrf);
    }
    const response = await fetch(target, { ...init, headers, redirect: 'manual' });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = setCookie.split('; ');
      const [name, ...value] = pair!.split('=');
      const path =
        attributes.find((a) => a.toLowerCase().startsWith('path='))?.slice('path='.length) ?? '/';
      if (/expires=Thu, 01 Jan 1970/i.test(setCookie)) this.jar.delete(name!);
      else this.jar.set(name!, { value: value.join('='), path });
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get('location'),
      text,
      json,
    };
  }

  get(url: string): Promise<HttpResult> {
    return this.request(url);
  }

  post(url: string): Promise<HttpResult> {
    return this.request(url, { method: 'POST' });
  }
}

/** A machine client: no cookies, form or JSON bodies. */
export function client(base: string) {
  const send = async (path: string, init: RequestInit): Promise<HttpResult> =>
    new Browser(base).request(path, init);
  return {
    json: (path: string, body: unknown) =>
      send(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    form: (path: string, body: Record<string, string>) =>
      send(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      }),
    get: (path: string, headers: Record<string, string> = {}) => send(path, { headers }),
    /** An authenticated MCP call; by default the smallest valid one. */
    bearer: (
      path: string,
      token: string,
      body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    ) =>
      send(path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify(body),
      }),
  };
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export const REDIRECT_URI = 'https://client.example/callback';

/** Register a client the way an MCP client does. Returns its `client_id`. */
export async function registerClient(
  base: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const response = await client(base).json('/oauth/register', {
    client_name: 'Test Assistant',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...metadata,
  });
  if (response.status !== 201) {
    throw new Error(`registration failed: ${response.status} ${response.text}`);
  }
  return response.json.client_id as string;
}

export function authorizeUrl(
  clientId: string,
  challenge: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const params: Record<string, string | undefined> = {
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    scope: 'read cleanup',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  return `/oauth/authorize?${query.toString()}`;
}

/**
 * Walk a signed-in browser from `/oauth/authorize` to the consent page.
 * Returns the request id and the API paths the page calls.
 */
export async function reachConsent(browser: Browser, url: string) {
  const authorize = await browser.get(url);
  if (authorize.status !== 303 || !authorize.location?.startsWith('/api/oauth/interactions/')) {
    throw new Error(`authorize did not reach consent: ${authorize.status} ${authorize.location}`);
  }
  const hop = await browser.get(authorize.location);
  const requestId = authorize.location.split('/').pop()!;
  return { requestId, hop, path: authorize.location };
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** The whole happy path: register → authorize → approve → exchange. */
export async function connect(
  harness: OAuthTestApp,
  person: TestPerson,
  options: { scope?: string; clientId?: string } = {},
): Promise<{ clientId: string; tokens: TokenSet; code: string; requestId: string }> {
  const clientId = options.clientId ?? (await registerClient(harness.base));
  const proof = pkce();
  const browser = new Browser(harness.base, person);
  const { requestId, path } = await reachConsent(
    browser,
    authorizeUrl(clientId, proof.challenge, options.scope ? { scope: options.scope } : {}),
  );
  const approved = await browser.post(`${path}/approve`);
  if (approved.status !== 200)
    throw new Error(`approve failed: ${approved.status} ${approved.text}`);
  const resumed = await browser.get(approved.json.data.redirectTo);
  const code = new URL(resumed.location!).searchParams.get('code');
  if (!code) throw new Error(`no code issued: ${resumed.status} ${resumed.location}`);
  const exchanged = await client(harness.base).form('/oauth/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: proof.verifier,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
  });
  if (exchanged.status !== 200) {
    throw new Error(`exchange failed: ${exchanged.status} ${exchanged.text}`);
  }
  return { clientId, tokens: exchanged.json as TokenSet, code, requestId };
}
