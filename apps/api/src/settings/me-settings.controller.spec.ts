import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MeSettingsController } from './me-settings.controller.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { UsersService } from '../users/users.service.js';

/**
 * MeSettingsController tests (U23 — D34) — combined-read shape + patch
 * merge semantics. Guard wiring (Jwt/Csrf/RateLimit) is class-level
 * metadata covered by the API boot smoke (same stance as
 * EmailPrefsController).
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
  const controller = new MeSettingsController(users as unknown as UsersService);
  return { controller, users };
}

describe('MeSettingsController — GET /api/me/settings', () => {
  it('returns defaults when the preference bag is empty', async () => {
    const { controller } = makeController({});
    const result = await controller.settings(USER);
    expect(result.data).toEqual({
      emailPrefs: { reminders: true },
      actionSheetPrefs: { archive: false, unsubscribe: false, later: false },
    });
  });

  it('returns stored prefs verbatim', async () => {
    const { controller } = makeController({
      emailPrefs: { reminders: false },
      actionSheetPrefs: { archive: true, unsubscribe: false, later: true },
    });
    const result = await controller.settings(USER);
    expect(result.data).toEqual({
      emailPrefs: { reminders: false },
      actionSheetPrefs: { archive: true, unsubscribe: false, later: true },
    });
  });

  it('degrades a malformed slice to its defaults without dropping the other', async () => {
    const { controller } = makeController({
      emailPrefs: { reminders: false },
      actionSheetPrefs: 'garbage',
    });
    const result = await controller.settings(USER);
    expect(result.data).toEqual({
      emailPrefs: { reminders: false },
      actionSheetPrefs: { archive: false, unsubscribe: false, later: false },
    });
  });
});

describe('MeSettingsController — PATCH /api/me/action-sheet-prefs', () => {
  it('sets one verb and persists the merged bag', async () => {
    const { controller, users } = makeController({});
    const result = await controller.patchActionSheetPrefs(USER, { unsubscribe: true });
    expect(result.data).toEqual({
      actionSheetPrefs: { archive: false, unsubscribe: true, later: false },
    });
    expect(users.patchPreferences).toHaveBeenCalledWith('u1', {
      actionSheetPrefs: { archive: false, unsubscribe: true, later: false },
    });
  });

  it('merges over an existing stored bag without clobbering other verbs', async () => {
    const { controller } = makeController({
      actionSheetPrefs: { archive: true, unsubscribe: false, later: false },
    });
    const result = await controller.patchActionSheetPrefs(USER, { later: true });
    expect(result.data).toEqual({
      actionSheetPrefs: { archive: true, unsubscribe: false, later: true },
    });
  });

  it('flips a verb back off (settings is the flip-OFF surface)', async () => {
    const { controller } = makeController({
      actionSheetPrefs: { archive: true, unsubscribe: true, later: false },
    });
    const result = await controller.patchActionSheetPrefs(USER, { archive: false });
    expect(result.data).toEqual({
      actionSheetPrefs: { archive: false, unsubscribe: true, later: false },
    });
  });

  it('400 on unknown keys (strict patch — Keep is never sheeted)', async () => {
    const { controller, users } = makeController();
    await expect(controller.patchActionSheetPrefs(USER, { keep: true })).rejects.toThrow(
      BadRequestException,
    );
    expect(users.patchPreferences).not.toHaveBeenCalled();
  });

  it('400 on an empty patch', async () => {
    const { controller } = makeController();
    await expect(controller.patchActionSheetPrefs(USER, {})).rejects.toThrow(BadRequestException);
  });
});
