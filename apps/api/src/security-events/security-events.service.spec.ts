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

  it('logs oauth failures only after insert, with a closed reason and no identity', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const values = vi.fn().mockResolvedValue(undefined);
      const service = new SecurityEventsService(makeDb(() => ({ values })));
      await service.record({
        eventType: 'login.failure',
        severity: 'warning',
        userId: 'user-1',
        sourceIp: '203.0.113.7',
        userAgent: 'curl/8',
        payload: { reason: 'missing_state_cookie', email: 'person@example.test' },
      });
      const line = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
      expect(line).toEqual({
        level: 'warning',
        kind: 'security_event',
        eventType: 'login.failure',
        reason: 'missing_state_cookie',
      });
      expect(JSON.stringify(line)).not.toMatch(/person@example|203\.0\.113\.7|user-1|curl/);

      log.mockClear();
      await service.record({
        eventType: 'login.failure',
        severity: 'warning',
        payload: { reason: 'person@example.test' },
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0])).reason).toBe('other');

      for (const reason of ['connect_failed', 'MAILBOX_OWNED_BY_OTHER_WORKSPACE']) {
        log.mockClear();
        await service.record({
          eventType: 'login.failure',
          severity: 'warning',
          payload: { reason },
        });
        expect(JSON.parse(String(log.mock.calls[0]?.[0])).reason).toBe(reason);
      }

      log.mockClear();
      await service.record({ eventType: 'rate_limit.breach', severity: 'warning' });
      expect(log).not.toHaveBeenCalled();

      log.mockClear();
      await service.record({
        eventType: 'signup.denied',
        severity: 'warning',
        payload: { reason: 'beta_gate_denied', email: 'person@example.test' },
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('does not emit a security_event line when the insert fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const service = new SecurityEventsService(
        makeDb(() => ({
          values: () => Promise.reject(new Error('db down')),
        })),
      );
      await service.record({
        eventType: 'login.failure',
        severity: 'warning',
        payload: { reason: 'missing_state_cookie' },
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
