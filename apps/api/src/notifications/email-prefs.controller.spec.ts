import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { EmailPrefsController } from './email-prefs.controller.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { UsersService } from '../users/users.service.js';

/**
 * EmailPrefsController tests (D162, D165) — patch semantics + merge
 * with defaults. Guard wiring (Jwt/Csrf/RateLimit) is class-level
 * metadata covered by the API boot smoke.
 */

const USER = {
  userId: 'u1',
  workspaceId: 'w1',
  email: 'a@b.com',
} as unknown as SessionPrincipal;

function makeController(preferences: Record<string, unknown> = {}) {
  const users = {
    findById: vi.fn().mockResolvedValue({ id: 'u1', preferences }),
    patchPreferences: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new EmailPrefsController(users as unknown as UsersService);
  return { controller, users };
}

describe('EmailPrefsController', () => {
  it('sets reminders=false and persists the merged bag', async () => {
    const { controller, users } = makeController({});
    const result = await controller.patch(USER, { reminders: false });
    expect(result.data).toEqual({ emailPrefs: { reminders: false, syncComplete: true } });
    expect(users.patchPreferences).toHaveBeenCalledWith('u1', {
      emailPrefs: { reminders: false, syncComplete: true },
    });
  });

  it('sets syncComplete=false without touching reminders', async () => {
    const { controller, users } = makeController({ emailPrefs: { reminders: false } });
    const result = await controller.patch(USER, { syncComplete: false });
    expect(result.data).toEqual({ emailPrefs: { reminders: false, syncComplete: false } });
    expect(users.patchPreferences).toHaveBeenCalledWith('u1', {
      emailPrefs: { reminders: false, syncComplete: false },
    });
  });

  it('re-enables reminders over an existing opt-out', async () => {
    const { controller } = makeController({ emailPrefs: { reminders: false } });
    const result = await controller.patch(USER, { reminders: true });
    expect(result.data).toEqual({ emailPrefs: { reminders: true, syncComplete: true } });
  });

  it('falls back to defaults when the stored bag is malformed', async () => {
    const { controller } = makeController({ emailPrefs: 'garbage' });
    const result = await controller.patch(USER, { reminders: false });
    expect(result.data).toEqual({ emailPrefs: { reminders: false, syncComplete: true } });
  });

  it('400 on unknown keys (strict patch)', async () => {
    const { controller, users } = makeController();
    await expect(controller.patch(USER, { marketing: true })).rejects.toThrow(BadRequestException);
    expect(users.patchPreferences).not.toHaveBeenCalled();
  });

  it('400 on an empty patch', async () => {
    const { controller } = makeController();
    await expect(controller.patch(USER, {})).rejects.toThrow(BadRequestException);
  });

  it('400 on non-boolean values', async () => {
    const { controller } = makeController();
    await expect(controller.patch(USER, { reminders: 'yes' })).rejects.toThrow(BadRequestException);
  });
});
