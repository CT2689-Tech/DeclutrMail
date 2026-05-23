import { triageVerdict } from '@declutrmail/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLimiter,
  runWithTimeout,
  VERDICT_LABEL,
  VERDICT_RUNTIME_VALUES,
} from './reasoning.js';

/**
 * Unit tests for the primitives the ScoreWorker sweep relies on
 * (Fix 1 — timeout + bounded concurrency) and the VERDICT_LABEL
 * exhaustiveness (Fix 2). End-to-end integration through the worker
 * loop lives in `score.worker.test.ts`.
 */

describe('runWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to {kind:"timeout"} when the task exceeds the budget (fires within tolerance)', async () => {
    vi.useFakeTimers();
    const pending = runWithTimeout(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 10_000);
        }),
      50,
    );
    // Advancing past `ms` MUST resolve the race to `timeout`. The task
    // never settles on its own within the test budget.
    await vi.advanceTimersByTimeAsync(51);
    expect(await pending).toEqual({ kind: 'timeout' });
  });
});

describe('createLimiter — bounded concurrency', () => {
  it('caps concurrent in-flight tasks at `max` (observed via activeCount peak)', async () => {
    const limit = createLimiter(3);
    let peak = 0;
    // 12 tasks, each holds for a release barrier. Without the cap the
    // peak would be 12; the limiter MUST hold it at 3.
    const release: Array<() => void> = [];
    const tasks = Array.from({ length: 12 }, (_, i) =>
      limit(async () => {
        peak = Math.max(peak, limit.activeCount);
        await new Promise<void>((resolve) => {
          release[i] = resolve;
        });
        return i;
      }),
    );

    // Yield to microtasks so the first batch enqueues.
    await Promise.resolve();
    await Promise.resolve();
    expect(limit.activeCount).toBe(3);

    // Drain — release each held task in order, asserting the cap holds.
    for (let i = 0; i < release.length; i += 1) {
      release[i]!();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(tasks);
    expect(peak).toBe(3);
    expect(limit.activeCount).toBe(0);
  });
});

describe('VERDICT_LABEL exhaustiveness (D20, D227)', () => {
  it('has exactly 4 entries; keys equal the runtime triage_verdict enum array', () => {
    const keys = Object.keys(VERDICT_LABEL).sort();
    expect(keys).toEqual(['archive', 'keep', 'later', 'unsubscribe']);
    expect(keys.length).toBe(4);
    // Sentinel: the PG enum is the source of truth for the union; the
    // label map MUST align with it byte-for-byte.
    expect([...VERDICT_RUNTIME_VALUES].sort()).toEqual(keys);
    expect([...triageVerdict.enumValues].sort()).toEqual(keys);
  });

  it('round-trips every verdict to its K/A/U/L user-facing verb', () => {
    // The four canonical verbs from D227. The `(v: Verdict) => VERDICT_LABEL[v]`
    // round trip is total — no `?? fallback` path, no `undefined` result.
    const lookup = (v: (typeof triageVerdict.enumValues)[number]): string => VERDICT_LABEL[v];
    expect(lookup('keep')).toBe('Keep');
    expect(lookup('archive')).toBe('Archive');
    expect(lookup('unsubscribe')).toBe('Unsubscribe');
    expect(lookup('later')).toBe('Later');
    for (const v of triageVerdict.enumValues) {
      expect(VERDICT_LABEL[v]).toMatch(/.+/);
    }
  });
});
