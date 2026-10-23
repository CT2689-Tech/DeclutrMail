import { describe, expect, it, vi } from 'vitest';
import { SenderRulesController } from './sender-rules.controller.js';
import type { SenderRulesService } from './sender-rules.service.js';

const mailbox = { id: 'owned-mailbox' };
const id = '11111111-1111-4111-8111-111111111111';
const definition = {
  name: 'Newsletters',
  senderKeys: ['a'.repeat(64)],
  action: 'archive',
  reach: 'inbox_only',
  olderThanDays: 30,
};
function setup() {
  const rules = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id }),
    patch: vi.fn().mockResolvedValue({ id }),
    preview: vi.fn().mockResolvedValue({ previewId: id }),
    execute: vi.fn().mockResolvedValue({ previewId: id }),
    search: vi.fn().mockResolvedValue({ senders: [], nextCursor: null }),
  };
  return { rules, controller: new SenderRulesController(rules as unknown as SenderRulesService) };
}

describe('sender-rule HTTP boundary', () => {
  it('always takes mailbox identity from the authenticated guard', async () => {
    const { controller, rules } = setup();
    expect(await controller.list(mailbox)).toEqual({ data: [] });
    expect(rules.list).toHaveBeenCalledWith(mailbox.id);
    await controller.create(mailbox, definition, 'save-request');
    expect(rules.create).toHaveBeenCalledWith(mailbox.id, definition, 'save-request');
    await expect(
      controller.create(mailbox, { ...definition, mailboxId: 'forged' }, 'save-request'),
    ).rejects.toThrow();
  });
  it('rejects Active, protection overrides, unknown conditions and arbitrary message IDs', async () => {
    const { controller, rules } = setup();
    for (const body of [
      { ...definition, mode: 'active' },
      { ...definition, override: true },
      { ...definition, conditions: { kind: 'subject' } },
      { ...definition, messageIds: ['forged'] },
    ])
      await expect(controller.create(mailbox, body, 'save-request')).rejects.toThrow();
    await expect(controller.patch(mailbox, id, { version: 1, mode: 'active' })).rejects.toThrow();
    await expect(controller.preview(mailbox, id, { version: 1, override: true })).rejects.toThrow();
    await expect(
      controller.execute(mailbox, id, { previewId: id, messageIds: ['forged'] }, 'unique-key'),
    ).rejects.toThrow();
    expect(rules.create).not.toHaveBeenCalled();
    expect(rules.execute).not.toHaveBeenCalled();
  });
  it('requires a current version and stable request key for confirmation', async () => {
    const { controller, rules } = setup();
    await expect(controller.preview(mailbox, id, {})).rejects.toThrow();
    await expect(controller.create(mailbox, definition)).rejects.toThrow('Idempotency-Key');
    await expect(controller.execute(mailbox, id, { previewId: id })).rejects.toThrow(
      'Idempotency-Key',
    );
    await controller.execute(mailbox, id, { previewId: id }, 'unique-key');
    expect(rules.execute).toHaveBeenCalledWith(mailbox.id, id, id);
    await expect(
      controller.execute(mailbox, 'forged', { previewId: id }, 'unique-key'),
    ).rejects.toThrow('UUID');
  });
  it('rejects unbounded or structured search parameters before any query', async () => {
    const { controller, rules } = setup();
    await expect(controller.search(mailbox, ['one', 'two'])).rejects.toThrow();
    await expect(controller.search(mailbox, 'x'.repeat(101))).rejects.toThrow();
    await expect(controller.search(mailbox, '', 'x'.repeat(513))).rejects.toThrow();
    expect(rules.search).not.toHaveBeenCalled();
  });
});
