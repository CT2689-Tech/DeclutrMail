import { describe, expect, it, vi } from 'vitest';

import { hasCapability, TIER_IDS, type TierId } from '@declutrmail/shared/entitlements';
import {
  BRIEF_SNAPSHOT_JOB,
  briefConsentJobId,
  consentRescoreJobId,
  SCORE_JOB,
  WORKER_POLICIES,
} from '@declutrmail/workers';

import {
  AiConsentFollowup,
  enqueueAiConsentJobs,
  type ConsentMailbox,
} from './ai-consent-followup.js';

const NOW = new Date('2026-10-11T15:00:00.000Z');
const BRIEF_TIER = TIER_IDS.find((tier) => hasCapability(tier, 'brief'))!;
const OTHER_TIER = TIER_IDS.find((tier) => !hasCapability(tier, 'brief'))!;

function mailbox(id: string, tier: TierId): ConsentMailbox {
  return { id, tier, timezone: 'UTC', preferences: {} };
}

function dedupQueue() {
  const jobs = new Map<
    string,
    { name: string; data: Record<string, unknown>; attempts?: number }
  >();
  const add = vi.fn(
    async (
      name: string,
      data: Record<string, unknown>,
      opts: { jobId: string; attempts?: number },
    ) => {
      if (!jobs.has(opts.jobId)) {
        const stored: { name: string; data: Record<string, unknown>; attempts?: number } = {
          name,
          data,
        };
        if (opts.attempts !== undefined) stored.attempts = opts.attempts;
        jobs.set(opts.jobId, stored);
      }
      return { id: opts.jobId };
    },
  );
  return { jobs, add };
}

describe('enqueueAiConsentJobs', () => {
  it('enqueues one job per granted scope and mailbox, and a repeat does not add another', async () => {
    const score = dedupQueue();
    const brief = dedupQueue();
    const input = {
      scopes: { explanations: true, brief: true },
      mailboxes: [mailbox('mb-a', BRIEF_TIER), mailbox('mb-b', BRIEF_TIER)],
      now: NOW,
      scoreQueue: score as never,
      briefQueue: brief as never,
    };

    await enqueueAiConsentJobs(input);
    await enqueueAiConsentJobs(input);

    expect(score.jobs.size).toBe(2);
    expect(brief.jobs.size).toBe(2);
    expect(score.add).toHaveBeenCalledTimes(4);
    expect(brief.add).toHaveBeenCalledTimes(4);
    expect([...score.jobs.keys(), ...brief.jobs.keys()].every((id) => !id.includes(':'))).toBe(
      true,
    );
    expect(score.jobs.get(consentRescoreJobId('mb-a'))).toMatchObject({
      name: SCORE_JOB,
      data: { mailboxAccountId: 'mb-a', trigger: 'consent_grant' },
      attempts: WORKER_POLICIES.perMailboxPolicy.maxAttempts,
    });
    expect(brief.jobs.get(briefConsentJobId('mb-a', '2026-10-11'))).toMatchObject({
      name: BRIEF_SNAPSHOT_JOB,
      data: { consentMailboxAccountId: 'mb-a' },
    });
  });

  it('enqueues explanations only, Brief only, or skips Brief on a tier that cannot open it', async () => {
    const explanationsOnly = dedupQueue();
    const briefUnused = dedupQueue();
    await enqueueAiConsentJobs({
      scopes: { explanations: true, brief: false },
      mailboxes: [mailbox('mb-a', BRIEF_TIER)],
      now: NOW,
      scoreQueue: explanationsOnly as never,
      briefQueue: briefUnused as never,
    });
    expect(explanationsOnly.jobs.size).toBe(1);
    expect(briefUnused.add).not.toHaveBeenCalled();

    const briefOnly = dedupQueue();
    const scoreUnused = dedupQueue();
    await enqueueAiConsentJobs({
      scopes: { explanations: false, brief: true },
      mailboxes: [mailbox('mb-a', BRIEF_TIER), mailbox('mb-b', BRIEF_TIER)],
      now: NOW,
      scoreQueue: scoreUnused as never,
      briefQueue: briefOnly as never,
    });
    expect(scoreUnused.add).not.toHaveBeenCalled();
    expect(briefOnly.jobs.size).toBe(2);

    const mixedScore = dedupQueue();
    const mixedBrief = dedupQueue();
    await enqueueAiConsentJobs({
      scopes: { explanations: true, brief: true },
      mailboxes: [mailbox('pro-box', BRIEF_TIER), mailbox('free-box', OTHER_TIER)],
      now: NOW,
      scoreQueue: mixedScore as never,
      briefQueue: mixedBrief as never,
    });
    expect(mixedScore.jobs.size).toBe(2);
    expect([...mixedBrief.jobs.keys()]).toEqual([briefConsentJobId('pro-box', '2026-10-11')]);
  });

  it('still resolves when a queue publish fails', async () => {
    const score = { add: vi.fn().mockRejectedValue(new Error('redis down')) };
    await expect(
      enqueueAiConsentJobs({
        scopes: { explanations: true, brief: false },
        mailboxes: [mailbox('mb-a', BRIEF_TIER)],
        now: NOW,
        scoreQueue: score as never,
        briefQueue: null,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('AiConsentFollowup', () => {
  it('enqueues nothing for Not now, decline, or revoke', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('consent follow-up read the database');
        },
      },
    );
    const add = vi.fn();
    const service = new AiConsentFollowup(db as never, { add } as never, { add } as never);

    await service.afterCommittedGrant('user-1', { action: 'not_now', card: 'all' });
    await service.afterCommittedGrant('user-1', { action: 'not_now', card: 'withBrief' });
    await service.afterCommittedGrant('user-1', { action: 'not_now', card: 'upgrade' });
    await service.afterCommittedGrant('user-1', { action: 'revoke' });

    expect(add).not.toHaveBeenCalled();
  });
});
