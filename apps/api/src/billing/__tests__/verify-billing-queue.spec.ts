import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { ActorError } = vi.hoisted(() => ({
  ActorError: class extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  },
}));
type Read = (queue: unknown) => Promise<unknown>;
type WithQueue = (read: Read) => Promise<unknown>;
const f = vi.hoisted(() => ({
  connection: { on: vi.fn(), disconnect: vi.fn(), status: 'ready' },
  queue: { on: vi.fn(), close: vi.fn(async () => undefined) },
  construct: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(async (_queue: unknown): Promise<unknown> => ({ workers: 1 })),
  sample: vi.fn(),
}));
vi.mock('@declutrmail/workers', () => ({
  createRedisConnection: f.connect,
  EMAIL_SEND_QUEUE: 'email-send',
  QueueActorCompatibilityError: ActorError,
  sampleEmailQueueCompatibility: f.sample,
}));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (name, options) {
    f.construct(name, options);
    return f.queue;
  }),
}));
import {
  PROBE_DEADLINE_MS,
  PROBE_EXIT_CODES,
  PROBE_SAMPLING,
  probeFailureReason,
  verifyBillingQueue,
} from '../verify-billing-queue.js';

/** Default sampler: two samples, each through the probe's own fresh handle. */
async function twoSamples(withQueue: WithQueue) {
  await withQueue(f.read);
  return withQueue(f.read);
}

