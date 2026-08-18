import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/pglite';
import type { schema } from '@declutrmail/db';
import {
  accountDeletionRequests,
  activeSessions,
  activityLog,
  mailboxAccounts,
  senderPolicies,
  triageDecisions,
  users,
  workspaces,
} from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { describe, expect, it } from 'vitest';

import { LapseReengagementWorker, type PreparedLapseEmail } from './lapse-reengagement.worker.js';
import type { EmailSendJobData } from './email-send.worker.js';
import type { WorkerContext } from './worker-context.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function freshDb(): Promise<Db> {
  return freshTestDb();
}

interface SeedInput {
  email: string;
  /** Days before NOW the account was created. */
  ageDays: number;
  /** Days before NOW the user was last seen; omit for "never signed in". */
  lastSeenDaysAgo?: number;
  /** Non-Keep triage verdicts awaiting a decision. */
  pending?: number;
  protectPending?: boolean;
  /** Write a K/A/U/L/D activity row for each pending sender ("already decided"). */
  decidePending?: boolean;
  /** D232 in-flight account deletion. */
  deletionStatus?: 'pending' | 'executing' | 'cancelled' | 'completed';
  /** Turn OFF the shared `reminders` opt-out. */
  remindersOff?: boolean;
}

interface Seeded {
  userId: string;
  mailboxId: string;
}

/**
 * `clock` defaults to NOW, so every existing call is unchanged. It
 * exists so a test can seed against a clock deliberately far from real
 * time — see "evaluates the decided-window against the INJECTED clock".
 */
async function seedUser(db: Db, input: SeedInput, clock: Date = NOW): Promise<Seeded> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: input.email, tier: 'free' })
    .returning({ id: workspaces.id });
  const [user] = await db
    .insert(users)
    .values({
      workspaceId: workspace!.id,
      email: input.email,
      createdAt: new Date(clock.getTime() - input.ageDays * DAY_MS),
      ...(input.remindersOff ? { preferences: { emailPrefs: { reminders: false } } } : {}),
    })
    .returning({ id: users.id });

  if (input.deletionStatus) {
    await db.insert(accountDeletionRequests).values({
      userId: user!.id,
      effectiveAt: new Date(clock.getTime() + 7 * DAY_MS),
      basis: 'flat-grace',
      status: input.deletionStatus,
    });
  }
  const [mailbox] = await db
    .insert(mailboxAccounts)
    .values({
      workspaceId: workspace!.id,
      userId: user!.id,
      provider: 'gmail',
      providerAccountId: input.email,
    })
    .returning({ id: mailboxAccounts.id });

  if (input.lastSeenDaysAgo !== undefined) {
    await db.insert(activeSessions).values({
      userId: user!.id,
      jti: crypto.randomUUID(),
      refreshTokenHash: `hash-${input.email}`,
      lastUsedAt: new Date(clock.getTime() - input.lastSeenDaysAgo * DAY_MS),
    });
  }

  for (let index = 0; index < (input.pending ?? 0); index += 1) {
    const senderKey = `${input.email}-sender-${index}`;
    await db.insert(triageDecisions).values({
      mailboxAccountId: mailbox!.id,
      senderKey,
      verdict: 'archive',
      confidence: '0.90',
      reasoning: 'noisy',
      generatedBy: 'template',
      producedAt: new Date(clock.getTime() - 2 * DAY_MS),
      expiresAt: new Date(clock.getTime() + 30 * DAY_MS),
    });
    if (input.protectPending) {
      await db.insert(senderPolicies).values({
        mailboxAccountId: mailbox!.id,
        senderKey,
        isProtected: true,
        protectionReason: 'user_defined',
      });
    }
    if (input.decidePending) {
      await db.insert(activityLog).values({
        mailboxAccountId: mailbox!.id,
        senderKey,
        source: 'triage',
        action: 'archive',
        affectedCount: 3,
        occurredAt: new Date(clock.getTime() - 1 * DAY_MS),
      });
    }
  }

  return { userId: user!.id, mailboxId: mailbox!.id };
}

const CTX: WorkerContext = {
  jobId: 'lapse-test',
  workerName: 'LapseReengagementWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: NOW,
  policy: 'cronPolicy',
};

