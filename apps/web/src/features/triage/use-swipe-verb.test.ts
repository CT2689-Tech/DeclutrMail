// Tests for the mobile-swipe resolver (D37).
//
// `resolveSwipeVerb` is the pure pointer-delta → verb mapping the swipe
// hook is built on; it's exported precisely so the D37 gesture contract
// is pinned without synthesising real pointer streams. What this locks:
//
//   - right → Keep, left → Archive, up → Later (D37 + founder addition)
//   - down is UNBOUND (returns null) — no destructive gesture below the
//     threshold, and no accidental verb from a downward flick
//   - sub-threshold travel resolves to null (a tap is not a swipe)
//   - diagonal drags are rejected by the dominance ratio
//   - the resolver only ever returns the three swipeable verbs — never
//     Unsubscribe (button-only), so a swipe can never fire it

import { describe, expect, it } from 'vitest';
import { resolveSwipeVerb, SWIPE_THRESHOLD_PX } from './use-swipe-verb';

const T = SWIPE_THRESHOLD_PX;

describe('resolveSwipeVerb — the D37 gesture mapping', () => {
  it('right past the threshold → Keep', () => {
    expect(resolveSwipeVerb(T, 0)).toBe('Keep');
    expect(resolveSwipeVerb(T + 40, 4)).toBe('Keep');
  });

  it('left past the threshold → Archive', () => {
    expect(resolveSwipeVerb(-T, 0)).toBe('Archive');
    expect(resolveSwipeVerb(-(T + 40), -4)).toBe('Archive');
  });

  it('up past the threshold → Later', () => {
    expect(resolveSwipeVerb(0, -T)).toBe('Later');
    expect(resolveSwipeVerb(3, -(T + 40))).toBe('Later');
  });

  it('down is unbound — a downward swipe resolves to null', () => {
    expect(resolveSwipeVerb(0, T)).toBeNull();
    expect(resolveSwipeVerb(4, T + 80)).toBeNull();
  });

  it('sub-threshold travel is a tap, not a swipe (null)', () => {
    expect(resolveSwipeVerb(T - 1, 0)).toBeNull();
    expect(resolveSwipeVerb(0, -(T - 1))).toBeNull();
    expect(resolveSwipeVerb(0, 0)).toBeNull();
  });

  it('diagonal drags are rejected by the dominance ratio', () => {
    // 60px right + 55px up: neither axis dominates the other by 1.4×.
    expect(resolveSwipeVerb(60, -55)).toBeNull();
    expect(resolveSwipeVerb(60, 55)).toBeNull();
  });

  it('a clearly horizontal drag with minor vertical drift still resolves', () => {
    // 80px right, 10px up — horizontal dominates well past 1.4×.
    expect(resolveSwipeVerb(80, -10)).toBe('Keep');
  });

  it('never resolves to Unsubscribe (button-only, never a gesture)', () => {
    const samples: Array<[number, number]> = [
      [T, 0],
      [-T, 0],
      [0, -T],
      [0, T],
      [100, -100],
    ];
    for (const [dx, dy] of samples) {
      const verb = resolveSwipeVerb(dx, dy);
      expect(verb === null || verb === 'Keep' || verb === 'Archive' || verb === 'Later').toBe(true);
    }
  });

  it('honours custom threshold + dominance options', () => {
    expect(resolveSwipeVerb(30, 0, { threshold: 20 })).toBe('Keep');
    expect(resolveSwipeVerb(30, 0, { threshold: 40 })).toBeNull();
  });
});
