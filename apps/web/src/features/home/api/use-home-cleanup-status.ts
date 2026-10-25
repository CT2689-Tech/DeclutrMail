import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActionFeedbackStore } from '@/features/undo/feedback-store';
import { undoKeys } from '@/features/undo/query-keys';
import type { InFlightActionGroup } from '@/lib/api/actions';
import type { HomeCleanupStatus } from '../home-orientation';

/** Observe the shared tray's mailbox-scoped truth without another poller or lifecycle owner. */
export function useHomeCleanupStatus(mailboxId: string | null): HomeCleanupStatus {
  const client = useQueryClient();
  const accepted = useActionFeedbackStore((state) =>
    mailboxId ? (state.scopes[mailboxId]?.length ?? 0) > 0 : false,
  );
  const subscribe = useCallback(
    (changed: () => void) => client.getQueryCache().subscribe(changed),
    [client],
  );
  const snapshot = useCallback((): HomeCleanupStatus => {
    if (!mailboxId) return null;
    const query = client.getQueryState<InFlightActionGroup[]>(undoKeys.inFlight(mailboxId));
    const running = query?.data?.some((group) => group.running !== false) ?? false;
    if (query?.status === 'error') return 'unknown';
    if (running) return 'running';
    if (accepted) return 'unknown';
    return query?.status === 'success' ? 'idle' : null;
  }, [client, mailboxId, accepted]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
