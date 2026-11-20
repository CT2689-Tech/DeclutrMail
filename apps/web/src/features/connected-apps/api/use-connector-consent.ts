'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ConnectorConsentResultSchema,
  ConnectorConsentSchema,
  type ConnectorConsent,
} from '@declutrmail/shared/contracts';

import { ApiError, apiGet, apiPost } from '@/lib/api/client';
import { returningSignInPath } from '@/lib/api/returning-sign-in';
import { resetIdentity } from '@/lib/posthog';
import { connectorConsentQueryOptions } from './query-options';

/** Thrown when the API answered 200 with a body this client cannot read. */
export class ConnectorConsentPayloadError extends Error {}

const requestPath = (requestId: string) =>
  `/api/oauth/interactions/${encodeURIComponent(requestId)}`;

/** A 4xx is a designed state and an unreadable body is deterministic: neither improves on retry. */
function isSettled(error: unknown): boolean {
  return (
    error instanceof ConnectorConsentPayloadError ||
    (error instanceof ApiError && error.status >= 400 && error.status < 500)
  );
}

/**
 * What the consent page shows. A signed-out visitor's 401 is handled by
 * the API client: it sends them through sign-in and back to this URL.
 * A 4xx is a designed state (expired, unavailable) and is never retried.
 */
export function useConnectorConsent(requestId: string | null) {
  return useQuery({
    ...connectorConsentQueryOptions(requestId ?? '', async (signal): Promise<ConnectorConsent> => {
      const envelope = await apiGet<unknown>(`${requestPath(requestId ?? '')}/details`, { signal });
      const parsed = ConnectorConsentSchema.safeParse(envelope.data);
      if (!parsed.success) throw new ConnectorConsentPayloadError();
      return parsed.data;
    }),
    enabled: requestId !== null,
    retry: (failureCount, error) => !isSettled(error) && failureCount < 2,
    refetchOnWindowFocus: false,
  });
}

/** Approve or Deny. Resolves to the URL the browser must go to next. */
export function useDecideConnectorConsent(requestId: string | null) {
  return useMutation({
    mutationFn: async (decision: 'approve' | 'deny'): Promise<string> => {
      const envelope = await apiPost<unknown>(`${requestPath(requestId ?? '')}/${decision}`, {});
      const parsed = ConnectorConsentResultSchema.safeParse(envelope.data);
      if (!parsed.success) throw new ConnectorConsentPayloadError();
      return parsed.data.redirectTo;
    },
  });
}

/**
 * Sign out, then sign in again (Google asks which account) and come back
 * to this same request. The pending request survives: it lives in the
 * authorization server's own cookie, which sign-out does not touch.
 * Signing in replaces the session even if the sign-out call failed, so
 * the browser moves on either way.
 */
export function useSwitchAccount() {
  return useMutation({
    mutationFn: async () => {
      await apiPost<unknown>('/api/auth/logout', undefined, { suppressAuthRedirect: true });
    },
    onSettled: () => {
      void resetIdentity().catch(() => undefined);
      window.location.assign(returningSignInPath());
    },
  });
}
