import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Adapter, type AdapterPayload, errors, Provider } from 'oidc-provider';

import { oauthAuthCodes, oauthClients, oauthInteractions, oauthTokens } from '@declutrmail/db';

import type { DrizzleDb } from '../db/db.module.js';
import { oauthIssuer } from '../mcp/mcp-config.js';
import { hashOAuthSecret } from './oauth-hash.js';
import { findLiveGrant, revokeGrant, type RevokedGrant } from './oauth-store.js';

/**
 * Storage adapter between `oidc-provider` and our tables (ADR-0048 rule
 * 4, spec §7). The library owns the protocol; this file only decides
 * where each of its records lives:
 *
 *   Client             → oauth_clients
 *   Grant              → oauth_grants      (written by the consent service)
 *   AccessToken        → oauth_tokens      kind = 'access'
 *   RefreshToken       → oauth_tokens      kind = 'refresh'
 *   AuthorizationCode  → oauth_auth_codes
 *   Interaction        → oauth_interactions
 *   Session            → nowhere (see `NoSessionStore`)
 *
 * HASH-ONLY. The library addresses a token, code or interaction by its
 * value (`jti`). That value is the credential, so it is hashed for the
 * lookup key and stripped from the stored payload; `find` puts it back
 * from the value the caller presented. Nothing readable from the database
 * can be replayed as a credential.
 *
 * ATOMIC CONSUME. `consume` marks a code or refresh token used only if it
 * was not already, in one statement. Losing that race is reuse: the grant
 * is revoked (its own committed statements, never inside a transaction a
 * thrown error would roll back) and the request is refused.
 */

type Row = Record<string, unknown>;

/**
 * A used authorization code or a rotated refresh token was presented
 * again and its grant was revoked for it — the textbook sign of a stolen
 * credential. Reported once per grant, by whichever call revoked it.
 */
export type ReuseRevocation = RevokedGrant & { kind: 'refresh_token' | 'authorization_code' };
export type ReuseReporter = (event: ReuseRevocation) => void;

/** The authorization endpoint; a request resumes at `<this>/<request id>`. */
export const OAUTH_RESUME_PATH = '/oauth/authorize';

const epoch = (date: Date): number => Math.floor(date.getTime() / 1000);

/** The stored form of a library payload: everything except the credential. */
function withoutSecret(payload: AdapterPayload): Row {
  const { jti: _jti, ...rest } = payload as Row;
  return rest;
}

/** When the library says the record expires. It always sets `exp` for these models. */
function expiryOf(payload: AdapterPayload, expiresIn: number | undefined): Date {
  if (typeof payload.exp === 'number') return new Date(payload.exp * 1000);
  if (typeof expiresIn === 'number') return new Date(Date.now() + expiresIn * 1000);
  throw new Error('oidc-provider record has no expiry.');
}

function unsupported(model: string, operation: string): never {
  throw new Error(`oidc-provider ${model}.${operation} has no storage in this deployment.`);
}

/** Members every adapter shares: this deployment has no device flow and no sessions. */
abstract class BaseStore implements Adapter {
  constructor(
    protected readonly db: DrizzleDb,
    protected readonly model: string,
  ) {}

  abstract upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void>;
  abstract find(id: string): Promise<AdapterPayload | undefined>;
  abstract destroy(id: string): Promise<void>;

  async consume(_id: string): Promise<void> {
    unsupported(this.model, 'consume');
  }

  async revokeByGrantId(_grantId: string): Promise<void> {
    unsupported(this.model, 'revokeByGrantId');
  }

  async findByUid(_uid: string): Promise<undefined> {
    return undefined;
  }

  async findByUserCode(_userCode: string): Promise<undefined> {
    return undefined;
  }
}

/**
 * Clients are public (PKCE, no secret). A secret can never reach the
 * table even if the library generated one for a request that asked for a
 * confidential method: it is dropped here as well as by the registration
 * policy.
 */
/** Client ids are issued by the library: URL-safe random strings. */
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

