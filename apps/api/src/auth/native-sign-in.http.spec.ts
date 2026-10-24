import { createHash, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PGlite } from '@electric-sql/pglite';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import {
  activeSessions,
  mailboxAccounts,
  nativeAuthTickets,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { parseNativeReturnUrl } from '@declutrmail/shared/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { InboxLimitGuard } from '../common/entitlements/inbox-limit.guard.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { SecurityEventsService } from '../security-events/security-events.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthSignupOrchestrator } from './auth-signup.orchestrator.js';
import { CsrfGuard } from './csrf.guard.js';
import { CsrfService } from './csrf.service.js';
import { GoogleOAuthController } from './google-oauth.controller.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { JwtGuard } from './jwt.guard.js';
import { JwtService } from './jwt.service.js';
import { NativeAuthController } from './native-auth.controller.js';
import { NativeAuthService } from './native-auth.service.js';
import { SessionsService } from './sessions.service.js';

// The native sign-in handoff over real HTTP (ADR-0049): a real Nest app, real
// JWT / session / ticket services and a migrated PGlite. Only Google and the
// Gmail side effects are replaced. What each case proves is stated in its name.

const WEB = 'https://app.declutrmail.test';
const API = 'https://api.declutrmail.test';
const APP_LINK = /com\.declutrmail\.app:\/\/auth\/return\?[^"]+/;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

describe('native sign-in handoff', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  let sessions: SessionsService;
  let userId: string;
  let workspaceId: string;
  let identity = 'owner@gmail.com';
  const audit: Array<{ eventType: string; payload?: Record<string, unknown> }> = [];
  const addMailbox = vi.fn();

  beforeAll(async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'native-signin-http-access-secret-local-only');
    vi.stubEnv('JWT_REFRESH_SECRET', 'native-signin-http-refresh-secret-local-only');
    vi.stubEnv('WEB_URL', WEB);
    vi.stubEnv('API_URL', API);
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
    const realDb = db as unknown as DrizzleDb;
    jwt = new JwtService();
    sessions = new SessionsService(realDb, null, jwt);
    const forbidden = new Proxy(
      {},
      {
        get: (_target, key) => {
          throw new Error(`Unexpected Gmail side effect: ${String(key)}`);
        },
      },
    );
    const mailboxes = new MailboxAccountsService(
      ...([realDb, forbidden, forbidden, forbidden] as unknown as ConstructorParameters<
        typeof MailboxAccountsService
      >),
    );
    const csrf = new CsrfService();
    const real = new AuthSignupOrchestrator(
      ...([
        realDb,
        new UsersService(realDb),
        mailboxes,
        forbidden,
        forbidden,
        forbidden,
        sessions,
        csrf,
      ] as unknown as ConstructorParameters<typeof AuthSignupOrchestrator>),
    );
    // Sign-in is the real orchestrator; connect and addMailbox touch Gmail, so
    // they are stand-ins that still create a REAL session row to hand off.
    const orchestrator = {
      signIn: real.signIn.bind(real),
      connect: async (input: { ipAddress: string | null; userAgent: string | null }) => {
        const issued = await sessions.issue({ userId, workspaceId, ...input });
        return {
          tokens: issued.tokens,
          csrfToken: csrf.issue(),
          sessionId: issued.sessionId,
          user: { id: userId, workspaceId, email: identity },
          mailbox: { id: 'mb' },
          isNewSignup: true,
          onboardingComplete: false,
        };
      },
      addMailbox,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [GoogleOAuthController, NativeAuthController],
      providers: [
        { provide: DRIZZLE, useValue: realDb },
        { provide: JwtService, useValue: jwt },
        { provide: SessionsService, useValue: sessions },
        { provide: MailboxAccountsService, useValue: mailboxes },
        { provide: AuthSignupOrchestrator, useValue: orchestrator },
        {
          provide: GoogleOAuthService,
          useValue: {
            getSignInUrl: (nonce: string) => `https://accounts.google.test/sign-in?state=${nonce}`,
            getConsentUrl: (nonce: string) => `https://accounts.google.test/consent?state=${nonce}`,
            exchangeSignInCode: async () => ({ email: identity }),
            exchangeCode: async () => ({ email: 'person@gmail.com', refreshToken: 'rt' }),
          },
        },
        {
          provide: SecurityEventsService,
          useValue: { record: async (event: (typeof audit)[number]) => void audit.push(event) },
        },
        { provide: EntitlementsService, useValue: { assertCanConnectMailbox: async () => {} } },
        NativeAuthService,
        { provide: CsrfService, useValue: csrf },
        CsrfGuard,
        JwtGuard,
        InboxLimitGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();

    const [workspace] = await db.insert(workspaces).values({ name: 'Native fixture' }).returning();
    workspaceId = workspace!.id;
    const [user] = await db
      .insert(users)
      .values({ workspaceId, email: 'owner@gmail.com', onboardedAt: new Date() })
      .returning();
    userId = user!.id;
    await db.insert(mailboxAccounts).values({
      workspaceId,
      userId,
      provider: 'gmail',
      providerAccountId: 'owner@gmail.com',
    });
  });

  beforeEach(async () => {
    audit.length = 0;
    addMailbox.mockReset();
    identity = 'owner@gmail.com';
    await db.delete(nativeAuthTickets);
    await db.delete(activeSessions);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.close();
    vi.unstubAllEnvs();
  });

  // --- helpers --------------------------------------------------------------

  const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
  const sessionCookies = (res: Response): string[] =>
    cookiesOf(res).filter((c) => /^dm_(access|refresh|csrf)=/.test(c));

  /** GET a start route and return the state cookie to replay on the callback. */
  async function begin(path: string) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    const cookie = cookiesOf(res).find((c) => c.startsWith('oauth_state'));
    const location = res.headers.get('location');
    const state = location ? new URL(location).searchParams.get('state') : null;
    return { res, location, state, cookie: cookie?.split(';')[0] };
  }

  async function callback(cookie: string | undefined, query: Record<string, string>) {
    return fetch(`${base}/api/auth/google/callback?${new URLSearchParams(query)}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
    });
  }

  /** Complete native sign-in in the browser; returns the code the app would receive. */
  async function signInInBrowser(challenge: string, extra = '') {
    const start = await begin(
      `/api/auth/google/native/start?${new URLSearchParams({ challenge, intent: 'sign-in' })}${extra}`,
    );
    const res = await callback(start.cookie, { code: 'google-code', state: start.state! });
    const html = await res.text();
    const link = html.match(APP_LINK)?.[0].replaceAll('&amp;', '&');
    return { res, html, link, parsed: parseNativeReturnUrl(link) };
  }

  const exchange = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/auth/native/exchange`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 DeclutrMailShell/1',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  // --- the handoff ----------------------------------------------------------

  it('signs in through the browser and delivers the session only to the app that proves it asked', async () => {
    const { verifier, challenge } = pkce();

    const start = await begin(
      `/api/auth/google/native/start?${new URLSearchParams({ challenge, intent: 'sign-in', returnTo: '/settings' })}`,
    );
    // The browser is sent to Google like the web flow, and the Google redirect
    // is not mistaken for a web-app redirect.
    expect(start.res.status).toBe(302);
    expect(start.location).toMatch(/^https:\/\/accounts\.google\.test\/sign-in\?state=/);
    expect(start.cookie).toBeDefined();

    const res = await callback(start.cookie, { code: 'google-code', state: start.state! });
    const html = await res.text();

    // 1. The browser gets a page, not a session: no cookie of any kind.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(sessionCookies(res)).toEqual([]);
    // 2. The page carries a code and nothing else of value.
    const link = html.match(APP_LINK)![0].replaceAll('&amp;', '&');
    const returned = parseNativeReturnUrl(link);
    expect(returned).toMatchObject({ kind: 'session' });
    const code = (returned as { code: string }).code;
    expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWT anywhere in the page
    expect(html).toContain('Open DeclutrMail');
    // 3. The ticket holds a hash, the challenge and the destination the server chose.
    const [ticket] = await db.select().from(nativeAuthTickets);
    expect(ticket).toMatchObject({
      kind: 'handoff',
      codeChallenge: challenge,
      returnTo: '/settings',
      userId,
    });
    expect(ticket!.codeHash).not.toContain(code);
    expect(ticket!.codeHash).toBe(createHash('sha256').update(code).digest('hex'));
    const [sessionBefore] = await db.select().from(activeSessions);
    expect(sessionBefore!.id).toBe(ticket!.sessionId);

    // 4. The app redeems with the verifier and gets cookies in its own WebView.
    const redeemed = await exchange({ code, verifier });
    expect(redeemed.status).toBe(201);
    expect(await redeemed.json()).toEqual({ data: { returnTo: '/settings' } });
    const names = sessionCookies(redeemed).map((c) => c.split('=')[0]);
    expect(names.sort()).toEqual(['dm_access', 'dm_csrf', 'dm_refresh']);
    const access = sessionCookies(redeemed)
      .find((c) => c.startsWith('dm_access='))!
      .split(';')[0]!
      .slice('dm_access='.length);
    const claims = await jwt.verify(access, 'access');
    expect(claims.sid).toBe(ticket!.sessionId);
    expect(await sessions.lookupByJti(claims.jti)).toMatchObject({ userId });

    // 5. Same session row, re-minted for the app: the browser's jti is dead and
    //    the live-sessions list names the app, not the browser.
    const rows = await db.select().from(activeSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jti).not.toBe(sessionBefore!.jti);
    expect(rows[0]!.jti).toBe(claims.jti);
    expect(rows[0]!.refreshTokenHash).not.toBe(sessionBefore!.refreshTokenHash);
    expect(rows[0]!.userAgent).toContain('DeclutrMailShell');
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
  });

  it('spends a code once: a replay with the right verifier is refused', async () => {
    const { verifier, challenge } = pkce();
    const { parsed } = await signInInBrowser(challenge);
    const code = (parsed as { code: string }).code;

    expect((await exchange({ code, verifier })).status).toBe(201);
    const replay = await exchange({ code, verifier });
    expect(replay.status).toBe(400);
    expect(sessionCookies(replay)).toEqual([]);
  });

  it('burns the code on a wrong verifier, so a code thief gets one guess', async () => {
    const { verifier, challenge } = pkce();
    const { parsed } = await signInInBrowser(challenge);
    const code = (parsed as { code: string }).code;

    const guess = await exchange({ code, verifier: pkce().verifier });
    expect(guess.status).toBe(400);
    expect(sessionCookies(guess)).toEqual([]);
    expect(audit.at(-1)).toMatchObject({
      eventType: 'login.failure',
      payload: { reason: 'native_verifier_mismatch' },
    });

    // The legitimate app arrives second and the code is already spent.
    expect((await exchange({ code, verifier })).status).toBe(400);
  });

  it('refuses an expired code', async () => {
    const { verifier, challenge } = pkce();
    const { parsed } = await signInInBrowser(challenge);
    await db.update(nativeAuthTickets).set({ expiresAt: new Date(Date.now() - 1_000) });

    const res = await exchange({ code: (parsed as { code: string }).code, verifier });
    expect(res.status).toBe(400);
    expect(sessionCookies(res)).toEqual([]);
  });

  it('refuses when the session was revoked before the app redeemed', async () => {
    const { verifier, challenge } = pkce();
    const { parsed } = await signInInBrowser(challenge);
    const [row] = await db.select({ id: activeSessions.id }).from(activeSessions);
    await sessions.revoke(row!.id);

    const res = await exchange({ code: (parsed as { code: string }).code, verifier });
    expect(res.status).toBe(400);
    expect(sessionCookies(res)).toEqual([]);
    expect(audit.at(-1)?.payload).toMatchObject({ reason: 'native_session_gone' });
  });

  it('does not let a cross-site form post redeem a code, and leaves the code unspent', async () => {
    const { verifier, challenge } = pkce();
    const { parsed } = await signInInBrowser(challenge);
    const code = (parsed as { code: string }).code;

    // A form post needs no CORS preflight, so the JSON requirement is the guard.
    const form = await fetch(`${base}/api/auth/native/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, verifier }),
    });
    expect(form.status).toBe(400);
    expect(sessionCookies(form)).toEqual([]);
    expect(await db.select().from(nativeAuthTickets)).toHaveLength(1);

    expect((await exchange({ code, verifier })).status).toBe(201);
  });

  it.each([
    ['no body', {}],
    ['a short code', { code: 'abc', verifier: 'v'.repeat(43) }],
    ['a short verifier', { code: 'A'.repeat(43), verifier: 'short' }],
    ['an extra field', { code: 'A'.repeat(43), verifier: 'v'.repeat(43), admin: true }],
  ])('rejects %s without touching any ticket', async (_name, body) => {
    const { challenge } = pkce();
    await signInInBrowser(challenge);
    const res = await exchange(body);
    expect(res.status).toBe(400);
    expect(await db.select().from(nativeAuthTickets)).toHaveLength(1);
  });

  it('lands a brand-new signup on onboarding, decided by the server', async () => {
    const { verifier, challenge } = pkce();
    const start = await begin(
      `/api/auth/google/native/start?${new URLSearchParams({ challenge })}`,
    );
    expect(start.location).toMatch(/\/consent\?state=/);
    const res = await callback(start.cookie, { code: 'google-code', state: start.state! });
    // The first-time branch (`connect`) and the returning branch share one tail.
    const html = await res.text();
    const parsed = parseNativeReturnUrl(html.match(APP_LINK)![0].replaceAll('&amp;', '&'));
    expect(sessionCookies(res)).toEqual([]);
    const redeemed = await exchange({ code: (parsed as { code: string }).code, verifier });
    expect(await redeemed.json()).toEqual({ data: { returnTo: '/onboarding' } });
  });

  // --- exits that carry no session -------------------------------------------

  it('returns a cancelled consent to the app as a navigation, with no ticket and no cookie', async () => {
    const { challenge } = pkce();
    const start = await begin(
      `/api/auth/google/native/start?${new URLSearchParams({ challenge, intent: 'sign-in' })}`,
    );
    const res = await callback(start.cookie, { error: 'access_denied', state: start.state! });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(sessionCookies(res)).toEqual([]);
    expect(parseNativeReturnUrl(html.match(APP_LINK)![0].replaceAll('&amp;', '&'))).toEqual({
      kind: 'navigate',
      to: '/sign-in?returning=1',
    });
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
  });

  it('returns an unknown Google account to the sign-in page with the same closed result the web shows', async () => {
    identity = 'friend@gmail.com';
    const { challenge } = pkce();
    const { link, parsed } = await signInInBrowser(challenge);

    expect(link).toBeDefined();
    expect(parsed).toMatchObject({ kind: 'navigate' });
    expect((parsed as { to: string }).to).toContain('auth_result=connect_required');
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
    expect(await db.select().from(activeSessions)).toEqual([]);
  });

  it.each([
    ['no challenge', ''],
    ['a short challenge', 'abc'],
    ['a challenge with a bad character', `${'a'.repeat(42)}=`],
  ])('answers %s by returning to the app, not by starting Google', async (_name, challenge) => {
    const res = await fetch(
      `${base}/api/auth/google/native/start?${new URLSearchParams(challenge ? { challenge } : {})}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(200);
    expect(cookiesOf(res).some((c) => c.startsWith('oauth_state'))).toBe(false);
    expect(parseNativeReturnUrl((await res.text()).match(APP_LINK)![0])).toMatchObject({
      kind: 'navigate',
    });
  });

  // --- the web flow is untouched --------------------------------------------

  it('still sets cookies and redirects on the web flow, with no ticket', async () => {
    const start = await begin(`/api/auth/google/start?intent=sign-in`);
    const res = await callback(start.cookie, { code: 'google-code', state: start.state! });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${WEB}/home`);
    expect(
      sessionCookies(res)
        .map((c) => c.split('=')[0])
        .sort(),
    ).toEqual(['dm_access', 'dm_csrf', 'dm_refresh']);
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
  });

  // --- add or recover a Gmail account from the app ---------------------------

  describe('connect from the app', () => {
    /** A signed-in app: session cookies exactly as the exchange would set them. */
    async function signedInApp() {
      const issued = await sessions.issue({
        userId,
        workspaceId,
        ipAddress: null,
        userAgent: 'app',
      });
      const csrf = 'csrf-token-for-test';
      return {
        sessionId: issued.sessionId,
        headers: {
          cookie: `dm_access=${issued.tokens.accessToken}; dm_csrf=${csrf}`,
          'x-csrf-token': csrf,
        },
      };
    }

    const urlOf = async (res: Response) =>
      ((await res.json()) as { data: { url: string } }).data.url;

    const ticketFor = (headers: Record<string, string>, query = '') =>
      fetch(`${base}/api/auth/google/native/connect-ticket${query}`, { method: 'POST', headers });

    it('requires the CSRF header: a cookie alone cannot mint a ticket', async () => {
      const app = await signedInApp();
      const res = await ticketFor({ cookie: app.headers.cookie });
      expect(res.status).toBe(403);
      expect(await db.select().from(nativeAuthTickets)).toEqual([]);
    });

    it('requires a session', async () => {
      const res = await ticketFor({});
      expect(res.status).toBe(401);
    });

    it('issues a ticket that opens the same authenticated consent in the browser, once', async () => {
      const app = await signedInApp();
      const res = await ticketFor(app.headers);
      expect(res.status).toBe(201);
      const url = await urlOf(res);
      expect(url.startsWith(`${API}/api/auth/google/native/open?ticket=`)).toBe(true);
      const [ticket] = await db.select().from(nativeAuthTickets);
      expect(ticket).toMatchObject({ kind: 'connect_start', sessionId: app.sessionId });

      // The browser has no cookies: the ticket is its only credential.
      const opened = await begin(new URL(url).pathname + new URL(url).search);
      expect(opened.res.status).toBe(302);
      expect(opened.location).toMatch(/^https:\/\/accounts\.google\.test\/consent\?state=/);
      expect(await db.select().from(nativeAuthTickets)).toEqual([]);

      // Spent: opening it again returns to the app's Settings failure result.
      const again = await fetch(url.replace(API, base), { redirect: 'manual' });
      expect(parseNativeReturnUrl((await again.text()).match(APP_LINK)![0])).toEqual({
        kind: 'navigate',
        to: '/settings?connect_start_result=failed#mailboxes',
      });

      // The consent callback adds the mailbox and returns to the app: no cookie,
      // no ticket, and the destination is the onboarding gate the web uses.
      addMailbox.mockResolvedValue({ mailboxId: 'new-mailbox-id' });
      const done = await callback(opened.cookie, { code: 'google-code', state: opened.state! });
      expect(addMailbox).toHaveBeenCalledWith(
        expect.objectContaining({ currentUserId: userId, currentWorkspaceId: workspaceId }),
      );
      expect(sessionCookies(done)).toEqual([]);
      expect(parseNativeReturnUrl((await done.text()).match(APP_LINK)![0])).toEqual({
        kind: 'navigate',
        to: '/onboarding?mailbox=new-mailbox-id',
      });
    });

    it('refuses a recovery target the browser route would refuse', async () => {
      const app = await signedInApp();
      const stranger = crypto.randomUUID();
      const res = await ticketFor(app.headers, `?reconnectMailboxId=${stranger}`);
      expect(res.status).toBe(400);
      expect(await db.select().from(nativeAuthTickets)).toEqual([]);

      const both = await ticketFor(
        app.headers,
        `?reconnectMailboxId=${stranger}&reactivateMailboxId=${stranger}`,
      );
      expect(both.status).toBe(400);
    });

    it('stops at the browser when the app session was revoked after the ticket', async () => {
      const app = await signedInApp();
      const url = await urlOf(await ticketFor(app.headers));
      await sessions.revoke(app.sessionId);

      const res = await fetch(url.replace(API, base), { redirect: 'manual' });
      expect(parseNativeReturnUrl((await res.text()).match(APP_LINK)![0])).toEqual({
        kind: 'navigate',
        to: '/settings?connect_start_result=session_retry#mailboxes',
      });
      expect(cookiesOf(res).some((c) => c.startsWith('oauth_state'))).toBe(false);
    });

    it('does not let a handoff code open a connect flow, or the reverse', async () => {
      const app = await signedInApp();
      const { challenge } = pkce();
      const { parsed } = await signInInBrowser(challenge);
      const code = (parsed as { code: string }).code;

      const opened = await fetch(`${base}/api/auth/google/native/open?ticket=${code}`, {
        redirect: 'manual',
      });
      expect(opened.status).toBe(200); // failure page, not a Google redirect
      expect(await db.select().from(nativeAuthTickets)).toHaveLength(1); // handoff untouched

      const url = await urlOf(await ticketFor(app.headers));
      const connectCode = new URL(url).searchParams.get('ticket')!;
      const exchanged = await exchange({ code: connectCode, verifier: 'v'.repeat(43) });
      expect(exchanged.status).toBe(400);
      expect(
        await db
          .select()
          .from(nativeAuthTickets)
          .where(eq(nativeAuthTickets.kind, 'connect_start')),
      ).toHaveLength(1);
    });
  });
});
