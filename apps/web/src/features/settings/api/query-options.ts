import { queryOptions } from '@tanstack/react-query';
import type { MeSettings } from '@declutrmail/shared/contracts';

export const ME_SETTINGS_QUERY_KEY = ['me-settings'] as const;

type MeSettingsReader = (signal: AbortSignal) => Promise<MeSettings>;

export function meSettingsQueryOptions(reader: MeSettingsReader) {
  return queryOptions({
    queryKey: ME_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 60_000,
  });
}
