import { describe, expect, it, vi } from 'vitest';

import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { OnboardingController } from './onboarding.controller.js';
import type { OnboardingService } from './onboarding.service.js';

const principal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
} as SessionPrincipal;
const mailbox = { id: 'mailbox-1' };

function makeController(tier: 'free' | 'plus' | 'pro') {
  const submitPresetPicks = vi.fn().mockResolvedValue({
    goal: 'reduce_newsletters',
    presetKeys: [],
    rulesReconciled: 0,
    rulesSeeded: false,
  });
  const tierForWorkspace = vi.fn().mockResolvedValue(tier);
  return {
    controller: new OnboardingController(
      { submitPresetPicks } as unknown as OnboardingService,
      { tierForWorkspace } as unknown as EntitlementsService,
    ),
    submitPresetPicks,
    tierForWorkspace,
  };
}

describe('OnboardingController preset capability gate', () => {
  // D251 — Plus now has `autopilot`, so seeding preset rules during
  // onboarding is allowed there. The rules land in Observe mode; promoting
  // one to `active` is the Pro step and is gated on the PATCH route.
  it.each(['free'] as const)('rejects non-empty Autopilot picks for %s', async (tier) => {
    const { controller, submitPresetPicks } = makeController(tier);

    await expect(
      controller.submitPresetPicks(principal, mailbox, {
        goal: 'reduce_newsletters',
        presetKeys: ['auto_archive_low_engagement'],
      }),
    ).rejects.toMatchObject({ code: 'PRO_FEATURE_REQUIRED', status: 402 });
    expect(submitPresetPicks).not.toHaveBeenCalled();
  });

  it('allows non-empty picks on plus — D251 grants rule matching at Plus', async () => {
    const { controller, submitPresetPicks } = makeController('plus');

    await expect(
      controller.submitPresetPicks(principal, mailbox, {
        goal: 'reduce_newsletters',
        presetKeys: ['auto_archive_low_engagement'],
      }),
    ).resolves.toBeDefined();
    expect(submitPresetPicks).toHaveBeenCalled();
  });

  it('allows an empty selection on every tier without an entitlement lookup', async () => {
    const { controller, submitPresetPicks, tierForWorkspace } = makeController('free');
    await controller.submitPresetPicks(principal, mailbox, {
      goal: 'protect_important',
      presetKeys: [],
    });
    expect(tierForWorkspace).not.toHaveBeenCalled();
    expect(submitPresetPicks).toHaveBeenCalled();
  });

  it('allows Pro to select Autopilot presets', async () => {
    const { controller, submitPresetPicks } = makeController('pro');
    await controller.submitPresetPicks(principal, mailbox, {
      goal: 'reduce_newsletters',
      presetKeys: ['auto_archive_low_engagement'],
    });
    expect(submitPresetPicks).toHaveBeenCalled();
  });
});

describe('OnboardingController verb tour (D38)', () => {
  it('marks the tour seen for the calling user and returns the fresh state', async () => {
    const markVerbTourCompleted = vi.fn().mockResolvedValue({
      onboardedAt: null,
      skipped: false,
      goal: null,
      presetPicks: null,
      presets: [],
      verbTourCompletedAt: '2026-08-10T10:00:00.000Z',
    });
    const controller = new OnboardingController(
      { markVerbTourCompleted } as unknown as OnboardingService,
      {} as unknown as EntitlementsService,
    );

    const result = await controller.markVerbTourSeen(principal);

    expect(markVerbTourCompleted).toHaveBeenCalledWith('user-1');
    expect(result.data.verbTourCompletedAt).toBe('2026-08-10T10:00:00.000Z');
  });
});
