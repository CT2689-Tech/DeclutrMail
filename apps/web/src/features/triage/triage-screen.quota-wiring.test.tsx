import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './data';
import { resetTriageStore } from './store';
import { TriageScreen } from './triage-screen';

vi.mock('@/lib/sentry', () => ({
  captureFeatureException: vi.fn(),
  track: vi.fn(),
}));

const CLEANUP_REMAINING = 34;

vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'owner@gmail.com',
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user: { email: 'owner@gmail.com' },
      mailboxes: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@gmail.com' }],
      cleanupRemaining: 34,
    },
  }),
  MailboxActionContext: () => null,
}));

/**
 * Three CONSECUTIVE rows on one domain — the shape `findVerdictBatch`
 * requires (`MIN_BATCH_RUN`) before a domain batch card appears.
 */
const batchRows = [0, 1, 2].map((index) => ({
  ...TRIAGE_QUEUE[0]!,
  id: `batch-row-${index}`,
  senderId: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${index}`,
  senderKey: `key-${index}`,
  senderName: `Batch Sender ${index + 1}`,
  senderEmail: `sender-${index}@batchdomain.com`,
  senderDomain: 'batchdomain.com',
  protectionReason: null,
}));

function renderScreen(client: QueryClient) {
  return render(
    <QueryWrapper client={client}>
      <TriageScreen state={{ kind: 'ready', rows: batchRows, stats: TRIAGE_SESSION_STATS }} />
    </QueryWrapper>,
  );
}

/**
 * The join, not the component.
 *
 * `BatchActionSheet` grew a `quotaRemaining` prop and three passing tests
 * that hand it the value directly — while `triage-screen.tsx` never
 * passed it. Production stated no cost; the suite was green. That is the
 * failure CLAUDE.md §8 names outright: "tests that assert on the producer
 * and tests that mock the consumer can both be green while the join
 * between them is broken."
 *
 * So this renders the real screen and reads the real sheet. Every confirm
 * surface Triage can spend from gets a case here, because the two that
 * were correctly wired were the two I had smoked by hand, and the one I
 * could not reach live is the one that shipped broken.
 */
describe('TriageScreen — every confirm surface receives the cleanup allowance', () => {
  beforeEach(() => {
    resetTriageStore();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                senders: batchRows.map((r) => ({
                  senderId: r.senderId,
                  name: r.senderName,
                  counts: {
                    all: 4,
                    olderThan30d: 3,
                    olderThan90d: 2,
                    olderThan180d: 1,
                    olderThan365d: 0,
                  },
                  protected: false,
                })),
                totals: {
                  all: 12,
                  olderThan30d: 9,
                  olderThan90d: 6,
                  olderThan180d: 3,
                  olderThan365d: 0,
                },
                protectedCount: 0,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
  });

  it('states the batch cost on the domain-batch sheet', async () => {
    renderScreen(createTestQueryClient());

    fireEvent.click(
      screen.getByRole('button', { name: 'Archive all 3 senders from batchdomain.com' }),
    );

    const dialog = await screen.findByRole('dialog');
    // `textContent`, not `getByText`: the copy interpolates the numbers, so
    // it spans several text nodes.
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        `Uses 3 of your ${CLEANUP_REMAINING} cleanup actions left this month.`,
      ),
    );
  });

  it('states the single-row cost on the action sheet', async () => {
    renderScreen(createTestQueryClient());

    // Two cards collapse this run — the verdict banner and the domain
    // card — and each has its own opt-out. Step out of both.
    for (const optOut of screen.queryAllByRole('button', { name: 'Decide one by one' })) {
      fireEvent.click(optOut);
    }
    const expand = screen
      .getAllByRole('button')
      .find((b) => /expand triage detail/.test(b.getAttribute('aria-label') ?? ''));
    fireEvent.click(expand!);
    const rowArchive = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === 'ArchiveA');
    fireEvent.click(rowArchive!);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        `Uses 1 of your ${CLEANUP_REMAINING} cleanup actions left this month.`,
      ),
    );
  });
});
