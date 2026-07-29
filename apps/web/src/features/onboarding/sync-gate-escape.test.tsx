/**
 * FIRST-RUN trap exits (D158 triage). A first-run user whose retry also
 * fails had no way out: the onboarding guard bounces every route back to
 * the gate, so clearing cookies was the only escape. The failed gate now
 * offers "Disconnect and start over" (returns the onboarding machine to
 * the connect step) and "Sign out" — but ONLY on first-run. The
 * secondary-connect gate keeps its D116 hop back to the working primary
 * and must NOT gain a disconnect for the mailbox it is watching.
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

const MAILBOX_ID = 'mb-first-run-0000-0000-000000000001';

describe('SyncGate failed — first-run escape hatch', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('offers Disconnect-and-start-over targeting the WATCHED mailbox', async () => {
    let deletedPath: string | null = null;
    installFetchStub([
      {
        method: 'DELETE',
        path: `/api/mailboxes/${MAILBOX_ID}`,
        respond: (req) => {
          deletedPath = new URL(req.url).pathname;
          return jsonOk({ ok: true });
        },
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SyncGate status={FAILED} mailboxId={MAILBOX_ID} />
      </QueryWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect and start over' }));
    await waitFor(() => expect(deletedPath).toBe(`/api/mailboxes/${MAILBOX_ID}`));
  });

  it('offers Sign out that actually calls the logout endpoint', async () => {
    let loggedOut = false;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/auth/logout',
        respond: () => {
          loggedOut = true;
          return jsonOk({ ok: true });
        },
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SyncGate status={FAILED} mailboxId={MAILBOX_ID} />
      </QueryWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(loggedOut).toBe(true));
  });

  it('disables disconnect when the watched mailbox id is unknown', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SyncGate status={FAILED} />
      </QueryWrapper>,
    );
    expect(screen.getByRole('button', { name: 'Disconnect and start over' })).toBeDisabled();
    // Sign out never needs an id — the session is the subject.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('the SECONDARY gate keeps its hop and gains neither exit', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <SyncGate
          status={FAILED}
          mailboxId="mb-secondary-0000-0000-000000000002"
          escape={{ returnToEmail: 'primary@example.com', onReturn: () => undefined }}
        />
      </QueryWrapper>,
    );
    expect(screen.getByRole('button', { name: 'Go back to primary@example.com' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Disconnect and start over' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});
