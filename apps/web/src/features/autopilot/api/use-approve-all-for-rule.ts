/**
 * `useApproveAllForRule` — mutation hook for D104 "Approve all"
 * (`POST /api/autopilot/rules/:id/approve-all`).
 *
 * Approves every offerable Observe-mode suggestion for one rule within
 * `scope`. Does NOT change the rule's mode — activation is a separate,
 * explicit PATCH (no auto-promote, per the locked D10/D104 safe
 * variant). Invalidation mirrors `useApproveMatches`.
 *
 * `scope` is REQUIRED (founder decision 2026-09-29 (a)) — see
 * `postApproveAllForRule`'s comment.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postApproveAllForRule, type AutopilotApproveAllScopeDto } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useApproveAllForRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, scope }: { ruleId: string; scope: AutopilotApproveAllScopeDto }) =>
      postApproveAllForRule(ruleId, scope).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
    },
  });
}
