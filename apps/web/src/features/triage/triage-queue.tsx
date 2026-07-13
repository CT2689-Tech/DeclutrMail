'use client';

import { tokens } from '@declutrmail/shared';
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import type { PreviewCount } from './action-preview';
import type { TriageDecisionRow } from './data';
import { planQueueItems, type DomainBatch } from './domain-batch';
import { DomainBatchCard, type BatchVerb } from './domain-batch-card';
import { TriageRow } from './triage-row';
import { useTriageStore } from './store';
import type { ActionVerb } from './types';
import { WhyNoDelete } from './why-no-delete';

const { color, font } = tokens;

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
 * The queue itself is just a vertical list with the collapse/expand
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
  busyRowId = null,
  previewInboxCount = 'loading',
  onBatchVerb,
  batchBusyDomain = null,
}: {
  rows: readonly TriageDecisionRow[];
  /** Dispatched when a row's toolbar fires K/A/U/L. */
  onAction: (verb: ActionVerb, row: TriageDecisionRow) => void;
  /**
   * Row whose decision is confirming server-side (D226 — the row
   * stays in the queue, rendered busy, until the server confirms and
   * the refetch drops it). `null` when nothing is in flight.
   */
  busyRowId?: string | null;
  /** Live inbox count for the inline preview's impact figure (D226). */
  previewInboxCount?: PreviewCount;
  /** A domain-batch card asked for `verb` — the screen opens the batch sheet. */
  onBatchVerb?: (verb: BatchVerb, batch: DomainBatch) => void;
  /** Domain whose batch decision is confirming server-side. */
  batchBusyDomain?: string | null;
}) {
  const expandedRowId = useTriageStore((s) => s.expandedRowId);
  const toggleExpandedRow = useTriageStore((s) => s.toggleExpandedRow);
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const dismissedBatchDomains = useTriageStore((s) => s.dismissedBatchDomains);
  const dismissBatchDomain = useTriageStore((s) => s.dismissBatchDomain);

  const items = planQueueItems(rows, dismissedBatchDomains);
  // D26 — the first SINGLE row is the hero card (inline reasoning).
  // When a batch card leads the queue, there is no hero: the batch is
  // a different decision shape and carries its own framing.
  const heroRowId = items[0]?.kind === 'row' ? items[0].row.id : null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            fontWeight: 600,
            color: color.fgMuted,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {rows.length} decisions waiting
        </span>
        <span
          style={{
            fontSize: 11.5,
            color: color.fgMuted,
            fontFamily: font.mono,
          }}
        >
          K · A · U · L
        </span>
      </div>
      <div
        role="list"
        aria-label="Triage queue"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {items.map((item) => {
          if (item.kind === 'batch') {
            const batch = item.batch;
            return (
              <div key={`batch-${batch.domain}`} role="listitem">
                <DomainBatchCard
                  batch={batch}
                  busy={batchBusyDomain === batch.domain}
                  disabled={
                    busyRowId != null ||
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
          // Inline preview only renders for the row whose pending
          // action is mounted inline (D34 remember-preference path).
          const inlinePreview =
            pendingAction != null &&
            pendingAction.rowId === row.id &&
            pendingAction.surface === 'inline'
              ? {
                  verb: pendingAction.verb,
                  // The remembered-inline path has no backlog toggle, so
                  // it must retain the safe no-secondary default.
                  archiveHistoric: false,
                  inboxCount: previewInboxCount,
                }
              : null;
          return (
            <div key={row.id} role="listitem">
              <TriageRow
                row={row}
                expanded={expanded}
                busy={busyRowId === row.id}
                hero={heroRowId === row.id}
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
      {/* Founder-ratified: Delete is not a Triage verb — say where it
          lives so the four-verb toolbar never reads as a gap. */}
      <div style={{ marginTop: 10 }}>
        <WhyNoDelete />
      </div>
    </div>
  );
}
