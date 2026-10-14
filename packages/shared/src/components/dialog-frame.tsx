'use client';

// Promoted per D199: existing modal consumers share scrolling body/footer geometry.
// Consumers: Activity support/recovery/filters, Mailbox controls, Home cleanup,
// Upgrade, Senders keyboard help and Triage keyboard help. Stories follow D210.

import type { CSSProperties, KeyboardEventHandler, ReactNode, Ref } from 'react';

import { color, font, shadow, space } from '../tokens/tokens';

type DialogName = { titleId: string; label?: never } | { label: string; titleId?: never };

/** Shared modal layout. Callers retain focus, confirmation and busy policies. */
export function DialogFrame({
  children,
  footer,
  panelRef,
  onDismiss,
  onKeyDown,
  role = 'dialog',
  titleId,
  descriptionId,
  label,
  testId,
  backdropTestId,
  maxWidth = 520,
  // Cookie consent stays at 150. Dialogs sit above that layer.
  zIndex = 170,
  bodyStyle,
}: DialogName & {
  children: ReactNode;
  footer?: ReactNode;
  panelRef: Ref<HTMLDivElement>;
  /** Omit while dismissal is locked by an in-flight operation. */
  onDismiss?: (() => void) | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  role?: 'dialog' | 'alertdialog';
  descriptionId?: string;
  testId?: string;
  backdropTestId?: string;
  maxWidth?: number;
  zIndex?: number;
  bodyStyle?: CSSProperties;
}) {
  return (
    <div
      className="dm-scrim dm-sheet-layer"
      data-testid={backdropTestId}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (onDismiss) onDismiss();
        else event.preventDefault();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'flex',
        justifyContent: 'center',
        padding: space[4],
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-label={label}
        tabIndex={-1}
        data-testid={testId}
        className="dm-sheet dm-sheet-panel dm-dialog-panel"
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === 'Escape' && !event.defaultPrevented && onDismiss) {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }
        }}
        style={{
          width: '100%',
          maxWidth,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
        }}
      >
        <div className="dm-sheet-body dm-dialog-body" style={bodyStyle}>
          {children}
        </div>
        {footer != null && <div className="dm-sheet-footer dm-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
