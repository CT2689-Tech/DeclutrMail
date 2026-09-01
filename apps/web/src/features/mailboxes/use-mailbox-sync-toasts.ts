'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@declutrmail/shared';
import type { SyncReadiness } from '@declutrmail/shared/contracts';

import { useAuth } from '@/features/auth/auth-provider';

/**
 * Fires a one-time toast when a mailbox finishes its initial sync
 * (readiness → `ready`), OR terminally fails (readiness → `failed`),
 * while the user is already in the app (D116). This is the in-app half
 * of the "we'll let you know when B is ready" promise the sync-gate
 * escape hatch makes — QA-sync-20260831-05 found the promise had no
 * failure half at all: `use-sync-funnel.ts`'s own analytics sibling
 * already pairs `ready || failed`, proving the asymmetry here was never
 * deliberate.
 *
 * Mounted once in the app shell. Relies on `useMe` polling while a sync
 * is in flight or has failed (see `meHasSyncingMailbox`) so the
 * transition is actually observed. Only TRANSITIONS are announced — a
 * mailbox already `ready`/`failed` at mount is recorded silently, so a
 * page load never spams toasts for a state that was already true.
 */
export function useMailboxSyncToasts(): void {
  const { me } = useAuth();
  const seen = useRef<Map<string, SyncReadiness | null>>(new Map());

  useEffect(() => {
    for (const mailbox of me.mailboxes) {
      const before = seen.current.get(mailbox.id);
      const becameReady =
        before !== undefined && before !== 'ready' && mailbox.readiness === 'ready';
      const becameFailed =
        before !== undefined && before !== 'failed' && mailbox.readiness === 'failed';
      if (becameReady) {
        toast(`${mailbox.email} is ready.`, 'success');
      } else if (becameFailed) {
        toast(`${mailbox.email}'s scan didn't finish — see Settings to try again.`, 'danger');
      }
      seen.current.set(mailbox.id, mailbox.readiness);
    }
  }, [me.mailboxes]);
}
