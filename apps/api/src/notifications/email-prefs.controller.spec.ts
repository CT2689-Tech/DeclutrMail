import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { EmailPrefsController } from './email-prefs.controller.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { UsersService } from '../users/users.service.js';

/**
 * EmailPrefsController tests (D162, D165) — patch semantics + display
 * merge with defaults. The controller forwards ONLY the keys the patch
 * carries to `UsersService.mergeEmailPrefs` (the atomic in-database
 * merge); persistence semantics themselves are covered by the PGlite
 * users.service spec. Guard wiring (Jwt/Csrf/RateLimit) is class-level
 * metadata covered by the API boot smoke.
 */

const USER = {
  userId: 'u1',
  workspaceId: 'w1',
  email: 'a@b.com',
} as unknown as SessionPrincipal;

function makeController(postMergePreferences: Record<string, unknown>) {
  const users = {
    mergeEmailPrefs: vi.fn().mockResolvedValue(postMergePreferences),
  };
  const controller = new EmailPrefsController(users as unknown as UsersService);
  return { controller, users };
}

describe('EmailPrefsController', () => {
  it('forwards only the patched key and renders the merged view', async () => {
    const { controller, users } = makeController({ emailPrefs: { reminders: false } });
    const result = await controller.patch(USER, { reminders: false });
    // ONLY the carried key goes to the write — a materialised full bag
    // computed from a read would race the D165 one-click endpoint.
    expect(users.mergeEmailPrefs).toHaveBeenCalledWith('u1', { reminders: false });
    // Display view fills defaults for keys storage doesn't carry.
    expect(result.data).toEqual({ emailPrefs: { reminders: false, syncComplete: true } });
  });

  it('sets syncComplete=false without touching reminders', async () => {
    const { controller, users } = makeController({
      emailPrefs: { reminders: false, syncComplete: false },
    });
    const result = await controller.patch(USER, { syncComplete: false });
    expect(users.mergeEmailPrefs).toHaveBeenCalledWith('u1', { syncComplete: false });
    expect(result.data).toEqual({ emailPrefs: { reminders: false, syncComplete: false } });
  });

  it('forwards both keys when the patch carries both', async () => {
    const { controller, users } = makeController({
      emailPrefs: { reminders: true, syncComplete: false },
    });
    await controller.patch(USER, { reminders: true, syncComplete: false });
    expect(users.mergeEmailPrefs).toHaveBeenCalledWith('u1', {
      reminders: true,
      syncComplete: false,
    });
  });

  it('renders defaults when the post-merge bag is malformed', async () => {
    const { controller } = makeController({ emailPrefs: 'garbage' });
    const result = await controller.patch(USER, { reminders: false });
    expect(result.data).toEqual({ emailPrefs: { reminders: true, syncComplete: true } });
  });

  it('400 on unknown keys (strict patch)', async () => {
    const { controller, users } = makeController({});
    await expect(controller.patch(USER, { marketing: true })).rejects.toThrow(BadRequestException);
    expect(users.mergeEmailPrefs).not.toHaveBeenCalled();
  });

  it('400 on an empty patch', async () => {
    const { controller } = makeController({});
    await expect(controller.patch(USER, {})).rejects.toThrow(BadRequestException);
  });

  it('400 on non-boolean values', async () => {
    const { controller } = makeController({});
    await expect(controller.patch(USER, { reminders: 'yes' })).rejects.toThrow(BadRequestException);
  });
});
