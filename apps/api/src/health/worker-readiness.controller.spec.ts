import { expect, it, vi } from 'vitest';
import { WorkerReadinessController } from './worker-readiness.controller.js';

it.each([true, false])('returns an opaque no-store response when fresh=%s', async (fresh) => {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ fresh }] }) }) }),
  };
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  await new WorkerReadinessController(db as never).readiness(res as never);
  expect(res.status).toHaveBeenCalledWith(fresh ? 200 : 503);
  expect(res.json).toHaveBeenCalledWith({ status: fresh ? 'ok' : 'degraded' });
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

it('bounds a hung database query and does not claim a live worker', async () => {
  vi.useFakeTimers();
  try {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => new Promise(() => {}) }) }) }),
    };
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const pending = new WorkerReadinessController(db as never).readiness(res as never);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(res.status).toHaveBeenCalledWith(503);
  } finally {
    vi.useRealTimers();
  }
});
