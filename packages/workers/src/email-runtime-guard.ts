import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DelayedError, UnrecoverableError, type Job, type Worker } from 'bullmq';
import type { EmailDeliveryPort, EmailSendJobData, EmailSendResult } from './email-send.worker.js';
import {
  EMAIL_RUNTIME_DELIVERY_FIELD,
  EMAIL_RUNTIME_LEASE_PROTOCOL,
  type EmailRuntimeLease,
} from './email-runtime-lease.js';
import { PermanentError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

// This marker lives on the existing BullMQ job hash: same IDs, namespace,
// retention/deletion and dedup semantics. Unknown attempts remain in the retained
// failed state; accepted completed outcomes keep the existing 7-day retention.
const SEND_FIELD = EMAIL_RUNTIME_DELIVERY_FIELD;
const BEGIN = `
local t=redis.call('TIME');local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
if redis.call('GET',KEYS[3])~=ARGV[2] then return {'lost'} end
local own=redis.call('HGET',KEYS[1],ARGV[1]);if not own then return {'lost'} end
if redis.call('HLEN',KEYS[1])>100 then return {'lost'} end
for _,value in ipairs(redis.call('HVALS',KEYS[1])) do
 local ok,a=pcall(cjson.decode,value)
 if not ok or type(a)~='table' or type(a.expiresAt)~='number' or a.expiresAt<=now or a.protocol~=ARGV[3] then return {'lost'} end
end
local ok,a=pcall(cjson.decode,own)
if not ok or a.revision~=ARGV[4] or a.source~=ARGV[5] then return {'lost'} end
local prior=redis.call('HGET',KEYS[2],ARGV[6]);if prior then return {'prior',prior} end
redis.call('HSET',KEYS[2],ARGV[6],cjson.encode({state='unknown',owner=ARGV[1],attempt=ARGV[7]}))
return {'begin',a.expiresAt-now}`;

const SETTLE = `
local old=redis.call('HGET',KEYS[1],ARGV[1]);if not old then return 0 end
local ok,d=pcall(cjson.decode,old)
if not ok or d.state~='unknown' or d.owner~=ARGV[2] or d.attempt~=ARGV[5] then return 0 end
if ARGV[3]=='unsent' then redis.call('HDEL',KEYS[1],ARGV[1])
else redis.call('HSET',KEYS[1],ARGV[1],ARGV[4]) end
return 1`;

/** Actual processor/delivery admission, never a discovery-only heartbeat. */
export class EmailRuntimeGuard {
  private readonly context = new AsyncLocalStorage<{
    job: Job<EmailSendJobData, EmailSendResult>;
    signal?: AbortSignal;
  }>();
  private readonly deliveries = new Set<Promise<unknown>>();

  constructor(
    readonly lease: EmailRuntimeLease,
    readonly port: EmailDeliveryPort,
  ) {}

  private async postpone(job: Job<EmailSendJobData, EmailSendResult>): Promise<never> {
    // Infrastructure admission is not an email attempt. BullMQ's DelayedError
    // preserves the existing finite attemptsMade budget and exact job ID.
    if (!job.token) throw new Error('Email runtime job ownership unavailable');
    await job.moveToDelayed(Date.now() + 60_000, job.token);
    throw new DelayedError();
  }

  async run(
    job: Job<EmailSendJobData, EmailSendResult>,
    process: () => Promise<EmailSendResult>,
  ): Promise<EmailSendResult> {
    let prior: string | null;
    try {
      await this.lease.assertAdmission();
      prior = await this.lease.connection.hget(`${job.queueQualifiedName}:${job.id}`, SEND_FIELD);
    } catch {
      return this.postpone(job);
    }
    // This runs before preferences/resolvers can return a completed skip. An
    // earlier uncertain send must stay failed/retained, not age out as completed.
    if (prior && this.isUnknown(prior))
      throw new UnrecoverableError('Email delivery settlement unverified');
    return this.context.run({ job }, process);
  }

  private isUnknown(value: string): boolean {
    try {
      const parsed = JSON.parse(value);
      return (
        parsed?.state !== 'accepted' ||
        !(parsed.providerId === null || typeof parsed.providerId === 'string')
      );
    } catch {
      return true;
    }
  }

  classifyDeliveryFailure = async (error: Error): Promise<Error> => {
    const current = this.context.getStore();
    if (!current) return new PermanentError('Email delivery settlement unverified');
    try {
      const value = await this.lease.connection.hget(
        `${current.job.queueQualifiedName}:${current.job.id}`,
        SEND_FIELD,
      );
      return value && this.isUnknown(value)
        ? new PermanentError('Email delivery settlement unverified')
        : error;
    } catch {
      return new PermanentError('Email delivery settlement unverified');
    }
  };

  assertDeliveryAdmission = async (ctx: WorkerContext): Promise<void> => {
    const current = this.context.getStore();
    if (!current || ctx.signal?.aborted) throw new Error('Email delivery admission unavailable');
    if (ctx.signal) current.signal = ctx.signal;
    try {
      await this.lease.assertAdmission();
    } catch {
      return this.postpone(current.job);
    }
  };

  readonly delivery: EmailDeliveryPort = {
    deliver: (input) => {
      const operation = this.deliver(input);
      this.deliveries.add(operation);
      const settled = () => {
        this.deliveries.delete(operation);
      };
      void operation.then(settled, settled);
      return operation;
    },
  };

  private async deliver(
    input: Parameters<EmailDeliveryPort['deliver']>[0],
  ): ReturnType<EmailDeliveryPort['deliver']> {
    const current = this.context.getStore();
    if (!current || current.signal?.aborted || !current.job.id || !current.job.token)
      throw new Error('Email delivery ownership unavailable');
    const { job } = current;
    const key = `${job.queueQualifiedName}:${job.id}`;
    const started = performance.now();
    const attempt = randomUUID();
    let response: unknown;
    try {
      response = await this.lease.connection.eval(
        BEGIN,
        3,
        this.lease.key,
        key,
        `${key}:lock`,
        this.lease.bootId,
        job.token!,
        EMAIL_RUNTIME_LEASE_PROTOCOL,
        this.lease.identity.revision,
        this.lease.identity.source,
        SEND_FIELD,
        attempt,
      );
    } catch {
      // No provider call occurred. Clear only this invocation's owned marker;
      // a lost response or earlier ambiguous attempt cannot erase another hold.
      await this.lease.connection
        .eval(SETTLE, 1, key, SEND_FIELD, this.lease.bootId, 'unsent', '{}', attempt)
        .catch(() => undefined);
      return this.postpone(job);
    }
    if (!Array.isArray(response) || response[0] === 'lost') return this.postpone(job);
    if (response[0] === 'prior') {
      let prior: { state?: unknown; providerId?: unknown };
      try {
        prior = JSON.parse(String(response[1]));
      } catch {
        throw new PermanentError('Email delivery settlement unverified');
      }
      if (
        prior?.state === 'accepted' &&
        (prior.providerId === null || typeof prior.providerId === 'string')
      )
        return { ok: true, providerId: prior.providerId };
      // No automatic resend of an accepted-response-lost or still-running call,
      // even beyond the provider's finite idempotency window or process restart.
      throw new PermanentError('Email delivery settlement unverified');
    }
    if (response[0] !== 'begin') throw new PermanentError('Email delivery settlement unverified');
    if (
      current.signal?.aborted ||
      !this.lease.isActive ||
      typeof response[1] !== 'number' ||
      performance.now() - started >= response[1]
    ) {
      // The provider has not been invoked; remove only our owned unsent marker.
      const cleared = await this.lease.connection.eval(
        SETTLE,
        1,
        key,
        SEND_FIELD,
        this.lease.bootId,
        'unsent',
        '{}',
        attempt,
      );
      if (cleared !== 1) throw new PermanentError('Email delivery settlement unverified');
      return this.postpone(job);
    }
    const outcome = await this.port.deliver(input);
    if (outcome.ok || outcome.reason !== 'transient') {
      const settled = await this.lease.connection.eval(
        SETTLE,
        1,
        key,
        SEND_FIELD,
        this.lease.bootId,
        outcome.ok ? 'accepted' : 'unsent',
        JSON.stringify(outcome.ok ? { state: 'accepted', providerId: outcome.providerId } : {}),
        attempt,
      );
      if (settled !== 1) throw new PermanentError('Email delivery settlement unverified');
    }
    return outcome;
  }

  /** Timeout of the processor does not settle its real provider promise. */
  async drain(): Promise<void> {
    while (this.deliveries.size) await Promise.allSettled([...this.deliveries]);
  }
}

/** Observe the real backend claim round. Connection readiness/isRunning alone
 * precede BullMQ's startup checks and do not establish a functioning poll loop.
 * This wraps the existing datastore call; it creates no control job or key. */
export function startEmailRuntimeConsumer<T, R>(
  worker: Worker<T, R>,
  lease: EmailRuntimeLease,
  onStopped: () => Promise<void>,
): Promise<void> {
  const backend = worker.getBackend();
  const original = backend.moveToActive.bind(backend);
  let ready!: () => void;
  let failed!: (error: Error) => void;
  const firstPoll = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  void firstPoll.catch(() => undefined);
  backend.moveToActive = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    backend.moveToActive = original;
    ready();
    return result;
  };
  const polling = worker.run();
  // Observe synchronous loss state before a delayed broker response/readiness
  // tail can overwrite it; remote invalidation follows on the owned connection.
  const stopped = async () => {
    failed(new Error('Email runtime polling stopped'));
    await onStopped();
  };
  void polling.then(stopped, stopped).catch(() => undefined);
  lease.observePolling(polling, async () => {});
  return firstPoll;
}

/** Health flips in the same turn as the post-await predicate check. */
export async function finishEmailRuntimeStartup(
  lease: EmailRuntimeLease,
  isReady: () => boolean,
  markReady: () => void,
): Promise<void> {
  await lease.assertAdmission();
  if (!lease.isActive || !isReady()) throw new Error('Email runtime readiness lost');
  markReady();
}
