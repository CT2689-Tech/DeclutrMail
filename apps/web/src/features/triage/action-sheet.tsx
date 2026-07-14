'use client';

import { useEffect, useState } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import { ActionPreview, type PreviewCount } from './action-preview';
import type { TriageDecisionRow } from './data';
import type { SheetableVerb } from './store';

const { color, font } = tokens;

export interface ConfirmDetails {
  archiveHistoric: boolean;
  /** Final value of the remember-preference toggle when confirming. */
  rememberPreference: boolean;
}

/**
 * Triage action sheet (D34) — modal preview before a destructive
 * mutation runs.
 *
 * D34: the sheet shows by default on Archive / Unsubscribe / Later.
 * A "remember my choice" toggle lets the user opt into the
 * preview-inline path; that preference lives in the triage Zustand
 * store (see `store.ts`).
 *
 * D226: the preview INSIDE this sheet is the mandatory preview. The
 * sheet itself is what D34 allows skipping; the preview never is.
 * `<ActionPreview mode="modal">` renders below the title.
 *
 * Keyboard: Escape cancels; Cmd/Ctrl-Enter confirms — same shortcuts
 * as `confirm-action-modal.tsx` in the senders feature so muscle
 * memory carries between screens.
 */
export function ActionSheet({
  open,
  verb,
  row,
  inboxCount,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Sheetable verbs only — Keep is never previewed. */
  verb: SheetableVerb;
  row: TriageDecisionRow | null;
  /** Live inbox count for the preview's impact figure (D226). */
  inboxCount: PreviewCount;
  onCancel: () => void;
  onConfirm: (details: ConfirmDetails) => void;
}) {
  // Unsubscribe defaults to clearing the backlog (the common intent
  // when cutting a sender off). Archive and Later ignore the toggle —
  // both verbs already act on every inbox message from the sender
  // (the worker resolves "in INBOX now"), so a separate historic
  // toggle would be a no-op lie.
  const [archiveHistoric, setArchiveHistoric] = useState(false);
  const [rememberPreference, setRememberPreference] = useState(false);

  useEffect(() => {
    if (!open) return;
    setArchiveHistoric(verb === 'Unsubscribe');
    setRememberPreference(false);
  }, [open, verb]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onConfirm({ archiveHistoric, rememberPreference });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, archiveHistoric, rememberPreference, onCancel, onConfirm]);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!open || !row) return null;

  const danger = verb === 'Unsubscribe';
  // Unsubscribe only: Archive/Later already move every inbox message
  // from the sender, so the backlog toggle exists only where the
  // primary verb does NOT touch past mail.
  const showHistoricToggle = verb === 'Unsubscribe';

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-triage-sheet-title"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))',
          maxHeight: '76vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 8px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={danger ? 'amber' : 'primary'}>Preview · {verb}</Eyebrow>
          <h2
            id="dm-triage-sheet-title"
            style={{
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: '-0.014em',
              margin: '6px 0 12px',
            }}
          >
            {row.senderName}
          </h2>
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mandatory preview (D226). Same component renders inline
              when the sheet is skipped via the remember-preference. */}
          <ActionPreview
            verb={verb}
            row={row}
            archiveHistoric={archiveHistoric}
            inboxCount={inboxCount}
            mode="modal"
          />

          {showHistoricToggle && (
            <button
              onClick={() => setArchiveHistoric((v) => !v)}
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: archiveHistoric ? color.primarySoft : 'transparent',
                border: `1px solid ${archiveHistoric ? color.primaryBorder : color.line}`,
                borderRadius: 9,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <CheckSquare on={archiveHistoric} />
              <span style={{ fontSize: 12.5, color: color.fg }}>
                {/* The live count (never a lifetime estimate — D226). */}
                Also archive the
                {typeof inboxCount === 'number'
                  ? ` ${inboxCount.toLocaleString()} email${inboxCount === 1 ? '' : 's'}`
                  : ' emails'}{' '}
                already in the inbox
              </span>
            </button>
          )}

          {/*
           * D34 — remember-preference toggle. Persists per verb (Settings
           * page eventually owns the persisted value; for this PR it
           * lives in the Zustand store). The sheet still renders for
           * THIS action — the preference applies to the NEXT one.
           */}
          <button
            onClick={() => setRememberPreference((v) => !v)}
            type="button"
            aria-label="Show this preview in the row next time"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              background: 'transparent',
              border: `1px solid ${color.lineSoft}`,
              borderRadius: 9,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: font.sans,
            }}
          >
            <CheckSquare on={rememberPreference} muted />
            <span style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.45 }}>
              <strong style={{ color: color.fg, fontWeight: 600 }}>
                Show this in the row next time
              </strong>{' '}
              — the same preview will appear below the sender. You can change this in Settings.
            </span>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>
            {/* Honest reversibility (D58): a delivered network
                unsubscribe can't be recalled — no undo token exists for
                it by design. Only the archived backlog is undoable.
                Archive/Later are fully reversible (D232). */}
            {verb === 'Unsubscribe'
              ? "The unsubscribe itself can't be undone — an archived backlog uses your plan's Activity Undo window."
              : "Undo from Activity during your plan's window."}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              tone={danger ? 'warn' : 'primary'}
              onClick={() => onConfirm({ archiveHistoric, rememberPreference })}
              iconRight={
                <Kbd
                  style={{
                    background: color.lineInverse,
                    border: 'none',
                    color: color.fgInverse,
                  }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {verb}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Inline checkbox glyph — matches `confirm-action-modal.tsx` shape. */
function CheckSquare({ on, muted = false }: { on: boolean; muted?: boolean }) {
  const ringColor = muted ? color.fgMuted : color.primary;
  const ringOff = muted ? 'rgba(14,20,19,0.18)' : 'rgba(14,20,19,0.28)';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: `1.5px solid ${on ? ringColor : ringOff}`,
        background: on ? ringColor : color.card,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {on && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}
