'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionPreviewViewSchema, type ActionPreviewView } from '@declutrmail/shared/contracts';

import { ApiError, apiGet, apiPost } from '@/lib/api/client';
import { actionPreviewQueryOptions } from './query-options';

/** Thrown when the API answered 200 with a body this client cannot read. */
export class ActionPreviewPayloadError extends Error {}

const previewPath = (previewId: string) => `/api/action-previews/${encodeURIComponent(previewId)}`;

function readView(data: unknown): ActionPreviewView {
  const parsed = ActionPreviewViewSchema.safeParse(data);
  if (!parsed.success) throw new ActionPreviewPayloadError();
  return parsed.data;
}

/** A 4xx is a designed state and an unreadable body is deterministic: neither improves on retry. */
function isSettled(error: unknown): boolean {
  return (
    error instanceof ActionPreviewPayloadError ||
    (error instanceof ApiError && error.status >= 400 && error.status < 500)
  );
}

/**
 * What an assistant asked for, as the confirm page shows it. A
 * signed-out visitor's 401 is handled by the API client: it sends them
 * through sign-in and back to this URL.
 */
export function useActionPreview(previewId: string | null) {
  return useQuery({
    ...actionPreviewQueryOptions(previewId ?? '', async (signal) =>
      readView((await apiGet<unknown>(previewPath(previewId ?? ''), { signal })).data),
    ),
    enabled: previewId !== null,
    retry: (failureCount, error) => !isSettled(error) && failureCount < 2,
    refetchOnWindowFocus: false,
  });
}

/**
 * The person pressed the verb. Never retried on its own: a confirmation
 * is sent because someone pressed, once per press. The answer replaces
 * the cached preview, so the page shows what the server recorded. A
 * press that failed may still have been recorded (it started, then a
 * later step failed), so the page reads the request again rather than
 * keep what it held at load.
 */
export function useConfirmActionPreview(previewId: string | null) {
  const queryClient = useQueryClient();
  const { queryKey } = actionPreviewQueryOptions(previewId ?? '');
  return useMutation({
    retry: false,
    // This page says why a plan or limit stopped the press, and it sits
    // outside the app; the app's upgrade dialog would open later, out of
    // context, on whatever page the person visits next.
    meta: { upgradeGate: false },
    mutationFn: async (): Promise<ActionPreviewView> =>
      readView((await apiPost<unknown>(`${previewPath(previewId ?? '')}/confirm`, {})).data),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey, view);
    },
    onError: (error) => {
      // Signed out: the API client is already on its way to sign-in.
      if (error instanceof ApiError && error.status === 401) return;
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
