import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { LATER_BULK_RETURN_NOTICE_THRESHOLD } from '@declutrmail/shared/actions';

import { ConfirmActionModal } from '@/features/senders/confirm-action-modal';
import type { ActionRequest } from '@/features/senders/data';
import { makeSender } from '@/features/senders/testing/make-sender';
import { DecidePreview } from '@/features/screener/decide-preview';
import { SCREENER_QUEUE } from '@/features/screener/data';
import { ActionSheet } from './action-sheet';
import { BatchActionSheet } from './batch-action-sheet';
import { TRIAGE_QUEUE } from './data';
import type { DomainBatch } from './domain-batch';

vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'owner@gmail.com',
  useOptionalAuth: () => null,
  useAuth: () => ({ me: { activeMailboxId: null, mailboxes: [] } }),
  MailboxActionContext: () => null,
}));

const BIG = 1_718;
const NOTICE = 'They all return together, not spread out.';
const WAKE_AT = '2026-09-03T08:01:00.000Z';

const buckets = {
  all: BIG,
  olderThan30d: BIG,
  olderThan90d: 0,
  olderThan180d: 0,
  olderThan365d: 0,
};
const messages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};

const triageRow = TRIAGE_QUEUE[0]!;
const batchRows = [0, 1, 2].map((i) => ({ ...triageRow, id: `r-${i}`, senderId: `s-${i}` }));
const batch: DomainBatch = {
  domain: 'example.com',
  startIndex: 0,
  rows: batchRows,
  eligibleRows: batchRows,
};

/**
 * The join, at every surface — not the builder.
 *
 * Four sheets can confirm a Later. The sentence lives in the shared
 * presentation and reaches all four through `previewCopy`/`effectCopy`,
 * which is the point: there is no per-surface prop to forget. This asserts
 * that claim rather than trusting it, because the last time a value was
 * added for one sheet and not passed by its screen, three green tests said
 * it was fine (2026-08-27).
 */
describe('Later bulk-return notice reaches every confirm surface (D226, 3B)', () => {
  it('senders confirm modal', () => {
    const sender = makeSender();
    const request: ActionRequest = { verb: 'Later', senders: [sender] };
    const { container } = render(
      <ConfirmActionModal
        request={request}
        onCancel={() => {}}
        onConfirm={() => {}}
        compositePreview={{
          sender: {
            id: sender.id,
            name: sender.name,
            domain: sender.domain,
            lastSeenDays: 0,
            wroteToCount: 0,
          },
          counts: buckets,
          recentMessages: messages,
          allMail: null,
          unsubAvailable: true,
          protected: false,
        }}
      />,
    );
    expect(container.textContent).toContain(NOTICE);
  });

  it('triage action sheet', () => {
    const { container } = render(
      <ActionSheet
        open
        verb="Later"
        row={triageRow}
        inboxCount={BIG}
        wakeAt={WAKE_AT}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container.textContent).toContain(NOTICE);
  });

  it('triage domain-batch sheet', () => {
    const { container } = render(
      <BatchActionSheet
        open
        verb="Later"
        batch={batch}
        preview={{
          senders: batchRows.map((r) => ({
            senderId: r.senderId,
            name: r.senderName,
            counts: buckets,
            protected: false,
          })),
          totals: buckets,
          protectedCount: 0,
        }}
        wakeAt={WAKE_AT}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container.textContent).toContain(NOTICE);
  });

  it('screener decide preview', () => {
    const { container } = render(
      <DecidePreview
        verb="later"
        row={SCREENER_QUEUE[0]!}
        inboxCount={BIG}
        wakeAt={WAKE_AT}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.textContent).toContain(NOTICE);
  });

  it('stays quiet on a small Later at every surface', () => {
    const small = LATER_BULK_RETURN_NOTICE_THRESHOLD - 1;
    const { container } = render(
      <ActionSheet
        open
        verb="Later"
        row={triageRow}
        inboxCount={small}
        wakeAt={WAKE_AT}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container.textContent).not.toContain('return together');
  });
});
