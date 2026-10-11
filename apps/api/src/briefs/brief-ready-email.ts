import { and, eq, inArray, isNull, notExists } from 'drizzle-orm';
import {
  accountDeletionRequests,
  briefRuns,
  mailboxAccounts,
  mailboxDataDeletionRequests,
  providerSyncState,
  users,
  workspaces,
} from '@declutrmail/db';
import { parseBriefPrefs, hasBriefEmailConsent } from '@declutrmail/shared/contracts';
import { hasCapability } from '@declutrmail/shared/entitlements';
import {
  briefPayloadSchema,
  resolveBriefLocalWindow,
  BRIEF_EMAIL_SEND_QUEUE,
  briefReadyEmailJobId,
  enqueueEmailSend,
  type EmailSendJobData,
  type EmailSendWorkerDeps,
  type BriefSnapshotDeps,
} from '@declutrmail/workers';
import type { Queue } from 'bullmq';
import type { DrizzleDb } from '../db/db.module.js';
import { unsubscribeHeadersFor, unsubscribeUrl } from '../notifications/unsubscribe-headers.js';
import { briefReadyEmail } from '../notifications/templates/brief-ready.js';

/** Brief owns the sent marker. Queue jobs carry identifiers, never stored content. */
export function buildBriefNoticeResolver(
  db: DrizzleDb,
  appUrl: string,
  apiUrl: string,
  now: () => Date = () => new Date(),
): NonNullable<EmailSendWorkerDeps['resolveBriefNotice']> {
  const origin = new URL(appUrl);
  const canonicalAppUrl = [
    'declutrmail.com',
    'www.declutrmail.com',
    'app.declutrmail.com',
  ].includes(origin.hostname)
    ? 'https://app.declutrmail.com'
    : origin.origin;
  return async (runId, mailboxAccountId, userId) => {
    const [row] = await db
      .select({
        run: briefRuns,
        preferences: users.preferences,
        timezone: users.timezone,
        tier: workspaces.tier,
      })
      .from(briefRuns)
      .innerJoin(
        mailboxAccounts,
        and(
          eq(mailboxAccounts.id, briefRuns.mailboxAccountId),
          eq(mailboxAccounts.workspaceId, briefRuns.workspaceId),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, mailboxAccounts.userId),
          eq(users.workspaceId, mailboxAccounts.workspaceId),
        ),
      )
      .innerJoin(workspaces, eq(workspaces.id, mailboxAccounts.workspaceId))
      .innerJoin(providerSyncState, eq(providerSyncState.mailboxAccountId, mailboxAccounts.id))
      .where(
        and(
          eq(briefRuns.id, runId),
          eq(mailboxAccounts.id, mailboxAccountId),
          eq(users.id, userId),
          eq(mailboxAccounts.status, 'active'),
          eq(providerSyncState.readinessStatus, 'ready'),
          isNull(briefRuns.emailSentAt),
          notExists(
            db
              .select({ id: mailboxDataDeletionRequests.id })
              .from(mailboxDataDeletionRequests)
              .where(
                and(
                  eq(mailboxDataDeletionRequests.mailboxAccountId, mailboxAccounts.id),
                  inArray(mailboxDataDeletionRequests.status, ['pending', 'executing', 'failed']),
                ),
              ),
          ),
          notExists(
            db
              .select({ id: accountDeletionRequests.id })
              .from(accountDeletionRequests)
              .where(
                and(
                  eq(accountDeletionRequests.userId, users.id),
                  inArray(accountDeletionRequests.status, ['pending', 'executing']),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (!row || !hasCapability(row.tier, 'brief') || !hasBriefEmailConsent(row.preferences))
      return null;
    const instant = now();
    const window = resolveBriefLocalWindow(
      instant,
      row.timezone,
      parseBriefPrefs(row.preferences).hour,
    );
    if (!window.ready || window.runDateLocal !== row.run.runDateLocal) return null;
    const parsed = briefPayloadSchema.safeParse(row.run.briefPayload);
    if (!parsed.success) return null;
    const payload = parsed.data;
    const noiseEmails = payload.noise.reduce((sum, group) => sum + group.messageCount, 0);
    if (payload.reply.length + payload.fyi.length + noiseEmails === 0) return null;
    const optOut = await unsubscribeUrl({
      userId,
      scope: 'all',
      apiUrl,
      issuedAt: Math.floor(row.run.generatedAt.getTime() / 1000),
    });
    const rendered = briefReadyEmail({
      runDateLocal: row.run.runDateLocal,
      replySenders: payload.reply.length,
      fyiSenders: payload.fyi.length,
      noiseEmails,
      mailboxAccountId,
      appUrl: canonicalAppUrl,
      unsubscribeUrl: optOut,
    });
    return {
      ...rendered,
      headers: unsubscribeHeadersFor(optOut),
      markDelivered: async () => {
        await db
          .update(briefRuns)
          .set({ emailSentAt: instant, updatedAt: instant })
          .where(
            and(
              eq(briefRuns.id, runId),
              eq(briefRuns.mailboxAccountId, mailboxAccountId),
              isNull(briefRuns.emailSentAt),
            ),
          );
      },
    };
  };
}

/** Identifier-only producer; compatibility boundary rejects legacy consumers. */
export function buildBriefNoticeEnqueuer(
  queue: Queue<EmailSendJobData>,
): NonNullable<BriefSnapshotDeps['notifyBriefReady']> {
  if (queue.name !== BRIEF_EMAIL_SEND_QUEUE)
    throw new Error('Brief notice requires its isolated queue');
  return async ({ runId, userId, mailboxAccountId }) => {
    await enqueueEmailSend(queue, {
      kind: 'brief-ready',
      briefRunId: runId,
      userId,
      mailboxAccountId,
      subject: '',
      text: '',
      idempotencyKey: briefReadyEmailJobId(runId),
    });
  };
}

/** Broker rows remain discoverable when a purge happened during a Redis outage.
 * Each sweep reads a bounded page; a broker cursor survives worker restarts.
 * The numeric cursor contains no mailbox data. This queue uses fail-fast Redis
 * so unavailable cleanup cannot hold up the database purge.
 */
export function buildBriefNoticeCleanup(
  db: DrizzleDb,
  queue: Queue<EmailSendJobData>,
): () => Promise<void> {
  if (queue.name !== BRIEF_EMAIL_SEND_QUEUE)
    throw new Error('Brief cleanup requires its isolated queue');
  return async () => {
    const client = await queue.getBackend().client;
    const cursorKey = queue.toKey('orphan-cleanup-offset');
    const states = ['waiting', 'delayed', 'active', 'failed', 'completed', 'paused'] as const;
    const parts = ((await client.get(cursorKey)) ?? '').split(':');
    const storedState = Number(parts[0]);
    const storedOffsets = parts[1]?.split(',').map(Number);
    const valid =
      Number.isInteger(storedState) &&
      storedState >= 0 &&
      storedState < states.length &&
      storedOffsets?.length === states.length &&
      storedOffsets.every((n) => Number.isSafeInteger(n) && n >= 0);
    const stateIndex = valid ? storedState : 0;
    const offsets = valid ? storedOffsets! : states.map(() => 0);
    const offset = offsets[stateIndex]!;
    const state = states[stateIndex]!;
    // BullMQ ranges are PER state, so read one state/page per tick. Its public
    // JobType omits paused in v6; use the concrete backend's list for that state.
    const pausedIds =
      state === 'paused' && offset < (await client.llen(queue.toKey('paused')))
        ? (await client.lrange(queue.toKey('paused'), -offset - 100, -offset - 1)).reverse()
        : [];
    const batch =
      state === 'paused'
        ? (await Promise.all(pausedIds.map((id) => queue.getJob(id)))).filter(
            (job) => job !== undefined,
          )
        : await queue.getJobs([state], offset, offset + 99, true);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const runIds = batch.flatMap((job) =>
      job.data.briefRunId && uuid.test(job.data.briefRunId) ? [job.data.briefRunId] : [],
    );
    const rows = runIds.length
      ? await db
          .select({ id: briefRuns.id, mailboxAccountId: mailboxAccounts.id, userId: users.id })
          .from(briefRuns)
          .innerJoin(
            mailboxAccounts,
            and(
              eq(mailboxAccounts.id, briefRuns.mailboxAccountId),
              eq(mailboxAccounts.workspaceId, briefRuns.workspaceId),
            ),
          )
          .innerJoin(
            users,
            and(
              eq(users.id, mailboxAccounts.userId),
              eq(users.workspaceId, mailboxAccounts.workspaceId),
            ),
          )
          .where(inArray(briefRuns.id, runIds))
      : [];
    const owned = new Map(rows.map((row) => [row.id, row]));
    let removed = 0;
    for (const job of batch) {
      const row = owned.get(job.data.briefRunId ?? '');
      if (
        row &&
        row.userId === job.data.userId &&
        row.mailboxAccountId === job.data.mailboxAccountId
      )
        continue;
      try {
        await job.remove();
        removed += 1;
      } catch {
        /* A locked active job is retried on a later sweep, never forgotten. */
      }
    }
    // Removal shifts subsequent pages left. Wrap after the last page.
    offsets[stateIndex] = batch.length < 100 ? 0 : offset + batch.length - removed;
    await client.set(cursorKey, `${(stateIndex + 1) % states.length}:${offsets.join(',')}`);
    // Bull events contain job identifiers too. Nothing depends on this history.
    if (removed > 0) await queue.trimEvents(0);
  };
}
