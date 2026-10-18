import { describe, expect, it } from 'vitest';
import { cleanupBatchStatus, type BatchStatusResult } from './actions';
const batch: BatchStatusResult = {
  feedbackVersion: 2,
  batchId: 'cleanup',
  status: 'done',
  total: 4,
  done: 3,
  failed: 1,
  requestedCount: 58,
  affectedCount: 57,
  undoToken: 'undo',
  unsubscribeOutcomes: {
    endpointAccepted: 1,
    unconfirmed: 1,
    failed: 0,
    actionRequired: 0,
    pending: 0,
  },
};
describe('label readers of combined cleanup batches', () => {
  it('keeps two successful Deletes successful when an unsubscribe was unconfirmed', () => {
    expect(cleanupBatchStatus(batch)).toMatchObject({
      status: 'done',
      total: 2,
      done: 2,
      failed: 0,
      requestedCount: 56,
      affectedCount: 56,
      undoToken: 'undo',
    });
  });
  it('does not hide a real move failure behind an accepted request', () => {
    expect(
      cleanupBatchStatus({
        ...batch,
        total: 2,
        done: 1,
        failed: 1,
        requestedCount: 2,
        affectedCount: 1,
        unsubscribeOutcomes: {
          endpointAccepted: 1,
          unconfirmed: 0,
          failed: 0,
          actionRequired: 0,
          pending: 0,
        },
      }),
    ).toMatchObject({ status: 'failed', total: 1, done: 0, failed: 1, affectedCount: 0 });
  });
  it('keeps old API data unchanged instead of interpreting intent rows as execution', () => {
    const old = { ...batch };
    delete old.feedbackVersion;
    expect(cleanupBatchStatus(old)).toBe(old);
  });
});
