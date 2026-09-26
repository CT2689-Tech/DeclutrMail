import type { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * The sync gate's "12,400 of 40,898 emails" counts (D109, D224): how far
 * the InitialSyncWorker's metadata read has got, and when it said so.
 *
 * One short-lived Redis key per mailbox — written per saved batch by the
 * worker, read by `GET /api/v1/sync/status`. Cleared when an attempt
 * starts and when the read ends; the TTL bounds a read that died midway.
 * Counts only: no message-derived content.
 */

/** A key outlives its last write by this long — far past any gap between batches. */
export const SCAN_PROGRESS_TTL_SECONDS = 30 * 60;

export function scanProgressKey(mailboxAccountId: string): string {
  return `declutr:scan-progress:${mailboxAccountId}`;
}

/** Messages read of messages listed, and when the worker wrote it (its clock, ms). */
export const ScanProgressRecordSchema = z
  .object({
    processed: z.number().int().min(0),
    total: z.number().int().min(1),
    at: z.number().int().min(0),
  })
  .strict()
  .refine((r) => r.processed <= r.total, { message: 'processed exceeds total' });
export type ScanProgressRecord = z.infer<typeof ScanProgressRecordSchema>;

export interface ScanCounts {
  processed: number;
  total: number;
}

/**
 * The worker's side. `null` clears the counts. Must settle promptly — back
 * it with a fail-fast connection, so a Redis outage costs the line, never
 * the scan.
 */
export interface ScanProgressStore {
  write(mailboxAccountId: string, counts: ScanCounts | null): Promise<void>;
}

export function createRedisScanProgressStore(
  redis: Pick<Redis, 'set' | 'del'>,
  now: () => number = Date.now,
): ScanProgressStore {
  return {
    async write(mailboxAccountId, counts) {
      const key = scanProgressKey(mailboxAccountId);
      if (counts === null) {
        await redis.del(key);
        return;
      }
      const record: ScanProgressRecord = {
        processed: counts.processed,
        total: counts.total,
        at: now(),
      };
      await redis.set(key, JSON.stringify(record), 'EX', SCAN_PROGRESS_TTL_SECONDS);
    },
  };
}

/** A stored value as the record the worker wrote, or `null` for anything else — the caller logs it. */
export function parseScanProgressRecord(raw: string): ScanProgressRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ScanProgressRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
