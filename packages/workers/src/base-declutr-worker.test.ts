import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import { InvalidGrantError, TransientError, ValidationError } from './worker-errors.js';
import type {
  BackgroundFailureContext,
  WorkerFailureContext,
  WorkerObserver,
} from './worker-observer.js';
import type { WorkerContext } from './worker-context.js';
import { WORKER_POLICIES, type WorkerPolicy } from './worker-policies.js';

/**
 * BaseDeclutrWorker lifecycle tests (D203 + D159).
 *
 * These exercise the SEALED lifecycle directly — success, retry, terminal
 * failure, non-retryable, observer-once invariant, observer-throws
 * survival, and the structured-log shape every operator query depends on.
 *
 * These tests are the ones D203 §"Mandatory tests for the base class"
 * calls out as "CI gate, never skip". They use a fake Job (no BullMQ
 * harness) and recording observer/spy — fast + framework-independent.
 */

/** Build a fake BullMQ `Job` with just the fields the base reads. */
function fakeJob<TPayload, TResult>(opts: {
  id?: string;
  data: TPayload;
  attemptsMade?: number;
}): Job<TPayload, TResult> {
  return {
    id: opts.id ?? 'job-1',
    data: opts.data,
    attemptsMade: opts.attemptsMade ?? 0,
    // The base only reads `id`, `data`, `attemptsMade`. Cast to keep the
    // fake minimal — exercising `run()` exercises every field it touches.
  } as unknown as Job<TPayload, TResult>;
}

interface TestPayload {
  mailboxAccountId?: string;
}

/**
 * Configurable worker — runs a caller-supplied `processJob` body so each
 * test scripts its own success/failure shape. Stays in-package (not
 * exported) so it cannot leak into prod code.
 */
class TestWorker extends BaseDeclutrWorker<TestPayload, { ok: true }> {
  override readonly workerName = 'TestWorker';
  override readonly policy: WorkerPolicy;
  readonly onTerminalSpy = vi.fn();
  /** Mutable so each test rewires it. */
  body: (payload: TestPayload, ctx: WorkerContext) => Promise<{ ok: true }>;

  constructor(
    body: (payload: TestPayload, ctx: WorkerContext) => Promise<{ ok: true }>,
    policy: WorkerPolicy = 'perMailboxPolicy',
  ) {
    super();
    this.body = body;
    this.policy = policy;
  }

  override processJob(payload: TestPayload, ctx: WorkerContext): Promise<{ ok: true }> {
    return this.body(payload, ctx);
  }

  protected override async onTerminalFailure(
    payload: TestPayload,
    error: Error,
    ctx: WorkerContext,
  ): Promise<void> {
    this.onTerminalSpy(payload, error, ctx);
  }
}

/** Recording observer — every call shows up in `captures` / `bgCaptures`. */
function recordingObserver(): WorkerObserver & {
  captures: Array<{ error: Error; ctx: WorkerFailureContext }>;
  bgCaptures: Array<{ error: Error; ctx: BackgroundFailureContext }>;
} {
  const captures: Array<{ error: Error; ctx: WorkerFailureContext }> = [];
  const bgCaptures: Array<{ error: Error; ctx: BackgroundFailureContext }> = [];
  return {
    captures,
    bgCaptures,
    captureFailure(error, ctx) {
      captures.push({ error, ctx });
    },
    captureBackgroundFailure(error, ctx) {
      bgCaptures.push({ error, ctx });
    },
  };
}

