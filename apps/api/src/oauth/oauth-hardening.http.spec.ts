import { request as httpRequest } from 'node:http';
import { createServer, type Server } from 'node:net';

import { eq } from 'drizzle-orm';
import { errors } from 'oidc-provider';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  accountDeletionRequests,
  mailboxAccounts,
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthInteractions,
  oauthTokens,
} from '@declutrmail/db';

import { OAuthProviderService } from './oauth-provider.service.js';
import {
  Browser,
  REDIRECT_URI,
  authorizeUrl,
  client,
  connect,
  createOAuthTestApp,
  pkce,
  reachConsent,
  registerClient,
  type OAuthTestApp,
  type TestPerson,
} from './oauth-test-harness.js';

/**
 * What two adversarial reviews of the authorization server found, each
 * pinned by the request that showed it (ADR-0048 rule 4). Same harness
 * as `oauth-flow.http.spec.ts`: real HTTP, the real library and storage
 * adapter, a migrated PGlite.
 */
describe('OAuth authorization server — hardening', () => {
  let harness: OAuthTestApp;
  let ada: TestPerson;
  let grace: TestPerson;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
    api = client(harness.base);
    ada = await harness.person('ada@example.test', ['ada@example.test', 'ada.work@example.test']);
    grace = await harness.person('grace@example.test');
  });

  afterEach(async () => {
    await harness.db.delete(oauthGrants);
    await harness.db.delete(accountDeletionRequests);
    harness.securityEvents.record.mockClear();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Approve a fresh request as `person`; returns what a resume needs. */
  async function approved(person: TestPerson, clientId?: string) {
    const id = clientId ?? (await registerClient(harness.base));
    const proof = pkce();
    const browser = new Browser(harness.base, person);
    const { path } = await reachConsent(browser, authorizeUrl(id, proof.challenge));
    const approve = await browser.post(`${path}/approve`);
    expect(approve.status).toBe(200);
    const resumeUrl = approve.json.data.redirectTo as string;
    return { clientId: id, proof, browser, path, resumeUrl };
  }

  const outcome = (location: string | null) => {
    const redirect = new URL(location!);
    return {
      target: redirect.origin + redirect.pathname,
      code: redirect.searchParams.get('code'),
      error: redirect.searchParams.get('error'),
    };
  };

  describe('malformed input is refused, never a 500', () => {
    it.each([
      [
        'a null client_id at the token endpoint',
        () =>
          api.form('/oauth/token', {
            grant_type: 'authorization_code',
            code: 'x',
            code_verifier: 'y',
            client_id: '\u0000',
          }),
      ],
      [
        'a null client_id at the revocation endpoint',
        () => api.form('/oauth/revoke', { token: 'x', client_id: '\u0000' }),
      ],
      [
        'a null client_id at the authorization endpoint',
        () => api.get('/oauth/authorize?client_id=%00abc&response_type=code'),
      ],
      [
        'a null character in a registered name',
        () =>
          api.json('/oauth/register', { client_name: 'a\u0000b', redirect_uris: [REDIRECT_URI] }),
      ],
    ])('%s', async (_label, send) => {
      const response = await send();
      expect(response.status).toBe(400);
      expect(response.json.error).toBe('invalid_request');
    });

    it('a null character in any authorization parameter parks no request', async () => {
      const clientId = await registerClient(harness.base);
      const before = (await harness.db.select().from(oauthInteractions)).length;
      const response = await new Browser(harness.base, ada).get(
        `${authorizeUrl(clientId, pkce().challenge)}&state=a%00b`,
      );
      expect(response.status).toBe(400);
      expect(await harness.db.select().from(oauthInteractions)).toHaveLength(before);
    });

    it('refuses a body larger than any request here needs, and stores nothing', async () => {
      const before = (await harness.db.select().from(oauthClients)).length;
      const response = await api.json('/oauth/register', {
        redirect_uris: [REDIRECT_URI],
        client_name: 'x'.repeat(9_000),
      });
      expect(response.status).toBe(413);
      expect(await harness.db.select().from(oauthClients)).toHaveLength(before);
    });

    it.each([
      ['an unpaired surrogate', 'Assist\ud800ant', 'Assistant'],
      [
        'a name cut at 80 characters, not mid-character',
        `${'a'.repeat(79)}😀tail`,
        `${'a'.repeat(79)}😀`,
      ],
      ['a text-direction override', 'Claude‮⁦ evil', 'Claude evil'],
      ['a newline and a tab', 'Clau\nde\tAI', 'ClaudeAI'],
    ])('stores a readable name for %s', async (_label, sent, stored) => {
      const response = await api.json('/oauth/register', {
        client_name: sent,
        redirect_uris: [REDIRECT_URI],
      });
      expect(response.status).toBe(201);
      expect(response.json.client_name).toBe(stored);
      const [row] = await harness.db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, response.json.client_id));
      expect(row!.clientName).toBe(stored);
    });
  });

  describe('registration keeps only what this server uses', () => {
    let listener: Server;
    let connections = 0;
    let port = 0;

    beforeAll(async () => {
      listener = createServer((socket) => {
        connections += 1;
        socket.destroy();
      });
      await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const address = listener.address();
      port = typeof address === 'object' && address ? address.port : 0;
    });

    afterAll(async () => {
      await new Promise((resolve) => listener.close(resolve));
    });

    it('drops every other field, and never fetches a URL a caller supplied', async () => {
      const mine = `https://127.0.0.1:${port}/x`;
      const response = await api.json('/oauth/register', {
        client_name: 'Probe',
        redirect_uris: [REDIRECT_URI],
        sector_identifier_uri: mine,
        jwks_uri: mine,
        initiate_login_uri: mine,
        client_uri: mine,
        logo_uri: mine,
        policy_uri: mine,
        tos_uri: mine,
        contacts: ['someone@example.test'],
        scope: 'claudeai',
      });
      expect(response.status).toBe(201);
      const [row] = await harness.db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, response.json.client_id));
      for (const key of [
        'sector_identifier_uri',
        'jwks_uri',
        'initiate_login_uri',
        'client_uri',
        'logo_uri',
        'policy_uri',
        'tos_uri',
        'contacts',
        'scope',
        'client_secret',
      ]) {
        expect(response.json, key).not.toHaveProperty(key);
        expect(row!.metadata, key).not.toHaveProperty(key);
      }
      // Loading the stored client must not reach out either.
      const browser = new Browser(harness.base, ada);
      await reachConsent(browser, authorizeUrl(response.json.client_id, pkce().challenge));
      expect(connections).toBe(0);
    });

    it.each([
      [
        'more redirect URIs than any app needs',
        Array.from({ length: 11 }, (_, i) => `https://client.example/cb${i}`),
      ],
      ['a redirect URI longer than 255 characters', [`https://client.example/${'a'.repeat(240)}`]],
      ['a control character in a redirect URI', ['https://client.example/cb\u0007']],
    ])('refuses %s', async (_label, uris) => {
      const before = (await harness.db.select().from(oauthClients)).length;
      const response = await api.json('/oauth/register', { redirect_uris: uris });
      expect(response.status).toBe(400);
      expect(response.json.error).toBe('invalid_redirect_uri');
      expect(await harness.db.select().from(oauthClients)).toHaveLength(before);
    });

    it('still accepts the most redirect URIs it allows', async () => {
      const response = await api.json('/oauth/register', {
        redirect_uris: Array.from({ length: 10 }, (_, i) => `https://client.example/cb${i}`),
      });
      expect(response.status).toBe(201);
    });
  });

  describe('what the server advertises never follows a request header', () => {
    it('ignores Host and X-Forwarded-Proto', async () => {
      const body = await new Promise<string>((resolve, reject) => {
        const target = new URL('/.well-known/oauth-authorization-server', harness.base);
        const req = httpRequest(
          {
            host: target.hostname,
            port: target.port,
            path: target.pathname,
            headers: { host: 'evil.example', 'x-forwarded-proto': 'gopher, https' },
          },
          (res) => {
            let text = '';
            res.on('data', (chunk: Buffer) => (text += chunk.toString()));
            res.on('end', () => resolve(text));
          },
        );
        req.on('error', reject);
        req.end();
      });
      const metadata = JSON.parse(body) as Record<string, unknown>;
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
        expect(String(metadata[key]), key).toMatch(new RegExp(`^${harness.base}/`));
      }
      expect(body).not.toContain('evil.example');
      expect(body).not.toContain('gopher');
    });

    it('offers only the response mode it can deliver', async () => {
      const response = await api.get('/.well-known/oauth-authorization-server');
      expect(response.json.response_modes_supported).toEqual(['query']);
    });
  });

  describe('authorization request', () => {
    it.each([
      ['a trailing slash', '/oauth/authorize/'],
      ['another letter case', '/OAuth/Authorize'],
    ])('treats %s as the same endpoint: one consent, then a code', async (_label, path) => {
      const clientId = await registerClient(harness.base);
      const proof = pkce();
      const browser = new Browser(harness.base, ada);
      const url = authorizeUrl(clientId, proof.challenge, { scope: 'openid offline_access' });
      const parked = await reachConsent(browser, url.replace('/oauth/authorize', path));
      const details = await browser.get(`${parked.path}/details`);
      expect(details.json.data.scopes).toEqual(['read', 'cleanup']);
      const approve = await browser.post(`${parked.path}/approve`);
      const resumed = await browser.get(approve.json.data.redirectTo);
      // Not a second trip to the consent page.
      expect(outcome(resumed.location)).toMatchObject({ target: REDIRECT_URI, error: null });
      expect(outcome(resumed.location).code).toBeTruthy();
    });
  });

  describe('the code is released only to the approver’s own browser session', () => {
    it('refuses a resume that carries the request’s cookies but no session', async () => {
      const { browser, resumeUrl } = await approved(ada);
      // The request's cookies, replayed by someone who is not signed in.
      const stolen = await api.get(resumeUrl, { cookie: browser.cookiesFor(resumeUrl) });
      expect(outcome(stolen.location)).toEqual({
        target: REDIRECT_URI,
        code: null,
        error: 'access_denied',
      });
      expect(await harness.db.select().from(oauthAuthCodes)).toHaveLength(0);
      expect(await harness.db.select().from(oauthTokens)).toHaveLength(0);
    });

    it('refuses a resume under another person’s session', async () => {
      const { browser, resumeUrl } = await approved(ada);
      const other = await api.get(resumeUrl, {
        cookie: `${grace.cookie}; ${browser.cookiesFor(resumeUrl)}`,
      });
      expect(outcome(other.location)).toMatchObject({ code: null, error: 'access_denied' });
      expect(await harness.db.select().from(oauthAuthCodes)).toHaveLength(0);
    });

    it('refuses a resume under a forged session cookie', async () => {
      const { browser, resumeUrl } = await approved(ada);
      const forged = await api.get(resumeUrl, {
        cookie: `dm_access=not-a-token; ${browser.cookiesFor(resumeUrl)}`,
      });
      expect(outcome(forged.location)).toMatchObject({ code: null, error: 'access_denied' });
    });

    it('still releases it to the browser that approved', async () => {
      const { browser, resumeUrl } = await approved(ada);
      const resumed = await browser.get(resumeUrl);
      expect(outcome(resumed.location)).toMatchObject({ target: REDIRECT_URI, error: null });
      expect(outcome(resumed.location).code).toBeTruthy();
    });

    it('answers access_denied, not a server error, when the account became unavailable', async () => {
      const { browser, resumeUrl } = await approved(ada);
      await harness.db.insert(accountDeletionRequests).values({
        userId: ada.userId,
        effectiveAt: new Date(Date.now() + 7 * 86_400_000),
        basis: 'flat-grace',
        status: 'pending',
      });
      const resumed = await browser.get(resumeUrl);
      expect(resumed.status).toBe(303);
      expect(outcome(resumed.location)).toMatchObject({ code: null, error: 'access_denied' });
    });
  });

  describe('consent', () => {
    it('a second person approving the same request gets their own grant and their own code', async () => {
      const first = await approved(ada);
      // Grace signs in in the same browser and approves the same request.
      const cookies = `${grace.cookie}; ${first.browser.cookiesFor(first.path)}`;
      const approve = await new Browser(harness.base).request(`${first.path}/approve`, {
        method: 'POST',
        headers: { cookie: cookies, 'x-csrf-token': grace.csrf },
      });
      expect(approve.status).toBe(200);
      const resumed = await api.get(approve.json.data.redirectTo, {
        cookie: `${grace.cookie}; ${first.browser.cookiesFor(first.resumeUrl)}`,
      });
      const { code } = outcome(resumed.location);
      expect(code).toBeTruthy();
      const exchanged = await api.form('/oauth/token', {
        grant_type: 'authorization_code',
        code: code!,
        code_verifier: first.proof.verifier,
        client_id: first.clientId,
        redirect_uri: REDIRECT_URI,
      });
      expect(exchanged.status).toBe(200);
      const tokens = await harness.db
        .select({ userId: oauthGrants.userId })
        .from(oauthTokens)
        .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId));
      // Every token belongs to the person who pressed Approve last.
      expect(new Set(tokens.map((row) => row.userId))).toEqual(new Set([grace.userId]));
    });

    it('Deny needs the CSRF token, and the request stays open without it', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      const forged = await new Browser(harness.base).request(`${path}/deny`, {
        method: 'POST',
        headers: { cookie: `${ada.cookie}; ${browser.cookiesFor(path)}` },
      });
      expect(forged.status).toBe(403);
      expect((await browser.get(`${path}/details`)).status).toBe(200);
    });

    it('names only the Gmail accounts that are still connected', async () => {
      await harness.db
        .update(mailboxAccounts)
        .set({ status: 'disconnected' })
        .where(eq(mailboxAccounts.providerAccountId, 'ada.work@example.test'));
      try {
        const clientId = await registerClient(harness.base);
        const browser = new Browser(harness.base, ada);
        const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
        const details = await browser.get(`${path}/details`);
        expect(details.json.data.mailboxes).toEqual(['ada@example.test']);
      } finally {
        await harness.db
          .update(mailboxAccounts)
          .set({ status: 'active' })
          .where(eq(mailboxAccounts.providerAccountId, 'ada.work@example.test'));
      }
    });

    it('Approve then Deny on one request leaves no live grant', async () => {
      const { browser, path, clientId } = await approved(ada);
      const denied = await browser.post(`${path}/deny`);
      expect(denied.status).toBe(200);
      const resumed = await browser.get(denied.json.data.redirectTo);
      expect(outcome(resumed.location)).toMatchObject({ code: null, error: 'access_denied' });
      const [grant] = await harness.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.clientId, clientId));
      expect(grant!.revokedAt).toBeInstanceOf(Date);
      expect(harness.securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'connected_app.disconnected',
          userId: ada.userId,
          payload: { grantId: grant!.id, reason: 'denied' },
        }),
      );
    });

    it('leaves no live grant when the request vanishes during Approve', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      const provider = harness.app.get(OAuthProviderService).provider;
      const spy = vi
        .spyOn(provider, 'interactionResult')
        .mockRejectedValueOnce(new errors.SessionNotFound('interaction session not found'));
      try {
        const approve = await browser.post(`${path}/approve`);
        expect(approve.status).toBe(410);
        expect(approve.json.error.code).toBe('CONNECT_REQUEST_GONE');
      } finally {
        spy.mockRestore();
      }
      const grants = await harness.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.clientId, clientId));
      expect(grants).toHaveLength(1);
      expect(grants[0]!.revokedAt).toBeInstanceOf(Date);
    });

    it('a registration removed while its request waited is "gone", not a server error', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      await harness.db.delete(oauthClients).where(eq(oauthClients.clientId, clientId));
      const approve = await browser.post(`${path}/approve`);
      expect(approve.status).toBe(410);
      expect(approve.json.error.code).toBe('CONNECT_REQUEST_GONE');
    });

    it('stamps the registration as approved, which is what retention keeps', async () => {
      const clientId = await registerClient(harness.base);
      const stamp = async () =>
        (
          await harness.db
            .select({ at: oauthClients.lastGrantedAt })
            .from(oauthClients)
            .where(eq(oauthClients.clientId, clientId))
        )[0]!.at;
      expect(await stamp()).toBeNull();
      await approved(ada, clientId);
      expect(await stamp()).toBeInstanceOf(Date);
    });
  });

  describe('connecting the same app again', () => {
    it('replaces the earlier connection instead of adding a second one', async () => {
      const clientId = await registerClient(harness.base, { client_name: 'Claude' });
      const first = await connect(harness, ada, { clientId });
      harness.securityEvents.record.mockClear();
      const second = await connect(harness, ada, { clientId });

      const list = await new Browser(harness.base, ada).get('/api/oauth/grants');
      expect(list.json.data.apps).toHaveLength(1);

      // The earlier connection's tokens are dead; the new one's work.
      expect((await api.bearer('/mcp', first.tokens.access_token)).status).toBe(401);
      const stale = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: first.tokens.refresh_token,
        client_id: clientId,
      });
      expect(stale.status).toBe(400);
      expect(stale.json.error).toBe('invalid_grant');
      expect((await api.bearer('/mcp', second.tokens.access_token)).status).toBe(200);

      const connected = harness.securityEvents.record.mock.calls
        .map(([event]) => event as { eventType: string; payload: { replaced?: string[] } })
        .find((event) => event.eventType === 'connected_app.connected');
      expect(connected!.payload.replaced).toHaveLength(1);
    });

    it('leaves another person’s connection to the same app alone', async () => {
      const clientId = await registerClient(harness.base);
      const theirs = await connect(harness, grace, { clientId });
      await connect(harness, ada, { clientId });
      expect((await api.bearer('/mcp', theirs.tokens.access_token)).status).toBe(200);
    });

    it('leaves the same person’s other apps alone', async () => {
      const other = await connect(harness, ada);
      await connect(harness, ada);
      expect((await api.bearer('/mcp', other.tokens.access_token)).status).toBe(200);
      const list = await new Browser(harness.base, ada).get('/api/oauth/grants');
      expect(list.json.data.apps).toHaveLength(2);
    });
  });

  describe('Settings → Connected apps', () => {
    it('shows where each app sends people back to, oldest connection first', async () => {
      const web = await registerClient(harness.base, { client_name: 'Claude' });
      const desktop = await registerClient(harness.base, {
        client_name: 'Claude',
        redirect_uris: ['https://vscode.dev/redirect', 'http://127.0.0.1:33418/', REDIRECT_URI],
      });
      await connect(harness, ada, { clientId: web });
      await connect(harness, ada, { clientId: desktop });
      const list = await new Browser(harness.base, ada).get('/api/oauth/grants');
      // Two apps that call themselves the same thing are told apart by host.
      expect(
        list.json.data.apps.map((app: { redirectHosts: string[] }) => app.redirectHosts),
      ).toEqual([['client.example'], ['vscode.dev', '127.0.0.1', 'client.example']]);
    });
  });

  describe('/mcp', () => {
    it('answers a non-POST with 405 and says which method it allows', async () => {
      const { tokens } = await connect(harness, ada);
      const response = await api.get('/mcp', { authorization: `Bearer ${tokens.access_token}` });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    });
  });
});