class ClientStore extends BaseStore {
  async upsert(id: string, payload: AdapterPayload): Promise<void> {
    const {
      client_secret: _secret,
      client_secret_expires_at: _secretExpiry,
      ...metadata
    } = payload as Row;
    const redirectUris = Array.isArray(metadata.redirect_uris)
      ? metadata.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
      : [];
    await this.db.insert(oauthClients).values({
      clientId: id,
      clientName: typeof metadata.client_name === 'string' ? metadata.client_name : null,
      redirectUris,
      registrationType: 'dynamic',
      metadata,
    });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    // The id arrives straight from an unauthenticated request. Anything
    // that is not the shape this server issues can match no row, and
    // some of it (a null character) Postgres would refuse outright.
    if (!CLIENT_ID.test(id)) return undefined;
    const [row] = await this.db
      .select({ metadata: oauthClients.metadata })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, id))
      .limit(1);
    return row?.metadata as AdapterPayload | undefined;
  }

  async destroy(): Promise<void> {
    unsupported(this.model, 'destroy');
  }
}

/**
 * Grants are created by the consent service (it knows the workspace);
 * the library only reads them and, on reuse or revocation, destroys them.
 * A grant has no expiry of its own: it lives while its refresh chain does.
 */
class GrantStore extends BaseStore {
  constructor(
    db: DrizzleDb,
    model: string,
    private readonly reportReuse: ReuseReporter,
  ) {
    super(db, model);
  }

  async upsert(): Promise<void> {
    unsupported(this.model, 'upsert');
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const grant = await findLiveGrant(this.db, id);
    if (!grant) return undefined;
    return {
      jti: grant.id,
      kind: 'Grant',
      accountId: grant.userId,
      clientId: grant.clientId,
      resources: { [grant.resource]: grant.scopes.join(' ') },
      iat: epoch(grant.createdAt),
    } as AdapterPayload;
  }

  /**
   * The library destroys a grant in two situations: a client revoking its
   * own token (the revocation endpoint), and a used code or a rotated
   * refresh token being presented again (the token endpoint). Only the
   * second is reuse.
   */
  async destroy(id: string): Promise<void> {
    const revoked = await revokeGrant(this.db, id);
    const oidc = Provider.ctx?.oidc;
    if (revoked && oidc?.route === 'token') {
      const kind =
        oidc.params?.grant_type === 'authorization_code' ? 'authorization_code' : 'refresh_token';
      this.reportReuse({ ...revoked, kind });
    }
  }
}

class TokenStore extends BaseStore {
  constructor(
    db: DrizzleDb,
    model: string,
    private readonly kind: 'access' | 'refresh',
    private readonly reportReuse: ReuseReporter,
  ) {
    super(db, model);
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (!payload.grantId) throw new Error(`${this.model} was issued without a grant.`);
    const values = {
      grantId: payload.grantId,
      kind: this.kind,
      tokenHash: hashOAuthSecret(id),
      expiresAt: expiryOf(payload, expiresIn),
      payload: withoutSecret(payload),
    };
    if (this.kind === 'access') {
      await this.db.insert(oauthTokens).values(values);
      return;
    }

    // A refresh token minted by rotation inherits its predecessor's
    // family and the predecessor points at it. The library publishes the
    // token being rotated on the request context (documented `Provider.ctx`).
    const rotated = Provider.ctx?.oidc.entities.RotatedRefreshToken;
    const rotatedHash = rotated?.jti ? hashOAuthSecret(rotated.jti) : undefined;
    const [predecessor] = rotatedHash
      ? await this.db
          .select({ familyId: oauthTokens.familyId })
          .from(oauthTokens)
          .where(eq(oauthTokens.tokenHash, rotatedHash))
          .limit(1)
      : [];
    const [inserted] = await this.db
      .insert(oauthTokens)
      .values({ ...values, familyId: predecessor?.familyId ?? crypto.randomUUID() })
      .returning({ id: oauthTokens.id });
    if (rotatedHash && inserted) {
      await this.db
        .update(oauthTokens)
        .set({ replacedBy: inserted.id })
        .where(eq(oauthTokens.tokenHash, rotatedHash));
    }
  }

