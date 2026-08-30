'use client';

import { useCallback, useRef } from 'react';
import type * as React from 'react';

/** Default hold duration (ms) before a long-press fires. */
export const LONG_PRESS_MS = 500;
/** Pointer drift (px) beyond which a long-press cancels (it's a scroll/swipe instead). */
export const LONG_PRESS_DRIFT_PX = 10;

/**
 * Touch-only long-press detection. Fires `onLongPress` once the pointer
 * has held within {@link LONG_PRESS_DRIFT_PX} for {@link LONG_PRESS_MS}.
 * Any movement past the drift threshold, or a pointer-up before the
 * deadline, cancels silently — the caller's own click/tap handler runs
 * instead. `enabled=false` renders the handlers inert (desktop pointers,
 * or a surface not currently offering long-press).
 */
export function useLongPress({
  enabled,
  onLongPress,
}: {
  enabled: boolean;
  onLongPress: () => void;
}): {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
} {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    origin.current = null;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      if (!enabled || e.pointerType !== 'touch') return;
      origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      timer.current = setTimeout(() => {
        // The pointer may have lifted between the timer firing and this
        // callback running; only fire while the press is still live.
        if (origin.current !== null) onLongPress();
        clear();
      }, LONG_PRESS_MS);
    },
    [enabled, onLongPress, clear],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_DRIFT_PX) clear();
    },
    [clear],
  );

  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(() => clear(), [clear]);
  const onPointerCancel = useCallback<React.PointerEventHandler<HTMLElement>>(
    () => clear(),
    [clear],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
