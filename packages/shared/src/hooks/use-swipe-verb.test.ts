// The swipe grammar (ADR-0048): pointer delta → verb.
//
// `resolveSwipeVerb` is the pure mapping the hook is built on; it is
// exported so the contract is pinned without synthesising pointer
// streams (DOM-event behaviour is covered in apps/web, where a DOM
// exists). What this locks:
//
//   - right → Keep, left → Unsubscribe, up → Delete
//   - down is UNBOUND — scroll and pull-to-refresh own it
//   - sub-threshold travel is a tap, not a swipe
//   - diagonal drags are rejected by the dominance ratio
//   - Archive and Later are NEVER gestures — one-tap buttons only

import { describe, expect, it } from 'vitest';

import { resolveSwipeVerb, SWIPE_HINT, SWIPE_THRESHOLD_PX, type SwipeVerb } from './use-swipe-verb';

const T = SWIPE_THRESHOLD_PX;

describe('resolveSwipeVerb: the ADR-0048 gesture mapping', () => {
  it('right past the threshold → Keep', () => {
    expect(resolveSwipeVerb(T, 0)).toBe('Keep');
    expect(resolveSwipeVerb(T + 40, 4)).toBe('Keep');
  });

  it('left past the threshold → Unsubscribe', () => {
    expect(resolveSwipeVerb(-T, 0)).toBe('Unsubscribe');
    expect(resolveSwipeVerb(-(T + 40), -4)).toBe('Unsubscribe');
  });

  it('up past the threshold → Delete', () => {
    expect(resolveSwipeVerb(0, -T)).toBe('Delete');
    expect(resolveSwipeVerb(3, -(T + 40))).toBe('Delete');
  });

  it('down is unbound: a downward swipe resolves to null', () => {
    expect(resolveSwipeVerb(0, T)).toBeNull();
    expect(resolveSwipeVerb(4, T + 80)).toBeNull();
  });

  it('sub-threshold travel is a tap, not a swipe (null)', () => {
    expect(resolveSwipeVerb(T - 1, 0)).toBeNull();
    expect(resolveSwipeVerb(-(T - 1), 0)).toBeNull();
    expect(resolveSwipeVerb(0, -(T - 1))).toBeNull();
    expect(resolveSwipeVerb(0, 0)).toBeNull();
  });

  it('diagonal drags are rejected by the dominance ratio', () => {
    // 60px right + 55px up: neither axis dominates the other by 1.4×.
    expect(resolveSwipeVerb(60, -55)).toBeNull();
    expect(resolveSwipeVerb(-60, -55)).toBeNull();
    expect(resolveSwipeVerb(60, 55)).toBeNull();
  });

  it('a clearly horizontal drag with minor vertical drift still resolves', () => {
    expect(resolveSwipeVerb(80, -10)).toBe('Keep');
    expect(resolveSwipeVerb(-80, -10)).toBe('Unsubscribe');
  });

  it('only ever resolves the three swipeable verbs: Archive and Later are buttons only', () => {
    const swipeable: ReadonlyArray<SwipeVerb | null> = ['Keep', 'Unsubscribe', 'Delete', null];
    const samples: Array<[number, number]> = [
      [T, 0],
      [-T, 0],
      [0, -T],
      [0, T],
      [100, -100],
      [-100, -100],
      [-200, 5],
      [0, -300],
    ];
    for (const [dx, dy] of samples) {
      expect(swipeable).toContain(resolveSwipeVerb(dx, dy));
    }
  });

  it('honours custom threshold + dominance options', () => {
    expect(resolveSwipeVerb(30, 0, { threshold: 20 })).toBe('Keep');
    expect(resolveSwipeVerb(30, 0, { threshold: 40 })).toBeNull();
    expect(resolveSwipeVerb(100, 60, { dominance: 2 })).toBeNull();
  });
});

describe('SWIPE_HINT: the one place the gesture words live', () => {
  it('names every swipeable verb with the direction that resolves to it', () => {
    expect(SWIPE_HINT).toEqual({
      Keep: '→ Keep',
      Unsubscribe: '← Unsubscribe',
      Delete: '↑ Delete',
    });
  });

  it('agrees with the resolver, so a hint can never name a different verb than the release fires', () => {
    const directions: Array<[number, number, string]> = [
      [T + 10, 0, '→'],
      [-(T + 10), 0, '←'],
      [0, -(T + 10), '↑'],
    ];
    for (const [dx, dy, arrow] of directions) {
      const verb = resolveSwipeVerb(dx, dy);
      expect(verb).not.toBeNull();
      expect(SWIPE_HINT[verb!].startsWith(arrow)).toBe(true);
    }
  });
});