  /**
   * A consumed refresh token IS returned (with `consumed` set): that is
   * how the library recognises reuse and revokes the grant. A revoked
   * token is not. Whether the GRANT is still live is the library's next
   * question, answered by `GrantStore.find` — the resource server asks
   * both at once in `findAccessToken`.
   */
  async find(id: string): Promise<AdapterPayload | undefined> {
    const [row] = await this.db
      .select({ payload: oauthTokens.payload, consumedAt: oauthTokens.consumedAt })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.tokenHash, hashOAuthSecret(id)),
          eq(oauthTokens.kind, this.kind),
          isNull(oauthTokens.revokedAt),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.payload,
      jti: id,
      ...(row.consumedAt ? { consumed: epoch(row.consumedAt) } : {}),
    } as AdapterPayload;
  }

  override async consume(id: string): Promise<void> {
    const tokenHash = hashOAuthSecret(id);
    const consumed = await this.db
      .update(oauthTokens)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(oauthTokens.tokenHash, tokenHash),
          eq(oauthTokens.kind, this.kind),
          isNull(oauthTokens.consumedAt),
        ),
      )
      .returning({ id: oauthTokens.id });
    if (consumed.length > 0) return;

    // Someone else used this token between our read and this write.
    const [row] = await this.db
      .select({ grantId: oauthTokens.grantId })
      .from(oauthTokens)
      .where(eq(oauthTokens.tokenHash, tokenHash))
      .limit(1);
    const revoked = row ? await revokeGrant(this.db, row.grantId) : undefined;
    if (revoked) this.reportReuse({ ...revoked, kind: 'refresh_token' });
    throw new errors.InvalidGrant('refresh token already used');
  }

  async destroy(id: string): Promise<void> {
    await this.db
      .update(oauthTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(oauthTokens.tokenHash, hashOAuthSecret(id)),
          eq(oauthTokens.kind, this.kind),
          isNull(oauthTokens.revokedAt),
        ),
      );
  }

  override async revokeByGrantId(grantId: string): Promise<void> {
    await this.db
      .update(oauthTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(oauthTokens.grantId, grantId),
          eq(oauthTokens.kind, this.kind),
          isNull(oauthTokens.revokedAt),
        ),
      );
  }
}

class AuthorizationCodeStore extends BaseStore {
  constructor(
    db: DrizzleDb,
    model: string,
    private readonly reportReuse: ReuseReporter,
  ) {
    super(db, model);
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (!payload.grantId) throw new Error('Authorization code was issued without a grant.');
    // PKCE S256 is mandatory; a code without a challenge must never be
    // stored. The column CHECK is the last line; this is the readable one.
    if (!payload.codeChallenge || payload.codeChallengeMethod !== 'S256' || !payload.redirectUri) {
      throw new Error('Authorization code was issued without S256 PKCE or a redirect URI.');
    }
    await this.db.insert(oauthAuthCodes).values({
      codeHash: hashOAuthSecret(id),
      grantId: payload.grantId,
      codeChallenge: payload.codeChallenge,
      codeChallengeMethod: payload.codeChallengeMethod,
      redirectUri: payload.redirectUri,
      expiresAt: expiryOf(payload, expiresIn),
      payload: withoutSecret(payload),
    });
  }

