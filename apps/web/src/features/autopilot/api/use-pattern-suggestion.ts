import { useQuery } from '@tanstack/react-query';
import { fetchPatternSuggestion } from '@/lib/api/autopilot';
import { patternSuggestionQueryOptions } from './query-options';

export function usePatternSuggestion() {
  return useQuery(
    patternSuggestionQueryOptions((signal) =>
      fetchPatternSuggestion(signal).then((env) => env.data),
    ),
  );
}
