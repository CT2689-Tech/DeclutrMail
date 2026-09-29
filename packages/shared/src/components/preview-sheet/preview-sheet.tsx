'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { color, font, motion, radius, shadow, space, text } from '../../tokens/tokens';
import { Button, type ButtonTone } from '../button';

/**
 * The one confirmation surface (ADR-0042). A preview owes the user three
 * things, each once: the COUNT, WHERE the email goes, and HOW TO UNDO it
 * (CLAUDE.md §2.3). This component gives those three a fixed place —
 * title, subtitle, note — and puts everything else behind one "Details"
 * disclosure, so a caller cannot grow the sheet by adding another line.
 *
 * Presentational only: no fetching, no mutation. The feature owns the
 * counts, the reach and the dispatch; the sheet owns layout, focus, Esc,
 * scrim and motion. It is a centred dialog on desktop and a bottom sheet
 * on phones (pure CSS, so there is no post-hydration jump).
 */
export type PreviewSheetProps = {
  onClose: () => void;
  /** Sender logo / verb glyph — what the action is about. */
  icon?: ReactNode;
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
  icon,
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
  // Focus lands on the action — except a destructive one, where Enter on
  // open must never be enough; there it lands on Cancel.
  const trapRef = useFocusTrap<HTMLDivElement>(true, {
    initialFocusSelector:
      primary.tone === 'danger'
        ? '[data-dm-sheet-cancel] button'
        : '[data-dm-sheet-primary] button',
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(subtitle == null ? {} : { 'aria-describedby': subtitleId })}
        className="dm-sheet dm-sheet-panel"
        style={{
          width: '100%',
          maxWidth: 440,
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: `${space[8]}px ${space[6]}px ${space[6]}px`,
        }}
      >
        {icon != null && <div style={{ marginBottom: space[4] }}>{icon}</div>}

        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: text['2xl'],
            lineHeight: 1.2,
            fontWeight: 650,
            letterSpacing: '-0.022em',
            textWrap: 'balance',
          }}
        >
          {title}
        </h2>

        {subtitle != null && (
          <p
            id={subtitleId}
            style={{
              margin: `${space[2]}px 0 0`,
              fontSize: text.md,
              lineHeight: 1.45,
              color: color.fgSoft,
              maxWidth: '34ch',
              textWrap: 'pretty',
            }}
          >
            {subtitle}
          </p>
        )}

        {children != null && <div style={{ marginTop: space[5], width: '100%' }}>{children}</div>}

        {note != null && (
          <p
            style={{
              margin: `${space[4]}px 0 0`,
              fontSize: text.sm,
              lineHeight: 1.45,
              color: color.fgMuted,
              maxWidth: '40ch',
            }}
          >
            {note}
          </p>
        )}

        {details != null && (
          <details className="dm-sheet-details" style={{ marginTop: space[4], width: '100%' }}>
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 32,
                padding: `0 ${space[3]}px`,
                borderRadius: radius.pill,
                fontSize: text.sm,
                fontWeight: 550,
                color: color.fgSoft,
              }}
            >
              {detailsLabel}
              <svg
                className="dm-sheet-details-chevron"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ transition: `transform ${motion.fast} ${motion.ease}` }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div
              style={{
                marginTop: space[2],
                padding: `${space[1]}px ${space[4]}px ${space[3]}px`,
                borderRadius: radius.lg,
                background: color.fill,
                textAlign: 'left',
                fontSize: text.sm,
                lineHeight: 1.5,
                // Values read in full contrast; `SheetFactList` mutes only
                // its labels. Grey-on-grey was unreadable in dark mode.
                color: color.fg,
                display: 'flex',
                flexDirection: 'column',
                gap: space[3],
              }}
            >
              {details}
            </div>
          </details>
        )}

        <div
          style={{
            marginTop: space[6],
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: space[2],
          }}
        >
          <span data-dm-sheet-primary="" style={{ display: 'contents' }}>
            <Button
              tone={primary.tone ?? 'primary'}
              size="xl"
              onClick={primary.onClick}
              disabled={primary.disabled === true || busy}
              style={{ width: '100%' }}
            >
              {primary.busyLabel ?? primary.label}
            </Button>
          </span>
          <span data-dm-sheet-cancel="" style={{ display: 'contents' }}>
            <Button
              tone="ghost"
              size="lg"
              onClick={onClose}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {cancelLabel}
            </Button>
          </span>
        </div>

        <div role="status" aria-live="polite" style={{ minHeight: status == null ? 0 : undefined }}>
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
  );
}
