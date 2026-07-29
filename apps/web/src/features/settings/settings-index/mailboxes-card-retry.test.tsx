/**
 * Settings → Mailboxes: a failed INITIAL sync gets a working retry.
 *
 * #418 wired the retry on the onboarding gate and left this sibling as a
 * dead-end "Sync failed" tag (fix-the-class miss, D158 triage). The
 * card's retry must name the ROW's mailbox — never whatever happens to
 * be active — via the same `X-Active-Mailbox-Id` mechanism the gate
 * uses.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { MailboxesCard } from './mailboxes-card';

const FAILED_ID = 'mb-failed-0000-0000-000000000009';
const ACTIVE_ID = 'mb-active-0000-0000-000000000001';

const MAILBOXES = [
  {
    id: ACTIVE_ID,
    email: 'primary@example.com',
    status: 'active',
    readiness: 'ready',
  },
  {
    id: FAILED_ID,
    email: 'second@example.com',
    status: 'active',
    readiness: 'failed',
  },
] as never;

function renderCard() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <MailboxesCard
        mailboxes={MAILBOXES}
        activeMailboxId={ACTIVE_ID}
        inboxLimit={3}
        healthById={{}}
        onConnect={() => undefined}
        onReactivate={() => undefined}
      />
    </QueryWrapper>,
  );
}

describe('MailboxesCard — failed-sync retry', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders Try again on the failed row and targets THAT mailbox', async () => {
    let seenHeader: string | null = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: (req) => {
          seenHeader = req.headers.get('X-Active-Mailbox-Id');
          return jsonOk({ outcome: 'requeued' });
        },
      },
    ]);

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(seenHeader).toBe(FAILED_ID));
  });

  it('offers no retry on rows that are not failed', () => {
    renderCard();
    // Exactly one failed row → exactly one retry control.
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });
});
