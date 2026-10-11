import { describe, expect, it } from 'vitest';

import { fillCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

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

  it('keeps bulk archive on its deck sentence and does not rewrite it for delete', () => {
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
    ).toBe(fillCopy(WS5_COPY['f1.toast.bulk'], { m: 2, n: 30 }));
    const deleted = unsubscribeBacklogToast(
      result({
        mode: 'delete',
        backlog: { actionId: 'b', requestedCount: 30, verb: 'delete' },
        senders,
      }),
    );
    expect(deleted).toBe(pluralCopy(WS5_COPY['f1.toast.bulk.delete'], 30, { m: 2, n: 30 }));
    expect(deleted).not.toContain('Archived');
    expect(
      unsubscribeBacklogToast(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 1, verb: 'delete' },
          senders,
        }),
      ),
    ).toBe(pluralCopy(WS5_COPY['f1.toast.bulk.delete'], 1, { m: 2, n: 1 }));
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
    expect(line).toBe(
      `${fillCopy(WS5_COPY['f1.toast.bulk'], { m: 1, n: 30 })} · ${WS5_COPY['f1.toast.mailto']}`,
    );
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
    expect(line).toBe(fillCopy(WS5_COPY['f1.toast.mailto.withMove.archive'], { n: 4 }));
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
    expect(deleted).toBe(fillCopy(WS5_COPY['f1.toast.mailto.withMove.delete'], { n: 8 }));
    expect(deleted).not.toMatch(/requested/i);
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
  it('uses the delete deck row for a one-click request', () => {
    expect(
      unsubscribeBacklogActivityLine(
        result({
          mode: 'delete',
          backlog: { actionId: 'b', requestedCount: 191, verb: 'delete' },
        }),
      ),
    ).toBe(fillCopy(WS5_COPY['f1.activity.row.delete'], { n: 191 }));
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
    expect(line).toBe(fillCopy(WS5_COPY['f1.toast.mailto.withMove.archive'], { n: 4 }));
    expect(line).not.toMatch(/requested/i);
  });
});
