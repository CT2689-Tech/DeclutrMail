import { Controller, Get, Inject, type INestApplication, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PGlite } from '@electric-sql/pglite';
import cookieParser from 'cookie-parser';
import { drizzle } from 'drizzle-orm/pglite';
import { mailboxAccounts, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { AuthController } from './auth.controller.js';
import { CurrentUser, JwtGuard } from './jwt.guard.js';
import { JwtService } from './jwt.service.js';
import { SessionsService, type SessionPrincipal } from './sessions.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { UsersService } from '../users/users.service.js';
import { SyncService } from '../sync/sync.service.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { InMemoryTokenBucketStore } from '../common/rate-limit/in-memory-token-bucket.store.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitInterceptor } from '../common/rate-limit/rate-limit.interceptor.js';
import { correlationMiddleware } from '../common/correlation.middleware.js';
import { requestTimingMiddleware } from '../common/request-timing.middleware.js';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

// Real HTTP/Nest ordering, real JWT/session/mailbox/auth read services and a
// fully migrated private PGlite fixture. No OAuth, Gmail, external Redis or
// production credentials. Only the optional Redis cache is a controlled fake.
@Controller('performance-smoke')
class PerformanceSmokeController {
  constructor(@Inject(AuthController) private readonly auth: AuthController) {}

  @Get('me')
  @UseGuards(JwtGuard)
  me(@CurrentUser() principal: SessionPrincipal) {
    return this.auth.me(principal);
  }

  @Get('mailbox')
  @UseGuards(JwtGuard, CurrentMailboxGuard)
  @RateLimit('triage-load')
  mailbox(@CurrentMailbox() mailbox: { id: string }) {
    return { data: mailbox, meta: {} };
  }
}

