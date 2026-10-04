import { type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PGlite } from '@electric-sql/pglite';
import cookieParser from 'cookie-parser';
import { drizzle } from 'drizzle-orm/pglite';
import {
  activityLog,
  mailMessages,
  senders,
  triageDecisions,
  mailboxAccounts,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { SendersController } from '../senders/senders.controller.js';
import { SendersReadService } from '../senders/senders.read-service.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';
import { ActivityController } from '../activity/activity.controller.js';
import { ActivityReadService } from '../activity/activity.read-service.js';
import { ActivitySupportBundleService } from '../activity/activity-support-bundle.service.js';
import { TriageController } from '../triage/triage.controller.js';
import { TriageReadService } from '../triage/triage.read-service.js';
import { TriageService } from '../triage/triage.service.js';
import { IconsService } from '../icons/icons.service.js';
import { JwtGuard } from './jwt.guard.js';
import { JwtService } from './jwt.service.js';
import { SessionsService } from './sessions.service.js';
import type { DrizzleDb } from '../db/db.module.js';
import { CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { InMemoryTokenBucketStore } from '../common/rate-limit/in-memory-token-bucket.store.js';
import { RateLimitInterceptor } from '../common/rate-limit/rate-limit.interceptor.js';
import { correlationMiddleware } from '../common/correlation.middleware.js';
import { requestTimingMiddleware } from '../common/request-timing.middleware.js';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';

// Real HTTP/Nest ordering, real JWT/session/mailbox/auth read services and a
// fully migrated private PGlite fixture. No OAuth, Gmail, external Redis or
// production credentials. Only the optional Redis cache is a controlled fake.
describe('read scheduling HTTP smoke', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: INestApplication;
  let base: string;
  let sessions: SessionsService;
  let cookie: string;
  let sessionOwner: { userId: string; workspaceId: string };
  let mailboxId: string;
  let otherMailboxId: string;
  let secondMailboxId: string;
  let senderId: string;
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
    const [secondMailbox] = await db
      .insert(mailboxAccounts)
      .values({
        workspaceId: user!.workspaceId,
        userId: user!.id,
        provider: 'gmail',
        providerAccountId: 'second-smoke@example.test',
      })
      .returning();
    secondMailboxId = secondMailbox!.id;
    const [sender] = await db
      .insert(senders)
      .values({
        mailboxAccountId: mailboxId,
        senderKey: 'a'.repeat(64),
        email: 'test@example.test',
        domain: 'example.test',
        displayName: 'Test sender',
        gmailCategory: 'promotions',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .returning();
    senderId = sender!.id;
    await db.insert(mailMessages).values({
      mailboxAccountId: mailboxId,
      providerMessageId: 'synthetic-message',
      providerThreadId: 'thread',
      senderKey: sender!.senderKey,
      internalDate: new Date(),
      isUnread: true,
      labelIds: ['INBOX'],
      isOutbound: false,
    });
    await db.insert(activityLog).values({
      mailboxAccountId: mailboxId,
      senderKey: sender!.senderKey,
      source: 'manual',
      action: 'keep',
      affectedCount: 1,
      occurredAt: new Date(Date.now() - 8 * 86400000),
    });
    await db.insert(triageDecisions).values({
      mailboxAccountId: mailboxId,
      senderKey: sender!.senderKey,
      verdict: 'archive',
      confidence: '0.90',
      reasoning: 'Synthetic fixture',
      generatedBy: 'template',
      expiresAt: new Date(Date.now() + 86400000),
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [SendersController, ActivityController, TriageController],
      providers: [
        { provide: JwtService, useValue: jwt },
        { provide: SessionsService, useValue: sessions },
        { provide: MailboxAccountsService, useValue: mailboxes },
        { provide: SendersReadService, useValue: new SendersReadService(realDb) },
        { provide: SendersPolicyService, useValue: {} },
        { provide: ActivityReadService, useValue: new ActivityReadService(realDb) },
        { provide: ActivitySupportBundleService, useValue: {} },
        { provide: TriageReadService, useValue: new TriageReadService(realDb) },
        { provide: TriageService, useValue: new TriageService(realDb, null) },
        { provide: IconsService, useValue: new IconsService(realDb) },
        CsrfService,
        CsrfGuard,
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

  const curl = promisify(execFile);
  async function request(path: string, mailbox = mailboxId, authenticated = true) {
    const { stdout } = await curl('curl', [
      '--silent',
      '--show-error',
      '--max-time',
      '15',
      '--write-out',
      '\n%{http_code}',
      ...(authenticated ? ['--header', `Cookie: ${cookie}`] : []),
      '--header',
      `X-Active-Mailbox-Id: ${mailbox}`,
      `${base}/api/${path}`,
    ]);
    const boundary = stdout.lastIndexOf('\n');
    return {
      status: Number(stdout.slice(boundary + 1)),
      body: JSON.parse(stdout.slice(0, boundary)),
    };
  }
  function timing() {
    return (log.mock.calls as unknown[][])
      .map(([line]) => {
        try {
          return JSON.parse(String(line));
        } catch {
          return null;
        }
      })
      .find((line) => line?.kind === 'http.request');
  }

  it.each(['senders', 'activity?window=all', 'triage/bootstrap'])(
    'serves %s through actual guards, controller, SQL reads and batched marks',
    async (path) => {
      const result = await request(path);
      expect(result.status).toBe(200);
      expect(result.body.error).toBeUndefined();
      expect(result.body.data).toBeDefined();
      if (!path.startsWith('triage')) expect(result.body.meta.pagination).toBeDefined();
      const rows = path.startsWith('triage') ? result.body.data.queue : result.body.data;
      expect(rows).toHaveLength(1);
      if (path.startsWith('activity'))
        expect(rows[0].sender).toMatchObject({ domain: 'example.test', brandMark: false });
      else expect(rows[0]).toMatchObject({ brandMark: false });
      if (path === 'senders') expect(result.body.meta.query).toMatchObject({ totalMatching: 1 });
      if (path.startsWith('triage'))
        expect(result.body.data.todaySummary).toMatchObject({
          queuedDecisions: 1,
          noiseSenderCount: 1,
        });
      expect(timing()).toMatchObject({ status: 200, kind: 'http.request' });
      expect(timing().operations['mailbox.resolve']).toMatchObject({ failures: 0 });
      expect(JSON.stringify(timing())).not.toContain(cookie);
      expect(JSON.stringify(timing())).not.toContain(senderId);
    },
  );

  it.each(['senders', 'activity?window=all', 'triage/bootstrap'])(
    'keeps empty, switched and unowned mailbox states isolated on %s',
    async (path) => {
      const empty = await request(path, secondMailboxId);
      expect(empty.status).toBe(200);
      expect(path.startsWith('triage') ? empty.body.data.queue : empty.body.data).toEqual([]);
      const foreign = await request(path, otherMailboxId);
      expect(foreign.status).toBe(409);
      expect(foreign.body.error.code).toBe('MAILBOX_NOT_OWNED');
      const unauthenticated = await request(path, mailboxId, false);
      expect(unauthenticated.status).toBe(401);
    },
  );

  it('preserves disconnected and no-active mailbox conflict states', async () => {
    await db
      .update(mailboxAccounts)
      .set({ status: 'disconnected' })
      .where(eq(mailboxAccounts.id, secondMailboxId));
    try {
      const result = await request('triage/bootstrap', secondMailboxId);
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe('MAILBOX_NOT_OWNED');
      await db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.id, mailboxId));
      const noneActive = await request('triage/bootstrap', secondMailboxId);
      expect(noneActive.status).toBe(409);
      expect(noneActive.body.error.code).toBe('NO_ACTIVE_MAILBOX');
    } finally {
      await db
        .update(mailboxAccounts)
        .set({ status: 'active' })
        .where(eq(mailboxAccounts.id, mailboxId));
      await db
        .update(mailboxAccounts)
        .set({ status: 'active' })
        .where(eq(mailboxAccounts.id, secondMailboxId));
    }
  });
});
