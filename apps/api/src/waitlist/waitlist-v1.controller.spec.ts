import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { WaitlistV1Controller } from './waitlist-v1.controller.js';
import type { WaitlistService } from './waitlist.service.js';

function makeController(joinLaunch = vi.fn().mockResolvedValue('joined')) {
  const controller = new WaitlistV1Controller({ joinLaunch } as unknown as WaitlistService);
  return { controller, joinLaunch };
}

const anonymous = { user: undefined } as unknown as Request;

describe('WaitlistV1Controller', () => {
  it('returns joined inside the envelope', async () => {
    const { controller, joinLaunch } = makeController();

    const result = await controller.join(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      anonymous,
    );

    expect(joinLaunch).toHaveBeenCalledWith(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      undefined,
    );
    expect(result).toEqual({ data: { status: 'joined' } });
  });

  it('returns already_joined without changing the envelope shape', async () => {
    const { controller } = makeController(vi.fn().mockResolvedValue('already_joined'));

    const result = await controller.join(
      { kind: 'pro', email: 'person@example.com', source: 'pricing' },
      anonymous,
    );

    expect(result).toEqual({ data: { status: 'already_joined' } });
  });

  it('passes the session user id when the caller is authenticated', async () => {
    const { controller, joinLaunch } = makeController();
    const authed = { user: { userId: 'user-1' } } as unknown as Request;

    await controller.join({ kind: 'pro', source: 'pricing' }, authed);

    expect(joinLaunch).toHaveBeenCalledWith({ kind: 'pro', source: 'pricing' }, 'user-1');
  });

  it('rejects a missing source with 400 and does not write', async () => {
    const { controller, joinLaunch } = makeController();

    await expect(
      controller.join({ kind: 'pro', email: 'person@example.com' }, anonymous),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(joinLaunch).not.toHaveBeenCalled();
  });
});
