import { describe, expect, it } from 'vitest';

import { pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

import { unsubscribeBacklogActivityLine, unsubscribeBacklogToast } from './toast';

function result(
  partial: Partial<UnsubscribeBacklogResult> & Pick<UnsubscribeBacklogResult, 'mode'>,
): UnsubscribeBacklogResult {
  return {
    backlog: null,
    senders: [
      {
        senderId: 'a',
        method: 'one_click',
        mailtoUrl: null,
        executionActionId: null,
        lifecycleStatus: null,
        unsubStatus: 'requested',
        reasonCode: null,
      },
    ],
    ...partial,
  };
}

describe('unsubscribeBacklogToast', () => {
  it('uses the archive and delete deck lines', () => {
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 111, verb: 'archive' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.both.archive'], 111, { n: 111 }));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 4, verb: 'delete' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.both.delete'], 4, { n: 4 }));
  });

  it('keeps the request count when a mailto sender is in an unsubscribe-only run', () => {
    const line = unsubscribeBacklogToast(
      result({
        mode: 'unsub_only',
        senders: [
          {
            senderId: 'a',
            method: 'one_click',
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'requested',
            reasonCode: null,
          },
          {
            senderId: 'b',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(line).toBe(
      `${pluralCopy(WS5_COPY['report.celebrate.unsub'], 1, { m: 1 })} · ${WS5_COPY['f1.toast.mailto']}`,
    );
    expect(line).not.toContain('from 2 senders');
  });

  it('uses the mailto deck line and never calls it a draft', () => {
    const line = unsubscribeBacklogToast(
      result({
        mode: 'unsub_only',
        senders: [
          {
            senderId: 'a',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(line).toBe(WS5_COPY['f1.toast.mailto']);
    expect(line).not.toMatch(/draft/i);
  });

  function bulkParts(m: number, n: number, verb: 'archive' | 'delete' = 'archive'): string {
    const unsub = pluralCopy(WS5_COPY['f1.toast.part.unsub'], m, { m });
    const moved = pluralCopy(
      verb === 'delete' ? WS5_COPY['f1.toast.part.deleted'] : WS5_COPY['f1.toast.part.archived'],
      n,
      { n },
    );
    return `${unsub} · ${moved}`;
  }

  it('builds a bulk toast from singular and plural parts and never the retired sentences', () => {
    const senders = [
      {
        senderId: 'a',
        method: 'one_click' as const,
        mailtoUrl: null,
        executionActionId: null,
        lifecycleStatus: null,
        unsubStatus: 'requested' as const,
        reasonCode: null,
      },
      {
        senderId: 'b',
        method: 'one_click' as const,
        mailtoUrl: null,
        executionActionId: null,
        lifecycleStatus: null,
        unsubStatus: 'requested' as const,
        reasonCode: null,
      },
    ];
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 30, verb: 'archive' },
          senders,
        }),
      ),
    ).toBe(bulkParts(2, 30));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'archive' },
          senders: [senders[0]!],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.both.archive'], 1, { n: 1 }));
    const deleted = unsubscribeBacklogToast(
      result({
        mode: 'delete',
        backlog: { actionId: 'b', requestedCount: 30, verb: 'delete' },
        senders,
      }),
    );
    expect(deleted).toBe(bulkParts(2, 30, 'delete'));
    expect(deleted).not.toContain('Archived');
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'archive' },
          senders,
        }),
      ),
    ).toBe(bulkParts(2, 1));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'delete' },
          senders,
        }),
      ),
    ).toBe(bulkParts(2, 1, 'delete'));
    expect(WS5_COPY['f1.toast.bulk']).not.toBe(bulkParts(2, 30));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 1139, verb: 'archive' },
          senders,
        }),
      ),
    ).toBe('Unsubscribe requested from 2 senders · Archived 1,139 emails');
  });

  it('counts only requested senders and still shows the Send line for mailto', () => {
    const line = unsubscribeBacklogToast(
      result({
        mode: 'archive',
        backlog: { actionId: 'b', requestedCount: 30, verb: 'archive' },
        senders: [
          {
            senderId: 'a',
            method: 'one_click',
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'requested',
            reasonCode: null,
          },
          {
            senderId: 'b',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(line).toBe(`${bulkParts(1, 30)} · ${WS5_COPY['f1.toast.mailto']}`);
    expect(line).not.toContain('from 2 senders');
  });

  it('uses the Send sentence for a mailto move and does not say a request was sent', () => {
    const line = unsubscribeBacklogToast(
      result({
        mode: 'archive',
        backlog: { actionId: 'b', requestedCount: 4, verb: 'archive' },
        senders: [
          {
            senderId: 'a',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(line).toBe(pluralCopy(WS5_COPY['f1.toast.mailto.withMove.archive'], 4, { n: 4 }));
    expect(line).not.toMatch(/requested/i);
    expect(line).not.toMatch(/draft/i);
    const deleted = unsubscribeBacklogToast(
      result({
        mode: 'delete',
        backlog: { actionId: 'b', requestedCount: 8, verb: 'delete' },
        senders: [
          {
            senderId: 'a',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
          {
            senderId: 'b',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(deleted).toBe(
      `${WS5_COPY['f1.toast.mailto']} · ${pluralCopy(WS5_COPY['f1.toast.part.deleted'], 8, { n: 8 })}`,
    );
    expect(deleted).not.toMatch(/requested/i);
  });

  it('does not claim a request when nothing was requested', () => {
    const failed = unsubscribeBacklogToast(
      result({
        mode: 'unsub_only',
        senders: [
          {
            senderId: 'a',
            method: 'one_click',
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'failed',
            reasonCode: 'generic',
          },
        ],
      }),
    );
    expect(failed).toBe(pluralCopy(WS5_COPY['f1.toast.bulkFailed'], 1, { k: 1 }));
    expect(failed).not.toMatch(/requested/i);

    const skipped = unsubscribeBacklogToast(
      result({
        mode: 'unsub_only',
        senders: [
          {
            senderId: 'a',
            method: null,
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'skipped',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(skipped).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped.plain'], 1, { n: 1 }));
    expect(skipped).not.toBe(WS5_COPY['f1.reason.generic']);
    expect(skipped).not.toContain('Unsubscribe failed:');

    const noLink = unsubscribeBacklogToast(
      result({
        mode: 'unsub_only',
        senders: [
          {
            senderId: 'a',
            method: 'none',
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'skipped',
            reasonCode: 'no_link',
          },
        ],
      }),
    );
    expect(noLink).toBe(WS5_COPY['f1.reason.noLink']);
    expect(noLink).not.toMatch(/requested|wrong/i);
  });

  it('names the archive or delete when every bulk unsubscribe failed', () => {
    const sender = {
      method: 'one_click' as const,
      mailtoUrl: null,
      executionActionId: null,
      lifecycleStatus: null,
      unsubStatus: 'failed' as const,
      reasonCode: 'generic' as const,
    };
    const archived = unsubscribeBacklogToast(
      result({
        mode: 'archive',
        backlog: { actionId: 'b', requestedCount: 6, verb: 'archive' },
        senders: [
          { ...sender, senderId: 'a' },
          { ...sender, senderId: 'b' },
        ],
      }),
    );
    expect(archived).toBe(
      pluralCopy(WS5_COPY['f1.toast.unsubFailed.archive'], 6, {
        n: 6,
        reason: WS5_COPY['f1.reason.generic'],
      }),
    );
    expect(archived).toMatch(/Archived/);
    expect(archived).not.toBe(pluralCopy(WS5_COPY['f1.toast.bulkFailed'], 2, { k: 2 }));

    const deleted = unsubscribeBacklogToast(
      result({
        mode: 'delete',
        backlog: { actionId: 'b', requestedCount: 2, verb: 'delete' },
        senders: [
          { ...sender, senderId: 'a' },
          { ...sender, senderId: 'b' },
        ],
      }),
    );
    expect(deleted).toMatch(/Deleted/);
    expect(deleted).not.toMatch(/requested/i);
  });

  function skippedSender(
    senderId: string,
    reasonCode: UnsubscribeBacklogResult['senders'][number]['reasonCode'],
  ) {
    return {
      senderId,
      method: null,
      mailtoUrl: null,
      executionActionId: null,
      lifecycleStatus: null,
      unsubStatus: 'skipped' as const,
      reasonCode,
    };
  }

  it('uses the Protected skip sentence when every sender is Protected', () => {
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', 'protected')],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped'], 1, { n: 1 }));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          senders: [skippedSender('a', 'protected'), skippedSender('b', 'protected')],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped'], 2, { n: 2 }));
  });

  it('uses the plain skip sentence when the reason is not Protected or missing', () => {
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', 'mailto_only'), skippedSender('b', 'method_unknown')],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped.plain'], 2, { n: 2 }));
  });

  it('names senders that are no longer found, including one and many', () => {
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', 'not_found')],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped.notFound'], 1, { n: 1 }));
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', 'not_found'), skippedSender('b', 'not_found')],
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.unsub.skipped.notFound'], 2, { n: 2 }));
  });

  it('appends the Protected skip clause after a mixed result', () => {
    const line = unsubscribeBacklogToast(
      result({
        mode: 'archive',
        backlog: { actionId: 'b', requestedCount: 30, verb: 'archive' },
        senders: [
          {
            senderId: 'a',
            method: 'one_click',
            mailtoUrl: null,
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'requested',
            reasonCode: null,
          },
          skippedSender('b', 'protected'),
        ],
      }),
    );
    expect(line).toBe(
      `${bulkParts(1, 30)} · ${pluralCopy(WS5_COPY['f1.toast.bulkSkipped'], 1, { k: 1 })}`,
    );
  });

  it('never wraps the skipped reason in Unsubscribe failed', () => {
    const skippedReason = WS5_COPY['f1.reason.skipped'];
    const lines = [
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', 'protected')],
        }),
      ),
      unsubscribeBacklogToast(
        result({
          mode: 'unsub_only',
          senders: [skippedSender('a', null)],
        }),
      ),
      unsubscribeBacklogToast(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 2, verb: 'delete' },
          senders: [
            {
              senderId: 'a',
              method: 'one_click',
              mailtoUrl: null,
              executionActionId: null,
              lifecycleStatus: null,
              unsubStatus: 'failed',
              reasonCode: 'generic',
            },
          ],
        }),
      ),
      unsubscribeBacklogToast(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 4, verb: 'archive' },
          senders: [
            {
              senderId: 'a',
              method: 'one_click',
              mailtoUrl: null,
              executionActionId: null,
              lifecycleStatus: null,
              unsubStatus: 'failed',
              reasonCode: 'protected',
            },
            skippedSender('b', 'protected'),
          ],
        }),
      ),
    ];
    for (const line of lines) {
      expect(line).not.toBe('');
      if (line.includes('Unsubscribe failed:')) {
        expect(line).not.toContain(skippedReason);
      }
    }
    const failed = lines[2]!;
    expect(failed).toContain('Unsubscribe failed:');
    expect(failed).toContain(WS5_COPY['f1.reason.generic']);
    expect(failed).not.toContain(skippedReason);
  });

  it('uses the failed-unsubscribe deck line', () => {
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 2, verb: 'delete' },
          senders: [
            {
              senderId: 'a',
              method: 'one_click',
              mailtoUrl: null,
              executionActionId: null,
              lifecycleStatus: null,
              unsubStatus: 'failed',
              reasonCode: 'no_link',
            },
          ],
        }),
      ),
    ).toBe(
      pluralCopy(WS5_COPY['f1.toast.unsubFailed.delete'], 2, {
        n: 2,
        reason: WS5_COPY['f1.reason.noLink'],
      }),
    );
  });
});

