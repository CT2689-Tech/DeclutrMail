'use client';

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { color, font, radius } from '../tokens/tokens';

/**
 * Accessible description tooltip (D38 — "tooltips on hover").
 *
 * D38 says "on hover"; hover alone is a mouse-only affordance, so this
 * opens on hover AND on keyboard focus, and closes on Escape. The
 * bubble is ALWAYS in the DOM — visually hidden when closed — so the
 * `aria-describedby` the trigger carries always resolves to a real
 * node. Rendering it conditionally would leave a dangling id reference
 * on every closed tooltip, which is both an axe `aria-valid-attr-value`
 * violation and a screen reader that announces nothing.
 *
 * Children is a function so the trigger receives the generated id and
 * wires it to its own `aria-describedby`. The alternative (cloning the
 * child to inject the attribute) does not work here: the shared
 * `Button` has a closed prop list and drops unknown props before they
 * reach the DOM.
 *
 * No animation, deliberately — nothing to degrade under
 * `prefers-reduced-motion` (WCAG 2.3.3).
 */
export function Tooltip({
  content,
  placement = 'top',
  children,
}: {
  /** The description. Keep it to one plain sentence. */
  content: ReactNode;
  /** Which side of the trigger the bubble sits on. Defaults to top. */
  placement?: 'top' | 'bottom';
  children: (props: { describedBy: string }) => ReactNode;
}) {
  const describedBy = useId();
  const [open, setOpen] = useState(false);

  // Escape closes an open tooltip (WCAG 1.4.13 "Content on Hover or
  // Focus" — dismissible without moving the pointer or focus).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focus/blur bubble in React, so focusing the inner control opens
      // the bubble without the trigger having to forward handlers.
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children({ describedBy })}
      <span
        id={describedBy}
        role="tooltip"
        style={
          open
            ? {
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                ...(placement === 'top'
                  ? { bottom: 'calc(100% + 6px)' }
                  : { top: 'calc(100% + 6px)' }),
                zIndex: 30,
                width: 'max-content',
                maxWidth: 260,
                padding: '7px 9px',
                background: color.fg,
                color: color.fgInverse,
                border: `1px solid ${color.fg}`,
                borderRadius: radius.sm,
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.45,
                whiteSpace: 'normal',
                textAlign: 'left',
                boxShadow: '0 6px 18px rgba(14,20,19,0.22)',
                // The bubble must never eat the pointer — a tooltip that
                // sits under the cursor would fire the wrapper's
                // mouseleave and flicker.
                pointerEvents: 'none',
              }
            : VISUALLY_HIDDEN
        }
      >
        {content}
      </span>
    </span>
  );
}

/**
 * Off-screen but still in the accessibility tree — the closed state.
 * `display: none` would remove the description from screen readers
 * entirely, which is the opposite of what a described-by target is for.
 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
