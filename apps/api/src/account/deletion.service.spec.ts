import { describe, expect, it } from 'vitest';

import { AccountDeletionOrchestrator } from './deletion.service.js';
import type { UndoService } from '../undo/undo.service.js';

/**
 * AccountDeletionOrchestrator unit tests (D232).
 *
 * Pure computation — the orchestrator's only collaborator is
 * `UndoService.latestActiveExpiry`. Stubbing that lets us probe every
 * `max(flat-grace, undo-window)` branch without spinning up PGlite.
 */

function makeOrchestrator(latestActiveExpiry: Date | null): AccountDeletionOrchestrator {
  // Minimal stub — only the one method this service touches.
  const undoStub = {
    latestActiveExpiry: async (_mailboxId: string): Promise<Date | null> => latestActiveExpiry,
  } as unknown as UndoService;
  return new AccountDeletionOrchestrator(undoStub);
}

describe('AccountDeletionOrchestrator.computeSchedule', () => {
  const NOW = new Date('2026-05-23T00:00:00Z');
  const FLAT_GRACE = new Date('2026-05-30T00:00:00Z'); // now + 7d

  it('uses the flat 7-day grace when no active undo tokens', async () => {
    const orch = makeOrchestrator(null);
    const result = await orch.computeSchedule('mbx-1', NOW);
    expect(result.basis).toBe('flat-grace');
    expect(result.effectiveDeletionAt.getTime()).toBe(FLAT_GRACE.getTime());
    expect(result.latestUndoExpiresAt).toBeNull();
    expect(result.flatGraceAt.getTime()).toBe(FLAT_GRACE.getTime());
  });

  it('uses flat grace when the undo window is shorter', async () => {
    const undoExpiry = new Date('2026-05-25T00:00:00Z'); // now + 2d
    const orch = makeOrchestrator(undoExpiry);
    const result = await orch.computeSchedule('mbx-1', NOW);
    expect(result.basis).toBe('flat-grace');
    expect(result.effectiveDeletionAt.getTime()).toBe(FLAT_GRACE.getTime());
    expect(result.latestUndoExpiresAt!.getTime()).toBe(undoExpiry.getTime());
  });

  it('uses the undo window when it extends past flat grace (Pro 30-day)', async () => {
    const undoExpiry = new Date('2026-06-22T00:00:00Z'); // now + 30d (D81)
    const orch = makeOrchestrator(undoExpiry);
    const result = await orch.computeSchedule('mbx-1', NOW);
    expect(result.basis).toBe('undo-window');
    expect(result.effectiveDeletionAt.getTime()).toBe(undoExpiry.getTime());
    expect(result.latestUndoExpiresAt!.getTime()).toBe(undoExpiry.getTime());
  });

  it('exact tie ⇒ flat-grace (the contract baseline wins on equality)', async () => {
    const tie = new Date(FLAT_GRACE.getTime());
    const orch = makeOrchestrator(tie);
    const result = await orch.computeSchedule('mbx-1', NOW);
    expect(result.basis).toBe('flat-grace');
    expect(result.effectiveDeletionAt.getTime()).toBe(FLAT_GRACE.getTime());
  });

  it('1-millisecond extension flips basis to undo-window', async () => {
    const justAfter = new Date(FLAT_GRACE.getTime() + 1);
    const orch = makeOrchestrator(justAfter);
    const result = await orch.computeSchedule('mbx-1', NOW);
    expect(result.basis).toBe('undo-window');
    expect(result.effectiveDeletionAt.getTime()).toBe(justAfter.getTime());
  });

  it('preserves the mailbox id on the result', async () => {
    const orch = makeOrchestrator(null);
    const result = await orch.computeSchedule('mbx-42', NOW);
    expect(result.mailboxAccountId).toBe('mbx-42');
  });
});
