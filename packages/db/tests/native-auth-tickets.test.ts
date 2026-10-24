import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { activeSessions, nativeAuthTickets, users, workspaces } from '../src';
import { freshTestDb } from '../src/testing';

/**
 * native_auth_tickets (migration 0098, ADR-0049).
 *
 * The table is the only thing the system browser and the app share during a
 * native sign-in, so what matters is the shape it refuses, that a ticket is
 * redeemable exactly once, and that it cannot outlive its user or session.
 */

async function seed() {
  const db = await freshTestDb();
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email: 'a@b.com' })
    .returning({ id: users.id });
  const [session] = await db
    .insert(activeSessions)
    .values({ userId: user!.id, jti: crypto.randomUUID(), refreshTokenHash: 'h' })
    .returning({ id: activeSessions.id });
  return { db, userId: user!.id, sessionId: session!.id };
}

const inAMinute = () => new Date(Date.now() + 60_000);
const hash = (n: number) => `${n}`.padStart(64, '0');

describe('native_auth_tickets', () => {
  it('accepts a well-formed handoff and a well-formed connect_start', async () => {
    const { db, userId, sessionId } = await seed();
    await db.insert(nativeAuthTickets).values([
      {
        kind: 'handoff',
        codeHash: hash(1),
        userId,
        sessionId,
        codeChallenge: 'c'.repeat(43),
        returnTo: '/home',
        expiresAt: inAMinute(),
      },
      {
        kind: 'connect_start',
        codeHash: hash(2),
        userId,
        sessionId,
        options: { reconnectMailboxId: crypto.randomUUID() },
        expiresAt: inAMinute(),
      },
    ]);
    const rows = await db.select().from(nativeAuthTickets);
    expect(rows.map((r) => r.kind).sort()).toEqual(['connect_start', 'handoff']);
  });

  it.each([
    ['an unknown kind', { kind: 'other', codeChallenge: 'c', returnTo: '/home' }],
    ['a handoff without a challenge', { kind: 'handoff', returnTo: '/home' }],
    ['a handoff without a destination', { kind: 'handoff', codeChallenge: 'c' }],
    [
      'a handoff carrying connect options',
      { kind: 'handoff', codeChallenge: 'c', returnTo: '/home', options: {} },
    ],
    ['a connect_start carrying a challenge', { kind: 'connect_start', codeChallenge: 'c' }],
    ['a connect_start carrying a destination', { kind: 'connect_start', returnTo: '/home' }],
  ])('refuses %s', async (_name, fields) => {
    const { db, userId, sessionId } = await seed();
    await expect(
      db.insert(nativeAuthTickets).values({
        codeHash: hash(3),
        userId,
        sessionId,
        expiresAt: inAMinute(),
        ...fields,
      }),
    ).rejects.toThrow();
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
  });

  it('refuses a second ticket with the same code hash', async () => {
    const { db, userId, sessionId } = await seed();
    const row = {
      kind: 'connect_start',
      codeHash: hash(4),
      userId,
      sessionId,
      expiresAt: inAMinute(),
    };
    await db.insert(nativeAuthTickets).values(row);
    await expect(db.insert(nativeAuthTickets).values(row)).rejects.toThrow();
  });

  it('redeems once: DELETE … RETURNING hands the row to exactly one caller', async () => {
    const { db, userId, sessionId } = await seed();
    await db.insert(nativeAuthTickets).values({
      kind: 'connect_start',
      codeHash: hash(5),
      userId,
      sessionId,
      expiresAt: inAMinute(),
    });
    const redeem = () =>
      db
        .delete(nativeAuthTickets)
        .where(
          sql`${nativeAuthTickets.codeHash} = ${hash(5)} AND ${nativeAuthTickets.expiresAt} > now()`,
        )
        .returning({ id: nativeAuthTickets.id });
    expect(await redeem()).toHaveLength(1);
    expect(await redeem()).toHaveLength(0);
  });

  it('does not redeem an expired ticket', async () => {
    const { db, userId, sessionId } = await seed();
    await db.insert(nativeAuthTickets).values({
      kind: 'connect_start',
      codeHash: hash(6),
      userId,
      sessionId,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const redeemed = await db
      .delete(nativeAuthTickets)
      .where(
        sql`${nativeAuthTickets.codeHash} = ${hash(6)} AND ${nativeAuthTickets.expiresAt} > now()`,
      )
      .returning({ id: nativeAuthTickets.id });
    expect(redeemed).toEqual([]);
  });

  it('takes its tickets with the session, and with the user', async () => {
    const { db, userId, sessionId } = await seed();
    const [other] = await db
      .insert(activeSessions)
      .values({ userId, jti: crypto.randomUUID(), refreshTokenHash: 'h2' })
      .returning({ id: activeSessions.id });
    const ticket = (n: number, session: string) => ({
      kind: 'connect_start' as const,
      codeHash: hash(n),
      userId,
      sessionId: session,
      expiresAt: inAMinute(),
    });
    await db.insert(nativeAuthTickets).values([ticket(7, sessionId), ticket(8, other!.id)]);

    await db.delete(activeSessions).where(eq(activeSessions.id, sessionId));
    expect((await db.select().from(nativeAuthTickets)).map((r) => r.codeHash)).toEqual([hash(8)]);

    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(nativeAuthTickets)).toEqual([]);
  });
});