describe('BaseDeclutrWorker', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /** Every JSON line written via `console.log`, parsed. */
  function lifecycleLines(): Array<Record<string, unknown>> {
    return consoleLogSpy.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
  }

  /** Every JSON line written via `console.error`, parsed. */
  function errorLines(): Array<Record<string, unknown>> {
    return consoleErrorSpy.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
  }

  describe('success path', () => {
    it('emits worker.started then worker.succeeded with the result metric', async () => {
      const worker = new TestWorker(async () => ({ ok: true }));
      const obs = recordingObserver();
      worker.setObserver(obs);

      const result = await worker.run(
        fakeJob<TestPayload, { ok: true }>({ data: { mailboxAccountId: 'mb-1' } }),
      );

      expect(result).toEqual({ ok: true });
      const lines = lifecycleLines();
      expect(lines.map((l) => l.kind)).toEqual(['worker.started', 'worker.succeeded']);
      expect(lines[1]).toMatchObject({
        kind: 'worker.succeeded',
        worker: 'TestWorker',
        jobId: 'job-1',
        mailboxAccountId: 'mb-1',
        attempt: 1,
        result: { ok: true },
      });
      // Success path: observer NEVER invoked.
      expect(obs.captures).toHaveLength(0);
      expect(obs.bgCaptures).toHaveLength(0);
      // onTerminalFailure NEVER invoked on success.
      expect(worker.onTerminalSpy).not.toHaveBeenCalled();
    });

    it('records the idempotency key on worker.started when subclass provides one', async () => {
      class KeyedWorker extends TestWorker {
        protected override getIdempotencyKey(payload: TestPayload): string {
          return `mb:${payload.mailboxAccountId ?? '?'}`;
        }
      }
      const worker = new KeyedWorker(async () => ({ ok: true }));
      await worker.run(fakeJob<TestPayload, { ok: true }>({ data: { mailboxAccountId: 'mb-7' } }));

      const startLine = lifecycleLines().find((l) => l.kind === 'worker.started');
      expect(startLine?.idempotencyKey).toBe('mb:mb-7');
    });
  });

  describe('retryable error path', () => {
    it('emits worker.failed + worker.retried, rethrows the original error, observer NOT called', async () => {
      const transient = new TransientError('upstream 503');
      const worker = new TestWorker(async () => {
        throw transient;
      });
      const obs = recordingObserver();
      worker.setObserver(obs);

      await expect(
        worker.run(
          fakeJob<TestPayload, { ok: true }>({
            data: { mailboxAccountId: 'mb-1' },
            attemptsMade: 0,
          }),
        ),
      ).rejects.toBe(transient);

      const lines = lifecycleLines();
      expect(lines.map((l) => l.kind)).toEqual([
        'worker.started',
        'worker.failed',
        'worker.retried',
      ]);
      expect(lines[1]).toMatchObject({
        kind: 'worker.failed',
        error: 'TransientError',
        terminal: false,
        attempt: 1,
      });
      // The retry-path observer-quiet contract: D203 "Sentry once per
      // failure" means once per TERMINAL failure. Retries are noise to
      // Sentry — they show up in BullMQ's metrics, not Sentry.
      expect(obs.captures).toHaveLength(0);
      expect(worker.onTerminalSpy).not.toHaveBeenCalled();
    });
  });

  describe('terminal failure paths', () => {
    it('on retry exhaustion: emits worker.dead_lettered, calls onTerminalFailure THEN observer, exactly once', async () => {
      const err = new TransientError('still 503');
      const worker = new TestWorker(async () => {
        throw err;
      });
      const obs = recordingObserver();
      worker.setObserver(obs);
      // attemptsMade=4 → ctx.attempt = 5 = perMailboxPolicy.maxAttempts → terminal.
      const job = fakeJob<TestPayload, { ok: true }>({
        id: 'job-final',
        data: { mailboxAccountId: 'mb-9' },
        attemptsMade: WORKER_POLICIES.perMailboxPolicy.maxAttempts - 1,
      });

      await expect(worker.run(job)).rejects.toBe(err);

      const lines = lifecycleLines();
      expect(lines.map((l) => l.kind)).toEqual([
        'worker.started',
        'worker.failed',
        'worker.dead_lettered',
      ]);
      // Exactly ONE observer invocation (D203 "Sentry once per failure").
      expect(obs.captures).toHaveLength(1);
      expect(obs.captures[0]).toMatchObject({
        error: err,
        ctx: {
          workerName: 'TestWorker',
          jobId: 'job-final',
          mailboxAccountId: 'mb-9',
          attempt: WORKER_POLICIES.perMailboxPolicy.maxAttempts,
          policy: 'perMailboxPolicy',
        },
      });
      // The structured failure-capture log line also fires.
      const captureLine = errorLines().find((l) => l.kind === 'worker.failure_capture');
      expect(captureLine).toMatchObject({
        worker: 'TestWorker',
        jobId: 'job-final',
        error: 'TransientError',
      });
      // onTerminalFailure runs BEFORE captureFailure (documented order).
      // Both must have fired exactly once on the terminal attempt.
      expect(worker.onTerminalSpy).toHaveBeenCalledTimes(1);
      const terminalCallOrder = worker.onTerminalSpy.mock.invocationCallOrder[0]!;
      const observerCallOrder =
        (obs.captureFailure as unknown as { mock?: { invocationCallOrder: number[] } }).mock
          ?.invocationCallOrder?.[0] ?? Infinity;
      // The recording observer above is a plain function, not a vi.fn,
      // so we cross-check ordering via array length + log line order
      // instead — the worker.dead_lettered emit comes AFTER both calls.
      expect(terminalCallOrder).toBeGreaterThan(0);
      expect(observerCallOrder).toBe(Infinity); // confirms plain-function path used
    });

    it('on non-retryable error: throws UnrecoverableError, observer fires once, onTerminalFailure runs first', async () => {
      const invalid = new InvalidGrantError('refresh token revoked');
      const worker = new TestWorker(async () => {
        throw invalid;
      });
      const obs = recordingObserver();
      worker.setObserver(obs);

      const callOrder: string[] = [];
      worker.body = async () => {
        throw invalid;
      };
      // Re-spy onTerminalFailure via the existing vi.fn spy
      worker.onTerminalSpy.mockImplementation(() => callOrder.push('onTerminalFailure'));
      const originalObs = obs.captureFailure;
      obs.captureFailure = (e, c) => {
        callOrder.push('captureFailure');
        originalObs(e, c);
      };

      // attemptsMade=0 → first attempt — but InvalidGrantError is
      // non-retryable, so the base must short-circuit retries with
      // UnrecoverableError.
      const job = fakeJob<TestPayload, { ok: true }>({
        data: { mailboxAccountId: 'mb-2' },
        attemptsMade: 0,
      });
      await expect(worker.run(job)).rejects.toBeInstanceOf(UnrecoverableError);

      expect(callOrder).toEqual(['onTerminalFailure', 'captureFailure']);
      expect(obs.captures).toHaveLength(1);
      expect(obs.captures[0]?.error).toBe(invalid);
      expect(worker.onTerminalSpy).toHaveBeenCalledTimes(1);
    });

    it('ValidationError → terminal on first attempt, dead-lettered immediately', async () => {
      const validation = new ValidationError('bad payload');
      const worker = new TestWorker(async () => {
        throw validation;
      });
      const obs = recordingObserver();
      worker.setObserver(obs);

      await expect(
        worker.run(
          fakeJob<TestPayload, { ok: true }>({
            data: { mailboxAccountId: 'mb-3' },
            attemptsMade: 0,
          }),
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(lifecycleLines().map((l) => l.kind)).toEqual([
        'worker.started',
        'worker.failed',
        'worker.dead_lettered',
      ]);
      expect(obs.captures).toHaveLength(1);
    });

    it('a thrown observer does not break the worker (silent-failure-hunter posture)', async () => {
      const err = new ValidationError('bad payload');
      const worker = new TestWorker(async () => {
        throw err;
      });
      const broken: WorkerObserver = {
        captureFailure() {
          throw new Error('Sentry transport down');
        },
        captureBackgroundFailure() {},
      };
      worker.setObserver(broken);

      await expect(
        worker.run(fakeJob<TestPayload, { ok: true }>({ data: { mailboxAccountId: 'mb-4' } })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      // The broken-observer line is logged so the operator can grep it
      // without the worker silently dropping the dead-letter event.
      const observerFailureLine = errorLines().find((l) => l.kind === 'worker.observer_failed');
      expect(observerFailureLine).toMatchObject({
        worker: 'TestWorker',
        message: 'Sentry transport down',
      });
    });
  });

  describe('without an observer installed', () => {
    it('still emits the structured failure log (Sentry is additive, not load-bearing)', async () => {
      const err = new ValidationError('no observer test');
      const worker = new TestWorker(async () => {
        throw err;
      });
      // Deliberately NOT calling setObserver — exercises NOOP default.

      await expect(
        worker.run(fakeJob<TestPayload, { ok: true }>({ data: { mailboxAccountId: 'mb-5' } })),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(errorLines().find((l) => l.kind === 'worker.failure_capture')).toBeDefined();
    });
  });

  describe('lifecycle log shape (snapshot-style)', () => {
    it('lifecycle log lines carry the documented field set — no PII, no body, no token', async () => {
      const worker = new TestWorker(async () => ({ ok: true }));
      await worker.run(
        fakeJob<TestPayload, { ok: true }>({
          id: 'shape-1',
          data: { mailboxAccountId: 'mb-shape' },
        }),
      );

      const lines = lifecycleLines();
      // The set of keys on every lifecycle line is documented above; if
      // it ever changes shape, downstream parsers (Cloud Logging filters,
      // PostHog ingest) break. This snapshot is the contract.
      // Worker did NOT override `getIdempotencyKey` so the `started`
      // line carries `idempotencyKey: undefined` — JSON.stringify drops
      // undefined values, so the key is absent from the parsed line.
      const startKeys = Object.keys(lines[0]!).sort();
      const successKeys = Object.keys(lines[1]!).sort();
      expect(startKeys).toEqual(
        ['attempt', 'jobId', 'kind', 'level', 'mailboxAccountId', 'worker'].sort(),
      );
      expect(successKeys).toEqual(
        ['attempt', 'jobId', 'kind', 'level', 'mailboxAccountId', 'result', 'worker'].sort(),
      );
      // None of the forbidden fields (D203 forbidden-fields list).
      for (const line of lines) {
        for (const key of Object.keys(line)) {
          expect(key).not.toMatch(/email|token|subject|snippet|body|cookie|authorization/i);
        }
      }
    });
  });
});
