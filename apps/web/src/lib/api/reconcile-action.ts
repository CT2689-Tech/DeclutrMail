import type { QueryClient } from '@tanstack/react-query';
import { sendersKeys } from '@/features/senders/api/query-keys';
import { activityKeys } from '@/features/activity/api/query-keys';
import { undoKeys } from '@/features/undo/query-keys';

const reconciled = new WeakMap<QueryClient, WeakSet<object>>();

/** Reconcile each shared terminal snapshot once, including failures and Undo. */
export function reconcileAction(client: QueryClient, snapshot: object, actionId?: string): void {
  let seen = reconciled.get(client);
  if (!seen) {
    seen = new WeakSet();
    reconciled.set(client, seen);
  }
  if (seen.has(snapshot)) return;
  seen.add(snapshot);

  // Scope only when this session retains the actual enqueue variables.
  // Recovered/Undo/bulk handles may affect an unknown set: keep broad safety.
  const mutation = actionId
    ? client
        .getMutationCache()
        .getAll()
        .find((entry) => {
          const data = entry.state.data as
            { actionId?: unknown; secondaryId?: unknown } | undefined;
          return data?.actionId === actionId || data?.secondaryId === actionId;
        })
    : undefined;
  const senderId = (mutation?.state.variables as { senderId?: unknown } | undefined)?.senderId;
  if (typeof senderId === 'string' && senderId.length > 0) {
    void client.invalidateQueries({ queryKey: ['senders', 'list'] });
    void client.invalidateQueries({ queryKey: ['senders', 'summary'] });
    void client.invalidateQueries({ queryKey: sendersKeys.detail(senderId) });
  } else {
    void client.invalidateQueries({ queryKey: sendersKeys.all });
  }
  void client.invalidateQueries({ queryKey: undoKeys.all });
  void client.invalidateQueries({ queryKey: activityKeys.all });
  void client.invalidateQueries({ queryKey: ['composite-preview'] });
  void client.invalidateQueries({ queryKey: ['bulk-action-preview'] });
}
