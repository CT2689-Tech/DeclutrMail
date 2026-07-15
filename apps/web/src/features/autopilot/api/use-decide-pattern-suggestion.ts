import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postPatternSuggestionDecision } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useDecidePatternSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, decision }: { ruleId: string; decision: 'observe' | 'dismissed' }) =>
      postPatternSuggestionDecision(ruleId, decision).then((env) => env.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.patternSuggestion() });
      void queryClient.invalidateQueries({ queryKey: autopilotKeys.rules() });
    },
  });
}