  /** A used code IS returned (with `consumed`): the library revokes the grant on replay. */
  async find(id: string): Promise<AdapterPayload | undefined> {
    const [row] = await this.db
      .select({ payload: oauthAuthCodes.payload, usedAt: oauthAuthCodes.usedAt })
      .from(oauthAuthCodes)
      .where(eq(oauthAuthCodes.codeHash, hashOAuthSecret(id)))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.payload,
      jti: id,
      ...(row.usedAt ? { consumed: epoch(row.usedAt) } : {}),
    } as AdapterPayload;
  }

  override async consume(id: string): Promise<void> {
    const codeHash = hashOAuthSecret(id);
    const consumed = await this.db
      .update(oauthAuthCodes)
      .set({ usedAt: sql`now()` })
      .where(and(eq(oauthAuthCodes.codeHash, codeHash), isNull(oauthAuthCodes.usedAt)))
      .returning({ id: oauthAuthCodes.id });
    if (consumed.length > 0) return;

    const [row] = await this.db
      .select({ grantId: oauthAuthCodes.grantId })
      .from(oauthAuthCodes)
      .where(eq(oauthAuthCodes.codeHash, codeHash))
      .limit(1);
    const revoked = row ? await revokeGrant(this.db, row.grantId) : undefined;
    if (revoked) this.reportReuse({ ...revoked, kind: 'authorization_code' });
    throw new errors.InvalidGrant('authorization code already consumed');
  }

  async destroy(id: string): Promise<void> {
    await this.db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, hashOAuthSecret(id)));
  }

  override async revokeByGrantId(grantId: string): Promise<void> {
    await this.db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.grantId, grantId));
  }
}

/**
 * The in-flight authorization request, between /oauth/authorize and the
 * consent decision.
 *
 * The library records where to resume as a URL ending in the request id
 * (`returnTo`). Storing that would store the id in the clear, and the
 * URL's host is whatever host the request arrived on. Both go away by
 * not storing it: `find` rebuilds it from the configured issuer and the
 * id the caller presented.
 */
class InteractionStore extends BaseStore {
  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const { returnTo: _returnTo, ...stored } = withoutSecret(payload);
    const values = {
      payload: stored,
      expiresAt: expiryOf(payload, expiresIn),
    };
    await this.db
      .insert(oauthInteractions)
      .values({ idHash: hashOAuthSecret(id), ...values })
      .onConflictDoUpdate({ target: oauthInteractions.idHash, set: values });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const [row] = await this.db
      .select({ payload: oauthInteractions.payload })
      .from(oauthInteractions)
      .where(eq(oauthInteractions.idHash, hashOAuthSecret(id)))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.payload,
      jti: id,
      returnTo: `${oauthIssuer()}${OAUTH_RESUME_PATH}/${id}`,
    } as AdapterPayload;
  }

  async destroy(id: string): Promise<void> {
    await this.db
      .delete(oauthInteractions)
      .where(eq(oauthInteractions.idHash, hashOAuthSecret(id)));
  }
}

/**
 * The library keeps its own browser session so a returning person can
 * skip sign-in. We do not want a second login state: DeclutrMail's own
 * session cookie is the only authority, checked on the consent request.
 * Storing nothing means every authorization starts signed-out as far as
 * the library is concerned and must come back through consent.
 */
class NoSessionStore extends BaseStore {
  async upsert(): Promise<void> {}

  async find(): Promise<undefined> {
    return undefined;
  }

  async destroy(): Promise<void> {}
}

/** Any model this deployment does not use: fail loudly rather than store by accident. */
class UnsupportedStore extends BaseStore {
  async upsert(): Promise<void> {
    unsupported(this.model, 'upsert');
  }

  async find(): Promise<undefined> {
    unsupported(this.model, 'find');
  }

  async destroy(): Promise<void> {
    unsupported(this.model, 'destroy');
  }
}

/** The `adapter` option for `oidc-provider`: one store per model name. */
export function createOAuthStorageAdapter(
  db: DrizzleDb,
  reportReuse: ReuseReporter = () => undefined,
): (model: string) => Adapter {
  return (model) => {
    switch (model) {
      case 'Client':
        return new ClientStore(db, model);
      case 'Grant':
        return new GrantStore(db, model, reportReuse);
      case 'AccessToken':
        return new TokenStore(db, model, 'access', reportReuse);
      case 'RefreshToken':
        return new TokenStore(db, model, 'refresh', reportReuse);
      case 'AuthorizationCode':
        return new AuthorizationCodeStore(db, model, reportReuse);
      case 'Interaction':
        return new InteractionStore(db, model);
      case 'Session':
        return new NoSessionStore(db, model);
      default:
        return new UnsupportedStore(db, model);
    }
  };
}
