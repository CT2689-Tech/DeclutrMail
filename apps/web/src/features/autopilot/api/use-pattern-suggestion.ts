import { useQuery } from '@tanstack/react-query';
import { fetchPatternSuggestion } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function usePatternSuggestion() {
  return useQuery({
    queryKey: autopilotKeys.patternSuggestion(),
    queryFn: ({ signal }) => fetchPatternSuggestion(signal).then((env) => env.data),
  });
}
