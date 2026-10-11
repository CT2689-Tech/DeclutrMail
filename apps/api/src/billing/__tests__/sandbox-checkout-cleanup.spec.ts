import { describe, expect, it, vi } from 'vitest';
import { collectSandboxAttemptCleanup } from '../../../scripts/helpers/checkout-revocation-cleanup.js';

const attempt = {
  attempted: true,
  legacy: false,
  workspaceId: 'fixture',
  attemptId: 'attempt',
  priceId: 'price',
  createdAt: '2026-10-10T00:00:00Z',
};
const stopped = {
  transactionId: 'txn_fixture',
  status: 'canceled',
  subscriptionId: null,
  hold: 'stopped' as const,
};
describe('sandbox cleanup uncertainty', () => {
  it('cannot pass after a timed-out create absent from the provider scan', async () => {
    const adapter = {
      readSandboxCheckout: vi.fn(),
      recoverSandboxCheckout: vi.fn().mockRejectedValue(new Error('empty or unavailable')),
    };
    expect(await collectSandboxAttemptCleanup([attempt], adapter)).toEqual({
      complete: false,
      records: [],
    });
    expect(adapter.readSandboxCheckout).not.toHaveBeenCalled();
  });
  it('continues recovering known artifacts when another attempt is ambiguous', async () => {
    const adapter = {
      readSandboxCheckout: vi.fn().mockResolvedValue(stopped),
      recoverSandboxCheckout: vi.fn().mockRejectedValue(new Error('ambiguous')),
    };
    const result = await collectSandboxAttemptCleanup(
      [attempt, { ...attempt, attemptId: 'known', bound: stopped.transactionId }],
      adapter,
    );
    expect(result.complete).toBe(false);
    expect(result.records.map((r) => r.facts.transactionId)).toEqual([stopped.transactionId]);
  });
  it('requires a fresh exact read even for a locally recorded canceled artifact', async () => {
    const adapter = {
      readSandboxCheckout: vi.fn().mockRejectedValue(new Error('unavailable')),
      recoverSandboxCheckout: vi.fn(),
    };
    expect(
      (await collectSandboxAttemptCleanup([{ ...attempt, bound: stopped.transactionId }], adapter))
        .complete,
    ).toBe(false);
  });
  it('does not invent server creates for an unopened legacy payload', async () => {
    const adapter = { readSandboxCheckout: vi.fn(), recoverSandboxCheckout: vi.fn() };
    expect(
      await collectSandboxAttemptCleanup(
        [
          { ...attempt, legacy: true },
          { ...attempt, attempted: false },
        ],
        adapter,
      ),
    ).toEqual({ complete: true, records: [] });
    expect(adapter.recoverSandboxCheckout).not.toHaveBeenCalled();
  });
});
