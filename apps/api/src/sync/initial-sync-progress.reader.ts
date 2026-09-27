import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  SyncMessageProgressSchema,
  type SyncMessageProgress,
  type SyncStatus,
} from '@declutrmail/shared/contracts';
import {
  createRedisProducerConnection,
  parseScanProgressRecord,
  scanProgressKey,
} from '@declutrmail/workers';

/** DI token for the status poll's one Redis read ({@link createScanProgressRedis}). */
export const SCAN_PROGRESS_REDIS_TOKEN = 'SCAN_PROGRESS_REDIS';

/**
 * The client behind {@link SCAN_PROGRESS_REDIS_TOKEN}: fail-fast and
 * deadline-bound, so an outage or a Redis that stops answering drops the
 * line within half a second instead of holding the gate's 3s poll. Its
 * 'error' events are logged by the reader.
 */
export function createScanProgressRedis(url: string): Redis {
  return createRedisProducerConnection(url, { commandTimeout: 500 });
}

/** One warning per kind per minute, per process — the route is polled every 3s. */
const WARN_EVERY_MS = 60_000;

/**
 * Reads the running scan's counts for the sync gate's "12,400 of 40,898
 * emails" line (D109, D224) from the InitialSyncWorker's short-lived key
 * (packages/workers/src/scan-progress.ts), with how long ago it wrote them.
 *
 * Only while the gate row says the scan is reading the mailbox. Any other
 * state, or no key (not listed yet, or cleared), is `null`: there are no
 * counts. A read that fails — an unreachable Redis, an unreadable value —
 * is `undefined`: the line drops for that poll and the gate's time left
 * keeps its pace, as for a missed poll. Never a guessed 0 or another
 * run's numbers. Counts only — no message content.
 */
@Injectable()
export class InitialSyncProgressReader {
  private readonly warned = new Map<string, { at: number; suppressed: number }>();

  constructor(
    @Inject(SCAN_PROGRESS_REDIS_TOKEN) private readonly redis: Pick<Redis, 'get' | 'on'>,
  ) {
    // The client's own failures — a deadline below Redis's round trip
    // times out its handshake, so it never becomes ready — reach only this
    // event; every read would otherwise report a bare "not writeable".
    redis.on('error', (err: Error) => {
      this.warn('sync.scan_progress_connection_error', err.message);
    });
  }

  async read(
    mailboxAccountId: string,
    status: Pick<SyncStatus, 'readiness_status' | 'current_stage'>,
  ): Promise<SyncMessageProgress | null | undefined> {
    if (status.readiness_status !== 'syncing' || status.current_stage !== 'fetching_metadata') {
      return null;
    }
    let raw: string | null;
    try {
      raw = await this.redis.get(scanProgressKey(mailboxAccountId));
    } catch (err) {
      this.warn(
        'sync.scan_progress_read_failed',
        err instanceof Error ? err.message : String(err),
        mailboxAccountId,
      );
      return undefined;
    }
    // Not listed yet, or cleared between attempts: the designed "no line".
    if (raw === null) {
      return null;
    }
    const parsed = parseScanProgressRecord(raw);
    if (!parsed.ok) {
      this.warn('sync.scan_progress_unreadable', parsed.reason, mailboxAccountId);
      return undefined;
    }
    const progress = SyncMessageProgressSchema.safeParse({
      processed: parsed.record.processed,
      total: parsed.record.total,
      age_ms: Math.max(0, Date.now() - parsed.record.at),
    });
    if (!progress.success) {
      const why = progress.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(',');
      this.warn('sync.scan_progress_unreadable', why, mailboxAccountId);
      return undefined;
    }
    return progress.data;
  }

  /** Throttled per kind; the next line says how many were held back. */
  private warn(kind: string, message: string, mailboxAccountId?: string): void {
    const now = Date.now();
    const last = this.warned.get(kind);
    if (last !== undefined && now - last.at < WARN_EVERY_MS) {
      last.suppressed += 1;
      return;
    }
    this.warned.set(kind, { at: now, suppressed: 0 });
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind,
        ...(mailboxAccountId === undefined ? {} : { mailboxAccountId }),
        message,
        ...(last?.suppressed ? { suppressed: last.suppressed } : {}),
      }),
    );
  }
}
