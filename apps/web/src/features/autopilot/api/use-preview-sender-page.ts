import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorCode } from '@/lib/api/client';
import { getRulePreviewSenders, type AutopilotPreviewSenderPageDto } from '@/lib/api/autopilot';

export type LoadPreviewPage = (
  ruleId: string,
  previewId: string,
  page: number,
  signal?: AbortSignal,
) => Promise<AutopilotPreviewSenderPageDto>;

const loadDefaultPage: LoadPreviewPage = (ruleId, previewId, page, signal) =>
  getRulePreviewSenders(ruleId, previewId, page, signal).then((env) => env.data);

/** Explicit reads of one immutable preview; retain the last successful page on failure. */
export function usePreviewSenderPage({
  ruleId,
  initialPage,
  loadPage = loadDefaultPage,
  expired,
  onExpired,
  onReadyChange,
  onPageSettled,
}: {
  ruleId: string;
  initialPage: AutopilotPreviewSenderPageDto;
  loadPage?: LoadPreviewPage | undefined;
  expired: boolean;
  onExpired: () => void;
  onReadyChange: (ready: boolean) => void;
  onPageSettled: () => void;
}) {
  const requestedPage = useRef(initialPage.page);
  const request = useRef(0);
  const inFlight = useRef(false);
  const query = useQuery({
    queryKey: ['autopilot', 'preview-senders', ruleId, initialPage.previewId],
    queryFn: ({ signal }) => loadPage(ruleId, initialPage.previewId, requestedPage.current, signal),
    initialData: initialPage,
    // Only user navigation fetches. No focus, reconnect, or background refetch.
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  const goToPage = async (next: number) => {
    if (inFlight.current || expired) return;
    inFlight.current = true;
    requestedPage.current = next;
    onReadyChange(false);
    const currentRequest = ++request.current;
    try {
      await query.refetch({ throwOnError: true });
      if (currentRequest !== request.current) return;
      onReadyChange(true);
    } catch (error) {
      if (currentRequest !== request.current) return;
      if (apiErrorCode(error) === 'AUTOPILOT_PREVIEW_EXPIRED') onExpired();
    } finally {
      if (currentRequest === request.current) {
        inFlight.current = false;
        onPageSettled();
      }
    }
  };
  return {
    page: query.data,
    busy: query.isFetching,
    failedPage: query.isError ? requestedPage.current : null,
    goToPage,
  };
}
