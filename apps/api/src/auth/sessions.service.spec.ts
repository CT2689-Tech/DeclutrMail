import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { freshTestPglite } from '@declutrmail/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { hashRefreshToken, JwtService } from './jwt.service.js';
import { SessionsService } from './sessions.service.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

describe('SessionsService.lookupByJti hot-path writes', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('coalesces repeated last-used bumps for one active session', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Session touch workspace' })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email: 'session-touch@example.com' })
      .returning({ id: users.id });
    const oldLastUsed = new Date('2020-01-01T00:00:00Z');
    const jti = randomUUID();
    const [session] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti,
        refreshTokenHash: 'touch-refresh-hash',
        lastUsedAt: oldLastUsed,
      })
      .returning({ id: activeSessions.id });
    const service = new SessionsService(db as unknown as DrizzleDb, null, {} as JwtService);

    await expect(service.lookupByJti(jti)).resolves.toMatchObject({ id: session!.id });
    await vi.waitFor(async () => {
      const [row] = await db
        .select({ lastUsedAt: activeSessions.lastUsedAt })
        .from(activeSessions)
        .where(eq(activeSessions.id, session!.id));
      expect(row!.lastUsedAt.getTime()).toBeGreaterThan(oldLastUsed.getTime());
    });

    // A second authenticated request in the same burst still validates
    // against the database, but must not create another UPDATE/dead tuple.
    const sentinel = new Date('2021-01-01T00:00:00Z');
    await db
      .update(activeSessions)
      .set({ lastUsedAt: sentinel })
      .where(eq(activeSessions.id, session!.id));
    await expect(service.lookupByJti(jti)).resolves.toMatchObject({ id: session!.id });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [row] = await db
      .select({ lastUsedAt: activeSessions.lastUsedAt })
      .from(activeSessions)
      .where(eq(activeSessions.id, session!.id));
    expect(row!.lastUsedAt).toEqual(sentinel);
  });
});

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

describe('SessionsService.rotate — concurrent-race grace window (QA-onboarding-20260828-03)', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
    pg = await freshTestPglite();
    db = drizzle(pg, { schema });
  });

  afterAll(async () => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    await pg.close();
  });

  async function seedSession(email: string) {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Grace window workspace ${email}` })
      .returning({ id: workspaces.id });
    const [user] = await db
      .insert(users)
      .values({ workspaceId: workspace!.id, email })
      .returning({ id: users.id });
    const [session] = await db
      .insert(activeSessions)
      .values({
        userId: user!.id,
        jti: randomUUID(),
        refreshTokenHash: hashRefreshToken('gen1-token'),
      })
      .returning({ id: activeSessions.id });
    return session!.id;
  }

  // The actual bug: two browser tabs racing the same token boundary,
  // genuinely concurrently — not two sequential awaits, which the
  // pre-fix code already handled fine via the FOR UPDATE lock. Both
  // `rotate()` calls fire before either resolves.
  it('lets a true concurrent race succeed for both callers instead of revoking the session', async () => {
    const sessionId = await seedSession('grace-race@example.com');
    const service = new SessionsService(db as unknown as DrizzleDb, null, new JwtService());

    const [a, b] = await Promise.allSettled([
      service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }),
      service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const [row] = await db
      .select()
      .from(activeSessions)
      .where(eq(activeSessions.id, sessionId))
      .limit(1);
    // The session survived the race — the defect this fixes revoked it.
    expect(row!.isRevoked).toBe(false);
    // Both callers' new tokens are distinct generations (gen2, then gen3
    // for the grace-hit loser) — never the same token pair reused, and
    // the row landed on the LATER one.
    if (a.status === 'fulfilled' && b.status === 'fulfilled') {
      expect(a.value.refreshTokenHash).not.toBe(b.value.refreshTokenHash);
      const winnerFirst = row!.previousRefreshTokenHash === a.value.refreshTokenHash;
      const loserFirst = row!.previousRefreshTokenHash === b.value.refreshTokenHash;
      expect(winnerFirst || loserFirst).toBe(true);
    }
  });

  it('accepts the immediately-prior hash within the grace window as a fresh rotation, not reuse', async () => {
    const sessionId = await seedSession('grace-sequential@example.com');
    const service = new SessionsService(db as unknown as DrizzleDb, null, new JwtService());

    const first = await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' });
    // Sequential, not concurrent — proves the grace path itself, isolated
    // from the FOR UPDATE lock's own serialization.
    const second = await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' });

    expect(second.refreshTokenHash).not.toBe(first.refreshTokenHash);
    const [row] = await db
      .select({ isRevoked: activeSessions.isRevoked })
      .from(activeSessions)
      .where(eq(activeSessions.id, sessionId))
      .limit(1);
    expect(row!.isRevoked).toBe(false);
  });

  // Security-review finding (2026-08-30): a grace-hit and an ordinary
  // rotation were otherwise indistinguishable to an operator — the ONE
  // signal that a same-window collision happened at all is this log line.
  // Without it, a stolen-token collision that survives via grace leaves no
  // trace anywhere.
  it('logs a distinct warning on a grace-hit, and logs nothing extra on an ordinary rotation', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sessionId = await seedSession('grace-observability@example.com');
    const service = new SessionsService(db as unknown as DrizzleDb, null, new JwtService());

    await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }); // ordinary — no grace hit possible yet
    expect(warn).not.toHaveBeenCalled();

    await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }); // grace hit
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('grace window');
    expect(warn.mock.calls[0]?.[0]).toContain(sessionId);

    warn.mockRestore();
  });

  it('still fully revokes once the grace window has expired — no standing bypass', async () => {
    const sessionId = await seedSession('grace-expired@example.com');
    const service = new SessionsService(db as unknown as DrizzleDb, null, new JwtService());

    await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' });
    // Backdate the grace deadline into the past — same effect as waiting
    // out REFRESH_GRACE_WINDOW_MS, without a real 30s test.
    await db
      .update(activeSessions)
      .set({ previousHashExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(activeSessions.id, sessionId));

    await expect(
      service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }),
    ).rejects.toThrow(/reuse detected/i);

    const [row] = await db
      .select({ isRevoked: activeSessions.isRevoked })
      .from(activeSessions)
      .where(eq(activeSessions.id, sessionId))
      .limit(1);
    expect(row!.isRevoked).toBe(true);
  });

  it('still fully revokes a hash from two generations back — the window is exactly one generation, never a standing bypass', async () => {
    const sessionId = await seedSession('grace-two-back@example.com');
    const service = new SessionsService(db as unknown as DrizzleDb, null, new JwtService());

    const first = await service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }); // -> gen2
    // The RAW gen2 token (never the hash) — mirrors what the browser
    // actually holds after a rotation.
    await service.rotate({ sessionId, presentedRefreshToken: first.refreshToken }); // gen2 -> gen3

    // gen1-token was legitimate once but is no longer current NOR the
    // immediately-prior generation (gen2 is).
    await expect(
      service.rotate({ sessionId, presentedRefreshToken: 'gen1-token' }),
    ).rejects.toThrow(/reuse detected/i);

    const [row] = await db
      .select({ isRevoked: activeSessions.isRevoked })
      .from(activeSessions)
      .where(eq(activeSessions.id, sessionId))
      .limit(1);
    expect(row!.isRevoked).toBe(true);
  });
});
