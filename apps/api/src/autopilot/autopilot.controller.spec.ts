import { describe, expect, it, vi } from 'vitest';

import type { SessionPrincipal } from '../auth/sessions.service.js';
import type { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { AutopilotController } from './autopilot.controller.js';
import type { AutopilotReadService } from './autopilot.read-service.js';

const principal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
} as SessionPrincipal;
const mailbox = { id: 'mailbox-1' };
const RULE_ID = '7f0e6f9a-8f5f-4f5b-9a67-2f4a5b6c7d8e';

function makeController(tier: 'free' | 'plus' | 'pro') {
  const patchRule = vi.fn().mockResolvedValue({ id: RULE_ID, mode: 'active' });
  const tierForWorkspace = vi.fn().mockResolvedValue(tier);
  return {
    controller: new AutopilotController(
      { patchRule } as unknown as AutopilotReadService,
      { tierForWorkspace } as unknown as EntitlementsService,
    ),
    patchRule,
    tierForWorkspace,
  };
}

describe('AutopilotController PATCH mode gate (D251)', () => {
  // The class guard grants the surface at `autopilot` (Plus). Promoting
  // a rule to `active` is the delegated-approval VALUE and requires
  // `autopilot-active` (Pro) — enforced in the handler so a Plus caller
  // 402s BEFORE any write, instead of getting unattended automation
  // they are not paying for.
  it('rejects mode=active for a plus workspace with 402 before any write', async () => {
    const { controller, patchRule } = makeController('plus');

    await expect(
      controller.patchRule(mailbox, principal, RULE_ID, { mode: 'active' }),
    ).rejects.toMatchObject({ code: 'PRO_FEATURE_REQUIRED', status: 402 });
    expect(patchRule).not.toHaveBeenCalled();
  });

  it('allows mode=active for a pro workspace', async () => {
    const { controller, patchRule } = makeController('pro');

    await expect(
      controller.patchRule(mailbox, principal, RULE_ID, { mode: 'active' }),
    ).resolves.toMatchObject({ data: { id: RULE_ID } });
    expect(patchRule).toHaveBeenCalledWith(mailbox.id, RULE_ID, { mode: 'active' });
  });

  it('allows mode=observe on plus without an entitlement lookup', async () => {
    const { controller, patchRule, tierForWorkspace } = makeController('plus');

    await controller.patchRule(mailbox, principal, RULE_ID, { mode: 'observe' });
    expect(tierForWorkspace).not.toHaveBeenCalled();
    expect(patchRule).toHaveBeenCalledWith(mailbox.id, RULE_ID, { mode: 'observe' });
  });
});
