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

const { color, radius, shadow, space } = tokens;

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
        className="dm-scrim"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 140 }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="dm-sheet"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          boxSizing: 'border-box',
          maxHeight: `${maxHeightVh}vh`,
          overflow: 'auto',
          background: color.card,
          borderRadius: `${radius['2xl']}px ${radius['2xl']}px 0 0`,
          boxShadow: shadow.modal,
          zIndex: 141,
          padding: `${space[2]}px ${space[5]}px calc(${space[5]}px + env(safe-area-inset-bottom))`,
        }}
      >
        {/* Grab handle — the sheet's one affordance that it came from below. */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 5,
            borderRadius: radius.pill,
            background: color.fillHover,
            margin: `${space[1]}px auto ${space[4]}px`,
          }}
        />
        {children}
      </div>
    </>
  );
}
