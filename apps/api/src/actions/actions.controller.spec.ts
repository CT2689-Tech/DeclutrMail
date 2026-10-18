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
    [{ senderId: SENDER_ID }, false, false],
    [{ senderId: SENDER_ID, includesBacklogAction: true }, true, false],
    [{ senderId: SENDER_ID, override: true }, false, true],
  ] as const)('forwards the parsed flags (%s)', async (body, backlog, override) => {
    const recordUnsubscribeIntent = vi.fn().mockResolvedValue(RESULT);
    const controller = new ActionsController(
      { recordUnsubscribeIntent } as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.unsubscribeIntent({ id: MAILBOX_ID }, 'idempotency-key-123', body),
    ).resolves.toEqual({ data: RESULT });
    expect(recordUnsubscribeIntent).toHaveBeenCalledWith({
      mailboxAccountId: MAILBOX_ID,
      senderId: SENDER_ID,
      idempotencyKey: 'idempotency-key-123',
      includesBacklogAction: backlog,
      override,
    });
  });
});

describe('ActionsController route order', () => {
  it('declares the literal `active` and `batch/:id` routes before `:id`', () => {
    // Nest registers handlers in prototype order; `:id` first would read
    // "active" as an action id and answer 400 INVALID_ID.
    const handlers = Object.getOwnPropertyNames(ActionsController.prototype);
    expect(handlers.indexOf('active')).toBeGreaterThan(-1);
    expect(handlers.indexOf('active')).toBeLessThan(handlers.indexOf('status'));
    expect(handlers.indexOf('batchStatus')).toBeLessThan(handlers.indexOf('status'));
  });
});

describe('ActionsController.undoStatus', () => {
  it('forwards one mailbox-scoped batch read', async () => {
    const getUndoStatus = vi.fn().mockResolvedValue({ status: 'executing' });
    const controller = new ActionsController({ getUndoStatus } as never, {} as never, {} as never);
    await expect(
      controller.undoStatus({ id: MAILBOX_ID }, { actionIds: [SENDER_ID] }),
    ).resolves.toEqual({ data: { status: 'executing' } });
    expect(getUndoStatus).toHaveBeenCalledExactlyOnceWith([SENDER_ID], MAILBOX_ID);
  });

  it.each([
    { actionIds: [] },
    { actionIds: ['invalid'] },
    { actionIds: Array(2001).fill(SENDER_ID) },
    { actionIds: [SENDER_ID], mailboxId: 'foreign' },
  ])('rejects invalid or unbounded input', async (body) => {
    const getUndoStatus = vi.fn();
    const controller = new ActionsController({ getUndoStatus } as never, {} as never, {} as never);
    await expect(controller.undoStatus({ id: MAILBOX_ID }, body)).rejects.toMatchObject({
      response: { code: 'INVALID_REQUEST' },
    });
    expect(getUndoStatus).not.toHaveBeenCalled();
  });
});
