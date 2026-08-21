import { describe, expect, it } from 'vitest';

import {
  RECOMMEND_FLOOR,
  confidenceBand,
  isRecommended,
  type EngineVerdict,
} from './engine-confidence';

const VERDICTS: readonly EngineVerdict[] = ['keep', 'archive', 'unsubscribe', 'later'];

describe('isRecommended', () => {
  it('is strict — a read exactly ON its floor does not recommend (D31)', () => {
    for (const verdict of VERDICTS) {
      const floor = RECOMMEND_FLOOR[verdict];
      if (floor === null) continue;
      expect(isRecommended(verdict, floor)).toBe(false);
      expect(isRecommended(verdict, floor + 0.01)).toBe(true);
    }
  });

  it('never recommends `later` — the cascade abstains, it does not advise', () => {
    for (const c of [0, 0.6, 0.7, 0.95, 1]) {
      expect(isRecommended('later', c)).toBe(false);
      expect(confidenceBand('later', c)).toBeNull();
    }
  });

  // The founder-reported regression (screenshot 2026-08-20). 0.74 is the
  // ceiling `score-cascade.ts` reaches for Archive when the user has
  // never manually archived the sender — i.e. what essentially every
  // real Archive row scores. The previous flat 0.85 gate made that
  // unreachable, so Archive could never be recommended anywhere, and the
  // queue sorts Archive into the hero slot first.
  it('recommends Archive at 0.74 — the top of its reachable band', () => {
    expect(isRecommended('archive', 0.74)).toBe(true);
    expect(isRecommended('archive', 0.73)).toBe(true);
  });

  it('keeps Unsubscribe at D31’s 0.85 — a destructive verb keeps its bar', () => {
    expect(RECOMMEND_FLOOR.unsubscribe).toBe(0.85);
    expect(isRecommended('unsubscribe', 0.85)).toBe(false);
    expect(isRecommended('unsubscribe', 0.86)).toBe(true);
  });
});

describe('confidenceBand', () => {
  it('defines `strong` as exactly `isRecommended` — pill and hint cannot disagree', () => {
    for (const verdict of VERDICTS) {
      for (let c = 0; c <= 1.0001; c += 0.01) {
        const confidence = Math.round(c * 100) / 100;
        expect(confidenceBand(verdict, confidence) === 'strong').toBe(
          isRecommended(verdict, confidence),
        );
      }
    }
  });

  it('grades below the floor rather than going silent', () => {
    expect(confidenceBand('unsubscribe', 0.8)).toBe('likely');
    expect(confidenceBand('unsubscribe', 0.7)).toBe('unsure');
    expect(confidenceBand('archive', 0.65)).toBe('likely');
    expect(confidenceBand('archive', 0.5)).toBe('unsure');
  });
});
