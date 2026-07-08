import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
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
import { PermanentError, TransientError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

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

  it('fail-closed: missing provider key dead-letters on attempt 1 (PermanentError)', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const delivery = deliveryReturning({
      ok: false,
      reason: 'disabled',
      detail: 'RESEND_API_KEY is not configured.',
    });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    // PermanentError → isNonRetryable → BaseDeclutrWorker dead-letters
    // immediately instead of burning batchPolicy retries.
    await expect(worker.processJob(jobData(userId), CTX)).rejects.toThrow(PermanentError);
  });

  it('classifies provider 4xx as permanent and 5xx/network as transient', async () => {
    const db = await freshDb();
    const userId = await seedUser(db);
    const worker4xx = new EmailSendWorker({
      db: db as never,
      delivery: deliveryReturning({ ok: false, reason: 'permanent', detail: 'bad from' }),
    });
    await expect(worker4xx.processJob(jobData(userId), CTX)).rejects.toThrow(PermanentError);

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
