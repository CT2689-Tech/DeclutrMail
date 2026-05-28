'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';
import type { SyncReadiness } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';

/**
 * Fires a one-time success toast when a mailbox finishes its initial
 * sync (readiness → `ready`) while the user is already in the app
 * (D116). This is the in-app half of the "we'll let you know when B is
 * ready" promise the sync-gate escape hatch makes.
 *
 * Mounted once in the app shell. Relies on `useMe` polling while a sync
 * is in flight (see `meHasSyncingMailbox`) so the transition is
 * actually observed. Only TRANSITIONS are announced — a mailbox already
 * `ready` at mount is recorded silently, so a page load never spams
 * "ready" toasts for long-since-synced mailboxes.
 */
export function useMailboxSyncToasts(): void {
  const { me } = useAuth();
  const seen = useRef<Map<string, SyncReadiness | null>>(new Map());

  useEffect(() => {
    for (const mailbox of me.mailboxes) {
      const before = seen.current.get(mailbox.id);
      const becameReady =
        before !== undefined && before !== 'ready' && mailbox.readiness === 'ready';
      if (becameReady) {
        toast(`${mailbox.email} is ready.`, 'success');
      }
      seen.current.set(mailbox.id, mailbox.readiness);
    }
  }, [me.mailboxes]);
}
