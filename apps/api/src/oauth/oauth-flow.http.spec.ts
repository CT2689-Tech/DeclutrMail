import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  accountDeletionRequests,
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthInteractions,
  oauthTokens,
} from '@declutrmail/db';

import { hashOAuthSecret } from './oauth-hash.js';
import { revokeGrantsForUser } from './oauth-store.js';
import {
  Browser,
  REDIRECT_URI,
  WEB_URL,
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
 * The OAuth authorization server end to end (ADR-0048 rule 4,
 * docs/spec/mcp-connector.md §4 + §8): real HTTP, the real library, the
 * real storage adapter, a migrated PGlite. Each `describe` is a row of
 * spec §8 that PR 1 owns, or a rule of §4.
 */
describe('OAuth authorization server', () => {
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

  afterAll(async () => {
    await harness.close();
  });

  const mcp = (token: string) => api.bearer('/mcp', token);

  describe('discovery', () => {
    it('protected-resource metadata names /mcp and its authorization server (RFC 9728)', async () => {
      for (const path of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ]) {
        const response = await api.get(path);
        expect(response.status).toBe(200);
        expect(response.json).toMatchObject({
          resource: harness.resource,
          authorization_servers: [harness.base],
          scopes_supported: ['read', 'cleanup'],
        });
      }
    });

    it('authorization-server metadata offers code + S256 + public clients only (RFC 8414)', async () => {
      const response = await api.get('/.well-known/oauth-authorization-server');
      expect(response.status).toBe(200);
      expect(response.json).toMatchObject({
        issuer: harness.base,
        authorization_endpoint: `${harness.base}/oauth/authorize`,
        token_endpoint: `${harness.base}/oauth/token`,
        registration_endpoint: `${harness.base}/oauth/register`,
        revocation_endpoint: `${harness.base}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['read', 'cleanup'],
      });
      // OpenID Connect is not offered: nothing is signed, nothing to verify.
      expect(response.json).not.toHaveProperty('jwks_uri');
      expect(response.json).not.toHaveProperty('id_token_signing_alg_values_supported');
    });

    it('advertises only endpoints that exist', async () => {
      const { json } = await api.get('/.well-known/oauth-authorization-server');
      const endpoints = Object.entries(json as Record<string, unknown>).filter(
        ([key, value]) => key.endsWith('_endpoint') && typeof value === 'string',
      );
      expect(endpoints.length).toBeGreaterThanOrEqual(4);
      for (const [key, url] of endpoints) {
        const method = key === 'authorization_endpoint' ? 'GET' : 'POST';
        const probe = await new Browser(harness.base).request(url as string, { method });
        // 404 would mean a route the metadata promises is not mounted.
        expect(probe.status, key).not.toBe(404);
      }
    });

    it('ignores X-Forwarded-Host when building advertised URLs', async () => {
      const response = await api.get('/.well-known/oauth-authorization-server', {
        'x-forwarded-host': 'evil.example',
      });
      expect(response.text).not.toContain('evil.example');
    });
  });

  describe('dynamic client registration (RFC 7591)', () => {
    it('registers a public client and stores no secret, even when one is requested', async () => {
      const response = await api.json('/oauth/register', {
        client_name: 'Wants A Secret',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'claudeai',
      });
      expect(response.status).toBe(201);
      expect(response.json.token_endpoint_auth_method).toBe('none');
      expect(response.json).not.toHaveProperty('client_secret');

      const [row] = await harness.db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, response.json.client_id));
      expect(row).toMatchObject({
        clientName: 'Wants A Secret',
        redirectUris: [REDIRECT_URI],
        registrationType: 'dynamic',
      });
      expect(JSON.stringify(row!.metadata)).not.toMatch(/client_secret/);
    });

    it.each([
      ['plain http to a real host', 'http://client.example/callback'],
      ['a custom scheme', 'cursor://anysphere.cursor-mcp/callback'],
      ['javascript:', 'javascript:alert(1)'],
    ])('refuses %s as a redirect URI', async (_label, uri) => {
      const response = await api.json('/oauth/register', { redirect_uris: [uri] });
      expect(response.status).toBe(400);
      expect(response.json.error).toBe('invalid_redirect_uri');
    });

    it('accepts https and loopback redirects together', async () => {
      const response = await api.json('/oauth/register', {
        redirect_uris: ['https://vscode.dev/redirect', 'http://127.0.0.1:33418/'],
      });
      expect(response.status).toBe(201);
      expect(response.json.application_type).toBe('native');
    });

    it('bounds the app name a person will be shown', async () => {
      const response = await api.json('/oauth/register', {
        client_name: 'A'.repeat(500),
        redirect_uris: [REDIRECT_URI],
      });
      expect(response.status).toBe(201);
      expect(response.json.client_name).toHaveLength(80);
    });
  });

  describe('authorization request', () => {
    it('requires PKCE', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, 'unused', {
          code_challenge: undefined,
          code_challenge_method: undefined,
        }),
      );
      const redirect = new URL(response.location!);
      expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get('error')).toBe('invalid_request');
      expect(redirect.searchParams.get('error_description')).toMatch(/PKCE/);
    });

    it('refuses the plain PKCE method', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, 'x'.repeat(43), { code_challenge_method: 'plain' }),
      );
      expect(new URL(response.location!).searchParams.get('error')).toBe('invalid_request');
    });

    it('refuses a repeated scope parameter instead of defaulting it', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        `${authorizeUrl(clientId, pkce().challenge)}&scope=cleanup`,
      );
      // Sent back to the app with an error — never on to the consent page.
      const redirect = new URL(response.location!, harness.base);
      expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get('error')).toBe('invalid_request');
    });

    it('refuses a resource other than /mcp (RFC 8707)', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, pkce().challenge, { resource: 'https://other.example/mcp' }),
      );
      expect(new URL(response.location!).searchParams.get('error')).toBe('invalid_target');
    });

    it('never redirects to an unregistered redirect URI', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, pkce().challenge, {
          redirect_uri: 'https://attacker.example/callback',
        }),
      );
      expect(response.status).toBe(400);
      expect(response.location).toBeNull();
      expect(response.text).toMatch(/could not continue this connection request/);
    });

    it('lets a loopback client pick its port at request time (RFC 8252)', async () => {
      const clientId = await registerClient(harness.base, {
        redirect_uris: ['http://127.0.0.1:7777/callback'],
      });
      const allowed = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, pkce().challenge, {
          redirect_uri: 'http://127.0.0.1:54321/callback',
        }),
      );
      expect(allowed.status).toBe(303);
      expect(allowed.location).toMatch(/^\/api\/oauth\/interactions\//);

      // The port is free; the path and host are not.
      const otherPath = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, pkce().challenge, {
          redirect_uri: 'http://127.0.0.1:54321/elsewhere',
        }),
      );
      expect(otherPath.status).toBe(400);
    });

    it('does not let an https client vary its port', async () => {
      const clientId = await registerClient(harness.base);
      const response = await new Browser(harness.base, ada).get(
        authorizeUrl(clientId, pkce().challenge, {
          redirect_uri: 'https://client.example:8443/callback',
        }),
      );
      expect(response.status).toBe(400);
      expect(response.location).toBeNull();
    });
  });

  describe('consent', () => {
    it('sends the browser to the web consent page', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { hop, requestId } = await reachConsent(
        browser,
        authorizeUrl(clientId, pkce().challenge),
      );
      expect(hop.status).toBe(303);
      expect(hop.location).toBe(`${WEB_URL}/connect/authorize?request=${requestId}`);
    });

    it('shows the app, its redirect host, the requested scopes and the mailboxes', async () => {
      const clientId = await registerClient(harness.base, { client_name: 'Claude' });
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(
        browser,
        authorizeUrl(clientId, pkce().challenge, { scope: 'read' }),
      );
      const details = await browser.get(`${path}/details`);
      expect(details.status).toBe(200);
      expect(details.json.data).toEqual({
        appName: 'Claude',
        redirectHost: 'client.example',
        scopes: ['read'],
        mailboxes: ['ada@example.test', 'ada.work@example.test'],
      });
    });

    it('grants every scope when the request names none this server knows', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(
        browser,
        authorizeUrl(clientId, pkce().challenge, { scope: 'openid offline_access claudeai' }),
      );
      const details = await browser.get(`${path}/details`);
      expect(details.json.data.scopes).toEqual(['read', 'cleanup']);
    });

    it('spec §8 "Not signed in at authorize": a signed-out visitor can neither read nor decide', async () => {
      const clientId = await registerClient(harness.base);
      const signedOut = new Browser(harness.base);
      const { path } = await reachConsent(signedOut, authorizeUrl(clientId, pkce().challenge));
      for (const [method, url] of [
        ['GET', `${path}/details`],
        ['POST', `${path}/approve`],
        ['POST', `${path}/deny`],
      ] as const) {
        const response = await signedOut.request(url, { method });
        expect(response.status, `${method} ${url}`).toBe(401);
      }
      expect(await harness.db.select().from(oauthGrants)).toHaveLength(0);
    });

    it('refuses a decision without the CSRF token', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      const forged = await new Browser(harness.base).request(`${path}/approve`, {
        method: 'POST',
        headers: { cookie: ada.cookie },
      });
      expect(forged.status).toBe(403);
    });

    it('binds a request to the browser that started it', async () => {
      // The attacker starts a request and sends the victim its link.
      const clientId = await registerClient(harness.base);
      const attacker = new Browser(harness.base);
      const { path } = await reachConsent(attacker, authorizeUrl(clientId, pkce().challenge));

      // The victim is signed in, but their browser never started it.
      const victim = new Browser(harness.base, ada);
      const details = await victim.get(`${path}/details`);
      expect(details.status).toBe(410);
      expect(details.json.error.code).toBe('CONNECT_REQUEST_GONE');
      const approve = await victim.post(`${path}/approve`);
      expect(approve.status).toBe(410);
      expect(await harness.db.select().from(oauthGrants)).toHaveLength(0);
    });

    it('decides only the request named in the URL, whatever cookie is presented', async () => {
      const clientId = await registerClient(harness.base);
      const first = new Browser(harness.base, ada);
      const second = new Browser(harness.base, ada);
      const a = await reachConsent(first, authorizeUrl(clientId, pkce().challenge));
      const b = await reachConsent(second, authorizeUrl(clientId, pkce().challenge));
      // Request A's cookie, sent by hand to request B's route.
      const hijack = await new Browser(harness.base).request(`${b.path}/approve`, {
        method: 'POST',
        headers: {
          cookie: `${ada.cookie}; ${first.cookiesFor(a.path)}`,
          'x-csrf-token': ada.csrf,
        },
      });
      expect(hijack.status).toBe(410);
      expect(await harness.db.select().from(oauthGrants)).toHaveLength(0);
    });

    it('spec §8 "Consent denied": the app receives access_denied and no grant exists', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      const denied = await browser.post(`${path}/deny`);
      expect(denied.status).toBe(200);
      const resumed = await browser.get(denied.json.data.redirectTo);
      const redirect = new URL(resumed.location!);
      expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get('error')).toBe('access_denied');
      expect(redirect.searchParams.get('state')).toBe('state-123');
      expect(redirect.searchParams.get('code')).toBeNull();
      expect(await harness.db.select().from(oauthGrants)).toHaveLength(0);
    });

    it('a second Approve click reuses the first grant', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      const first = await browser.post(`${path}/approve`);
      const second = await browser.post(`${path}/approve`);
      expect(second.json.data.redirectTo).toBe(first.json.data.redirectTo);
      const grants = await harness.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.clientId, clientId));
      expect(grants).toHaveLength(1);
      await harness.db.delete(oauthGrants);
    });

    it('a decided request cannot be decided again', async () => {
      const { requestId } = await connect(harness, ada);
      const browser = new Browser(harness.base, ada);
      const replay = await browser.post(`/api/oauth/interactions/${requestId}/approve`);
      expect(replay.status).toBe(410);
      await harness.db.delete(oauthGrants);
    });
  });

  describe('tokens', () => {
    it('issues opaque tokens bound to the person, the workspace and /mcp', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      expect(tokens).toMatchObject({
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read cleanup',
      });
      // Opaque: 256 bits of base64url, not a JWT.
      expect(tokens.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokens.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [grant] = await harness.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.clientId, clientId));
      expect(grant).toMatchObject({
        userId: ada.userId,
        workspaceId: ada.workspaceId,
        scopes: ['read', 'cleanup'],
        resource: harness.resource,
        revokedAt: null,
      });

      const response = await mcp(tokens.access_token);
      expect(response.status).toBe(200);
      await harness.db.delete(oauthGrants);
    });

    it('stores only hashes — no token, code or request id is readable from the database', async () => {
      const { tokens, code, requestId } = await connect(harness, ada);
      // A second, undecided request so the interactions table has a row.
      const pendingClient = await registerClient(harness.base);
      const pending = await reachConsent(
        new Browser(harness.base, ada),
        authorizeUrl(pendingClient, pkce().challenge),
      );

      const dump = JSON.stringify({
        tokens: await harness.db.select().from(oauthTokens),
        codes: await harness.db.select().from(oauthAuthCodes),
        interactions: await harness.db.select().from(oauthInteractions),
        grants: await harness.db.select().from(oauthGrants),
      });
      for (const secret of [
        tokens.access_token,
        tokens.refresh_token,
        code,
        requestId,
        pending.requestId,
      ]) {
        expect(dump).not.toContain(secret);
      }
      // …and the rows are there, keyed by the hash.
      expect(dump).toContain(hashOAuthSecret(tokens.access_token));
      expect(dump).toContain(hashOAuthSecret(tokens.refresh_token));
      expect(dump).toContain(hashOAuthSecret(code));
      expect(dump).toContain(hashOAuthSecret(pending.requestId));
      await harness.db.delete(oauthGrants);
      await harness.db.delete(oauthInteractions);
    });

    it('refuses a code exchange with the wrong PKCE verifier', async () => {
      const clientId = await registerClient(harness.base);
      const proof = pkce();
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, proof.challenge));
      const approved = await browser.post(`${path}/approve`);
      const resumed = await browser.get(approved.json.data.redirectTo);
      const code = new URL(resumed.location!).searchParams.get('code')!;
      const response = await api.form('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: pkce().verifier,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
      });
      expect(response.status).toBe(400);
      expect(response.json.error).toBe('invalid_grant');
      await harness.db.delete(oauthGrants);
    });

    it('a replayed authorization code revokes the grant it minted', async () => {
      const clientId = await registerClient(harness.base);
      const proof = pkce();
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, proof.challenge));
      const approved = await browser.post(`${path}/approve`);
      const resumed = await browser.get(approved.json.data.redirectTo);
      const code = new URL(resumed.location!).searchParams.get('code')!;
      const exchange = () =>
        api.form('/oauth/token', {
          grant_type: 'authorization_code',
          code,
          code_verifier: proof.verifier,
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
        });
      const first = await exchange();
      expect(first.status).toBe(200);
      const second = await exchange();
      expect(second.status).toBe(400);
      expect(second.json.error).toBe('invalid_grant');
      expect((await mcp(first.json.access_token)).status).toBe(401);
      expect(harness.securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'connected_app.token_reuse_revoked',
          severity: 'warning',
          userId: ada.userId,
          workspaceId: ada.workspaceId,
          payload: expect.objectContaining({ kind: 'authorization_code', clientId }),
        }),
      );
      await harness.db.delete(oauthGrants);
    });

    it('an ordinary failed exchange is not reported as reuse', async () => {
      harness.securityEvents.record.mockClear();
      const clientId = await registerClient(harness.base);
      const response = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: 'never-issued',
        client_id: clientId,
      });
      expect(response.status).toBe(400);
      expect(harness.securityEvents.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'connected_app.token_reuse_revoked' }),
      );
    });

    it('rotates the refresh token on every use and links the chain', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.json.refresh_token).not.toBe(tokens.refresh_token);
      expect(refreshed.json.access_token).not.toBe(tokens.access_token);
      expect((await mcp(refreshed.json.access_token)).status).toBe(200);

      const row = async (token: string) =>
        (
          await harness.db
            .select()
            .from(oauthTokens)
            .where(eq(oauthTokens.tokenHash, hashOAuthSecret(token)))
        )[0]!;
      const before = await row(tokens.refresh_token);
      const after = await row(refreshed.json.refresh_token);
      expect(before.consumedAt).toBeInstanceOf(Date);
      expect(before.replacedBy).toBe(after.id);
      expect(after.familyId).toBe(before.familyId);
      expect(after.familyId).not.toBeNull();
      expect(after.consumedAt).toBeNull();
      // 30 days from the rotation, not from the first issue.
      expect(after.expiresAt.getTime()).toBeGreaterThanOrEqual(before.expiresAt.getTime());
      await harness.db.delete(oauthGrants);
    });

    it('spec §8 "Refresh token reused": the whole family is revoked', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      const refresh = (token: string) =>
        api.form('/oauth/token', {
          grant_type: 'refresh_token',
          refresh_token: token,
          client_id: clientId,
        });
      const rotated = await refresh(tokens.refresh_token);
      expect(rotated.status).toBe(200);
      expect((await mcp(rotated.json.access_token)).status).toBe(200);

      // The first refresh token is presented again — by a thief or a bug.
      const reuse = await refresh(tokens.refresh_token);
      expect(reuse.status).toBe(400);
      expect(reuse.json.error).toBe('invalid_grant');

      // Everything the family minted is dead, including the newest pair.
      const reused = await mcp(rotated.json.access_token);
      expect(reused.status).toBe(401);
      expect(reused.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
      expect((await mcp(tokens.access_token)).status).toBe(401);
      expect((await refresh(rotated.json.refresh_token)).status).toBe(400);
      const [grant] = await harness.db
        .select()
        .from(oauthGrants)
        .where(eq(oauthGrants.clientId, clientId));
      expect(grant!.revokedAt).toBeInstanceOf(Date);
      // …and the audit log says why the connection ended.
      expect(harness.securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'connected_app.token_reuse_revoked',
          severity: 'warning',
          userId: ada.userId,
          payload: { kind: 'refresh_token', clientId, grantId: grant!.id },
        }),
      );
      await harness.db.delete(oauthGrants);
    });

    it('refuses a refresh token presented by another client', async () => {
      const { tokens } = await connect(harness, ada);
      const otherClient = await registerClient(harness.base);
      const response = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: otherClient,
      });
      expect(response.status).toBe(400);
      expect(response.json.error).toBe('invalid_grant');
      await harness.db.delete(oauthGrants);
    });

    it('revoking the refresh token (RFC 7009) ends the connection', async () => {
      harness.securityEvents.record.mockClear();
      const { tokens, clientId } = await connect(harness, ada);
      const revoked = await api.form('/oauth/revoke', {
        token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(revoked.status).toBe(200);
      expect((await mcp(tokens.access_token)).status).toBe(401);
      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(400);
      // A client ending its own connection is not token reuse.
      expect(harness.securityEvents.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'connected_app.token_reuse_revoked' }),
      );
      await harness.db.delete(oauthGrants);
    });

    it('revoking the access token ends every token of the grant too', async () => {
      // The library revokes the grant's whole token set whichever token
      // is presented; a client that revokes is saying "I am done".
      const { tokens, clientId } = await connect(harness, ada);
      await api.form('/oauth/revoke', { token: tokens.access_token, client_id: clientId });
      expect((await mcp(tokens.access_token)).status).toBe(401);
      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(400);
      const list = await new Browser(harness.base, ada).get('/api/oauth/grants');
      expect(list.json.data.apps).toEqual([]);
      await harness.db.delete(oauthGrants);
    });

    it('does not let one client revoke another client’s token', async () => {
      const { tokens } = await connect(harness, ada);
      const otherClient = await registerClient(harness.base);
      await api.form('/oauth/revoke', { token: tokens.access_token, client_id: otherClient });
      expect((await mcp(tokens.access_token)).status).toBe(200);
      await harness.db.delete(oauthGrants);
    });
  });

  describe('McpTokenGuard on /mcp', () => {
    const challenge = (response: { headers: Headers }) =>
      response.headers.get('www-authenticate') ?? '';

    it('answers 401 with a WWW-Authenticate challenge when there is no token', async () => {
      const response = await api.json('/mcp', { jsonrpc: '2.0', id: 1 });
      expect(response.status).toBe(401);
      expect(challenge(response)).toMatch(/^Bearer /);
      expect(challenge(response)).toContain(
        `resource_metadata="${harness.base}/.well-known/oauth-protected-resource/mcp"`,
      );
    });

    it('refuses a token it never issued, a refresh token, and a session cookie', async () => {
      const { tokens } = await connect(harness, ada);
      for (const token of ['not-a-token', tokens.refresh_token]) {
        const response = await mcp(token);
        expect(response.status).toBe(401);
        expect(challenge(response)).toMatch(/error="invalid_token"/);
      }
      const cookieOnly = await new Browser(harness.base, ada).request('/mcp', { method: 'POST' });
      expect(cookieOnly.status).toBe(401);
      await harness.db.delete(oauthGrants);
    });

    it('refuses a refresh token as a bearer even if it carried the right audience', async () => {
      const { tokens } = await connect(harness, ada);
      // Give the refresh row everything an access token has except its kind.
      await harness.db
        .update(oauthTokens)
        .set({
          payload: sql`jsonb_set(${oauthTokens.payload}, '{aud}', to_jsonb(${harness.resource}::text))`,
        })
        .where(eq(oauthTokens.tokenHash, hashOAuthSecret(tokens.refresh_token)));
      expect((await mcp(tokens.refresh_token)).status).toBe(401);
      await harness.db.delete(oauthGrants);
    });

    it('spec §8 "Access token expired": 401 + WWW-Authenticate, and refresh recovers', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      await harness.db
        .update(oauthTokens)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(oauthTokens.tokenHash, hashOAuthSecret(tokens.access_token)));
      const expired = await mcp(tokens.access_token);
      expect(expired.status).toBe(401);
      expect(challenge(expired)).toMatch(/error="invalid_token"/);
      expect(challenge(expired)).toMatch(/expired/);

      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect((await mcp(refreshed.json.access_token)).status).toBe(200);
      await harness.db.delete(oauthGrants);
    });

    it('refuses a token issued for another audience (RFC 8707)', async () => {
      const { tokens } = await connect(harness, ada);
      await harness.db
        .update(oauthTokens)
        .set({
          payload: sql`jsonb_set(${oauthTokens.payload}, '{aud}', '"https://other.example/mcp"')`,
        })
        .where(eq(oauthTokens.tokenHash, hashOAuthSecret(tokens.access_token)));
      const response = await mcp(tokens.access_token);
      expect(response.status).toBe(401);
      expect(challenge(response)).toMatch(/not issued for this resource/);
      await harness.db.delete(oauthGrants);
    });

    it('refuses a token whose grant is revoked, even if the token row was never stamped', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      // Only the grant row changes — the join is what must refuse.
      await harness.db
        .update(oauthGrants)
        .set({ revokedAt: new Date() })
        .where(eq(oauthGrants.clientId, clientId));
      expect((await mcp(tokens.access_token)).status).toBe(401);
      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(400);
      await harness.db.delete(oauthGrants);
    });

    it('hands an authenticated call to the MCP server', async () => {
      const { tokens } = await connect(harness, ada);
      const response = await api.bearer('/mcp', tokens.access_token, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/list',
        params: {},
      });
      expect(response.status).toBe(200);
      // The SDK answers a pre-2026 client over an event stream.
      const body = JSON.parse(
        response.text
          .split('\n')
          .find((line) => line.startsWith('data:'))!
          .slice('data:'.length),
      );
      expect(body.id).toBe(7);
      expect(body.result.tools).toHaveLength(10);
      await harness.db.delete(oauthGrants);
    });

    it('records when a connected app was last used', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      await mcp(tokens.access_token);
      await vi.waitFor(async () => {
        const [grant] = await harness.db
          .select()
          .from(oauthGrants)
          .where(eq(oauthGrants.clientId, clientId));
        expect(grant!.lastUsedAt).toBeInstanceOf(Date);
      });
      await harness.db.delete(oauthGrants);
    });
  });

  describe('Settings → Connected apps', () => {
    it('lists a person’s own connected apps, newest last, and nobody else’s', async () => {
      const claude = await registerClient(harness.base, { client_name: 'Claude' });
      await connect(harness, ada, { clientId: claude, scope: 'read' });
      await connect(harness, grace);

      const mine = await new Browser(harness.base, ada).get('/api/oauth/grants');
      expect(mine.status).toBe(200);
      expect(mine.json.data.apps).toHaveLength(1);
      expect(mine.json.data.apps[0]).toMatchObject({
        appName: 'Claude',
        scopes: ['read'],
        lastUsedAt: null,
      });
      expect(Date.parse(mine.json.data.apps[0].connectedAt)).not.toBeNaN();
      await harness.db.delete(oauthGrants);
    });

    it('does not list an approval whose code was never exchanged', async () => {
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));
      await browser.post(`${path}/approve`);
      const list = await browser.get('/api/oauth/grants');
      expect(list.json.data.apps).toEqual([]);
      await harness.db.delete(oauthGrants);
    });

    it('spec §8 "Grant disconnected in Settings": every token is a 401 invalid_token', async () => {
      const { tokens, clientId } = await connect(harness, ada);
      const browser = new Browser(harness.base, ada);
      const { id } = (await browser.get('/api/oauth/grants')).json.data.apps[0];

      const disconnected = await browser.request(`/api/oauth/grants/${id}`, { method: 'DELETE' });
      expect(disconnected.status).toBe(200);

      const response = await mcp(tokens.access_token);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
      const refreshed = await api.form('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(refreshed.status).toBe(400);
      expect((await browser.get('/api/oauth/grants')).json.data.apps).toEqual([]);
      expect(harness.securityEvents.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'connected_app.disconnected', userId: ada.userId }),
      );
      // Disconnecting again is not an error.
      const again = await browser.request(`/api/oauth/grants/${id}`, { method: 'DELETE' });
      expect(again.status).toBe(200);
      await harness.db.delete(oauthGrants);
    });

    it('does not let one person disconnect another person’s app', async () => {
      const { tokens } = await connect(harness, ada);
      const [grant] = await harness.db.select().from(oauthGrants);
      const response = await new Browser(harness.base, grace).request(
        `/api/oauth/grants/${grant!.id}`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(404);
      expect((await mcp(tokens.access_token)).status).toBe(200);
      await harness.db.delete(oauthGrants);
    });

    it('requires a session and the CSRF token', async () => {
      expect((await api.get('/api/oauth/grants')).status).toBe(401);
      const { tokens } = await connect(harness, ada);
      const [grant] = await harness.db.select().from(oauthGrants);
      const forged = await new Browser(harness.base).request(`/api/oauth/grants/${grant!.id}`, {
        method: 'DELETE',
        headers: { cookie: ada.cookie },
      });
      expect(forged.status).toBe(403);
      expect((await mcp(tokens.access_token)).status).toBe(200);
      await harness.db.delete(oauthGrants);
    });
  });

  describe('spec §8 "Account deletion started"', () => {
    it('every token is a 401 once the person’s grants are revoked', async () => {
      const first = await connect(harness, ada);
      const second = await connect(harness, ada);
      const bystander = await connect(harness, grace);

      const revoked = await revokeGrantsForUser(harness.db, ada.userId);
      expect(revoked).toHaveLength(2);

      for (const { tokens, clientId } of [first, second]) {
        expect((await mcp(tokens.access_token)).status).toBe(401);
        const refreshed = await api.form('/oauth/token', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: clientId,
        });
        expect(refreshed.status).toBe(400);
      }
      // Another person's connection is untouched.
      expect((await mcp(bystander.tokens.access_token)).status).toBe(200);
      await harness.db.delete(oauthGrants);
    });

    it('an account with a deletion in flight cannot approve, exchange or refresh', async () => {
      const existing = await connect(harness, ada);
      const clientId = await registerClient(harness.base);
      const browser = new Browser(harness.base, ada);
      const { path } = await reachConsent(browser, authorizeUrl(clientId, pkce().challenge));

      const [request] = await harness.db
        .insert(accountDeletionRequests)
        .values({
          userId: ada.userId,
          effectiveAt: new Date(Date.now() + 7 * 86_400_000),
          basis: 'flat-grace',
          status: 'pending',
        })
        .returning();
      try {
        const approve = await browser.post(`${path}/approve`);
        expect(approve.status).toBe(409);
        expect(approve.json.error.code).toBe('CONNECT_DELETION_PENDING');

        // Second line of defence: even a grant that outlived the request
        // cannot mint new tokens.
        const refreshed = await api.form('/oauth/token', {
          grant_type: 'refresh_token',
          refresh_token: existing.tokens.refresh_token,
          client_id: existing.clientId,
        });
        expect(refreshed.status).toBe(400);
        expect(refreshed.json.error).toBe('invalid_grant');
      } finally {
        await harness.db
          .delete(accountDeletionRequests)
          .where(eq(accountDeletionRequests.id, request!.id));
        await harness.db.delete(oauthGrants);
      }
    });
  });
});

describe('rate limits', () => {
  let harness: OAuthTestApp;

  beforeAll(async () => {
    harness = await createOAuthTestApp({ rateLimit: true });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('caps unauthenticated client registration per address', async () => {
    // 20 a minute. The bucket refills one token every three seconds, so
    // the burst is sent at once and the assertions hold however slow the run.
    const statuses = await Promise.all(
      Array.from({ length: 40 }, () =>
        client(harness.base)
          .json('/oauth/register', { redirect_uris: [REDIRECT_URI] })
          .then((response) => response.status),
      ),
    );
    const registered = statuses.filter((status) => status === 201).length;
    const limited = statuses.filter((status) => status === 429).length;
    expect(registered + limited).toBe(40);
    expect(registered).toBeGreaterThanOrEqual(20);
    expect(limited).toBeGreaterThanOrEqual(10);
    // A refused registration writes nothing.
    expect(await harness.db.select().from(oauthClients)).toHaveLength(registered);
  });
});

describe('MCP_ENABLED off', () => {
  let harness: OAuthTestApp;
  let ada: TestPerson;
  let liveToken: string;
  let requestPath: string;

  beforeAll(async () => {
    harness = await createOAuthTestApp();
    ada = await harness.person('ada@example.test');
    // Build real state while enabled, so "off" is tested against routes
    // that would otherwise answer.
    const connected = await connect(harness, ada);
    liveToken = connected.tokens.access_token;
    const clientId = await registerClient(harness.base);
    requestPath = (
      await reachConsent(new Browser(harness.base, ada), authorizeUrl(clientId, pkce().challenge))
    ).path;
    vi.stubEnv('MCP_ENABLED', 'false');
  });

  afterAll(async () => {
    await harness.close();
  });

  it.each([
    ['GET', '/.well-known/oauth-protected-resource'],
    ['GET', '/.well-known/oauth-protected-resource/mcp'],
    ['GET', '/.well-known/oauth-authorization-server'],
    ['POST', '/oauth/register'],
    ['GET', '/oauth/authorize'],
    ['GET', '/oauth/authorize/some-request-id'],
    ['POST', '/oauth/token'],
    ['POST', '/oauth/revoke'],
    ['POST', '/mcp'],
    ['GET', '/mcp'],
    ['GET', '/api/oauth/grants'],
    ['DELETE', '/api/oauth/grants/00000000-0000-4000-8000-000000000000'],
    ['GET', '/api/action-previews/00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/action-previews/00000000-0000-4000-8000-000000000000/confirm'],
  ])('%s %s is 404', async (method, path) => {
    const signedIn = await new Browser(harness.base, ada).request(path, { method });
    expect(signedIn.status).toBe(404);
    const signedOut = await new Browser(harness.base).request(path, { method });
    expect(signedOut.status).toBe(404);
  });

  it('the consent routes are 404 for a real pending request', async () => {
    const browser = new Browser(harness.base, ada);
    expect((await browser.get(requestPath)).status).toBe(404);
    expect((await browser.get(`${requestPath}/details`)).status).toBe(404);
    expect((await browser.post(`${requestPath}/approve`)).status).toBe(404);
    expect((await browser.post(`${requestPath}/deny`)).status).toBe(404);
  });

  it('/mcp is 404 even with a token that was valid a moment ago — never 401', async () => {
    const response = await client(harness.base).bearer('/mcp', liveToken);
    expect(response.status).toBe(404);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('treats anything but the exact string "true" as off', async () => {
    for (const value of ['TRUE', '1', 'yes', '']) {
      vi.stubEnv('MCP_ENABLED', value);
      expect(
        (await client(harness.base).get('/.well-known/oauth-authorization-server')).status,
      ).toBe(404);
    }
    vi.stubEnv('MCP_ENABLED', 'false');
  });
});
