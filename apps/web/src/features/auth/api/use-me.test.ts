/**
 * Tests for `meHasSyncingMailbox` — the predicate that drives `me`
 * polling while a mailbox finishes its initial sync (D116). Polling is
 * what lets the account-switcher badge + ready-toast update without a
 * manual refresh; it must stop once every mailbox is terminal.
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

  it('false when every mailbox is terminal (ready/failed/null)', () => {
    expect(
      meHasSyncingMailbox(
        me([
          { status: 'active', readiness: 'ready' },
          { status: 'active', readiness: 'failed' },
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
