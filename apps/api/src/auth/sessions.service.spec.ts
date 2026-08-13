import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
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
