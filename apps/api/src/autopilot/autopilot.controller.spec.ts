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

describe('AutopilotController PATCH mode gate', () => {
  // The class guard grants the surface at `autopilot`. Promoting a rule
  // to `active` additionally requires `autopilot-active`, enforced in
  // the handler because the class level cannot express a per-FIELD
  // requirement — an under-entitled caller 402s BEFORE any write.
  //
  // 2026-08-23: both capabilities sit on Plus, so no tier reaching this
  // handler can be rejected. `free` is used below purely to exercise
  // the branch; a free workspace is stopped by the class guard long
  // before it gets here. The check and this test both survive so that
  // moving `autopilot-active` back up the ladder stays a one-line
  // manifest edit rather than re-adding enforcement.
  it('rejects mode=active for an under-entitled workspace, before any write', async () => {
    const { controller, patchRule } = makeController('free');

    await expect(
      controller.patchRule(mailbox, principal, RULE_ID, { mode: 'active' }),
    ).rejects.toMatchObject({ code: 'PRO_FEATURE_REQUIRED', status: 402 });
    expect(patchRule).not.toHaveBeenCalled();
  });

  it('allows mode=active for an entitled workspace', async () => {
    const { controller, patchRule } = makeController('pro');

    await expect(
      controller.patchRule(mailbox, principal, RULE_ID, { mode: 'active' }),
    ).resolves.toMatchObject({ data: { id: RULE_ID } });
    expect(patchRule).toHaveBeenCalledWith(mailbox.id, RULE_ID, { mode: 'active' });
  });

  it('allows mode=observe without an entitlement lookup', async () => {
    const { controller, patchRule, tierForWorkspace } = makeController('plus');

    await controller.patchRule(mailbox, principal, RULE_ID, { mode: 'observe' });
    expect(tierForWorkspace).not.toHaveBeenCalled();
    expect(patchRule).toHaveBeenCalledWith(mailbox.id, RULE_ID, { mode: 'observe' });
  });
});
