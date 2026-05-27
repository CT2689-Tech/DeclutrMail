/**
 * `usePauseAll` — mutation hook for D105 master pause.
 *
 * On success, invalidates BOTH the rules list and the pending-
 * suggestions buffer. Pausing all rules stops fresh matches from
 * landing in the pending list, so the read should refetch in case any
 * background queries observed the buffer just before the flip.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postPauseAll } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function usePauseAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postPauseAll().then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
    },
  });
}
