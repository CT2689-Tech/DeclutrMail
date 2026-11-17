import { queryOptions } from '@tanstack/react-query';
import type { ConnectedApps, ConnectorConsent } from '@declutrmail/shared/contracts';

export const CONNECTED_APPS_QUERY_KEY = ['connected-apps'] as const;

type Reader<T> = (signal: AbortSignal) => Promise<T>;

export function connectedAppsQueryOptions(reader: Reader<ConnectedApps>) {
  return queryOptions({
    queryKey: CONNECTED_APPS_QUERY_KEY,
    queryFn: ({ signal }) => reader(signal),
    staleTime: 30_000,
  });
}

export function connectorConsentQueryOptions(requestId: string, reader: Reader<ConnectorConsent>) {
  return queryOptions({
    queryKey: ['connector-consent', requestId] as const,
    queryFn: ({ signal }) => reader(signal),
    // A pending request is decided once; never serve it from cache.
    staleTime: 0,
    gcTime: 0,
  });
}
