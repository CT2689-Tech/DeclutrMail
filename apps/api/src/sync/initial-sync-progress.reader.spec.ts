import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Queue } from 'bullmq';
import type { SyncStatus } from '@declutrmail/shared/contracts';
import type { InitialSyncJobData } from '@declutrmail/workers';

import { InitialSyncProgressReader } from './initial-sync-progress.reader.js';

/**
 * The gate's "12,400 of 40,898 emails" line reads the counts the
 * InitialSyncWorker puts on its BullMQ job (`jobId = mailboxAccountId`).
 * Every path that cannot vouch for the numbers must come back `null` —
 * the line disappears. Never a default 0, never a previous scan's count.
 */
describe('InitialSyncProgressReader', () => {
  const READING: Pick<SyncStatus, 'readiness_status' | 'current_stage'> = {
    readiness_status: 'syncing',
    current_stage: 'fetching_metadata',
  };

  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  function reader(getJob: () => Promise<unknown>) {
    const queue = { getJob: vi.fn(getJob) };
    return {
      queue,
      reader: new InitialSyncProgressReader(queue as unknown as Queue<InitialSyncJobData>),
    };
  }

  it("returns the running scan's counts from the mailbox's job", async () => {
    const { reader: r, queue } = reader(async () => ({
      progress: { processed: 12_400, total: 40_898 },
    }));

    await expect(r.read('mb-1', READING)).resolves.toEqual({ processed: 12_400, total: 40_898 });
    expect(queue.getJob).toHaveBeenCalledWith('mb-1');
  });

  it.each([
    [
      'queued (a re-scan waiting to start)',
      { readiness_status: 'queued', current_stage: 'queued' },
    ],
    ['a later stage', { readiness_status: 'syncing', current_stage: 'building_sender_index' }],
    ['failed mid-read', { readiness_status: 'failed', current_stage: 'fetching_metadata' }],
    ['ready', { readiness_status: 'ready', current_stage: 'ready' }],
  ] as const)(
    'is null without touching Redis when the scan is not reading: %s',
    async (_label, status) => {
      const { reader: r, queue } = reader(async () => ({
        progress: { processed: 40_898, total: 40_898 },
      }));

      await expect(r.read('mb-1', status)).resolves.toBeNull();
      expect(queue.getJob).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no job (removed or never added)', undefined],
    ["BullMQ's default progress on a new or cleared job", { progress: 0 }],
    ['more read than the mailbox holds', { progress: { processed: 11, total: 10 } }],
    ['a partial shape', { progress: { processed: 10 } }],
    ['a non-object progress', { progress: '12400/40898' }],
  ])('is null for %s', async (_label, job) => {
    const { reader: r } = reader(async () => job);

    await expect(r.read('mb-1', READING)).resolves.toBeNull();
  });

  it('is null, and says so in the log, when Redis cannot be read', async () => {
    const { reader: r } = reader(async () => {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    });

    await expect(r.read('mb-1', READING)).resolves.toBeNull();
    const kinds = warn.mock.calls.map((c) => (JSON.parse(String(c[0])) as { kind: string }).kind);
    expect(kinds).toEqual(['sync.scan_progress_read_failed']);
  });
});
