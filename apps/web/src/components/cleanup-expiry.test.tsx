import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmActionModal } from '@/features/senders/confirm-action-modal';
import { makeSender } from '@/features/senders/testing/make-sender';
import { ActionSheet } from '@/features/triage/action-sheet';
import { BatchActionSheet } from '@/features/triage/batch-action-sheet';
import { InlinePreviewBlock } from '@/features/triage/inline-preview';
import { TRIAGE_QUEUE } from '@/features/triage/fixtures';
import { DecidePreview } from '@/features/screener/decide-preview';
import { SCREENER_QUEUE } from '@/features/screener/data';

const row = { ...TRIAGE_QUEUE[0]!, protectionReason: null };
const counts = { all: 1, olderThan30d: 1, olderThan90d: 1, olderThan180d: 1, olderThan365d: 0 };
const recentMessages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};

describe('Later return expiry across cleanup previews', () => {
  it.each(['click', 'keyboard'])(
    'rechecks Senders at %s submission after a wall-clock jump',
    (method) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-20T18:00:00Z'));
      try {
        const sender = makeSender();
        const onConfirm = vi.fn();
        render(
          <ConfirmActionModal
            request={{ verb: 'Later', senders: [sender] }}
            compositePreview={{
              sender: {
                id: sender.id,
                name: sender.name,
                domain: sender.domain,
                lastSeenDays: 2,
                wroteToCount: 0,
              },
              counts,
              recentMessages,
              allMail: null,
              unsubAvailable: false,
              protected: false,
            }}
            onCancel={vi.fn()}
            onConfirm={onConfirm}
          />,
        );
        const confirm = screen.getByRole('button', { name: 'Later' });
        expect(confirm).toBeEnabled();
        // Move the wall clock without delivering the scheduled timeout or a focus event.
        vi.setSystemTime(new Date(Date.now() + 8 * 86_400_000));
        if (method === 'click') fireEvent.click(confirm);
        else fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(confirm).toBeDisabled();
        expect(screen.getByText('Choose a future return time.')).toBeVisible();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['Senders', 'Triage dialog', 'Triage inline', 'Triage group', 'Screener'])(
    'disables %s and explains an expired return without another edit',
    (surface) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 20, 10, 0, 58));
      try {
        const wakeAt = new Date(Date.now() + 2_000).toISOString();
        const onConfirm = vi.fn();
        if (surface === 'Senders') {
          const sender = makeSender();
          render(
            <ConfirmActionModal
              request={{ verb: 'Later', senders: [sender] }}
              compositePreview={{
                sender: {
                  id: sender.id,
                  name: sender.name,
                  domain: sender.domain,
                  lastSeenDays: 2,
                  wroteToCount: 0,
                },
                counts,
                recentMessages,
                allMail: null,
                unsubAvailable: false,
                protected: false,
              }}
              onCancel={vi.fn()}
              onConfirm={onConfirm}
            />,
          );
          fireEvent.change(screen.getByLabelText('Later return time'), {
            target: { value: '2026-10-20T10:01' },
          });
        } else if (surface === 'Triage dialog') {
          render(
            <ActionSheet
              open
              verb="Later"
              row={row}
              inboxCount={1}
              wakeAt={wakeAt}
              onCancel={vi.fn()}
              onConfirm={onConfirm}
            />,
          );
        } else if (surface === 'Triage inline') {
          render(
            <InlinePreviewBlock
              row={row}
              preview={{
                verb: 'Later',
                archiveHistoric: false,
                inboxCount: 1,
                wakeAt,
                onWakeAtChange: vi.fn(),
              }}
              busy={false}
              shortcutLive
              onConfirm={onConfirm}
            />,
          );
        } else if (surface === 'Triage group') {
          render(
            <BatchActionSheet
              open
              verb="Later"
              batch={{ domain: row.senderDomain, startIndex: 0, rows: [row], eligibleRows: [row] }}
              preview={{
                senders: [
                  { senderId: row.senderId, name: row.senderName, counts, protected: false },
                ],
                totals: counts,
                protectedCount: 0,
              }}
              wakeAt={wakeAt}
              onCancel={vi.fn()}
              onConfirm={onConfirm}
            />,
          );
        } else {
          render(
            <DecidePreview
              verb="later"
              row={SCREENER_QUEUE[0]!}
              inboxCount={1}
              wakeAt={wakeAt}
              confirming={false}
              onCancel={vi.fn()}
              onConfirm={onConfirm}
            />,
          );
        }
        const confirm = screen.getByRole('button', {
          name: /^(Later|Move .+ to Later)( for .+)?$/,
        });
        expect(confirm).toBeEnabled();
        act(() => vi.advanceTimersByTime(2_001));
        expect(confirm).toBeDisabled();
        expect(screen.getByText(/future return time/i)).toBeVisible();
        fireEvent.click(confirm);
        fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
        expect(onConfirm).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
