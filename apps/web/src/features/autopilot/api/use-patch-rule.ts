/**
 * `usePatchRule` — mutation hook for `PATCH /api/autopilot/rules/:id`
 * (D101 enabled toggle + threshold, D10/D105 mode changes).
 *
 * On success, invalidates the rules list (mode / enabled / threshold
 * all render there) AND the pending-suggestions buffer — disabling or
 * pausing a rule stops fresh matches, and activating one changes what
 * the day-7 banner shows.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patchAutopilotRule, type AutopilotRulePatchDto } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function usePatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, patch }: { ruleId: string; patch: AutopilotRulePatchDto }) =>
      patchAutopilotRule(ruleId, patch).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
    },
  });
}
