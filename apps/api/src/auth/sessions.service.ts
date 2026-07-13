import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { and, eq } from 'drizzle-orm';

import { activeSessions, users } from '@declutrmail/db';
import type { ActiveSession } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { JwtService, hashRefreshToken, type IssuedTokens } from './jwt.service.js';

/** DI token for the optional Redis client used to cache revoke lookups. */
export const SESSIONS_REDIS = 'SESSIONS_REDIS';

/**
 * Cache TTL for the per-jti revoke check. 60s strikes the documented
 * D155 balance: hot-path lookups hit Redis ~always; an admin/user
 * revoke takes at most 60s to propagate to every API instance after
 * the cache key is invalidated. The cache key is invalidated
 * immediately on revoke from the SAME process, so the 60s lag only
 * affects other instances during a horizontal-scale deployment.
 */
const REVOKE_CACHE_TTL_SEC = 60;

/** What the JwtGuard hangs off `req.user` after a successful verify. */
export interface SessionPrincipal {
  userId: string;
  workspaceId: string;
  sessionId: string;
  /** `active_sessions.jti` — exposed so handlers can revoke if needed. */
  jti: string;
}

/**
 * SessionsService (D155).
 *
 * Owns the lifecycle of `active_sessions` rows:
 *
 *   - issue(userId, ...)      — insert + return the JWT pair
 *   - rotate(sessionId)       — revoke old jti, issue fresh pair under same sessionId
 *   - revoke(sessionId)       — flag is_revoked=true; clear Redis cache key
 *   - lookup(jti)             — read with Redis cache for the JwtGuard hot path
 *
 * Redis cache value semantics: presence of key `session:revoked:<jti>` =
 * "this jti is revoked, deny". Absence = "no opinion, check DB". This
 * way the cache only stores the small NEGATIVE set, not every active
 * session; a Redis flush degrades cleanly to "always check DB".
 */
