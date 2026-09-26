import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  SyncMessageProgressSchema,
  type SyncMessageProgress,
  type SyncStatus,
} from '@declutrmail/shared/contracts';
import { parseScanProgressRecord, scanProgressKey } from '@declutrmail/workers';

/**
 * DI token for the status poll's one Redis read: a raw client built on
 * `createRedisProducerConnection` with a `commandTimeout`, so an outage or
 * a silent Redis drops the line within the deadline instead of holding
 * the gate's 3s poll.
 */
export const SCAN_PROGRESS_REDIS_TOKEN = 'SCAN_PROGRESS_REDIS';

/** One warning per kind per minute, per process — the route is polled every 3s. */
const WARN_EVERY_MS = 60_000;

/**
 * Reads the running scan's counts for the sync gate's "12,400 of 40,898
 * emails" line (D109, D224) from the InitialSyncWorker's short-lived key
 * (packages/workers/src/scan-progress.ts), with how long ago it wrote them.
 *
 * Only while the gate row says the scan is reading the mailbox. Any other
 * state, a missing key (not listed yet, or cleared), an unreadable value
 * or an unreachable Redis returns `null`, and the line disappears: it
 * never shows a guessed 0 or another run's numbers. Counts only — no
 * message content.
 */
@Injectable()
export class InitialSyncProgressReader {
  private readonly lastWarnAt = new Map<string, number>();

  constructor(@Inject(SCAN_PROGRESS_REDIS_TOKEN) private readonly redis: Pick<Redis, 'get'>) {}

  async read(
    mailboxAccountId: string,
    status: Pick<SyncStatus, 'readiness_status' | 'current_stage'>,
  ): Promise<SyncMessageProgress | null> {
    if (status.readiness_status !== 'syncing' || status.current_stage !== 'fetching_metadata') {
      return null;
    }
    let raw: string | null;
    try {
      raw = await this.redis.get(scanProgressKey(mailboxAccountId));
    } catch (err) {
      this.warn(
        'sync.scan_progress_read_failed',
        mailboxAccountId,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    // Not listed yet, or cleared between attempts: the designed "no line".
    if (raw === null) {
      return null;
    }
    const record = parseScanProgressRecord(raw);
    const progress =
      record &&
      SyncMessageProgressSchema.safeParse({
        processed: record.processed,
        total: record.total,
        age_ms: Math.max(0, Date.now() - record.at),
      });
    if (!progress?.success) {
      this.warn(
        'sync.scan_progress_unreadable',
        mailboxAccountId,
        'stored counts fail their schema',
      );
      return null;
    }
    return progress.data;
  }

  private warn(kind: string, mailboxAccountId: string, message: string): void {
    const now = Date.now();
    const last = this.lastWarnAt.get(kind);
    if (last !== undefined && now - last < WARN_EVERY_MS) {
      return;
    }
    this.lastWarnAt.set(kind, now);
    console.warn(JSON.stringify({ level: 'warn', kind, mailboxAccountId, message }));
  }
}
