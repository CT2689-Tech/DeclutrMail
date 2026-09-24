import { describe, expect, it } from 'vitest';
import { workerRuntimeConfig } from './worker-runtime-config.js';
describe('worker resource budgets', () => {
  it('keeps independent bounded pools and a sweep-only SQL deadline', () => {
    expect(workerRuntimeConfig({})).toEqual({
      dbPoolMax: 10,
      lockPoolMax: 10,
      sweepStatementTimeoutMs: 25000,
    });
    expect(
      workerRuntimeConfig({ WORKER_DB_POOL_MAX: '6', WORKER_LOCK_POOL_MAX: '3' }),
    ).toMatchObject({ dbPoolMax: 6, lockPoolMax: 3 });
  });
  it.each(['0', '-1', '1.5', 'abc', '101'])('rejects invalid pool budget %s', (value) => {
    expect(() => workerRuntimeConfig({ WORKER_DB_POOL_MAX: value })).toThrow();
  });
  it('rejects a statement timeout beyond the job budget', () => {
    expect(() => workerRuntimeConfig({ WORKER_SWEEP_STATEMENT_TIMEOUT_MS: '60000' })).toThrow();
  });
});
