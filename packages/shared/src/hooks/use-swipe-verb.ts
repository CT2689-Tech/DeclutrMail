'use client';

import { useCallback, useRef, useState } from 'react';
import type * as React from 'react';

/**
 * ONE swipe grammar for every phone surface (ADR-0048; replaces D37's
 * mapping and ADR-0018's "Gestures", which had drifted apart).
 *
 *   swipe right → Keep
 *   swipe left  → Unsubscribe
 *   swipe up    → Delete
 *   swipe down  → unbound (scroll and pull-to-refresh own it)
 *
 * Archive and Later are one-tap buttons only. Gestures AUGMENT the
 * buttons and never replace them. A gesture resolves to the same
 * `onVerb` callback the buttons use, so every swipe only OPENS the D226
 * preview — it can never mutate directly. The Confirm tap and the undo
 * tray remain the guards, which is what makes a gesture on a destructive
 * verb safe.
 *
 * Pointer events only (no dependency), touch pointers only.
 */

/** Minimum travel (px) on the dominant axis before a swipe resolves. */
export const SWIPE_THRESHOLD_PX = 56;
/** Dominant axis must beat the other by this ratio (rejects diagonals). */
export const SWIPE_DOMINANCE = 1.4;

export type SwipeVerb = 'Keep' | 'Unsubscribe' | 'Delete';

/**
 * What the live hint names while a drag would resolve. The ONE place the
 * words live, so the two surfaces cannot name a gesture differently.
 */
export const SWIPE_HINT: Record<SwipeVerb, string> = {
  Keep: '→ Keep',
  Unsubscribe: '← Unsubscribe',
  Delete: '↑ Delete',
};

/**
 * Pure resolver: pointer delta → intended verb, or `null` when the
 * gesture is under threshold, diagonal, or a downward swipe (unbound).
 * Exported so tests pin the mapping without synthesising pointer streams.
 */
export function resolveSwipeVerb(
  dx: number,
  dy: number,
  opts: { threshold?: number; dominance?: number } = {},
): SwipeVerb | null {
  const threshold = opts.threshold ?? SWIPE_THRESHOLD_PX;
  const dominance = opts.dominance ?? SWIPE_DOMINANCE;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= threshold && ax >= ay * dominance) {
    return dx > 0 ? 'Keep' : 'Unsubscribe';
  }
  if (ay >= threshold && ay >= ax * dominance && dy < 0) {
    return 'Delete';
  }
  return null;
}

export interface SwipeDragState {
  dx: number;
  dy: number;
  /** The verb the drag WOULD resolve to if released now (hint layer). */
  wouldResolve: SwipeVerb | null;
}

/**
 * Attachable pointer handlers + live drag state for the hint layer.
 *
 * `enabled=false` (desktop breakpoints, busy rows) renders the handlers
 * inert. `isAvailable` lets the caller say a verb cannot run on THIS
 * item (no unsubscribe channel, nothing to delete): such a swipe neither
 * fires nor shows a hint, so the screen never promises what a release
 * would then refuse.
 */
export function useSwipeVerb({
  enabled,
  isAvailable,
  onVerb,
}: {
  enabled: boolean;
  isAvailable?: (verb: SwipeVerb) => boolean;
  onVerb: (verb: SwipeVerb) => void;
}): {
  drag: SwipeDragState | null;
  handlers: {
    onPointerDown: React.PointerEventHandler<HTMLElement>;
    onPointerMove: React.PointerEventHandler<HTMLElement>;
    onPointerUp: React.PointerEventHandler<HTMLElement>;
    onPointerCancel: React.PointerEventHandler<HTMLElement>;
  };
} {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [drag, setDrag] = useState<SwipeDragState | null>(null);

  // Read through a ref so a changing predicate never re-creates the
  // handlers mid-gesture.
  const availableRef = useRef(isAvailable);
  availableRef.current = isAvailable;
  const resolve = useCallback((dx: number, dy: number): SwipeVerb | null => {
    const verb = resolveSwipeVerb(dx, dy);
    if (verb == null) return null;
    return (availableRef.current?.(verb) ?? true) ? verb : null;
  }, []);

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      if (!enabled || e.pointerType !== 'touch') return;
      // Native controls/disclosures own their gesture. A drag on a control
      // must not also start a card decision; this includes nested icons/text.
      // The list row's role=button header remains its intended swipe surface.
      if (
        e.target instanceof Element &&
        e.target.closest(
          'a, button, input, select, textarea, details, [contenteditable]:not([contenteditable="false" i])',
        )
      )
        return;
      origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    },
    [enabled],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      setDrag({ dx, dy, wouldResolve: resolve(dx, dy) });
    },
    [resolve],
  );

  const settle = useCallback(
    (e: React.PointerEvent<HTMLElement>, fire: boolean) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      origin.current = null;
      setDrag(null);
      if (!fire) return;
      const verb = resolve(e.clientX - start.x, e.clientY - start.y);
      if (verb != null) onVerb(verb);
    },
    [onVerb, resolve],
  );

  const onPointerUp = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, true),
    [settle],
  );
  const onPointerCancel = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => settle(e, false),
    [settle],
  );

  return { drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
