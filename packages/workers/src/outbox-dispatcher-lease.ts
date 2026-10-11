import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Cross-process single-holder lease for `OutboxDispatcherWorker` (D13).
 *
 * The dispatcher's orphan guard is process-local, so two live dispatcher
 * processes could each re-invoke a concurrency unit the other abandoned.
 * Cloud Run does not promise that a rollout stops the old instance before
 * starting the new one — services overlap revisions, and the worker-pool
 * instance-split docs say reallocation "is not instantaneous" — so only the
 * process holding this lease claims outbox rows.
 *
 * Safety rests on local validity never outliving Redis validity: the
 * deadline is measured from BEFORE the command was sent, minus a margin,
 * so the key always expires in Redis no earlier than this process stops
 * treating itself as the holder. Any failure, timeout or foreign holder
 * stands the process down immediately; standing down only delays delivery.
 */
export const OUTBOX_DISPATCHER_LEASE_KEY = 'declutrmail:outbox-dispatcher:lease';

const ACQUIRE_OR_RENEW = `
local holder = redis.call('GET', KEYS[1])
if holder == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
if not holder then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface OutboxDispatcherLease {
  /** Acquires or renews when the local deadline has lapsed; true only while held. */
  ensureHeld(): Promise<boolean>;
  /** Local check, no network call — safe inside an open transaction. */
  isHeld(): boolean;
  /** Starts periodic renewal; `onAcquired` fires when a standby process takes over. */
  start(onAcquired: () => void): void;
  /** Stops renewal and deletes the key only if this process still owns it. */
  release(): Promise<void>;
}

export interface RedisOutboxDispatcherLeaseOptions {
  ttlMs?: number;
  renewEveryMs?: number;
  safetyMarginMs?: number;
  commandTimeoutMs?: number;
  key?: string;
  token?: string;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

type LeaseState = 'held' | 'standby' | 'unavailable' | 'released';

export class RedisOutboxDispatcherLease implements OutboxDispatcherLease {
  private readonly ttlMs: number;
  private readonly renewEveryMs: number;
  private readonly safetyMarginMs: number;
  private readonly commandTimeoutMs: number;
  private readonly key: string;
  private readonly token: string;
  private readonly now: () => number;
  private readonly log: (line: Record<string, unknown>) => void;
  private validUntil = 0;
  private refreshing: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastState: LeaseState | null = null;
  private released = false;

  constructor(
    private readonly redis: Pick<Redis, 'eval'>,
    options: RedisOutboxDispatcherLeaseOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.renewEveryMs = options.renewEveryMs ?? 10_000;
    this.safetyMarginMs = options.safetyMarginMs ?? 5_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 5_000;
    this.key = options.key ?? OUTBOX_DISPATCHER_LEASE_KEY;
    this.token = options.token ?? randomUUID();
    // Monotonic: a wall-clock step backward must not stretch local validity.
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? ((line) => console.log(JSON.stringify(line)));
    // A renewal must land, with its timeout, before the local deadline lapses.
    if (this.renewEveryMs + this.commandTimeoutMs >= this.ttlMs - this.safetyMarginMs)
      throw new Error('Outbox lease renewal cadence must fit inside its validity window');
  }

  isHeld(): boolean {
    return this.now() < this.validUntil;
  }

  async ensureHeld(): Promise<boolean> {
    return this.isHeld() || this.refresh();
  }

  start(onAcquired: () => void): void {
    if (this.timer || this.released) return;
    this.timer = setInterval(() => {
      const wasHeld = this.isHeld();
      void this.refresh().then((held) => {
        if (held && !wasHeld) onAcquired();
      });
    }, this.renewEveryMs);
    this.timer.unref();
  }

  async release(): Promise<void> {
    this.released = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.validUntil = 0;
    // An in-flight renewal must not re-arm the deadline after release.
    await this.refreshing;
    try {
      await this.bounded(this.redis.eval(RELEASE, 1, this.key, this.token));
    } catch {
      // The key still expires on its own TTL; nothing else needs to happen.
    }
    this.transition('released');
  }

  private refresh(): Promise<boolean> {
    if (this.released) return Promise.resolve(false);
    this.refreshing ??= this.acquireOrRenew().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async acquireOrRenew(): Promise<boolean> {
    const sentAt = this.now();
    let reply: unknown;
    try {
      reply = await this.bounded(
        this.redis.eval(ACQUIRE_OR_RENEW, 1, this.key, this.token, String(this.ttlMs)),
      );
    } catch {
      this.validUntil = 0;
      this.transition('unavailable');
      return false;
    }
    if (this.released) {
      this.validUntil = 0;
      return false;
    }
    if (reply === 1) {
      this.validUntil = sentAt + this.ttlMs - this.safetyMarginMs;
      this.transition('held');
      return true;
    }
    this.validUntil = 0;
    this.transition('standby');
    return false;
  }

  private async bounded<T>(command: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        command,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Outbox lease command timed out')),
            this.commandTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private transition(state: LeaseState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.log({
      level: state === 'unavailable' ? 'warn' : 'info',
      kind: `outbox.dispatch.lease_${state}`,
      worker: 'OutboxDispatcherWorker',
    });
  }
}
