'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@declutrmail/shared';
import {
  getRulePreviewSenders,
  type AutopilotPreviewSenderPageDto,
  type AutopilotRulePreviewResultDto,
} from '@/lib/api/autopilot';
import { RulePreviewSample } from './rule-preview-panel';
import { apiErrorCode } from '@/lib/api/client';

export type LoadPreviewPage = (
  ruleId: string,
  previewId: string,
  page: number,
) => Promise<AutopilotPreviewSenderPageDto>;
const loadDefaultPage: LoadPreviewPage = (ruleId, previewId, page) =>
  getRulePreviewSenders(ruleId, previewId, page).then((env) => env.data);

/** Mounted anew for each preview id. Only the current 25-row page is rendered. */
export function RulePreviewSenders({
  ruleName,
  result,
  initialPage,
  loadPage = loadDefaultPage,
  expired,
  onExpired,
  onReadyChange,
}: {
  ruleName: string;
  result: AutopilotRulePreviewResultDto;
  initialPage: AutopilotPreviewSenderPageDto;
  loadPage?: LoadPreviewPage | undefined;
  expired: boolean;
  onExpired: () => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [busy, setBusy] = useState(false);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const request = useRef(0);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));
  const goToPage = async (next: number) => {
    if (busy || expired) return;
    onReadyChange(false);
    setBusy(true);
    setFailedPage(null);
    const currentRequest = ++request.current;
    try {
      const nextPage = await loadPage(result.ruleId, initialPage.previewId, next);
      if (currentRequest !== request.current) return;
      setPage(nextPage);
      onReadyChange(true);
      heading.current?.scrollIntoView({ block: 'start' });
    } catch (error) {
      if (currentRequest !== request.current) return;
      if (apiErrorCode(error) === 'AUTOPILOT_PREVIEW_EXPIRED') onExpired();
      else setFailedPage(next);
      heading.current?.scrollIntoView({ block: 'start' });
    } finally {
      if (currentRequest === request.current) setBusy(false);
    }
  };
  return (
    <div aria-busy={busy} ref={heading}>
      {busy && <span role="status">Loading senders…</span>}
      {failedPage != null && !expired && (
        <div role="alert" className="dm-autopilot-page-error">
          <span>Could not load senders. Please retry.</span>
          <Button tone="ghost" size="sm" onClick={() => void goToPage(failedPage)}>
            Retry page
          </Button>
        </div>
      )}
      <RulePreviewSample
        ruleName={ruleName}
        result={{ ...result, sample: page.senders }}
        page={page}
        layout="table"
        controls={
          lastPage > 1 ? (
            <div className="dm-autopilot-page-buttons">
              <Button
                tone="ghost"
                size="sm"
                inert={busy || expired || page.page === 1}
                onClick={() => void goToPage(page.page - 1)}
              >
                Previous
              </Button>
              <Button
                tone="ghost"
                size="sm"
                inert={busy || expired || page.page === lastPage}
                onClick={() => void goToPage(page.page + 1)}
              >
                Next
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
