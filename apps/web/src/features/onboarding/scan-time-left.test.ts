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
    track = observeScan(track, counts(13_400), 20_000);

    // One gap since the first placed batch — the mount's counts added none.
    expect(scanMsLeft(track, 20_000)).toBeNull();
  });

  it('times each count by its write, not by when the poll saw it', () => {
    // Batches written at 10s, 20s and 30s. Seen promptly, or the first one
    // seen 2.9s late: the same time left either way.
    const prompt = watched(40_898, [
      [10_000, 12_900],
      [20_000, 13_400],
      [30_000, 13_900],
    ]);
    const late = watched(40_898, [
      [12_900, 12_900, 2_900],
      [20_000, 13_400],
      [30_000, 13_900],
    ]);

    // 26,998 left at 500 per 10s.
    expect(scanMsLeft(prompt, 30_000)).toBe(539_960);
    expect(scanMsLeft(late, 30_000)).toBe(539_960);
  });

  it('places the first count after mount by its write, so two more batches give a time', () => {
    let track = startScanTrack(counts(12_400, 4_000));
    // The first poll after mount: same batch, now with a trustworthy age.
    track = observeScan(track, counts(12_400, 7_000), 3_000); // written at -4,000
    track = observeScan(track, counts(12_900), 6_000); // written at 6,000
    expect(scanMsLeft(track, 6_000)).toBeNull();

    track = observeScan(track, counts(13_400), 16_000);
    // 1,000 in 20s → 27,498 left at 50/s.
    expect(scanMsLeft(track, 16_000)).toBe(549_960);
  });

  it('does not move a batch already placed when it is seen again, older', () => {
    let track = watched(40_898, [[10_000, 12_900]]);
    track = observeScan(track, counts(12_900, 1_000), 13_000);
    track = observeScan(track, counts(13_400), 20_000);
    // Still one gap: the batch seen again is not a new one.
    expect(scanMsLeft(track, 20_000)).toBeNull();

    track = observeScan(track, counts(13_900), 30_000);
    expect(scanMsLeft(track, 30_000)).toBe(539_960);
  });

  it('counts that come back after going away keep their write time', () => {
    let track = watched(40_898, [
      [0, 12_400],
      [10_000, 12_900],
    ]);
    track = observeScan(track, null, 13_000);
    // Back 8s after it was written, then the next batches.
    track = observeScan(track, counts(13_400, 8_000), 28_000); // written at 20,000
    track = observeScan(track, counts(13_900), 30_000);
    track = observeScan(track, counts(14_400), 40_000);

    // Restarted at the returning count: 1,000 in 20s, not 1,000 in 12s.
    expect(scanMsLeft(track, 40_000)).toBe(529_960);
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
    [
      'the count drops (a new attempt resumed from what was saved)',
      [counts(12_000), counts(12_100), counts(12_200)],
    ],
    [
      'the total changes (a different scan)',
      [counts(13_900, 0, 41_000), counts(14_000, 0, 41_000), counts(14_100, 0, 41_000)],
    ],
  ])('starts over when %s', (_label, [restart, next, last]) => {
    let track = watched(40_898, [
      [0, 12_900],
      [10_000, 13_400],
      [20_000, 13_900],
    ]);
    track = observeScan(track, restart!, 30_000);
    expect(scanMsLeft(track, 30_000)).toBeNull();

    track = observeScan(track, next!, 40_000);
    track = observeScan(track, last!, 50_000);
    // Timed from the restart only: 200 in 20s.
    expect(scanMsLeft(track, 50_000)).toBe((last!.total - last!.processed) * 100);
  });

  // Seen live in the 2026-09-26 re-smoke: dev reads ~4 emails/s (4,800
  // quota units a minute at 20 a read), a 500-email batch every ~2 min,
  // and the stall rule restarted the track on every second batch — the
  // line never showed a time.
  it('a slow scan (~4 emails/s, a batch every ~2 min) keeps its minutes-long gaps as its pace', () => {
    let track = watched(1_345, [
      [0, 0],
      [125_000, 500],
    ]);
    expect(scanMsLeft(track, 125_000)).toBeNull();

    track = observeScan(track, counts(1_000, 0, 1_345), 250_000);
    // 345 left at 1,000 per 250s, and a 2-minute gap is not a stall here.
    expect(scanMsLeft(track, 250_000)).toBe(86_250);
    expect(scanMsLeft(track, 250_000 + 86_000)).toBe(250);
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
    track = observeScan(track, counts(14_900), 130_000);
    // 500 per 10s again, not 2,500 per 130s.
    expect(scanMsLeft(track, 130_000)).toBe(519_960);
  });

  it('a batch seen minutes after the last (a hidden tab) starts over, not a stretched stall window', () => {
    // Polls stop while hidden; the worker keeps writing.
    let track = watched(40_898, [
      [0, 12_400],
      [12_500, 12_900],
    ]);
    track = observeScan(track, counts(36_900, 1_000), 613_500); // written at 612,500
    expect(scanMsLeft(track, 613_500)).toBeNull();

    track = observeScan(track, counts(37_400), 625_000);
    track = observeScan(track, counts(37_900), 637_500);
    // Fresh rate after return: 500 per 12.5s.
    expect(scanMsLeft(track, 637_500)).toBe(74_950);
    // …and a stall after return drops it within the minute floor.
    expect(scanMsLeft(track, 637_500 + 60_001)).toBeNull();
  });

  // Round-2 review (2026-09-26): a pause inside the first gap — a slow first
  // read, a retry's backoff, a tab back mid-pause — was taken as the pace:
  // "about 6 hr 35 min left" for 16 minutes of scan.
  it('waits for a second gap: a first gap that held a pause is not the pace', () => {
    let track = watched(40_898, [
      [0, 0],
      [300_000, 500], // five minutes for one batch
    ]);
    expect(scanMsLeft(track, 300_000)).toBeNull();

    track = observeScan(track, counts(1_000), 312_500);
    // Far faster than the pace so far: measured again from here.
    expect(scanMsLeft(track, 312_500)).toBeNull();

    track = observeScan(track, counts(1_500), 325_000);
    // 1,000 in 25s → 39,398 left.
    expect(scanMsLeft(track, 325_000)).toBe(984_950);
  });

  it('a retry whose first count repeats the last one does not stretch the pace', () => {
    // The poll missed the clear between attempts: the new attempt's first
    // count reads as the old batch, and its backoff lands in the next gap.
    let track = watched(40_898, [[0, 12_000]]);
    track = observeScan(track, counts(12_000), 90_000);
    track = observeScan(track, counts(12_500), 102_500);
    track = observeScan(track, counts(13_000), 115_000);
    expect(scanMsLeft(track, 115_000)).toBeNull();

    track = observeScan(track, counts(13_500), 127_500);
    // 1,000 in 25s → 27,398 left, with no backoff in it.
    expect(scanMsLeft(track, 127_500)).toBe(684_950);
  });

  it('counts down between batches and drops the time once it has run out', () => {
    const track = watched(1_500, [
      [0, 0],
      [10_000, 500],
      [20_000, 1_000],
    ]);

    expect(scanMsLeft(track, 20_000)).toBe(10_000);
    expect(scanMsLeft(track, 24_000)).toBe(6_000);
    // Spent with no new batch: nothing backs a number any more.
    expect(scanMsLeft(track, 30_001)).toBeNull();
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
      [10_000, 12_900],
      [20_000, 13_400, Number.NaN],
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

  it('shows a time two batches after mount, and drops it when the scan stalls', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: counts(12_400, 4_000) as SyncMessageProgress | null },
    });
    expect(result.current).toBeNull();

    vi.setSystemTime(3_000);
    rerender({ progress: counts(12_400, 7_000) }); // first poll: written at -4,000
    expect(result.current).toBeNull();

    vi.setSystemTime(6_000);
    rerender({ progress: counts(12_900) });
    expect(result.current).toBeNull();

    vi.setSystemTime(16_000);
    rerender({ progress: counts(13_400) });
    expect(result.current).toBe(549_960);

    // A minute without a batch: still backed, counting down.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(489_960);
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
    vi.setSystemTime(30_000);
    rerender(createElement(Probe, { progress: counts(13_900) }));
    expect(committed.at(-1)).toBe(539_960);
    committed.length = 0;

    vi.setSystemTime(40_000);
    rerender(createElement(Probe, { progress: counts(14_400) }));

    // 1,500 in 30s → 26,498 left at 50/s, and nothing else ever painted.
    expect(committed).toEqual([529_960]);
  });

  // Simulated (round-2 review): without this, a batch written before a
  // stall the tab never saw became half of the first pace after return —
  // "about 41 min left" for 16 minutes of scan.
  it('measures the pace again after the tab was hidden, so a pause it missed is not averaged in', () => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    try {
      const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
        initialProps: { progress: null as SyncMessageProgress | null },
      });
      vi.setSystemTime(1_000);
      rerender({ progress: counts(0, 1_000) }); // listed at 0

      vi.setSystemTime(5_000);
      setVisibility('hidden'); // polls stop; the worker writes at 70s, then stalls
      vi.setSystemTime(140_000);
      setVisibility('visible');
      rerender({ progress: counts(2_500, 70_000) }); // written at 70,000

      vi.setSystemTime(213_000);
      rerender({ progress: counts(3_000) }); // the stall is over
      // 3,000 in 213s is not this scan's pace.
      expect(result.current).toBeNull();

      vi.setSystemTime(222_000);
      rerender({ progress: counts(3_500) });
      vi.setSystemTime(234_000);
      rerender({ progress: counts(4_000) });
      // 1,000 in 21s since the stall → 36,898 left.
      expect(result.current).toBe(774_858);
      // A stall now drops it within the minute floor.
      act(() => {
        vi.advanceTimersByTime(70_000);
      });
      expect(result.current).toBeNull();
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });

  // Flow round 2 (2026-09-26): a poll in flight when the tab hides lands
  // after the reset, and seeded the track while hidden — the first gap
  // after return then spanned the whole hidden time, unjudged.
  it('a poll that lands while the tab is hidden cannot become the pace', () => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    try {
      const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
        initialProps: { progress: null as SyncMessageProgress | null },
      });
      vi.setSystemTime(1_000);
      rerender({ progress: counts(12_400, 1_000) });
      vi.setSystemTime(12_500);
      rerender({ progress: counts(12_900) });

      vi.setSystemTime(13_000);
      setVisibility('hidden');
      vi.setSystemTime(13_400);
      rerender({ progress: counts(12_900, 900) }); // the in-flight poll lands
      vi.setSystemTime(313_000);
      setVisibility('visible');
      rerender({ progress: counts(36_400, 500) }); // written at 312,500 — then the scan stops

      expect(result.current).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current).toBeNull();
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });

  it('keeps the pace through a read that failed, unlike counts that went away', () => {
    const { result, rerender } = renderHook(({ progress }) => useScanTimeLeft(progress), {
      initialProps: { progress: null as SyncMessageProgress | null | undefined },
    });
    vi.setSystemTime(1_000);
    rerender({ progress: counts(12_400, 1_000) });
    vi.setSystemTime(10_000);
    rerender({ progress: counts(12_900) });
    vi.setSystemTime(20_000);
    rerender({ progress: counts(13_400) });
    expect(result.current).toBe(549_960);

    vi.setSystemTime(23_000);
    rerender({ progress: undefined }); // this poll could not read the counts
    vi.setSystemTime(30_000);
    rerender({ progress: counts(13_900) });

    // 1,500 in 30s → 26,998 left: the pace survived the failed read.
    expect(result.current).toBe(539_960);
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
