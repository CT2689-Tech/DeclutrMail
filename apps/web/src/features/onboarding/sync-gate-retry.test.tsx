/**
 * The failed sync-gate's retry must target the mailbox the GATE IS
 * WATCHING — not whichever mailbox happens to be active.
 *
 * The secondary-connect gate (D116) renders `?mailbox=<id>` while a
 * DIFFERENT mailbox stays active, and it deliberately gates that target
 * "so it survives the user switching their active mailbox back to the
 * primary mid-sync". Without the `X-Active-Mailbox-Id` header the
 * server's `CurrentMailboxGuard` resolves the ACTIVE mailbox instead —
 * so the retry would either re-queue the wrong mailbox or, far more
 * often (the active one is normally `ready`), answer `not_failed` and
 * do nothing while the button reported success. That is the
 * silent-no-op shape: a control that claims an action it did not take.
 *
 * Caught by the Codex stop-review on PR #418.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { SyncGate } from './sync-gate';

const FAILED: SyncStatus = {
  readiness_status: 'failed',
  current_stage: 'failed',
  progress_pct: 100,
  is_ready_for_triage: false,
};

const SECONDARY_ID = 'mb-secondary-0000-0000-000000000002';

function renderGate(props: { mailboxId?: string } = {}) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <SyncGate status={FAILED} {...props} />
    </QueryWrapper>,
  );
}

describe('SyncGate retry — mailbox scoping', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('names the WATCHED mailbox so the server cannot re-queue the active one', async () => {
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

    renderGate({ mailboxId: SECONDARY_ID });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(seenHeader).toBe(SECONDARY_ID));
  });

  it('omits the header on the first-run gate, where watched IS active', async () => {
    let called = false;
    let seenHeader: string | null = 'unset';
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: (req) => {
          called = true;
          seenHeader = req.headers.get('X-Active-Mailbox-Id');
          return jsonOk({ outcome: 'requeued' });
        },
      },
    ]);

    renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(called).toBe(true));
    // No override — the guard resolving the active mailbox is correct here.
    expect(seenHeader).toBeNull();
  });
});
