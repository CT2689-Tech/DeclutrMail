import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { hashRefreshToken } from './jwt.service.js';
import type { JwtService } from './jwt.service.js';
import { SessionsService } from './sessions.service.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

describe('SessionsService.lookupActiveById', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('returns the active session with its current joined workspace and excludes revoked or missing ids', async () => {
    const [originalWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'Original workspace' })
      .returning({ id: workspaces.id });
    const [currentWorkspace] = await db
      .insert(workspaces)
      .values({ name: 'Current workspace' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: originalWorkspace!.id, email: 'session-lookup@example.com' })
      .returning({ id: users.id });
    const [activeSession] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti: randomUUID(),
        refreshTokenHash: 'active-refresh-hash',
      })
      .returning({ id: activeSessions.id });
    const [revokedSession] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti: randomUUID(),
        refreshTokenHash: 'revoked-refresh-hash',
        isRevoked: true,
        revokedAt: new Date(),
      })
      .returning({ id: activeSessions.id });

    // The OAuth callback must bind against the user's workspace now, not a
    // stale workspace value that existed when the session row was created.
    await db.update(users).set({ workspaceId: currentWorkspace!.id }).where(eq(users.id, user!.id));

    const service = new SessionsService(db as unknown as DrizzleDb, null, {} as JwtService);

    await expect(service.lookupActiveById(activeSession!.id)).resolves.toEqual({
      id: activeSession!.id,
      userId: user!.id,
      workspaceId: currentWorkspace!.id,
    });
    await expect(service.lookupActiveById(revokedSession!.id)).resolves.toBeNull();
    await expect(service.lookupActiveById(randomUUID())).resolves.toBeNull();
  });
});

describe('SessionsService.rotate — refresh-token reuse defense (D155)', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    await pg.close();
  });

  // Regression: the revoke used to be written and then thrown away.
  // `rotate()` wrote `is_revoked = true` and threw from inside the same
  // `db.transaction` callback, so Drizzle rolled the write back and the
  // replayed session stayed live — the defense recorded nothing and
  // stopped nothing. Asserting the REJECTION alone still passes against
  // that bug, so the load-bearing assertion here is the row read after.
  it('revokes the session durably when a stale refresh token is presented', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Reuse defense workspace' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'refresh-reuse@example.com' })
      .returning({ id: users.id });
    const [session] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti: randomUUID(),
        refreshTokenHash: hashRefreshToken('the-current-refresh-token'),
      })
      .returning({ id: activeSessions.id });

    const service = new SessionsService(db as unknown as DrizzleDb, null, {} as JwtService);

    await expect(
      service.rotate({
        sessionId: session!.id,
        presentedRefreshToken: 'an-older-leaked-refresh-token',
      }),
    ).rejects.toThrow(/reuse detected/i);

    const [row] = await db
      .select({ isRevoked: activeSessions.isRevoked, revokedAt: activeSessions.revokedAt })
      .from(activeSessions)
      .where(eq(activeSessions.id, session!.id))
      .limit(1);

    expect(row!.isRevoked).toBe(true);
    expect(row!.revokedAt).not.toBeNull();
  });

  // A second replay must not find a live session to attack.
  it('leaves the revoked session unusable for a subsequent rotation attempt', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Reuse defense workspace 2' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'refresh-reuse-2@example.com' })
      .returning({ id: users.id });
    const [session] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti: randomUUID(),
        refreshTokenHash: hashRefreshToken('current-token'),
      })
      .returning({ id: activeSessions.id });

    const service = new SessionsService(db as unknown as DrizzleDb, null, {} as JwtService);

    await expect(
      service.rotate({ sessionId: session!.id, presentedRefreshToken: 'stale' }),
    ).rejects.toThrow(/reuse detected/i);

    // Even the LEGITIMATE holder is locked out now — that is the
    // intended defensive posture, and it only holds if the revoke
    // actually persisted.
    await expect(
      service.rotate({ sessionId: session!.id, presentedRefreshToken: 'current-token' }),
    ).rejects.toThrow(/not found or revoked/i);
  });
});
