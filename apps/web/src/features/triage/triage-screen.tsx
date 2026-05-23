'use client';

import { useCallback } from 'react';
import { Eyebrow, ScreenIntro, tokens, toast } from '@declutrmail/shared';
import { ActionSheet, type ConfirmDetails } from './action-sheet';
import {
  TRIAGE_QUEUE,
  TRIAGE_SESSION_STATS,
  type TriageDecisionRow,
  type TriageScreenState,
} from './data';
import { TriageEmptyState } from './empty-state';
import { useTriageStore, type SheetableVerb } from './store';
import { TriageQueue } from './triage-queue';
import { VERB_PAST, type ActionVerb } from './types';

const { color, font } = tokens;

/**
 * Default state for the Triage screen — fixtures-only at this stage.
 *
 * When the API lands, this gets replaced by a TanStack Query call
 * (D200) returning the same `TriageScreenState` shape. The screen
 * itself doesn't need to change — the loading / empty / ready branches
 * map 1:1 to TanStack's `status` field.
 */
export const DEFAULT_TRIAGE_STATE: TriageScreenState = {
  kind: 'ready',
  rows: [...TRIAGE_QUEUE],
  stats: TRIAGE_SESSION_STATS,
};

/**
 * Triage screen — the V2 daily ritual (D29, D33, D36, D207).
 *
 * D207 — this is the Decide pillar of Discover→Decide→Automate→Audit
 * →Undo. Each row is one decision; K/A/U/L are the four verbs
 * (D29 / D227); D226's mandatory preview is always rendered (either
 * via the sheet or inline via D34's remember-preference); the receipt
 * + undo flow lives in `packages/shared/src/components/undo-tray`.
 *
 * Action lifecycle (D226):
 *
 *   user intent → action sheet → action preview → mutation → undo
 *
 * The sheet may be skipped (D34 remember-preference); the preview
 * cannot. Both paths route through `dispatchAction` which is the only
 * place the mutation actually runs.
 */
