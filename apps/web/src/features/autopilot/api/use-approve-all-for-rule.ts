/**
 * `useApproveAllForRule` — mutation hook for D104 "Approve all"
 * (`POST /api/autopilot/rules/:id/approve-all`).
 *
 * Approves every pending Observe-mode suggestion for one rule. Does
 * NOT change the rule's mode — activation is a separate, explicit
 * PATCH (no auto-promote, per the locked D10/D104 safe variant).
 * Invalidation mirrors `useApproveMatches`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postApproveAllForRule } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useApproveAllForRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => postApproveAllForRule(ruleId).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
    },
  });
}
