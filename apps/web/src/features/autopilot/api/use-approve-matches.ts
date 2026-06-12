/**
 * `useApproveMatches` — mutation hook for D104 "Approve selected"
 * (`POST /api/autopilot/matches/approve`).
 *
 * On success, invalidates the pending-suggestions buffer (approved
 * rows leave the pending list) and the rules list (last-run figures
 * update once the sweep executes). The BE is idempotent — replays
 * return `approvedCount=0` + `alreadyResolvedCount`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postApproveMatches } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useApproveMatches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchIds: string[]) => postApproveMatches({ matchIds }).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
    },
  });
}
