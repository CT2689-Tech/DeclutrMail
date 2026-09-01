/**
 * Tests for `meHasSyncingMailbox` — the predicate that drives `me`
 * polling while a mailbox finishes its initial sync (D116). Polling is
 * what lets the account-switcher badge + ready-toast update without a
 * manual refresh; it stops once every mailbox is `ready` or has no sync
 * row at all.
 *
 * QA-sync-20260831-05: `failed` is deliberately NOT terminal for this
 * predicate (unlike `ready`/`null`) — a failed mailbox may recover via a
 * retry or the server-side `cursorTooOld` recovery, and without a live
 * poll the app would only notice on the next window focus or reload.
 */

import { describe, expect, it } from 'vitest';
import type { SyncReadiness } from '@declutrmail/shared/contracts';
import { meHasDataDeletionInFlight, meHasSyncingMailbox, type Me } from './use-me';

function me(
  mailboxes: Array<{ status: 'active' | 'disconnected'; readiness: SyncReadiness | null }>,
): Me {
  return {
    user: { id: 'u', email: 'u@example.com', workspaceId: 'w', timezone: null },
    activeMailboxId: null,
    tier: 'free',
    cleanupRemaining: 5,
    mailboxes: mailboxes.map((m, i) => ({
      id: `m${i}`,
      email: `m${i}@example.com`,
      connectedAt: null,
      ...m,
    })),
  };
}

describe('meHasSyncingMailbox', () => {
  it('true when an active mailbox is queued or syncing', () => {
    expect(meHasSyncingMailbox(me([{ status: 'active', readiness: 'syncing' }]))).toBe(true);
    expect(meHasSyncingMailbox(me([{ status: 'active', readiness: 'queued' }]))).toBe(true);
  });

  it('true when an active mailbox has failed — it may still recover without a reload (QA-sync-20260831-05)', () => {
    // The negative control: reverting `SYNCING_READINESS` to its original
    // `['queued', 'syncing']` makes this assertion fail — a failed
    // mailbox that recovers (a retry succeeds, or a second failure
    // occurs) would go unnoticed until the next window focus or reload.
    expect(meHasSyncingMailbox(me([{ status: 'active', readiness: 'failed' }]))).toBe(true);
  });

  it('false when every mailbox is genuinely terminal (ready/null)', () => {
    expect(
      meHasSyncingMailbox(
        me([
          { status: 'active', readiness: 'ready' },
          { status: 'active', readiness: null },
        ]),
      ),
    ).toBe(false);
  });

  it('ignores a disconnected mailbox even if its readiness is non-terminal', () => {
    expect(meHasSyncingMailbox(me([{ status: 'disconnected', readiness: 'syncing' }]))).toBe(false);
  });

  it('false for undefined data', () => {
    expect(meHasSyncingMailbox(undefined)).toBe(false);
  });
});

describe('meHasDataDeletionInFlight', () => {
  it('polls queued, executing, and delayed mailbox-data deletion lifecycles', () => {
    for (const indexedDataState of ['deletion_pending', 'deleting', 'deletion_delayed'] as const) {
      const data = me([{ status: 'disconnected', readiness: null }]);
      data.mailboxes[0]!.indexedDataState = indexedDataState;
      expect(meHasDataDeletionInFlight(data)).toBe(true);
    }
  });

  it('stops polling after deletion completes', () => {
    const data = me([{ status: 'disconnected', readiness: null }]);
    data.mailboxes[0]!.indexedDataState = 'deleted';
    expect(meHasDataDeletionInFlight(data)).toBe(false);
  });
});
