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
const f = vi.hoisted(() => ({
  connection: { on: vi.fn(), disconnect: vi.fn(), status: 'ready' },
  queue: { on: vi.fn(), close: vi.fn(async () => undefined) },
  construct: vi.fn(),
  connect: vi.fn(),
  readPrefs: vi.fn(async () => ({ workers: 1 })),
  read: vi.fn(async () => ({ workers: 1 })),
}));
vi.mock('@declutrmail/workers', () => ({
  createRedisConnection: f.connect,
  EMAIL_SEND_QUEUE: 'email-send',
  QueueActorCompatibilityError: ActorError,
  readBillingQueueCompatibility: f.read,
  readEmailPrefsQueueCompatibility: f.readPrefs,
}));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (name, options) {
    f.construct(name, options);
    return f.queue;
  }),
}));
import {
  PROBE_EXIT_CODES,
  probeFailureReason,
  verifyBillingQueue,
} from '../verify-billing-queue.js';

describe('standalone billing queue probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.construct.mockImplementation(() => undefined);
    f.connection.status = 'ready';
    f.connect.mockReturnValue(f.connection);
    f.read.mockResolvedValue({ workers: 1 });
    f.readPrefs.mockResolvedValue({ workers: 1 });
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
  it('reads only generic actor compatibility, disables metadata writes and closes handles', async () => {
    await expect(verifyBillingQueue()).resolves.toEqual({ workers: 1 });
    expect(f.construct).toHaveBeenCalledWith('email-send', {
      connection: f.connection,
      skipMetasUpdate: true,
    });
    expect(f.read).toHaveBeenCalledWith(f.queue);
    expect(f.readPrefs).toHaveBeenCalledWith(f.queue);
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('refuses unknown actor evidence and still closes both handles', async () => {
    f.read.mockRejectedValueOnce(new Error('unknown actor'));
    await expect(verifyBillingQueue()).rejects.toThrow('unknown actor');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('requires preference compatibility even while billing notices are off', async () => {
    vi.stubEnv('BILLING_APP_NOTICES_ENABLED', 'false');
    f.readPrefs.mockRejectedValueOnce(new Error('old preference actor'));
    await expect(verifyBillingQueue()).rejects.toThrow('old preference actor');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
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
    await vi.advanceTimersByTimeAsync(25_000);
    await result;
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('names configuration refusal without connecting', async () => {
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', '');
    const error = await verifyBillingQueue().catch((e: unknown) => e);
    expect(probeFailureReason(error)).toBe('configuration_unavailable');
  });
  it('passes broker actor refusals through as their fixed reason', async () => {
    f.readPrefs.mockRejectedValueOnce(new ActorError('PRIVATE', 'incompatible_workers'));
    const error = await verifyBillingQueue().catch((e: unknown) => e);
    expect(probeFailureReason(error)).toBe('incompatible_workers');
    expect(probeFailureReason(new Error('PRIVATE'))).toBe('unclassified');
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
      await vi.advanceTimersByTimeAsync(25_000);
      return probeFailureReason(await pending);
    }
    it('separates a stalled broker read from a connection that never became ready', async () => {
      expect(await deadlineReason('ready')).toBe('broker_read_stalled');
      expect(await deadlineReason('connecting')).toBe('redis_never_ready');
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
