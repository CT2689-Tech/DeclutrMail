import { describe, expect, it, vi } from 'vitest';

import { ActionsController } from './actions.controller.js';

const MAILBOX_ID = '00000000-0000-4000-8000-000000000010';
const SENDER_ID = '00000000-0000-4000-8000-000000000011';
const RESULT = {
  senderId: SENDER_ID,
  recordedAt: '2026-07-12T00:00:00.000Z',
  activityLogId: '00000000-0000-4000-8000-000000000012',
  method: 'none' as const,
  executionActionId: null,
  mailtoUrl: null,
};

describe('ActionsController.unsubscribeIntent', () => {
  it.each([
    [{ senderId: SENDER_ID }, false],
    [{ senderId: SENDER_ID, includesBacklogAction: true }, true],
  ] as const)('forwards the parsed backlog flag (%s)', async (body, expected) => {
    const recordUnsubscribeIntent = vi.fn().mockResolvedValue(RESULT);
    const controller = new ActionsController({ recordUnsubscribeIntent } as never);

    await expect(
      controller.unsubscribeIntent({ id: MAILBOX_ID }, 'idempotency-key-123', body),
    ).resolves.toEqual({ data: RESULT });
    expect(recordUnsubscribeIntent).toHaveBeenCalledWith({
      mailboxAccountId: MAILBOX_ID,
      senderId: SENDER_ID,
      idempotencyKey: 'idempotency-key-123',
      includesBacklogAction: expected,
    });
  });
});
