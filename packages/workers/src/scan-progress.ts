import type { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * The sync gate's "12,400 of 40,898 emails" counts (D109, D224): how far
 * the InitialSyncWorker's metadata read has got, and when it said so.
 *
 * One short-lived Redis key per mailbox — written per 500 messages read by
 * the worker, read by `GET /api/v1/sync/status`. Cleared when an attempt
 * starts and when the read ends; the TTL bounds a read that died midway.
 * Counts only: no message content.
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
 * The worker's side. `null` clears the counts; counts the reader would
 * reject are refused here, with what failed. Must settle promptly — back
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
      // Field by field, never a spread: nothing else rides into Redis.
      const record = ScanProgressRecordSchema.safeParse({
        processed: counts.processed,
        total: counts.total,
        at: now(),
      });
      if (!record.success) {
        throw new Error(`scan counts fail their schema (${describeIssues(record.error)})`);
      }
      await redis.set(key, JSON.stringify(record.data), 'EX', SCAN_PROGRESS_TTL_SECONDS);
    },
  };
}

/** A stored value as the record the worker wrote, or why it is not one — for the caller to log. */
export function parseScanProgressRecord(
  raw: string,
): { ok: true; record: ScanProgressRecord } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const parsed = ScanProgressRecordSchema.safeParse(value);
  return parsed.success
    ? { ok: true, record: parsed.data }
    : { ok: false, reason: describeIssues(parsed.error) };
}

/** Which field broke which rule (`total:too_small`, `:unrecognized_keys[subject]`) — never a value. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(
      (i) =>
        `${i.path.join('.')}:${i.code}${i.code === 'unrecognized_keys' ? `[${i.keys.join('|')}]` : ''}`,
    )
    .join(',');
}
