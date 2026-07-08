'use client';

/**
 * Swipe gestures for the mobile triage card (D37).
 *
 *   swipe right → Keep
 *   swipe left  → Archive
 *   swipe up    → Later
 *
 * Gestures AUGMENT the verb buttons — they never replace them, and
 * Unsubscribe stays button-only (destructive with per-sender channel
 * semantics). A swipe resolves to the same `onVerb` callback the
 * buttons use, so destructive verbs still enter the D226 sheet/preview
 * flow — a swipe can never mutate directly.
 *
 * Pointer events only (no dependency); gated to `pointerType ===
 * 'touch'` per D37 ("no swipe on desktop"). D37's locked spec put
 * gestures on the two most common verbs (right = Keep, left =
 * Archive); the up = Later gesture is a founder-directed addition —
 * safe because Later is preview-gated like every destructive verb, so
 * the gesture only OPENS the preview.
 */

import { useCallback, useRef, useState } from 'react';
import type * as React from 'react';
import type { ActionVerb } from './types';

/** Minimum travel (px) on the dominant axis before a swipe resolves. */
export const SWIPE_THRESHOLD_PX = 56;
/** Dominant axis must beat the other by this ratio (rejects diagonals). */
export const SWIPE_DOMINANCE = 1.4;

export type SwipeVerb = Extract<ActionVerb, 'Keep' | 'Archive' | 'Later'>;

/**
 * Pure resolver — pointer delta → intended verb, or `null` when the
 * gesture is under threshold, diagonal, or a downward swipe (unbound).
 * Exported so tests pin the D37 mapping without synthesising real
 * pointer streams.
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
    return dx > 0 ? 'Keep' : 'Archive';
  }
  if (ay >= threshold && ay >= ax * dominance && dy < 0) {
    return 'Later';
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
 * `enabled=false` (desktop breakpoints, busy rows) renders the
 * handlers inert. Only primary-button touch pointers track; pointer
 * capture keeps the stream on the card while the finger wanders.
 */
export function useSwipeVerb({
  enabled,
  onVerb,
}: {
  enabled: boolean;
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

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>(
    (e) => {
      if (!enabled || e.pointerType !== 'touch') return;
      origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    },
    [enabled],
  );

  const onPointerMove = useCallback<React.PointerEventHandler<HTMLElement>>((e) => {
    const start = origin.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    setDrag({ dx, dy, wouldResolve: resolveSwipeVerb(dx, dy) });
  }, []);

  const settle = useCallback(
    (e: React.PointerEvent<HTMLElement>, fire: boolean) => {
      const start = origin.current;
      if (!start || e.pointerId !== start.pointerId) return;
      origin.current = null;
      setDrag(null);
      if (!fire) return;
      const verb = resolveSwipeVerb(e.clientX - start.x, e.clientY - start.y);
      if (verb != null) onVerb(verb);
    },
    [onVerb],
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
