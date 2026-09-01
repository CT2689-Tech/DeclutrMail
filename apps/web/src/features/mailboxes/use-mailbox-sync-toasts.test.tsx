/**
 * Tests for `useMailboxSyncToasts` — the in-app "B is ready" toast that
 * fires when a background sync finishes (D116), and (QA-sync-20260831-05)
 * the failure counterpart that fires when one terminally fails. Only
 * TRANSITIONS are announced; a mailbox already `ready`/`failed` at mount
 * stays silent so a page load never spams stale toasts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SyncReadiness } from '@declutrmail/shared/contracts';

const h = vi.hoisted(() => ({
  me: null as unknown,
  toast: vi.fn(),
}));

vi.mock('@declutrmail/shared', () => ({ toast: h.toast }));
vi.mock('@/features/auth/auth-provider', () => ({ useAuth: () => ({ me: h.me }) }));

import { useMailboxSyncToasts } from './use-mailbox-sync-toasts';

function meWith(readiness: SyncReadiness | null) {
  return {
    user: { id: 'u', email: 'u@example.com', workspaceId: 'w' },
    activeMailboxId: null,
    mailboxes: [
      { id: 'b', email: 'b@example.com', status: 'active', connectedAt: null, readiness },
    ],
  };
}

describe('useMailboxSyncToasts', () => {
  beforeEach(() => h.toast.mockClear());

  it('toasts when a mailbox transitions syncing → ready', () => {
    h.me = meWith('syncing');
    const { rerender } = renderHook(() => useMailboxSyncToasts());
    expect(h.toast).not.toHaveBeenCalled();

    h.me = meWith('ready');
    rerender();
    expect(h.toast).toHaveBeenCalledWith('b@example.com is ready.', 'success');
  });

  it('stays silent for a mailbox already ready at mount', () => {
    h.me = meWith('ready');
    renderHook(() => useMailboxSyncToasts());
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('toasts when a mailbox transitions syncing → failed (QA-sync-20260831-05)', () => {
    // The negative control: reverting the `becameFailed` branch makes
    // this assertion fail — a background sync that fails previously
    // produced no in-app signal at all, only the `→ready` half of the
    // D116 promise existed.
    h.me = meWith('syncing');
    const { rerender } = renderHook(() => useMailboxSyncToasts());
    expect(h.toast).not.toHaveBeenCalled();

    h.me = meWith('failed');
    rerender();
    expect(h.toast).toHaveBeenCalledWith(
      "b@example.com's scan didn't finish — see Settings to try again.",
      'danger',
    );
  });

  it('stays silent for a mailbox already failed at mount', () => {
    h.me = meWith('failed');
    renderHook(() => useMailboxSyncToasts());
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('does not double-toast when a failed mailbox stays failed across a re-render', () => {
    h.me = meWith('syncing');
    const { rerender } = renderHook(() => useMailboxSyncToasts());
    h.me = meWith('failed');
    rerender();
    expect(h.toast).toHaveBeenCalledTimes(1);

    h.me = meWith('failed');
    rerender();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });
});