@Injectable()
export class SessionsService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(SESSIONS_REDIS) private readonly redis: Redis | null,
    private readonly jwt: JwtService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        /* noop on shutdown */
      });
    }
  }

  /**
   * Create a fresh session row and JWT pair for a logging-in user.
   * Insert + JWT issuance happen in lock-step so the persisted row
   * carries the same jti/refresh hash the client sees.
   */
  async issue(input: {
    userId: string;
    workspaceId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ tokens: IssuedTokens; sessionId: string }> {
    // Pre-allocate a session id so the JWT can carry it.
    const [row] = await this.db
      .insert(activeSessions)
      .values({
        userId: input.userId,
        jti: crypto.randomUUID(),
        refreshTokenHash: '', // updated below in the same transaction-of-two
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .returning({ id: activeSessions.id });
    if (!row) {
      throw new Error('Failed to create active_sessions row.');
    }

    const tokens = await this.jwt.issue({
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: row.id,
    });

    // Patch the row with the canonical jti + refresh hash. We could not
    // know these before the JWT issue, hence the two-step write.
    await this.db
      .update(activeSessions)
      .set({ jti: tokens.jti, refreshTokenHash: tokens.refreshTokenHash })
      .where(eq(activeSessions.id, row.id));

    return { tokens, sessionId: row.id };
  }

  /**
   * Rotate refresh — issue a fresh JWT pair under the same session id
   * and update the row's jti + refresh hash. The old jti is no longer
   * valid (the UNIQUE constraint on jti means the row only carries the
   * latest). Returns the new tokens for the cookie reset.
   *
   * ATOMICITY (Codex review 2026-05-27, finding #1). The read /
   * compare / update runs inside a single transaction with a
   * `SELECT … FOR UPDATE` row lock so two concurrent /auth/refresh
   * calls cannot both pass the hash check and both issue tokens —
   * second writer would otherwise win the row and the first browser's
   * cookies would carry a `jti` that no longer matches the DB,
   * causing immediate 401s. The row lock serialises rotation; the
   * loser sees the now-rotated hash and either gets the SAME tokens
   * (grace) or trips the reuse-defense revoke path.
   *
   * Verifies the presented refresh hash matches the row, refusing
   * rotation on a stale/leaked refresh.
   */
  async rotate(input: { sessionId: string; presentedRefreshToken: string }): Promise<IssuedTokens> {
    const presented = hashRefreshToken(input.presentedRefreshToken);
    let oldJti: string | null = null;

    const tokens = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(activeSessions)
        .where(and(eq(activeSessions.id, input.sessionId), eq(activeSessions.isRevoked, false)))
        .for('update')
        .limit(1);
      if (!row) {
        throw new Error('Session not found or revoked.');
      }
      if (row.refreshTokenHash !== presented) {
        // Refresh token reuse: someone tried to use an older refresh.
        // Revoke the session entirely — defensive posture (D155).
        // Do it inside the SAME tx so the revoke is atomic with the
        // detection.
        await tx
          .update(activeSessions)
          .set({ isRevoked: true, revokedAt: new Date() })
          .where(eq(activeSessions.id, row.id));
        oldJti = row.jti;
        throw new Error('Refresh token reuse detected — session revoked.');
      }

      const issued = await this.jwt.issue({
        userId: row.userId,
        workspaceId: await this.lookupWorkspaceId(row.userId, tx),
        sessionId: row.id,
      });
      await tx
        .update(activeSessions)
        .set({
          jti: issued.jti,
          refreshTokenHash: issued.refreshTokenHash,
          lastUsedAt: new Date(),
        })
        .where(eq(activeSessions.id, row.id));
      oldJti = row.jti;
      return issued;
    });

    // Old jti is gone — clear its cache key if any. Done outside the
    // tx because cache invalidation does not need to be transactional
    // with the DB write (worst case: a stale negative-cache hit blocks
    // a request for up to 60s, never a correctness problem).
    if (oldJti) {
      await this.invalidateCache(oldJti);
    }
    return tokens;
  }

  /**
   * Revoke a session — flag the row and prime the negative cache so
   * other API instances see the revoke within the cache TTL.
   */
  async revoke(sessionId: string): Promise<void> {
    const [row] = await this.db
      .update(activeSessions)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(activeSessions.id, sessionId))
      .returning({ jti: activeSessions.jti });
    if (row) {
      await this.markRevokedInCache(row.jti);
    }
  }

  /**
   * Hot-path lookup used by the JwtGuard. Returns the session row when
   * it exists AND is not revoked, otherwise null. Negative cache short-
   * circuits the DB hit for known-revoked jtis.
   */
  async lookupByJti(jti: string): Promise<ActiveSession | null> {
    if (await this.isRevokedInCache(jti)) {
      return null;
    }
    const [row] = await this.db
      .select()
      .from(activeSessions)
      .where(and(eq(activeSessions.jti, jti), eq(activeSessions.isRevoked, false)))
      .limit(1);
    if (!row) {
      // Either no such jti or it's revoked — both → cache as revoked
      // so the next call short-circuits.
      await this.markRevokedInCache(jti);
      return null;
    }
    // Best-effort lastUsedAt bump. Not awaited on the hot path — a
    // missed bump is harmless; the row will refresh on the next call.
    void this.db
      .update(activeSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(activeSessions.id, row.id))
      .catch((err: unknown) => {
        this.logger.warn(`lastUsedAt bump failed: ${err instanceof Error ? err.message : err}`);
      });
    return row;
  }

  /**
   * Stable-session lookup for flows that outlive one access-token rotation.
   * Unlike lookupByJti, this follows `active_sessions.id`, which remains fixed
   * while refresh rotation replaces the row's jti. Revoked rows never pass.
   */
  async lookupActiveById(
    sessionId: string,
  ): Promise<{ id: string; userId: string; workspaceId: string } | null> {
    const [row] = await this.db
      .select({
        id: activeSessions.id,
        userId: activeSessions.userId,
        workspaceId: users.workspaceId,
      })
      .from(activeSessions)
      .innerJoin(users, eq(activeSessions.userId, users.id))
      .where(and(eq(activeSessions.id, sessionId), eq(activeSessions.isRevoked, false)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Workspace id for `userId`. Accepts an optional `tx` so rotate can
   * read the user row inside the same transaction as the session row
   * lock — both reads see a consistent snapshot.
   */
  private async lookupWorkspaceId(userId: string, tx: DrizzleDb = this.db): Promise<string> {
    const [row] = await tx
      .select({ workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      throw new Error(`User ${userId} not found while rotating session.`);
    }
    return row.workspaceId;
  }

  private cacheKey(jti: string): string {
    return `session:revoked:${jti}`;
  }

  private async isRevokedInCache(jti: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const v = await this.redis.get(this.cacheKey(jti));
      return v === '1';
    } catch {
      return false; // fail open to DB lookup
    }
  }

  private async markRevokedInCache(jti: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(this.cacheKey(jti), '1', 'EX', REVOKE_CACHE_TTL_SEC);
    } catch {
      // Cache miss is acceptable — DB stays source of truth.
    }
  }

  private async invalidateCache(jti: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.cacheKey(jti));
    } catch {
      /* noop */
    }
  }
}
