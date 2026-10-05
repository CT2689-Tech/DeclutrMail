import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsersService } from '../users/users.service.js';
import { BriefController } from './brief.controller.js';
import type { BriefReadService } from './brief.read-service.js';

describe('BriefController.today', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the persisted user timezone even when the caller sends a different browser zone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T20:00:00Z'));
    const getForDate = vi.fn().mockResolvedValue({ id: 'brief' });
    const findById = vi.fn().mockResolvedValue({ timezone: 'Pacific/Auckland' });
    const controller = new BriefController(
      { getForDate } as unknown as BriefReadService,
      { findById } as unknown as UsersService,
    );

    await (controller.today as unknown as (...args: unknown[]) => Promise<unknown>)(
      { userId: 'user-1' },
      { id: 'mailbox-1' },
      'America/Los_Angeles',
    );

    expect(findById).toHaveBeenCalledWith('user-1');
    expect(getForDate).toHaveBeenCalledWith('mailbox-1', '2026-07-08', 'user-1');
  });

  it('falls back to the UTC date when no persisted timezone exists', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T20:00:00Z'));
    const getForDate = vi.fn().mockResolvedValue({ id: 'brief' });
    const controller = new BriefController(
      { getForDate } as unknown as BriefReadService,
      { findById: vi.fn().mockResolvedValue({ timezone: null }) } as unknown as UsersService,
    );

    await controller.today({ userId: 'user-1' }, { id: 'mailbox-1' });

    expect(getForDate).toHaveBeenCalledWith('mailbox-1', '2026-07-07', 'user-1');
  });
});

describe('BriefController.recent', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['America/Los_Angeles', '2026-09-05', '2026-10-04'],
    [null, '2026-09-06', '2026-10-05'],
    ['invalid-zone', '2026-09-06', '2026-10-05'],
  ])(
    'uses the persisted timezone %s and scopes history to the guarded mailbox',
    async (timezone, from, to) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-05T06:00:00Z'));
      const listByRange = vi.fn().mockResolvedValue([{ id: 'saved-edition' }]);
      const controller = new BriefController(
        { listByRange } as unknown as BriefReadService,
        { findById: vi.fn().mockResolvedValue({ timezone }) } as unknown as UsersService,
      );
      expect(await controller.recent({ userId: 'user-1' }, { id: 'mailbox-1' })).toEqual({
        data: [{ id: 'saved-edition' }],
      });
      expect(listByRange).toHaveBeenCalledWith('mailbox-1', from, to, 'user-1');
    },
  );
});
