// Time left on the sync gate (D109 reversal 2026-09-26) — computed only
// from progress this tab actually watched arrive, never a fixed rate.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeScan, scanMsLeft, startScanTrack, useScanTimeLeft } from './scan-time-left';

const counts = (processed: number, total = 40_898) => ({ processed, total });

/** Replay `[at, processed]` changes, observed live, from a first render with no counts. */
function watched(total: number, changes: Array<[number, number]>) {
  let track = startScanTrack(null);
  for (const [at, processed] of changes) {
    track = observeScan(track, counts(processed, total), at);
  }
  return track;
}

describe('scanMsLeft — observed progress only', () => {
  it('counts already on screen at first render are not a point: their age is unknown', () => {
    let track = startScanTrack(counts(12_400));
    track = observeScan(track, counts(12_900), 10_000);

    expect(scanMsLeft(track, 10_000)).toBeNull();
  });

  it('gives a time after two observed changes, at the rate between them', () => {
    let track = startScanTrack(counts(12_400));
    track = observeScan(track, counts(12_900), 10_000);
    track = observeScan(track, counts(13_400), 20_000); // 500 in 10s

    // 27,498 left at 50/s.
    expect(scanMsLeft(track, 20_000)).toBe(549_960);
  });

  it('counts that appear while watching (the total just became known) are a first point', () => {
    const track = watched(1_200, [
      [0, 0],
      [10_000, 500],
    ]);

    expect(scanMsLeft(track, 10_000)).toBe(14_000); // 700 left at 50/s
  });

  it('averages everything watched, not just the latest batch', () => {
    const track = watched(10_000, [
      [0, 0],
      [10_000, 500],
      [50_000, 1_000],
    ]);

    expect(scanMsLeft(track, 50_000)).toBe(450_000); // 1,000 in 50s → 9,000 left at 20/s
  });

  it.each([
    [
      'the counts go away (the next attempt is listing again)',
      [
        [20_000, null],
        [25_000, counts(12_000)],
      ],
      [35_000, counts(12_100)],
      2_879_800, // 28,798 left at 10/s
    ],
    [
      'the count drops (a new attempt resumed from what was saved)',
      [[20_000, counts(12_000)]],
      [30_000, counts(12_100)],
      2_879_800,
    ],
    [
      'the total changes (a different scan)',
      [[20_000, counts(13_900, 41_000)]],
      [30_000, counts(14_000, 41_000)],
      2_700_000, // 27,000 left at 10/s
    ],
  ] as const)('starts over when %s', (_label, restart, next, expectedMs) => {
    let track = watched(40_898, [
      [0, 12_900],
      [10_000, 13_400],
    ]);
    expect(scanMsLeft(track, 10_000)).not.toBeNull();

    for (const [at, progress] of restart) track = observeScan(track, progress, at);
    // One point since the restart: nothing backs a time yet.
    expect(scanMsLeft(track, restart.at(-1)![0])).toBeNull();

    // The next change times the rate from the restart, not from before it.
    track = observeScan(track, next[1], next[0]);
    expect(scanMsLeft(track, next[0])).toBe(expectedMs);
  });

  it('drops the time once batches stop arriving at their usual pace', () => {
    const track = watched(10_000, [
      [0, 0],
      [30_000, 500],
      [60_000, 1_000],
    ]);

    // Usual gap 30s: stale three gaps after the last batch.
    expect(scanMsLeft(track, 150_000)).not.toBeNull();
    expect(scanMsLeft(track, 150_001)).toBeNull();
  });

  it('does not call a fast scan stalled inside a minute', () => {
    const track = watched(10_000, [
      [0, 0],
      [5_000, 500],
      [10_000, 1_000],
    ]);

    expect(scanMsLeft(track, 70_000)).not.toBeNull();
    expect(scanMsLeft(track, 70_001)).toBeNull();
  });

  it('has no time left to show once every message is read', () => {
    const track = watched(1_000, [
      [0, 0],
      [10_000, 500],
      [20_000, 1_000],
    ]);

    expect(scanMsLeft(track, 20_000)).toBeNull();
  });
});

describe('useScanTimeLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a time only after two watched changes, and drops it when the scan stalls', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: counts(12_400) as ReturnType<typeof counts> | null },
    });
    expect(result.current).toBeNull();

    vi.setSystemTime(10_000);
    rerender({ progress: counts(12_900) });
    expect(result.current).toBeNull();

    vi.setSystemTime(20_000);
    rerender({ progress: counts(13_400) });
    expect(result.current).toBe(549_960);

    // Under a minute without a batch: still backed.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(549_960);
    // Over a minute: the next re-check (every 10s) drops it.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBeNull();
  });

  it('has no time while the total is unknown', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: null as ReturnType<typeof counts> | null },
    });

    vi.setSystemTime(10_000);
    rerender({ progress: null });

    expect(result.current).toBeNull();
  });
});
