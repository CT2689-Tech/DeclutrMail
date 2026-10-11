import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  connection: {
    on: vi.fn(),
    disconnect: vi.fn(),
    ping: vi.fn(async () => 'PONG'),
    status: 'ready',
  },
  connect: vi.fn(),
  read: vi.fn(async () => {
    throw Object.assign(new Error('Email runtime compatibility unverified'), {
      reason: 'runtime_adoption_unverified',
    });
  }),
  sample: vi.fn(),
}));
vi.mock('@declutrmail/workers', () => ({
  createRedisConnection: f.connect,
  readEmailRuntimeLeases: f.read,
  sampleEmailQueueCompatibility: f.sample,
}));
vi.mock('bullmq', () => ({
  Queue: vi.fn(function Queue() {
    throw new Error('CLIENT LIST queue must not be constructed');
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
    f.connection.ping.mockResolvedValue('PONG');
    f.connect.mockReturnValue(f.connection);
    f.read.mockRejectedValue(
      Object.assign(new Error('Email runtime compatibility unverified'), {
        reason: 'runtime_adoption_unverified',
      }),
    );
    vi.stubEnv('BILLING_NOTICE_PROBE', 'true');
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', 'redis://127.0.0.1:1');
    vi.stubEnv('EMAIL_RUNTIME_ADOPTION_WITNESS', '');
    vi.stubEnv('CLIENT_LIST_COMPATIBLE', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires explicit probe enrollment and bound runtime configuration', async () => {
    vi.stubEnv('BILLING_NOTICE_PROBE', 'false');
    await expect(verifyBillingQueue()).rejects.toThrow('configuration unavailable');
    vi.stubEnv('BILLING_NOTICE_PROBE', 'true');
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', '');
    await expect(verifyBillingQueue()).rejects.toThrow('configuration unavailable');
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('does not consult CLIENT LIST and fails closed without a sealed witness', async () => {
    const error = await verifyBillingQueue().catch((caught: unknown) => caught);
    expect(probeFailureReason(error)).toBe('adoption_unverified');
    expect(f.sample).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledWith(f.connection, undefined);
    expect(f.connection.ping).toHaveBeenCalledOnce();
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
    const source = readFileSync(resolve(import.meta.dirname, '../verify-billing-queue.ts'), 'utf8');
    expect(source).not.toContain('sampleEmailQueueCompatibility');
    expect(source).not.toContain('getWorkers');
    expect(source).not.toContain('CLIENT LIST');
  });

  it('rejects an environment-supplied witness or client-list success before connecting', async () => {
    vi.stubEnv('EMAIL_RUNTIME_ADOPTION_WITNESS', '{"inventoryComplete":true}');
    await expect(verifyBillingQueue()).rejects.toMatchObject({ reason: 'adoption_unverified' });
    vi.stubEnv('EMAIL_RUNTIME_ADOPTION_WITNESS', '');
    vi.stubEnv('CLIENT_LIST_COMPATIBLE', 'true');
    await expect(verifyBillingQueue()).rejects.toMatchObject({ reason: 'adoption_unverified' });
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('names configuration refusal without connecting', async () => {
    vi.stubEnv('BILLING_NOTICE_REDIS_URL', '');
    const error = await verifyBillingQueue().catch((caught: unknown) => caught);
    expect(probeFailureReason(error)).toBe('configuration_unavailable');
  });

  it('classifies broker and lease refusals without reading their messages', () => {
    expect(probeFailureReason(new Error('PRIVATE'))).toBe('unclassified');
    expect(
      probeFailureReason(
        Object.assign(new Error('PRIVATE provider response'), { name: 'ReplyError' }),
      ),
    ).toBe('redis_reply_error');
    expect(probeFailureReason(Object.assign(new Error('PRIVATE'), { code: 'ECONNRESET' }))).toBe(
      'redis_network_error',
    );
    expect(
      probeFailureReason(
        Object.assign(new Error('PRIVATE'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
      ),
    ).toBe('redis_tls_error');
    expect(probeFailureReason(Object.assign(new Error('PRIVATE'), { reason: 'no_workers' }))).toBe(
      'no_workers',
    );
    expect(
      probeFailureReason(Object.assign(new Error('PRIVATE'), { reason: 'incompatible_workers' })),
    ).toBe('incompatible_workers');
    expect(
      probeFailureReason(
        Object.assign(new Error('PRIVATE'), { reason: 'runtime_settlement_unverified' }),
      ),
    ).toBe('settlement_unverified');
  });

  it('classifies a refused ping and still disconnects', async () => {
    f.connection.ping.mockRejectedValueOnce(
      Object.assign(new Error('WRONGPASS PRIVATE'), { name: 'ReplyError' }),
    );
    const error = await verifyBillingQueue().catch((caught: unknown) => caught);
    expect(probeFailureReason(error)).toBe('redis_reply_error');
    expect(f.read).not.toHaveBeenCalled();
    expect(f.connection.disconnect).toHaveBeenCalledOnce();
  });

  it('keeps every exit code distinct, nonzero and inside the task range', () => {
    const codes = Object.values(PROBE_EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code > 0 && code < 126).toBe(true);
    expect(PROBE_EXIT_CODES.adoption_unverified).toBe(110);
  });
});
