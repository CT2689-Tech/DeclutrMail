import { and, eq, exists, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import {
  accountDeletionRequests,
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthTokens,
  users,
} from '@declutrmail/db';

import type { DrizzleDb } from '../db/db.module.js';
import { hashOAuthSecret } from './oauth-hash.js';

/**
 * OAuth storage primitives (ADR-0048 rule 4, spec §7).
 *
 * Plain functions over a Drizzle handle, so the same statement can run on
 * the pool or inside a caller's transaction (account deletion revokes
 * grants in the transaction that records the request). Nothing here makes
 * a network call or publishes to a queue.
 *
 * A grant is the unit of revocation. Every token lookup joins its grant
 * and refuses a revoked one, so setting `oauth_grants.revoked_at` alone
 * already makes every token of that grant a 401; the token and code rows
 * are stamped as well so the tables tell the same story.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A grant id is a Postgres uuid; anything else can match no row. */
export function isGrantId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** `last_used_at` is presence telemetry: one write per grant per five minutes. */
const LAST_USED_WRITE_INTERVAL = sql`interval '5 minutes'`;

export interface NewGrant {
  workspaceId: string;
  userId: string;
  clientId: string;
  scopes: string[];
  resource: string;
}

/**
 * Record a person's approval. The client is stamped in the same
 * transaction: `last_granted_at` is what keeps an approved app's
 * registration out of the retention sweep.
 */
export async function createGrant(db: DrizzleDb, grant: NewGrant): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(oauthGrants).values(grant).returning({ id: oauthGrants.id });
    if (!row) throw new Error('Failed to create oauth_grants row.');
    await tx
      .update(oauthClients)
      .set({ lastGrantedAt: sql`now()` })
      .where(eq(oauthClients.clientId, grant.clientId));
    return row.id;
  });
}

/**
 * Connecting an app again replaces its earlier connection: revoke every
 * other live grant the same person gave the same client. Otherwise the
 * old refresh token keeps working beside the new one, and Settings lists
 * the same app twice.
 *
 * Called when the NEW grant's code is exchanged, never at Approve: until
 * then the new connection is not usable, and an approval that never
 * completes must not cost the person the connection they have.
 */
export async function revokeSupersededGrants(
  db: DrizzleDb,
  currentGrantId: string,
): Promise<RevokedGrant[]> {
  const [current] = await db
    .select({ userId: oauthGrants.userId, clientId: oauthGrants.clientId })
    .from(oauthGrants)
    .where(eq(oauthGrants.id, currentGrantId))
    .limit(1);
  if (!current) return [];
  const superseded = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(
      and(
        eq(oauthGrants.userId, current.userId),
        eq(oauthGrants.clientId, current.clientId),
        ne(oauthGrants.id, currentGrantId),
        isNull(oauthGrants.revokedAt),
      ),
    );
  const revoked: RevokedGrant[] = [];
  for (const { id } of superseded) {
    const grant = await revokeGrant(db, id);
    if (grant) revoked.push(grant);
  }
  return revoked;
}

/** The live grant, or undefined when it is unknown or revoked. */
export async function findLiveGrant(db: DrizzleDb, grantId: string) {
  if (!isGrantId(grantId)) return undefined;
  const [row] = await db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .limit(1);
  return row;
}

/** The grant a call to `revokeGrant` actually revoked. */
export interface RevokedGrant {
  grantId: string;
  userId: string;
  workspaceId: string;
  clientId: string;
}

/**
 * Revoke one grant and everything minted under it. Idempotent: a second
 * call changes nothing. Returns the grant when THIS call revoked it, and
 * undefined when it was unknown or already revoked.
 */
export async function revokeGrant(
  db: DrizzleDb,
  grantId: string,
): Promise<RevokedGrant | undefined> {
  if (!isGrantId(grantId)) return undefined;
  const [revoked] = await db
    .update(oauthGrants)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)))
    .returning({
      grantId: oauthGrants.id,
      userId: oauthGrants.userId,
      workspaceId: oauthGrants.workspaceId,
      clientId: oauthGrants.clientId,
    });
  await db
    .update(oauthTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
  await db.delete(oauthAuthCodes).where(eq(oauthAuthCodes.grantId, grantId));
  return revoked;
}

/**
 * Revoke every grant a person holds (spec §7: when account deletion
 * starts, not when its window ends). Returns the revoked grant ids.
 */
export async function revokeGrantsForUser(db: DrizzleDb, userId: string): Promise<string[]> {
  const revoked = await db
    .update(oauthGrants)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)))
    .returning({ id: oauthGrants.id });
  const ids = revoked.map((row) => row.id);
  if (ids.length > 0) {
    await db
      .update(oauthTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(inArray(oauthTokens.grantId, ids), isNull(oauthTokens.revokedAt)));
    await db.delete(oauthAuthCodes).where(inArray(oauthAuthCodes.grantId, ids));
  }
  return ids;
}

