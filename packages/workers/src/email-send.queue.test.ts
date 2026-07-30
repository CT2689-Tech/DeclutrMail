/**
 * `enqueueEmailSend` dedup semantics (D162).
 *
 * This dedup decides whether an email can ever be sent again, and both
 * wrong answers are silent: too permissive sends a real person a second
 * copy, too strict buries the message with no error anywhere. Two bugs
 * hid here behind BullMQ's job state (Codex stop-reviews, 2026-07-29),
 * because `completed` does not mean sent and `failed` does not mean
 * not-sent. The table below is pinned per (state, recorded outcome).
 *
 * Fake queue rather than Redis — the shape `queue.test.ts` uses for
 * `ensureInitialSyncJob`.
 */

import { describe, expect, it } from 'vitest';

import { enqueueEmailSend, syncReminderEmailJobId } from './email-send.queue.js';
import type { EmailSendJobData, EmailSendResult } from './email-send.worker.js';

type JobState =
  | 'completed'
  | 'failed'
  | 'active'
  | 'waiting'
  | 'delayed'
  | 'prioritized'
  | 'waiting-children'
  | 'unknown';

class FakeQueue {
  private job: { id: string; state: JobState; returnvalue: unknown } | null = null;
  addCalls = 0;
  removeCalls = 0;
  /** Simulate BullMQ rejecting `remove()` on a job that just got locked. */
  removeRejects = false;

  setJob(state: JobState | null, id: string, returnvalue: unknown = null): void {
    this.job = state ? { id, state, returnvalue } : null;
  }

  async getJob(id: string) {
    if (!this.job || this.job.id !== id) return null;
    const job = this.job;
    return {
      id: job.id,
      returnvalue: job.returnvalue,
      getState: async () => job.state,
      remove: async () => {
        this.removeCalls += 1;
        if (this.removeRejects) throw new Error('Missing lock for job; could not remove');
        this.job = null;
      },
    };
  }

  async add(): Promise<void> {
    this.addCalls += 1;
  }
}

const MAILBOX = 'cc64c10f-91ac-45e6-93f6-e137214a7089';
const JOB_ID = syncReminderEmailJobId(MAILBOX);

function reminder(): EmailSendJobData {
  return {
    kind: 'sync-reminder-24h',
    userId: 'user-1',
    subject: 'Your inbox is still ready',
    text: 'body',
    idempotencyKey: JOB_ID,
  };
}

function result(outcome: EmailSendResult['outcome']): EmailSendResult {
  return { outcome, kind: 'sync-reminder-24h', providerId: outcome === 'sent' ? 'rsnd_1' : null };
}

async function enqueueAgainst(
  state: JobState | null,
  returnvalue: unknown = null,
  removeRejects = false,
) {
  const q = new FakeQueue();
  q.setJob(state, JOB_ID, returnvalue);
  q.removeRejects = removeRejects;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outcome = await enqueueEmailSend(q as any, reminder());
  return { outcome, addCalls: q.addCalls, removeCalls: q.removeCalls };
}

describe('enqueueEmailSend', () => {
  it('adds when no job exists', async () => {
    expect(await enqueueAgainst(null)).toMatchObject({ outcome: 'added', addCalls: 1 });
  });

  // A delivered email is the ONE thing that must suppress. Reaping this
  // would send a real person a second copy.
  it("suppresses a completed 'sent' job — the mail demonstrably went out", async () => {
    expect(await enqueueAgainst('completed', result('sent'))).toMatchObject({
      outcome: 'noop',
      addCalls: 0,
      removeCalls: 0,
    });
  });

  // REGRESSION 1 (over-suppression). These complete WITHOUT delivering,
  // so treating `completed` as "sent" buried a legitimate later send —
  // e.g. reminders off ⇒ skipped_opted_out, then the user turns reminders
  // back on and nothing can be enqueued for that mailbox again.
  for (const outcome of [
    'skipped_opted_out',
    'skipped_user_returned',
    'skipped_suppressed',
    'skipped_no_recipient',
    'skipped_no_postal_address',
  ] as const) {
    it(`re-enqueues past a completed '${outcome}' job — nothing was delivered`, async () => {
      expect(await enqueueAgainst('completed', result(outcome))).toMatchObject({
        outcome: 'added',
        addCalls: 1,
        removeCalls: 1,
      });
    });
  }

  // REGRESSION 2 (duplicate risk). A `transient` failure can mean Resend
  // accepted the request and the confirmation was lost, so a failed job
  // MAY have delivered. An earlier fix reaped these, justified by the
  // provider Idempotency-Key — which has a finite window that the
  // reminder's own 24h delay lands right at the edge of.
  it('suppresses a FAILED job — delivery may have happened, so never risk a duplicate', async () => {
    expect(await enqueueAgainst('failed')).toMatchObject({
      outcome: 'noop',
      addCalls: 0,
      removeCalls: 0,
    });
  });

  // An evicted hash leaves a handle BullMQ can no longer schedule, so
  // suppressing strands the send forever for no benefit.
  it('reaps an UNKNOWN (evicted) job rather than stranding the send', async () => {
    expect(await enqueueAgainst('unknown')).toMatchObject({
      outcome: 'added',
      addCalls: 1,
      removeCalls: 1,
    });
  });

  // Fail CLOSED on anything unreadable: an unparseable record must never
  // authorise a duplicate. One missed send beats a second real email.
  for (const [label, value] of [
    ['absent', null],
    ['unparseable string', '{not json'],
    ['non-object', 42],
    ['object with no outcome', { kind: 'sync-reminder-24h' }],
    ['outcome this build does not know', { outcome: 'skipped_future_reason' }],
  ] as const) {
    it(`suppresses a completed job whose outcome is ${label} (fails closed)`, async () => {
      expect(await enqueueAgainst('completed', value)).toMatchObject({
        outcome: 'noop',
        addCalls: 0,
      });
    });
  }

  // Live states must keep suppressing, or a redelivered outbox event
  // stacks a second send alongside the pending one.
  for (const state of ['waiting', 'delayed', 'active', 'prioritized'] as const) {
    it(`does NOT reap a live '${state}' job`, async () => {
      expect(await enqueueAgainst(state)).toMatchObject({
        outcome: 'noop',
        addCalls: 0,
        removeCalls: 0,
      });
    });
  }

  // BullMQ may hand back the return value as a JSON string.
  it('parses a JSON-string return value rather than failing closed on it', async () => {
    expect(
      await enqueueAgainst('completed', JSON.stringify(result('skipped_opted_out'))),
    ).toMatchObject({ outcome: 'added', addCalls: 1 });
  });

  // Lost race: a worker locked the job between getState() and remove().
  // Adding under a half-removed hash is worse than skipping.
  it('treats a rejected remove() as a no-op instead of adding anyway', async () => {
    expect(await enqueueAgainst('completed', result('skipped_opted_out'), true)).toMatchObject({
      outcome: 'noop',
      addCalls: 0,
    });
  });
});
