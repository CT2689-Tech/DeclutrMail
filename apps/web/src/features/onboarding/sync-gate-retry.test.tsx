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
const FIRST_RUN_ID = 'mb-first-run-0000-0000-000000000001';

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

  it('names the mailbox on the FIRST-RUN gate too — active is resolved twice otherwise', async () => {
    // The first-run gate scopes its status GET to the client's cached
    // `me.activeMailboxId`, while an unscoped POST would resolve
    // whatever is active server-side right now. Those are two different
    // mechanisms and they diverge whenever `me` is stale (another tab
    // switched, a disconnect auto-selected another mailbox) — so the
    // header is required here as well, not just on the secondary gate.
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

    renderGate({ mailboxId: FIRST_RUN_ID });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(seenHeader).toBe(FIRST_RUN_ID));
  });

  it('disables the retry entirely when no mailbox id is known', async () => {
    // Never fire an unscoped request as a fallback: it would re-queue
    // whatever the server considers active, which is precisely the
    // mailbox this screen cannot vouch for.
    let called = false;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/v1/sync/initial/retry',
        respond: () => {
          called = true;
          return jsonOk({ outcome: 'requeued' });
        },
      },
    ]);

    renderGate();
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
  });
});
