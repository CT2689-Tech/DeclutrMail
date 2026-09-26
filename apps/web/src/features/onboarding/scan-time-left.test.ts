// Time left on the sync gate (D109 reversal 2026-09-26) — computed only
// from batches the worker wrote, timed by when it wrote them.

import { act, render, renderHook } from '@testing-library/react';
import { createElement, useLayoutEffect } from 'react';
import type { SyncMessageProgress } from '@declutrmail/shared/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observeScan, scanMsLeft, startScanTrack, useScanTimeLeft } from './scan-time-left';

const counts = (processed: number, age_ms = 0, total = 40_898): SyncMessageProgress => ({
  processed,
  total,
  age_ms,
});

/** Replay `[seenAt, processed, age]` observations from a first render with no counts. */
function watched(total: number, seen: Array<[number, number, number?]>) {
  let track = startScanTrack(null);
  for (const [at, processed, age = 0] of seen) {
    track = observeScan(track, counts(processed, age, total), at);
  }
  return track;
}

describe('scanMsLeft — from what the worker wrote, when it wrote it', () => {
  it('counts already on screen at first render are not a point: when they were seen is unknown', () => {
    let track = startScanTrack(counts(12_400, 1_000));
    track = observeScan(track, counts(12_900), 10_000);

    expect(scanMsLeft(track, 10_000)).toBeNull();
  });

  it('times each count by its write, not by when the poll saw it', () => {
    // Batches written at 10s and 20s. Seen promptly, or the first one seen
    // 2.9s late: the same time left either way.
    const prompt = watched(40_898, [
      [10_000, 12_900],
      [20_000, 13_400],
    ]);
    const late = watched(40_898, [
      [12_900, 12_900, 2_900],
      [20_000, 13_400],
    ]);

    // 27,498 left at 500 per 10s.
    expect(scanMsLeft(prompt, 20_000)).toBe(549_960);
    expect(scanMsLeft(late, 20_000)).toBe(549_960);
  });

  it('places the first count after mount by its write, so one more batch gives a time', () => {
    let track = startScanTrack(counts(12_400, 4_000));
    // The first poll after mount: same batch, now with a trustworthy age.
    track = observeScan(track, counts(12_400, 7_000), 3_000); // written at -4,000
    track = observeScan(track, counts(12_900), 6_000); // written at 6,000

    // 500 in 10s → 27,998 left at 50/s.
    expect(scanMsLeft(track, 6_000)).toBe(559_960);
  });

  it('does not move a batch already placed when it is seen again, older', () => {
    let track = watched(40_898, [[10_000, 12_900]]);
    track = observeScan(track, counts(12_900, 3_000), 13_000);
    track = observeScan(track, counts(13_400), 20_000);

    expect(scanMsLeft(track, 20_000)).toBe(549_960);
  });

  it('counts that return after a failed read keep their write time', () => {
    let track = watched(40_898, [
      [0, 12_400],
      [10_000, 12_900],
    ]);
    track = observeScan(track, null, 13_000); // the read failed once
    // Back 8s after it was written, then the next batch.
    track = observeScan(track, counts(13_400, 8_000), 28_000); // written at 20,000
    track = observeScan(track, counts(13_900), 30_000);

    // Restarted at the returning count: 500 in 10s, not 500 in 2s.
    expect(scanMsLeft(track, 30_000)).toBe(539_960);
  });

  it('averages every batch since the track started', () => {
    const track = watched(10_000, [
      [0, 0],
      [10_000, 500],
      [50_000, 1_000],
    ]);

    expect(scanMsLeft(track, 50_000)).toBe(450_000); // 1,000 in 50s → 9,000 left at 20/s
  });

  it.each([
    ['the count drops (a new attempt resumed from what was saved)', counts(12_000), counts(12_100)],
    ['the total changes (a different scan)', counts(13_900, 0, 41_000), counts(14_000, 0, 41_000)],
  ])('starts over when %s', (_label, restart, next) => {
    let track = watched(40_898, [
      [0, 12_900],
      [10_000, 13_400],
    ]);
    track = observeScan(track, restart, 20_000);
    expect(scanMsLeft(track, 20_000)).toBeNull();

    track = observeScan(track, next, 30_000);
    // Timed from the restart only: 100 in 10s.
    expect(scanMsLeft(track, 30_000)).toBe(((next.total - next.processed) * 10_000) / 100);
  });

  it('starts over when a batch lands after a stall, so the pause is not averaged in', () => {
    let track = watched(40_898, [
      [0, 12_400],
      [10_000, 12_900],
      [20_000, 13_400],
    ]);
    // 90s with no batch — longer than the minute a stall is allowed.
    track = observeScan(track, counts(13_900), 110_000);
    expect(scanMsLeft(track, 110_000)).toBeNull();

    track = observeScan(track, counts(14_400), 120_000);
    // 500 per 10s again, not 2,000 per 120s.
    expect(scanMsLeft(track, 120_000)).toBe(529_960);
  });

  it('a tab hidden for minutes starts over on return instead of stretching the stall window', () => {
    // Polls stop while hidden; the worker keeps writing.
    let track = watched(40_898, [
      [0, 12_400],
      [12_500, 12_900],
    ]);
    track = observeScan(track, counts(36_900, 1_000), 613_500); // written at 612,500
    expect(scanMsLeft(track, 613_500)).toBeNull();

    track = observeScan(track, counts(37_400), 625_000);
    // Fresh rate after return: 500 per 12.5s.
    expect(scanMsLeft(track, 625_000)).toBe(87_450);
    // …and a stall after return drops it within the minute floor.
    expect(scanMsLeft(track, 625_000 + 60_001)).toBeNull();
  });

  it('counts down between batches and drops the time once it has run out', () => {
    const track = watched(1_000, [
      [0, 0],
      [10_000, 500],
    ]);

    expect(scanMsLeft(track, 10_000)).toBe(10_000);
    expect(scanMsLeft(track, 14_000)).toBe(6_000);
    // Spent with no new batch: nothing backs a number any more.
    expect(scanMsLeft(track, 20_001)).toBeNull();
  });

  it('drops the time once batches stop arriving at their usual pace', () => {
    const track = watched(100_000, [
      [0, 0],
      [30_000, 500],
      [60_000, 1_000],
    ]);

    // Usual gap 30s: stale three gaps after the last batch.
    expect(scanMsLeft(track, 150_000)).not.toBeNull();
    expect(scanMsLeft(track, 150_001)).toBeNull();
  });

  it('has no time left to show once every message is read', () => {
    const track = watched(1_000, [
      [0, 0],
      [10_000, 500],
      [20_000, 1_000],
    ]);

    expect(scanMsLeft(track, 20_000)).toBeNull();
  });

  it('never turns a malformed age into a number', () => {
    const track = watched(40_898, [
      [0, 12_400],
      [10_000, 12_900, Number.NaN],
    ]);

    expect(scanMsLeft(track, 10_000)).toBeNull();
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

  it('shows a time one batch after mount, and drops it when the scan stalls', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: counts(12_400, 4_000) as SyncMessageProgress | null },
    });
    expect(result.current).toBeNull();

    vi.setSystemTime(3_000);
    rerender({ progress: counts(12_400, 7_000) }); // first poll: written at -4,000
    expect(result.current).toBeNull();

    vi.setSystemTime(6_000);
    rerender({ progress: counts(12_900) });
    expect(result.current).toBe(559_960);

    // Under a minute without a batch: still backed, counting down.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(499_960);
    // Over a minute: the next re-check (every 10s) drops it.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBeNull();
  });

  // Seen live in the 2026-09-26 smoke: "1,000 of 1,345 emails · about 4
  // min left" reached the DOM for one commit before "about 2 min" — the
  // new count beside the previous count's time.
  it("never commits a new count with the previous count's time", () => {
    const committed: Array<number | null> = [];
    function Probe({ progress }: { progress: SyncMessageProgress }) {
      const msLeft = useScanTimeLeft(progress);
      useLayoutEffect(() => {
        committed.push(msLeft);
      });
      return null;
    }
    const { rerender } = render(createElement(Probe, { progress: counts(12_400) }));
    vi.setSystemTime(10_000);
    rerender(createElement(Probe, { progress: counts(12_900) }));
    vi.setSystemTime(20_000);
    rerender(createElement(Probe, { progress: counts(13_400) }));
    committed.length = 0;

    vi.setSystemTime(30_000);
    rerender(createElement(Probe, { progress: counts(13_900) }));

    // 1,000 in 20s → 26,998 left at 50/s, and nothing else ever painted.
    expect(committed).toEqual([539_960]);
  });

  it('has no time while the total is unknown', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: null as SyncMessageProgress | null },
    });

    vi.setSystemTime(10_000);
    rerender({ progress: null });

    expect(result.current).toBeNull();
  });
});
