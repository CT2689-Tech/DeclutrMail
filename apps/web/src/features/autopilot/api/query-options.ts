import { queryOptions } from '@tanstack/react-query';

import type {
  AutopilotMatchDto,
  AutopilotPatternSuggestionDto,
  AutopilotRuleDto,
} from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

type AutopilotReader<T> = (signal: AbortSignal) => Promise<T>;

export function autopilotRulesQueryOptions(reader: AutopilotReader<AutopilotRuleDto[]>) {
  return queryOptions({
    queryKey: autopilotKeys.rules(),
    queryFn: ({ signal }) => reader(signal),
  });
}

export function pendingSuggestionsQueryOptions(reader: AutopilotReader<AutopilotMatchDto[]>) {
  return queryOptions({
    queryKey: autopilotKeys.pendingSuggestions(),
    queryFn: ({ signal }) => reader(signal),
  });
}

export function patternSuggestionQueryOptions(
  reader: AutopilotReader<AutopilotPatternSuggestionDto | null>,
) {
  return queryOptions({
    queryKey: autopilotKeys.patternSuggestion(),
    queryFn: ({ signal }) => reader(signal),
  });
}
