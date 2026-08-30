'use client';

/**
 * Generic mobile bottom sheet — a backdrop + a panel that slides up from
 * the bottom edge, used wherever a phone-width surface needs a modal
 * affordance without covering the whole screen (D54 senders mobile
 * dialect, ADR-0018). Desktop surfaces keep their existing dialogs; this
 * is additive, not a replacement for `ConfirmActionModal`'s own
 * `variant="sheet"` (which reuses this component's positioning values
 * directly since it needs its own scroll + footer layout).
 */

import { useEffect, type ReactNode } from 'react';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { tokens } from '../tokens/tokens';

const { color, radius } = tokens;

export function BottomSheet({
  open,
  onClose,
  children,
  ariaLabel,
  maxHeightVh = 75,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name for the sheet dialog. */
  ariaLabel: string;
  /** Panel height ceiling, as a percentage of the viewport height. */
  maxHeightVh?: number;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 140,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxHeight: `${maxHeightVh}vh`,
          overflow: 'auto',
          background: color.card,
          borderRadius: `${radius.xl}px ${radius.xl}px 0 0`,
          border: `1px solid ${color.border}`,
          borderBottom: 'none',
          boxShadow: '0 -12px 40px rgba(14,20,19,0.30)',
          zIndex: 141,
          padding: '8px 16px calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            borderRadius: radius.pill,
            background: color.line,
            margin: '4px auto 12px',
          }}
        />
        {children}
      </div>
    </>
  );
}