function buildWorker(db: Db, clock: Date = NOW) {
  const enqueued: EmailSendJobData[] = [];
  const prepared: Array<{ userId: string; pendingCount: number }> = [];
  const worker = new LapseReengagementWorker({
    db: db as never,
    now: () => clock,
    prepareEmail: async (input): Promise<PreparedLapseEmail> => {
      prepared.push(input);
      return {
        subject: `${input.pendingCount} senders are waiting in Triage`,
        text: 'body',
        headers: { 'List-Unsubscribe': '<signed>' },
      };
    },
    enqueueEmail: async (job) => {
      enqueued.push(job);
      return 'added';
    },
  });
  return { worker, enqueued, prepared };
}

describe('LapseReengagementWorker', () => {
  it('emails only accounts that are 7+ days old and newly dormant, with senders waiting', async () => {
    const db = await freshDb();
    const target = await seedUser(db, {
      email: 'dormant@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 4,
    });
    // Still active — the whole point is not to chase someone who is here.
    await seedUser(db, {
      email: 'active@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 1,
      pending: 4,
    });
    // Dormant for weeks. Past the band, so this episode was already
    // handled; re-sending would be the nag loop the band exists to stop.
    await seedUser(db, {
      email: 'long-gone@example.com',
      ageDays: 60,
      lastSeenDaysAgo: 30,
      pending: 4,
    });
    // Dormant 5.5 days but only 6 days old — still inside D126's Day-7 floor.
    await seedUser(db, {
      email: 'brand-new@example.com',
      ageDays: 6,
      lastSeenDaysAgo: 5.5,
      pending: 4,
    });
    // Dormant and old enough, but nothing is waiting.
    await seedUser(db, {
      email: 'empty@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 0,
    });

    const { worker, enqueued, prepared } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({
      emailsQueued: 1,
      // The dormancy band is applied in SQL now, so the out-of-band
      // users (active, long-gone) and the too-young one never reach the
      // loop at all — `candidatesChecked` counts band candidates rather
      // than scanned rows. `bandSkips` staying at 0 is the assertion
      // that the SQL predicate and the loop's own check agree; a
      // non-zero value would mean they have drifted apart.
      candidatesChecked: 2,
      bandSkips: 0,
      emptyQueueSkips: 1,
      usersFailed: 0,
    });
    expect(prepared).toEqual([{ userId: target.userId, pendingCount: 4 }]);
    expect(enqueued).toEqual([
      expect.objectContaining({
        kind: 'lapse-reengagement',
        userId: target.userId,
        // Episode identity = the UTC date the user was last seen.
        idempotencyKey: `email__lapse-reengagement__${target.userId}__2026-08-05`,
        skipIfUserActiveSince: new Date(NOW.getTime() - 5.5 * DAY_MS).toISOString(),
        headers: { 'List-Unsubscribe': '<signed>' },
      }),
    ]);
  });

  /**
   * The band is the guard that stops a permanently dormant user being
   * re-emailed every time BullMQ's 7-day retention turns over. Widening
   * it to "dormant for 5+ days" makes the first case below queue three
   * emails instead of one, which is the regression this pins.
   */
  it('sends once per dormancy episode, not once per day of dormancy', async () => {
    const db = await freshDb();
    for (const daysAgo of [5.2, 8, 20]) {
      await seedUser(db, {
        email: `d${daysAgo}@example.com`,
        ageDays: 60,
        lastSeenDaysAgo: daysAgo,
        pending: 2,
      });
    }

    const { worker, enqueued } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    // One email, not three — the point of the band. The two deeper
    // sleepers are excluded by the SQL predicate rather than counted and
    // skipped in the loop, so `bandSkips` is 0 and `candidatesChecked`
    // is 1 (see the note in the first test).
    expect(result).toMatchObject({ emailsQueued: 1, candidatesChecked: 1, bandSkips: 0 });
    expect(enqueued).toHaveLength(1);
  });

  /**
   * "Last seen" falls back to `users.created_at` when no session row
   * exists, so a null max() can never be read as "seen just now" and
   * silently exclude the user.
   *
   * Worth being precise about what that fallback can and cannot do
   * HERE: it never produces a send on its own. This step needs an
   * account 7+ days old whose last contact was 5-6 days ago, and when
   * creation IS the last contact those two cannot both hold. The
   * signed-up-and-never-returned user belongs to D126's Day-3 step,
   * which this change does not build. The fallback's job is to place
   * such a user OUTSIDE the band deliberately, rather than by accident.
   */
  it('falls back to account creation when the user has no session row', async () => {
    const db = await freshDb();
    // Never signed in, 30 days old: last contact is creation, which is
    // long past the band.
    await seedUser(db, { email: 'no-session-old@example.com', ageDays: 30, pending: 3 });
    // Never signed in, 5.5 days old: inside the band by last-contact,
    // but below the 7-day account-age floor.
    await seedUser(db, { email: 'no-session-new@example.com', ageDays: 5.5, pending: 3 });

    const { worker, enqueued } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    // Neither is emailed, and neither reaches the loop: the 5.5-day-old
    // account fails the 7-day age floor, and the 30-day-old one falls
    // outside the band because its last contact IS its creation. Both
    // exclusions now happen in SQL.
    expect(result).toMatchObject({ candidatesChecked: 0, bandSkips: 0, emailsQueued: 0 });
    expect(enqueued).toHaveLength(0);
  });

  /**
   * THE REGRESSION GUARD for a wall-clock/scheduled-clock split.
   *
   * `notDecidedRecently` used SQL `now()` while every other instant in
   * the job came from the injected clock, so a run silently evaluated
   * its dormancy band and its decided-window against two different
   * times. Nothing caught it until 2026-08-16, when real time drifted
   * far enough past this file's pinned clock that a seeded decision
   * fell out of the 7-day window and a "queue is empty" case started
   * queueing mail — on `main`, with no code change.
   *
   * This pins the whole scenario to a clock YEARS from real time and
   * derives every date from it, so the assertion can only pass if the
   * decided-window honours the injected clock. Under the old SQL the
   * decision is decades outside a real-`now()` window, the senders read
   * as undecided, and an email is queued.
   *
   * It also cannot rot the way the original did: the gap to real time
   * is measured in years, not days, and no date literal is hardcoded.
   */
  it('evaluates the decided-window against the INJECTED clock, not the database wall clock', async () => {
    const farPast = new Date('2019-04-02T09:15:00.000Z');
    const db = await freshDb();

    // Dormant inside the band, and every pending sender was decided one
    // day before the pinned clock — i.e. INSIDE the 7-day window as of
    // `farPast`, and nowhere near it as of real `now()`.
    await seedUser(
      db,
      {
        email: 'decided-in-pinned-window@example.com',
        ageDays: 30,
        lastSeenDaysAgo: 5.5,
        pending: 3,
        decidePending: true,
      },
      farPast,
    );

    const { worker, enqueued } = buildWorker(db, farPast);
    const result = await worker.processJob(
      { scheduledAtMinute: farPast.toISOString().slice(0, 16) },
      CTX,
    );

    // The queue is empty as of the pinned clock, so nothing is sent.
    expect(result).toMatchObject({ emailsQueued: 0, emptyQueueSkips: 1 });
    expect(enqueued).toHaveLength(0);
  });

  it('counts only senders the Triage queue would actually show', async () => {
    const db = await freshDb();
    // Every pending sender is protected — Triage renders those as Keep
    // (D245), so promising "senders are waiting" would contradict the
    // screen the link lands on.
    await seedUser(db, {
      email: 'all-protected@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 3,
      protectPending: true,
    });
    // Every pending sender was already decided inside the window, so the
    // queue excludes them.
    await seedUser(db, {
      email: 'all-decided@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 3,
      decidePending: true,
    });

    const { worker, enqueued } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({ emailsQueued: 0, emptyQueueSkips: 2 });
    expect(enqueued).toHaveLength(0);
  });

  /**
   * D232. A user who requests deletion stops using the app BY
   * DEFINITION, so they land in this exact dormancy band inside their
   * own grace window — and this kind is commercial. Win-back mail to
   * someone mid-erasure is the case this gate exists for.
   */
  it('never mails a user with an in-flight deletion request', async () => {
    const db = await freshDb();
    await seedUser(db, {
      email: 'deleting@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 4,
      deletionStatus: 'pending',
    });
    await seedUser(db, {
      email: 'purging@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 4,
      deletionStatus: 'executing',
    });

    const { worker, enqueued, prepared } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({ deletionSkips: 2, emailsQueued: 0 });
    // Nothing was even RENDERED for them — no token signed, no body built.
    expect(prepared).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  /**
   * The other side of the gate: a CANCELLED or already-EXECUTED request
   * is not in flight. Without this the gate could silently widen into
   * "anyone who ever asked", which is a different (and wrong) rule.
   */
  it('still mails a user whose deletion request was cancelled', async () => {
    const db = await freshDb();
    await seedUser(db, {
      email: 'changed-mind@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 4,
      deletionStatus: 'cancelled',
    });

    const { worker, enqueued } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({ deletionSkips: 0, emailsQueued: 1 });
    expect(enqueued).toHaveLength(1);
  });

  it('short-circuits the shared reminders opt-out before rendering anything', async () => {
    const db = await freshDb();
    await seedUser(db, {
      email: 'no-reminders@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 4,
      remindersOff: true,
    });

    const { worker, enqueued, prepared } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({ preferenceSkips: 1, emailsQueued: 0 });
    // The point of short-circuiting: no JWT re-signed, no body rendered,
    // every hour, forever, for someone who said no.
    expect(prepared).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  /**
   * A per-user failure must reach Sentry. The job returns SUCCESS
   * regardless, so without the observer call a total outage (e.g.
   * `signUnsubscribeToken` throwing on an unset secret, which hits
   * EVERY candidate) is indistinguishable from a quiet hour.
   */
  it('reports a per-user failure to the observer, not just stdout', async () => {
    const db = await freshDb();
    await seedUser(db, {
      email: 'boom@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 2,
    });

    const captured: string[] = [];
    const worker = new LapseReengagementWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async () => {
        throw new Error('UNSUBSCRIBE_TOKEN_SECRET must be at least 32 characters');
      },
      enqueueEmail: async () => 'added',
    });
    worker.setObserver({
      captureFailure: () => {},
      captureBackgroundFailure: (_error: Error, context: { kind: string }) => {
        captured.push(context.kind);
      },
      recordBackgroundNotice: () => {},
    });

    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    expect(result).toMatchObject({ usersFailed: 1, emailsQueued: 0 });
    expect(captured).toContain('lapse_reengagement.user_failed');
  });

  it('reports a dedup no-op instead of counting it as a send', async () => {
    const db = await freshDb();
    await seedUser(db, {
      email: 'deduped@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 2,
    });

    const worker = new LapseReengagementWorker({
      db: db as never,
      now: () => NOW,
      prepareEmail: async () => ({ subject: 's', text: 't', headers: {} }),
      enqueueEmail: async () => 'noop',
    });

    expect(await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX)).toMatchObject({
      emailsQueued: 0,
      dedupSkips: 1,
    });
  });

  /**
   * The band moved into SQL because it was NOT in SQL: `LIMIT 500`
   * bounded the whole user table, ordered by `created_at ASC` — a column
   * that never changes, in a pass that writes nothing back to `users`.
   * Past 500 accounts older than a week the query returned the same 500
   * oldest users every hour forever, so nobody who signed up after them
   * could ever be sent a win-back email. It looked healthy while doing
   * it: `candidatesChecked: 500, bandSkips: 500, emailsQueued: 0` reads
   * exactly like "nobody is dormant right now".
   */
  it('does not starve newer accounts behind a wall of older ones', async () => {
    const db = await freshDb();
    // 12 accounts that are old but NOT dormant — under the old query
    // these filled the page in `created_at` order and hid everyone else.
    for (let i = 0; i < 12; i += 1) {
      await seedUser(db, {
        email: `wall${i}@example.com`,
        ageDays: 200 + i,
        lastSeenDaysAgo: 1,
        pending: 2,
      });
    }
    // The newest account, and the only dormant one.
    const target = await seedUser(db, {
      email: 'newest-dormant@example.com',
      ageDays: 30,
      lastSeenDaysAgo: 5.5,
      pending: 2,
    });

    const { worker, enqueued } = buildWorker(db);
    const result = await worker.processJob({ scheduledAtMinute: '2026-08-10T12:00' }, CTX);

    // The wall never enters the candidate set — that is the fix. A
    // cap-shaped bug would show here as `emailsQueued: 0`.
    expect(result).toMatchObject({ candidatesChecked: 1, emailsQueued: 1 });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ userId: target.userId });
  });

  it('treats a never-signed-in user as last seen at CREATION, not "just now"', async () => {
    // The SQL band leans on Postgres `GREATEST` ignoring NULLs, so a user
    // with no session row falls back to `created_at`. Under strict
    // GREATEST semantics (MySQL's) the expression would be NULL, every
    // never-signed-in user would silently drop out of every comparison,
    // and the exclusion would look identical to the correct one from the
    // outside. Pinned directly because no processJob assertion can tell
    // those two apart.
    const db = await freshDb();
    const [row] = (
      (await db.execute(
        sql`SELECT GREATEST(NULL::timestamptz, '2020-01-01T00:00:00Z'::timestamptz) IS NULL AS is_null`,
      )) as unknown as { rows: { is_null: boolean }[] }
    ).rows;
    expect(row?.is_null).toBe(false);
  });
});
