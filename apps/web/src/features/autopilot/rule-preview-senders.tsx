'use client';

import { useRef } from 'react';
import { Button } from '@declutrmail/shared';
import {
  type AutopilotPreviewSenderPageDto,
  type AutopilotRulePreviewResultDto,
} from '@/lib/api/autopilot';
import { RulePreviewSample } from './rule-preview-panel';
import { usePreviewSenderPage, type LoadPreviewPage } from './api/use-preview-sender-page';
export type { LoadPreviewPage } from './api/use-preview-sender-page';

/** Mounted anew for each preview id. Only the current 25-row page is rendered. */
export function RulePreviewSenders({
  ruleName,
  result,
  initialPage,
  loadPage,
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
  const heading = useRef<HTMLDivElement>(null);
  const { page, busy, failedPage, goToPage } = usePreviewSenderPage({
    ruleId: result.ruleId,
    initialPage,
    loadPage,
    expired,
    onExpired,
    onReadyChange,
    onPageSettled: () => heading.current?.scrollIntoView({ block: 'start' }),
  });
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));
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
