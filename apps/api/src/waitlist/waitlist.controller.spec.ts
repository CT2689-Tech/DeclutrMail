import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { WaitlistController } from './waitlist.controller.js';
import type { WaitlistService } from './waitlist.service.js';

/**
 * WaitlistController tests (D19).
 *
 * The load-bearing invariant: the success body is ONE constant shape —
 * a duplicate submit is indistinguishable from a fresh insert at the
 * HTTP layer (no email-exists oracle). Validation failures 400 with
 * the shared D202 error shape.
 */

function makeController(join = vi.fn().mockResolvedValue(undefined)) {
  const controller = new WaitlistController({ join } as unknown as WaitlistService);
  return { controller, join };
}

describe('WaitlistController (D19)', () => {
  it('accepts a valid payload and returns the constant envelope', async () => {
    const { controller, join } = makeController();

    const result = await controller.join({
      email: 'visitor@example.com',
      tierInterest: 'team',
      source: 'pricing',
    });

    expect(join).toHaveBeenCalledWith({
      email: 'visitor@example.com',
      tierInterest: 'team',
      source: 'pricing',
    });
    expect(result).toEqual({ data: { status: 'accepted' } });
  });

  it('returns the IDENTICAL body when the service deduped (no email-exists oracle)', async () => {
    // The service resolves void for both fresh and duplicate inserts —
    // assert the controller cannot tell the difference.
    const { controller } = makeController(vi.fn().mockResolvedValue(undefined));

    const fresh = await controller.join({ email: 'a@example.com', source: 'pricing' });
    const duplicate = await controller.join({ email: 'a@example.com', source: 'pricing' });

    expect(duplicate).toEqual(fresh);
  });

  it('rejects a malformed email with 400', async () => {
    const { controller, join } = makeController();

    await expect(controller.join({ email: 'not-an-email', source: 'pricing' })).rejects.toThrow(
      BadRequestException,
    );
    expect(join).not.toHaveBeenCalled();
  });

  it('rejects a missing source with 400', async () => {
    const { controller, join } = makeController();

    await expect(controller.join({ email: 'visitor@example.com' })).rejects.toThrow(
      BadRequestException,
    );
    expect(join).not.toHaveBeenCalled();
  });

  it('rejects unknown tiers and extra keys (strict contract)', async () => {
    const { controller, join } = makeController();

    await expect(
      controller.join({ email: 'visitor@example.com', tierInterest: 'mega', source: 'pricing' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.join({ email: 'visitor@example.com', source: 'pricing', admin: true }),
    ).rejects.toThrow(BadRequestException);
    expect(join).not.toHaveBeenCalled();
  });

  it('propagates service failures (a real 5xx, never a fake 202)', async () => {
    const { controller } = makeController(vi.fn().mockRejectedValue(new Error('db down')));

    await expect(
      controller.join({ email: 'visitor@example.com', source: 'pricing' }),
    ).rejects.toThrow('db down');
  });
});