export function TriageScreen({ state = DEFAULT_TRIAGE_STATE }: { state?: TriageScreenState }) {
  const pendingAction = useTriageStore((s) => s.pendingAction);
  const rememberPreference = useTriageStore((s) => s.rememberPreference);
  const openPending = useTriageStore((s) => s.openPending);
  const clearPending = useTriageStore((s) => s.clearPending);
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);
  const setExpandedRow = useTriageStore((s) => s.setExpandedRow);

  // Find the row the pending action targets — the sheet needs it for
  // the preview body.
  const pendingRow: TriageDecisionRow | null =
    pendingAction != null && state.kind === 'ready'
      ? (state.rows.find((r) => r.id === pendingAction.rowId) ?? null)
      : null;

  /**
   * Run the mutation for `verb` against `row` after the preview has
   * been seen. This is the only function in the file that actually
   * "applies" anything — both the sheet-confirm path and the
   * inline-preview path call it.
   *
   * For fixtures we just fire a toast and clear the pending action;
   * the real BE wiring lands in a later PR.
   */
  const dispatchAction = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow, _details?: ConfirmDetails) => {
      toast(
        `${VERB_PAST[verb]} ${row.senderName}`,
        verb === 'Unsubscribe' ? 'warn' : verb === 'Keep' ? 'info' : 'success',
      );
      clearPending();
      // Auto-collapse the decided row so the next one moves up the
      // queue and the user's eye lands on the next decision.
      setExpandedRow(null);
    },
    [clearPending, setExpandedRow],
  );

  /**
   * Row-level handler — bridges a button click / shortcut to the
   * sheet-or-inline preview flow (D226).
   *
   * For Keep: no preview needed (Keep is non-destructive — the
   * sender stays exactly where it is). Dispatch immediately, but
   * still fire the toast so the action is visible.
   *
   * For Archive / Unsubscribe / Later: open the action surface.
   * The remember-preference flag picks the surface (sheet vs inline).
   */
  const onRowAction = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow) => {
      if (verb === 'Keep') {
        dispatchAction(verb, row);
        return;
      }
      const sheetableVerb = verb as SheetableVerb;
      const surface: 'sheet' | 'inline' = rememberPreference[sheetableVerb] ? 'inline' : 'sheet';
      openPending(sheetableVerb, row.id, surface);
      // When inline preview is the surface, expand the row so the
      // preview is visible — and the user's eye is already there.
      if (surface === 'inline') {
        setExpandedRow(row.id);
      }
    },
    [dispatchAction, openPending, rememberPreference, setExpandedRow],
  );

  /** Sheet confirm — persists remember-preference, then dispatches. */
  const onSheetConfirm = useCallback(
    (details: ConfirmDetails) => {
      if (pendingAction == null || pendingRow == null) return;
      if (pendingAction.verb !== 'Keep') {
        setRememberPreference(pendingAction.verb as SheetableVerb, details.rememberPreference);
      }
      dispatchAction(pendingAction.verb, pendingRow, details);
    },
    [pendingAction, pendingRow, dispatchAction, setRememberPreference],
  );

  /**
   * Inline-preview confirm: there's no sheet to dismiss, so the
   * user clicks "Apply" via the row's toolbar a SECOND time to
   * confirm. Hitting the same verb twice = confirm; hitting a
   * different verb = swap. Escape clears.
   *
   * Implementation: when `pendingAction.surface === 'inline'` and
   * the user clicks the same verb again, we treat that as confirm.
   * Simpler than wiring a separate "Apply" button — keeps the
   * inline preview chrome lean (D33-style minimalism).
   */
  const onRowActionWithInlineConfirm = useCallback(
    (verb: ActionVerb, row: TriageDecisionRow) => {
      if (
        pendingAction != null &&
        pendingAction.surface === 'inline' &&
        pendingAction.rowId === row.id &&
        pendingAction.verb === verb
      ) {
        // Second click on the same verb confirms.
        dispatchAction(verb, row, {
          archiveHistoric: verb === 'Unsubscribe',
          rememberPreference: true,
        });
        return;
      }
      onRowAction(verb, row);
    },
    [pendingAction, dispatchAction, onRowAction],
  );

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      {/* Header — matches Senders screen typography. */}
      <div>
        <Eyebrow>Triage · default mailbox</Eyebrow>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.018em',
            margin: '4px 0 0',
          }}
        >
          {state.kind === 'ready'
            ? `${state.rows.length} decisions, one at a time.`
            : state.kind === 'empty'
              ? 'All caught up.'
              : 'Loading your decisions…'}
        </h1>
      </div>

      <ScreenIntro
        id="triage"
        title="How Triage works"
        body="One row, one decision. K keeps, A archives, U unsubscribes, L moves to Later. Every destructive action shows a preview before anything changes."
        tip="We never read message bodies. The triage engine reasons from sender, subject, Gmail's preview snippet, dates, and aggregate read/volume stats — that's it."
      />

      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'empty' && (
        <TriageEmptyState
          stats={state.stats}
          onOpenUpgrade={() => toast('Upgrade flow opens here', 'info')}
        />
      )}
      {state.kind === 'ready' && state.rows.length === 0 && (
        <TriageEmptyState
          stats={state.stats}
          onOpenUpgrade={() => toast('Upgrade flow opens here', 'info')}
        />
      )}
      {state.kind === 'ready' && state.rows.length > 0 && (
        <TriageQueue rows={state.rows} onAction={onRowActionWithInlineConfirm} />
      )}

      {/* Sheet — only mounted when the pending action's surface is sheet. */}
      <ActionSheet
        open={pendingAction != null && pendingAction.surface === 'sheet'}
        verb={(pendingAction?.verb ?? 'Archive') as SheetableVerb}
        row={pendingRow}
        onCancel={clearPending}
        onConfirm={onSheetConfirm}
      />
    </div>
  );
}

/** Skeleton stack — matches the row's vertical rhythm. */
function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: 68,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 10,
            backgroundImage: `linear-gradient(90deg, ${color.lineSoft} 0%, rgba(14,20,19,0.03) 50%, ${color.lineSoft} 100%)`,
            backgroundSize: '200% 100%',
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading triage queue</span>
    </div>
  );
}
