import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SyncStatusSchema, type SyncStatus } from '@declutrmail/shared/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SyncController } from './sync.controller.js';
import type { SyncService } from './sync.service.js';

/** Stand-in for the `@CurrentMailbox()`-resolved value the guard injects. */
const MAILBOX = { id: 'mailbox-uuid-1' } as const;

/**
 * SyncController unit tests (D224).
 *
 * Plain-class instantiation, no @nestjs/testing — matches the style of
 * `token-crypto.service.spec.ts`. The controller's only job is to read
 * from `SyncService.getStatus`, validate the projection against
 * `SyncStatusSchema`, and map empty/invalid cases to HTTP errors.
 */

function makeController(getStatus: SyncService['getStatus']): SyncController {
  const service = { getStatus } as unknown as SyncService;
  return new SyncController(service);
}

const VALID_STATUS: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'fetching_metadata',
  progress_pct: 42,
  is_ready_for_triage: false,
};

describe('SyncController.getStatus', () => {
  it('returns the SyncService projection wrapped in the D202 envelope', async () => {
    const getStatus = vi.fn().mockResolvedValue(VALID_STATUS);
    const controller = makeController(getStatus);

    const result = await controller.getStatus(MAILBOX);

    expect(result).toEqual({ data: VALID_STATUS });
    // The inner `data` must round-trip through the schema — this is
    // the contract guarantee the controller makes to the client.
    expect(SyncStatusSchema.safeParse(result.data).success).toBe(true);
    expect(getStatus).toHaveBeenCalledWith('mailbox-uuid-1');
  });

  // Mailbox identity is resolved by `CurrentMailboxGuard` (D155 + D205)
  // before the controller runs — there is no longer a missing-param
  // branch to test here; the guard's resolution is covered in
  // `current-mailbox.guard.spec.ts`.

  it('throws NotFoundException when the mailbox has no sync state row', async () => {
    const getStatus = vi.fn().mockResolvedValue(null);
    const controller = makeController(getStatus);

    await expect(controller.getStatus(MAILBOX)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws InternalServerErrorException when the projection fails schema validation', async () => {
    // Simulates a worker bug that wrote progress_pct = 150 to the DB.
    // The boundary check prevents the malformed value from reaching
    // the UI.
    const getStatus = vi.fn().mockResolvedValue({
      ...VALID_STATUS,
      progress_pct: 150,
    });
    const controller = makeController(getStatus);

    await expect(controller.getStatus(MAILBOX)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('passes through the error_code when present (failed readiness)', async () => {
    const failed: SyncStatus = {
      readiness_status: 'failed',
      current_stage: 'failed',
      progress_pct: 17,
      is_ready_for_triage: false,
      error_code: 'GMAIL_QUOTA_EXCEEDED',
    };
    const getStatus = vi.fn().mockResolvedValue(failed);
    const controller = makeController(getStatus);

    const result = await controller.getStatus(MAILBOX);
    expect(result).toEqual({ data: failed });
  });
});
