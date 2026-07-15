import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTION_RECOVERY_JOB,
  actionRecoveryJobOptions,
  enqueueActionRecoveryPreview,
} from './action-recovery.queue.js';
import type { ActionRecoveryJobData } from './action-recovery.worker.js';

describe('action recovery queue', () => {
  it('deduplicates one durable preview at the BullMQ boundary', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue<ActionRecoveryJobData>;
    const input: ActionRecoveryJobData = {
      previewId: '00000000-0000-4000-8000-000000000001',
      mailboxAccountId: '00000000-0000-4000-8000-000000000002',
      actionId: '00000000-0000-4000-8000-000000000003',
    };

    await enqueueActionRecoveryPreview(queue, input);

    expect(add).toHaveBeenCalledWith(
      ACTION_RECOVERY_JOB,
      input,
      actionRecoveryJobOptions(input.previewId),
    );
    expect(actionRecoveryJobOptions(input.previewId)).toMatchObject({
      jobId: `ActionRecoveryWorker-${input.previewId}`,
      attempts: 5,
      removeOnFail: false,
    });
  });
});
