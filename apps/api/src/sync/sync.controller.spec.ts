import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SyncStatusSchema, type SyncStatus } from '@declutrmail/shared/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SyncController } from './sync.controller.js';
import type { ManualIncrementalSyncResult, SyncService } from './sync.service.js';

/** Stand-in for the `@CurrentMailbox()`-resolved value the guard injects. */
const MAILBOX = { id: 'mailbox-uuid-1' } as const;

/**
 * SyncController unit tests (D224, D38 prod-ready pass).
 *
 * Plain-class instantiation, no @nestjs/testing — matches the style of
 * `token-crypto.service.spec.ts`. The controller's only job is to read
 * from `SyncService.getStatus`, validate the projection against
 * `SyncStatusSchema`, and map empty/invalid cases to HTTP errors.
 *
 * The `postIncremental` route adds the on-demand sync-now surface,
 * mapping `not_ready` → 409 SYNC_NOT_READY (designed-state per
 * CLAUDE.md §8) and `enqueued`/`noop` → 202 with the outcome enum.
 */

function makeController(opts: {
  getStatus?: SyncService['getStatus'];
  enqueueManualIncrementalSync?: SyncService['enqueueManualIncrementalSync'];
}): SyncController {
  const service = {
    getStatus: opts.getStatus ?? (() => Promise.resolve(null)),
    enqueueManualIncrementalSync:
      opts.enqueueManualIncrementalSync ??
      ((): Promise<ManualIncrementalSyncResult> =>
        Promise.resolve({ kind: 'enqueued', cursorHistoryId: '1500' })),
  } as unknown as SyncService;
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
    const controller = makeController({ getStatus });

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
    const controller = makeController({ getStatus });

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
    const controller = makeController({ getStatus });

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
    const controller = makeController({ getStatus });

    const result = await controller.getStatus(MAILBOX);
    expect(result).toEqual({ data: failed });
  });
});

describe('SyncController.postIncremental (D38 prod-ready pass — Sync now)', () => {
  it('returns 202 with outcome=enqueued + cursor when the queue accepts the new job', async () => {
    const enqueue = vi
      .fn<SyncService['enqueueManualIncrementalSync']>()
      .mockResolvedValue({ kind: 'enqueued', cursorHistoryId: '1500' });
    const controller = makeController({ enqueueManualIncrementalSync: enqueue });

    const result = await controller.postIncremental(MAILBOX);

    expect(result).toEqual({
      data: { outcome: 'enqueued', cursor_history_id: '1500' },
    });
    // The cron and the controller share one service method; assert the
    // controller passes `trigger='manual'` so the structured log
    // distinguishes a user click from the drift sweep.
    expect(enqueue).toHaveBeenCalledWith('mailbox-uuid-1', 'manual');
  });

  it('returns 202 with outcome=noop when BullMQ dedups (job for same cursor still in flight)', async () => {
    const enqueue = vi
      .fn<SyncService['enqueueManualIncrementalSync']>()
      .mockResolvedValue({ kind: 'noop', cursorHistoryId: '1500' });
    const controller = makeController({ enqueueManualIncrementalSync: enqueue });

    const result = await controller.postIncremental(MAILBOX);

    expect(result).toEqual({
      data: { outcome: 'noop', cursor_history_id: '1500' },
    });
  });

  it('throws SYNC_NOT_READY (409 → BadRequestException) when initial sync has not completed', async () => {
    // Designed-state path per CLAUDE.md §8 "guard-4xx-as-designed-state":
    // the FE renders the sync-gate progress card, NOT a generic error
    // toast. A retry would just re-throw — the FE must not loop.
    const enqueue = vi
      .fn<SyncService['enqueueManualIncrementalSync']>()
      .mockResolvedValue({ kind: 'not_ready' });
    const controller = makeController({ enqueueManualIncrementalSync: enqueue });

    await expect(controller.postIncremental(MAILBOX)).rejects.toBeInstanceOf(BadRequestException);
  });
});
