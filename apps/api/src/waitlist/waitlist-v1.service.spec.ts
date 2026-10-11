import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDb } from '../db/db.module.js';
import { classifyProvider } from './provider-classifier.js';
import { WaitlistService } from './waitlist.service.js';

vi.mock('./provider-classifier.js', () => ({
  classifyProvider: vi.fn(async () => 'unknown'),
}));

function makeDb(options: { existing?: { id: string }; insertError?: unknown; filled?: boolean }) {
  const limit = vi.fn().mockResolvedValue(options.existing ? [options.existing] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const values = options.insertError
    ? vi.fn().mockRejectedValue(options.insertError)
    : vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });

  const returning = vi.fn().mockResolvedValue(options.filled ? [{ id: 'filled' }] : []);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  return {
    db: { select, insert, update } as unknown as DrizzleDb,
    values,
  };
}

describe('WaitlistService.joinLaunch', () => {
  afterEach(() => {
    vi.mocked(classifyProvider).mockClear();
  });

  it('does not classify a Pro signup', async () => {
    const { db, values } = makeDb({});
    const service = new WaitlistService(db);

    const status = await service.joinLaunch(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      undefined,
    );

    expect(status).toEqual({ status: 'joined', providerClass: null });
    expect(classifyProvider).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'person@example.com',
        tier: 'pro',
        provider: null,
        source: 'pricing',
      }),
    );
  });

  it('classifies a provider signup only when the caller did not pick one', async () => {
    const { db, values } = makeDb({});
    const service = new WaitlistService(db);

    await service.joinLaunch(
      { kind: 'provider', email: 'person@example.com', source: 'home' },
      undefined,
    );

    expect(classifyProvider).toHaveBeenCalledWith('person@example.com');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ tier: null, provider: 'unknown' }),
    );
  });

  it('stores the picked provider and still classifies for the event', async () => {
    const { db, values } = makeDb({});
    const service = new WaitlistService(db);

    await service.joinLaunch(
      {
        kind: 'provider',
        email: 'person@example.com',
        provider: 'outlook',
        source: 'home',
      },
      undefined,
    );

    expect(classifyProvider).toHaveBeenCalledWith('person@example.com');
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ provider: 'outlook' }));
  });

  it('returns already_joined for the same address, tier, and provider', async () => {
    const { db, values } = makeDb({ existing: { id: 'row' } });
    const service = new WaitlistService(db);

    const status = await service.joinLaunch(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      undefined,
    );

    expect(status).toEqual({ status: 'already_joined', providerClass: null });
    expect(values).not.toHaveBeenCalled();
  });

  it('never logs the email address', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { db } = makeDb({});
    const service = new WaitlistService(db);

    await service.joinLaunch(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      undefined,
    );

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.join('\n')).not.toContain('person@example.com');
    expect(lines.join('\n')).not.toContain('@');
    log.mockRestore();
  });
});
