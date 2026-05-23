'use client';

import { tokens } from '@declutrmail/shared';
import type { TriageDecisionRow } from './data';
import { TriageRow } from './triage-row';
import { useTriageStore } from './store';
import type { ActionVerb } from './types';

const { color, font } = tokens;

/**
 * The triage queue list (D29, D36).
 *
 * Per D32 there are NO bulk operations in Triage — every action is
 * per-row, dispatched via the row's toolbar. The queue itself is just
 * a vertical list with the collapse/expand accordion behaviour from
 * the shared `useExpandableRow` semantics (D198 — pure reducer
 * tested in `packages/shared`) hoisted into the feature store so the
 * action sheet can read which row is focused.
 *
 * Rendering ordering is decided by the caller — the engine in
 * production sorts by impact + verdict; fixtures just preserve the
 * `TRIAGE_QUEUE` order.
 */
export function TriageQueue({
  rows,
  onAction,
}: {
  rows: readonly TriageDecisionRow[];
  /** Dispatched when a row's toolbar fires K/A/U/L. */
  onAction: (verb: ActionVerb, row: TriageDecisionRow) => void;
}) {
  const expandedRowId = useTriageStore((s) => s.expandedRowId);
  const toggleExpandedRow = useTriageStore((s) => s.toggleExpandedRow);
  const pendingAction = useTriageStore((s) => s.pendingAction);

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
        {rows.map((row) => {
          const expanded = expandedRowId === row.id;
          // Inline preview only renders for the row whose pending
          // action is mounted inline (D34 remember-preference path).
          const inlinePreview =
            pendingAction != null &&
            pendingAction.rowId === row.id &&
            pendingAction.surface === 'inline'
              ? { verb: pendingAction.verb, archiveHistoric: pendingAction.verb === 'Unsubscribe' }
              : null;
          return (
            <div key={row.id} role="listitem">
              <TriageRow
                row={row}
                expanded={expanded}
                onToggleExpand={() => toggleExpandedRow(row.id)}
                onAction={(verb) => onAction(verb, row)}
                inlinePreview={inlinePreview}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
