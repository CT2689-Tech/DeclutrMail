import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SyncStatusSchema, type SyncStatus } from '@declutrmail/shared/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SyncController } from './sync.controller.js';
import type { SyncService } from './sync.service.js';

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
  it('returns the SyncService projection when it parses against SyncStatusSchema', async () => {
    const getStatus = vi.fn().mockResolvedValue(VALID_STATUS);
    const controller = makeController(getStatus);

    const result = await controller.getStatus('mailbox-uuid-1');

    expect(result).toEqual(VALID_STATUS);
    // The response must round-trip through the schema — this is the
    // contract guarantee the controller makes to the client.
    expect(SyncStatusSchema.safeParse(result).success).toBe(true);
    expect(getStatus).toHaveBeenCalledWith('mailbox-uuid-1');
  });

  it('throws BadRequestException when mailboxAccountId is missing', async () => {
    const getStatus = vi.fn();
    const controller = makeController(getStatus);

    await expect(controller.getStatus(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the mailbox has no sync state row', async () => {
    const getStatus = vi.fn().mockResolvedValue(null);
    const controller = makeController(getStatus);

    await expect(controller.getStatus('unknown-mailbox')).rejects.toBeInstanceOf(NotFoundException);
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

    await expect(controller.getStatus('mailbox-uuid-1')).rejects.toBeInstanceOf(
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

    const result = await controller.getStatus('mailbox-uuid-1');
    expect(result).toEqual(failed);
  });
});
