/**
 * `useDismissMatch` — mutation hook for D104 dismiss-suggestion.
 *
 * On success, invalidates the pending-suggestions query so the row
 * disappears from the list. The BE handles idempotency + cross-tenant
 * 404s; the hook does not retry on error so the user sees the failure
 * (Sentry catches it via the global error capture).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postDismissMatch } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useDismissMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => postDismissMatch(matchId).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
    },
  });
}
