import { describe, expect, it, vi } from 'vitest';

import { WaitlistService } from './waitlist.service.js';
import type { DrizzleDb } from '../db/db.module.js';

/**
 * WaitlistService tests (D19).
 *
 * The invariants: insert goes through `ON CONFLICT DO NOTHING` (a
 * duplicate email resolves, never throws), optional tierInterest
 * normalizes to null, and infra failures propagate (no fake 202).
 */

function makeDb(returning: ReturnType<typeof vi.fn>) {
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as unknown as DrizzleDb, insert, values, onConflictDoNothing };
}

describe('WaitlistService (D19)', () => {
  it('inserts email + tierInterest + source with conflict-do-nothing dedupe', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'w1' }]);
    const { db, values, onConflictDoNothing } = makeDb(returning);
    const service = new WaitlistService(db);

    await service.join({ email: 'visitor@example.com', tierInterest: 'team', source: 'pricing' });

    expect(values).toHaveBeenCalledWith({
      email: 'visitor@example.com',
      tierInterest: 'team',
      source: 'pricing',
    });
    // Dedupe is structural: the insert MUST ride on conflict-do-nothing.
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('normalizes an omitted tierInterest to null', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'w1' }]);
    const { db, values } = makeDb(returning);
    const service = new WaitlistService(db);

    await service.join({ email: 'visitor@example.com', source: 'landing' });

    expect(values).toHaveBeenCalledWith({
      email: 'visitor@example.com',
      tierInterest: null,
      source: 'landing',
    });
  });

  it('resolves (does not throw) when the row already exists — conflict returns no rows', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const { db } = makeDb(returning);
    const service = new WaitlistService(db);

    await expect(
      service.join({ email: 'dupe@example.com', source: 'pricing' }),
    ).resolves.toBeUndefined();
  });

  it('propagates infra failures so the controller can return a real 5xx', async () => {
    const returning = vi.fn().mockRejectedValue(new Error('db down'));
    const { db } = makeDb(returning);
    const service = new WaitlistService(db);

    await expect(service.join({ email: 'visitor@example.com', source: 'pricing' })).rejects.toThrow(
      'db down',
    );
  });
});
