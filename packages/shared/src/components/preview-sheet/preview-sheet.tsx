'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { color, font, shadow, space, text, typography } from '../../tokens/tokens';
import { Button, type ButtonTone } from '../button';
import { Disclosure } from '../disclosure';

/**
 * The one confirmation surface (ADR-0042). A preview owes the user three
 * things, each once: the COUNT, WHERE the email goes, and HOW TO UNDO it
 * (CLAUDE.md §2.3). This component gives those three a fixed place —
 * title, subtitle, note — with account context always visible and other facts behind "Details"
 * disclosure, so a caller cannot grow the sheet by adding another line.
 *
 * Presentational only: no fetching, no mutation. The feature owns the
 * counts, the reach and the dispatch; the sheet owns layout, focus, Esc,
 * scrim and motion. It is a centred dialog on desktop and a bottom sheet
 * on phones (pure CSS, so there is no post-hydration jump).
 */
export type PreviewSheetProps = {
  onClose: () => void;
  /** Wider review dialog with a scrolling body and persistent actions. */
  layout?: 'compact' | 'review';
  /** Sender logo / verb glyph — what the action is about. */
  icon?: ReactNode;
  /** Account identity, always visible before confirmation. */
  context?: ReactNode;
  /** "Delete 6,728 emails?" — the count and the verb, as a question. */
  title: string;
  /** One sentence: whose email, and where it goes. */
  subtitle?: ReactNode;
  /** Controls that change the count — a reach or window choice. */
  children?: ReactNode;
  /** One line: how to undo it, or the single thing that cannot be undone. */
  note?: ReactNode;
  /** Everything else. Collapsed. */
  details?: ReactNode;
  detailsLabel?: string;
  primary: {
    label: string;
    onClick: () => void;
    tone?: ButtonTone;
    disabled?: boolean;
    /** Shown in place of the label while the request is in flight. */
    busyLabel?: string | undefined;
  };
  cancelLabel?: string;
  /** A quiet row under the buttons — e.g. "Don't ask again for Archive". */
  footer?: ReactNode;
  /** `aria-live` status line (submitting / failed). */
  status?: ReactNode;
  testId?: string;
};

export function PreviewSheet({
  onClose,
  layout = 'compact',
  icon,
  context,
  title,
  subtitle,
  children,
  note,
  details,
  detailsLabel = 'Details',
  primary,
  cancelLabel = 'Cancel',
  footer,
  status,
  testId,
}: PreviewSheetProps) {
  const titleId = useId();
  const subtitleId = useId();
  const busy = primary.busyLabel != null;
  const review = layout === 'review';
  // Unsubscribe (warn) and Delete (danger) are irreversible from the
  // keyboard: Enter on open must land on Cancel, never the action.
  const irreversible = primary.tone === 'danger' || primary.tone === 'warn';
  const trapRef = useFocusTrap<HTMLDivElement>(true, {
    initialFocusSelector: irreversible
      ? '[data-dm-sheet-cancel] button'
      : '[data-dm-sheet-primary] button:not([disabled]), [data-dm-sheet-cancel] button:not([disabled])',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div
      className="dm-scrim dm-sheet-layer"
      data-dm-preview-sheet=""
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'center',
        padding: space[4],
        overflowY: 'auto',
      }}
    >
      <div
        ref={trapRef}
        role={irreversible ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        {...(subtitle == null ? {} : { 'aria-describedby': subtitleId })}
        className={`dm-sheet dm-sheet-panel${review ? ' dm-sheet-review' : ''}`}
        style={{
          width: '100%',
          maxWidth: review ? 680 : 440,
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: review ? 'stretch' : 'center',
          textAlign: review ? 'left' : 'center',
          padding: 0,
        }}
      >
        <div
          className="dm-sheet-body"
          style={
            review
              ? undefined
              : {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: `${space[8]}px ${space[6]}px ${space[4]}px`,
                }
          }
        >
          {icon != null && <div style={{ marginBottom: space[4] }}>{icon}</div>}

          {context != null && (
            <div style={{ marginBottom: space[4], width: '100%' }}>{context}</div>
          )}

          <h2
            id={titleId}
            style={{
              margin: 0,
              ...typography.dialogTitle,
              textWrap: 'balance',
            }}
          >
            {title}
          </h2>

          {subtitle != null && (
            <div
              id={subtitleId}
              style={{
                margin: `${space[2]}px 0 0`,
                fontSize: text.md,
                lineHeight: 1.45,
                color: color.fgSoft,
                maxWidth: review ? undefined : '34ch',
                textWrap: 'pretty',
              }}
            >
              {subtitle}
            </div>
          )}

          {children != null && <div style={{ marginTop: space[5], width: '100%' }}>{children}</div>}

          {note != null && (
            <p
              className="dm-sheet-note"
              style={{
                margin: `${space[4]}px 0 0`,
                fontSize: text.sm,
                lineHeight: 1.45,
                color: color.fgMuted,
                maxWidth: review ? undefined : '40ch',
              }}
            >
              {note}
            </p>
          )}

          {details != null && (
            <Disclosure summary={detailsLabel} style={{ marginTop: space[4] }}>
              {details}
            </Disclosure>
          )}
        </div>
        <div
          className="dm-sheet-footer"
          style={review ? undefined : { padding: `${space[4]}px ${space[6]}px ${space[6]}px` }}
        >
          <div
            className="dm-sheet-actions"
            style={{
              marginTop: 0,
              width: '100%',
            }}
          >
            <span data-dm-sheet-primary="" style={{ display: 'contents' }}>
              <Button
                tone={primary.tone ?? 'primary'}
                size="lg"
                onClick={primary.onClick}
                disabled={primary.disabled === true || busy}
              >
                {primary.busyLabel ?? primary.label}
              </Button>
            </span>
            <span data-dm-sheet-cancel="" style={{ display: 'contents' }}>
              <Button tone="ghost" size="lg" onClick={onClose} disabled={busy}>
                {cancelLabel}
              </Button>
            </span>
          </div>

          <div
            role="status"
            aria-live="polite"
            style={{ minHeight: status == null ? 0 : undefined }}
          >
            {status != null && (
              <p style={{ margin: `${space[3]}px 0 0`, fontSize: text.sm, color: color.fgSoft }}>
                {status}
              </p>
            )}
          </div>

          {footer != null && (
            <div
              style={{
                marginTop: space[3],
                width: '100%',
                fontSize: text.sm,
                color: color.fgMuted,
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