describe('shared request performance HTTP smoke', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: INestApplication;
  let base: string;
  let sessions: SessionsService;
  let cookie: string;
  let sessionId: string;
  let sessionOwner: { userId: string; workspaceId: string };
  let mailboxId: string;
  let otherMailboxId: string;
  let log: ReturnType<typeof vi.spyOn>;
  const cache = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
  };

  beforeAll(async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'synthetic-access-secret-for-local-test-only');
    vi.stubEnv('JWT_REFRESH_SECRET', 'synthetic-refresh-secret-for-local-test-only');
    vi.stubEnv('HTTP_PERFORMANCE_SAMPLE_RATE', '1');
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
    const realDb = db as unknown as DrizzleDb;
    const jwt = new JwtService();
    sessions = new SessionsService(realDb, cache as unknown as Redis, jwt);
    const mailboxes = new MailboxAccountsService(
      ...([realDb, {}, {}, {}] as unknown as ConstructorParameters<typeof MailboxAccountsService>),
    );
    const sync = new SyncService(
      ...([null, null, realDb] as unknown as ConstructorParameters<typeof SyncService>),
    );
    const auth = new AuthController(
      ...([
        sessions,
        jwt,
        {},
        new UsersService(realDb),
        mailboxes,
        sync,
        new EntitlementsService(realDb),
      ] as unknown as ConstructorParameters<typeof AuthController>),
    );
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Performance smoke' })
      .returning();
    const [user] = await db
      .insert(users)
      .values({
        workspaceId: workspace!.id,
        email: 'performance-smoke@example.test',
      })
      .returning();
    const [mailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'performance-smoke@example.test',
      })
      .returning();
    const [otherWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'Other workspace' })
      .returning();
    const [otherUser] = await db
      .insert(users)
      .values({
        workspaceId: otherWorkspace!.id,
        email: 'other-smoke@example.test',
      })
      .returning();
    const [otherMailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: otherWorkspace!.id,
        userId: otherUser!.id,
        provider: 'gmail',
        providerAccountId: 'other-smoke@example.test',
      })
      .returning();
    mailboxId = mailbox!.id;
    otherMailboxId = otherMailbox!.id;
    sessionOwner = { userId: user!.id, workspaceId: workspace!.id };
    const issued = await sessions.issue({
      ...sessionOwner,
      ipAddress: null,
      userAgent: null,
    });
    cookie = `dm_access=${issued.tokens.accessToken}`;
    sessionId = issued.sessionId;
    const moduleRef = await Test.createTestingModule({
      controllers: [PerformanceSmokeController],
      providers: [
        { provide: AuthController, useValue: auth },
        { provide: JwtService, useValue: jwt },
        { provide: SessionsService, useValue: sessions },
        { provide: MailboxAccountsService, useValue: mailboxes },
        JwtGuard,
        CurrentMailboxGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.use(correlationMiddleware);
    app.use(requestTimingMiddleware);
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(
      new RateLimitInterceptor(new Reflector(), new InMemoryTokenBucketStore()),
    );
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(() => {
    vi.stubEnv('HTTP_PERFORMANCE_SAMPLE_RATE', '1');
    cache.get.mockReset();
    log.mockClear();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.close();
    log?.mockRestore();
    vi.unstubAllEnvs();
  });

  const request = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/performance-smoke/${path}`, { headers: { cookie, ...headers } });
  const timing = () =>
    (log.mock.calls as unknown[][])
      .map(([line]): { kind?: string; operations: Record<string, { durationMs: number }> } => {
        try {
          return JSON.parse(String(line));
        } catch {
          return { operations: {} };
        }
      })
      .find((line) => line.kind === 'http.request')!;

  it('returns the real auth envelope with guarded read timings and no fixture data in metrics', async () => {
    const response = await request('me');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        activeMailboxId: mailboxId,
        tier: 'free',
        cleanupRemaining: 50,
        mailboxes: [{ id: mailboxId, readiness: null, needsReconnect: false }],
      },
    });
    const line = timing();
    for (const name of [
      'auth.jwt',
      'auth.session',
      'auth.session-cache',
      'auth.session-row',
      'auth.profile',
      'auth.mailboxes',
      'auth.quota',
      'auth.sync-state',
    ]) {
      expect(line.operations[name]).toMatchObject({ count: 1, failures: 0 });
      expect(line.operations[name]?.durationMs).toBeGreaterThan(0);
    }
    expect(JSON.stringify(line)).not.toContain('example.test');
    expect(JSON.stringify(line)).not.toContain(mailboxId);
    expect(JSON.stringify(line)).not.toContain(cookie);
  });

  it('times actual mailbox ownership and rate limiting and rejects an unowned header', async () => {
    const response = await request('mailbox', { 'x-active-mailbox-id': mailboxId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: mailboxId } });
    expect(timing().operations).toMatchObject({
      'mailbox.resolve': { count: 1, failures: 0 },
      'rate-limit.consume': { count: 1, failures: 0 },
    });
    log.mockClear();
    const rejected = await request('mailbox', { 'x-active-mailbox-id': otherMailboxId });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: 'MAILBOX_NOT_OWNED' } });
    expect(timing().operations['rate-limit.consume']).toBeUndefined();
    expect(JSON.stringify(timing())).not.toContain(otherMailboxId);
  });

  it('falls back to the authoritative session DB when optional Redis fails', async () => {
    // The first HTTP test warmed this process's absence hint. Expire it
    // so this test must actually exercise the optional Redis failure.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    cache.get.mockRejectedValue(new Error('Synthetic Redis outage'));
    try {
      const response = await request('me');
      expect(response.status).toBe(200);
      expect(cache.get).toHaveBeenCalledTimes(1);
      expect(timing().operations['auth.session-row']).toMatchObject({ count: 1, failures: 0 });
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps the same auth response when instrumentation is disabled', async () => {
    vi.stubEnv('HTTP_PERFORMANCE_SAMPLE_RATE', '0');
    const response = await request('me');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { activeMailboxId: mailboxId, tier: 'free' },
    });
    expect(timing()).not.toHaveProperty('operations');
  });

  it('rejects an externally revoked session on the next request despite a warm absence hint', async () => {
    const otherInstance = new SessionsService(
      db as unknown as DrizzleDb,
      cache as unknown as Redis,
      new JwtService(),
    );
    await otherInstance.revoke(sessionId);
    const response = await request('me');
    expect(response.status).toBe(401);
    expect(timing().operations['auth.session-row']).toMatchObject({ count: 1, failures: 0 });
    expect(timing().operations['auth.profile']).toBeUndefined();
  });

  it('rejects a locally revoked session without another DB query', async () => {
    const fresh = await sessions.issue({ ...sessionOwner, ipAddress: null, userAgent: null });
    const freshCookie = `dm_access=${fresh.tokens.accessToken}`;
    expect((await request('me', { cookie: freshCookie })).status).toBe(200);
    log.mockClear();
    await sessions.revoke(fresh.sessionId);
    const response = await request('me', { cookie: freshCookie });
    expect(response.status).toBe(401);
    expect(timing().operations['auth.session-cache']).toMatchObject({ count: 1, failures: 0 });
    expect(timing().operations['auth.session-row']).toBeUndefined();
    expect(timing().operations['auth.profile']).toBeUndefined();
  });
});
