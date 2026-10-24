import { PGlite } from '@electric-sql/pglite';
import {
  activeSessions,
  mailboxAccounts,
  providerSyncState,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { UsersService } from '../users/users.service.js';
import type { SecurityEventsService } from '../security-events/security-events.service.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { CsrfService } from './csrf.service.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import type { GoogleOAuthService } from './google-oauth.service.js';
import { JwtService } from './jwt.service.js';
import { NativeAuthService } from './native-auth.service.js';
import { SessionsService } from './sessions.service.js';

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let jwt: JwtService;
let sessions: SessionsService;
let controller: GoogleOAuthController;
let identity = 'disconnected@gmail.com';
let userId: string;
let mailboxId: string;
const forbidden = new Proxy(
  {},
  {
    get: (_target, key) => {
      throw new Error(`Unexpected Gmail side effect: ${String(key)}`);
    },
  },
);
beforeAll(async () => {
  vi.stubEnv('JWT_ACCESS_SECRET', 'returning-signin-local-access-secret-only');
  vi.stubEnv('JWT_REFRESH_SECRET', 'returning-signin-local-refresh-secret-only');
  pg = await freshTestPglite();
  db = drizzle(pg, { schema });
  const realDb = db as unknown as DrizzleDb;
  jwt = new JwtService();
  sessions = new SessionsService(realDb, null, jwt);
  const mailboxes = new MailboxAccountsService(
    ...([realDb, forbidden, forbidden, forbidden] as unknown as ConstructorParameters<
      typeof MailboxAccountsService
    >),
  );
  const usersService = new UsersService(realDb);
  const orchestrator = new AuthSignupOrchestrator(
    ...([
      realDb,
      usersService,
      mailboxes,
      forbidden,
      forbidden,
      forbidden,
      sessions,
      new CsrfService(),
    ] as unknown as ConstructorParameters<typeof AuthSignupOrchestrator>),
  );
  controller = new GoogleOAuthController(
    {
      getSignInUrl: (nonce: string) => `https://accounts.google.test/sign-in?state=${nonce}`,
      exchangeSignInCode: async () => ({ email: identity }),
    } as unknown as GoogleOAuthService,
    orchestrator,
    { record: async () => undefined } as unknown as SecurityEventsService,
    mailboxes,
    jwt,
    sessions,
    new NativeAuthService(realDb),
  );
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Identity-only login fixture' })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: workspace!.id,
      email: 'owner@gmail.com',
      preferences: { activeMailboxId: null },
    })
    .returning();
  userId = user!.id;
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId,
      provider: 'gmail',
      providerAccountId: 'disconnected@gmail.com',
      status: 'disconnected',
    })
    .returning();
  mailboxId = mailbox!.id;
  await db.insert(providerSyncState).values({
    mailboxAccountId: mailboxId,
    readinessStatus: 'failed',
    lastHistoryId: 123456789n,
  });
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});

it('completes signed start → callback → persisted session for a disconnected secondary, preserving its failed scan and saved cursor', async () => {
  const beforeMailbox = await db.select().from(mailboxAccounts);
  const beforeSync = await db.select().from(providerSyncState);
  const beforeUsers = await db.select().from(users);
  const res = { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };
  await controller.start(
    { cookies: {} } as Request,
    res as unknown as Response,
    '/settings?cancelDeletion=1',
    undefined,
    'sign-in',
  );
  const [name, cookie] = res.cookie.mock.calls[0]!;
  const nonce = new URL(res.redirect.mock.calls[0]![1]).searchParams.get('state')!;
  await controller.callback(
    { cookies: { [name]: cookie }, headers: {} } as unknown as Request,
    res as unknown as Response,
    'identity-code',
    nonce,
  );
  expect(res.redirect).toHaveBeenLastCalledWith(
    302,
    `${process.env.WEB_URL ?? 'http://localhost:3000'}/settings?cancelDeletion=1`,
  );
  const access = res.cookie.mock.calls.find(([name]) => name === 'dm_access')![1] as string;
  const claims = await jwt.verify(access, 'access');
  expect(claims.sub).toBe(userId);
  expect(await sessions.lookupByJti(claims.jti)).toMatchObject({ userId });
  expect(await db.select().from(activeSessions)).toHaveLength(1);
  expect(await db.select().from(mailboxAccounts)).toEqual(beforeMailbox);
  expect(await db.select().from(providerSyncState)).toEqual(beforeSync);
  expect(await db.select().from(users)).toEqual(beforeUsers);
  expect(res.cookie.mock.calls.find(([name]) => name === 'dm_csrf')![1]).toMatch(
    /^[A-Za-z0-9_-]+$/,
  );
  identity = 'oneshot@gmail.com';
  const unknownRes = { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };
  await controller.start(
    { cookies: {} } as Request,
    unknownRes as unknown as Response,
    '/billing?plan=pro&cycle=annual',
    undefined,
    'sign-in',
  );
  const [unknownName, unknownCookie] = unknownRes.cookie.mock.calls[0]!;
  const unknownNonce = new URL(unknownRes.redirect.mock.calls[0]![1]).searchParams.get('state')!;
  await controller.callback(
    { cookies: { [unknownName]: unknownCookie }, headers: {} } as unknown as Request,
    unknownRes as unknown as Response,
    'unknown-code',
    unknownNonce,
  );
  const result = new URL(unknownRes.redirect.mock.calls.at(-1)![1]);
  expect(result.searchParams.get('auth_result')).toBe('connect_required');
  expect(result.searchParams.get('returnTo')).toBe('/billing?plan=pro&cycle=annual');
  expect(await db.select().from(activeSessions)).toHaveLength(1);
  expect(await db.select().from(users)).toEqual(beforeUsers);
  expect(await db.select().from(mailboxAccounts)).toEqual(beforeMailbox);
  expect(await db.select().from(providerSyncState)).toEqual(beforeSync);
});
