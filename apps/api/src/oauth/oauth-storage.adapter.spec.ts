import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { errors } from 'oidc-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthInteractions,
  oauthTokens,
  schema,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';

import type { DrizzleDb } from '../db/db.module.js';
import { hashOAuthSecret } from './oauth-hash.js';
import { createOAuthStorageAdapter } from './oauth-storage.adapter.js';

/**
 * The storage adapter in isolation — the paths the HTTP flow cannot
 * reach one at a time: the losing side of a concurrent exchange, models
 * this deployment has no storage for, and the library's session.
 */
describe('OAuth storage adapter', () => {
  let db: DrizzleDb;
  let adapter: ReturnType<typeof createOAuthStorageAdapter>;
  let grantId: string;
  const reportReuse = vi.fn();

  const exp = () => Math.floor(Date.now() / 1000) + 600;

  beforeEach(async () => {
    vi.stubEnv('API_URL', 'https://api.example.test');
    db = drizzle(await freshTestPglite(), { schema }) as unknown as DrizzleDb;
    reportReuse.mockClear();
    adapter = createOAuthStorageAdapter(db, reportReuse);
    const [workspace] = await db.insert(workspaces).values({ name: 'WS' }).returning();
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'owner@example.test' })
      .returning();
    await db.insert(oauthClients).values({
      clientId: 'client-1',
      redirectUris: ['https://client.example/cb'],
      registrationType: 'dynamic',
      metadata: {},
    });
    const [grant] = await db
      .insert(oauthGrants)
      .values({
        workspaceId: workspace!.id,
        userId: user!.id,
        clientId: 'client-1',
        scopes: ['read'],
        resource: 'https://api.example.test/mcp',
      })
      .returning();
    grantId = grant!.id;
  });

  const grantRevokedAt = async () =>
    (await db.select().from(oauthGrants).where(eq(oauthGrants.id, grantId)))[0]!.revokedAt;

  describe('refresh tokens', () => {
    const firstUsedAt = async (token: string) =>
      (
        await db
          .select({ consumedAt: oauthTokens.consumedAt })
          .from(oauthTokens)
          .where(eq(oauthTokens.tokenHash, hashOAuthSecret(token)))
      )[0]!.consumedAt;
    /** Moves a token's first use back past the grace, by the database clock. */
    const pastGrace = (token: string) =>
      db
        .update(oauthTokens)
        .set({ consumedAt: sql`now() - interval '31 seconds'` })
        .where(eq(oauthTokens.tokenHash, hashOAuthSecret(token)));

    it('honours a second use within 30 seconds, and does not extend the window', async () => {
      const store = adapter('RefreshToken');
      await store.upsert('refresh-1', { grantId, exp: exp(), kind: 'RefreshToken' }, 600);

      // Two requests that both read the token as unused, then both consume it.
      await store.consume('refresh-1');
      const first = await firstUsedAt('refresh-1');
      await store.consume('refresh-1');

      expect(reportReuse).not.toHaveBeenCalled();
      expect(await grantRevokedAt()).toBeNull();
      // Read as unused, so the library rotates it again instead of revoking.
      expect(await store.find('refresh-1')).not.toHaveProperty('consumed');
      // The grace runs from the first use, however often it is used inside it.
      expect(await firstUsedAt('refresh-1')).toEqual(first);
    });

    it('after 30 seconds, reports the token as used and a second use revokes the grant, once', async () => {
      const store = adapter('RefreshToken');
      await store.upsert('refresh-1', { grantId, exp: exp(), kind: 'RefreshToken' }, 600);
      expect(await store.find('refresh-1')).not.toHaveProperty('consumed');
      await store.consume('refresh-1');
      await pastGrace('refresh-1');

      const found = await store.find('refresh-1');
      expect(found?.consumed).toBeTypeOf('number');
      expect(found?.jti).toBe('refresh-1');
      await expect(store.consume('refresh-1')).rejects.toBeInstanceOf(errors.InvalidGrant);
      expect(await grantRevokedAt()).toBeInstanceOf(Date);
      // Reported once, with who it belonged to; a third attempt adds nothing.
      await expect(store.consume('refresh-1')).rejects.toBeInstanceOf(errors.InvalidGrant);
      expect(reportReuse).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ grantId, clientId: 'client-1', kind: 'refresh_token' }),
      );
    });

    it('gives an access token no grace: a used one is never read as unused', async () => {
      const store = adapter('AccessToken');
      await store.upsert('access-1', { grantId, exp: exp() }, 600);
      await db
        .update(oauthTokens)
        .set({ consumedAt: sql`now()` })
        .where(eq(oauthTokens.tokenHash, hashOAuthSecret('access-1')));
      expect((await store.find('access-1'))?.consumed).toBeTypeOf('number');
    });

    it('does not serve an access token to a refresh lookup, or the reverse', async () => {
      await adapter('AccessToken').upsert('token-a', { grantId, exp: exp() }, 600);
      await adapter('RefreshToken').upsert('token-r', { grantId, exp: exp() }, 600);
      expect(await adapter('RefreshToken').find('token-a')).toBeUndefined();
      expect(await adapter('AccessToken').find('token-r')).toBeUndefined();
    });

    it('revokes by grant one kind at a time and stops serving revoked tokens', async () => {
      await adapter('AccessToken').upsert('token-a', { grantId, exp: exp() }, 600);
      await adapter('RefreshToken').upsert('token-r', { grantId, exp: exp() }, 600);
      await adapter('AccessToken').revokeByGrantId(grantId);
      expect(await adapter('AccessToken').find('token-a')).toBeUndefined();
      expect(await adapter('RefreshToken').find('token-r')).toBeDefined();
    });

    it('refuses to store a token that belongs to no grant', async () => {
      await expect(adapter('AccessToken').upsert('orphan', { exp: exp() }, 600)).rejects.toThrow(
        /without a grant/,
      );
    });
  });

  describe('authorization codes', () => {
    const code = {
      grantId,
      codeChallenge: 'c',
      codeChallengeMethod: 'S256',
      redirectUri: 'https://client.example/cb',
    };

    it('lets exactly one of two exchanges of the same code win, and revokes the grant', async () => {
      const store = adapter('AuthorizationCode');
      await store.upsert('code-1', { ...code, grantId, exp: exp() }, 60);
      await store.consume('code-1');
      await expect(store.consume('code-1')).rejects.toBeInstanceOf(errors.InvalidGrant);
      expect(await grantRevokedAt()).toBeInstanceOf(Date);
      expect(reportReuse).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ grantId, kind: 'authorization_code' }),
      );
    });

    it.each([
      ['no challenge', { codeChallenge: undefined }],
      ['the plain method', { codeChallengeMethod: 'plain' }],
      ['no redirect URI', { redirectUri: undefined }],
    ])('refuses to store a code with %s', async (_label, override) => {
      await expect(
        adapter('AuthorizationCode').upsert(
          'code-1',
          { ...code, grantId, exp: exp(), ...override },
          60,
        ),
      ).rejects.toThrow(/S256 PKCE/);
      expect(await db.select().from(oauthAuthCodes)).toHaveLength(0);
    });
  });

  describe('clients', () => {
    it('never persists a client secret, whatever the library hands it', async () => {
      await adapter('Client').upsert('client-2', {
        client_id: 'client-2',
        client_name: 'App',
        redirect_uris: ['https://client.example/cb'],
        client_secret: 'should-never-be-stored',
        client_secret_expires_at: 0,
      });
      const [row] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, 'client-2'));
      expect(JSON.stringify(row)).not.toContain('should-never-be-stored');
      expect(row!.metadata).not.toHaveProperty('client_secret');
      expect(await adapter('Client').find('client-2')).toMatchObject({ client_id: 'client-2' });
    });

    it.each([
      ['a null character', 'client\u0000'],
      ['a space', 'client 2'],
      ['an id longer than any this server issues', 'a'.repeat(65)],
      ['an empty id', ''],
    ])('answers "no such client" for %s without asking the database', async (_label, id) => {
      // The id comes straight from an unauthenticated request; Postgres
      // would refuse a null character with an error, not an empty result.
      await expect(adapter('Client').find(id)).resolves.toBeUndefined();
    });
  });

  describe('grants', () => {
    it('serves a live grant in the library’s shape, with no expiry of its own', async () => {
      const found = await adapter('Grant').find(grantId);
      expect(found).toMatchObject({
        jti: grantId,
        kind: 'Grant',
        clientId: 'client-1',
        resources: { 'https://api.example.test/mcp': 'read' },
      });
      expect(found).not.toHaveProperty('exp');
    });

    it('destroy revokes the grant and everything under it', async () => {
      await adapter('AccessToken').upsert('token-a', { grantId, exp: exp() }, 600);
      await adapter('Grant').destroy(grantId);
      expect(await adapter('Grant').find(grantId)).toBeUndefined();
      const [token] = await db.select().from(oauthTokens);
      expect(token!.revokedAt).toBeInstanceOf(Date);
      // Outside a token request this is an ordinary revocation, not reuse.
      expect(reportReuse).not.toHaveBeenCalled();
    });

    it('treats a malformed id as unknown instead of asking Postgres to parse it', async () => {
      expect(await adapter('Grant').find('not-a-uuid')).toBeUndefined();
      await expect(adapter('Grant').destroy('not-a-uuid')).resolves.toBeUndefined();
    });

    it('is never written through the library', async () => {
      await expect(adapter('Grant').upsert('x', {})).rejects.toThrow(/no storage/);
    });
  });

  describe('interactions', () => {
    it('keeps neither the request id nor the resume URL, and rebuilds the URL from the issuer', async () => {
      const store = adapter('Interaction');
      const id = 'request-id-0123456789';
      await store.upsert(
        id,
        {
          jti: id,
          kind: 'Interaction',
          exp: exp(),
          params: { client_id: 'client-1' },
          returnTo: `https://attacker.example/oauth/authorize/${id}`,
        } as never,
        900,
      );
      const [row] = await db.select().from(oauthInteractions);
      expect(JSON.stringify(row)).not.toContain(id);
      expect(row!.idHash).toBe(hashOAuthSecret(id));

      const found = (await store.find(id)) as unknown as { returnTo: string; jti: string };
      expect(found.jti).toBe(id);
      expect(found.returnTo).toBe(`https://api.example.test/oauth/authorize/${id}`);
    });

    it('updates the same row when the library saves a decision', async () => {
      const store = adapter('Interaction');
      await store.upsert('request-1', { exp: exp(), kind: 'Interaction' }, 900);
      await store.upsert(
        'request-1',
        { exp: exp(), kind: 'Interaction', result: {} } as never,
        900,
      );
      expect(await db.select().from(oauthInteractions)).toHaveLength(1);
      expect(await store.find('request-1')).toHaveProperty('result');
      await store.destroy('request-1');
      expect(await store.find('request-1')).toBeUndefined();
    });
  });

  describe('the library’s own session', () => {
    it('is never stored, so the library has no login of its own', async () => {
      const store = adapter('Session');
      await store.upsert('session-1', { accountId: 'user-1', uid: 'uid-1' } as never, 900);
      expect(await store.find('session-1')).toBeUndefined();
      expect(await store.findByUid('uid-1')).toBeUndefined();
    });
  });

  describe('models with no storage here', () => {
    it.each(['DeviceCode', 'ClientCredentials', 'ReplayDetection', 'RegistrationAccessToken'])(
      '%s fails loudly instead of storing by accident',
      async (model) => {
        const store = adapter(model);
        await expect(store.upsert('id', {})).rejects.toThrow(/no storage/);
        await expect(store.find('id')).rejects.toThrow(/no storage/);
      },
    );
  });
});