describe('unsubscribeBacklogActivityLine', () => {
  it('uses one combined row for each count form', () => {
    expect(
      unsubscribeBacklogActivityLine(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'archive' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.activity.row'], 1, { n: 1 }));
    expect(
      unsubscribeBacklogActivityLine(
        result({
          mode: 'archive',
          backlog: { actionId: 'b', requestedCount: 12, verb: 'archive' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.activity.row'], 12, { n: 12 }));
    expect(
      unsubscribeBacklogActivityLine(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'delete' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.activity.row.delete'], 1, { n: 1 }));
  });

  it('uses the delete deck row for a one-click request', () => {
    expect(
      unsubscribeBacklogActivityLine(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 191, verb: 'delete' },
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.activity.row.delete'], 191, { n: 191 }));
  });

  it('does not say requested when a mailto sender is in the row', () => {
    const line = unsubscribeBacklogActivityLine(
      result({
        mode: 'archive',
        backlog: { actionId: 'b', requestedCount: 4, verb: 'archive' },
        senders: [
          {
            senderId: 'a',
            method: 'mailto',
            mailtoUrl: 'https://mail.google.com/mail/?view=cm',
            executionActionId: null,
            lifecycleStatus: null,
            unsubStatus: 'manual',
            reasonCode: null,
          },
        ],
      }),
    );
    expect(line).toBe(pluralCopy(WS5_COPY['f1.toast.mailto.withMove.archive'], 4, { n: 4 }));
    expect(line).not.toMatch(/requested/i);
  });
});
