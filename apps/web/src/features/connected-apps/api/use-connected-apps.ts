'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConnectedAppsSchema, type ConnectedApps } from '@declutrmail/shared/contracts';

import { ApiError, apiDelete, apiGet } from '@/lib/api/client';
import { CONNECTED_APPS_QUERY_KEY, connectedAppsQueryOptions } from './query-options';

/** Thrown when the API answered 200 with a body this client cannot read. */
export class ConnectedAppsPayloadError extends Error {}

/** A 4xx is a designed state and an unreadable body is deterministic: neither improves on retry. */
function isSettled(error: unknown): boolean {
  return (
    error instanceof ConnectedAppsPayloadError ||
    (error instanceof ApiError && error.status >= 400 && error.status < 500)
  );
}

/**
 * Settings → Connected apps list.
 *
 * A 404 is a designed state, not a failure: the connector is switched
 * off for this deployment (or this web build is ahead of its API), and
 * the section renders nothing. It is never retried.
 */
export function useConnectedApps() {
  return useQuery({
    ...connectedAppsQueryOptions(async (signal): Promise<ConnectedApps> => {
      const envelope = await apiGet<unknown>('/api/oauth/grants', { signal });
      const parsed = ConnectedAppsSchema.safeParse(envelope.data);
      if (!parsed.success) throw new ConnectedAppsPayloadError();
      return parsed.data;
    }),
    retry: (failureCount, error) => !isSettled(error) && failureCount < 2,
  });
}

/** True when the connector is not available on this deployment. */
export function isConnectorUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Disconnect one app: revokes its grant and every token under it. */
export function useDisconnectApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string): Promise<string> => {
      await apiDelete<{ id: string }>(`/api/oauth/grants/${encodeURIComponent(grantId)}`);
      return grantId;
    },
    onSuccess: (grantId) => {
      queryClient.setQueryData<ConnectedApps>(CONNECTED_APPS_QUERY_KEY, (current) =>
        current ? { apps: current.apps.filter((app) => app.id !== grantId) } : current,
      );
    },
    // The server may have revoked it before the response was lost; read
    // the truth back instead of guessing.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_QUERY_KEY }),
  });
}
