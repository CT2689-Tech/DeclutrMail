/**
 * `enqueueEmailSend` dedup semantics (D162).
 *
 * The jobId IS the dedup key, and `removeOnFail: false` keeps failed jobs
 * forever, so "does an existing job suppress this enqueue?" decides
 * whether an email can ever be sent again. These tests pin the state
 * table, because the wrong answer in either direction is silent: too
 * permissive double-sends, too strict buries the email with no error
 * anywhere.
 *
 * Fake queue rather than Redis — the same shape `queue.test.ts` uses for
 * `ensureInitialSyncJob`, whose state check this function had drifted
 * from.
 */

import { describe, expect, it } from 'vitest';

import { enqueueEmailSend, syncReminderEmailJobId } from './email-send.queue.js';
import type { EmailSendJobData } from './email-send.worker.js';

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
  private job: { id: string; state: JobState } | null = null;
  addCalls = 0;
  removeCalls = 0;
  /** Simulate BullMQ rejecting `remove()` on a job that just got locked. */
  removeRejects = false;

  setJob(state: JobState | null, id: string): void {
    this.job = state ? { id, state } : null;
  }

  async getJob(id: string) {
    if (!this.job || this.job.id !== id) return null;
    const job = this.job;
    return {
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

async function enqueueAgainst(state: JobState | null, removeRejects = false) {
  const q = new FakeQueue();
  q.setJob(state, JOB_ID);
  q.removeRejects = removeRejects;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outcome = await enqueueEmailSend(q as any, reminder());
  return { outcome, addCalls: q.addCalls, removeCalls: q.removeCalls };
}

describe('enqueueEmailSend', () => {
  it('adds when no job exists', async () => {
    expect(await enqueueAgainst(null)).toMatchObject({ outcome: 'added', addCalls: 1 });
  });

  // THE REGRESSION. `removeOnFail: false` + a jobId keyed per MAILBOX
  // means one terminal failure buried this mailbox's reminder forever:
  // every later enqueue no-oped and no config change revived it. Found
  // via the CAN-SPAM postal refusal — "set the address and reminders
  // resume" was false (Codex stop-review 2026-07-29).
  it('reaps a FAILED job so a permanent failure cannot bury the email forever', async () => {
    expect(await enqueueAgainst('failed')).toMatchObject({
      outcome: 'added',
      addCalls: 1,
      removeCalls: 1,
    });
  });

  // An evicted hash (Redis flush / TTL / failover) leaves a handle BullMQ
  // can no longer schedule. Treating it as live strands the send forever.
  it('reaps an UNKNOWN (evicted) job rather than stranding the send', async () => {
    expect(await enqueueAgainst('unknown')).toMatchObject({
      outcome: 'added',
      addCalls: 1,
      removeCalls: 1,
    });
  });

  // The opposite failure mode, and why this is not a copy of
  // `ensureInitialSyncJob`: for email, completed means the message WAS
  // sent, so the removeOnComplete age IS the dedup window. Reaping it
  // would double-send on any outbox redelivery.
  it('does NOT reap a COMPLETED job — that would double-send', async () => {
    expect(await enqueueAgainst('completed')).toMatchObject({
      outcome: 'noop',
      addCalls: 0,
      removeCalls: 0,
    });
  });

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

  // Lost race: a worker locked the failed job between getState() and
  // remove(). Adding under a half-removed hash is worse than skipping.
  it('treats a rejected remove() as a no-op instead of adding anyway', async () => {
    expect(await enqueueAgainst('failed', true)).toMatchObject({
      outcome: 'noop',
      addCalls: 0,
    });
  });
});
