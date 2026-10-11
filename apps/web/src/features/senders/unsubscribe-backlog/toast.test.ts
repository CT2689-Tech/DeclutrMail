import { describe, expect, it } from 'vitest';

import { pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

import { unsubscribeBacklogToast } from './toast';

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
});
