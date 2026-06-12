import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { deadLetterJobs } from '@declutrmail/db';
import type { schema } from '@declutrmail/db';

/**
 * Dead-letter recorder seam (D225).
 *
 * `BaseDeclutrWorker` persists every TERMINAL failure to the
 * `dead_letter_jobs` table so the failure is durable beyond Redis
 * (BullMQ's failed set is capped and Redis is not the system of
 * record). The base class only knows this interface — the Drizzle
 * implementation below is constructed by the composition root
 * (`apps/api/src/worker.ts`) and installed on every worker via
 * `setDeadLetterRecorder()`, mirroring the `WorkerObserver` seam.
 *
 * Privacy (D7, D228): the recorder is the write boundary into an
 * unbounded jsonb column, so it ENFORCES the metadata-only contract
 * rather than trusting it — `sanitizeDeadLetterPayload()` allowlists
 * payload keys before persist and the `error` text is capped. A future
 * worker field that is not on the allowlist is dropped, never stored.
 */

/** One terminal failure, ready to park in `dead_letter_jobs`. */
export interface DeadLetterEntry {
  /** BullMQ queue name, e.g. `initial-sync`. */
  queue: string;
  /** BullMQ job id within the queue. */
  jobId: string;
  /** Job data as enqueued — allowlist-sanitized before persist (D7). */
  payload: unknown;
  /** Final error message/stack from the exhausting attempt. */
  error: string;
}

/**
 * The seam the base class records through. Implementations may throw —
 * the base class wraps every call and never lets a recorder failure
 * mask the original job failure.
 */
export interface DeadLetterRecorder {
  record(entry: DeadLetterEntry): Promise<void>;
}

/** The Drizzle client, bound to the full `@declutrmail/db` schema. */
type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * The D7 write-boundary allowlist — the exact union of keys across
 * every `*JobData` shape that runs through `BaseDeclutrWorker`
 * (initial/incremental sync, score, autopilot-apply, label-action,
 * unsub-execution, undo-expiry, followup-check, brief-snapshot,
 * senders-counter-reconciliation, dead-letter sweep). Mirrors the
 * closed-union `BUCKET_DEFAULTS` pattern: adding a key here is a
 * deliberate human edit, never an accident of a new worker's payload.
 *
 * REPLAY CONTRACT: `replayDeadLetterJob` hands the PERSISTED payload
 * back to enqueue. A new JobData field missing from this list is
 * stripped at park time, so its replay would silently re-run with a
 * partial payload — that friction is the point. When a new worker adds
 * a payload field, add it here in the same PR, and confirm it is queue
 * metadata (ids, cursors, scheduling keys), never message content (D7).
 */
export const DEAD_LETTER_PAYLOAD_ALLOWED_KEYS = [
  'actionId',
  'endHistoryId',
  'idempotencyKey',
  'mailboxAccountId',
  'producedAtMs',
  'scheduledAtMinute',
  'senderKey',
  'startHistoryId',
  'trigger',
  'triggeredAtMs',
] as const;

const ALLOWED_KEY_SET: ReadonlySet<string> = new Set(DEAD_LETTER_PAYLOAD_ALLOWED_KEYS);

/** Marker key listing what the sanitizer stripped — replay debugging aid. */
export const REDACTED_KEYS_MARKER = '__redacted_keys';

/**
 * Cap on the persisted `error` column (defense in depth). Worker errors
 * can interpolate Gmail error envelopes into stacks — the HTTP client's
 * `safeBody` caps responses at 300 chars, but that guard lives in
 * `apps/api`, not at this write boundary. Symmetric with the 200-char
 * `errorSummary` cap on the alert path (`dead-letter.worker.ts`), just
 * generous enough to keep full stack traces for replay debugging.
 */
export const DEAD_LETTER_ERROR_MAX_LEN = 2000;

/**
 * Drop every non-allowlisted key from a dead-letter payload before it
 * is persisted (D7 enforcement at the write boundary). Stripped keys
 * are recorded under `__redacted_keys` so replay debugging shows WHAT
 * was withheld without storing its value. Pure — exported for tests.
 *
 * Non-object payloads (no keys to allowlist) are not a known JobData
 * shape; they persist as a redaction marker only.
 */
export function sanitizeDeadLetterPayload(payload: unknown): Record<string, unknown> {
  if (payload === null || payload === undefined) {
    return {};
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { [REDACTED_KEYS_MARKER]: [Array.isArray(payload) ? '(array)' : `(${typeof payload})`] };
  }
  const kept: Record<string, unknown> = {};
  const redacted: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (ALLOWED_KEY_SET.has(key)) {
      kept[key] = value;
    } else {
      redacted.push(key);
    }
  }
  if (redacted.length > 0) {
    kept[REDACTED_KEYS_MARKER] = redacted.sort();
  }
  return kept;
}

/**
 * Production recorder — one INSERT per terminal failure. `failed_at`
 * defaults to `now()` in the schema; `(queue, job_id)` is deliberately
 * NOT unique so a replayed-then-dead-lettered-again job gets a fresh
 * row, preserving the full failure history. The payload is allowlist-
 * sanitized and the error capped HERE — at the write boundary — so no
 * upstream caller can park message content (D7).
 */
export class DrizzleDeadLetterRecorder implements DeadLetterRecorder {
  constructor(private readonly deps: { db: WorkerDb }) {}

  async record(entry: DeadLetterEntry): Promise<void> {
    await this.deps.db.insert(deadLetterJobs).values({
      queue: entry.queue,
      jobId: entry.jobId,
      payload: sanitizeDeadLetterPayload(entry.payload),
      error:
        entry.error.length > DEAD_LETTER_ERROR_MAX_LEN
          ? `${entry.error.slice(0, DEAD_LETTER_ERROR_MAX_LEN)}…`
          : entry.error,
    });
  }
}
