import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_KINDS,
  EmailSendWorker,
  type EmailDeliveryOutcome,
  type EmailDeliveryPort,
  type EmailSendJobData,
} from './email-send.worker.js';
import {
  emailSendJobOptions,
  syncCompleteEmailJobId,
  syncReminderEmailJobId,
} from './email-send.queue.js';
import { TransientError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';
import { hasPostalAddress } from '@declutrmail/shared/copy';
import type * as SharedCopy from '@declutrmail/shared/copy';

type SharedCopyModule = typeof SharedCopy;

/**
 * The suite runs in the COMPLIANT configuration (a postal address is
 * configured), because that is the state every other behaviour under
 * test assumes. The CAN-SPAM refusal itself is pinned by its own two
 * tests below, which flip this mock.
 */
vi.mock('@declutrmail/shared/copy', async (importOriginal) => ({
  ...(await importOriginal<SharedCopyModule>()),
  hasPostalAddress: vi.fn(() => true),
}));

/**
 * EmailSendWorker tests (D162, D225).
 *
 * Real PGlite DB (users + active_sessions), fake delivery port.
 * Covers: send happy path, the D165 reminder opt-out, the
 * "user returned" execution-time skip, suppression skip, the
 * fail-closed missing-key path (PermanentError — never retried), and
 * the idempotency-key encodings.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');

async function freshDb() {
  const pg = new PGlite({ extensions: { citext } });
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        await pg.query(trimmed);
      }
    }
  }
  return drizzle(pg, { schema });
}

async function seedUser(db: Awaited<ReturnType<typeof freshDb>>, email = 'a@b.com') {
  const [ws] = await db.insert(workspaces).values({ name: 'WS' }).returning({
    id: workspaces.id,
  });
  const [user] = await db
    .insert(users)
    .values({ workspaceId: ws!.id, email })
    .returning({ id: users.id });
  return user!.id;
}

function deliveryReturning(outcome: EmailDeliveryOutcome): EmailDeliveryPort & {
  deliver: ReturnType<typeof vi.fn>;
} {
  return { deliver: vi.fn().mockResolvedValue(outcome) };
}

const CTX: WorkerContext = {
  jobId: 'test',
  workerName: 'EmailSendWorker',
  attempt: 1,
  maxAttempts: 3,
  startedAt: new Date(),
  enqueuedAt: new Date(),
  policy: 'batchPolicy',
};

function jobData(userId: string, overrides: Partial<EmailSendJobData> = {}): EmailSendJobData {
  return {
    kind: 'sync-complete',
    userId,
    subject: 'Your inbox is ready',
    text: 'body',
    idempotencyKey: 'email__sync-complete__ev1',
    ...overrides,
  };
}

describe('EmailSendWorker', () => {
  // Reset to the compliant default before every test — a `…Once` here
  // would leak: the transactional path short-circuits before it ever
  // calls `hasPostalAddress`, so a queued one-shot survives into the
  // next test.
  beforeEach(() => vi.mocked(hasPostalAddress).mockReturnValue(true));

  // The two opt-out-able kinds sit on OPPOSITE sides of the CAN-SPAM
  // primary-purpose test, which is the whole point of separating the
  // postal gate from the opt-out map. Pinning them in one test keeps the
  // contrast visible: a future edit that collapses them back together —
  // in either direction — fails here rather than shipping.
  //
  // The earlier fix got this wrong in the permissive direction, letting
  // the re-engagement email through (Codex stop-review 2026-07-29).
  it('gates the re-engagement email on a postal address but not the completion notice', async () => {
    vi.mocked(hasPostalAddress).mockReturnValue(false);

    // sync-complete DELIVERS the result of a sync the recipient asked
    // for — §7702(17)(A)(v). Blocking it dead-lettered the first email
    // every new signup receives.
    const completeDb = await freshDb();
    const completeUser = await seedUser(completeDb, 'complete@b.com');
    const completeDelivery = deliveryReturning({ ok: true, providerId: 'rsnd_svc' });
    const completeResult = await new EmailSendWorker({
      db: completeDb as never,
      delivery: completeDelivery,
    }).processJob(jobData(completeUser), CTX);
    expect(completeResult.outcome).toBe('sent');

    // sync-reminder-24h carries no NEW transactional information — the
    // completion it restates was already reported by sync-complete. It
    // exists because the recipient did not return, and its body makes a
    // value claim about the product. That is promotional, so it must not
    // send without an address.
    const reminderDb = await freshDb();
    const reminderUser = await seedUser(reminderDb, 'reminder@b.com');
    const reminderDelivery = deliveryReturning({ ok: true, providerId: 'rsnd_promo' });
    const reminderWorker = new EmailSendWorker({
      db: reminderDb as never,
      delivery: reminderDelivery,
    });

    // A designed SKIP, not a throw. It used to be a PermanentError for
    // loudness, which made the job terminal-`failed` — and a failed job
    // is indistinguishable from one that delivered and lost its
    // confirmation, so the enqueue dedup had to suppress it, permanently
    // burying this mailbox's reminder (Codex stop-reviews 2026-07-29).
    // Recording the refusal keeps the send blocked while leaving a later
    // attempt possible once an address exists.
    const reminderResult = await reminderWorker.processJob(
      jobData(reminderUser, {
        kind: 'sync-reminder-24h',
        idempotencyKey: 'email__sync-reminder-24h__ev1',
      }),
      CTX,
    );

    expect(reminderResult.outcome).toBe('skipped_no_postal_address');
    expect(reminderDelivery.deliver).not.toHaveBeenCalled();
  });

  // Guards the classification itself against silent drift. Emptying this
  // set would disarm the postal gate everywhere while every other test
  // stayed green — the blind-guard shape.
  it('classifies exactly the promotional kinds as commercial', () => {
    expect([...COMMERCIAL_KINDS]).toEqual(['sync-reminder-24h', 'weekly-value-receipt']);
  });

  it('still sends TRANSACTIONAL kinds without a postal address (deletion notices)', async () => {
    // Required account notices are exempt from the commercial-mail
    // address rule — blocking them would break the D216/D232 deletion
    // paper trail for a rule that does not apply to them.
    vi.mocked(hasPostalAddress).mockReturnValue(false);
    const db = await freshDb();
    const userId = await seedUser(db, 'deleting@b.com');
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_del' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(
      jobData(userId, {
        kind: 'deletion-scheduled',
        idempotencyKey: 'email__deletion-scheduled__ev1',
      }),
      CTX,
    );

    expect(result.outcome).toBe('sent');
    expect(delivery.deliver).toHaveBeenCalled();
  });

  it('sync-failed sends without a postal address — it is a system notice, not commercial', async () => {
    // The failure notice must reach a user whose FIRST sync died even
    // while the postal-address slot is empty and every commercial kind
    // is blocked. Classifying it commercial would silently suppress the
    // one email that tells a trapped user how to get out.
    vi.mocked(hasPostalAddress).mockReturnValue(false);
    const db = await freshDb();
    const userId = await seedUser(db, 'failed-scan@b.com');
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_fail' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(
      jobData(userId, {
        kind: 'sync-failed',
        idempotencyKey: 'email__sync-failed__mb-1__2026-07-29',
      }),
      CTX,
    );

    expect(result.outcome).toBe('sent');
    expect(delivery.deliver).toHaveBeenCalled();
  });

  it('resolves the recipient at execution time and delivers', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, 'send-to@b.com');
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_1' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(jobData(userId), CTX);

    expect(result).toEqual({ outcome: 'sent', kind: 'sync-complete', providerId: 'rsnd_1' });
    expect(delivery.deliver).toHaveBeenCalledWith({
      to: 'send-to@b.com',
      subject: 'Your inbox is ready',
      text: 'body',
      idempotencyKey: 'email__sync-complete__ev1',
    });
  });

  it('forwards html and headers to the delivery port', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_2' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    await worker.processJob(
      jobData(userId, {
        html: '<p>hi</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
      }),
      CTX,
    );

    expect(delivery.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<p>hi</p>',
        headers: { 'List-Unsubscribe': '<https://example.com/u>' },
      }),
    );
  });

  it('skips without sending when the user row is gone', async () => {
    const db = await freshDb();
    const delivery = deliveryReturning({ ok: true, providerId: null });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(jobData('00000000-0000-4000-8000-000000000000'), CTX);

    expect(result.outcome).toBe('skipped_no_recipient');
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('recipientOverride sends even when the user row is gone (D232 deletion receipt)', async () => {
    const db = await freshDb();
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_receipt' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(
      jobData('00000000-0000-4000-8000-000000000000', {
        kind: 'deletion-receipt',
        recipientOverride: 'purged-user@b.com',
        idempotencyKey: 'email__deletion-receipt__req1',
      }),
      CTX,
    );

    expect(result.outcome).toBe('sent');
    expect(delivery.deliver).toHaveBeenCalledWith({
      to: 'purged-user@b.com',
      subject: 'Your inbox is ready',
      text: 'body',
      idempotencyKey: 'email__deletion-receipt__req1',
    });
  });

  it('honors the D165 reminders opt-out for sync-reminder-24h only', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    await db
      .update(users)
      .set({ preferences: { emailPrefs: { reminders: false } } })
      .where(eq(users.id, userId));
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_2' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const reminder = await worker.processJob(
      jobData(userId, { kind: 'sync-reminder-24h', idempotencyKey: 'k1' }),
      CTX,
    );
    expect(reminder.outcome).toBe('skipped_opted_out');
    expect(delivery.deliver).not.toHaveBeenCalled();

    // The reminders toggle is per-category — sync-complete ignores it.
    const other = await worker.processJob(jobData(userId), CTX);
    expect(other.outcome).toBe('sent');
  });

  it('honors the D165 syncComplete opt-out for sync-complete only', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    await db
      .update(users)
      .set({ preferences: { emailPrefs: { reminders: true, syncComplete: false } } })
      .where(eq(users.id, userId));
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_sc' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const completion = await worker.processJob(jobData(userId), CTX);
    expect(completion.outcome).toBe('skipped_opted_out');
    expect(delivery.deliver).not.toHaveBeenCalled();

    // Reminders keep their own key…
    const reminder = await worker.processJob(
      jobData(userId, { kind: 'sync-reminder-24h', idempotencyKey: 'k-sc-1' }),
      CTX,
    );
    expect(reminder.outcome).toBe('sent');

    // …and SYSTEM kinds (deletion notices) have no key at all — they
    // always send (CAN-SPAM/GDPR carve-out per D165).
    const system = await worker.processJob(
      jobData(userId, { kind: 'deletion-scheduled', idempotencyKey: 'k-sc-2' }),
      CTX,
    );
    expect(system.outcome).toBe('sent');
  });

  it('requires an execution-time weekly receipt opt-in', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, 'weekly@b.com');
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_weekly' });
    const worker = new EmailSendWorker({ db: db as never, delivery });
    const weeklyJob = jobData(userId, {
      kind: 'weekly-value-receipt',
      idempotencyKey: 'email__weekly-value-receipt__u1__2026-08-02',
    });

    const defaultOff = await worker.processJob(weeklyJob, CTX);
    expect(defaultOff.outcome).toBe('skipped_opted_out');
    expect(delivery.deliver).not.toHaveBeenCalled();

    await db
      .update(users)
      .set({ preferences: { emailPrefs: { weeklyReceipt: true } } })
      .where(eq(users.id, userId));

    const optedIn = await worker.processJob(weeklyJob, CTX);
    expect(optedIn.outcome).toBe('sent');
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('a legacy pre-syncComplete prefs bag still sends sync-complete (default true)', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    // Written before the syncComplete key existed — the partial parse
    // must fill it from defaults, not reset the bag.
    await db
      .update(users)
      .set({ preferences: { emailPrefs: { reminders: false } } })
      .where(eq(users.id, userId));
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_legacy' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const completion = await worker.processJob(jobData(userId), CTX);
    expect(completion.outcome).toBe('sent');
  });

  it('skips the reminder when the user returned after the sync finished', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const readyAt = new Date('2026-06-11T00:00:00.000Z');
    await db.insert(activeSessions).values({
      userId,
      jti: '11111111-1111-4111-8111-111111111111',
      refreshTokenHash: 'h',
      lastUsedAt: new Date(readyAt.getTime() + 60_000),
    });
    const delivery = deliveryReturning({ ok: true, providerId: null });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(
      jobData(userId, {
        kind: 'sync-reminder-24h',
        skipIfUserActiveSince: readyAt.toISOString(),
        idempotencyKey: 'k2',
      }),
      CTX,
    );

    expect(result.outcome).toBe('skipped_user_returned');
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('sends the reminder when the only session activity predates the sync', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const readyAt = new Date('2026-06-11T00:00:00.000Z');
    await db.insert(activeSessions).values({
      userId,
      jti: '22222222-2222-4222-8222-222222222222',
      refreshTokenHash: 'h',
      lastUsedAt: new Date(readyAt.getTime() - 60_000),
    });
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_3' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(
      jobData(userId, {
        kind: 'sync-reminder-24h',
        skipIfUserActiveSince: readyAt.toISOString(),
        idempotencyKey: 'k3',
      }),
      CTX,
    );

    expect(result.outcome).toBe('sent');
  });

  it('treats a suppressed recipient as a designed skip, not a failure', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const delivery = deliveryReturning({
      ok: false,
      reason: 'suppressed',
      detail: 'on the list',
    });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    const result = await worker.processJob(jobData(userId), CTX);
    expect(result.outcome).toBe('skipped_suppressed');
  });

  it('fail-closed: a missing provider key records a not-sent skip, never a throw', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const delivery = deliveryReturning({
      ok: false,
      reason: 'disabled',
      detail: 'RESEND_API_KEY is not configured.',
    });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    // It used to throw PermanentError to dead-letter on attempt 1. But a
    // dead-lettered job cannot be told apart from one that delivered and
    // lost its confirmation, so `enqueueEmailSend` had to suppress it
    // forever — permanently burying every send that failed only because
    // the key was unset, which is precisely the condition someone FIXES
    // and then expects to retry (Codex stop-review 2026-07-29).
    //
    // The port fail-closes before reaching Resend, so this is definitively
    // not-sent and recording it is both honest and recoverable. Still not
    // retried (no TransientError) and still loud (warn + metrics).
    const result = await worker.processJob(jobData(userId), CTX);
    expect(result.outcome).toBe('skipped_delivery_disabled');
    expect(result.providerId).toBeNull();
  });

  // Dropping the throw also dropped these out of the dead-letter sweep,
  // which is what forwards to Sentry. Losing delivery is bad; losing
  // delivery AND the signal that it stopped is a silent mail outage, so
  // the observer call is pinned here — a refactor that removes it would
  // otherwise leave every other test green.
  it('still reports a not-delivered send to the observer, having stopped dead-lettering', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const captured: { kind: string; tags?: Record<string, string | number> }[] = [];
    const worker = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({
        ok: false,
        reason: 'disabled',
        detail: 'RESEND_API_KEY is not configured.',
      }),
    });
    worker.setObserver({
      captureFailure: () => {},
      captureBackgroundFailure: (_err, ctx) => captured.push(ctx),
    });

    await worker.processJob(jobData(userId), CTX);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.kind).toBe('email.not_delivered');
    expect(captured[0]?.tags?.outcome).toBe('skipped_delivery_disabled');
  });

  // Completing without a durable row ACKNOWLEDGES an email nobody sent:
  // the job ages out of removeOnComplete and nothing records that one is
  // owed. The skip keeps delivery re-enqueueable; the parked row keeps the
  // loss from vanishing (Codex stop-review 2026-07-29, fifth pass).
  it('parks a durable row for every known-unsent outcome, while still completing', async () => {
    for (const [reason, outcome] of [
      ['disabled', 'skipped_delivery_disabled'],
      ['permanent', 'skipped_delivery_rejected'],
    ] as const) {
      const db = await freshDb();
      const userId = await seedUser(db, `${reason}@b.com`);
      const parked: { queue: string; jobId: string; error: string }[] = [];
      const worker = new EmailSendWorker({
        db: db as never,
        delivery: deliveryReturning({ ok: false, reason, detail: 'nope' }),
      });
      worker.setDeadLetterRecorder({
        record: async (entry) => {
          parked.push({ queue: entry.queue, jobId: entry.jobId, error: entry.error });
        },
      });

      const res = await worker.processJob(jobData(userId), CTX);

      expect(res.outcome, reason).toBe(outcome);
      expect(parked, `${reason} must leave a durable record`).toHaveLength(1);
      expect(parked[0]?.queue).toBe('email-send');
    }
  });

  // The refusal this whole arc started from needs the same durability —
  // leaving it unparked would be the identical bug one branch over.
  it('parks a durable row AND reports the observer when a commercial send is refused for no address', async () => {
    vi.mocked(hasPostalAddress).mockReturnValue(false);
    const db = await freshDb();
    const userId = await seedUser(db, 'postal-park@b.com');
    const parked: string[] = [];
    const captured: { kind: string; tags?: Record<string, string | number> }[] = [];
    const worker = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({ ok: true, providerId: 'rsnd_x' }),
    });
    worker.setDeadLetterRecorder({
      record: async (entry) => {
        parked.push(entry.error);
      },
    });
    worker.setObserver({
      captureFailure: () => {},
      captureBackgroundFailure: (_err, obsCtx) => captured.push(obsCtx),
    });

    const res = await worker.processJob(
      jobData(userId, {
        kind: 'sync-reminder-24h',
        idempotencyKey: 'email__sync-reminder-24h__park',
      }),
      CTX,
    );

    expect(res.outcome).toBe('skipped_no_postal_address');
    expect(parked).toHaveLength(1);
    expect(parked[0]).toContain('postal address');
    // Uniform rule: every known-unsent outcome parks AND reports. Without
    // the direct call, an unwired or failing recorder would leave postal
    // refusals with no Sentry signal at all.
    expect(captured.map((c) => c.kind)).toContain('email.refused_no_postal_address');
  });

  // The park path's own failure contract: a broken recorder must not turn
  // a designed skip into a job failure — but it MUST page, because the
  // parked row was the only durable trace of an owed email.
  it('a failing recorder never fails the job, and the loss itself is reported', async () => {
    const db = await freshDb();
    const userId = await seedUser(db, 'recorder-down@b.com');
    const captured: string[] = [];
    const worker = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({ ok: false, reason: 'disabled', detail: 'no key' }),
    });
    worker.setDeadLetterRecorder({
      record: async () => {
        throw new Error('insert failed');
      },
    });
    worker.setObserver({
      captureFailure: () => {},
      captureBackgroundFailure: (_err, obsCtx) => captured.push(obsCtx.kind),
    });

    const res = await worker.processJob(jobData(userId), CTX);

    expect(res.outcome).toBe('skipped_delivery_disabled');
    expect(captured).toContain('dead_letter.record_failed');
  });

  // The dividing line is NOT severity but whether the mail can have gone
  // out — a throw dead-letters, and a dead-letter suppresses every later
  // enqueue forever, so only the AMBIGUOUS outcome may throw.
  it('records definitively-not-sent 4xx as a skip and throws only on ambiguous 5xx', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);

    // Refused outright by the provider ⇒ nothing was sent. An unverified
    // sending domain is exactly this 4xx, and it gets fixed — so it must
    // stay retryable rather than being buried.
    const worker4xx = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({ ok: false, reason: 'permanent', detail: 'bad from' }),
    });
    const rejected = await worker4xx.processJob(jobData(userId), CTX);
    expect(rejected.outcome).toBe('skipped_delivery_rejected');

    // 5xx / network: Resend may have accepted the request before the
    // confirmation was lost. The ONLY case where a duplicate is possible,
    // so it stays a retryable throw.
    const worker5xx = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({ ok: false, reason: 'transient', detail: '503' }),
    });
    await expect(worker5xx.processJob(jobData(userId), CTX)).rejects.toThrow(TransientError);
  });
});

describe('email-send queue contract', () => {
  it('encodes one-send-per-logical-event jobIds without colons', () => {
    expect(syncCompleteEmailJobId('ev-123')).toBe('email__sync-complete__ev-123');
    expect(syncReminderEmailJobId('mb-9')).toBe('email__sync-reminder-24h__mb-9');
    // BullMQ ≥5.77 rejects ':' in jobIds.
    expect(syncCompleteEmailJobId('ev-123')).not.toContain(':');
    expect(syncReminderEmailJobId('mb-9')).not.toContain(':');
  });

  it('builds batchPolicy job options with delay for the reminder', () => {
    const opts = emailSendJobOptions('jid', 1_000);
    expect(opts).toMatchObject({
      jobId: 'jid',
      delay: 1_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    // No delay key at all for immediate sends.
    expect(emailSendJobOptions('jid2')).not.toHaveProperty('delay');
  });
});
