import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  SyncMessageProgressSchema,
  type SyncMessageProgress,
  type SyncStatus,
} from '@declutrmail/shared/contracts';
import type { InitialSyncJobData } from '@declutrmail/workers';

/**
 * DI token for a READ-ONLY handle on the initial-sync queue, built on a
 * fail-fast Redis connection (`createRedisProducerConnection`). The
 * status route is polled every 3s; on the shared worker-style connection
 * a Redis outage would buffer each read and hang the poll instead of
 * failing it.
 */
export const INITIAL_SYNC_PROGRESS_QUEUE_TOKEN = 'INITIAL_SYNC_PROGRESS_QUEUE';

/**
 * Reads the running scan's counts for the sync gate's "12,400 of 40,898
 * emails" line (D109, D224) — the InitialSyncWorker writes them onto its
 * own BullMQ job (`jobId = mailboxAccountId`) with every saved batch.
 *
 * Only while the gate row says the scan is reading the mailbox. Any
 * other state, a missing job, BullMQ's default progress (0 — a new job,
 * or one a retried attempt has cleared) or an unreadable Redis all
 * return `null`, and the line disappears: it never shows a guessed 0 or
 * another run's numbers. Counts only — no message-derived content.
 */
@Injectable()
export class InitialSyncProgressReader {
  constructor(
    @Inject(INITIAL_SYNC_PROGRESS_QUEUE_TOKEN)
    private readonly queue: Queue<InitialSyncJobData>,
  ) {}

  async read(
    mailboxAccountId: string,
    status: Pick<SyncStatus, 'readiness_status' | 'current_stage'>,
  ): Promise<SyncMessageProgress | null> {
    if (status.readiness_status !== 'syncing' || status.current_stage !== 'fetching_metadata') {
      return null;
    }
    try {
      const job = await this.queue.getJob(mailboxAccountId);
      const parsed = SyncMessageProgressSchema.safeParse(job?.progress);
      return parsed.success ? parsed.data : null;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'sync.scan_progress_read_failed',
          mailboxAccountId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    }
  }
}
