'use client';

import { tokens } from '@declutrmail/shared';
import type { ReactNode } from 'react';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import type { PreviewCount } from './action-preview';
import {
  ActionPreviewDetailBlock,
  actionMovesMail,
  type ActionPreviewDetail,
} from './action-preview-detail';
import type { TriageDecisionRow } from './data';
import { planQueueItems, type DomainBatch } from './domain-batch';
import { DomainBatchCard, type BatchVerb } from './domain-batch-card';
import { TriageRow } from './triage-row';
import { UnprotectButton } from './unprotect-button';
import type { InlinePreview } from './inline-preview';
import { useTriageStore, type PendingAction } from './store';
import type { ActionVerb } from './types';

const { color } = tokens;

/**
 * The D34 inline preview for `rowId`, or null. Only the row whose
 * pending action is mounted inline gets one. Shared by the list and the
 * focus card so both state the same preview.
 *
 * Built here rather than inside `TriageRow`: the public inbox simulator
 * imports that module, so an import of the detail block there lands in
 * its route chunk.
 */
export function inlinePreviewFor(
  rowId: string,
  pendingAction: PendingAction | null,
  preview: {
    inboxCount: PreviewCount;
    detail: ActionPreviewDetail | undefined;
    quotaRemaining: number | null | undefined;
  },
): InlinePreview | null {
  if (pendingAction == null || pendingAction.rowId !== rowId || pendingAction.surface !== 'inline')
    return null;
  return {
    verb: pendingAction.verb,
    // The remembered-inline path has no backlog toggle, so it must
    // retain the safe no-secondary default.
    archiveHistoric: false,
    inboxCount: preview.inboxCount,
    wakeAt: pendingAction.wakeAt,
    quotaRemaining: preview.quotaRemaining,
    detailSlot:
      preview.detail !== undefined && actionMovesMail(pendingAction.verb, false) ? (
        <ActionPreviewDetailBlock detail={preview.detail} />
      ) : undefined,
  };
}

/** Stable empty default for `busyRowIds` — a fresh `new Set()` per render would defeat memoized rows. */
const NO_BUSY_ROWS: ReadonlySet<string> = new Set();

/**
 * The triage queue list (D29, D36).
 *
 * Per D32 there are NO bulk operations in Triage — every action is
 * per-row, dispatched via the row's toolbar. The one scoped exception
 * is the domain-batch card: when ≥3 CONSECUTIVE rows share a
 * registrable domain, the run collapses into a single "decide
 * together?" card (one composite decision through the same D226
 * preview path — see `domain-batch.ts`). It is additive: "Decide one
 * by one" dismisses it back to normal rows. No multi-select, no
 * checkboxes.
 *
 * The queue itself is just a hairline-separated list with the collapse/expand
 * accordion behaviour from the shared `useExpandableRow` semantics
 * (D198 — pure reducer tested in `packages/shared`) hoisted into the
 * feature store so the action sheet can read which row is focused.
 *
 * Rendering ordering is decided by the caller — the engine in
 * production sorts by impact + verdict; fixtures just preserve the
 * `TRIAGE_QUEUE` order.
 */
export function TriageQueue({
  rows,
  onAction,
  busyRowIds = NO_BUSY_ROWS,
  previewInboxCount = 'loading',
  previewDetail,
  previewQuotaRemaining,
  allowBatching = true,
  offerUnprotect = false,
  onBatchVerb,
  batchBusyDomain = null,
  leading,
}: {
  rows: readonly TriageDecisionRow[];
  /** Dispatched when a row's toolbar fires K/A/U/L/D. */
  onAction: (verb: ActionVerb, row: TriageDecisionRow) => void;
  /**
   * Rows whose decisions are confirming server-side or parked overdue
   * (D226 — a row stays in the queue, rendered busy, until the server
   * confirms and the refetch drops it). A set, not one id: the overdue
   * parking slot lets a next decision start while a parked one still
   * runs, so several rows can be busy at once.
   */
  busyRowIds?: ReadonlySet<string>;
  /** Live inbox count for the inline preview's impact figure (D226). */
  previewInboxCount?: PreviewCount;
  /** D226 verification detail, shared with the sheet path. */
  previewDetail?: ActionPreviewDetail | undefined;
  /** Cleanup allowance — independent of the preview, see `ActionSheet`. */
  previewQuotaRemaining?: number | null | undefined;
  /** Disable multi-sender shortcuts for finite guided sessions. */
  allowBatching?: boolean;
  /** Show a direct Unprotect control on Protected rows (D245 review). */
  offerUnprotect?: boolean;
  /** A domain-batch card asked for `verb` — the screen opens the batch sheet. */
  onBatchVerb?: (verb: BatchVerb, batch: DomainBatch) => void;
  /** Domain whose batch decision is confirming server-side. */
  batchBusyDomain?: string | null;
  /** Rendered as the list's first item — the same-verdict batch offer. */
  leading?: ReactNode;
}) {
  const expandedRowId = useTriageStore((s) => s.expandedRowId);
  const toggleExpandedRow = useTriageStore((s) => s.toggleExpandedRow);
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const dismissedBatchDomains = useTriageStore((s) => s.dismissedBatchDomains);
  const dismissBatchDomain = useTriageStore((s) => s.dismissBatchDomain);

  const items = allowBatching
    ? planQueueItems(rows, dismissedBatchDomains)
    : rows.map((row) => ({ kind: 'row' as const, row }));
  return (
    <div
      role="list"
      aria-label="Triage queue"
      style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${color.lineSoft}` }}
    >
      {leading != null && <div role="listitem">{leading}</div>}
      {items.map((item) => {
        if (item.kind === 'batch') {
          const batch = item.batch;
          return (
            <div key={`batch-${batch.domain}`} role="listitem">
              <DomainBatchCard
                batch={batch}
                busy={batchBusyDomain === batch.domain}
                disabled={
                  busyRowIds.size > 0 ||
                  (batchBusyDomain != null && batchBusyDomain !== batch.domain)
                }
                onVerb={(verb) => onBatchVerb?.(verb, batch)}
                onDismiss={() => dismissBatchDomain(batch.domain)}
              />
            </div>
          );
        }
        const row = item.row;
        const expanded = expandedRowId === row.id;
        const inlinePreview = inlinePreviewFor(row.id, pendingAction, {
          inboxCount: previewInboxCount,
          detail: previewDetail,
          quotaRemaining: previewQuotaRemaining,
        });
        return (
          <div key={row.id} role="listitem">
            <TriageRow
              row={row}
              expanded={expanded}
              busy={busyRowIds.has(row.id)}
              offerUnprotect={offerUnprotect}
              // Constructed here (not inside TriageRow) so the row
              // component never imports UnprotectButton — and with it
              // the sender-policy mutation and the API client it calls
              // — directly. `surface` names which control this ends up
              // rendering as: the D245 review's row strip when
              // `offerUnprotect`, else the inline preview's notice.
              unprotectSlot={
                row.protectionReason == null ? undefined : (
                  <UnprotectButton
                    row={row}
                    surface={offerUnprotect ? 'onboarding-review' : 'triage-preview'}
                  />
                )
              }
              onToggleExpand={() => toggleExpandedRow(row.id)}
              onAction={(verb) => onAction(verb, row)}
              inlinePreview={inlinePreview}
              inlinePreviewAccountContext={
                inlinePreview == null ? undefined : <MailboxActionContext />
              }
            />
          </div>
        );
      })}
    </div>
  );
}
