import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  connection: { on: vi.fn(), disconnect: vi.fn() },
  queue: { on: vi.fn(), close: vi.fn(async () => undefined) },
  construct: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(async () => ({ workers: 1 })),
}));
vi.mock('@declutrmail/workers', () => ({
  createRedisConnection: f.connect,
  EMAIL_SEND_QUEUE: 'email-send',
  readBillingQueueCompatibility: f.read,
}));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function (name, options) {
    f.construct(name, options);
    return f.queue;
  }),
}));
import { verifyBillingQueue } from '../verify-billing-queue.js';

describe('standalone billing queue probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.construct.mockImplementation(() => undefined);
    f.connect.mockReturnValue(f.connection);
    f.read.mockResolvedValue({ workers: 1 });
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
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
  it('refuses unknown actor evidence and still closes both handles', async () => {
    f.read.mockRejectedValueOnce(new Error('unknown actor'));
    await expect(verifyBillingQueue()).rejects.toThrow('unknown actor');
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
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
});
