import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { mailboxAccounts, users, workspaces } from '@declutrmail/db';
import { aiConsentPatch, type AiConsentDecision } from '@declutrmail/shared/ai-consent';
import { parseBriefPrefs } from '@declutrmail/shared/contracts';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';
import {
  BRIEF_SNAPSHOT_JOB,
  type BriefSnapshotJobData,
  briefConsentJobOptions,
  briefSnapshotScheduledAtMinute,
  consentRescoreJobId,
  resolveBriefLocalWindow,
  SCORE_JOB,
  type ScoreJobData,
  scoreJobOptions,
} from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

export const AI_CONSENT_SCORE_QUEUE = 'AI_CONSENT_SCORE_QUEUE';
export const AI_CONSENT_BRIEF_QUEUE = 'AI_CONSENT_BRIEF_QUEUE';

export interface ConsentMailbox {
  id: string;
  tier: TierId;
  timezone: string | null;
  preferences: unknown;
}

/** Scopes this decision turns on. Not now, decline, and revoke turn on none. */
export function scopesGrantedBy(decision: AiConsentDecision): {
  explanations: boolean;
  brief: boolean;
} {
  if (decision.action !== 'allow') return { explanations: false, brief: false };
  const written = aiConsentPatch(decision).aiConsentScopes;
  if (written === 'keep') return { explanations: false, brief: false };
  return {
    explanations: written.includes('explanations'),
    brief: written.includes('brief'),
  };
}

/**
 * Queue the work Allow just paid for. Call only after the consent
 * update has committed. `queue.add` publishes the job; it does not run
 * the worker. A second call with the same mailbox reuses the job id, and
 * BullMQ keeps the first job.
 */
export async function enqueueAiConsentJobs(input: {
  scopes: { explanations: boolean; brief: boolean };
  mailboxes: readonly ConsentMailbox[];
  now: Date;
  scoreQueue: Queue<ScoreJobData> | null;
  briefQueue: Queue<BriefSnapshotJobData> | null;
}): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const mailbox of input.mailboxes) {
    if (input.scopes.explanations && input.scoreQueue) {
      const queue = input.scoreQueue;
      const data: ScoreJobData = {
        mailboxAccountId: mailbox.id,
        trigger: 'consent_grant',
        producedAtMs: input.now.getTime(),
      };
      tasks.push(
        queue
          .add(SCORE_JOB, data, scoreJobOptions(consentRescoreJobId(mailbox.id)))
          .then(() => undefined)
          .catch((err: unknown) => {
            logEnqueueFailure('score', mailbox.id, err);
          }),
      );
    }
    if (input.scopes.brief && input.briefQueue && hasCapability(mailbox.tier, 'brief')) {
      const queue = input.briefQueue;
      const window = resolveBriefLocalWindow(
        input.now,
        mailbox.timezone,
        parseBriefPrefs(mailbox.preferences).hour,
      );
      const data: BriefSnapshotJobData = {
        scheduledAtMinute: briefSnapshotScheduledAtMinute(input.now),
        consentMailboxAccountId: mailbox.id,
      };
      tasks.push(
        queue
          .add(BRIEF_SNAPSHOT_JOB, data, briefConsentJobOptions(mailbox.id, window.runDateLocal))
          .then(() => undefined)
          .catch((err: unknown) => {
            logEnqueueFailure('brief-snapshot', mailbox.id, err);
          }),
      );
    }
  }
  await Promise.all(tasks);
}

function logEnqueueFailure(queue: string, mailboxAccountId: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      kind: 'ai_consent.enqueue_failed',
      queue,
      mailboxAccountId,
      error: err instanceof Error ? err.name : 'Error',
    }),
  );
}

/**
 * After `users` consent columns commit, enqueue one score job per active
 * mailbox when explanations were granted, and one Brief job per active
 * mailbox on a brief-capable tier when Brief was granted.
 */
@Injectable()
export class AiConsentFollowup {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(AI_CONSENT_SCORE_QUEUE) private readonly scoreQueue: Queue<ScoreJobData> | null,
    @Inject(AI_CONSENT_BRIEF_QUEUE) private readonly briefQueue: Queue<BriefSnapshotJobData> | null,
  ) {}

  async afterCommittedGrant(userId: string, decision: AiConsentDecision): Promise<void> {
    const scopes = scopesGrantedBy(decision);
    if (!scopes.explanations && !scopes.brief) return;
    const mailboxes = await this.db
      .select({
        id: mailboxAccounts.id,
        tier: workspaces.tier,
        timezone: users.timezone,
        preferences: users.preferences,
      })
      .from(mailboxAccounts)
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .innerJoin(users, eq(users.id, mailboxAccounts.userId))
      .where(and(eq(mailboxAccounts.userId, userId), eq(mailboxAccounts.status, 'active')));
    await enqueueAiConsentJobs({
      scopes,
      mailboxes,
      now: new Date(),
      scoreQueue: this.scoreQueue,
      briefQueue: this.briefQueue,
    });
  }
}