describe('standalone billing queue probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.construct.mockImplementation(() => undefined);
    f.connection.status = 'ready';
    f.connect.mockReturnValue(f.connection);
    f.read.mockResolvedValue({ workers: 1 });
    f.sample.mockImplementation(twoSamples);
    vi.stubEnv('BILLING_NOTICE_PROBE', 'true');
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', 'redis://127.0.0.1:1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it('requires explicit probe enrollment and bound runtime configuration', async () => {
    vi.stubEnv('BILLING_NOTICE_PROBE', 'false');
    await expect(verifyBillingQueue()).rejects.toThrow('configuration unavailable');
    vi.stubEnv('BILLING_NOTICE_PROBE', 'true');
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', '');
    await expect(verifyBillingQueue()).rejects.toThrow('configuration unavailable');
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('samples over a bounded window through a fresh, closed connection per sample', async () => {
    await expect(verifyBillingQueue()).resolves.toEqual({ workers: 1 });
    expect(f.sample).toHaveBeenCalledWith(expect.any(Function), {
      samples: 5,
      intervalMs: 3_000,
    });
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.construct).toHaveBeenCalledWith('email-send', {
      connection: f.connection,
      skipMetasUpdate: true,
    });
    expect(f.read).toHaveBeenCalledWith(f.queue);
    expect(f.connection.disconnect).toHaveBeenCalledTimes(2);
    expect(f.queue.close).toHaveBeenCalledTimes(2);
  });
  it('keeps the sampling window inside the deadline and the deadline inside the task', () => {
    const waits = (PROBE_SAMPLING.samples - 1) * PROBE_SAMPLING.intervalMs;
    // Each sample's fresh TLS connect and read needs room beside the waits.
    expect(PROBE_DEADLINE_MS - waits).toBeGreaterThanOrEqual(PROBE_SAMPLING.samples * 4_000);
    // Leaves room for container startup (run 447 refused 12 s after start)
    // inside the task's 60 s timeout.
    expect(PROBE_DEADLINE_MS + 20_000).toBeLessThanOrEqual(60_000);
    expect(PROBE_SAMPLING.samples).toBeGreaterThan(1);
  });
  it('refuses unknown actor evidence and still closes both handles', async () => {
    f.read.mockRejectedValueOnce(new Error('unknown actor'));
    await expect(verifyBillingQueue()).rejects.toThrow('unknown actor');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('requires preference compatibility even while billing notices are off', async () => {
    vi.stubEnv('BILLING_APP_NOTICES_ENABLED', 'false');
    f.sample.mockRejectedValueOnce(new Error('old preference actor'));
    await expect(verifyBillingQueue()).rejects.toThrow('old preference actor');
  });
  it('closes its connection if queue construction fails', async () => {
    f.construct.mockImplementationOnce(() => {
      throw new Error('queue unavailable');
    });
    await expect(verifyBillingQueue()).rejects.toThrow('queue unavailable');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).not.toHaveBeenCalled();
  });
  it('bounds stalled reads and disconnects before leaving the private task', async () => {
    vi.useFakeTimers();
    f.read.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(verifyBillingQueue()).rejects.toThrow('probe deadline');
    await vi.advanceTimersByTimeAsync(PROBE_DEADLINE_MS);
    await result;
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('opens no further broker connection once the deadline has fired', async () => {
    vi.useFakeTimers();
    let resume!: () => void;
    let late: Promise<unknown> | undefined;
    f.sample.mockImplementationOnce(async (withQueue: WithQueue) => {
      await new Promise<void>((resolve) => (resume = resolve));
      late = withQueue(f.read).catch((e: unknown) => e);
      return late;
    });
    const pending = verifyBillingQueue().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PROBE_DEADLINE_MS);
    expect(probeFailureReason(await pending)).toBe('redis_not_ready');
    resume();
    await vi.waitFor(() => expect(late).toBeDefined());
    await late;
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('names configuration refusal without connecting', async () => {
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', '');
    const error = await verifyBillingQueue().catch((e: unknown) => e);
    expect(probeFailureReason(error)).toBe('configuration_unavailable');
  });
  it('passes broker actor refusals through as their fixed reason', async () => {
    f.sample.mockRejectedValueOnce(new ActorError('PRIVATE', 'incompatible_workers'));
    const error = await verifyBillingQueue().catch((e: unknown) => e);
    expect(probeFailureReason(error)).toBe('incompatible_workers');
    expect(probeFailureReason(new Error('PRIVATE'))).toBe('unclassified');
  });
  it('classifies an immediately rejected broker read without exposing its message', async () => {
    const error = Object.assign(new Error('PRIVATE provider response'), { name: 'ReplyError' });
    f.read.mockRejectedValueOnce(error);
    const refusal = await verifyBillingQueue().catch((e: unknown) => e);
    expect(probeFailureReason(refusal)).toBe('redis_reply_error');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  describe('deadline reasons', () => {
    async function deadlineReason(status: string, errors: unknown[] = []) {
      vi.useFakeTimers();
      f.connection.status = status;
      f.read.mockImplementationOnce(() => new Promise(() => {}));
      const pending = verifyBillingQueue().catch((e: unknown) => e);
      const listeners = f.connection.on.mock.calls.filter((call: unknown[]) => call[0] === 'error');
      const onError = listeners[listeners.length - 1]?.[1] as (error: unknown) => void;
      for (const error of errors) onError(error);
      await vi.advanceTimersByTimeAsync(PROBE_DEADLINE_MS);
      return probeFailureReason(await pending);
    }
    it('separates a stalled broker read from a connection not ready at the deadline', async () => {
      expect(await deadlineReason('ready')).toBe('broker_read_stalled');
      expect(await deadlineReason('connecting')).toBe('redis_not_ready');
    });
    it('classifies connection errors by fixed name and code only', async () => {
      const coded = (code: string) => Object.assign(new Error('PRIVATE'), { code });
      expect(await deadlineReason('reconnecting', [coded('ECONNREFUSED')])).toBe(
        'redis_network_error',
      );
      expect(await deadlineReason('reconnecting', [coded('ENOTFOUND')])).toBe(
        'redis_network_error',
      );
      expect(await deadlineReason('reconnecting', [coded('ERR_TLS_CERT_ALTNAME_INVALID')])).toBe(
        'redis_tls_error',
      );
      const reply = Object.assign(new Error('WRONGPASS PRIVATE'), { name: 'ReplyError' });
      expect(await deadlineReason('reconnecting', [reply])).toBe('redis_reply_error');
      expect(await deadlineReason('reconnecting', [coded('ECONNRESET'), coded('PRIVATE')])).toBe(
        'redis_network_error',
      );
    });
  });
  it('keeps every exit code distinct, nonzero and inside the task range', () => {
    const codes = Object.values(PROBE_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code > 0 && code < 126).toBe(true);
  });
});
