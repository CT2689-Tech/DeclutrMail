import { describe, expect, it, vi } from 'vitest';

import { SecurityEventsService } from './security-events.service.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * SecurityEventsService tests (D181).
 *
 * Verifies the audit writer normalizes optional fields to null and —
 * critically — never propagates a persistence failure into the caller
 * (a failed insert must not break the request that triggered it).
 */
function makeDb(insert: () => { values: (v: unknown) => Promise<unknown> }): DrizzleDb {
  return { insert } as unknown as DrizzleDb;
}

describe('SecurityEventsService (D181)', () => {
  it('inserts the event, defaulting unset optional fields to null', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const service = new SecurityEventsService(makeDb(() => ({ values })));

    await service.record({ eventType: 'rate_limit.breach', severity: 'warning' });

    expect(values).toHaveBeenCalledWith({
      eventType: 'rate_limit.breach',
      severity: 'warning',
      workspaceId: null,
      userId: null,
      sourceIp: null,
      userAgent: null,
      payload: null,
    });
  });

  it('passes through all provided fields', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const service = new SecurityEventsService(makeDb(() => ({ values })));

    await service.record({
      eventType: 'login.failure',
      severity: 'critical',
      userId: 'u1',
      workspaceId: 'w1',
      sourceIp: '203.0.113.7',
      userAgent: 'curl/8',
      payload: { reason: 'bad_state' },
    });

    expect(values).toHaveBeenCalledWith({
      eventType: 'login.failure',
      severity: 'critical',
      userId: 'u1',
      workspaceId: 'w1',
      sourceIp: '203.0.113.7',
      userAgent: 'curl/8',
      payload: { reason: 'bad_state' },
    });
  });

  it('swallows insert failures so the triggering request is unaffected', async () => {
    const service = new SecurityEventsService(
      makeDb(() => ({
        values: () => Promise.reject(new Error('db down')),
      })),
    );

    await expect(
      service.record({ eventType: 'rate_limit.breach', severity: 'warning' }),
    ).resolves.toBeUndefined();
  });
});
