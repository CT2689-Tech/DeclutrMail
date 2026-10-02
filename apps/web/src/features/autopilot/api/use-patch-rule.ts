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
import { track } from '@/lib/posthog';
import { autopilotKeys } from './query-keys';

export function usePatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, patch }: { ruleId: string; patch: AutopilotRulePatchDto }) =>
      patchAutopilotRule(ruleId, patch).then((env) => env.data),
    onSuccess: (_result, { ruleId, patch }) => {
      if (patch.enabled !== undefined) {
        void track('autopilot_preset_changed', {
          preset_id: ruleId,
          action: patch.enabled ? 'enabled' : 'disabled',
        });
      } else if (patch.mode === 'active') {
        void track('autopilot_preset_changed', { preset_id: ruleId, action: 'activated' });
      } else if (patch.mode === 'observe') {
        void track('autopilot_resumed', { trigger: 'manual' });
      }
      if (patch.confidenceThreshold !== undefined) {
        void track('autopilot_preset_changed', { preset_id: ruleId, action: 'parameter_changed' });
      }
      if (patch.observePromptDismissed === true) {
        void track('autopilot_suggestion_decided', {
          decision: 'rejected',
          suggestion_kind: 'preset_change',
          count: 1,
        });
      }
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.pendingSuggestions() });
    },
  });
}