/** Whether the person has an account deletion in flight (pending or executing). */
export async function hasDeletionInFlight(db: DrizzleDb, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accountDeletionRequests.id })
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        inArray(accountDeletionRequests.status, ['pending', 'executing']),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A person who may hold OAuth access: the user row exists and no account
 * deletion is in flight. The second line of defence behind grant
 * revocation — a code exchange or refresh for an account on its way out
 * fails even if a grant somehow outlived the deletion request.
 */
export async function findAuthorizableUser(
  db: DrizzleDb,
  userId: string,
): Promise<{ userId: string; workspaceId: string } | undefined> {
  if (!isGrantId(userId)) return undefined;
  const [user] = await db
    .select({ userId: users.id, workspaceId: users.workspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return undefined;
  if (await hasDeletionInFlight(db, userId)) return undefined;
  return user;
}

export interface VerifiedAccessToken {
  grantId: string;
  userId: string;
  workspaceId: string;
  clientId: string;
  scopes: string[];
  /** RFC 8707 audience the token was issued for. */
  resource: string;
  expiresAt: Date;
}

/**
 * Resolve a presented bearer token to its grant, or undefined when it is
 * unknown, not an access token, revoked, or its grant is revoked. Expiry
 * is reported, not judged, so the caller can say "expired" rather than
 * "invalid".
 */
export async function findAccessToken(
  db: DrizzleDb,
  token: string,
): Promise<VerifiedAccessToken | undefined> {
  const [row] = await db
    .select({
      grantId: oauthGrants.id,
      userId: oauthGrants.userId,
      workspaceId: oauthGrants.workspaceId,
      clientId: oauthGrants.clientId,
      resource: oauthGrants.resource,
      expiresAt: oauthTokens.expiresAt,
      payload: oauthTokens.payload,
    })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .where(
      and(
        eq(oauthTokens.tokenHash, hashOAuthSecret(token)),
        eq(oauthTokens.kind, 'access'),
        isNull(oauthTokens.revokedAt),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  // The scopes and audience of THIS token, as the authorization server
  // issued it — never wider than the grant, possibly narrower.
  const scope = typeof row.payload.scope === 'string' ? row.payload.scope : '';
  const audience = typeof row.payload.aud === 'string' ? row.payload.aud : '';
  return {
    grantId: row.grantId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    scopes: scope.split(' ').filter(Boolean),
    resource: audience,
    expiresAt: row.expiresAt,
  };
}

/** Coalesced `last_used_at` write; a no-op inside the five-minute window. */
export async function touchGrantLastUsed(db: DrizzleDb, grantId: string): Promise<void> {
  await db
    .update(oauthGrants)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(oauthGrants.id, grantId),
        or(
          isNull(oauthGrants.lastUsedAt),
          lt(oauthGrants.lastUsedAt, sql`now() - ${LAST_USED_WRITE_INTERVAL}`),
        ),
      ),
    );
}

export interface ConnectedGrant {
  id: string;
  appName: string | null;
  /** Every redirect URI the app registered; the name alone is self-declared. */
  redirectUris: string[];
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * The apps that can act for this person right now: unrevoked grants with
 * a token that still works. A grant whose every token has expired or been
 * used up is no longer a connection, so it is not listed.
 */
export async function listConnectedGrants(
  db: DrizzleDb,
  userId: string,
): Promise<ConnectedGrant[]> {
  return db
    .select({
      id: oauthGrants.id,
      appName: oauthClients.clientName,
      redirectUris: oauthClients.redirectUris,
      scopes: oauthGrants.scopes,
      createdAt: oauthGrants.createdAt,
      lastUsedAt: oauthGrants.lastUsedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
    .where(
      and(
        eq(oauthGrants.userId, userId),
        isNull(oauthGrants.revokedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(oauthTokens)
            .where(
              and(
                eq(oauthTokens.grantId, oauthGrants.id),
                isNull(oauthTokens.revokedAt),
                isNull(oauthTokens.consumedAt),
                gt(oauthTokens.expiresAt, sql`now()`),
              ),
            ),
        ),
      ),
    )
    .orderBy(oauthGrants.createdAt);
}

/** Revoke a grant only if it belongs to this person. */
export async function revokeOwnedGrant(
  db: DrizzleDb,
  userId: string,
  grantId: string,
): Promise<'revoked' | 'already_revoked' | 'not_found'> {
  if (!isGrantId(grantId)) return 'not_found';
  const [owned] = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
    .limit(1);
  if (!owned) return 'not_found';
  return (await revokeGrant(db, grantId)) ? 'revoked' : 'already_revoked';
}
