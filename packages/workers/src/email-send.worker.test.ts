import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { activeSessions, schema, users, workspaces } from '@declutrmail/db';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_KINDS,
  EmailSendWorker,
  type EmailDeliveryOutcome,
  type EmailDeliveryPort,
  type EmailKind,
  type EmailSendJobData,
} from './email-send.worker.js';
import {
  emailSendJobOptions,
  syncCompleteEmailJobId,
  syncReminderEmailJobId,
} from './email-send.queue.js';
import { PermanentError, TransientError } from './worker-errors.js';
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

  // COMMERCIAL_KINDS is empty today — every shipped kind is a service
  // notice — so the refusal below has no live input and would sit in the
  // tree as untested dead code, the exact shape of a guardrail that
  // reports fine while verifying nothing. Adding a kind for the duration
  // of the test pins the WIRING (classified commercial + no address ⇒
  // refuse), independently of today's classification, which the next
  // test pins separately.
  const asMutable = COMMERCIAL_KINDS as Set<EmailKind>;
  afterEach(() => asMutable.delete('sync-complete'));

  it('REFUSES a kind classified commercial when no postal address is configured (CAN-SPAM)', async () => {
    // Permanent, not transient: retrying cannot conjure an address, and
    // the failure must be loud in worker metrics rather than a silently
    // missing footer.
    asMutable.add('sync-complete');
    vi.mocked(hasPostalAddress).mockReturnValue(false);
    const db = await freshDb();
    const userId = await seedUser(db);
    const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_1' });
    const worker = new EmailSendWorker({ db: db as never, delivery });

    await expect(worker.processJob(jobData(userId), CTX)).rejects.toBeInstanceOf(PermanentError);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  // The classification itself, which is what actually unblocked signups.
  // `sync-complete` and `sync-reminder-24h` are opt-out-able but NOT
  // commercial: they report the result of a sync the recipient started
  // and carry no price, pitch, or offer. Keying the gate off the opt-out
  // map instead of primary purpose dead-lettered the first email every
  // new signup receives.
  it('sends the opt-out-able service notices without an address — opt-out-able is not commercial', async () => {
    vi.mocked(hasPostalAddress).mockReturnValue(false);
    expect([...COMMERCIAL_KINDS]).toEqual([]);

    for (const kind of ['sync-complete', 'sync-reminder-24h'] as const) {
      const db = await freshDb();
      const userId = await seedUser(db, `${kind}@b.com`);
      const delivery = deliveryReturning({ ok: true, providerId: 'rsnd_svc' });
      const worker = new EmailSendWorker({ db: db as never, delivery });

      const result = await worker.processJob(
        jobData(userId, { kind, idempotencyKey: `email__${kind}__ev1` }),
        CTX,
      );

      expect(result.outcome, `${kind} must not be blocked by the postal gate`).toBe('sent');
    }
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
